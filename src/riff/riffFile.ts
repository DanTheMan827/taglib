import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import type { offset_t } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";

/**
 * Metadata about a single RIFF/FORM chunk stored during parsing.
 */
interface ChunkInfo {
  name: string;
  offset: offset_t;
  size: number;
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
  protected _bigEndian: boolean;
  private _chunks: ChunkInfo[] = [];
  private _format: string = "";

  constructor(stream: IOStream, bigEndian: boolean) {
    super(stream);
    this._bigEndian = bigEndian;
    this.parseHeader();
  }

  // ---------------------------------------------------------------------------
  // Chunk access
  // ---------------------------------------------------------------------------

  get chunkCount(): number {
    return this._chunks.length;
  }

  chunkName(index: number): string {
    return this._chunks[index].name;
  }

  chunkOffset(index: number): offset_t {
    return this._chunks[index].offset;
  }

  chunkDataSize(index: number): number {
    return this._chunks[index].size;
  }

  chunkData(index: number): ByteVector {
    this.seek(this._chunks[index].offset);
    return this.readBlock(this._chunks[index].size);
  }

  chunkPadding(index: number): number {
    return this._chunks[index].padding;
  }

  /** The format identifier from the file header (e.g. "WAVE", "AIFF", "AIFC"). */
  get riffFormat(): string {
    return this._format;
  }

  // ---------------------------------------------------------------------------
  // Chunk manipulation
  // ---------------------------------------------------------------------------

  /**
   * Set (or add) a chunk with the given four-character name.
   * If `overwrite` is true (default) and a chunk with the same name already
   * exists, its data is replaced in-place; otherwise a new chunk is appended.
   */
  setChunkData(name: string, data: ByteVector, overwrite: boolean = true): void {
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
          this.insert(header, chunkHeaderOffset, 8 + oldTotalSize);

          // Update stored info
          const sizeDelta = (data.length + newPadding) - oldTotalSize;
          this._chunks[i].size = data.length;
          this._chunks[i].padding = newPadding;

          // Shift subsequent chunk offsets
          for (let j = i + 1; j < this._chunks.length; j++) {
            this._chunks[j].offset += sizeDelta;
          }

          // Update outer RIFF/FORM size
          this.updateFileSize();
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

    const endOffset = this.fileLength;
    this.seek(endOffset);
    this.writeBlock(header);

    this._chunks.push({
      name,
      offset: endOffset + 8,
      size: data.length,
      padding,
    });

    this.updateFileSize();
  }

  /**
   * Remove the first chunk matching `name`.
   */
  removeChunk(name: string): void {
    if (this.readOnly) return;

    for (let i = 0; i < this._chunks.length; i++) {
      if (this._chunks[i].name === name) {
        const totalRemove = 8 + this._chunks[i].size + this._chunks[i].padding;
        const chunkHeaderOffset = this._chunks[i].offset - 8;

        this.removeBlock(chunkHeaderOffset, totalRemove);

        // Shift subsequent chunk offsets
        for (let j = i + 1; j < this._chunks.length; j++) {
          this._chunks[j].offset -= totalRemove;
        }

        this._chunks.splice(i, 1);
        this.updateFileSize();
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal parsing
  // ---------------------------------------------------------------------------

  private parseHeader(): void {
    this.seek(0);
    const header = this.readBlock(12);
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
    const fileLen = this.fileLength;

    while (pos + 8 <= fileLen) {
      this.seek(pos);
      const chunkHeader = this.readBlock(8);
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

  /** Rewrite the 4-byte file-size field at offset 4. */
  private updateFileSize(): void {
    const size = this.fileLength - 8;
    this.seek(4);
    this.writeBlock(ByteVector.fromUInt(size, this._bigEndian));
  }
}
