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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAC_MAGIC = ByteVector.fromString("fLaC", StringType.Latin1);
const LAST_BLOCK_FLAG = 0x80;
const MIN_PADDING_LENGTH = 4096;
const MAX_PADDING_LENGTH = 1024 * 1024;

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
  code: number;
  data: ByteVector;
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
  private _xiphComment: XiphComment | null = null;
  private _id3v2Tag: Id3v2Tag | null = null;
  private _id3v1Tag: ID3v1Tag | null = null;
  private _combinedTag: CombinedTag;
  private _properties: FlacProperties | null = null;

  private _pictures: FlacPicture[] = [];
  private _blocks: MetadataBlock[] = [];

  // Bookkeeping for tag / block locations
  private _id3v2Location: offset_t = -1;
  private _id3v2OriginalSize: number = 0;
  private _id3v1Location: offset_t = -1;
  private _flacStart: offset_t = 0;
  private _streamStart: offset_t = 0;

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

  audioProperties(): FlacProperties | null {
    return this._properties;
  }

  save(): boolean {
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
      (b) =>
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

    let data = new ByteVector();
    for (const block of newBlocks) {
      const blockData = block.data;
      const header = ByteVector.fromUInt(blockData.length, true);
      // Ensure the upper byte is clear (block must fit in 24-bit length)
      if (header.get(0) !== 0) {
        continue; // skip oversized blocks
      }
      header.set(0, block.code);
      data.append(header);
      data.append(blockData);
    }

    // -----------------------------------------------------------------------
    // Compute padding
    // -----------------------------------------------------------------------

    const originalLength = this._streamStart - this._flacStart;
    let paddingLength = originalLength - data.length - 4;

    if (paddingLength <= 0) {
      paddingLength = MIN_PADDING_LENGTH;
    } else {
      let threshold = Math.floor(this.fileLength / 100);
      threshold = Math.max(threshold, MIN_PADDING_LENGTH);
      threshold = Math.min(threshold, MAX_PADDING_LENGTH);
      if (paddingLength > threshold) {
        paddingLength = MIN_PADDING_LENGTH;
      }
    }

    const paddingHeader = ByteVector.fromUInt(paddingLength, true);
    paddingHeader.set(0, BlockType.Padding | LAST_BLOCK_FLAG);
    data.append(paddingHeader);
    data.append(ByteVector.fromSize(paddingLength, 0));

    // Write metadata blocks (replace old region after "fLaC")
    this.insert(data, this._flacStart, originalLength);

    const sizeDelta = data.length - originalLength;
    this._streamStart += sizeDelta;
    if (this._id3v1Location >= 0) this._id3v1Location += sizeDelta;

    // -----------------------------------------------------------------------
    // ID3v2
    // -----------------------------------------------------------------------

    if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
      if (this._id3v2Location < 0) this._id3v2Location = 0;

      const id3v2Data = this._id3v2Tag.render();
      this.insert(id3v2Data, this._id3v2Location, this._id3v2OriginalSize);

      const id3v2Delta = id3v2Data.length - this._id3v2OriginalSize;
      this._flacStart += id3v2Delta;
      this._streamStart += id3v2Delta;
      if (this._id3v1Location >= 0) this._id3v1Location += id3v2Delta;
      this._id3v2OriginalSize = id3v2Data.length;
    } else if (this._id3v2Location >= 0) {
      this.removeBlock(this._id3v2Location, this._id3v2OriginalSize);
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
        this.seek(this._id3v1Location);
      } else {
        this.seek(0, Position.End);
        this._id3v1Location = this.tell();
      }
      this.writeBlock(this._id3v1Tag.render());
    } else if (this._id3v1Location >= 0) {
      this.truncate(this._id3v1Location);
      this._id3v1Location = -1;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors
  // ---------------------------------------------------------------------------

  get xiphComment(): XiphComment | null {
    return this._xiphComment;
  }

  get id3v2Tag(): Id3v2Tag | null {
    return this._id3v2Tag;
  }

  get id3v1Tag(): ID3v1Tag | null {
    return this._id3v1Tag;
  }

  // ---------------------------------------------------------------------------
  // Picture management
  // ---------------------------------------------------------------------------

  get pictureList(): FlacPicture[] {
    return this._pictures.slice();
  }

  addPicture(picture: FlacPicture): void {
    this._pictures.push(picture);
  }

  removePicture(picture: FlacPicture): void {
    const idx = this._pictures.indexOf(picture);
    if (idx >= 0) {
      this._pictures.splice(idx, 1);
    }
  }

  removePictures(): void {
    this._pictures = [];
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // 1. Look for an ID3v2 tag at the start
    this.findID3v2();

    // 2. Look for an ID3v1 tag at the end
    this.findID3v1();

    // 3. Scan FLAC metadata blocks
    this.scan();

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
        streamLength = this.fileLength - this._streamStart;
      }
      this._properties = new FlacProperties(infoData, streamLength, readStyle);
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

  private scan(): void {
    // Locate "fLaC" magic after any ID3v2 tag
    let nextBlockOffset: offset_t;
    if (this._id3v2Location >= 0) {
      nextBlockOffset = this.find(
        FLAC_MAGIC,
        this._id3v2Location + this._id3v2OriginalSize,
      );
    } else {
      nextBlockOffset = this.find(FLAC_MAGIC);
    }

    if (nextBlockOffset < 0) {
      this._valid = false;
      return;
    }

    nextBlockOffset += 4; // skip "fLaC"
    this._flacStart = nextBlockOffset;

    let xiphCommentData: ByteVector | null = null;

    while (true) {
      this.seek(nextBlockOffset);
      const header = this.readBlock(4);
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

      const data = this.readBlock(blockLength);
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
    } else {
      this._xiphComment = new XiphComment();
    }
  }

  private refreshCombinedTag(): void {
    // Priority: XiphComment > ID3v2 > ID3v1
    this._combinedTag.setTags([this._xiphComment, this._id3v2Tag, this._id3v1Tag]);
  }
}
