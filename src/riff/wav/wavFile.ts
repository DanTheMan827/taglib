/** @file WAV file handler. Reads and writes ID3v2 and RIFF INFO tags embedded in WAV/RIFF containers. */

import { ByteVector, StringType } from "../../byteVector.js";
import { RiffFile } from "../riffFile.js";
import { WavProperties } from "./wavProperties.js";
import { RiffInfoTag } from "../infoTag.js";
import { Id3v2Tag } from "../../mpeg/id3v2/id3v2Tag.js";
import { CombinedTag } from "../../combinedTag.js";
import type { Tag } from "../../tag.js";
import type { ReadStyle } from "../../toolkit/types.js";
import type { IOStream } from "../../toolkit/ioStream.js";

/**
 * WAV file handler.
 *
 * WAV is a little-endian RIFF container (`"RIFF"` / `"WAVE"`) that may hold:
 * - `"fmt "` – audio format description
 * - `"data"` – raw audio samples
 * - `"ID3 "` / `"id3 "` – ID3v2 tag
 * - `"LIST"` – with sub-type `"INFO"` → RIFF INFO tag
 */
export class WavFile extends RiffFile {
  /** Audio properties parsed from the `"fmt "` chunk, or `null` if not yet read. */
  private _properties: WavProperties | null = null;
  /** ID3v2 tag read from the `"ID3 "` chunk, or `null` if absent. */
  private _id3v2Tag: Id3v2Tag | null = null;
  /** RIFF INFO tag read from the `"LIST"` / `"INFO"` chunk, or `null` if absent. */
  private _infoTag: RiffInfoTag | null = null;
  /** Priority-ordered combined view of all tags (ID3v2 preferred over INFO). */
  private _combinedTag: CombinedTag;

  /** Zero-based index of the `"ID3 "` chunk in the chunk list, or `-1` if absent. */
  private _id3v2ChunkIndex: number = -1;
  /** Zero-based index of the `"LIST"` chunk containing `"INFO"` data, or `-1` if absent. */
  private _infoChunkIndex: number = -1;

  /**
   * Private constructor — use {@link WavFile.open} to create instances.
   * @param stream - The underlying I/O stream for the WAV file.
   */
  private constructor(stream: IOStream) {
    super(stream, /* bigEndian */ false);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Open and parse a WAV file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing.
   * @returns A fully initialised `WavFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle?: ReadStyle,
  ): Promise<WavFile> {
    const file = new WavFile(stream);
    await file.parseHeader();
    await file.read(readProperties, readStyle);
    return file;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag providing unified access to all tag data.
   * @returns The {@link CombinedTag} for this file (ID3v2 preferred over INFO).
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the audio properties parsed from the `"fmt "` chunk.
   * @returns The {@link WavProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): WavProperties | null {
    return this._properties;
  }

  /**
   * The ID3v2 tag embedded in the `"ID3 "` chunk, or `null` if absent.
   * @returns The {@link Id3v2Tag}, or `null`.
   */
  get id3v2Tag(): Id3v2Tag | null {
    return this._id3v2Tag;
  }

  /**
   * Whether the file currently contains a non-empty ID3v2 tag chunk.
   * Returns `true` if an ID3v2 chunk was found during parsing (regardless of tag validity),
   * matching C++ `hasID3v2Tag()` behavior.
   * @returns `true` if an ID3v2 chunk is present.
   */
  get hasId3v2Tag(): boolean {
    return this._id3v2ChunkIndex >= 0;
  }

  /**
   * The RIFF INFO tag embedded in the `"LIST"` / `"INFO"` chunk, or `null` if absent.
   * Auto-creates an empty INFO tag on first access so callers can always write to it.
   * @returns The {@link RiffInfoTag}.
   */
  get infoTag(): RiffInfoTag {
    if (!this._infoTag) {
      this._infoTag = new RiffInfoTag();
    }
    return this._infoTag;
  }

  /**
   * Whether the file currently contains a RIFF INFO tag.
   * Returns `true` if a `LIST/INFO` chunk was found during parsing.
   * @returns `true` if an INFO tag chunk is present.
   */
  get hasInfoTag(): boolean {
    return this._infoChunkIndex >= 0;
  }

  /**
   * Writes all pending tag changes back to the underlying stream.
   * Matches C++ behavior: removes all existing tag chunks before re-writing.
   * @param version - Optional ID3v2 version to save as (2 or 3; default is 4).
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(version?: number): Promise<boolean> {
    if (this.readOnly) return false;

    // Remove all existing ID3 tag chunks (both case variants), then re-add if non-empty.
    await this.removeAllChunks("ID3 ");
    await this.removeAllChunks("id3 ");
    this._id3v2ChunkIndex = -1;

    if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
      await this.setChunkData("ID3 ", this._id3v2Tag.render(version));
      this._id3v2ChunkIndex = this.chunkCount - 1;
    }

    // Remove all existing LIST chunks, then re-add INFO if non-empty.
    await this.removeAllChunks("LIST");
    this._infoChunkIndex = -1;

    if (this._infoTag && !this._infoTag.isEmpty) {
      const infoData = ByteVector.fromString("INFO", StringType.Latin1);
      infoData.append(this._infoTag.render());
      await this.setChunkData("LIST", infoData);
      this._infoChunkIndex = this.chunkCount - 1;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  /**
   * Reads all chunks and (optionally) audio properties from the parsed chunk list.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle?: ReadStyle): Promise<void> {
    let fmtData: ByteVector | null = null;
    let streamLength = 0;
    let totalSamples = 0;

    for (let i = 0; i < this.chunkCount; i++) {
      const name = this.chunkName(i);

      if (name === "fmt " && readProperties && fmtData === null) {
        fmtData = await this.chunkData(i);
      } else if (name === "data" && readProperties && streamLength === 0) {
        streamLength = this.chunkDataSize(i) + this.chunkPadding(i);
      } else if (name === "fact" && readProperties && totalSamples === 0) {
        const factData = await this.chunkData(i);
        if (factData.length >= 4) {
          totalSamples = factData.toUInt(0, false);
        }
      } else if ((name === "ID3 " || name === "id3 ") && this._id3v2ChunkIndex < 0) {
        this._id3v2ChunkIndex = i;
        this._id3v2Tag = await Id3v2Tag.readFrom(
          this._stream,
          this.chunkOffset(i),
        );
      } else if (name === "LIST") {
        await this.seek(this.chunkOffset(i));
        const subType = (await this.readBlock(4)).toString(StringType.Latin1);
        if (subType === "INFO" && this._infoChunkIndex < 0) {
          this._infoChunkIndex = i;
          const infoSize = this.chunkDataSize(i) - 4;
          if (infoSize > 0) {
            const infoData = await this.readBlock(infoSize);
            this._infoTag = RiffInfoTag.readFrom(infoData);
          }
        }
      }
    }

    // Ensure default ID3v2 tag exists
    if (!this._id3v2Tag) {
      this._id3v2Tag = new Id3v2Tag();
    }
    // Note: _infoTag is only created when an INFO chunk is found in the file or when
    // explicitly accessed via the infoTag getter.  It is NOT auto-created here so that
    // writing via the combined tag (tag.title = "...") only updates ID3v2, matching
    // C++ TagLib where WAV::File::tag() returns only the ID3v2 tag.

    // Build combined tag: ID3v2 is always primary; INFO is included only when present.
    const combinedTags: Tag[] = [this._id3v2Tag];
    if (this._infoTag) combinedTags.push(this._infoTag);
    this._combinedTag.setTags(combinedTags);

    if (readProperties && fmtData) {
      this._properties = new WavProperties(fmtData, streamLength, totalSamples, readStyle);
    }
  }
}
