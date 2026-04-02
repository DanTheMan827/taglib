/** @packageDocumentation AIFF/AIFC file handler. Reads and writes ID3v2 tags embedded in AIFF/FORM containers. */

import { ByteVector } from "../../byteVector.js";
import { RiffFile } from "../riffFile.js";
import { AiffProperties } from "./aiffProperties.js";
import { Id3v2Tag } from "../../mpeg/id3v2/id3v2Tag.js";
import type { Tag } from "../../tag.js";
import type { ReadStyle } from "../../toolkit/types.js";
import type { IOStream } from "../../toolkit/ioStream.js";

/**
 * AIFF / AIFC file handler.
 *
 * AIFF is a big-endian RIFF-like container (`"FORM"` / `"AIFF"` or `"AIFC"`):
 * - `"COMM"` – common audio properties
 * - `"SSND"` – sound data
 * - `"ID3 "` / `"id3 "` – ID3v2 tag
 */
export class AiffFile extends RiffFile {
  /** Audio properties parsed from the `"COMM"` chunk, or `null` if not yet read. */
  private _properties: AiffProperties | null = null;
  /** ID3v2 tag read from the `"ID3 "` chunk, or `null` if absent. */
  private _id3v2Tag: Id3v2Tag | null = null;
  /** Whether an ID3v2 chunk was found on disk during parsing. */
  private _hasId3v2Tag: boolean = false;

  /**
   * Private constructor — use {@link AiffFile.open} to create instances.
   * @param stream - The underlying I/O stream for the AIFF file.
   */
  private constructor(stream: IOStream) {
    super(stream, /* bigEndian */ true);
  }

  /**
   * Open and parse an AIFF file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing.
   * @returns A fully initialised `AiffFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle?: ReadStyle,
  ): Promise<AiffFile> {
    const file = new AiffFile(stream);
    await file.parseHeader();
    await file.read(readProperties, readStyle);
    return file;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the ID3v2 tag for this file.
   * @returns The {@link Id3v2Tag}, or `null` if not yet loaded.
   */
  tag(): Tag | null {
    return this._id3v2Tag;
  }

  /**
   * Returns the audio properties parsed from the `"COMM"` chunk.
   * @returns The {@link AiffProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): AiffProperties | null {
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
   * Whether the file contained an ID3v2 chunk when it was opened.
   * @returns `true` if an `"ID3 "` chunk was found during parsing.
   */
  get hasId3v2Tag(): boolean {
    return this._hasId3v2Tag;
  }

  /**
   * Writes all pending tag changes back to the underlying stream.
   * Matches C++ behavior: always removes all existing ID3 chunks first,
   * then re-appends a fresh `"ID3 "` chunk if the tag is non-empty.
   * @param version - Optional ID3v2 version to save as.
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(version?: number): Promise<boolean> {
    if (this.readOnly) return false;

    // Remove all existing ID3 tag chunks (both case variants) before re-writing.
    await this.removeChunk("ID3 ");
    await this.removeChunk("id3 ");

    if (this._id3v2Tag && !this._id3v2Tag.isEmpty) {
      const rendered = this._id3v2Tag.render(version);
      await this.setChunkData("ID3 ", rendered);
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
    let commData: ByteVector | null = null;
    let streamLength = 0;

    for (let i = 0; i < this.chunkCount; i++) {
      const name = this.chunkName(i);

      if (name === "COMM" && readProperties) {
        commData = await this.chunkData(i);
      } else if (name === "SSND" && readProperties) {
        streamLength = this.chunkDataSize(i) + this.chunkPadding(i);
      } else if ((name === "ID3 " || name === "id3 ") && !this._id3v2Tag) {
        this._id3v2Tag = await Id3v2Tag.readFrom(
          this._stream,
          this.chunkOffset(i),
        );
        this._hasId3v2Tag = true;
      }
    }

    // Ensure default tag exists
    if (!this._id3v2Tag) {
      this._id3v2Tag = new Id3v2Tag();
    }

    if (readProperties && commData) {
      this._properties = new AiffProperties(commData, streamLength, readStyle);
    }
  }
}
