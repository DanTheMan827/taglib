/** @file Musepack (MPC) file format handler. Supports ID3v1, ID3v2 detection, and APE tags. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { type offset_t, Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ID3v1Tag } from "../mpeg/id3v1/id3v1Tag.js";
import { Id3v2Header } from "../mpeg/id3v2/id3v2Header.js";
import { ApeTag, ApeFooter } from "../ape/apeTag.js";
import { MpcProperties } from "./mpcProperties.js";

// =============================================================================
// Enums
// =============================================================================

/** Bitmask of tag types present in or to be applied to an MPC file. */
export enum MpcTagTypes {
  /** No tags. */
  NoTags = 0x0000,
  /** ID3v1 tag. */
  ID3v1 = 0x0001,
  /** ID3v2 tag (detected and stripped; invalid in MPC). */
  ID3v2 = 0x0002,
  /** APE tag. */
  APE = 0x0004,
  /** All supported tag types. */
  AllTags = 0xffff,
}

// =============================================================================
// MpcFile
// =============================================================================

/**
 * Musepack (MPC) file format handler.
 *
 * Supports APE (primary) and ID3v1 (secondary) tags.  ID3v2 tags are
 * detected and skipped but not parsed — they are invalid in MPC files.
 */
export class MpcFile extends File {
  /** The APE tag read from or to be written to the file, or `null` if absent. */
  private _apeTag: ApeTag | null = null;
  /** The ID3v1 tag read from or to be written to the file, or `null` if absent. */
  private _id3v1Tag: ID3v1Tag | null = null;
  /** Priority-ordered combined view of all tags (APE preferred over ID3v1). */
  private _combinedTag: CombinedTag;
  /** Parsed audio properties, or `null` if not yet read. */
  private _properties: MpcProperties | null = null;

  /** Byte offset of the APE tag in the file, or `-1` if absent. */
  private _apeLocation: offset_t = -1;
  /** Original byte size of the APE tag on disk (used for in-place replacement). */
  private _apeOriginalSize: number = 0;

  /** Byte offset of the ID3v1 tag in the file, or `-1` if absent. */
  private _id3v1Location: offset_t = -1;

  /** Byte offset of the ID3v2 tag in the file, or `-1` if absent. */
  private _id3v2Location: offset_t = -1;
  /** Byte size of the ID3v2 tag on disk. */
  private _id3v2Size: number = 0;
  /** Whether an ID3v2 tag was found on disk (it will be stripped on save). */
  private _hasId3v2: boolean = false;

  /**
   * Private constructor — use {@link MpcFile.open} to create instances.
   * @param stream - The underlying I/O stream for the MPC file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Open and parse an MPC file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `MpcFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<MpcFile> {
    const f = new MpcFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid MPC file.
   * Skips a leading ID3v2 tag if present.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    let headerData = await stream.readBlock(4);
    if (headerData.length < 4) return false;

    // Skip ID3v2 tag if present
    if (headerData.startsWith(Id3v2Header.fileIdentifier)) {
      const fullHeader = await stream.readBlock(Id3v2Header.size);
      if (fullHeader.length < Id3v2Header.size) return false;
      // Re-read from position 0 to parse the ID3v2 header
      await stream.seek(0);
      const id3Data = await stream.readBlock(Id3v2Header.size);
      const id3Header = Id3v2Header.parse(id3Data);
      if (!id3Header) return false;
      await stream.seek(id3Header.completeTagSize);
      headerData = await stream.readBlock(4);
      if (headerData.length < 4) return false;
    }

    const mpck = ByteVector.fromString("MPCK", StringType.Latin1);
    const mpPlus = ByteVector.fromString("MP+", StringType.Latin1);
    return headerData.startsWith(mpck) || headerData.startsWith(mpPlus);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag providing unified access to all tag data.
   * @returns The {@link CombinedTag} for this file.
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the audio properties parsed from the MPC stream.
   * @returns The {@link MpcProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): MpcProperties | null {
    return this._properties;
  }

  /**
   * Writes all pending tag changes to the file.
   * Any ID3v2 tag found on disk is automatically removed (it is invalid in MPC).
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // Strip ID3v2 if it was found on disk (ID3v2 is invalid in MPC)
    if (this._hasId3v2 && this._id3v2Location >= 0) {
      await this.removeBlock(this._id3v2Location, this._id3v2Size);

      if (this._apeLocation >= 0) this._apeLocation -= this._id3v2Size;
      if (this._id3v1Location >= 0) this._id3v1Location -= this._id3v2Size;

      this._id3v2Location = -1;
      this._id3v2Size = 0;
      this._hasId3v2 = false;
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

    // -- APE --
    const ape = this.apeTag();
    if (ape && !ape.isEmpty) {
      if (this._apeLocation < 0) {
        this._apeLocation =
          this._id3v1Location >= 0 ? this._id3v1Location : (await this.fileLength());
      }
      const data = ape.render();
      await this.insert(data, this._apeLocation, this._apeOriginalSize);

      if (this._id3v1Location >= 0) {
        this._id3v1Location += data.length - this._apeOriginalSize;
      }
      this._apeOriginalSize = data.length;
    } else if (this._apeLocation >= 0) {
      await this.removeBlock(this._apeLocation, this._apeOriginalSize);
      if (this._id3v1Location >= 0) {
        this._id3v1Location -= this._apeOriginalSize;
      }
      this._apeLocation = -1;
      this._apeOriginalSize = 0;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors (lazy-create)
  // ---------------------------------------------------------------------------

  /** Get the ID3v1 tag, optionally creating one if absent. */
  id3v1Tag(create?: boolean): ID3v1Tag | null {
    if (!this._id3v1Tag && create) {
      this._id3v1Tag = new ID3v1Tag();
      this.refreshCombinedTag();
    }
    return this._id3v1Tag;
  }

  /** Get the APE tag, optionally creating one if absent. */
  apeTag(create?: boolean): ApeTag | null {
    if (!this._apeTag && create) {
      this._apeTag = new ApeTag();
      this.refreshCombinedTag();
    }
    return this._apeTag;
  }

  // ---------------------------------------------------------------------------
  // Tag management
  // ---------------------------------------------------------------------------

  /**
   * Remove the specified tag types from the in-memory representation.
   * Call `save()` afterwards to persist the changes to disk.
   */
  strip(tags: MpcTagTypes = MpcTagTypes.AllTags): void {
    if (tags & MpcTagTypes.ID3v1) {
      this._id3v1Tag = null;
    }

    if (tags & MpcTagTypes.APE) {
      this._apeTag = null;
    }

    // Ensure at least an APE tag exists when ID3v1 is removed
    if (!this._id3v1Tag) {
      this.apeTag(true);
    }

    if (tags & MpcTagTypes.ID3v2) {
      this._hasId3v2 = false;
    }

    this.refreshCombinedTag();
  }

  /** Whether the file on disk has an ID3v1 tag. */
  get hasID3v1Tag(): boolean {
    return this._id3v1Location >= 0;
  }

  /** Whether the file on disk has an APE tag. */
  get hasAPETag(): boolean {
    return this._apeLocation >= 0;
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
    // 1. Detect & skip ID3v2 (invalid in MPC but tolerated)
    await this.findID3v2();

    // 2. Find ID3v1
    await this.findID3v1();

    // 3. Find APE
    await this.findAPE();

    // If no ID3v1 tag exists, ensure we have an APE tag
    if (this._id3v1Location < 0) {
      this.apeTag(true);
    }

    // Build combined tag (priority: APE > ID3v1)
    this.refreshCombinedTag();

    // 4. Audio properties
    if (readProperties) {
      let streamLength: offset_t;

      if (this._apeLocation >= 0) {
        streamLength = this._apeLocation;
      } else if (this._id3v1Location >= 0) {
        streamLength = this._id3v1Location;
      } else {
        streamLength = (await this.fileLength());
      }

      if (this._id3v2Location >= 0) {
        await this.seek(this._id3v2Location + this._id3v2Size);
        streamLength -= this._id3v2Location + this._id3v2Size;
      } else {
        await this.seek(0);
      }

      this._properties = await MpcProperties.create(this, streamLength, readStyle);
    }
  }

  /**
   * Detects an ID3v2 tag at the start of the file and records its location and size.
   * The tag content is not parsed — ID3v2 is invalid in MPC and will be removed on save.
   */
  private async findID3v2(): Promise<void> {
    await this.seek(0);
    const headerData = await this.readBlock(Id3v2Header.size);
    if (headerData.length < Id3v2Header.size) return;
    if (!headerData.startsWith(Id3v2Header.fileIdentifier)) return;

    const header = Id3v2Header.parse(headerData);
    if (!header) return;

    this._id3v2Location = 0;
    this._id3v2Size = header.completeTagSize;
    this._hasId3v2 = true;
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
   * Searches for an APE tag footer immediately before the ID3v1 tag (or end of file)
   * and, if found, populates {@link _apeLocation}, {@link _apeOriginalSize}, and {@link _apeTag}.
   */
  private async findAPE(): Promise<void> {
    const searchEnd: offset_t =
      this._id3v1Location >= 0 ? this._id3v1Location : (await this.fileLength());

    if (searchEnd < ApeFooter.SIZE) return;

    const footerOffset = searchEnd - ApeFooter.SIZE;
    await this.seek(footerOffset);
    const footerData = await this.readBlock(ApeFooter.SIZE);
    if (footerData.length < ApeFooter.SIZE) return;

    const magic = ByteVector.fromString("APETAGEX", StringType.Latin1);
    if (!footerData.startsWith(magic)) return;

    const footer = ApeFooter.parse(footerData);
    if (!footer) return;

    this._apeLocation = footerOffset + ApeFooter.SIZE - footer.completeTagSize;
    this._apeOriginalSize = footer.completeTagSize;
    this._apeTag = await ApeTag.readFrom(this._stream, footerOffset);
  }

  /**
   * Rebuilds {@link _combinedTag} from the currently active tag objects,
   * ordered by priority (APE before ID3v1).
   */
  private refreshCombinedTag(): void {
    // Priority: APE > ID3v1
    this._combinedTag.setTags([this._apeTag, this._id3v1Tag]);
  }
}
