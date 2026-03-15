import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";
import { DsdiffProperties } from "./dsdiffProperties.js";
import { DsdiffDiinTag } from "./dsdiffDiinTag.js";

// =============================================================================
// Types
// =============================================================================

interface Chunk64 {
  name: ByteVector;
  offset: number;
  size: number;
  padding: number;
}

enum ChildChunkKind {
  PROP = 0,
  DIIN = 1,
}

// =============================================================================
// DsdiffFile
// =============================================================================

/**
 * DSD Interchange File Format (DSDIFF) handler.
 *
 * DSDIFF is a RIFF-style big-endian container ("FRM8" + "DSD ") that can
 * hold both DSD uncompressed and DST compressed audio.  Metadata is
 * provided by an optional ID3v2 chunk and/or a DIIN chunk with limited
 * title/artist fields.
 */
export class DsdiffFile extends File {
  private _id3v2Tag: Id3v2Tag | null = null;
  private _diinTag: DsdiffDiinTag | null = null;
  private _combinedTag: CombinedTag;
  private _properties: DsdiffProperties | null = null;

  // Container-level metadata
  private _size: number = 0;
  private _chunks: Chunk64[] = [];
  private _childChunks: [Chunk64[], Chunk64[]] = [[], []];
  private _childChunkIndex: [number, number] = [-1, -1];
  private _isID3InPropChunk: boolean = false;
  private _hasID3v2: boolean = false;
  private _hasDiin: boolean = false;
  private _id3v2TagChunkID: string = "ID3 ";

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
   * Quick-check whether `stream` looks like a valid DSDIFF file.
   * Requires "FRM8" at offset 0 and "DSD " at offset 12.
   */
  static isSupported(stream: IOStream): boolean {
    stream.seek(0);
    const id = stream.readBlock(16);
    if (id.length < 16) return false;

    const frm8 = ByteVector.fromString("FRM8", StringType.Latin1);
    const dsd = ByteVector.fromString("DSD ", StringType.Latin1);
    return id.startsWith(frm8) && id.containsAt(dsd, 12);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._combinedTag;
  }

  audioProperties(): DsdiffProperties | null {
    return this._properties;
  }

  save(): boolean {
    if (this.readOnly) return false;

    // Save ID3v2 tag
    if (this._id3v2Tag) {
      if (!this._id3v2Tag.isEmpty) {
        if (this._isID3InPropChunk) {
          this.setChildChunkData(
            this._id3v2TagChunkID,
            this._id3v2Tag.render(),
            ChildChunkKind.PROP,
          );
        } else {
          this.setRootChunkData(
            this._id3v2TagChunkID,
            this._id3v2Tag.render(),
          );
        }
        this._hasID3v2 = true;
      } else {
        if (this._isID3InPropChunk) {
          this.setChildChunkData(
            this._id3v2TagChunkID,
            new ByteVector(),
            ChildChunkKind.PROP,
          );
        } else {
          this.setRootChunkData(this._id3v2TagChunkID, new ByteVector());
        }
        this._hasID3v2 = false;
      }
    }

    // Save DIIN tag
    if (this._diinTag) {
      if (this._diinTag.title !== "") {
        const titleData = new ByteVector();
        titleData.append(
          ByteVector.fromUInt(this._diinTag.title.length, true),
        );
        titleData.append(
          ByteVector.fromString(this._diinTag.title, StringType.Latin1),
        );
        this.setChildChunkData("DITI", titleData, ChildChunkKind.DIIN);
      } else {
        this.setChildChunkData("DITI", new ByteVector(), ChildChunkKind.DIIN);
      }

      if (this._diinTag.artist !== "") {
        const artistData = new ByteVector();
        artistData.append(
          ByteVector.fromUInt(this._diinTag.artist.length, true),
        );
        artistData.append(
          ByteVector.fromString(this._diinTag.artist, StringType.Latin1),
        );
        this.setChildChunkData("DIAR", artistData, ChildChunkKind.DIIN);
      } else {
        this.setChildChunkData("DIAR", new ByteVector(), ChildChunkKind.DIIN);
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors
  // ---------------------------------------------------------------------------

  /** Get the ID3v2 tag, optionally creating one if absent. */
  id3v2Tag(create?: boolean): Id3v2Tag | null {
    if (!this._id3v2Tag && create) {
      this._id3v2Tag = new Id3v2Tag();
      this._isID3InPropChunk = false;
      this.refreshCombinedTag();
    }
    return this._id3v2Tag;
  }

  /** Get the DIIN tag, optionally creating one if absent. */
  diinTag(create?: boolean): DsdiffDiinTag | null {
    if (!this._diinTag && create) {
      this._diinTag = new DsdiffDiinTag();
      this.refreshCombinedTag();
    }
    return this._diinTag;
  }

  get hasID3v2Tag(): boolean {
    return this._hasID3v2;
  }

  get hasDIINTag(): boolean {
    return this._hasDiin;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    const bigEndian = true;

    // Read FRM8 container header
    this.seek(0);
    this.readBlock(4); // "FRM8"
    this._size = Number(this.readBlock(8).toLongLong(bigEndian));
    this.readBlock(4); // "DSD "

    // Walk all root-level chunks
    while (this.tell() + 12 <= this.fileLength) {
      const chunkName = this.readBlock(4);
      const chunkSize = Number(this.readBlock(8).toLongLong(bigEndian));

      if (!this.isValidChunkID(chunkName)) {
        this._valid = false;
        break;
      }

      if (this.tell() + chunkSize > this.fileLength) {
        this._valid = false;
        break;
      }

      const chunk: Chunk64 = {
        name: chunkName,
        size: chunkSize,
        offset: this.tell(),
        padding: 0,
      };

      this.seek(chunk.size, Position.Current);

      // Check padding byte
      const posNotPadded = this.tell();
      if ((posNotPadded & 0x01) !== 0) {
        const iByte = this.readBlock(1);
        if (iByte.length !== 1 || iByte.get(0) !== 0) {
          this.seek(posNotPadded);
        } else {
          chunk.padding = 1;
        }
      }

      this._chunks.push(chunk);
    }

    // Counters for property computation
    let lengthDSDSamplesTimeChannels = 0n;
    let audioDataSizeInBytes = 0n;
    let dstNumFrames = 0;
    let dstFrameRate = 0;

    // Process chunks
    for (let i = 0; i < this._chunks.length; i++) {
      const chunkNameStr = this._chunks[i].name.toString(StringType.Latin1);

      if (chunkNameStr === "DSD ") {
        lengthDSDSamplesTimeChannels = BigInt(this._chunks[i].size) * 8n;
        audioDataSizeInBytes = BigInt(this._chunks[i].size);
      } else if (chunkNameStr === "DST ") {
        // DST compressed: parse DST Frame Information
        const dstChunkEnd = this._chunks[i].offset + this._chunks[i].size;
        this.seek(this._chunks[i].offset);
        audioDataSizeInBytes = BigInt(this._chunks[i].size);

        while (this.tell() + 12 <= dstChunkEnd) {
          const dstChunkName = this.readBlock(4);
          const dstChunkSize = Number(
            this.readBlock(8).toLongLong(bigEndian),
          );

          if (!this.isValidChunkID(dstChunkName)) {
            this._valid = false;
            break;
          }

          const frte = ByteVector.fromString("FRTE", StringType.Latin1);
          if (dstChunkName.startsWith(frte)) {
            dstNumFrames = this.readBlock(4).toUInt(0, 4, bigEndian);
            dstFrameRate = this.readBlock(2).toUShort(bigEndian);
            break;
          }

          this.seek(dstChunkSize, Position.Current);
          const uPos = this.tell();
          if ((uPos & 0x01) !== 0) {
            const pad = this.readBlock(1);
            if (pad.length !== 1 || pad.get(0) !== 0) {
              this.seek(uPos);
            }
          }
        }
      } else if (chunkNameStr === "PROP") {
        this._childChunkIndex[ChildChunkKind.PROP] = i;
        this.parsePROPChunk(i, bigEndian);
      } else if (chunkNameStr === "DIIN") {
        this._childChunkIndex[ChildChunkKind.DIIN] = i;
        this._hasDiin = true;
        this.parseDIINChunk(i, bigEndian);
      } else if (chunkNameStr === "ID3 " || chunkNameStr === "id3 ") {
        this._id3v2TagChunkID = chunkNameStr;
        this._id3v2Tag = Id3v2Tag.readFrom(
          this._stream,
          this._chunks[i].offset,
        );
        this._isID3InPropChunk = false;
        this._hasID3v2 = true;
      }
    }

    if (!this.isValid) return;

    // Read properties from PROP sub-chunks
    let sampleRate = 0;
    let channels = 0;

    for (const propChunk of this._childChunks[ChildChunkKind.PROP]) {
      const propName = propChunk.name.toString(StringType.Latin1);

      if (propName === "ID3 " || propName === "id3 ") {
        if (this._hasID3v2) continue; // Root-level ID3v2 takes precedence
        this._id3v2TagChunkID = propName;
        this._id3v2Tag = Id3v2Tag.readFrom(this._stream, propChunk.offset);
        this._isID3InPropChunk = true;
        this._hasID3v2 = true;
      } else if (propName === "FS  ") {
        this.seek(propChunk.offset);
        sampleRate = this.readBlock(4).toUInt(0, 4, bigEndian);
      } else if (propName === "CHNL") {
        this.seek(propChunk.offset);
        channels = this.readBlock(2).toShort(0, bigEndian);
      }
    }

    // Ensure DIIN tag exists
    if (!this._diinTag) {
      this._diinTag = new DsdiffDiinTag();
    }

    // Read title & artist from DIIN sub-chunks
    if (this._hasDiin) {
      for (const diinChunk of this._childChunks[ChildChunkKind.DIIN]) {
        const diinName = diinChunk.name.toString(StringType.Latin1);
        if (diinName === "DITI") {
          this.seek(diinChunk.offset);
          const titleStrLength = this.readBlock(4).toUInt(0, 4, bigEndian);
          if (titleStrLength <= diinChunk.size) {
            const titleStr = this.readBlock(titleStrLength);
            this._diinTag.title = titleStr.toString(StringType.Latin1);
          }
        } else if (diinName === "DIAR") {
          this.seek(diinChunk.offset);
          const artistStrLength = this.readBlock(4).toUInt(0, 4, bigEndian);
          if (artistStrLength <= diinChunk.size) {
            const artistStr = this.readBlock(artistStrLength);
            this._diinTag.artist = artistStr.toString(StringType.Latin1);
          }
        }
      }
    }

    // Compute audio properties
    if (readProperties) {
      if (lengthDSDSamplesTimeChannels === 0n) {
        // DST compressed
        if (dstFrameRate > 0) {
          lengthDSDSamplesTimeChannels =
            (BigInt(dstNumFrames) * BigInt(sampleRate)) / BigInt(dstFrameRate);
        }
      } else {
        // DSD uncompressed: divide by channel count
        if (channels > 0) {
          lengthDSDSamplesTimeChannels /= BigInt(channels);
        }
      }

      let bitrate = 0;
      if (lengthDSDSamplesTimeChannels > 0n) {
        bitrate = Number(
          (audioDataSizeInBytes * 8n * BigInt(sampleRate)) /
            lengthDSDSamplesTimeChannels /
            1000n,
        );
      }

      this._properties = new DsdiffProperties(
        sampleRate,
        channels,
        lengthDSDSamplesTimeChannels,
        bitrate,
        readStyle,
      );
    }

    // Ensure ID3v2 tag exists
    if (!this._id3v2Tag) {
      this._id3v2Tag = new Id3v2Tag();
      this._isID3InPropChunk = false;
      this._hasID3v2 = false;
    }

    this.refreshCombinedTag();
  }

  private parsePROPChunk(rootIdx: number, bigEndian: boolean): void {
    const propChunkEnd =
      this._chunks[rootIdx].offset + this._chunks[rootIdx].size;
    // Skip "SND " marker at beginning of PROP chunk
    this.seek(this._chunks[rootIdx].offset + 4);

    while (this.tell() + 12 <= propChunkEnd) {
      const propChunkName = this.readBlock(4);
      const propChunkSize = Number(
        this.readBlock(8).toLongLong(bigEndian),
      );

      if (!this.isValidChunkID(propChunkName)) {
        this._valid = false;
        break;
      }

      if (this.tell() + propChunkSize > propChunkEnd) {
        this._valid = false;
        break;
      }

      const chunk: Chunk64 = {
        name: propChunkName,
        size: propChunkSize,
        offset: this.tell(),
        padding: 0,
      };

      this.seek(chunk.size, Position.Current);

      const uPos = this.tell();
      if ((uPos & 0x01) !== 0) {
        const pad = this.readBlock(1);
        if (pad.length !== 1 || pad.get(0) !== 0) {
          this.seek(uPos);
        } else {
          chunk.padding = 1;
        }
      }

      this._childChunks[ChildChunkKind.PROP].push(chunk);
    }
  }

  private parseDIINChunk(rootIdx: number, bigEndian: boolean): void {
    const diinChunkEnd =
      this._chunks[rootIdx].offset + this._chunks[rootIdx].size;
    this.seek(this._chunks[rootIdx].offset);

    while (this.tell() + 12 <= diinChunkEnd) {
      const diinChunkName = this.readBlock(4);
      const diinChunkSize = Number(
        this.readBlock(8).toLongLong(bigEndian),
      );

      if (!this.isValidChunkID(diinChunkName)) {
        this._valid = false;
        break;
      }

      if (this.tell() + diinChunkSize > diinChunkEnd) {
        this._valid = false;
        break;
      }

      const chunk: Chunk64 = {
        name: diinChunkName,
        size: diinChunkSize,
        offset: this.tell(),
        padding: 0,
      };

      this.seek(chunk.size, Position.Current);

      const uPos = this.tell();
      if ((uPos & 0x01) !== 0) {
        const pad = this.readBlock(1);
        if (pad.length !== 1 || pad.get(0) !== 0) {
          this.seek(uPos);
        } else {
          chunk.padding = 1;
        }
      }

      this._childChunks[ChildChunkKind.DIIN].push(chunk);
    }
  }

  // ---------------------------------------------------------------------------
  // Private – chunk manipulation (save helpers)
  // ---------------------------------------------------------------------------

  private setRootChunkData(name: string, data: ByteVector): void {
    const nameVec = ByteVector.fromString(name, StringType.Latin1);
    const idx = this.findChunkIndex(this._chunks, nameVec);

    if (data.isEmpty) {
      if (idx >= 0) this.removeRootChunk(idx);
      return;
    }

    if (idx >= 0) {
      this.updateRootChunk(idx, data);
    } else {
      this.appendRootChunk(nameVec, data);
    }
  }

  private setChildChunkData(
    name: string,
    data: ByteVector,
    kind: ChildChunkKind,
  ): void {
    const nameVec = ByteVector.fromString(name, StringType.Latin1);
    const childChunks = this._childChunks[kind];
    const idx = this.findChunkIndex(childChunks, nameVec);

    if (data.isEmpty) {
      if (idx >= 0) this.removeChildChunk(idx, kind);
      return;
    }

    if (idx >= 0) {
      this.updateChildChunk(idx, data, kind);
    } else {
      this.appendChildChunk(nameVec, data, kind);
    }
  }

  private removeRootChunk(i: number): void {
    const chunkTotalSize =
      this._chunks[i].size + this._chunks[i].padding + 12;

    this._size -= chunkTotalSize;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );
    this.removeBlock(this._chunks[i].offset - 12, chunkTotalSize);

    this._chunks.splice(i, 1);
    for (let k = 0; k < 2; k++) {
      if (this._childChunkIndex[k] > i) {
        this._childChunkIndex[k]--;
      }
    }
    this.updateRootChunkOffsets(i);
  }

  private updateRootChunk(i: number, data: ByteVector): void {
    const oldTotal = this._chunks[i].size + this._chunks[i].padding;
    const newTotal = (data.length + 1) & ~1;
    this._size += newTotal - oldTotal;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    this.writeChunk(
      this._chunks[i].name,
      data,
      this._chunks[i].offset - 12,
      this._chunks[i].size + this._chunks[i].padding + 12,
    );

    this._chunks[i].size = data.length;
    this._chunks[i].padding = data.length & 0x01 ? 1 : 0;
    this.updateRootChunkOffsets(i + 1);
  }

  private appendRootChunk(name: ByteVector, data: ByteVector): void {
    if (this._chunks.length === 0) return;

    const last = this._chunks[this._chunks.length - 1];
    const offset = last.offset + last.size + last.padding;

    const paddingBefore = offset & 1 ? 1 : 0;
    this._size += paddingBefore + ((data.length + 1) & ~1) + 12;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    const existingLen = this.fileLength;
    this.writeChunk(
      name,
      data,
      offset,
      existingLen > offset ? existingLen - offset : 0,
      paddingBefore,
    );

    this._chunks.push({
      name,
      size: data.length,
      offset: offset + 12 + paddingBefore,
      padding: data.length & 0x01 ? 1 : 0,
    });
  }

  private removeChildChunk(i: number, kind: ChildChunkKind): void {
    const childChunks = this._childChunks[kind];
    const removedSize = childChunks[i].size + childChunks[i].padding + 12;

    // Update global size
    this._size -= removedSize;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    // Update parent chunk size
    const parentIdx = this._childChunkIndex[kind];
    this._chunks[parentIdx].size -= removedSize;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._chunks[parentIdx].size), true),
      this._chunks[parentIdx].offset - 8,
      8,
    );

    this.removeBlock(childChunks[i].offset - 12, removedSize);

    if (i + 1 < childChunks.length) {
      childChunks[i + 1].offset = childChunks[i].offset;
      for (let c = i + 2; c < childChunks.length; c++) {
        childChunks[c].offset =
          childChunks[c - 1].offset +
          12 +
          childChunks[c - 1].size +
          childChunks[c - 1].padding;
      }
    }

    childChunks.splice(i, 1);
    this.updateRootChunkOffsets(parentIdx + 1);
  }

  private updateChildChunk(
    i: number,
    data: ByteVector,
    kind: ChildChunkKind,
  ): void {
    const childChunks = this._childChunks[kind];
    const oldTotal = childChunks[i].size + childChunks[i].padding;
    const newTotal = (data.length + 1) & ~1;
    const delta = newTotal - oldTotal;

    // Update global size
    this._size += delta;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    // Update parent chunk size
    const parentIdx = this._childChunkIndex[kind];
    this._chunks[parentIdx].size += delta;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._chunks[parentIdx].size), true),
      this._chunks[parentIdx].offset - 8,
      8,
    );

    this.writeChunk(
      childChunks[i].name,
      data,
      childChunks[i].offset - 12,
      childChunks[i].size + childChunks[i].padding + 12,
    );

    childChunks[i].size = data.length;
    childChunks[i].padding = data.length & 0x01 ? 1 : 0;

    // Update sibling offsets
    for (let c = i + 1; c < childChunks.length; c++) {
      childChunks[c].offset =
        childChunks[c - 1].offset +
        12 +
        childChunks[c - 1].size +
        childChunks[c - 1].padding;
    }

    this.updateRootChunkOffsets(parentIdx + 1);
  }

  private appendChildChunk(
    name: ByteVector,
    data: ByteVector,
    kind: ChildChunkKind,
  ): void {
    const childChunks = this._childChunks[kind];
    let offset = 0;

    if (childChunks.length > 0) {
      const last = childChunks[childChunks.length - 1];
      offset = last.offset + last.size + last.padding;
    } else if (kind === ChildChunkKind.DIIN) {
      let parentIdx = this._childChunkIndex[ChildChunkKind.DIIN];
      if (parentIdx < 0) {
        // Create the DIIN root chunk
        this.setRootChunkData("DIIN", new ByteVector());
        const lastIdx = this._chunks.length - 1;
        if (
          lastIdx >= 0 &&
          this._chunks[lastIdx].name
            .toString(StringType.Latin1) === "DIIN"
        ) {
          parentIdx = lastIdx;
          this._childChunkIndex[ChildChunkKind.DIIN] = lastIdx;
          this._hasDiin = true;
        }
      }
      if (parentIdx >= 0) {
        offset = this._chunks[parentIdx].offset;
      }
    }

    if (offset === 0) return;

    const paddingBefore = offset & 1 ? 1 : 0;
    this._size += paddingBefore + ((data.length + 1) & ~1) + 12;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    // Update parent chunk size
    const parentIdx = this._childChunkIndex[kind];
    this._chunks[parentIdx].size +=
      paddingBefore + ((data.length + 1) & ~1) + 12;
    this.insert(
      ByteVector.fromLongLong(BigInt(this._chunks[parentIdx].size), true),
      this._chunks[parentIdx].offset - 8,
      8,
    );

    const nextRootOffset =
      parentIdx + 1 < this._chunks.length
        ? this._chunks[parentIdx + 1].offset - 12
        : this.fileLength;

    this.writeChunk(
      name,
      data,
      offset,
      nextRootOffset > offset ? nextRootOffset - offset : 0,
      paddingBefore,
    );

    this.updateRootChunkOffsets(parentIdx + 1);

    childChunks.push({
      name,
      size: data.length,
      offset: offset + 12 + paddingBefore,
      padding: data.length & 0x01 ? 1 : 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Private – helpers
  // ---------------------------------------------------------------------------

  private writeChunk(
    name: ByteVector,
    data: ByteVector,
    offset: number,
    replace: number,
    leadingPadding: number = 0,
  ): void {
    const combined = new ByteVector();
    if (leadingPadding) {
      combined.append(ByteVector.fromSize(leadingPadding, 0));
    }
    combined.append(name);
    combined.append(ByteVector.fromLongLong(BigInt(data.length), true));
    combined.append(data);
    if (data.length & 0x01) {
      combined.append(ByteVector.fromSize(1, 0));
    }
    this.insert(combined, offset, replace);
  }

  private updateRootChunkOffsets(startIdx: number): void {
    for (let i = startIdx; i < this._chunks.length; i++) {
      this._chunks[i].offset =
        this._chunks[i - 1].offset +
        12 +
        this._chunks[i - 1].size +
        this._chunks[i - 1].padding;
    }
  }

  private findChunkIndex(chunks: Chunk64[], name: ByteVector): number {
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].name.equals(name)) return i;
    }
    return -1;
  }

  private isValidChunkID(name: ByteVector): boolean {
    if (name.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const c = name.get(i);
      if (c < 32 || c > 126) return false;
    }
    return true;
  }

  private refreshCombinedTag(): void {
    // Priority: ID3v2 > DIIN
    this._combinedTag.setTags([this._id3v2Tag, this._diinTag]);
  }
}
