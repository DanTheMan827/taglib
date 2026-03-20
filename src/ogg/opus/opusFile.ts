/** @file Ogg Opus file format handler. Reads and writes XiphComment tags and Opus audio properties. */

import { ByteVector, StringType } from "../../byteVector.js";
import { IOStream } from "../../toolkit/ioStream.js";
import { ReadStyle } from "../../toolkit/types.js";
import { XiphComment } from "../xiphComment.js";
import { OggFile } from "../oggFile.js";
import { OpusProperties } from "./opusProperties.js";

/** The 8-byte Opus comment packet header "OpusTags". */
const OPUS_TAGS_HEADER = ByteVector.fromString(
  "OpusTags",
  StringType.Latin1,
);

/**
 * Implementation of an Ogg Opus file.
 *
 * Packet 0 — OpusHead identification header (for audio properties).
 * Packet 1 — OpusTags: "OpusTags" (8 bytes) + XiphComment data (no framing bit).
 */
export class OggOpusFile extends OggFile {
  /** The XiphComment tag parsed from packet 1, or a fresh empty tag if absent. */
  private _tag: XiphComment;
  /** Parsed Opus audio properties, or `null` if not yet read. */
  private _properties: OpusProperties | null = null;

  /**
   * Number of header packets in an Opus stream (OpusHead + OpusTags).
   * @returns `2`
   */
  protected override get numHeaderPackets(): number { return 2; }

  /**
   * Private constructor — use {@link OggOpusFile.open} to create instances.
   * @param stream - The underlying I/O stream for the Opus file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new XiphComment();
  }

  /**
   * Open and parse an Ogg Opus file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `OggOpusFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<OggOpusFile> {
    const file = new OggOpusFile(stream);
    await file.read(readProperties, readStyle);
    return file;
  }

  /**
   * Returns the XiphComment tag for this file.
   * @returns The {@link XiphComment} providing access to all Opus comment fields.
   */
  tag(): XiphComment {
    return this._tag;
  }

  /**
   * Returns the audio properties parsed from the OpusHead identification header.
   * @returns The {@link OpusProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): OpusProperties | null {
    return this._properties;
  }

  /**
   * Writes the current XiphComment tag back to the stream as the OpusTags packet (packet 1).
   * @returns `true` on success, `false` if the file is read-only.
   */
  override async save(): Promise<boolean> {
    if (this.readOnly) {
      return false;
    }

    // Re-render: "OpusTags" + rendered comment (no framing bit)
    const commentData = this._tag.render(false);
    const packet = new ByteVector();
    packet.append(ByteVector.fromString("OpusTags", StringType.Latin1));
    packet.append(commentData);
    this.setPacket(1, packet);

    return await super.save();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Reads tags and (optionally) audio properties from the stream.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // Parse comment header (packet 1)
    const commentPacket = await this.packet(1);
    if (
      commentPacket.length > 8 &&
      commentPacket.startsWith(OPUS_TAGS_HEADER)
    ) {
      // XiphComment data starts after the 8-byte "OpusTags" prefix
      this._tag = XiphComment.readFrom(commentPacket, 8);
    }

    if (readProperties) {
      this._properties = await OpusProperties.create(this, readStyle);
    }
  }
}
