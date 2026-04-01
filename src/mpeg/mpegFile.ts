/** @file MPEG (MP3) file format handler supporting ID3v1, ID3v2, and APE tags with audio property reading. */
import { ApeFooter, ApeTag } from "../ape/apeTag.js";
import { ByteVector, StringType } from "../byteVector.js";
import { CombinedTag } from "../combinedTag.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { type offset_t, Position, ReadStyle, StripTags } from "../toolkit/types.js";
import { ID3v1Tag } from "./id3v1/id3v1Tag.js";
import { Id3v2Header } from "./id3v2/id3v2Header.js";
import { Id3v2Tag } from "./id3v2/id3v2Tag.js";
import { MpegHeader } from "./mpegHeader.js";
import { MpegProperties } from "./mpegProperties.js";

// =============================================================================
// Enums
// =============================================================================

/**
 * Bit-flag enum identifying which tag types are present in or should be
 * operated on within an MPEG file.
 */
export enum MpegTagTypes {
  /** No tags. */
  NoTags = 0x0000,
  /** ID3v1 tag. */
  ID3v1 = 0x0001,
  /** ID3v2 tag. */
  ID3v2 = 0x0002,
  /** APE tag. */
  APE = 0x0004,
  /** All supported tag types (bitwise OR of all members). */
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
  /** The ID3v2 tag, or `null` if not present. */
  private _id3v2Tag: Id3v2Tag | null = null;
  /** The ID3v1 tag, or `null` if not present. */
  private _id3v1Tag: ID3v1Tag | null = null;
  /** The APE tag, or `null` if not present. */
  private _apeTag: ApeTag | null = null;
  /** Priority-ordered combined tag that delegates to all present tag types. */
  private _combinedTag: CombinedTag;
  /** Cached audio properties, or `null` if not read. */
  private _properties: MpegProperties | null = null;

  // Bookkeeping for tag locations / sizes (needed by save / strip)
  /** Byte offset of the ID3v2 tag within the file, or `-1` if not present. */
  private _id3v2Location: offset_t = -1;
  /** Original byte size of the ID3v2 tag (used to calculate insertion deltas). */
  private _id3v2OriginalSize: number = 0;
  /** Byte offset of the ID3v1 tag within the file, or `-1` if not present. */
  private _id3v1Location: offset_t = -1;
  /** Byte offset of the APE tag within the file, or `-1` if not present. */
  private _apeLocation: offset_t = -1;
  /** Original byte size of the APE tag (used to calculate insertion deltas). */
  private _apeOriginalSize: number = 0;

  /**
   * Private constructor — use the static {@link MpegFile.open} factory method instead.
   * @param stream - The underlying I/O stream for this file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Opens an MPEG file from the given stream, parsing tags and optionally audio properties.
   *
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to read audio properties (default: `true`).
   * @param readStyle - The level of detail used when reading properties (default: `ReadStyle.Average`).
   * @returns A fully initialised `MpegFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<MpegFile> {
    const file = new MpegFile(stream);
    await file.read(readProperties, readStyle);
    return file;
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag that delegates to all present tag types, in
   * priority order (ID3v2 > APE > ID3v1).
   *
   * @returns The combined tag instance.
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the audio properties for this file, or `null` if they were not read.
   *
   * @returns The MPEG audio properties, or `null`.
   */
  audioProperties(): MpegProperties | null {
    return this._properties;
  }

  /**
   * Saves the specified tag types to the file, optionally stripping tags not
   * included in the save mask.
   *
   * @param tags - Bit-flag indicating which tag types to save (default: {@link MpegTagTypes.AllTags}).
   * @param stripTags - Whether to strip tag types not present in `tags` (default: {@link StripTags.StripOthers}).
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(
    tags: MpegTagTypes = MpegTagTypes.AllTags,
    stripTags: StripTags = StripTags.StripOthers,
    version?: number,
  ): Promise<boolean> {
    if (this.readOnly) return false;

    // Sync metadata between existing tag formats only when BOTH already exist.
    // Never auto-create a tag type just to copy data into it — that would write
    // unwanted tags to clean files (e.g. ID3v1 on a fresh MP3 with only ID3v2).
    if ((tags & MpegTagTypes.ID3v2) && this._id3v1Tag && this._id3v2Tag &&
      (stripTags !== StripTags.StripOthers || (tags & MpegTagTypes.ID3v1))) {
      Tag.duplicate(this._id3v1Tag, this._id3v2Tag, false);
    }
    if ((tags & MpegTagTypes.ID3v1) && this._id3v2Tag && this._id3v1Tag &&
      (stripTags !== StripTags.StripOthers || (tags & MpegTagTypes.ID3v2))) {
      Tag.duplicate(this._id3v2Tag, this._id3v1Tag, false);
    }

    // Strip tags not in the save mask
    if (stripTags === StripTags.StripOthers) {
      await this.strip(~tags & MpegTagTypes.AllTags);
    }

    // -- ID3v2 --
    if (tags & MpegTagTypes.ID3v2) {
      if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
        if (this._id3v2Location < 0) this._id3v2Location = 0;
        const data = this._id3v2Tag.render(version);
        await this.insert(data, this._id3v2Location, this._id3v2OriginalSize);
        const sizeDelta = data.length - this._id3v2OriginalSize;
        if (this._apeLocation >= 0) this._apeLocation += sizeDelta;
        if (this._id3v1Location >= 0) this._id3v1Location += sizeDelta;
        this._id3v2OriginalSize = data.length;
      } else {
        await this.strip(MpegTagTypes.ID3v2);
      }
    }

    // -- ID3v1 --
    if (tags & MpegTagTypes.ID3v1) {
      if (this._id3v1Tag && !this._id3v1Tag.isEmpty) {
        if (this._id3v1Location >= 0) {
          await this.seek(this._id3v1Location);
        } else {
          await this.seek(0, Position.End);
          this._id3v1Location = await this.tell();
        }
        await this.writeBlock(this._id3v1Tag.render());
      } else {
        await this.strip(MpegTagTypes.ID3v1);
      }
    }

    // -- APE --
    if (tags & MpegTagTypes.APE) {
      if (this._apeTag && !this._apeTag.isEmpty) {
        if (this._apeLocation < 0) {
          this._apeLocation =
            this._id3v1Location >= 0 ? this._id3v1Location : await this.fileLength();
        }
        const data = this._apeTag.render();
        await this.insert(data, this._apeLocation, this._apeOriginalSize);
        const sizeDelta = data.length - this._apeOriginalSize;
        if (this._id3v1Location >= 0) this._id3v1Location += sizeDelta;
        this._apeOriginalSize = data.length;
      } else {
        await this.strip(MpegTagTypes.APE);
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors (lazy-create overloads)
  // ---------------------------------------------------------------------------

  /**
   * Returns `true` if the file contains a physical ID3v2 tag (i.e., one was
   * found during parsing or has been written by a previous {@link save} call).
   */
  get hasID3v2Tag(): boolean {
    return this._id3v2Location >= 0;
  }

  /**
   * Returns `true` if the file contains a physical ID3v1 tag.
   */
  get hasID3v1Tag(): boolean {
    return this._id3v1Location >= 0;
  }

  /**
   * Returns `true` if the file contains a physical APEv2 tag.
   */
  get hasAPETag(): boolean {
    return this._apeLocation >= 0;
  }

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

  /**
   * Returns the byte offset of the first valid MPEG audio frame in the file.
   * Scanning begins after the ID3v2 tag (if present).
   *
   * @returns The file offset of the first frame, or `-1` if not found.
   */
  async firstFrameOffset(): Promise<offset_t> {
    let position: offset_t = 0;
    if (this._id3v2Tag) {
      position = this._id3v2Location + this._id3v2OriginalSize;
    }
    return await this.nextFrameOffset(position);
  }

  /**
   * Returns the byte offset of the last valid MPEG audio frame in the file.
   * Scanning ends before any trailing APE or ID3v1 tag.
   *
   * @returns The file offset of the last frame, or `-1` if not found.
   */
  async lastFrameOffset(): Promise<offset_t> {
    let position: offset_t;
    if (this._apeTag && this._apeLocation >= 0) {
      position = this._apeLocation - 1;
    } else if (this._id3v1Tag && this._id3v1Location >= 0) {
      position = this._id3v1Location - 1;
    } else {
      position = await this.fileLength();
    }
    return await this.previousFrameOffset(position);
  }

  /**
   * Scans forward from `position` and returns the offset of the next valid MPEG frame.
   *
   * @param position - The byte offset at which to start scanning.
   * @returns The file offset of the next valid frame, or `-1` if not found.
   */
  async nextFrameOffset(position: offset_t): Promise<offset_t> {
    const bufSize = File.bufferSize();
    let prevByte = -1;
    const flen = await this.fileLength();

    while (position < flen) {
      await this.seek(position);
      const buffer = await this.readBlock(bufSize);
      if (buffer.isEmpty) return -1;

      for (let i = 0; i < buffer.length; i++) {
        const curByte = buffer.get(i);

        if (prevByte === 0xff && curByte !== 0xff && (curByte & 0xe0) === 0xe0) {
          const frameOffset = position + i - 1;
          const header = await MpegHeader.fromStream(this._stream, frameOffset, true);
          if (header.isValid) return frameOffset;
        }

        prevByte = curByte;
      }

      position += buffer.length;
    }

    return -1;
  }

  /**
   * Scans backward from `position` and returns the offset of the previous valid MPEG frame.
   *
   * @param position - The byte offset at which to start scanning (inclusive).
   * @returns The file offset of the previous valid frame, or `-1` if not found.
   */
  async previousFrameOffset(position: offset_t): Promise<offset_t> {
    const bufSize = File.bufferSize();
    let nextByte = -1;

    while (position > 0) {
      const readLength = Math.min(position, bufSize);
      position -= readLength;

      await this.seek(position);
      const buffer = await this.readBlock(readLength);
      if (buffer.isEmpty) return -1;

      for (let i = buffer.length - 1; i >= 0; i--) {
        const curByte = buffer.get(i);

        if (curByte === 0xff && nextByte !== -1 &&
          nextByte !== 0xff && (nextByte & 0xe0) === 0xe0) {
          const frameOffset = position + i;
          const header = await MpegHeader.fromStream(this._stream, frameOffset, true);
          if (header.isValid) return frameOffset;
        }

        nextByte = curByte;
      }
    }

    return -1;
  }

  /**
   * Removes the specified tag types from the file.
   *
   * @param tags - Bit-flag indicating which tag types to strip (default: {@link MpegTagTypes.AllTags}).
   */
  async strip(tags: MpegTagTypes = MpegTagTypes.AllTags): Promise<void> {
    if ((tags & MpegTagTypes.ID3v2) && this._id3v2Tag) {
      if (this._id3v2Location >= 0 && this._id3v2OriginalSize > 0) {
        await this.removeBlock(this._id3v2Location, this._id3v2OriginalSize);
        if (this._apeLocation >= 0) this._apeLocation -= this._id3v2OriginalSize;
        if (this._id3v1Location >= 0) this._id3v1Location -= this._id3v2OriginalSize;
      }
      this._id3v2Tag = null;
      this._id3v2Location = -1;
      this._id3v2OriginalSize = 0;
    }

    if ((tags & MpegTagTypes.APE) && this._apeTag) {
      if (this._apeLocation >= 0 && this._apeOriginalSize > 0) {
        await this.removeBlock(this._apeLocation, this._apeOriginalSize);
        if (this._id3v1Location >= 0) this._id3v1Location -= this._apeOriginalSize;
      }
      this._apeTag = null;
      this._apeLocation = -1;
      this._apeOriginalSize = 0;
    }

    if ((tags & MpegTagTypes.ID3v1) && this._id3v1Tag) {
      if (this._id3v1Location >= 0) {
        await this.truncate(this._id3v1Location);
      }
      this._id3v1Tag = null;
      this._id3v1Location = -1;
    }

    this.refreshCombinedTag();
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads all tags and optionally audio properties from the stream.
   *
   * @param readProperties - Whether to read audio properties.
   * @param readStyle - The read-style detail level.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // 1. Find & parse ID3v2
    await this.findID3v2();

    // 2. Find & parse ID3v1
    await this.findID3v1();

    // 3. Find & parse APE
    await this.findAPE();

    // 4. Audio properties
    if (readProperties) {
      this._properties = await MpegProperties.create(this, readStyle);
    }

    // Ensure at least an empty ID3v2 tag exists so that writes via the combined tag
    // (tag.title = "...") have somewhere to go.  Do NOT auto-create ID3v1 or APE;
    // those are only created explicitly (id3v1Tag(true) / apeTag(true)) to match
    // C++ TagLib behaviour where tag types are not created unless asked for.
    this.id3v2Tag(true);

    // Build combined tag (priority: ID3v2 > APE > ID3v1)
    this.refreshCombinedTag();
  }

  /**
   * Scans the beginning of the file for an ID3v2 tag and populates
   * `_id3v2Tag`, `_id3v2Location`, and `_id3v2OriginalSize`.
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
    this._id3v2Tag = await Id3v2Tag.readFrom(this._stream, 0);
  }

  /**
   * Scans the end of the file for an ID3v1 tag and populates
   * `_id3v1Tag` and `_id3v1Location`.
   */
  private async findID3v1(): Promise<void> {
    const flen = await this.fileLength();
    if (flen < 128) return;

    const tagOffset = flen - 128;
    await this.seek(tagOffset);
    const data = await this.readBlock(3);
    if (data.length < 3) return;

    if (!data.startsWith(ID3v1Tag.fileIdentifier())) return;

    this._id3v1Location = tagOffset;
    this._id3v1Tag = await ID3v1Tag.readFrom(this._stream, tagOffset);
  }

  /**
   * Scans immediately before the ID3v1 tag (or end of file) for an APE tag and
   * populates `_apeTag`, `_apeLocation`, and `_apeOriginalSize`.
   */
  private async findAPE(): Promise<void> {
    // APE tag is located before ID3v1 (or at end of file)
    let searchEnd: offset_t;
    if (this._id3v1Location >= 0) {
      searchEnd = this._id3v1Location;
    } else {
      searchEnd = await this.fileLength();
    }

    if (searchEnd < ApeFooter.SIZE) return;

    const footerOffset = searchEnd - ApeFooter.SIZE;
    await this.seek(footerOffset);
    const footerData = await this.readBlock(ApeFooter.SIZE);
    if (footerData.length < ApeFooter.SIZE) return;

    const magic = ByteVector.fromString("APETAGEX", StringType.Latin1);
    if (!footerData.startsWith(magic)) return;

    const footer = ApeFooter.parse(footerData);
    if (!footer) return;

    // The tag data starts tagSize bytes before the footer end
    this._apeLocation = footerOffset + ApeFooter.SIZE - footer.completeTagSize;
    this._apeOriginalSize = footer.completeTagSize;
    this._apeTag = await ApeTag.readFrom(this._stream, footerOffset);
  }

  /**
   * Rebuilds the `_combinedTag` from the currently present tag objects,
   * maintaining priority order (ID3v2 > APE > ID3v1).
   */
  private refreshCombinedTag(): void {
    // Priority: ID3v2 > APE > ID3v1
    this._combinedTag.setTags([this._id3v2Tag, this._apeTag, this._id3v1Tag]);
  }
}
