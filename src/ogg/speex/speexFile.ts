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
  private _tag: XiphComment;
  private _properties: SpeexProperties | null = null;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    this._tag = new XiphComment();
    this.read(readProperties, readStyle);
  }

  tag(): XiphComment {
    return this._tag;
  }

  audioProperties(): SpeexProperties | null {
    return this._properties;
  }

  override save(): boolean {
    if (this.readOnly) {
      return false;
    }

    // Re-render the comment packet with framing bit
    const commentData = this._tag.render(true);
    this.setPacket(1, commentData);

    return super.save();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // Parse comment header (packet 1) — raw XiphComment data with framing bit
    const commentPacket = this.packet(1);
    if (commentPacket.length > 0) {
      this._tag = XiphComment.readFrom(commentPacket, 0);
    }

    if (readProperties) {
      this._properties = new SpeexProperties(this, readStyle);
    }
  }
}
