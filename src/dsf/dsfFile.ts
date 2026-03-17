/** @file DSF (DSD Stream File) format handler. */
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
  /** The ID3v2 tag, or `null` if not yet loaded. */
  private _tag: Id3v2Tag | null = null;
  /** Parsed audio properties from the "fmt " chunk. */
  private _properties: DsfProperties | null = null;

  /** Total file size in bytes as recorded in the DSD chunk header. */
  private _fileSize: number = 0;
  /** File offset of the ID3v2 metadata chunk, or 0 if absent. */
  private _metadataOffset: number = 0;

  /**
   * Private constructor — use {@link DsfFile.open} to create instances.
   * @param stream The underlying I/O stream.
   */
  private constructor(stream: IOStream) {
    super(stream);
  }

  /**
   * Opens a DSF file and parses its metadata.
   * @param stream The I/O stream to read from.
   * @param readProperties Whether to parse audio properties (default `true`).
   * @param readStyle Accuracy / speed trade-off for property reading.
   * @returns A fully initialised {@link DsfFile} instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<DsfFile> {
    const f = new DsfFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /** Quick-check whether `stream` looks like a valid DSF file. */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const id = await stream.readBlock(4);
    if (id.length < 4) return false;

    const dsd = ByteVector.fromString("DSD ", StringType.Latin1);
    return id.startsWith(dsd);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the ID3v2 tag for this file, or `null` if none exists.
   * @returns The {@link Id3v2Tag} or `null`.
   */
  tag(): Tag | null {
    return this._tag;
  }

  /**
   * Returns the parsed audio properties, or `null` if properties were not read.
   * @returns The {@link DsfProperties} or `null`.
   */
  audioProperties(): DsfProperties | null {
    return this._properties;
  }

  /**
   * Writes all pending tag changes back to the underlying stream.
   * @returns `true` on success, `false` if the file is read-only or has no tag.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;
    if (!this._tag) return false;

    if (this._tag.isEmpty) {
      const newFileSize = this._metadataOffset
        ? this._metadataOffset
        : this._fileSize;

      // Update file size in DSD chunk header
      if (this._fileSize !== newFileSize) {
        await this.insert(
          ByteVector.fromLongLong(BigInt(newFileSize), false),
          12,
          8,
        );
        this._fileSize = newFileSize;
      }

      // Clear metadata offset (no tag)
      if (this._metadataOffset) {
        await this.insert(ByteVector.fromLongLong(0n, false), 20, 8);
        this._metadataOffset = 0;
      }

      // Truncate file to remove old tag
      await this.truncate(newFileSize);
    } else {
      const tagData = this._tag.render();

      const newMetadataOffset = this._metadataOffset
        ? this._metadataOffset
        : this._fileSize;
      const newFileSize = newMetadataOffset + tagData.length;
      const oldTagSize = this._fileSize - newMetadataOffset;

      // Update file size
      if (this._fileSize !== newFileSize) {
        await this.insert(
          ByteVector.fromLongLong(BigInt(newFileSize), false),
          12,
          8,
        );
        this._fileSize = newFileSize;
      }

      // Update metadata offset
      if (this._metadataOffset !== newMetadataOffset) {
        await this.insert(
          ByteVector.fromLongLong(BigInt(newMetadataOffset), false),
          20,
          8,
        );
        this._metadataOffset = newMetadataOffset;
      }

      // Write the tag
      await this.insert(tagData, newMetadataOffset, oldTagSize);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads and validates the DSF chunk structure from the stream, then populates
   * audio properties and the ID3v2 tag.
   * @param readProperties Whether to parse the "fmt " chunk as audio properties.
   * @param readStyle Accuracy / speed trade-off hint.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // DSD chunk
    await this.seek(0);
    const chunkName = await this.readBlock(4);
    const dsd = ByteVector.fromString("DSD ", StringType.Latin1);
    if (!chunkName.startsWith(dsd)) {
      this._valid = false;
      return;
    }

    const dsdHeaderSizeData = await this.readBlock(8);
    const dsdHeaderSize = Number(dsdHeaderSizeData.toLongLong(false));
    if (dsdHeaderSize !== 28) {
      this._valid = false;
      return;
    }

    this._fileSize = Number((await this.readBlock(8)).toLongLong(false));
    if (this._fileSize > (await this.fileLength())) {
      this._valid = false;
      return;
    }

    this._metadataOffset = Number((await this.readBlock(8)).toLongLong(false));
    if (this._metadataOffset > this._fileSize) {
      this._valid = false;
      return;
    }

    // fmt chunk
    const fmtName = await this.readBlock(4);
    const fmt = ByteVector.fromString("fmt ", StringType.Latin1);
    if (!fmtName.startsWith(fmt)) {
      this._valid = false;
      return;
    }

    const fmtHeaderSize = Number((await this.readBlock(8)).toLongLong(false));
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
      this._properties = new DsfProperties(await this.readBlock(fmtHeaderSize), readStyle);
    } else {
      this._properties = null;
    }

    // ID3v2 tag
    if (this._metadataOffset === 0) {
      this._tag = new Id3v2Tag();
    } else {
      this._tag = await Id3v2Tag.readFrom(this._stream, this._metadataOffset);
    }
  }
}
