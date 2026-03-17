/** @file ID3v2 unknown frame fallback. Preserves the raw payload of frame types without a dedicated parser. */
import { ByteVector, StringType } from "../../../byteVector.js";
import { Id3v2Frame, Id3v2FrameHeader } from "../id3v2Frame.js";

/**
 * Unknown frame – used for any frame type that we don't have a specific parser for.
 */
export class UnknownFrame extends Id3v2Frame {
  /** Raw payload bytes of the unknown frame, preserved verbatim. */
  private _data: ByteVector;

  /**
   * Creates a new unknown frame with the given frame ID and optional payload.
   * @param frameId - The four-byte frame ID identifying the frame type.
   * @param data - The raw payload bytes. Defaults to an empty {@link ByteVector}.
   */
  constructor(frameId: ByteVector, data?: ByteVector) {
    const header = new Id3v2FrameHeader(frameId);
    super(header);
    this._data = data ?? new ByteVector();
  }

  /**
   * Returns the raw frame payload bytes.
   * @returns A {@link ByteVector} containing the unparsed frame data.
   */
  get data(): ByteVector {
    return this._data;
  }

  /**
   * Returns the frame ID as a Latin1 string.
   * @returns The four-character frame ID string.
   */
  toString(): string {
    return this._header.frameId.toString(StringType.Latin1);
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): UnknownFrame {
    const fieldData = Id3v2Frame.fieldData(data, header, version);
    const frame = new UnknownFrame(header.frameId, fieldData);
    frame._header = header;
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Stores the raw frame payload for later rendering.
   * @param data - The raw field bytes of the frame.
   * @param _version - The ID3v2 version (unused).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    this._data = data;
  }

  /**
   * Returns the preserved raw payload bytes unchanged.
   * @param _version - The ID3v2 version (unused).
   * @returns The raw {@link ByteVector} payload of this frame.
   */
  protected renderFields(_version: number): ByteVector {
    return this._data;
  }
}
