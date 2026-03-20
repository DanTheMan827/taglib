/** @file Ogg Vorbis file format handler. Reads and writes XiphComment tags and Vorbis audio properties. */

import { ByteVector, StringType } from "../../byteVector.js";
import { IOStream } from "../../toolkit/ioStream.js";
import { ReadStyle } from "../../toolkit/types.js";
import { XiphComment } from "../xiphComment.js";
import { OggFile } from "../oggFile.js";
import { VorbisProperties } from "./vorbisProperties.js";

/** The 7-byte Vorbis comment packet header prefix: 0x03 + "vorbis". */
const VORBIS_COMMENT_HEADER = ByteVector.fromString(
  "\x03vorbis",
  StringType.Latin1,
);

/**
 * Implementation of an Ogg Vorbis file.
 *
 * Packet 0 — identification header (for audio properties).
 * Packet 1 — comment header: 0x03 + "vorbis" (7 bytes), then XiphComment data,
 *            followed by a framing bit.
 */
export class OggVorbisFile extends OggFile {
  /** The XiphComment tag parsed from packet 1, or a fresh empty tag if absent. */
  private _tag: XiphComment;
  /** Parsed Vorbis audio properties, or `null` if not yet read. */
  private _properties: VorbisProperties | null = null;

  /**
   * Private constructor — use {@link OggVorbisFile.open} to create instances.
   * @param stream - The underlying I/O stream for the Vorbis file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new XiphComment();
  }

  /**
   * Open and parse an Ogg Vorbis file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `OggVorbisFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<OggVorbisFile> {
    const file = new OggVorbisFile(stream);
    await file.read(readProperties, readStyle);
    return file;
  }

  /**
   * Returns the XiphComment tag for this file.
   * @returns The {@link XiphComment} providing access to all Vorbis comment fields.
   */
  tag(): XiphComment {
    return this._tag;
  }

  /**
   * Returns the audio properties parsed from the Vorbis identification header.
   * @returns The {@link VorbisProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): VorbisProperties | null {
    return this._properties;
  }

  /**
   * Writes the current XiphComment tag back to the stream as packet 1.
   * @returns `true` on success, `false` if the file is read-only.
   */
  override async save(): Promise<boolean> {
    if (this.readOnly) {
      return false;
    }

    // Re-render the comment packet: 0x03 + "vorbis" + rendered comment + framing bit
    const commentData = this._tag.render(true);
    const packet = new ByteVector();
    packet.append(ByteVector.fromString("\x03vorbis", StringType.Latin1));
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
      commentPacket.length > 7 &&
      commentPacket.startsWith(VORBIS_COMMENT_HEADER)
    ) {
      // XiphComment data starts after the 7-byte header prefix
      this._tag = XiphComment.readFrom(commentPacket, 7);
    }

    if (readProperties) {
      this._properties = await VorbisProperties.create(this, readStyle);
    }
  }
}
