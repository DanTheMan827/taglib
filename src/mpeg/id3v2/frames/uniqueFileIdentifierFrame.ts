/** @file ID3v2 unique file identifier frame (UFID). Stores an owner-identified binary identifier for the file. */
import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
} from "../id3v2Frame.js";

/**
 * Unique file identifier frame (UFID).
 *
 * Structure: owner(null-terminated Latin1) + identifier(bytes).
 */
export class UniqueFileIdentifierFrame extends Id3v2Frame {
  /** The owner URL or identifier string that names the identification scheme. */
  private _owner: string = "";
  /** The binary identifier data for this file under the owner's scheme. */
  private _identifier: ByteVector = new ByteVector();

  /**
   * Creates a new UFID frame with an optional owner and identifier.
   * @param owner - The owner URL or scheme identifier string.
   * @param identifier - The binary file identifier data.
   */
  constructor(owner?: string, identifier?: ByteVector) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("UFID", StringType.Latin1),
    );
    super(header);
    if (owner !== undefined) this._owner = owner;
    if (identifier !== undefined) this._identifier = identifier;
  }

  // -- Accessors --------------------------------------------------------------

  /**
   * Gets the owner URL or scheme identifier string.
   * @returns The owner string.
   */
  get owner(): string {
    return this._owner;
  }

  /**
   * Sets the owner URL or scheme identifier string.
   * @param value - The new owner string.
   */
  set owner(value: string) {
    this._owner = value;
  }

  /**
   * Gets the binary file identifier data.
   * @returns A {@link ByteVector} containing the identifier bytes.
   */
  get identifier(): ByteVector {
    return this._identifier;
  }

  /**
   * Sets the binary file identifier data.
   * @param data - The new identifier bytes.
   */
  set identifier(data: ByteVector) {
    this._identifier = data;
  }

  /**
   * Returns the owner identifier string.
   * @returns The owner string of this frame.
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
  ): UniqueFileIdentifierFrame {
    const frame = new UniqueFileIdentifierFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the raw frame fields into owner and identifier data.
   * @param data - The raw field bytes of the frame.
   * @param _version - The ID3v2 version (unused).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    const nullIdx = findNullTerminator(data, StringType.Latin1, 0);
    if (nullIdx < 0) {
      this._owner = data.toString(StringType.Latin1);
      this._identifier = new ByteVector();
    } else {
      this._owner = data.mid(0, nullIdx).toString(StringType.Latin1);
      this._identifier = data.mid(nullIdx + 1);
    }
  }

  /**
   * Serializes the UFID frame fields into bytes.
   * @param _version - The ID3v2 version (unused).
   * @returns A {@link ByteVector} containing the encoded frame fields.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(ByteVector.fromString(this._owner, StringType.Latin1));
    v.append(0); // null terminator
    v.append(this._identifier);
    return v;
  }
}
