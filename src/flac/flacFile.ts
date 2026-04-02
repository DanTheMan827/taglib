/** @packageDocumentation FLAC file format handler with support for XiphComment, ID3v2, ID3v1, and picture blocks. */
import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { type offset_t, Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { XiphComment } from "../ogg/xiphComment.js";
import { ID3v1Tag } from "../mpeg/id3v1/id3v1Tag.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";
import { Id3v2Header } from "../mpeg/id3v2/id3v2Header.js";
import { FlacPicture } from "./flacPicture.js";
import { FlacProperties } from "./flacProperties.js";
import { Variant, type VariantMap } from "../toolkit/variant.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAC_MAGIC = ByteVector.fromString("fLaC", StringType.Latin1);
const LAST_BLOCK_FLAG = 0x80;
const MIN_PADDING_LENGTH = 4096;
const MAX_PADDING_LENGTH = 1024 * 1024;

/**
 * FLAC metadata block type codes as defined by the FLAC specification.
 */
const enum BlockType {
  StreamInfo = 0,
  Padding = 1,
  Application = 2,
  SeekTable = 3,
  VorbisComment = 4,
  CueSheet = 5,
  Picture = 6,
}

/** Internal representation of a metadata block. */
interface MetadataBlock {
  /** {@link BlockType} code identifying the block type. */
  code: number;
  /** Raw block payload (excluding the 4-byte block header). */
  data: ByteVector;
}

// =============================================================================
// FlacTagTypes
// =============================================================================

/**
 * Bitmask identifying which tag formats are present in a FLAC file.
 * Used with {@link FlacFile.strip} to select which tags to remove.
 */
export enum FlacTagTypes {
  /** No tag types. */
  NoTags      = 0x0000,
  /** Matches XiphComment (Vorbis Comment) tags. */
  XiphComment = 0x0001,
  /** Matches ID3v1 tags. */
  ID3v1       = 0x0002,
  /** Matches ID3v2 tags. */
  ID3v2       = 0x0004,
  /** Matches all tag types. */
  AllTags     = 0xffff,
}

// =============================================================================
// FlacFile
// =============================================================================

/**
 * FLAC file format handler.
 *
 * Supports XiphComment (Vorbis Comment), ID3v2 and ID3v1 tags as well as
 * FLAC picture metadata blocks and audio property reading.
 *
 * FLAC file structure:
 *   [ID3v2] + "fLaC" + metadata blocks + audio frames + [ID3v1]
 */
export class FlacFile extends File {
  /** The Vorbis Comment (XiphComment) tag, populated from the VorbisComment metadata block. */
  private _xiphComment: XiphComment | null = null;
  /** Whether a VorbisComment block was found on disk during parsing. */
  private _hasXiphComment: boolean = false;
  /** The ID3v2 tag, present if one was found before the "fLaC" magic. */
  private _id3v2Tag: Id3v2Tag | null = null;
  /** The ID3v1 tag, present if one was found at the end of the file. */
  private _id3v1Tag: ID3v1Tag | null = null;
  /** Combined tag that delegates to the available sub-tags (priority: XiphComment > ID3v2 > ID3v1). */
  private _combinedTag: CombinedTag;
  /** Parsed audio properties from the STREAMINFO block. */
  private _properties: FlacProperties | null = null;

  /** Embedded FLAC picture blocks. */
  private _pictures: FlacPicture[] = [];
  /** All parsed metadata blocks (excluding Picture and Padding). */
  private _blocks: MetadataBlock[] = [];

  // Bookkeeping for tag / block locations
  /** File offset of the ID3v2 tag, or -1 if not present. */
  private _id3v2Location: offset_t = -1;
  /** Original byte size of the ID3v2 tag (used when rewriting). */
  private _id3v2OriginalSize: number = 0;
  /** File offset of the ID3v1 tag, or -1 if not present. */
  private _id3v1Location: offset_t = -1;
  /** File offset of the "fLaC" magic (i.e., start of FLAC metadata blocks). */
  private _flacStart: offset_t = 0;
  /** File offset of the first audio frame (immediately after the last metadata block). */
  private _streamStart: offset_t = 0;

  /**
   * Private constructor — use {@link FlacFile.open} to create instances.
   * @param stream The underlying I/O stream.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Opens a FLAC file and parses its metadata.
   * @param stream The I/O stream to read from.
   * @param readProperties Whether to parse audio properties (default `true`).
   * @param readStyle Accuracy / speed trade-off for property reading.
   * @returns A fully initialised {@link FlacFile} instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<FlacFile> {
    const file = new FlacFile(stream);
    await file.read(readProperties, readStyle);
    return file;
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag (XiphComment > ID3v2 > ID3v1) for this file.
   * @returns The active {@link CombinedTag}.
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the parsed audio properties, or `null` if properties were not read.
   * @returns The {@link FlacProperties} or `null`.
   */
  audioProperties(): FlacProperties | null {
    return this._properties;
  }

  /**
   * Writes all pending tag and picture changes back to the underlying stream.
   * @returns `true` on success, `false` if the file is read-only or invalid.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;
    if (!this.isValid) return false;

    // Ensure a XiphComment exists – copy from other tags if necessary
    if (!this._xiphComment) {
      this._xiphComment = new XiphComment();
      Tag.duplicate(this._combinedTag, this._xiphComment, false);
      this.refreshCombinedTag();
    }

    const xiphData = this._xiphComment.render(false);

    // -----------------------------------------------------------------------
    // Rebuild metadata block list
    // -----------------------------------------------------------------------

    // Start with non-comment, non-picture, non-padding blocks (e.g. STREAMINFO)
    const newBlocks: MetadataBlock[] = this._blocks.filter(
      b =>
        b.code !== BlockType.VorbisComment &&
        b.code !== BlockType.Picture &&
        b.code !== BlockType.Padding,
    );

    // Append Vorbis Comment block
    newBlocks.push({ code: BlockType.VorbisComment, data: xiphData });

    // Append Picture blocks
    for (const pic of this._pictures) {
      newBlocks.push({ code: BlockType.Picture, data: pic.render() });
    }

    // -----------------------------------------------------------------------
    // Render all metadata blocks into a single buffer
    // -----------------------------------------------------------------------

    // Collect all block chunks first, then concatenate once to avoid O(n²)
    const blockChunks: Uint8Array[] = [];
    let totalBlockSize = 0;
    for (const block of newBlocks) {
      const blockData = block.data;
      const header = ByteVector.fromUInt(blockData.length, true);
      // Ensure the upper byte is clear (block must fit in 24-bit length)
      if (header.get(0) !== 0) {
        continue; // skip oversized blocks
      }
      header.set(0, block.code);
      blockChunks.push(header.data);
      totalBlockSize += header.length;
      blockChunks.push(blockData.data);
      totalBlockSize += blockData.length;
    }

    // -----------------------------------------------------------------------
    // Compute padding
    // -----------------------------------------------------------------------

    const originalLength = this._streamStart - this._flacStart;
    let paddingLength = originalLength - totalBlockSize - 4;

    if (paddingLength <= 0) {
      paddingLength = MIN_PADDING_LENGTH;
    } else {
      let threshold = Math.floor((await this.fileLength()) / 100);
      threshold = Math.max(threshold, MIN_PADDING_LENGTH);
      threshold = Math.min(threshold, MAX_PADDING_LENGTH);
      if (paddingLength > threshold) {
        paddingLength = MIN_PADDING_LENGTH;
      }
    }

    const paddingHeader = ByteVector.fromUInt(paddingLength, true);
    paddingHeader.set(0, BlockType.Padding | LAST_BLOCK_FLAG);
    blockChunks.push(paddingHeader.data);
    totalBlockSize += paddingHeader.length;
    const paddingData = new Uint8Array(paddingLength);
    blockChunks.push(paddingData);
    totalBlockSize += paddingLength;

    // Single-pass concatenation
    const dataArr = new Uint8Array(totalBlockSize);
    let dataOffset = 0;
    for (const chunk of blockChunks) {
      dataArr.set(chunk, dataOffset);
      dataOffset += chunk.length;
    }
    const data = new ByteVector(dataArr);

    // Write metadata blocks (replace old region after "fLaC")
    await this.insert(data, this._flacStart, originalLength);

    const sizeDelta = data.length - originalLength;
    this._streamStart += sizeDelta;
    if (this._id3v1Location >= 0) this._id3v1Location += sizeDelta;

    // -----------------------------------------------------------------------
    // ID3v2
    // -----------------------------------------------------------------------

    if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
      if (this._id3v2Location < 0) this._id3v2Location = 0;

      const id3v2Data = this._id3v2Tag.render();
      await this.insert(id3v2Data, this._id3v2Location, this._id3v2OriginalSize);

      const id3v2Delta = id3v2Data.length - this._id3v2OriginalSize;
      this._flacStart += id3v2Delta;
      this._streamStart += id3v2Delta;
      if (this._id3v1Location >= 0) this._id3v1Location += id3v2Delta;
      this._id3v2OriginalSize = id3v2Data.length;
    } else if (this._id3v2Location >= 0) {
      await this.removeBlock(this._id3v2Location, this._id3v2OriginalSize);
      this._flacStart -= this._id3v2OriginalSize;
      this._streamStart -= this._id3v2OriginalSize;
      if (this._id3v1Location >= 0) this._id3v1Location -= this._id3v2OriginalSize;
      this._id3v2Location = -1;
      this._id3v2OriginalSize = 0;
    }

    // -----------------------------------------------------------------------
    // ID3v1
    // -----------------------------------------------------------------------

    if (this._id3v1Tag && !this._id3v1Tag.isEmpty) {
      if (this._id3v1Location >= 0) {
        await this.seek(this._id3v1Location);
      } else {
        await this.seek(0, Position.End);
        this._id3v1Location = await this.tell();
      }
      await this.writeBlock(this._id3v1Tag.render());
    } else if (this._id3v1Location >= 0) {
      await this.truncate(this._id3v1Location);
      this._id3v1Location = -1;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors
  // ---------------------------------------------------------------------------

  /**
   * Returns the XiphComment (Vorbis Comment) tag.
   * @param create - If `true` and no XiphComment exists, a new empty one is created.
   * @returns The {@link XiphComment}, or `null` if not present and `create` is falsy.
   */
  xiphComment(create?: boolean): XiphComment | null {
    if (!this._xiphComment && create) {
      this._xiphComment = new XiphComment();
      this.refreshCombinedTag();
    }
    return this._xiphComment;
  }

  /**
   * Returns the ID3v2 tag.
   * @param create - If `true` and no ID3v2 tag exists, a new empty one is created.
   * @returns The {@link Id3v2Tag}, or `null` if not present and `create` is falsy.
   */
  id3v2Tag(create?: boolean): Id3v2Tag | null {
    if (!this._id3v2Tag && create) {
      this._id3v2Tag = new Id3v2Tag();
      this.refreshCombinedTag();
    }
    return this._id3v2Tag;
  }

  /**
   * Returns the ID3v1 tag.
   * @param create - If `true` and no ID3v1 tag exists, a new empty one is created.
   * @returns The {@link ID3v1Tag}, or `null` if not present and `create` is falsy.
   */
  id3v1Tag(create?: boolean): ID3v1Tag | null {
    if (!this._id3v1Tag && create) {
      this._id3v1Tag = new ID3v1Tag();
      this.refreshCombinedTag();
    }
    return this._id3v1Tag;
  }

  /**
   * Whether a VorbisComment block was present on disk when the file was opened.
   * @returns `true` if a XiphComment was read from the FLAC metadata blocks.
   */
  get hasXiphComment(): boolean {
    return this._hasXiphComment;
  }

  /**
   * Whether an ID3v2 tag was present on disk when the file was opened.
   * @returns `true` if an ID3v2 tag was found before the "fLaC" magic.
   */
  get hasID3v2Tag(): boolean {
    return this._id3v2Location >= 0;
  }

  /**
   * Whether an ID3v1 tag was present on disk when the file was opened.
   * @returns `true` if an ID3v1 tag was found at the end of the file.
   */
  get hasID3v1Tag(): boolean {
    return this._id3v1Location >= 0;
  }

  /**
   * Removes the tag types indicated by `tags` from the in-memory representation.
   * Changes are written to disk the next time {@link save} is called.
   * @param tags - Bitmask of {@link FlacTagTypes} to strip (default: all).
   */
  strip(tags: FlacTagTypes = FlacTagTypes.AllTags): void {
    if (tags & FlacTagTypes.XiphComment) {
      this._xiphComment = new XiphComment();
      this._hasXiphComment = false;
    }
    if (tags & FlacTagTypes.ID3v2) {
      this._id3v2Tag = null;
    }
    if (tags & FlacTagTypes.ID3v1) {
      this._id3v1Tag = null;
    }
    this.refreshCombinedTag();
  }

  // ---------------------------------------------------------------------------
  // Picture management
  // ---------------------------------------------------------------------------

  /** Returns a shallow copy of the embedded picture list. */
  get pictureList(): FlacPicture[] {
    return this._pictures.slice();
  }

  /**
   * Adds a picture to the embedded picture list.
   * @param picture The {@link FlacPicture} to append.
   */
  addPicture(picture: FlacPicture): void {
    this._pictures.push(picture);
  }

  /**
   * Removes the specified picture from the embedded picture list.
   * @param picture The {@link FlacPicture} instance to remove.
   */
  removePicture(picture: FlacPicture): void {
    const idx = this._pictures.indexOf(picture);
    if (idx >= 0) {
      this._pictures.splice(idx, 1);
    }
  }

  /** Removes all embedded pictures from the file. */
  removePictures(): void {
    this._pictures = [];
  }

  // ---------------------------------------------------------------------------
  // Complex properties — FLAC picture block support
  // ---------------------------------------------------------------------------

  /**
   * Returns the list of complex property keys supported by this file.
   * Includes `"PICTURE"` if any embedded pictures are present.
   * @returns An array of supported complex property key strings.
   */
  override complexPropertyKeys(): string[] {
    const keys = super.complexPropertyKeys();
    if (this._pictures.length > 0 && !keys.includes("PICTURE")) {
      keys.push("PICTURE");
    }
    return keys;
  }

  /**
   * Returns the complex properties for the given key.
   * For the `"PICTURE"` key, each picture block is represented as a `VariantMap`.
   * @param key The complex property key (case-insensitive).
   * @returns An array of variant maps, one per picture (or delegated to the base class).
   */
  override complexProperties(key: string): VariantMap[] {
    if (key.toUpperCase() === "PICTURE") {
      const result: VariantMap[] = [];
      for (const pic of this._pictures) {
        const m: VariantMap = new Map();
        m.set("data", Variant.fromByteVector(pic.data));
        m.set("mimeType", Variant.fromString(pic.mimeType));
        m.set("description", Variant.fromString(pic.description));
        m.set("pictureType", Variant.fromInt(pic.pictureType));
        m.set("width", Variant.fromInt(pic.width));
        m.set("height", Variant.fromInt(pic.height));
        m.set("numColors", Variant.fromInt(pic.numColors));
        m.set("colorDepth", Variant.fromInt(pic.colorDepth));
        result.push(m);
      }
      return result;
    }
    return super.complexProperties(key);
  }

  /**
   * Sets the complex properties for the given key.
   * For the `"PICTURE"` key, replaces all embedded pictures with those derived
   * from the provided variant maps.
   * @param key The complex property key (case-insensitive).
   * @param value An array of variant maps describing the new property values.
   * @returns `true` if the key was handled, `false` if delegated to the base class.
   */
  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    if (key.toUpperCase() === "PICTURE") {
      this._pictures = [];
      for (const m of value) {
        const pic = new FlacPicture();
        const dataV = m.get("data");
        if (dataV) pic.data = dataV.toByteVector();
        const mimeV = m.get("mimeType");
        if (mimeV) pic.mimeType = mimeV.toString();
        const descV = m.get("description");
        if (descV) pic.description = descV.toString();
        const typeV = m.get("pictureType");
        if (typeV) pic.pictureType = typeV.toInt();
        const widthV = m.get("width");
        if (widthV) pic.width = widthV.toInt();
        const heightV = m.get("height");
        if (heightV) pic.height = heightV.toInt();
        const numColorsV = m.get("numColors");
        if (numColorsV) pic.numColors = numColorsV.toInt();
        const colorDepthV = m.get("colorDepth");
        if (colorDepthV) pic.colorDepth = colorDepthV.toInt();
        this._pictures.push(pic);
      }
      return true;
    }
    return super.setComplexProperties(key, value);
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Orchestrates the full parse of a FLAC file: finds ID3 tags, scans FLAC
   * metadata blocks, and reads audio properties.
   * @param readProperties Whether to parse audio properties.
   * @param readStyle Accuracy / speed trade-off hint.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // 1. Look for an ID3v2 tag at the start
    await this.findID3v2();

    // 2. Look for an ID3v1 tag at the end
    await this.findID3v1();

    // 3. Scan FLAC metadata blocks
    await this.scan();

    if (!this.isValid) return;

    // Build combined tag (priority: XiphComment > ID3v2 > ID3v1)
    this.refreshCombinedTag();

    // 4. Audio properties
    if (readProperties && this._blocks.length > 0) {
      const infoData = this._blocks[0].data;
      let streamLength: number;
      if (this._id3v1Location >= 0) {
        streamLength = this._id3v1Location - this._streamStart;
      } else {
        streamLength = (await this.fileLength()) - this._streamStart;
      }
      this._properties = new FlacProperties(infoData, streamLength, readStyle);
    }
  }

  /**
   * Looks for an ID3v2 tag at the beginning of the file and populates
   * `_id3v2Tag`, `_id3v2Location`, and `_id3v2OriginalSize` if found.
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
   * Looks for an ID3v1 tag at the end of the file and populates
   * `_id3v1Tag` and `_id3v1Location` if found.
   */
  private async findID3v1(): Promise<void> {
    const fileLen = await this.fileLength();
    if (fileLen < 128) return;

    const tagOffset = fileLen - 128;
    await this.seek(tagOffset);
    const data = await this.readBlock(3);
    if (data.length < 3) return;

    if (!data.startsWith(ID3v1Tag.fileIdentifier())) return;

    this._id3v1Location = tagOffset;
    this._id3v1Tag = await ID3v1Tag.readFrom(this._stream, tagOffset);
  }

  /**
   * Scans all FLAC metadata blocks, populating `_blocks`, `_pictures`,
   * `_xiphComment`, `_flacStart`, and `_streamStart`.
   */
  private async scan(): Promise<void> {
    // Locate "fLaC" magic after any ID3v2 tag
    let nextBlockOffset: offset_t;
    if (this._id3v2Location >= 0) {
      nextBlockOffset = await this.find(
        FLAC_MAGIC,
        this._id3v2Location + this._id3v2OriginalSize,
      );
    } else {
      nextBlockOffset = await this.find(FLAC_MAGIC);
    }

    if (nextBlockOffset < 0) {
      this._valid = false;
      return;
    }

    nextBlockOffset += 4; // skip "fLaC"
    this._flacStart = nextBlockOffset;

    let xiphCommentData: ByteVector | null = null;

    while (true) {
      await this.seek(nextBlockOffset);
      const header = await this.readBlock(4);
      if (header.length < 4) {
        this._valid = false;
        return;
      }

      const blockType = header.get(0) & ~LAST_BLOCK_FLAG;
      const isLastBlock = (header.get(0) & LAST_BLOCK_FLAG) !== 0;
      const blockLength = header.toUInt(1, 3, true);

      // First block must be STREAMINFO
      if (this._blocks.length === 0 && blockType !== BlockType.StreamInfo) {
        this._valid = false;
        return;
      }

      if (
        blockLength === 0 &&
        blockType !== BlockType.Padding &&
        blockType !== BlockType.SeekTable
      ) {
        this._valid = false;
        return;
      }

      const data = await this.readBlock(blockLength);
      if (data.length !== blockLength) {
        this._valid = false;
        return;
      }

      if (blockType === BlockType.VorbisComment) {
        if (!xiphCommentData) {
          xiphCommentData = data;
          this._blocks.push({ code: BlockType.VorbisComment, data });
        }
        // Ignore duplicate Vorbis Comment blocks
      } else if (blockType === BlockType.Picture) {
        const pic = FlacPicture.parse(data);
        this._pictures.push(pic);
        // Don't store picture blocks in _blocks – they're managed separately
      } else if (blockType === BlockType.Padding) {
        // Skip padding blocks
      } else {
        this._blocks.push({ code: blockType, data });
      }

      nextBlockOffset += blockLength + 4;

      if (isLastBlock) break;
    }

    this._streamStart = nextBlockOffset;

    // Parse xiph comment data
    if (xiphCommentData) {
      this._xiphComment = XiphComment.readFrom(xiphCommentData);
      this._hasXiphComment = true;
    } else {
      this._xiphComment = new XiphComment();
    }
  }

  /** Rebuilds `_combinedTag` from the current set of sub-tags (XiphComment > ID3v2 > ID3v1). */
  private refreshCombinedTag(): void {
    // Priority: XiphComment > ID3v2 > ID3v1
    this._combinedTag.setTags([this._xiphComment, this._id3v2Tag, this._id3v1Tag]);
  }
}
