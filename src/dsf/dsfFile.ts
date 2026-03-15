import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";
import { DsfProperties } from "./dsfProperties.js";

// =============================================================================
// DsfFile
// =============================================================================

/**
 * DSD Stream File (DSF) format handler.
 *
 * A DSF file consists of four sequential chunks: DSD, fmt, data, and an
 * optional metadata (ID3v2) chunk.  This is *not* a RIFF-style container —
 * chunks appear in a fixed order.
 *
 * Only an ID3v2 tag is supported (no ID3v1, no APE).
 */
export class DsfFile extends File {
  private _tag: Id3v2Tag | null = null;
  private _properties: DsfProperties | null = null;

  private _fileSize: number = 0;
  private _metadataOffset: number = 0;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    if (this.isOpen) {
      this.read(readProperties, readStyle);
    }
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /** Quick-check whether `stream` looks like a valid DSF file. */
  static isSupported(stream: IOStream): boolean {
    stream.seek(0);
    const id = stream.readBlock(4);
    if (id.length < 4) return false;

    const dsd = ByteVector.fromString("DSD ", StringType.Latin1);
    return id.startsWith(dsd);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag | null {
    return this._tag;
  }

  audioProperties(): DsfProperties | null {
    return this._properties;
  }

  save(): boolean {
    if (this.readOnly) return false;
    if (!this._tag) return false;

    if (this._tag.isEmpty) {
      const newFileSize = this._metadataOffset
        ? this._metadataOffset
        : this._fileSize;

      // Update file size in DSD chunk header
      if (this._fileSize !== newFileSize) {
        this.insert(
          ByteVector.fromLongLong(BigInt(newFileSize), false),
          12,
          8,
        );
        this._fileSize = newFileSize;
      }

      // Clear metadata offset (no tag)
      if (this._metadataOffset) {
        this.insert(ByteVector.fromLongLong(0n, false), 20, 8);
        this._metadataOffset = 0;
      }

      // Truncate file to remove old tag
      this.truncate(newFileSize);
    } else {
      const tagData = this._tag.render();

      const newMetadataOffset = this._metadataOffset
        ? this._metadataOffset
        : this._fileSize;
      const newFileSize = newMetadataOffset + tagData.length;
      const oldTagSize = this._fileSize - newMetadataOffset;

      // Update file size
      if (this._fileSize !== newFileSize) {
        this.insert(
          ByteVector.fromLongLong(BigInt(newFileSize), false),
          12,
          8,
        );
        this._fileSize = newFileSize;
      }

      // Update metadata offset
      if (this._metadataOffset !== newMetadataOffset) {
        this.insert(
          ByteVector.fromLongLong(BigInt(newMetadataOffset), false),
          20,
          8,
        );
        this._metadataOffset = newMetadataOffset;
      }

      // Write the tag
      this.insert(tagData, newMetadataOffset, oldTagSize);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // DSD chunk
    this.seek(0);
    const chunkName = this.readBlock(4);
    const dsd = ByteVector.fromString("DSD ", StringType.Latin1);
    if (!chunkName.startsWith(dsd)) {
      this._valid = false;
      return;
    }

    const dsdHeaderSizeData = this.readBlock(8);
    const dsdHeaderSize = Number(dsdHeaderSizeData.toLongLong(false));
    if (dsdHeaderSize !== 28) {
      this._valid = false;
      return;
    }

    this._fileSize = Number(this.readBlock(8).toLongLong(false));
    if (this._fileSize > this.fileLength) {
      this._valid = false;
      return;
    }

    this._metadataOffset = Number(this.readBlock(8).toLongLong(false));
    if (this._metadataOffset > this._fileSize) {
      this._valid = false;
      return;
    }

    // fmt chunk
    const fmtName = this.readBlock(4);
    const fmt = ByteVector.fromString("fmt ", StringType.Latin1);
    if (!fmtName.startsWith(fmt)) {
      this._valid = false;
      return;
    }

    const fmtHeaderSize = Number(this.readBlock(8).toLongLong(false));
    if (fmtHeaderSize !== 52) {
      this._valid = false;
      return;
    }

    // Read fmt payload (52 bytes includes the chunk header we already read: 4 + 8 = 12
    // so payload is fmtHeaderSize - 12 = 40... actually the C++ reads fmtHeaderSize bytes
    // Let's follow C++ which reads fmtHeaderSize bytes after the size field)
    // The C++ says: d->properties = make_unique<Properties>(readBlock(fmtHeaderSize), ...)
    // But fmtHeaderSize=52 and the properties::read expects data starting at formatVersion
    // which is right after "fmt " + 8-byte size. So the C++ reads 52 bytes as fmt payload.
    // However properties::read() only uses offsets 0-35 (36 bytes) from that data.
    if (readProperties) {
      this._properties = new DsfProperties(this.readBlock(fmtHeaderSize), readStyle);
    } else {
      this._properties = null;
    }

    // ID3v2 tag
    if (this._metadataOffset === 0) {
      this._tag = new Id3v2Tag();
    } else {
      this._tag = Id3v2Tag.readFrom(this._stream, this._metadataOffset);
    }
  }
}
