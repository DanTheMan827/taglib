import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { type offset_t, Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ID3v1Tag } from "../mpeg/id3v1/id3v1Tag.js";
import { Id3v2Header } from "../mpeg/id3v2/id3v2Header.js";
import { ApeTag, ApeFooter } from "../ape/apeTag.js";
import { ApeProperties } from "./apeProperties.js";

// =============================================================================
// Enums
// =============================================================================

export enum ApeFileTagTypes {
  NoTags = 0x0000,
  ID3v1 = 0x0001,
  ID3v2 = 0x0002,
  APE = 0x0004,
  AllTags = 0xffff,
}

// =============================================================================
// ApeFile
// =============================================================================

/**
 * Monkey's Audio (APE) file format handler.
 *
 * Supports APE (primary) and ID3v1 (secondary) tags.  ID3v2 tags are
 * detected and skipped but not parsed — they are invalid in APE files.
 */
export class ApeFile extends File {
  private _apeTag: ApeTag | null = null;
  private _id3v1Tag: ID3v1Tag | null = null;
  private _combinedTag: CombinedTag;
  private _properties: ApeProperties | null = null;

  private _apeLocation: offset_t = -1;
  private _apeOriginalSize: number = 0;

  private _id3v1Location: offset_t = -1;

  private _id3v2Location: offset_t = -1;
  private _id3v2Size: number = 0;
  private _hasId3v2: boolean = false;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
    if (this.isOpen) {
      this.read(readProperties, readStyle);
    }
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid APE file.
   * Looks for "MAC " signature, skipping an optional ID3v2 header.
   */
  static isSupported(stream: IOStream): boolean {
    stream.seek(0);
    const buf = stream.readBlock(File.bufferSize());
    if (buf.length < 4) return false;

    // Skip ID3v2 tag if present
    let searchData = buf;
    if (buf.startsWith(Id3v2Header.fileIdentifier)) {
      if (buf.length < Id3v2Header.size) return false;
      const id3Header = Id3v2Header.parse(buf);
      if (!id3Header) return false;
      stream.seek(id3Header.completeTagSize);
      searchData = stream.readBlock(File.bufferSize());
      if (searchData.length < 4) return false;
    }

    const mac = ByteVector.fromString("MAC ", StringType.Latin1);
    return searchData.find(mac) >= 0;
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._combinedTag;
  }

  audioProperties(): ApeProperties | null {
    return this._properties;
  }

  save(): boolean {
    if (this.readOnly) return false;

    // -- ID3v1 --
    const id3v1 = this.id3v1Tag();
    if (id3v1 && !id3v1.isEmpty) {
      if (this._id3v1Location >= 0) {
        this.seek(this._id3v1Location);
      } else {
        this.seek(0, Position.End);
        this._id3v1Location = this.tell();
      }
      this.writeBlock(id3v1.render());
    } else if (this._id3v1Location >= 0) {
      this.truncate(this._id3v1Location);
      this._id3v1Location = -1;
    }

    // -- APE --
    const ape = this.apeTag();
    if (ape && !ape.isEmpty) {
      if (this._apeLocation < 0) {
        this._apeLocation =
          this._id3v1Location >= 0 ? this._id3v1Location : this.fileLength;
      }
      const data = ape.render();
      this.insert(data, this._apeLocation, this._apeOriginalSize);

      if (this._id3v1Location >= 0) {
        this._id3v1Location += data.length - this._apeOriginalSize;
      }
      this._apeOriginalSize = data.length;
    } else if (this._apeLocation >= 0) {
      this.removeBlock(this._apeLocation, this._apeOriginalSize);
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
  strip(tags: ApeFileTagTypes = ApeFileTagTypes.AllTags): void {
    if (tags & ApeFileTagTypes.ID3v1) {
      this._id3v1Tag = null;
    }

    if (tags & ApeFileTagTypes.APE) {
      this._apeTag = null;
    }

    if (!this._id3v1Tag) {
      this.apeTag(true);
    }

    if (tags & ApeFileTagTypes.ID3v2) {
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

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // 1. Detect & skip ID3v2 (invalid in APE but tolerated)
    this.findID3v2();

    // 2. Find ID3v1
    this.findID3v1();

    // 3. Find APE tag
    this.findAPE();

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
        streamLength = this.fileLength;
      }

      if (this._id3v2Location >= 0) {
        this.seek(this._id3v2Location + this._id3v2Size);
        streamLength -= this._id3v2Location + this._id3v2Size;
      } else {
        this.seek(0);
      }

      this._properties = new ApeProperties(this, streamLength, readStyle);
    }
  }

  private findID3v2(): void {
    this.seek(0);
    const headerData = this.readBlock(Id3v2Header.size);
    if (headerData.length < Id3v2Header.size) return;
    if (!headerData.startsWith(Id3v2Header.fileIdentifier)) return;

    const header = Id3v2Header.parse(headerData);
    if (!header) return;

    this._id3v2Location = 0;
    this._id3v2Size = header.completeTagSize;
    this._hasId3v2 = true;
  }

  private findID3v1(): void {
    if (this.fileLength < 128) return;

    const tagOffset = this.fileLength - 128;
    this.seek(tagOffset);
    const data = this.readBlock(3);
    if (data.length < 3) return;
    if (!data.startsWith(ID3v1Tag.fileIdentifier())) return;

    this._id3v1Location = tagOffset;
    this._id3v1Tag = ID3v1Tag.readFrom(this._stream, tagOffset);
  }

  private findAPE(): void {
    const searchEnd: offset_t =
      this._id3v1Location >= 0 ? this._id3v1Location : this.fileLength;

    if (searchEnd < ApeFooter.SIZE) return;

    const footerOffset = searchEnd - ApeFooter.SIZE;
    this.seek(footerOffset);
    const footerData = this.readBlock(ApeFooter.SIZE);
    if (footerData.length < ApeFooter.SIZE) return;

    const magic = ByteVector.fromString("APETAGEX", StringType.Latin1);
    if (!footerData.startsWith(magic)) return;

    const footer = ApeFooter.parse(footerData);
    if (!footer) return;

    this._apeLocation = footerOffset + ApeFooter.SIZE - footer.completeTagSize;
    this._apeOriginalSize = footer.completeTagSize;
    this._apeTag = ApeTag.readFrom(this._stream, footerOffset);
  }

  private refreshCombinedTag(): void {
    // Priority: APE > ID3v1
    this._combinedTag.setTags([this._apeTag, this._id3v1Tag]);
  }
}
