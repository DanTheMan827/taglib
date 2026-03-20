/** @file Ogg Speex file format handler. Reads and writes XiphComment tags and Speex audio properties. */

import { IOStream } from "../../toolkit/ioStream.js";
import { ReadStyle } from "../../toolkit/types.js";
import { XiphComment } from "../xiphComment.js";
import { OggFile } from "../oggFile.js";
import { SpeexProperties } from "./speexProperties.js";

/**
 * Implementation of an Ogg Speex file.
 *
 * Packet 0 — Speex identification header (for audio properties).
 * Packet 1 — XiphComment data with framing bit (like Vorbis).
 */
export class OggSpeexFile extends OggFile {
  /** The XiphComment tag parsed from packet 1, or a fresh empty tag if absent. */
  private _tag: XiphComment;
  /** Parsed Speex audio properties, or `null` if not yet read. */
  private _properties: SpeexProperties | null = null;

  /**
   * Number of header packets in a Speex stream (identification + comment).
   * @returns `2`
   */
  protected override get numHeaderPackets(): number { return 2; }

  /**
   * Private constructor — use {@link OggSpeexFile.open} to create instances.
   * @param stream - The underlying I/O stream for the Speex file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new XiphComment();
  }

  /**
   * Open and parse an Ogg Speex file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `OggSpeexFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<OggSpeexFile> {
    const file = new OggSpeexFile(stream);
    await file.read(readProperties, readStyle);
    return file;
  }

  /**
   * Returns the XiphComment tag for this file.
   * @returns The {@link XiphComment} providing access to all Speex comment fields.
   */
  tag(): XiphComment {
    return this._tag;
  }

  /**
   * Returns the audio properties parsed from the Speex identification header.
   * @returns The {@link SpeexProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): SpeexProperties | null {
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

    // Re-render the comment packet with framing bit
    const commentData = this._tag.render(true);
    this.setPacket(1, commentData);

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
    // Parse comment header (packet 1) — raw XiphComment data with framing bit
    const commentPacket = await this.packet(1);
    if (commentPacket.length > 0) {
      this._tag = XiphComment.readFrom(commentPacket, 0);
    }

    if (readProperties) {
      this._properties = await SpeexProperties.create(this, readStyle);
    }
  }
}
