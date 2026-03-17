/**
 * @file Read/write IOStream backed by the browser File System Access API's
 * `FileSystemSyncAccessHandle` (available in dedicated web workers).
 *
 * In read-only mode the stream falls back to slice-based reads from the
 * underlying `File` blob — identical in spirit to {@link BlobStream}.
 */

import { ByteVector } from "../byteVector.js";
import { type offset_t, Position } from "./types.js";
import { IOStream } from "./ioStream.js";

// ---------------------------------------------------------------------------
// Minimal type declarations for the File System Access API sync handle.
// These are not yet present in every TypeScript lib.dom.d.ts version.
// ---------------------------------------------------------------------------

/** Options accepted by {@link FileSystemSyncAccessHandle.read} and `.write`. */
interface FileSystemReadWriteOptions {
  /** If provided, the I/O operation begins at this byte offset instead of the
   *  handle's internal cursor position. */
  at?: number;
}

/**
 * Synchronous access handle returned by `FileSystemFileHandle.createSyncAccessHandle()`.
 * Only available inside a dedicated web worker.
 */
interface FileSystemSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: FileSystemReadWriteOptions): number;
  write(buffer: ArrayBufferView | DataView, options?: FileSystemReadWriteOptions): number;
  seek(offset: number): void;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

/** Augment the standard DOM FileSystemFileHandle with the sync-handle factory. */
interface FileSystemFileHandleWithSync extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}

// ---------------------------------------------------------------------------
// FileSystemFileHandleStream
// ---------------------------------------------------------------------------

/**
 * A read/write {@link IOStream} backed by a `FileSystemFileHandle` from the
 * browser's File System Access API.
 *
 * **Read-write mode** (default): opens a `FileSystemSyncAccessHandle` and uses
 * its `read`/`write` methods with explicit byte offsets (`at` option) so that
 * the internal cursor stays in sync without extra round-trips.
 *
 * **Read-only mode**: retrieves the underlying `File` blob from the handle and
 * performs lazy slice-based reads — identical to {@link BlobStream} but named
 * after the originating `FileSystemFileHandle`.
 *
 * The constructor is private; always use the async factory:
 * ```ts
 * const stream = await FileSystemFileHandleStream.open(fileHandle);
 * ```
 *
 * @example
 * // In a dedicated web worker:
 * const [fileHandle] = await window.showOpenFilePicker();
 * const stream = await FileSystemFileHandleStream.open(fileHandle);
 * const tag = await FileRef.open(stream);
 */
export class FileSystemFileHandleStream extends IOStream {
  private readonly _name: string;
  private readonly _readOnly: boolean;

  /** Sync access handle (read-write mode only). */
  private readonly _handle: FileSystemSyncAccessHandle | null;

  /** Blob used for read-only slice reads. */
  private readonly _blob: Blob | null;

  /** `false` once `close()` has been called. */
  private _open: boolean = true;

  /** Current logical byte position. */
  private _position: offset_t = 0;

  // --------------------------------------------------------------------------
  // Private constructor — use FileSystemFileHandleStream.open()
  // --------------------------------------------------------------------------

  private constructor(
    name: string,
    handle: FileSystemSyncAccessHandle | null,
    blob: Blob | null,
    readOnly: boolean,
  ) {
    super();
    this._name = name;
    this._handle = handle;
    this._blob = blob;
    this._readOnly = readOnly;
  }

  // --------------------------------------------------------------------------
  // Static factory
  // --------------------------------------------------------------------------

  /**
   * Opens a `FileSystemFileHandle` and wraps it in a stream.
   *
   * @param fileHandle - The handle to open. Must be obtained via the File
   *   System Access API (e.g. `window.showOpenFilePicker()`).
   * @param readOnly   - When `true`, the stream opens the handle's `File` blob
   *   for read-only slice-based access instead of creating a sync handle.
   *   Defaults to `false`.
   * @returns A fully initialised `FileSystemFileHandleStream`.
   */
  static async open(fileHandle: FileSystemFileHandle, readOnly: boolean = false): Promise<FileSystemFileHandleStream> {
    if (readOnly) {
      const blob = await fileHandle.getFile();
      return new FileSystemFileHandleStream(fileHandle.name, null, blob, true);
    }

    const handle = await (fileHandle as FileSystemFileHandleWithSync).createSyncAccessHandle();
    return new FileSystemFileHandleStream(fileHandle.name, handle, null, false);
  }

  // --------------------------------------------------------------------------
  // IOStream implementation
  // --------------------------------------------------------------------------

  /** Returns the name of the underlying file. */
  name(): string {
    return this._name;
  }

  /** Returns `true` if this stream was opened in read-only mode. */
  readOnly(): boolean {
    return this._readOnly;
  }

  /** Returns `true` if the stream has not yet been closed. */
  isOpen(): boolean {
    return this._open;
  }

  /**
   * Reads up to `length` bytes from the current position and advances the
   * position by the number of bytes actually read.
   *
   * @param length - Maximum number of bytes to read.
   * @returns Resolves with a {@link ByteVector} containing the bytes read.
   */
  async readBlock(length: number): Promise<ByteVector> {
    if (length <= 0) {
      return new ByteVector();
    }

    if (this._readOnly) {
      // Read-only: slice from the blob
      const blob = this._blob!;
      const available = blob.size - this._position;
      if (available <= 0) {
        return new ByteVector();
      }
      const toRead = Math.min(length, available);
      const buffer = await blob.slice(this._position, this._position + toRead).arrayBuffer();
      this._position += toRead;
      return ByteVector.fromUint8Array(new Uint8Array(buffer));
    }

    // Read-write: use sync access handle
    const handle = this._handle!;
    const available = handle.getSize() - this._position;
    if (available <= 0) {
      return new ByteVector();
    }
    const toRead = Math.min(length, available);
    const buf = new Uint8Array(toRead);
    const bytesRead = handle.read(buf, { at: this._position });
    this._position += bytesRead;
    return ByteVector.fromUint8Array(buf.subarray(0, bytesRead));
  }

  /**
   * Writes `data` at the current position, extending the file if necessary,
   * and advances the position by `data.length`.
   *
   * @param data - The bytes to write.
   * @throws {Error} If the stream is read-only.
   */
  async writeBlock(data: ByteVector): Promise<void> {
    if (this._readOnly) {
      throw new Error("FileSystemFileHandleStream is read-only");
    }
    if (data.length === 0) {
      return;
    }
    const written = this._handle!.write(data.data, { at: this._position });
    this._position += written;
  }

  /**
   * Inserts `data` at byte offset `start`, optionally replacing `replace`
   * bytes of existing content.
   *
   * Because `FileSystemSyncAccessHandle` does not support in-place insertion,
   * this method reads the tail of the file, writes the new data, then writes
   * the tail back.
   *
   * @param data    - The bytes to insert.
   * @param start   - Byte offset at which to begin the insertion.
   * @param replace - Number of existing bytes to overwrite. Defaults to 0.
   * @throws {Error} If the stream is read-only.
   */
  async insert(data: ByteVector, start: offset_t, replace: number = 0): Promise<void> {
    if (this._readOnly) {
      throw new Error("FileSystemFileHandleStream is read-only");
    }

    const handle = this._handle!;
    const fileSize = handle.getSize();

    // Pad to `start` with zeros if necessary
    if (start > fileSize) {
      const padding = new Uint8Array(start - fileSize);
      handle.write(padding, { at: fileSize });
    }

    const tailStart = Math.min(start + replace, Math.max(start, fileSize));
    const tailLength = Math.max(0, fileSize - tailStart);

    if (data.length !== replace && tailLength > 0) {
      // Read the tail that needs to be shifted
      const tail = new Uint8Array(tailLength);
      handle.read(tail, { at: tailStart });

      // Write inserted data
      handle.write(data.data, { at: start });

      // Write tail after inserted data
      handle.write(tail, { at: start + data.length });
    } else {
      // No shift needed (sizes match, or no tail)
      handle.write(data.data, { at: start });
    }

    // Truncate if the replacement was larger than the insertion
    if (data.length < replace) {
      const newSize = Math.max(0, fileSize - replace + data.length);
      handle.truncate(newSize);
    }

    this._position = start + data.length;
  }

  /**
   * Removes `length` bytes beginning at byte offset `start`, shifting all
   * subsequent bytes towards the beginning of the file.
   *
   * @param start  - Byte offset of the first byte to remove.
   * @param length - Number of bytes to remove.
   * @throws {Error} If the stream is read-only.
   */
  async removeBlock(start: offset_t, length: number): Promise<void> {
    if (this._readOnly) {
      throw new Error("FileSystemFileHandleStream is read-only");
    }
    if (length <= 0) {
      return;
    }

    const handle = this._handle!;
    const fileSize = handle.getSize();

    if (start >= fileSize) {
      return;
    }

    const afterStart = start + length;
    const tailLength = Math.max(0, fileSize - afterStart);

    if (tailLength > 0) {
      const tail = new Uint8Array(tailLength);
      handle.read(tail, { at: afterStart });
      handle.write(tail, { at: start });
    }

    handle.truncate(fileSize - Math.min(length, fileSize - start));

    // Clamp position
    if (this._position > start && this._position < start + length) {
      this._position = start;
    } else if (this._position >= start + length) {
      this._position -= length;
    }
  }

  /**
   * Moves the read/write position within the stream.
   *
   * @param offset   - Number of bytes to move relative to `position`.
   * @param position - Reference point for the seek. Defaults to
   *   {@link Position.Beginning}.
   */
  async seek(offset: offset_t, position: Position = Position.Beginning): Promise<void> {
    const size = await this.length();
    switch (position) {
      case Position.Beginning:
        this._position = Math.max(0, offset);
        break;
      case Position.Current:
        this._position = Math.max(0, this._position + offset);
        break;
      case Position.End:
        this._position = Math.max(0, size + offset);
        break;
    }
  }

  /** Resets the stream position to the beginning. */
  async clear(): Promise<void> {
    this._position = 0;
  }

  /** Returns the current read/write position in bytes. */
  async tell(): Promise<offset_t> {
    return this._position;
  }

  /** Returns the total length of the file in bytes. */
  async length(): Promise<offset_t> {
    if (this._readOnly) {
      return this._blob!.size;
    }
    return this._handle!.getSize();
  }

  /**
   * Truncates or zero-extends the file to exactly `length` bytes. If the
   * current position exceeds the new length, it is clamped.
   *
   * @param length - The desired file length in bytes.
   * @throws {Error} If the stream is read-only.
   */
  async truncate(length: offset_t): Promise<void> {
    if (this._readOnly) {
      throw new Error("FileSystemFileHandleStream is read-only");
    }
    this._handle!.truncate(length);
    if (this._position > length) {
      this._position = length;
    }
  }

  /**
   * Flushes pending writes and closes the underlying sync access handle.
   * This is a no-op in read-only mode (the blob requires no cleanup).
   *
   * After calling `close()`, {@link isOpen} returns `false` and further I/O
   * will produce undefined behaviour.
   */
  async close(): Promise<void> {
    if (!this._readOnly && this._handle !== null) {
      this._handle.flush();
      this._handle.close();
    }
    this._open = false;
  }
}
