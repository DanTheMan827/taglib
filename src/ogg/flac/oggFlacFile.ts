import { ByteVector, StringType } from "../../byteVector.js";
import { IOStream } from "../../toolkit/ioStream.js";
import { ReadStyle } from "../../toolkit/types.js";
import { XiphComment } from "../xiphComment.js";
import { OggFile } from "../oggFile.js";
import { FlacProperties } from "../../flac/flacProperties.js";

const OGG_FLAC_PREFIX = ByteVector.fromString("\x7FFLAC", StringType.Latin1);
const FLAC_STREAMINFO_MAGIC = ByteVector.fromString(
  "fLaC",
  StringType.Latin1,
);

/**
 * Implementation of a FLAC-in-OGG file.
 *
 * Packet 0 layout:
 *   0x7F + "FLAC"(4) + majorVersion(1) + minorVersion(1) +
 *   numberOfHeaderPackets(2 BE) + "fLaC"(4) + STREAMINFO block
 *
 * STREAMINFO metadata block header: blockType(1, upper bit = last-block flag) +
 *   blockLength(3 BE) + STREAMINFO data.
 *
 * Subsequent packets are FLAC metadata blocks; the first one containing a
 * Vorbis comment becomes the XiphComment tag.
 */
export class OggFlacFile extends OggFile {
  private _tag: XiphComment;
  private _properties: FlacProperties | null = null;

  protected override get numHeaderPackets(): number { return 2; }

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

  audioProperties(): FlacProperties | null {
    return this._properties;
  }

  override save(): boolean {
    if (this.readOnly) {
      return false;
    }

    // Find the Vorbis comment metadata block packet and replace it.
    // Typically packet index 1+ — we search for block type 4 (VORBIS_COMMENT).
    // Render: metadata block header (type=4, length) + XiphComment data (no framing bit).
    const commentData = this._tag.render(false);
    const blockHeader = new ByteVector();
    // Block type 4 (VORBIS_COMMENT), not last block
    blockHeader.append(0x04);
    // Block length as 3 bytes big-endian
    const len = commentData.length;
    blockHeader.append((len >> 16) & 0xff);
    blockHeader.append((len >> 8) & 0xff);
    blockHeader.append(len & 0xff);
    blockHeader.append(commentData);

    // The Vorbis comment is typically in packet 1
    this.setPacket(1, blockHeader);

    return super.save();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    const headerPacket = this.packet(0);

    // Minimum: 5 (prefix) + 2 (versions) + 2 (numHeaders) + 4 (fLaC) + 4 (block header) = 17
    if (headerPacket.length < 17) {
      this._valid = false;
      return;
    }

    if (!headerPacket.startsWith(OGG_FLAC_PREFIX)) {
      this._valid = false;
      return;
    }

    // Bytes 5–6: major/minor version
    // Bytes 7–8: number of header packets (2 bytes BE)
    const numHeaderPackets = headerPacket.toUShort(7, true);

    // Bytes 9–12: "fLaC"
    if (!headerPacket.containsAt(FLAC_STREAMINFO_MAGIC, 9)) {
      this._valid = false;
      return;
    }

    // Parse STREAMINFO from packet 0
    // After "fLaC" at offset 9, the STREAMINFO metadata block header starts at 13:
    //   blockType(1) + blockLength(3 BE) + STREAMINFO data
    if (readProperties && headerPacket.length >= 17 + 34) {
      const streamInfoData = headerPacket.mid(17, 34);
      this._properties = new FlacProperties(
        streamInfoData,
        this.fileLength,
        readStyle,
      );
    }

    // Search subsequent packets for the Vorbis comment block (type 4)
    for (let i = 1; i <= numHeaderPackets; i++) {
      const pkt = this.packet(i);
      if (pkt.length < 4) {
        continue;
      }

      // Metadata block header: type in lower 7 bits of first byte
      const blockType = pkt.get(0) & 0x7f;
      if (blockType === 4) {
        // Vorbis comment block
        // Skip 4-byte metadata block header (type + 3 byte length)
        this._tag = XiphComment.readFrom(pkt, 4);
        break;
      }
    }
  }
}
