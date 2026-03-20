/** @file FLAC-in-OGG file format handler. Reads and writes XiphComment tags and FLAC audio properties. */

import { ByteVector, StringType } from "../../byteVector.js";
import { IOStream } from "../../toolkit/ioStream.js";
import { ReadStyle } from "../../toolkit/types.js";
import { XiphComment } from "../xiphComment.js";
import { OggFile } from "../oggFile.js";
import { FlacProperties } from "../../flac/flacProperties.js";

/** The 5-byte OGG FLAC identification header prefix: 0x7F + "FLAC". */
const OGG_FLAC_PREFIX = ByteVector.fromString("\x7FFLAC", StringType.Latin1);
/** The 4-byte FLAC stream marker "fLaC" embedded after the OGG FLAC prefix in packet 0. */
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
  /** The XiphComment tag parsed from the Vorbis comment metadata block, or a fresh empty tag. */
  private _tag: XiphComment;
  /** Parsed FLAC audio properties from the STREAMINFO block, or `null` if not yet read. */
  private _properties: FlacProperties | null = null;

  /**
   * Number of header packets in an OGG FLAC stream (identification + Vorbis comment).
   * @returns `2`
   */
  protected override get numHeaderPackets(): number { return 2; }

  /**
   * Private constructor — use {@link OggFlacFile.open} to create instances.
   * @param stream - The underlying I/O stream for the FLAC-in-OGG file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new XiphComment();
  }

  /**
   * Open and parse a FLAC-in-OGG file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `OggFlacFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<OggFlacFile> {
    const file = new OggFlacFile(stream);
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
   * Returns the audio properties parsed from the FLAC STREAMINFO block.
   * @returns The {@link FlacProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): FlacProperties | null {
    return this._properties;
  }

  /**
   * Writes the current XiphComment tag back to the stream as the Vorbis comment metadata block.
   * @returns `true` on success, `false` if the file is read-only.
   */
  override async save(): Promise<boolean> {
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
    const headerPacket = await this.packet(0);

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
        await this.fileLength(),
        readStyle,
      );
    }

    // Search subsequent packets for the Vorbis comment block (type 4)
    for (let i = 1; i <= numHeaderPackets; i++) {
      const pkt = await this.packet(i);
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
