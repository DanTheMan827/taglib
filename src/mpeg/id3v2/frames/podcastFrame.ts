/** @file ID3v2 podcast marker frame (PCST). An iTunes-specific 4-byte marker that identifies a file as a podcast. */
import { ByteVector, StringType } from "../../../byteVector.js";
import { Id3v2Frame, Id3v2FrameHeader } from "../id3v2Frame.js";

/**
 * Podcast frame (PCST) – an iTunes-specific marker frame.
 *
 * This is a simple frame with a fixed 4-byte payload of 0x00000000.
 */
export class PodcastFrame extends Id3v2Frame {
  /** Creates a new PCST frame with the fixed iTunes podcast marker payload. */
  constructor() {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("PCST", StringType.Latin1),
    );
    super(header);
  }

  /**
   * Returns the frame identifier string.
   * @returns The string `"PCST"`.
   */
  toString(): string {
    return "PCST";
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): PodcastFrame {
    // We ignore the payload – it's always 0x00000000
    Id3v2Frame.fieldData(data, header, version);
    const frame = new PodcastFrame();
    frame._header = header;
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * No fields to parse; the payload is ignored.
   * @param _data - Raw field bytes (ignored).
   * @param _version - ID3v2 version (ignored).
   */
  protected parseFields(_data: ByteVector, _version: number): void {
    // Nothing to parse
  }

  /**
   * Serialises the frame as a fixed 4-byte zero-filled payload.
   * @param _version - ID3v2 version (ignored).
   * @returns Always returns a 4-byte zero-filled `ByteVector`.
   */
  protected renderFields(_version: number): ByteVector {
    return ByteVector.fromSize(4, 0);
  }
}
