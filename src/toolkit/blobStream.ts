/**
 * @file Read/write IOStream backed by a `Blob` or `File` object.
 *
 * Reads are performed lazily — each `BlobSegment` is fetched from the blob on
 * first access and the result is **cached on the segment**, so subsequent reads
 * of the same range are purely in-memory with no async overhead.  When a
 * `readBlock` call spans multiple uncached segments, all outstanding
 * `arrayBuffer()` calls are issued in **parallel** via `Promise.all`,
 * minimising round-trips.
 *
 * Writes are captured in a **piece table** — a list of segments that are
 * either a byte-range reference into the original blob (`BlobSegment`) or a
 * small in-memory `Uint8Array` buffer (`BufferSegment`).  The total logical
 * length is maintained as a cached field so that `length()` and most seeks are
 * O(1).
 *
 * The modified content can be assembled as a new `Blob` (preserving the
 * source MIME type) via {@link BlobStream.toBlob}.
 */

import { ByteVector } from "../byteVector.js";
import { type offset_t, Position } from "./types.js";
import { IOStream } from "./ioStream.js";

// ---------------------------------------------------------------------------
// Piece-table segment types
// ---------------------------------------------------------------------------

/**
 * A segment that references a byte range inside the original source blob.
 *
 * Once the range has been read, the raw bytes are stored in {@link cache} so
 * that future reads of overlapping ranges are served from memory without
 * issuing another `arrayBuffer()` call.
 */
interface BlobSegment {
  /** Discriminant tag. */
  kind: "blob";
  /** Inclusive start offset within the source blob. */
  start: number;
  /** Exclusive end offset within the source blob. */
  end: number;
  /**
   * Populated on first fetch.  Once set, reads from this segment are
   * in-memory and require no async I/O.
   */
  cache?: Uint8Array;
}

/**
 * A segment that holds a small in-memory buffer representing inserted or
 * overwritten bytes.
 */
interface BufferSegment {
  /** Discriminant tag. */
  kind: "buffer";
  /** The raw byte data. */
  data: Uint8Array;
}

/** A single entry in the {@link BlobStream} piece table. */
type Segment = BlobSegment | BufferSegment;

/**
 * Returns the logical byte length of a single segment.
 *
 * @param seg - The segment to measure.
 */
function segmentLength(seg: Segment): number {
  return seg.kind === "blob" ? seg.end - seg.start : seg.data.length;
}

// ---------------------------------------------------------------------------
// BlobStream
// ---------------------------------------------------------------------------

/**
 * A read/write {@link IOStream} backed by a browser/Node.js `Blob` (or
 * `File`).
 *
 * ### Reading
 * Each `BlobSegment` is fetched from the blob on first access and its bytes
 * are cached on the segment object.  Subsequent reads of the same range are
 * served from the cache without any async I/O.  When a single `readBlock`
 * call spans multiple uncached segments, all `arrayBuffer()` requests are
 * issued in parallel via `Promise.all`.
 *
 * ### Writing
 * A *piece table* tracks the logical content as an ordered list of
 * {@link Segment}s.  Mutations only manipulate this list; they never copy the
 * original blob.  The cached total length is kept up-to-date on every
 * mutation so that `length()` is O(1).
 *
 * ### Exporting
 * {@link toBlob} assembles a new `Blob` from `blob.slice()` references and
 * in-memory buffers — no full-file copy.  The new blob's MIME type is copied
 * from the source blob.
 */
export class BlobStream extends IOStream {
  /** The original, unmodified source blob. */
  private readonly _blob: Blob;

  /** MIME type captured from the source blob at construction time. */
  private readonly _mimeType: string;

  /** Current read/write position in bytes from the logical start. */
  private _position: offset_t = 0;

  /** The piece table — ordered list of segments forming the logical content. */
  private _segments: Segment[];

  /**
   * Cached total logical length in bytes.  Maintained by every mutating
   * operation so that {@link length} and range-checks are O(1).
   */
  private _length: number;

  /**
   * Creates a new `BlobStream` wrapping the given `Blob` or `File`.
   *
   * The blob's contents are **not** loaded into memory at construction time.
   * Each byte range is fetched on demand and cached for subsequent access.
   *
   * @param blob - The blob (or `File`) to stream.
   */
  constructor(blob: Blob) {
    super();
    this._blob = blob;
    this._mimeType = blob.type;
    if (blob.size > 0) {
      this._segments = [{ kind: "blob", start: 0, end: blob.size }];
      this._length = blob.size;
    } else {
      this._segments = [];
      this._length = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // IOStream implementation
  // ---------------------------------------------------------------------------

  /**
   * Returns the file name when the backing object is a `File`, otherwise `""`.
   */
  name(): string {
    return this._blob instanceof File ? this._blob.name : "";
  }

  /**
   * Reads up to `length` bytes from the current position, spanning segment
   * boundaries as needed.  All uncached `BlobSegment`s in the range are
   * fetched in parallel via `Promise.all` and their results are cached on the
   * segment for future reads.
   *
   * @param length - Maximum number of bytes to read.
   * @returns Resolves with a {@link ByteVector} containing the bytes read.
   *   May be shorter than `length` if the logical end of stream is reached.
   */
  async readBlock(length: number): Promise<ByteVector> {
    if (length <= 0) return new ByteVector();

    const available = Math.max(0, this._length - this._position);
    if (available <= 0) return new ByteVector();

    const toRead = Math.min(length, available);

    /**
     * Two-pass approach:
     *   Pass 1 — walk segments, collect uncached BlobSegments to fetch.
     *   Pass 2 — after `Promise.all`, assemble the result from all segments.
     */

    /** Describes a single region of `toRead` bytes that needs to be assembled. */
    type Part =
      | { kind: "cached"; data: Uint8Array }
      | { kind: "fetch"; fetchIdx: number; startInSeg: number; take: number };

    const parts: Part[] = [];
    /** BlobSegments that need to be fetched (no cache yet). */
    const fetchSegs: BlobSegment[] = [];

    let remaining = toRead;
    let cursor = 0;

    for (const seg of this._segments) {
      if (remaining <= 0) break;
      const segLen = segmentLength(seg);
      const segEnd = cursor + segLen;

      if (segEnd <= this._position) {
        cursor = segEnd;
        continue;
      }

      const startInSeg = Math.max(0, this._position - cursor);
      const take = Math.min(segLen - startInSeg, remaining);

      if (seg.kind === "blob") {
        if (seg.cache) {
          // Already fetched — slice the cached buffer directly.
          parts.push({ kind: "cached", data: seg.cache.subarray(startInSeg, startInSeg + take) });
        } else {
          const fetchIdx = fetchSegs.length;
          fetchSegs.push(seg);
          parts.push({ kind: "fetch", fetchIdx, startInSeg, take });
        }
      } else {
        parts.push({ kind: "cached", data: seg.data.subarray(startInSeg, startInSeg + take) });
      }

      remaining -= take;
      cursor = segEnd;
    }

    // Fetch all uncached BlobSegments in parallel.
    if (fetchSegs.length > 0) {
      const arrayBuffers = await Promise.all(
        fetchSegs.map(s => this._blob.slice(s.start, s.end).arrayBuffer()),
      );
      for (let i = 0; i < fetchSegs.length; i++) {
        fetchSegs[i].cache = new Uint8Array(arrayBuffers[i]);
      }
    }

    // Assemble the result from cached and freshly-fetched data.
    const chunks: Uint8Array[] = [];
    for (const part of parts) {
      if (part.kind === "cached") {
        chunks.push(part.data);
      } else {
        const cache = fetchSegs[part.fetchIdx].cache!;
        chunks.push(cache.subarray(part.startInSeg, part.startInSeg + part.take));
      }
    }

    this._position += toRead - remaining;
    return ByteVector.fromUint8Array(this._concat(chunks));
  }

  /**
   * Writes `data` at the current position, overwriting existing content and
   * extending the stream if necessary.  Advances the position by
   * `data.length`.
   *
   * @param data - The bytes to write.
   */
  async writeBlock(data: ByteVector): Promise<void> {
    if (data.length === 0) return;
    // Defensive copy — prevents aliasing if the caller writes the same
    // ByteVector instance multiple times (the piece table stores the raw buffer
    // directly, so a shared reference would corrupt earlier segments).
    const bytes = data.data.slice();

    // Zero-pad if writing past the current end.
    if (this._position > this._length) {
      const pad = new Uint8Array(this._position - this._length);
      this._segments.push({ kind: "buffer", data: pad });
      this._length += pad.length;
    }

    // Remove bytes that are being overwritten.
    const overwriteLen = Math.min(bytes.length, Math.max(0, this._length - this._position));
    if (overwriteLen > 0) {
      this._removeRange(this._position, overwriteLen);
    }

    this._insertAt(this._position, { kind: "buffer", data: bytes });
    this._length += bytes.length - overwriteLen;
    this._position += bytes.length;
  }

  /**
   * Inserts `data` at byte offset `start`, optionally replacing `replace`
   * bytes of existing content.  Sets the position to `start + data.length`.
   *
   * @param data    - The bytes to insert.
   * @param start   - Byte offset at which to begin the insertion.
   * @param replace - Number of existing bytes to replace. Defaults to `0`.
   */
  async insert(data: ByteVector, start: offset_t, replace: number = 0): Promise<void> {
    const actualReplace = Math.min(replace, Math.max(0, this._length - start));
    if (actualReplace > 0) {
      this._removeRange(start, actualReplace);
      this._length -= actualReplace;
    }
    if (data.length > 0) {
      this._insertAt(start, {
        kind: "buffer",
        // Defensive copy — same aliasing risk as in writeBlock: the piece table
        // holds the buffer directly, so a shared reference would corrupt stored
        // segments if the same ByteVector is inserted again later.
        data: data.data.slice(),
      });
      this._length += data.length;
    }
    this._position = start + data.length;
  }

  /**
   * Removes `length` bytes beginning at byte offset `start`.
   *
   * @param start  - Byte offset of the first byte to remove.
   * @param length - Number of bytes to remove.
   */
  async removeBlock(start: offset_t, length: number): Promise<void> {
    if (length <= 0) return;
    const actual = Math.min(length, Math.max(0, this._length - start));
    if (actual <= 0) return;
    this._removeRange(start, actual);
    this._length -= actual;

    // Adjust cursor.
    if (this._position > start && this._position < start + actual) {
      this._position = start;
    } else if (this._position >= start + actual) {
      this._position -= actual;
    }
  }

  /** Returns `false` — BlobStream supports write operations. */
  readOnly(): boolean {
    return false;
  }

  /** Returns `true` — BlobStream is always open. */
  isOpen(): boolean {
    return true;
  }

  /**
   * Moves the read/write position within the stream.
   *
   * @param offset   - Number of bytes to move.
   * @param position - Reference point for the seek. Defaults to
   *   {@link Position.Beginning}.
   */
  async seek(offset: offset_t, position: Position = Position.Beginning): Promise<void> {
    switch (position) {
      case Position.Beginning:
        this._position = Math.max(0, offset);
        break;
      case Position.Current:
        this._position = Math.max(0, this._position + offset);
        break;
      case Position.End:
        this._position = Math.max(0, this._length + offset);
        break;
    }
  }

  /** Resets the read/write position to the beginning of the stream. */
  async clear(): Promise<void> {
    this._position = 0;
  }

  /** Returns the current read/write position in bytes from the logical start. */
  async tell(): Promise<offset_t> {
    return this._position;
  }

  /**
   * Returns the total logical byte length of the stream in O(1) time.
   */
  async length(): Promise<offset_t> {
    return this._length;
  }

  /**
   * Truncates or zero-extends the stream to exactly `length` bytes.  If the
   * current position exceeds the new length it is clamped.
   *
   * @param length - The desired stream length in bytes.
   */
  async truncate(length: offset_t): Promise<void> {
    if (length < this._length) {
      this._removeRange(length, this._length - length);
      this._length = length;
      if (this._position > length) this._position = length;
    } else if (length > this._length) {
      const pad = new Uint8Array(length - this._length);
      this._segments.push({ kind: "buffer", data: pad });
      this._length = length;
    }
  }

  // ---------------------------------------------------------------------------
  // BlobStream-specific public API
  // ---------------------------------------------------------------------------

  /**
   * Assembles a new `Blob` from the current piece table without loading the
   * full content into memory.  Each {@link BlobSegment} becomes a
   * `blob.slice()` reference and each {@link BufferSegment} is passed as a raw
   * `Uint8Array`.  The new blob's MIME type is copied from the source blob.
   *
   * @returns A new `Blob` reflecting all edits made to this stream.
   */
  toBlob(): Blob {
    const parts: BlobPart[] = [];
    for (const seg of this._segments) {
      if (seg.kind === "blob") {
        // Prefer the cached Uint8Array when available — avoids a new slice.
        parts.push((seg.cache ?? this._blob.slice(seg.start, seg.end)) as BlobPart);
      } else {
        parts.push(seg.data as unknown as BlobPart);
      }
    }
    return new Blob(parts, { type: this._mimeType });
  }

  // ---------------------------------------------------------------------------
  // Private piece-table helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensures there is a segment boundary at `offset` and returns the index of
   * the segment that starts at `offset`.  If `offset` falls in the middle of a
   * segment that segment is split into two.
   *
   * When splitting a {@link BlobSegment} that has a populated {@link BlobSegment.cache cache},
   * the cache is sub-divided so neither child needs to re-fetch.
   *
   * @param offset - Byte offset at which a boundary is required.
   * @returns The segment index where the boundary now exists.
   */
  private _splitAt(offset: number): number {
    let cursor = 0;
    for (let i = 0; i < this._segments.length; i++) {
      if (cursor === offset) return i;
      const len = segmentLength(this._segments[i]);
      if (cursor + len > offset) {
        const splitPos = offset - cursor;
        const seg = this._segments[i];
        if (seg.kind === "blob") {
          const left: BlobSegment = {
            kind: "blob",
            start: seg.start,
            end: seg.start + splitPos,
            cache: seg.cache?.subarray(0, splitPos),
          };
          const right: BlobSegment = {
            kind: "blob",
            start: seg.start + splitPos,
            end: seg.end,
            cache: seg.cache?.subarray(splitPos),
          };
          this._segments.splice(i, 1, left, right);
        } else {
          this._segments.splice(
            i,
            1,
            { kind: "buffer", data: seg.data.subarray(0, splitPos) },
            { kind: "buffer", data: seg.data.subarray(splitPos) },
          );
        }
        return i + 1;
      }
      cursor += len;
    }
    return this._segments.length;
  }

  /**
   * Removes the logical byte range `[start, start + length)` from the piece
   * table.  Segments that overlap either boundary are split first so that only
   * whole segments need to be spliced out.
   *
   * **Note**: the caller is responsible for updating `_length`.
   *
   * @param start  - Logical start offset of the range to remove.
   * @param length - Number of bytes to remove.
   */
  private _removeRange(start: number, length: number): void {
    if (length <= 0 || start >= this._length) return;
    const end = Math.min(start + length, this._length);

    // Split at end first (doesn't affect indices before end's position).
    this._splitAt(end);
    // Then split at start — returns index where start's boundary now sits.
    const startIdx = this._splitAt(start);

    // Find the segment index that begins at `end`.
    let cursor = start;
    let endIdx = this._segments.length;
    for (let i = startIdx; i < this._segments.length; i++) {
      if (cursor === end) {
        endIdx = i;
        break;
      }
      cursor += segmentLength(this._segments[i]);
    }

    this._segments.splice(startIdx, endIdx - startIdx);
  }

  /**
   * Inserts a new segment into the piece table at logical byte offset
   * `offset`, splitting any existing segment that spans `offset`.
   *
   * **Note**: the caller is responsible for updating `_length`.
   *
   * @param offset - Logical byte offset at which the new segment is inserted.
   * @param seg    - The segment to insert.
   */
  private _insertAt(offset: number, seg: Segment): void {
    if (segmentLength(seg) === 0) return;
    const idx = this._splitAt(offset);
    this._segments.splice(idx, 0, seg);
  }

  /**
   * Concatenates an array of `Uint8Array` chunks into a single contiguous
   * `Uint8Array`.
   *
   * @param chunks - Chunks to concatenate.
   * @returns A new `Uint8Array` containing all bytes in order.
   */
  private _concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}
