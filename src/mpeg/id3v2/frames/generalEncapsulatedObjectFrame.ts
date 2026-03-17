/** @file ID3v2 general encapsulated object frame (GEOB). Stores arbitrary binary objects with metadata. */
import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
  nullTerminatorSize,
} from "../id3v2Frame.js";

/**
 * General encapsulated object frame (GEOB).
 *
 * Structure: encoding(1) + mimeType(null-terminated Latin1)
 *            + fileName(null-terminated in encoding)
 *            + description(null-terminated in encoding) + objectData.
 */
export class GeneralEncapsulatedObjectFrame extends Id3v2Frame {
  /** Text encoding used for the file name and description fields. */
  private _encoding: StringType = StringType.UTF8;
  /** MIME type of the encapsulated object, stored as a null-terminated Latin1 string. */
  private _mimeType: string = "";
  /** File name associated with the encapsulated object. */
  private _fileName: string = "";
  /** Human-readable description of the encapsulated object. */
  private _description: string = "";
  /** Raw binary payload of the encapsulated object. */
  private _object: ByteVector = new ByteVector();

  /**
   * Creates a new, empty GEOB frame.
   * @param encoding - Text encoding to use for the file name and description fields. Defaults to UTF-8.
   */
  constructor(encoding: StringType = StringType.UTF8) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("GEOB", StringType.Latin1),
    );
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  /** Gets the text encoding used for the file name and description fields. */
  get encoding(): StringType {
    return this._encoding;
  }

  /** Sets the text encoding used for the file name and description fields. */
  set encoding(e: StringType) {
    this._encoding = e;
  }

  /** Gets the MIME type of the encapsulated object. */
  get mimeType(): string {
    return this._mimeType;
  }

  /** Sets the MIME type of the encapsulated object. */
  set mimeType(value: string) {
    this._mimeType = value;
  }

  /** Gets the file name associated with the encapsulated object. */
  get fileName(): string {
    return this._fileName;
  }

  /** Sets the file name associated with the encapsulated object. */
  set fileName(value: string) {
    this._fileName = value;
  }

  /** Gets the human-readable description of the encapsulated object. */
  get description(): string {
    return this._description;
  }

  /** Sets the human-readable description of the encapsulated object. */
  set description(value: string) {
    this._description = value;
  }

  /** Gets the raw binary payload of the encapsulated object. */
  get object(): ByteVector {
    return this._object;
  }

  /** Sets the raw binary payload of the encapsulated object. */
  set object(data: ByteVector) {
    this._object = data;
  }

  /**
   * Returns the description of the encapsulated object.
   * @returns The description string stored in this frame.
   */
  toString(): string {
    return this._description;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): GeneralEncapsulatedObjectFrame {
    const frame = new GeneralEncapsulatedObjectFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the binary payload of the GEOB frame.
   * @param data - Raw field bytes beginning with the encoding byte.
   * @param _version - ID3v2 version (unused; parsing is version-independent).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    if (data.length < 1) return;

    this._encoding = data.get(0) as StringType;
    let offset = 1;

    // MIME type: null-terminated Latin1
    const mimeEnd = findNullTerminator(data, StringType.Latin1, offset);
    if (mimeEnd < 0) return;
    this._mimeType = data.mid(offset, mimeEnd - offset).toString(StringType.Latin1);
    offset = mimeEnd + 1;

    const ntSize = nullTerminatorSize(this._encoding);

    // File name: null-terminated in encoding
    const fnEnd = findNullTerminator(data, this._encoding, offset);
    if (fnEnd < 0) return;
    this._fileName = data
      .mid(offset, fnEnd - offset)
      .toString(this._encoding);
    offset = fnEnd + ntSize;

    // Description: null-terminated in encoding
    const descEnd = findNullTerminator(data, this._encoding, offset);
    if (descEnd < 0) {
      this._description = data.mid(offset).toString(this._encoding);
      this._object = new ByteVector();
    } else {
      this._description = data
        .mid(offset, descEnd - offset)
        .toString(this._encoding);
      this._object = data.mid(descEnd + ntSize);
    }
  }

  /**
   * Serialises the frame fields into a binary payload.
   * @param _version - ID3v2 version (unused; rendering is version-independent).
   * @returns A `ByteVector` containing the encoding byte, null-terminated MIME type, null-terminated file name, null-terminated description, and the raw object data.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._encoding);

    // MIME type (Latin1, null-terminated)
    v.append(ByteVector.fromString(this._mimeType, StringType.Latin1));
    v.append(0);

    const ntBytes =
      this._encoding === StringType.UTF16 ||
      this._encoding === StringType.UTF16BE ||
      this._encoding === StringType.UTF16LE
        ? ByteVector.fromSize(2, 0)
        : ByteVector.fromSize(1, 0);

    // File name
    v.append(ByteVector.fromString(this._fileName, this._encoding));
    v.append(ntBytes);

    // Description
    v.append(ByteVector.fromString(this._description, this._encoding));
    v.append(ntBytes);

    // Object data
    v.append(this._object);

    return v;
  }
}
