/**
 * @file Read-only IOStream backed by a `Blob` or `File` object.
 *
 * Reads are performed lazily via `blob.slice().arrayBuffer()`, so the entire
 * blob is never loaded into memory at once.
 */

import { ByteVector } from "../byteVector.js";
import { type offset_t, Position } from "./types.js";
import { IOStream } from "./ioStream.js";

/**
 * A read-only {@link IOStream} backed by a browser/Node.js `Blob` (or `File`).
 *
 * Each {@link readBlock} call slices the blob for the requested byte range and
 * converts only that slice to an `ArrayBuffer`, so the full blob contents are
 * never held in memory simultaneously.
 *
 * Write operations ({@link writeBlock}, {@link insert}, {@link removeBlock},
 * {@link truncate}) always throw because the stream is read-only.
 */
export class BlobStream extends IOStream {
  /** The underlying blob or file. */
  private readonly _blob: Blob;

  /** Current read position in bytes from the start of the blob. */
  private _position: offset_t = 0;

  /**
   * Creates a new BlobStream wrapping the given `Blob` or `File`.
   *
   * @param blob - The blob (or file) to stream. Its contents are never copied
   *   in their entirety; only slices are read on demand.
   */
  constructor(blob: Blob) {
    super();
    this._blob = blob;
  }

  // ---------------------------------------------------------------------------
  // IOStream implementation
  // ---------------------------------------------------------------------------

  /**
   * Returns the file name if the backing object is a `File`, otherwise `""`.
   */
  name(): string {
    if (this._blob instanceof File) {
      return this._blob.name;
    }
    return "";
  }

  /**
   * Reads up to `length` bytes from the current position and advances the
   * position by the number of bytes actually read.
   *
   * @param length - Maximum number of bytes to read.
   * @returns Resolves with a {@link ByteVector} containing the bytes read.
   *   May be shorter than `length` if the end of the blob is reached.
   */
  async readBlock(length: number): Promise<ByteVector> {
    if (length <= 0) {
      return new ByteVector();
    }

    const available = this._blob.size - this._position;
    if (available <= 0) {
      return new ByteVector();
    }

    const toRead = Math.min(length, available);
    const start = this._position;
    const end = start + toRead;

    const buffer = await this._blob.slice(start, end).arrayBuffer();
    this._position = end;
    return ByteVector.fromUint8Array(new Uint8Array(buffer));
  }

  /**
   * Not supported — BlobStream is read-only.
   *
   * @throws {Error} Always throws `"BlobStream is read-only"`.
   */
  async writeBlock(_data: ByteVector): Promise<void> {
    throw new Error("BlobStream is read-only");
  }

  /**
   * Not supported — BlobStream is read-only.
   *
   * @throws {Error} Always throws `"BlobStream is read-only"`.
   */
  async insert(_data: ByteVector, _start: offset_t, _replace?: number): Promise<void> {
    throw new Error("BlobStream is read-only");
  }

  /**
   * Not supported — BlobStream is read-only.
   *
   * @throws {Error} Always throws `"BlobStream is read-only"`.
   */
  async removeBlock(_start: offset_t, _length: number): Promise<void> {
    throw new Error("BlobStream is read-only");
  }

  /** Returns `true` — BlobStream does not support write operations. */
  readOnly(): boolean {
    return true;
  }

  /** Returns `true` — BlobStream is always open. */
  isOpen(): boolean {
    return true;
  }

  /**
   * Moves the read position within the blob.
   *
   * @param offset   - Number of bytes to move relative to `position`.
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
        this._position = Math.max(0, this._blob.size + offset);
        break;
    }
  }

  /** Resets the read position to the beginning of the blob. */
  async clear(): Promise<void> {
    this._position = 0;
  }

  /** Returns the current read position in bytes from the start of the blob. */
  async tell(): Promise<offset_t> {
    return this._position;
  }

  /** Returns the total size of the blob in bytes. */
  async length(): Promise<offset_t> {
    return this._blob.size;
  }

  /**
   * Not supported — BlobStream is read-only.
   *
   * @throws {Error} Always throws `"BlobStream is read-only"`.
   */
  async truncate(_length: offset_t): Promise<void> {
    throw new Error("BlobStream is read-only");
  }
}
