/** @file ID3v2 private frame (PRIV). Stores owner-identified private binary data. */
import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
} from "../id3v2Frame.js";

/**
 * Private frame (PRIV).
 *
 * Structure: owner(null-terminated Latin1) + data.
 */
export class PrivateFrame extends Id3v2Frame {
  /** Owner identifier string that designates the application or organisation that owns this data. */
  private _owner: string = "";
  /** Raw private binary payload associated with the owner. */
  private _data: ByteVector = new ByteVector();

  /** Creates a new, empty PRIV frame. */
  constructor() {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("PRIV", StringType.Latin1),
    );
    super(header);
  }

  // -- Accessors --------------------------------------------------------------

  /** Gets the owner identifier string. */
  get owner(): string {
    return this._owner;
  }

  /** Sets the owner identifier string. */
  set owner(value: string) {
    this._owner = value;
  }

  /** Gets the raw private binary payload. */
  get data(): ByteVector {
    return this._data;
  }

  /** Sets the raw private binary payload. */
  set data(value: ByteVector) {
    this._data = value;
  }

  /** Returns the private data bytes stored in this frame. */
  get renderData(): ByteVector {
    return this._data;
  }

  /**
   * Returns the owner identifier string.
   * @returns The owner string stored in this frame.
   */
  toString(): string {
    return this._owner;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): PrivateFrame {
    const frame = new PrivateFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the binary payload of the PRIV frame.
   * @param data - Raw field bytes beginning with the null-terminated owner string.
   * @param _version - ID3v2 version (unused; parsing is version-independent).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    const nullIdx = findNullTerminator(data, StringType.Latin1, 0);
    if (nullIdx < 0) {
      this._owner = data.toString(StringType.Latin1);
      this._data = new ByteVector();
    } else {
      this._owner = data.mid(0, nullIdx).toString(StringType.Latin1);
      this._data = data.mid(nullIdx + 1);
    }
  }

  /**
   * Serialises the frame fields into a binary payload.
   * @param _version - ID3v2 version (unused; rendering is version-independent).
   * @returns A `ByteVector` containing the null-terminated owner string followed by the private data bytes.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(ByteVector.fromString(this._owner, StringType.Latin1));
    v.append(0); // null terminator
    v.append(this._data);
    return v;
  }
}
