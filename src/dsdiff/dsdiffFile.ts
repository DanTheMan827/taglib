/** @file DSDIFF (DSD Interchange File Format) file handler. */
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

/**
 * Identifies which tag types to strip from a DSDIFF file.
 * Values are bitflags that can be combined with `|`.
 */
export enum DsdiffTagType {
  /** The ID3v2 chunk. */
  ID3v2 = 1,
  /** The DIIN sub-chunks (title + artist). */
  DIIN = 2,
}

/**
 * Describes a single chunk in a DSDIFF file using 64-bit sizes.
 * Offsets and sizes are in bytes relative to the start of the file.
 */
interface Chunk64 {
  /** Four-character chunk identifier (e.g. `"PROP"`, `"DSD "`). */
  name: ByteVector;
  /** File offset of the first byte of the chunk *payload* (after the 12-byte header). */
  offset: number;
  /** Payload size in bytes (not including the 12-byte header). */
  size: number;
  /** 1 if a zero-padding byte follows the payload to reach an even boundary, otherwise 0. */
  padding: number;
}

/**
 * Identifies the two supported container chunks that can hold child chunks.
 */
enum ChildChunkKind {
  /** The "PROP" (Sound Property) container chunk. */
  PROP = 0,
  /** The "DIIN" (DSD Interchange Information) container chunk. */
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
  /** The ID3v2 tag, if present. */
  private _id3v2Tag: Id3v2Tag | null = null;
  /** The DIIN tag, if present. */
  private _diinTag: DsdiffDiinTag | null = null;
  /** Combined tag that delegates to the available sub-tags. */
  private _combinedTag: CombinedTag;
  /** Parsed audio properties. */
  private _properties: DsdiffProperties | null = null;

  // Container-level metadata
  /** Total file size as recorded in the FRM8 header (bytes, excluding the 12-byte FRM8 header). */
  private _size: number = 0;
  /** All root-level chunks discovered during parsing. */
  private _chunks: Chunk64[] = [];
  /** Child chunks for the PROP and DIIN container chunks (indexed by {@link ChildChunkKind}). */
  private _childChunks: [Chunk64[], Chunk64[]] = [[], []];
  /** Index into `_chunks` for the PROP and DIIN root chunks, or -1 if absent. */
  private _childChunkIndex: [number, number] = [-1, -1];
  /** Whether the ID3v2 tag lives inside the PROP chunk rather than at the root level. */
  private _isID3InPropChunk: boolean = false;
  /** Whether an ID3v2 tag was found in the file. */
  private _hasID3v2: boolean = false;
  /** Whether a DIIN chunk was found in the file. */
  private _hasDiin: boolean = false;
  /** Four-character chunk ID used for the ID3v2 tag (either `"ID3 "` or `"id3 "`). */
  private _id3v2TagChunkID: string = "ID3 ";

  /**
   * Private constructor — use {@link DsdiffFile.open} to create instances.
   * @param stream The underlying I/O stream.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Opens a DSDIFF file and parses its metadata.
   * @param stream The I/O stream to read from.
   * @param readProperties Whether to parse audio properties (default `true`).
   * @param readStyle Accuracy / speed trade-off for property reading.
   * @returns A fully initialised {@link DsdiffFile} instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<DsdiffFile> {
    const f = new DsdiffFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid DSDIFF file.
   * Requires "FRM8" at offset 0 and "DSD " at offset 12.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const id = await stream.readBlock(16);
    if (id.length < 16) return false;

    const frm8 = ByteVector.fromString("FRM8", StringType.Latin1);
    const dsd = ByteVector.fromString("DSD ", StringType.Latin1);
    return id.startsWith(frm8) && id.containsAt(dsd, 12);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag (ID3v2 with DIIN fallback) for this file.
   * @returns The active {@link CombinedTag}.
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the parsed audio properties, or `null` if properties were not read.
   * @returns The {@link DsdiffProperties} or `null`.
   */
  audioProperties(): DsdiffProperties | null {
    return this._properties;
  }

  /**
   * Writes all pending tag changes back to the underlying stream.
   * @param version ID3v2 version to use when rendering the ID3v2 tag (3 or 4, default 4).
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(version: number = 4): Promise<boolean> {
    if (this.readOnly) return false;

    // Save ID3v2 tag
    if (this._id3v2Tag) {
      if (!this._id3v2Tag.isEmpty) {
        const rendered = this._id3v2Tag.render(version);
        if (this._isID3InPropChunk) {
          await this.setChildChunkData(
            this._id3v2TagChunkID,
            rendered,
            ChildChunkKind.PROP,
          );
        } else {
          await this.setRootChunkData(
            this._id3v2TagChunkID,
            rendered,
          );
        }
        this._hasID3v2 = true;
      } else {
        if (this._isID3InPropChunk) {
          await this.setChildChunkData(
            this._id3v2TagChunkID,
            new ByteVector(),
            ChildChunkKind.PROP,
          );
        } else {
          await this.setRootChunkData(this._id3v2TagChunkID, new ByteVector());
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
        await this.setChildChunkData("DITI", titleData, ChildChunkKind.DIIN);
      } else {
        await this.setChildChunkData("DITI", new ByteVector(), ChildChunkKind.DIIN);
      }

      if (this._diinTag.artist !== "") {
        const artistData = new ByteVector();
        artistData.append(
          ByteVector.fromUInt(this._diinTag.artist.length, true),
        );
        artistData.append(
          ByteVector.fromString(this._diinTag.artist, StringType.Latin1),
        );
        await this.setChildChunkData("DIAR", artistData, ChildChunkKind.DIIN);
      } else {
        await this.setChildChunkData("DIAR", new ByteVector(), ChildChunkKind.DIIN);
      }

      // If both sub-chunks are now empty, remove the DIIN container entirely.
      if (this._diinTag.title === "" && this._diinTag.artist === "") {
        await this.setRootChunkData("DIIN", new ByteVector());
        this._childChunkIndex[ChildChunkKind.DIIN] = -1;
        this._childChunks[ChildChunkKind.DIIN] = [];
        this._hasDiin = false;
      }
    }

    return true;
  }

  /**
   * Removes the specified tag types from the file.
   *
   * Passing {@link DsdiffTagType.ID3v2} removes the ID3v2 chunk, passing
   * {@link DsdiffTagType.DIIN} removes the DIIN sub-chunks and container, and
   * passing both (or omitting the argument) removes all tags.
   *
   * @param tags Bitmask of tag types to remove (default: all tags).
   */
  async strip(tags: DsdiffTagType = DsdiffTagType.ID3v2 | DsdiffTagType.DIIN): Promise<void> {
    if (tags & DsdiffTagType.ID3v2) {
      if (this._isID3InPropChunk) {
        await this.setChildChunkData(this._id3v2TagChunkID, new ByteVector(), ChildChunkKind.PROP);
      } else {
        await this.setRootChunkData(this._id3v2TagChunkID, new ByteVector());
      }
      this._id3v2Tag = null;
      this._hasID3v2 = false;
    }
    if (tags & DsdiffTagType.DIIN) {
      // Remove sub-chunks then the DIIN root container.
      await this.setChildChunkData("DITI", new ByteVector(), ChildChunkKind.DIIN);
      await this.setChildChunkData("DIAR", new ByteVector(), ChildChunkKind.DIIN);
      await this.setRootChunkData("DIIN", new ByteVector());
      this._childChunkIndex[ChildChunkKind.DIIN] = -1;
      this._childChunks[ChildChunkKind.DIIN] = [];
      this._diinTag = null;
      this._hasDiin = false;
    }
    this.refreshCombinedTag();
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

  /** Whether the file contains an ID3v2 tag. */
  get hasID3v2Tag(): boolean {
    return this._hasID3v2;
  }

  /** Whether the file contains a DIIN chunk. */
  get hasDIINTag(): boolean {
    return this._hasDiin;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads and parses the DSDIFF file structure from the stream.
   * @param readProperties Whether to parse audio properties.
   * @param readStyle Accuracy / speed trade-off hint.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    const bigEndian = true;

    // Read FRM8 container header
    await this.seek(0);
    await this.readBlock(4); // "FRM8"
    this._size = Number((await this.readBlock(8)).toLongLong(bigEndian));
    await this.readBlock(4); // "DSD "

    // Walk all root-level chunks
    while ((await this.tell()) + 12 <= (await this.fileLength())) {
      const chunkName = await this.readBlock(4);
      const chunkSize = Number((await this.readBlock(8)).toLongLong(bigEndian));

      if (!this.isValidChunkID(chunkName)) {
        this._valid = false;
        break;
      }

      if ((await this.tell()) + chunkSize > (await this.fileLength())) {
        this._valid = false;
        break;
      }

      const chunk: Chunk64 = {
        name: chunkName,
        size: chunkSize,
        offset: (await this.tell()),
        padding: 0,
      };

      await this.seek(chunk.size, Position.Current);

      // Check padding byte
      const posNotPadded = (await this.tell());
      if ((posNotPadded & 0x01) !== 0) {
        const iByte = await this.readBlock(1);
        if (iByte.length !== 1 || iByte.get(0) !== 0) {
          await this.seek(posNotPadded);
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
        await this.seek(this._chunks[i].offset);
        audioDataSizeInBytes = BigInt(this._chunks[i].size);

        while ((await this.tell()) + 12 <= dstChunkEnd) {
          const dstChunkName = await this.readBlock(4);
          const dstChunkSize = Number(
            (await this.readBlock(8)).toLongLong(bigEndian),
          );

          if (!this.isValidChunkID(dstChunkName)) {
            this._valid = false;
            break;
          }

          const frte = ByteVector.fromString("FRTE", StringType.Latin1);
          if (dstChunkName.startsWith(frte)) {
            dstNumFrames = (await this.readBlock(4)).toUInt(0, 4, bigEndian);
            dstFrameRate = (await this.readBlock(2)).toUShort(bigEndian);
            break;
          }

          await this.seek(dstChunkSize, Position.Current);
          const uPos = (await this.tell());
          if ((uPos & 0x01) !== 0) {
            const pad = await this.readBlock(1);
            if (pad.length !== 1 || pad.get(0) !== 0) {
              await this.seek(uPos);
            }
          }
        }
      } else if (chunkNameStr === "PROP") {
        this._childChunkIndex[ChildChunkKind.PROP] = i;
        await this.parsePROPChunk(i, bigEndian);
      } else if (chunkNameStr === "DIIN") {
        this._childChunkIndex[ChildChunkKind.DIIN] = i;
        this._hasDiin = true;
        await this.parseDIINChunk(i, bigEndian);
      } else if (chunkNameStr === "ID3 " || chunkNameStr === "id3 ") {
        this._id3v2TagChunkID = chunkNameStr;
        this._id3v2Tag = await Id3v2Tag.readFrom(
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
        this._id3v2Tag = await Id3v2Tag.readFrom(this._stream, propChunk.offset);
        this._isID3InPropChunk = true;
        this._hasID3v2 = true;
      } else if (propName === "FS  ") {
        await this.seek(propChunk.offset);
        sampleRate = (await this.readBlock(4)).toUInt(0, 4, bigEndian);
      } else if (propName === "CHNL") {
        await this.seek(propChunk.offset);
        channels = (await this.readBlock(2)).toShort(0, bigEndian);
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
          await this.seek(diinChunk.offset);
          const titleStrLength = (await this.readBlock(4)).toUInt(0, 4, bigEndian);
          if (titleStrLength <= diinChunk.size) {
            const titleStr = await this.readBlock(titleStrLength);
            this._diinTag.title = titleStr.toString(StringType.Latin1);
          }
        } else if (diinName === "DIAR") {
          await this.seek(diinChunk.offset);
          const artistStrLength = (await this.readBlock(4)).toUInt(0, 4, bigEndian);
          if (artistStrLength <= diinChunk.size) {
            const artistStr = await this.readBlock(artistStrLength);
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

  /**
   * Parses the child chunks of the PROP (Sound Property) container chunk.
   * @param rootIdx Index of the PROP chunk in `_chunks`.
   * @param bigEndian Whether integers are big-endian (always `true` for DSDIFF).
   */
  private async parsePROPChunk(rootIdx: number, bigEndian: boolean): Promise<void> {
    const propChunkEnd =
      this._chunks[rootIdx].offset + this._chunks[rootIdx].size;
    // Skip "SND " marker at beginning of PROP chunk
    await this.seek(this._chunks[rootIdx].offset + 4);

    while ((await this.tell()) + 12 <= propChunkEnd) {
      const propChunkName = await this.readBlock(4);
      const propChunkSize = Number(
        (await this.readBlock(8)).toLongLong(bigEndian),
      );

      if (!this.isValidChunkID(propChunkName)) {
        this._valid = false;
        break;
      }

      if ((await this.tell()) + propChunkSize > propChunkEnd) {
        this._valid = false;
        break;
      }

      const chunk: Chunk64 = {
        name: propChunkName,
        size: propChunkSize,
        offset: (await this.tell()),
        padding: 0,
      };

      await this.seek(chunk.size, Position.Current);

      const uPos = (await this.tell());
      if ((uPos & 0x01) !== 0) {
        const pad = await this.readBlock(1);
        if (pad.length !== 1 || pad.get(0) !== 0) {
          await this.seek(uPos);
        } else {
          chunk.padding = 1;
        }
      }

      this._childChunks[ChildChunkKind.PROP].push(chunk);
    }
  }

  /**
   * Parses the child chunks of the DIIN (DSD Interchange Information) container chunk.
   * @param rootIdx Index of the DIIN chunk in `_chunks`.
   * @param bigEndian Whether integers are big-endian (always `true` for DSDIFF).
   */
  private async parseDIINChunk(rootIdx: number, bigEndian: boolean): Promise<void> {
    const diinChunkEnd =
      this._chunks[rootIdx].offset + this._chunks[rootIdx].size;
    await this.seek(this._chunks[rootIdx].offset);

    while ((await this.tell()) + 12 <= diinChunkEnd) {
      const diinChunkName = await this.readBlock(4);
      const diinChunkSize = Number(
        (await this.readBlock(8)).toLongLong(bigEndian),
      );

      if (!this.isValidChunkID(diinChunkName)) {
        this._valid = false;
        break;
      }

      if ((await this.tell()) + diinChunkSize > diinChunkEnd) {
        this._valid = false;
        break;
      }

      const chunk: Chunk64 = {
        name: diinChunkName,
        size: diinChunkSize,
        offset: (await this.tell()),
        padding: 0,
      };

      await this.seek(chunk.size, Position.Current);

      const uPos = (await this.tell());
      if ((uPos & 0x01) !== 0) {
        const pad = await this.readBlock(1);
        if (pad.length !== 1 || pad.get(0) !== 0) {
          await this.seek(uPos);
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

  /**
   * Writes data to a root-level chunk, creating or removing it as needed.
   * @param name Four-character chunk name.
   * @param data Payload to write; an empty vector removes the chunk.
   */
  private async setRootChunkData(name: string, data: ByteVector): Promise<void> {
    const nameVec = ByteVector.fromString(name, StringType.Latin1);
    const idx = this.findChunkIndex(this._chunks, nameVec);

    if (data.isEmpty) {
      if (idx >= 0) await this.removeRootChunk(idx);
      return;
    }

    if (idx >= 0) {
      await this.updateRootChunk(idx, data);
    } else {
      await this.appendRootChunk(nameVec, data);
    }
  }

  /**
   * Writes data to a child chunk inside a container chunk, creating or removing it as needed.
   * @param name Four-character chunk name.
   * @param data Payload to write; an empty vector removes the chunk.
   * @param kind Which container chunk (PROP or DIIN) to operate on.
   */
  private async setChildChunkData(
    name: string,
    data: ByteVector,
    kind: ChildChunkKind,
  ): Promise<void> {
    const nameVec = ByteVector.fromString(name, StringType.Latin1);
    const childChunks = this._childChunks[kind];
    const idx = this.findChunkIndex(childChunks, nameVec);

    if (data.isEmpty) {
      if (idx >= 0) await this.removeChildChunk(idx, kind);
      return;
    }

    if (idx >= 0) {
      await this.updateChildChunk(idx, data, kind);
    } else {
      await this.appendChildChunk(nameVec, data, kind);
    }
  }

  /**
   * Removes a root-level chunk by index, updating the file and chunk list.
   * @param i Index into `_chunks` of the chunk to remove.
   */
  private async removeRootChunk(i: number): Promise<void> {
    const chunkTotalSize =
      this._chunks[i].size + this._chunks[i].padding + 12;

    this._size -= chunkTotalSize;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );
    await this.removeBlock(this._chunks[i].offset - 12, chunkTotalSize);

    this._chunks.splice(i, 1);
    for (let k = 0; k < 2; k++) {
      if (this._childChunkIndex[k] > i) {
        this._childChunkIndex[k]--;
        // The container shifted back by chunkTotalSize; update its children's
        // absolute offsets so subsequent child-chunk operations are correct.
        for (const child of this._childChunks[k]) {
          child.offset -= chunkTotalSize;
        }
      }
    }
    this.updateRootChunkOffsets(i);
  }

  /**
   * Replaces the payload of a root-level chunk in place.
   * @param i Index into `_chunks` of the chunk to update.
   * @param data New payload to write.
   */
  private async updateRootChunk(i: number, data: ByteVector): Promise<void> {
    const oldTotal = this._chunks[i].size + this._chunks[i].padding;
    const newTotal = (data.length + 1) & ~1;
    this._size += newTotal - oldTotal;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    await this.writeChunk(
      this._chunks[i].name,
      data,
      this._chunks[i].offset - 12,
      this._chunks[i].size + this._chunks[i].padding + 12,
    );

    this._chunks[i].size = data.length;
    this._chunks[i].padding = data.length & 0x01 ? 1 : 0;
    this.updateRootChunkOffsets(i + 1);
  }

  /**
   * Appends a new root-level chunk at the end of the file.
   * @param name Four-character chunk identifier.
   * @param data Payload to write.
   */
  private async appendRootChunk(name: ByteVector, data: ByteVector): Promise<void> {
    if (this._chunks.length === 0) return;

    const last = this._chunks[this._chunks.length - 1];
    const offset = last.offset + last.size + last.padding;

    const paddingBefore = offset & 1 ? 1 : 0;
    this._size += paddingBefore + ((data.length + 1) & ~1) + 12;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    const existingLen = (await this.fileLength());
    await this.writeChunk(
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

  /**
   * Removes a child chunk from a container chunk by index.
   * @param i Index of the child chunk within the container's child list.
   * @param kind Which container chunk (PROP or DIIN) to operate on.
   */
  private async removeChildChunk(i: number, kind: ChildChunkKind): Promise<void> {
    const childChunks = this._childChunks[kind];
    const removedSize = childChunks[i].size + childChunks[i].padding + 12;

    // Update global size
    this._size -= removedSize;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    // Update parent chunk size
    const parentIdx = this._childChunkIndex[kind];
    this._chunks[parentIdx].size -= removedSize;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._chunks[parentIdx].size), true),
      this._chunks[parentIdx].offset - 8,
      8,
    );

    await this.removeBlock(childChunks[i].offset - 12, removedSize);

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

  /**
   * Replaces the payload of a child chunk inside a container chunk.
   * @param i Index of the child chunk within the container's child list.
   * @param data New payload to write.
   * @param kind Which container chunk (PROP or DIIN) to operate on.
   */
  private async updateChildChunk(
    i: number,
    data: ByteVector,
    kind: ChildChunkKind,
  ): Promise<void> {
    const childChunks = this._childChunks[kind];
    const oldTotal = childChunks[i].size + childChunks[i].padding;
    const newTotal = (data.length + 1) & ~1;
    const delta = newTotal - oldTotal;

    // Update global size
    this._size += delta;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    // Update parent chunk size
    const parentIdx = this._childChunkIndex[kind];
    this._chunks[parentIdx].size += delta;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._chunks[parentIdx].size), true),
      this._chunks[parentIdx].offset - 8,
      8,
    );

    await this.writeChunk(
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

  /**
   * Appends a new child chunk inside a container chunk.
   * @param name Four-character chunk identifier.
   * @param data Payload to write.
   * @param kind Which container chunk (PROP or DIIN) to append into.
   */
  private async appendChildChunk(
    name: ByteVector,
    data: ByteVector,
    kind: ChildChunkKind,
  ): Promise<void> {
    const childChunks = this._childChunks[kind];
    let offset = 0;

    if (childChunks.length > 0) {
      const last = childChunks[childChunks.length - 1];
      offset = last.offset + last.size + last.padding;
    } else if (kind === ChildChunkKind.DIIN) {
      let parentIdx = this._childChunkIndex[ChildChunkKind.DIIN];
      if (parentIdx < 0) {
        // Create the DIIN root chunk as an empty container, then append into it.
        // NOTE: setRootChunkData skips creation when data is empty, so we must
        // use appendRootChunk directly.
        const diinName = ByteVector.fromString("DIIN", StringType.Latin1);
        await this.appendRootChunk(diinName, new ByteVector());
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
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._size), true),
      4,
      8,
    );

    // Update parent chunk size
    const parentIdx = this._childChunkIndex[kind];
    this._chunks[parentIdx].size +=
      paddingBefore + ((data.length + 1) & ~1) + 12;
    await this.insert(
      ByteVector.fromLongLong(BigInt(this._chunks[parentIdx].size), true),
      this._chunks[parentIdx].offset - 8,
      8,
    );

    const nextRootOffset =
      parentIdx + 1 < this._chunks.length
        ? this._chunks[parentIdx + 1].offset - 12
        : (await this.fileLength());

    await this.writeChunk(
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

  /**
   * Writes a DSDIFF chunk (header + payload + optional padding) to the stream.
   * @param name Four-character chunk identifier.
   * @param data Chunk payload.
   * @param offset File offset at which to write the chunk.
   * @param replace Number of bytes at `offset` to overwrite.
   * @param leadingPadding Optional number of zero-padding bytes to prepend.
   */
  private async writeChunk(
    name: ByteVector,
    data: ByteVector,
    offset: number,
    replace: number,
    leadingPadding: number = 0,
  ): Promise<void> {
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
    await this.insert(combined, offset, replace);
  }

  /**
   * Recalculates the file offsets of root chunks starting at `startIdx`.
   * Must be called after any insertion or removal that shifts data.
   * @param startIdx First index in `_chunks` whose offset needs updating.
   */
  private updateRootChunkOffsets(startIdx: number): void {
    for (let i = startIdx; i < this._chunks.length; i++) {
      this._chunks[i].offset =
        this._chunks[i - 1].offset +
        12 +
        this._chunks[i - 1].size +
        this._chunks[i - 1].padding;
    }
  }

  /**
   * Searches a chunk list for a chunk with the given name.
   * @param chunks The list of chunks to search.
   * @param name The four-character chunk identifier to look for.
   * @returns The index of the matching chunk, or -1 if not found.
   */
  private findChunkIndex(chunks: Chunk64[], name: ByteVector): number {
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].name.equals(name)) return i;
    }
    return -1;
  }

  /**
   * Returns `true` if `name` is a valid four-character printable ASCII chunk identifier.
   * @param name The byte vector to validate.
   * @returns `true` if the name consists of exactly four printable ASCII bytes.
   */
  private isValidChunkID(name: ByteVector): boolean {
    if (name.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const c = name.get(i);
      if (c < 32 || c > 126) return false;
    }
    return true;
  }

  /** Rebuilds `_combinedTag` from the current set of sub-tags (ID3v2 and DIIN). */
  private refreshCombinedTag(): void {
    // Priority: ID3v2 > DIIN
    this._combinedTag.setTags([this._id3v2Tag, this._diinTag]);
  }
}
