import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { type offset_t, Position, ReadStyle, StripTags } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { ID3v1Tag } from "./id3v1/id3v1Tag.js";
import { Id3v2Tag } from "./id3v2/id3v2Tag.js";
import { Id3v2Header } from "./id3v2/id3v2Header.js";
import { ApeTag, ApeFooter } from "../ape/apeTag.js";
import { MpegHeader } from "./mpegHeader.js";
import { MpegProperties } from "./mpegProperties.js";

// =============================================================================
// Enums
// =============================================================================

export enum MpegTagTypes {
  NoTags = 0x0000,
  ID3v1 = 0x0001,
  ID3v2 = 0x0002,
  APE = 0x0004,
  AllTags = 0xffff,
}

// =============================================================================
// MpegFile
// =============================================================================

/**
 * MPEG (MP3) file format handler.
 *
 * Supports ID3v1, ID3v2 and APE tags as well as MPEG / ADTS audio
 * property reading.
 */
export class MpegFile extends File {
  private _id3v2Tag: Id3v2Tag | null = null;
  private _id3v1Tag: ID3v1Tag | null = null;
  private _apeTag: ApeTag | null = null;
  private _combinedTag: CombinedTag;
  private _properties: MpegProperties | null = null;

  // Bookkeeping for tag locations / sizes (needed by save / strip)
  private _id3v2Location: offset_t = -1;
  private _id3v2OriginalSize: number = 0;
  private _id3v1Location: offset_t = -1;
  private _apeLocation: offset_t = -1;
  private _apeOriginalSize: number = 0;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
    this.read(readProperties, readStyle);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._combinedTag;
  }

  audioProperties(): MpegProperties | null {
    return this._properties;
  }

  save(
    tags: MpegTagTypes = MpegTagTypes.AllTags,
    stripTags: StripTags = StripTags.StripOthers,
  ): boolean {
    if (this.readOnly) return false;

    // Copy metadata between tag formats so both stay in sync.
    // Skip duplication when the source tag is about to be stripped.
    if ((tags & MpegTagTypes.ID3v2) && this._id3v1Tag &&
        (stripTags !== StripTags.StripOthers || (tags & MpegTagTypes.ID3v1))) {
      Tag.duplicate(this._id3v1Tag, this.id3v2Tag(true)!, false);
    }
    if ((tags & MpegTagTypes.ID3v1) && this._id3v2Tag &&
        (stripTags !== StripTags.StripOthers || (tags & MpegTagTypes.ID3v2))) {
      Tag.duplicate(this._id3v2Tag, this.id3v1Tag(true)!, false);
    }

    // Strip tags not in the save mask
    if (stripTags === StripTags.StripOthers) {
      this.strip(~tags & MpegTagTypes.AllTags);
    }

    // -- ID3v2 --
    if (tags & MpegTagTypes.ID3v2) {
      if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
        if (this._id3v2Location < 0) this._id3v2Location = 0;
        const data = this._id3v2Tag.render();
        this.insert(data, this._id3v2Location, this._id3v2OriginalSize);
        const sizeDelta = data.length - this._id3v2OriginalSize;
        if (this._apeLocation >= 0) this._apeLocation += sizeDelta;
        if (this._id3v1Location >= 0) this._id3v1Location += sizeDelta;
        this._id3v2OriginalSize = data.length;
      } else {
        this.strip(MpegTagTypes.ID3v2);
      }
    }

    // -- ID3v1 --
    if (tags & MpegTagTypes.ID3v1) {
      if (this._id3v1Tag && !this._id3v1Tag.isEmpty) {
        if (this._id3v1Location >= 0) {
          this.seek(this._id3v1Location);
        } else {
          this.seek(0, Position.End);
          this._id3v1Location = this.tell();
        }
        this.writeBlock(this._id3v1Tag.render());
      } else {
        this.strip(MpegTagTypes.ID3v1);
      }
    }

    // -- APE --
    if (tags & MpegTagTypes.APE) {
      if (this._apeTag && !this._apeTag.isEmpty) {
        if (this._apeLocation < 0) {
          this._apeLocation =
            this._id3v1Location >= 0 ? this._id3v1Location : this.fileLength;
        }
        const data = this._apeTag.render();
        this.insert(data, this._apeLocation, this._apeOriginalSize);
        const sizeDelta = data.length - this._apeOriginalSize;
        if (this._id3v1Location >= 0) this._id3v1Location += sizeDelta;
        this._apeOriginalSize = data.length;
      } else {
        this.strip(MpegTagTypes.APE);
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors (lazy-create overloads)
  // ---------------------------------------------------------------------------

  /** Get the ID3v1 tag, optionally creating one if absent. */
  id3v1Tag(create?: boolean): ID3v1Tag | null {
    if (!this._id3v1Tag && create) {
      this._id3v1Tag = new ID3v1Tag();
      this.refreshCombinedTag();
    }
    return this._id3v1Tag;
  }

  /** Get the ID3v2 tag, optionally creating one if absent. */
  id3v2Tag(create?: boolean): Id3v2Tag | null {
    if (!this._id3v2Tag && create) {
      this._id3v2Tag = new Id3v2Tag();
      this.refreshCombinedTag();
    }
    return this._id3v2Tag;
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
  // Frame scanning
  // ---------------------------------------------------------------------------

  firstFrameOffset(): offset_t {
    let position: offset_t = 0;
    if (this._id3v2Tag) {
      position = this._id3v2Location + this._id3v2OriginalSize;
    }
    return this.nextFrameOffset(position);
  }

  lastFrameOffset(): offset_t {
    let position: offset_t;
    if (this._apeTag && this._apeLocation >= 0) {
      position = this._apeLocation - 1;
    } else if (this._id3v1Tag && this._id3v1Location >= 0) {
      position = this._id3v1Location - 1;
    } else {
      position = this.fileLength;
    }
    return this.previousFrameOffset(position);
  }

  nextFrameOffset(position: offset_t): offset_t {
    const bufSize = File.bufferSize();
    let prevByte = -1;

    while (position < this.fileLength) {
      this.seek(position);
      const buffer = this.readBlock(bufSize);
      if (buffer.isEmpty) return -1;

      for (let i = 0; i < buffer.length; i++) {
        const curByte = buffer.get(i);

        if (prevByte === 0xff && curByte !== 0xff && (curByte & 0xe0) === 0xe0) {
          const frameOffset = position + i - 1;
          const header = new MpegHeader(this._stream, frameOffset, true);
          if (header.isValid) return frameOffset;
        }

        prevByte = curByte;
      }

      position += buffer.length;
    }

    return -1;
  }

  previousFrameOffset(position: offset_t): offset_t {
    const bufSize = File.bufferSize();
    let nextByte = -1;

    while (position > 0) {
      const readLength = Math.min(position, bufSize);
      position -= readLength;

      this.seek(position);
      const buffer = this.readBlock(readLength);
      if (buffer.isEmpty) return -1;

      for (let i = buffer.length - 1; i >= 0; i--) {
        const curByte = buffer.get(i);

        if (curByte === 0xff && nextByte !== -1 &&
            nextByte !== 0xff && (nextByte & 0xe0) === 0xe0) {
          const frameOffset = position + i;
          const header = new MpegHeader(this._stream, frameOffset, true);
          if (header.isValid) return frameOffset;
        }

        nextByte = curByte;
      }
    }

    return -1;
  }

  strip(tags: MpegTagTypes = MpegTagTypes.AllTags): void {
    if ((tags & MpegTagTypes.ID3v2) && this._id3v2Tag) {
      if (this._id3v2Location >= 0 && this._id3v2OriginalSize > 0) {
        this.removeBlock(this._id3v2Location, this._id3v2OriginalSize);
        if (this._apeLocation >= 0) this._apeLocation -= this._id3v2OriginalSize;
        if (this._id3v1Location >= 0) this._id3v1Location -= this._id3v2OriginalSize;
      }
      this._id3v2Tag = null;
      this._id3v2Location = -1;
      this._id3v2OriginalSize = 0;
    }

    if ((tags & MpegTagTypes.APE) && this._apeTag) {
      if (this._apeLocation >= 0 && this._apeOriginalSize > 0) {
        this.removeBlock(this._apeLocation, this._apeOriginalSize);
        if (this._id3v1Location >= 0) this._id3v1Location -= this._apeOriginalSize;
      }
      this._apeTag = null;
      this._apeLocation = -1;
      this._apeOriginalSize = 0;
    }

    if ((tags & MpegTagTypes.ID3v1) && this._id3v1Tag) {
      if (this._id3v1Location >= 0) {
        this.truncate(this._id3v1Location);
      }
      this._id3v1Tag = null;
      this._id3v1Location = -1;
    }

    this.refreshCombinedTag();
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // 1. Find & parse ID3v2
    this.findID3v2();

    // 2. Find & parse ID3v1
    this.findID3v1();

    // 3. Find & parse APE
    this.findAPE();

    // 4. Audio properties
    if (readProperties) {
      this._properties = new MpegProperties(this, readStyle);
    }

    // Make sure that we have our default tag types available.
    this.id3v2Tag(true);
    this.id3v1Tag(true);

    // Build combined tag (priority: ID3v2 > APE > ID3v1)
    this.refreshCombinedTag();
  }

  private findID3v2(): void {
    this.seek(0);
    const headerData = this.readBlock(Id3v2Header.size);
    if (headerData.length < Id3v2Header.size) return;

    if (!headerData.startsWith(Id3v2Header.fileIdentifier)) return;

    const header = Id3v2Header.parse(headerData);
    if (!header) return;

    this._id3v2Location = 0;
    this._id3v2OriginalSize = header.completeTagSize;
    this._id3v2Tag = Id3v2Tag.readFrom(this._stream, 0);
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
    // APE tag is located before ID3v1 (or at end of file)
    let searchEnd: offset_t;
    if (this._id3v1Location >= 0) {
      searchEnd = this._id3v1Location;
    } else {
      searchEnd = this.fileLength;
    }

    if (searchEnd < ApeFooter.SIZE) return;

    const footerOffset = searchEnd - ApeFooter.SIZE;
    this.seek(footerOffset);
    const footerData = this.readBlock(ApeFooter.SIZE);
    if (footerData.length < ApeFooter.SIZE) return;

    const magic = ByteVector.fromString("APETAGEX", StringType.Latin1);
    if (!footerData.startsWith(magic)) return;

    const footer = ApeFooter.parse(footerData);
    if (!footer) return;

    // The tag data starts tagSize bytes before the footer end
    this._apeLocation = footerOffset + ApeFooter.SIZE - footer.completeTagSize;
    this._apeOriginalSize = footer.completeTagSize;
    this._apeTag = ApeTag.readFrom(this._stream, footerOffset);
  }

  private refreshCombinedTag(): void {
    // Priority: ID3v2 > APE > ID3v1
    this._combinedTag.setTags([this._id3v2Tag, this._apeTag, this._id3v1Tag]);
  }
}
