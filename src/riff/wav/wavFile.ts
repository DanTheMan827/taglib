import { ByteVector, StringType } from "../../byteVector.js";
import { RiffFile } from "../riffFile.js";
import { WavProperties } from "./wavProperties.js";
import { RiffInfoTag } from "../infoTag.js";
import { Id3v2Tag } from "../../mpeg/id3v2/id3v2Tag.js";
import { CombinedTag } from "../../combinedTag.js";
import type { Tag } from "../../tag.js";
import type { offset_t, ReadStyle } from "../../toolkit/types.js";
import type { IOStream } from "../../toolkit/ioStream.js";

/**
 * WAV file handler.
 *
 * WAV is a little-endian RIFF container ("RIFF" / "WAVE") that may hold:
 *   "fmt " – audio format description
 *   "data" – raw audio samples
 *   "ID3 " / "id3 " – ID3v2 tag
 *   "LIST" – with sub-type "INFO" → RIFF INFO tag
 */
export class WavFile extends RiffFile {
  private _properties: WavProperties | null = null;
  private _id3v2Tag: Id3v2Tag | null = null;
  private _infoTag: RiffInfoTag | null = null;
  private _combinedTag: CombinedTag;

  private _id3v2ChunkIndex: number = -1;
  private _infoChunkIndex: number = -1;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle?: ReadStyle,
  ) {
    super(stream, /* bigEndian */ false);
    this._combinedTag = new CombinedTag([]);
    this.read(readProperties, readStyle);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._combinedTag;
  }

  audioProperties(): WavProperties | null {
    return this._properties;
  }

  get id3v2Tag(): Id3v2Tag | null {
    return this._id3v2Tag;
  }

  get infoTag(): RiffInfoTag | null {
    return this._infoTag;
  }

  save(): boolean {
    if (this.readOnly) return false;

    // Save ID3v2
    if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
      const rendered = this._id3v2Tag.render();
      this.setChunkData("ID3 ", rendered);
    } else if (this._id3v2ChunkIndex >= 0) {
      this.removeChunk("ID3 ");
    }

    // Save INFO
    if (this._infoTag && !this._infoTag.isEmpty) {
      const infoData = ByteVector.fromString("INFO", StringType.Latin1);
      infoData.append(this._infoTag.render());
      this.setChunkData("LIST", infoData);
    } else if (this._infoChunkIndex >= 0) {
      this.removeChunk("LIST");
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle?: ReadStyle): void {
    let fmtData: ByteVector | null = null;
    let streamLength = 0;

    for (let i = 0; i < this.chunkCount; i++) {
      const name = this.chunkName(i);

      if (name === "fmt " && readProperties) {
        fmtData = this.chunkData(i);
      } else if (name === "data" && readProperties) {
        streamLength = this.chunkDataSize(i);
      } else if (name === "ID3 " || name === "id3 ") {
        this._id3v2ChunkIndex = i;
        this._id3v2Tag = Id3v2Tag.readFrom(
          this._stream,
          this.chunkOffset(i),
        );
      } else if (name === "LIST") {
        this.seek(this.chunkOffset(i));
        const subType = this.readBlock(4).toString(StringType.Latin1);
        if (subType === "INFO") {
          this._infoChunkIndex = i;
          const infoSize = this.chunkDataSize(i) - 4;
          if (infoSize > 0) {
            const infoData = this.readBlock(infoSize);
            this._infoTag = RiffInfoTag.readFrom(infoData);
          }
        }
      }
    }

    // Build combined tag (ID3v2 higher priority)
    this._combinedTag.setTags([this._id3v2Tag, this._infoTag]);

    if (readProperties && fmtData) {
      this._properties = new WavProperties(fmtData, streamLength, readStyle);
    }
  }
}
