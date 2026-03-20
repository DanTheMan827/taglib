/** @file Abstract base class for RIFF/FORM container formats (WAV, AIFF). Handles chunk parsing and manipulation. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import type { offset_t } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";

/**
 * Metadata about a single RIFF/FORM chunk stored during parsing.
 */
interface ChunkInfo {
  /** Four-character chunk identifier (e.g. `"fmt "`, `"data"`, `"ID3 "`). */
  name: string;
  /** Byte offset of the chunk data within the file (past the 8-byte chunk header). */
  offset: offset_t;
  /** Byte size of the chunk data as recorded in the chunk header. */
  size: number;
  /** Number of pad bytes appended after the data to align to an even boundary (0 or 1). */
  padding: number;
}

/**
 * Abstract base for RIFF container formats (WAV uses little-endian "RIFF",
 * AIFF uses big-endian "FORM").
 *
 * File layout:
 *   fileId(4) + fileSize(4) + format(4) + chunks…
 * Each chunk:
 *   chunkId(4) + chunkSize(4) + data (padded to even byte boundary)
 */
export abstract class RiffFile extends File {
  /** Whether multi-byte integers in this container are big-endian (`true` for AIFF/FORM, `false` for WAV/RIFF). */
  protected _bigEndian: boolean;
  /** Ordered list of chunks found during header parsing. */
  private _chunks: ChunkInfo[] = [];
  /** Format identifier read from bytes 8–11 of the file header (e.g. `"WAVE"`, `"AIFF"`). */
  private _format: string = "";

  /**
   * Protected constructor — subclasses call this to set up the stream and endianness.
   * @param stream - The underlying I/O stream for the container file.
   * @param bigEndian - `true` for big-endian (AIFF/FORM), `false` for little-endian (WAV/RIFF).
   */
  protected constructor(stream: IOStream, bigEndian: boolean) {
    super(stream);
    this._bigEndian = bigEndian;
  }

  // ---------------------------------------------------------------------------
  // Chunk access
  // ---------------------------------------------------------------------------

  /**
   * Total number of top-level chunks found in the file.
   * @returns The chunk count.
   */
  get chunkCount(): number {
    return this._chunks.length;
  }

  /**
   * Returns the four-character identifier of the chunk at the given index.
   * @param index - Zero-based chunk index.
   * @returns The chunk name (e.g. `"fmt "`, `"data"`).
   */
  chunkName(index: number): string {
    return this._chunks[index].name;
  }

  /**
   * Returns the byte offset of the chunk data (past the 8-byte header) at the given index.
   * @param index - Zero-based chunk index.
   * @returns Byte offset within the file.
   */
  chunkOffset(index: number): offset_t {
    return this._chunks[index].offset;
  }

  /**
   * Returns the data size (in bytes) of the chunk at the given index.
   * @param index - Zero-based chunk index.
   * @returns Chunk data size in bytes.
   */
  chunkDataSize(index: number): number {
    return this._chunks[index].size;
  }

  /**
   * Reads and returns the raw data bytes of the chunk at the given index.
   * @param index - Zero-based chunk index.
   * @returns A promise resolving to the chunk's data as a {@link ByteVector}.
   */
  async chunkData(index: number): Promise<ByteVector> {
    await this.seek(this._chunks[index].offset);
    return await this.readBlock(this._chunks[index].size);
  }

  /**
   * Returns the number of pad bytes (0 or 1) appended to the chunk at the given index.
   * @param index - Zero-based chunk index.
   * @returns Padding byte count.
   */
  chunkPadding(index: number): number {
    return this._chunks[index].padding;
  }

  /** The format identifier from the file header (e.g. `"WAVE"`, `"AIFF"`, `"AIFC"`). */
  get riffFormat(): string {
    return this._format;
  }

  // ---------------------------------------------------------------------------
  // Chunk manipulation
  // ---------------------------------------------------------------------------

  /**
   * Set (or add) a chunk with the given four-character name.
   * If `overwrite` is `true` (default) and a chunk with the same name already
   * exists, its data is replaced in-place; otherwise a new chunk is appended.
   * @param name - Four-character chunk identifier.
   * @param data - Raw data bytes to store in the chunk.
   * @param overwrite - When `true`, replace an existing chunk with the same name.
   */
  async setChunkData(name: string, data: ByteVector, overwrite: boolean = true): Promise<void> {
    if (this.readOnly) return;

    if (overwrite) {
      for (let i = 0; i < this._chunks.length; i++) {
        if (this._chunks[i].name === name) {
          const oldTotalSize = this._chunks[i].size + this._chunks[i].padding;
          const newPadding = data.length % 2 !== 0 ? 1 : 0;

          // Build the replacement: chunkId + size + data [+ pad]
          const header = ByteVector.fromString(
            name.padEnd(4, " ").substring(0, 4),
            StringType.Latin1,
          );
          header.append(ByteVector.fromUInt(data.length, this._bigEndian));
          header.append(data);
          if (newPadding) header.append(0);

          // The chunk header (8 bytes) sits right before the offset
          const chunkHeaderOffset = this._chunks[i].offset - 8;
          await this.insert(header, chunkHeaderOffset, 8 + oldTotalSize);

          // Update stored info
          const sizeDelta = (data.length + newPadding) - oldTotalSize;
          this._chunks[i].size = data.length;
          this._chunks[i].padding = newPadding;

          // Shift subsequent chunk offsets
          for (let j = i + 1; j < this._chunks.length; j++) {
            this._chunks[j].offset += sizeDelta;
          }

          // Update outer RIFF/FORM size
          await this.updateFileSize();
          return;
        }
      }
    }

    // Append new chunk at end of file
    const padding = data.length % 2 !== 0 ? 1 : 0;
    const header = ByteVector.fromString(
      name.padEnd(4, " ").substring(0, 4),
      StringType.Latin1,
    );
    header.append(ByteVector.fromUInt(data.length, this._bigEndian));
    header.append(data);
    if (padding) header.append(0);

    const endOffset = await this.fileLength();
    await this.seek(endOffset);
    await this.writeBlock(header);

    this._chunks.push({
      name,
      offset: endOffset + 8,
      size: data.length,
      padding,
    });

    await this.updateFileSize();
  }

  /**
   * Remove the first chunk matching `name` from both the file and the in-memory chunk list.
   * @param name - Four-character chunk identifier to remove.
   */
  async removeChunk(name: string): Promise<void> {
    if (this.readOnly) return;

    for (let i = 0; i < this._chunks.length; i++) {
      if (this._chunks[i].name === name) {
        const totalRemove = 8 + this._chunks[i].size + this._chunks[i].padding;
        const chunkHeaderOffset = this._chunks[i].offset - 8;

        await this.removeBlock(chunkHeaderOffset, totalRemove);

        // Shift subsequent chunk offsets
        for (let j = i + 1; j < this._chunks.length; j++) {
          this._chunks[j].offset -= totalRemove;
        }

        this._chunks.splice(i, 1);
        await this.updateFileSize();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal parsing
  // ---------------------------------------------------------------------------

  /**
   * Reads the RIFF/FORM file header and populates the internal chunk list.
   * Sets `_valid` to `false` if the file header is missing or unrecognised.
   */
  protected async parseHeader(): Promise<void> {
    await this.seek(0);
    const header = await this.readBlock(12);
    if (header.length < 12) {
      this._valid = false;
      return;
    }

    const fileId = header.mid(0, 4).toString(StringType.Latin1);
    if (fileId !== "RIFF" && fileId !== "FORM") {
      this._valid = false;
      return;
    }

    this._format = header.mid(8, 4).toString(StringType.Latin1);

    // Walk chunks
    let pos: offset_t = 12;
    const fileLen = await this.fileLength();

    while (pos + 8 <= fileLen) {
      await this.seek(pos);
      const chunkHeader = await this.readBlock(8);
      if (chunkHeader.length < 8) break;

      const chunkName = chunkHeader.mid(0, 4).toString(StringType.Latin1);
      const chunkSize = chunkHeader.toUInt(4, this._bigEndian);
      const dataOffset = pos + 8;
      const padding = chunkSize % 2 !== 0 ? 1 : 0;

      this._chunks.push({
        name: chunkName,
        offset: dataOffset,
        size: chunkSize,
        padding,
      });

      pos = dataOffset + chunkSize + padding;
    }
  }

  /**
   * Rewrites the 4-byte file-size field at byte offset 4 to reflect the current file length.
   */
  private async updateFileSize(): Promise<void> {
    const size = (await this.fileLength()) - 8;
    await this.seek(4);
    await this.writeBlock(ByteVector.fromUInt(size, this._bigEndian));
  }
}
