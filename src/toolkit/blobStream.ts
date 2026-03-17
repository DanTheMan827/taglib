/**
 * @file Read/write IOStream backed by a `Blob` or `File` object.
 *
 * Reads are performed lazily via `blob.slice().arrayBuffer()` so the original
 * blob is never fully loaded into memory.  Writes are captured in a
 * **piece table** — a list of segments that are either a byte-range reference
 * into the original blob or a small in-memory `Uint8Array` buffer.  The full
 * modified content can be assembled without a memory copy by calling
 * {@link BlobStream.toBlob}, which passes blob-slice references and in-memory
 * buffers directly to the `Blob` constructor.
 */

import { ByteVector } from "../byteVector.js";
import { type offset_t, Position } from "./types.js";
import { IOStream } from "./ioStream.js";

// ---------------------------------------------------------------------------
// Piece-table segment types
// ---------------------------------------------------------------------------

/**
 * A segment that references a byte range inside the original source blob.
 * The range `[start, end)` uses the same indices as `Blob.slice()`.
 */
interface BlobSegment {
  /** Discriminant tag. */
  kind: "blob";
  /** Inclusive start offset within the source blob. */
  start: number;
  /** Exclusive end offset within the source blob. */
  end: number;
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
 * **Reading** is lazy: {@link readBlock} only fetches the specific byte range
 * needed via `blob.slice().arrayBuffer()`.  The full blob is never loaded into
 * memory simultaneously.
 *
 * **Writing** uses a *piece table*: the logical content is modelled as an
 * ordered list of {@link Segment}s — each one is either a reference to a byte
 * range of the original blob (`BlobSegment`) or a small in-memory buffer
 * (`BufferSegment`).  Mutations ({@link writeBlock}, {@link insert},
 * {@link removeBlock}, {@link truncate}) only manipulate this list; they never
 * copy the original blob.
 *
 * **Exporting** the modified content as a new `Blob` is done via
 * {@link toBlob}, which passes blob-slice and buffer references directly to
 * the `Blob` constructor — again without a full-file memory copy.  The new
 * blob inherits the MIME type of the source blob.
 */
export class BlobStream extends IOStream {
  /** The original, unmodified source blob. */
  private readonly _blob: Blob;

  /** The MIME type captured from the source blob at construction time. */
  private readonly _mimeType: string;

  /** Current read/write position in bytes from the logical start. */
  private _position: offset_t = 0;

  /**
   * The piece table — ordered list of segments that, concatenated, form the
   * current logical content of the stream.
   */
  private _segments: Segment[];

  /**
   * Creates a new BlobStream wrapping the given `Blob` or `File`.
   *
   * @param blob - The blob (or file) to stream.  Its contents are never
   *   copied in their entirety; only individual byte ranges are fetched on
   *   demand.
   */
  constructor(blob: Blob) {
    super();
    this._blob = blob;
    this._mimeType = blob.type;
    this._segments = blob.size > 0 ? [{ kind: "blob", start: 0, end: blob.size }] : [];
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
   * boundaries as needed, and advances the position by the number of bytes
   * actually read.
   *
   * @param length - Maximum number of bytes to read.
   * @returns Resolves with a {@link ByteVector} containing the bytes read.
   *   May be shorter than `length` if the logical end of stream is reached.
   */
  async readBlock(length: number): Promise<ByteVector> {
    if (length <= 0) return new ByteVector();

    const total = this._totalLength();
    const available = Math.max(0, total - this._position);
    if (available <= 0) return new ByteVector();

    const toRead = Math.min(length, available);
    const chunks: Uint8Array[] = [];
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
        const buf = await this._blob
          .slice(seg.start + startInSeg, seg.start + startInSeg + take)
          .arrayBuffer();
        chunks.push(new Uint8Array(buf));
      } else {
        chunks.push(seg.data.subarray(startInSeg, startInSeg + take));
      }

      remaining -= take;
      cursor = segEnd;
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
    const bytes = data.data;
    const total = this._totalLength();

    // Zero-pad if writing past the current end
    if (this._position > total) {
      this._segments.push({ kind: "buffer", data: new Uint8Array(this._position - total) });
    }

    // Remove bytes being overwritten
    const overwriteLen = Math.min(bytes.length, Math.max(0, this._totalLength() - this._position));
    if (overwriteLen > 0) {
      this._removeRange(this._position, overwriteLen);
    }

    this._insertAt(this._position, { kind: "buffer", data: bytes });
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
    if (replace > 0) {
      this._removeRange(start, replace);
    }
    if (data.length > 0) {
      this._insertAt(start, { kind: "buffer", data: data.data });
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
    this._removeRange(start, length);

    // Adjust cursor
    if (this._position > start && this._position < start + length) {
      this._position = start;
    } else if (this._position >= start + length) {
      this._position -= length;
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
    const total = this._totalLength();
    switch (position) {
      case Position.Beginning:
        this._position = Math.max(0, offset);
        break;
      case Position.Current:
        this._position = Math.max(0, this._position + offset);
        break;
      case Position.End:
        this._position = Math.max(0, total + offset);
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

  /** Returns the total logical length of the stream in bytes. */
  async length(): Promise<offset_t> {
    return this._totalLength();
  }

  /**
   * Truncates or zero-extends the stream to exactly `length` bytes.  If the
   * current position exceeds the new length it is clamped to the new length.
   *
   * @param length - The desired stream length in bytes.
   */
  async truncate(length: offset_t): Promise<void> {
    const total = this._totalLength();
    if (length < total) {
      this._removeRange(length, total - length);
      if (this._position > length) this._position = length;
    } else if (length > total) {
      this._segments.push({ kind: "buffer", data: new Uint8Array(length - total) });
    }
  }

  // ---------------------------------------------------------------------------
  // BlobStream-specific public API
  // ---------------------------------------------------------------------------

  /**
   * Assembles a new `Blob` from the current piece table without loading the
   * full content into memory.  Each {@link BlobSegment} becomes a `blob.slice`
   * reference and each {@link BufferSegment} is passed as a raw `Uint8Array`.
   * The new blob's MIME type is copied from the source blob.
   *
   * @returns A new `Blob` reflecting all edits made to this stream.
   */
  toBlob(): Blob {
    const parts: BlobPart[] = [];
    for (const seg of this._segments) {
      if (seg.kind === "blob") {
        parts.push(this._blob.slice(seg.start, seg.end));
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
   * Returns the sum of all segment lengths — the current logical stream size.
   */
  private _totalLength(): number {
    return this._segments.reduce((sum, s) => sum + segmentLength(s), 0);
  }

  /**
   * Ensures there is a segment boundary at `offset` and returns the index of
   * the segment that starts at `offset`.  If `offset` falls in the middle of a
   * segment that segment is split into two.
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
          this._segments.splice(
            i,
            1,
            { kind: "blob", start: seg.start, end: seg.start + splitPos },
            { kind: "blob", start: seg.start + splitPos, end: seg.end },
          );
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
   * table.  Segments that overlap either boundary are split first so that
   * only whole segments need to be spliced out.
   *
   * @param start  - Logical start offset of the range to remove.
   * @param length - Number of bytes to remove.
   */
  private _removeRange(start: number, length: number): void {
    if (length <= 0) return;
    const total = this._totalLength();
    if (start >= total) return;
    const end = Math.min(start + length, total);

    // Split at end first (does not affect segments before end's position)
    this._splitAt(end);
    // Then split at start — returns the index where start's boundary now lies
    const startIdx = this._splitAt(start);

    // Walk forward from startIdx to find the segment that begins at end
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
