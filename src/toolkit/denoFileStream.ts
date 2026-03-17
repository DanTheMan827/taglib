/**
 * @file Read/write IOStream backed by Deno's native file system API
 * (`Deno.FsFile`).
 *
 * Because Deno types are not available in a standard TypeScript / Node.js
 * environment, minimal inline declarations are provided below so that the
 * module compiles under any `tsc` target without needing `@types/deno` or a
 * custom lib.
 */

import { ByteVector } from "../byteVector.js";
import { type offset_t, Position } from "./types.js";
import { IOStream } from "./ioStream.js";

// ---------------------------------------------------------------------------
// Minimal Deno type declarations (avoids a hard dependency on Deno's type lib)
// ---------------------------------------------------------------------------

/* eslint-disable no-var */
declare var Deno: {
  open(
    path: string,
    options?: { read?: boolean; write?: boolean; create?: boolean; truncate?: boolean },
  ): Promise<DenoFsFile>;
  SeekMode: { Start: 0; Current: 1; End: 2 };
};
/* eslint-enable no-var */

interface DenoFsFile {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  seek(offset: number, whence: 0 | 1 | 2): Promise<number>;
  truncate(len?: number): Promise<void>;
  stat(): Promise<{ size: number }>;
  close(): void;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

// ---------------------------------------------------------------------------
// DenoFileStream
// ---------------------------------------------------------------------------

/**
 * A read/write {@link IOStream} backed by a `Deno.FsFile` from Deno's native
 * file system API.
 *
 * **Read-write mode** (default): opens the file with `{ read: true, write: true }`.
 * All mutating operations (`writeBlock`, `insert`, `removeBlock`, `truncate`)
 * are available.
 *
 * **Read-only mode**: opens the file with `{ read: true }` only.  Any attempt
 * to call a mutating method throws an `Error`.
 *
 * The constructor is private. Always use one of the async factories:
 * ```ts
 * const stream = await DenoFileStream.open("/path/to/audio.mp3");
 * const ro     = await DenoFileStream.openReadOnly("/path/to/audio.mp3");
 * ```
 *
 * @example
 * // Read-write
 * const stream = await DenoFileStream.open("song.mp3");
 * const tag    = await FileRef.open(stream);
 * await stream.close();
 *
 * @example
 * // Read-only
 * const stream = await DenoFileStream.openReadOnly("song.flac");
 * const tag    = await FileRef.open(stream);
 * await stream.close();
 */
export class DenoFileStream extends IOStream {
  private readonly _path: string;
  private readonly _readOnly: boolean;
  private readonly _file: DenoFsFile;
  private _open: boolean = true;

  // --------------------------------------------------------------------------
  // Private constructor — use DenoFileStream.open() / openReadOnly()
  // --------------------------------------------------------------------------

  private constructor(path: string, file: DenoFsFile, readOnly: boolean) {
    super();
    this._path = path;
    this._file = file;
    this._readOnly = readOnly;
  }

  // --------------------------------------------------------------------------
  // Static factories
  // --------------------------------------------------------------------------

  /**
   * Opens a file at `path` for reading and optionally writing.
   *
   * Internally calls:
   * ```ts
   * await Deno.open(path, { read: true, write: true, create: create ?? false })
   * ```
   *
   * @param path   - Absolute or relative path to the file.
   * @param create - When `true` the file is created if it does not exist.
   *   Defaults to `false`.
   * @returns A fully initialised `DenoFileStream` in read-write mode.
   */
  static async open(path: string, create?: boolean): Promise<DenoFileStream> {
    const file = await Deno.open(path, { read: true, write: true, create: create ?? false });
    return new DenoFileStream(path, file, false);
  }

  /**
   * Opens a file at `path` for reading only.
   *
   * Internally calls:
   * ```ts
   * await Deno.open(path, { read: true })
   * ```
   *
   * @param path - Absolute or relative path to the file.
   * @returns A fully initialised `DenoFileStream` in read-only mode.
   */
  static async openReadOnly(path: string): Promise<DenoFileStream> {
    const file = await Deno.open(path, { read: true });
    return new DenoFileStream(path, file, true);
  }

  // --------------------------------------------------------------------------
  // IOStream implementation
  // --------------------------------------------------------------------------

  /** Returns the file path this stream was opened with. */
  name(): string {
    return this._path;
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
   * Reads up to `length` bytes from the current file position and advances
   * the position by the number of bytes actually read.
   *
   * @param length - Maximum number of bytes to read.
   * @returns Resolves with a {@link ByteVector} containing the bytes read.
   *   May be shorter than `length` when the end of the file is reached.
   */
  async readBlock(length: number): Promise<ByteVector> {
    if (length <= 0) {
      return new ByteVector();
    }

    const buf = new Uint8Array(length);
    const bytesRead = await this._file.read(buf);

    if (bytesRead === null || bytesRead === 0) {
      return new ByteVector();
    }

    return ByteVector.fromUint8Array(buf.subarray(0, bytesRead));
  }

  /**
   * Writes `data` at the current file position, extending the file if
   * necessary, and advances the position by `data.length`.
   *
   * @param data - The bytes to write.
   * @throws {Error} If the stream is read-only.
   */
  async writeBlock(data: ByteVector): Promise<void> {
    if (this._readOnly) {
      throw new Error("DenoFileStream is read-only");
    }
    if (data.length === 0) {
      return;
    }
    await this._file.write(data.data);
  }

  /**
   * Inserts `data` at byte offset `start`, optionally replacing `replace`
   * bytes of existing content. The position is set to `start + data.length`
   * after the operation.
   *
   * Because `Deno.FsFile` does not support in-place insertion, this method
   * reads the tail of the file, writes the new data at `start`, then writes
   * the tail back, and truncates if necessary.
   *
   * @param data    - The bytes to insert.
   * @param start   - Byte offset at which to begin the insertion.
   * @param replace - Number of existing bytes to overwrite. Defaults to 0.
   * @throws {Error} If the stream is read-only.
   */
  async insert(data: ByteVector, start: offset_t, replace: number = 0): Promise<void> {
    if (this._readOnly) {
      throw new Error("DenoFileStream is read-only");
    }

    const fileSize = (await this._file.stat()).size;

    // Pad with zeros if `start` is beyond the current end of the file
    if (start > fileSize) {
      await this._file.seek(fileSize, Deno.SeekMode.Start);
      await this._file.write(new Uint8Array(start - fileSize));
    }

    const tailStart = Math.min(start + replace, Math.max(start, fileSize));
    const tailLength = Math.max(0, fileSize - tailStart);

    let tail: Uint8Array | null = null;
    if (data.length !== replace && tailLength > 0) {
      // Read the tail that needs to be shifted
      tail = new Uint8Array(tailLength);
      await this._file.seek(tailStart, Deno.SeekMode.Start);
      let read = 0;
      while (read < tailLength) {
        const n = await this._file.read(tail.subarray(read));
        if (n === null) {
          break;
        }
        read += n;
      }
    }

    // Write the inserted data at `start`
    await this._file.seek(start, Deno.SeekMode.Start);
    await this._file.write(data.data);

    // Write the tail (if any) immediately after the inserted data
    if (tail !== null) {
      await this._file.write(tail);
    }

    // Truncate if the new content is shorter than what was replaced
    if (data.length < replace) {
      const newSize = Math.max(0, fileSize - replace + data.length);
      await this._file.truncate(newSize);
    }

    await this._file.seek(start + data.length, Deno.SeekMode.Start);
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
      throw new Error("DenoFileStream is read-only");
    }
    if (length <= 0) {
      return;
    }

    const fileSize = (await this._file.stat()).size;

    if (start >= fileSize) {
      return;
    }

    const afterStart = start + length;
    const tailLength = Math.max(0, fileSize - afterStart);

    if (tailLength > 0) {
      // Read tail
      const tail = new Uint8Array(tailLength);
      await this._file.seek(afterStart, Deno.SeekMode.Start);
      let read = 0;
      while (read < tailLength) {
        const n = await this._file.read(tail.subarray(read));
        if (n === null) {
          break;
        }
        read += n;
      }

      // Write tail at `start`
      await this._file.seek(start, Deno.SeekMode.Start);
      await this._file.write(tail);
    }

    await this._file.truncate(fileSize - Math.min(length, fileSize - start));
  }

  /**
   * Moves the read/write position within the file.
   *
   * @param offset   - Number of bytes to move relative to `position`.
   * @param position - Reference point for the seek. Defaults to
   *   {@link Position.Beginning}.
   */
  async seek(offset: offset_t, position: Position = Position.Beginning): Promise<void> {
    switch (position) {
      case Position.Beginning:
        await this._file.seek(offset, Deno.SeekMode.Start);
        break;
      case Position.Current:
        await this._file.seek(offset, Deno.SeekMode.Current);
        break;
      case Position.End:
        await this._file.seek(offset, Deno.SeekMode.End);
        break;
    }
  }

  /** Resets the stream position to the beginning of the file. */
  async clear(): Promise<void> {
    await this._file.seek(0, Deno.SeekMode.Start);
  }

  /** Returns the current read/write position in bytes from the start of the file. */
  async tell(): Promise<offset_t> {
    return await this._file.seek(0, Deno.SeekMode.Current);
  }

  /** Returns the total size of the file in bytes. */
  async length(): Promise<offset_t> {
    return (await this._file.stat()).size;
  }

  /**
   * Truncates or zero-extends the file to exactly `length` bytes.
   *
   * @param length - The desired file length in bytes.
   * @throws {Error} If the stream is read-only.
   */
  async truncate(length: offset_t): Promise<void> {
    if (this._readOnly) {
      throw new Error("DenoFileStream is read-only");
    }
    await this._file.truncate(length);
  }

  /**
   * Closes the underlying `Deno.FsFile`. After calling `close()`,
   * {@link isOpen} returns `false`.
   */
  async close(): Promise<void> {
    this._file.close();
    this._open = false;
  }
}
