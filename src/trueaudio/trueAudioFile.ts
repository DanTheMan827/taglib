/** @file TrueAudio (TTA) file format handler. Supports ID3v1 and ID3v2 tags. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { type offset_t, Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ID3v1Tag } from "../mpeg/id3v1/id3v1Tag.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";
import { Id3v2Header } from "../mpeg/id3v2/id3v2Header.js";
import { TrueAudioProperties, TTA_HEADER_SIZE } from "./trueAudioProperties.js";

// =============================================================================
// Enums
// =============================================================================

/** Bitmask of tag types present in or to be applied to a TrueAudio file. */
export enum TrueAudioTagTypes {
  /** No tags. */
  NoTags = 0x0000,
  /** ID3v1 tag appended at the end of the file. */
  ID3v1 = 0x0001,
  /** ID3v2 tag prepended at the start of the file. */
  ID3v2 = 0x0002,
  /** All supported tag types. */
  AllTags = 0xffff,
}

// =============================================================================
// TrueAudioFile
// =============================================================================

/**
 * TrueAudio (TTA) file format handler.
 *
 * Supports ID3v2 (primary) and ID3v1 (secondary) tags.
 */
export class TrueAudioFile extends File {
  /** The ID3v2 tag read from or to be written to the file, or `null` if absent. */
  private _id3v2Tag: Id3v2Tag | null = null;
  /** The ID3v1 tag read from or to be written to the file, or `null` if absent. */
  private _id3v1Tag: ID3v1Tag | null = null;
  /** Priority-ordered combined view of all tags (ID3v2 preferred over ID3v1). */
  private _combinedTag: CombinedTag;
  /** Parsed audio properties, or `null` if not yet read. */
  private _properties: TrueAudioProperties | null = null;

  /** Byte offset of the ID3v2 tag in the file, or `-1` if absent. */
  private _id3v2Location: offset_t = -1;
  /** Original byte size of the ID3v2 tag on disk (used for in-place replacement). */
  private _id3v2OriginalSize: number = 0;

  /** Byte offset of the ID3v1 tag in the file, or `-1` if absent. */
  private _id3v1Location: offset_t = -1;

  /**
   * Private constructor — use {@link TrueAudioFile.open} to create instances.
   * @param stream - The underlying I/O stream for the TTA file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Open and parse a TrueAudio file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `TrueAudioFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<TrueAudioFile> {
    const f = new TrueAudioFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid TrueAudio file.
   * A TTA file starts with "TTA"; an ID3v2 tag may precede the signature.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    let headerData = await stream.readBlock(4);
    if (headerData.length < 3) return false;

    // Skip ID3v2 tag if present
    if (headerData.startsWith(Id3v2Header.fileIdentifier)) {
      if (headerData.length < Id3v2Header.size) {
        const rest = await stream.readBlock(Id3v2Header.size - headerData.length);
        const full = ByteVector.fromByteVector(headerData);
        full.append(rest);
        headerData = full;
      } else {
        // Re-read full header
        await stream.seek(0);
        headerData = await stream.readBlock(Id3v2Header.size);
      }
      const id3Header = Id3v2Header.parse(headerData);
      if (!id3Header) return false;
      await stream.seek(id3Header.completeTagSize);
      headerData = await stream.readBlock(3);
      if (headerData.length < 3) return false;
    }

    const tta = ByteVector.fromString("TTA", StringType.Latin1);
    return headerData.startsWith(tta);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag providing unified access to all tag data.
   * @returns The {@link CombinedTag} for this file (ID3v2 preferred over ID3v1).
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the audio properties parsed from the TTA header.
   * @returns The {@link TrueAudioProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): TrueAudioProperties | null {
    return this._properties;
  }

  /**
   * Writes all pending tag changes to the file.
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // -- ID3v2 --
    const id3v2 = this.id3v2Tag();
    if (id3v2 && !id3v2.isEmpty) {
      if (this._id3v2Location < 0) {
        this._id3v2Location = 0;
      }

      const data = id3v2.render();
      await this.insert(data, this._id3v2Location, this._id3v2OriginalSize);

      if (this._id3v1Location >= 0) {
        this._id3v1Location += data.length - this._id3v2OriginalSize;
      }
      this._id3v2OriginalSize = data.length;
    } else if (this._id3v2Location >= 0) {
      await this.removeBlock(this._id3v2Location, this._id3v2OriginalSize);

      if (this._id3v1Location >= 0) {
        this._id3v1Location -= this._id3v2OriginalSize;
      }
      this._id3v2Location = -1;
      this._id3v2OriginalSize = 0;
    }

    // -- ID3v1 --
    const id3v1 = this.id3v1Tag();
    if (id3v1 && !id3v1.isEmpty) {
      if (this._id3v1Location >= 0) {
        await this.seek(this._id3v1Location);
      } else {
        await this.seek(0, Position.End);
        this._id3v1Location = (await this.tell());
      }
      await this.writeBlock(id3v1.render());
    } else if (this._id3v1Location >= 0) {
      await this.truncate(this._id3v1Location);
      this._id3v1Location = -1;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors (lazy-create)
  // ---------------------------------------------------------------------------

  /**
   * Get the ID3v2 tag, optionally creating one if absent.
   * @param create - When `true`, a new empty tag is created if none exists.
   * @returns The {@link Id3v2Tag}, or `null` if absent and `create` is `false`.
   */
  id3v2Tag(create?: boolean): Id3v2Tag | null {
    if (!this._id3v2Tag && create) {
      this._id3v2Tag = new Id3v2Tag();
      this.refreshCombinedTag();
    }
    return this._id3v2Tag;
  }

  /**
   * Get the ID3v1 tag, optionally creating one if absent.
   * @param create - When `true`, a new empty tag is created if none exists.
   * @returns The {@link ID3v1Tag}, or `null` if absent and `create` is `false`.
   */
  id3v1Tag(create?: boolean): ID3v1Tag | null {
    if (!this._id3v1Tag && create) {
      this._id3v1Tag = new ID3v1Tag();
      this.refreshCombinedTag();
    }
    return this._id3v1Tag;
  }

  // ---------------------------------------------------------------------------
  // Tag management
  // ---------------------------------------------------------------------------

  /**
   * Remove the specified tag types from the in-memory representation.
   * Call `save()` afterwards to persist the changes to disk.
   * @param tags - Bitmask of tag types to remove. Defaults to {@link TrueAudioTagTypes.AllTags}.
   */
  strip(tags: TrueAudioTagTypes = TrueAudioTagTypes.AllTags): void {
    if (tags & TrueAudioTagTypes.ID3v1) {
      this._id3v1Tag = null;
    }

    if (tags & TrueAudioTagTypes.ID3v2) {
      this._id3v2Tag = null;
    }

    if (!this._id3v1Tag) {
      this.id3v2Tag(true);
    }

    this.refreshCombinedTag();
  }

  /** Whether the file on disk has an ID3v1 tag. */
  get hasID3v1Tag(): boolean {
    return this._id3v1Location >= 0;
  }

  /** Whether the file on disk has an ID3v2 tag. */
  get hasID3v2Tag(): boolean {
    return this._id3v2Location >= 0;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads all tags and (optionally) audio properties from the file.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // 1. Find ID3v2
    await this.findID3v2();

    // 2. Find ID3v1
    await this.findID3v1();

    // If no ID3v1 tag exists, ensure we have an ID3v2 tag
    if (this._id3v1Location < 0) {
      this.id3v2Tag(true);
    }

    // Build combined tag (priority: ID3v2 > ID3v1)
    this.refreshCombinedTag();

    // 3. Audio properties
    if (readProperties) {
      let streamLength: offset_t;

      if (this._id3v1Location >= 0) {
        streamLength = this._id3v1Location;
      } else {
        streamLength = (await this.fileLength());
      }

      if (this._id3v2Location >= 0) {
        await this.seek(this._id3v2Location + this._id3v2OriginalSize);
        streamLength -= this._id3v2Location + this._id3v2OriginalSize;
      } else {
        await this.seek(0);
      }

      this._properties = new TrueAudioProperties(
        await this.readBlock(TTA_HEADER_SIZE),
        streamLength,
        readStyle,
      );
    }
  }

  /**
   * Searches the start of the file for an ID3v2 tag and, if found,
   * populates {@link _id3v2Location}, {@link _id3v2OriginalSize}, and {@link _id3v2Tag}.
   */
  private async findID3v2(): Promise<void> {
    await this.seek(0);
    const headerData = await this.readBlock(Id3v2Header.size);
    if (headerData.length < Id3v2Header.size) return;
    if (!headerData.startsWith(Id3v2Header.fileIdentifier)) return;

    const header = Id3v2Header.parse(headerData);
    if (!header) return;

    this._id3v2Location = 0;
    this._id3v2OriginalSize = header.completeTagSize;
    this._id3v2Tag = await Id3v2Tag.readFrom(this._stream, this._id3v2Location);
  }

  /**
   * Searches the end of the file for an ID3v1 tag and, if found,
   * populates {@link _id3v1Location} and {@link _id3v1Tag}.
   */
  private async findID3v1(): Promise<void> {
    if ((await this.fileLength()) < 128) return;

    const tagOffset = (await this.fileLength()) - 128;
    await this.seek(tagOffset);
    const data = await this.readBlock(3);
    if (data.length < 3) return;
    if (!data.startsWith(ID3v1Tag.fileIdentifier())) return;

    this._id3v1Location = tagOffset;
    this._id3v1Tag = await ID3v1Tag.readFrom(this._stream, tagOffset);
  }

  /**
   * Rebuilds {@link _combinedTag} from the currently active tag objects,
   * ordered by priority (ID3v2 before ID3v1).
   */
  private refreshCombinedTag(): void {
    // Priority: ID3v2 > ID3v1
    this._combinedTag.setTags([this._id3v2Tag, this._id3v1Tag]);
  }
}
