import { ByteVector, StringType } from "../../byteVector.js";
import { IOStream } from "../../toolkit/ioStream.js";
import { ReadStyle } from "../../toolkit/types.js";
import { XiphComment } from "../xiphComment.js";
import { OggFile } from "../oggFile.js";
import { VorbisProperties } from "./vorbisProperties.js";

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
  private _tag: XiphComment;
  private _properties: VorbisProperties | null = null;

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

  audioProperties(): VorbisProperties | null {
    return this._properties;
  }

  override save(): boolean {
    if (this.readOnly) {
      return false;
    }

    // Re-render the comment packet: 0x03 + "vorbis" + rendered comment + framing bit
    const commentData = this._tag.render(true);
    const packet = new ByteVector();
    packet.append(ByteVector.fromString("\x03vorbis", StringType.Latin1));
    packet.append(commentData);
    this.setPacket(1, packet);

    return super.save();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // Parse comment header (packet 1)
    const commentPacket = this.packet(1);
    if (
      commentPacket.length > 7 &&
      commentPacket.startsWith(VORBIS_COMMENT_HEADER)
    ) {
      // XiphComment data starts after the 7-byte header prefix
      this._tag = XiphComment.readFrom(commentPacket, 7);
    }

    if (readProperties) {
      this._properties = new VorbisProperties(this, readStyle);
    }
  }
}
