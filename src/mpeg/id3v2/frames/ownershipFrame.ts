/** @file ID3v2 ownership frame (OWNE). Records purchase and ownership information. */
import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
} from "../id3v2Frame.js";

/**
 * Ownership frame (OWNE).
 *
 * Structure: encoding(1) + pricePaid(null-terminated Latin1)
 *            + datePurchased(8 bytes YYYYMMDD) + seller(in encoding).
 */
export class OwnershipFrame extends Id3v2Frame {
  /** Text encoding used for the seller field. */
  private _encoding: StringType = StringType.UTF8;
  /** Price paid for the item, stored as a null-terminated Latin1 string. */
  private _pricePaid: string = "";
  /** Date of purchase as an 8-character YYYYMMDD string. */
  private _datePurchased: string = "";
  /** Name or identifier of the seller. */
  private _seller: string = "";

  /**
   * Creates a new, empty OWNE frame.
   * @param encoding - Text encoding to use for the seller field. Defaults to UTF-8.
   */
  constructor(encoding: StringType = StringType.UTF8) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("OWNE", StringType.Latin1),
    );
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  /** Gets the text encoding used for the seller field. */
  get encoding(): StringType {
    return this._encoding;
  }

  /** Sets the text encoding used for the seller field. */
  set encoding(e: StringType) {
    this._encoding = e;
  }

  /** Gets the price paid for the item. */
  get pricePaid(): string {
    return this._pricePaid;
  }

  /** Sets the price paid for the item. */
  set pricePaid(value: string) {
    this._pricePaid = value;
  }

  /** Date purchased as YYYYMMDD string. */
  get datePurchased(): string {
    return this._datePurchased;
  }

  set datePurchased(value: string) {
    this._datePurchased = value;
  }

  /** Gets the name or identifier of the seller. */
  get seller(): string {
    return this._seller;
  }

  /** Sets the name or identifier of the seller. */
  set seller(value: string) {
    this._seller = value;
  }

  /**
   * Returns a human-readable summary combining the seller, date, and price.
   * @returns A string of the form `"<seller> <datePurchased> <pricePaid>"`.
   */
  toString(): string {
    return `${this._seller} ${this._datePurchased} ${this._pricePaid}`;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): OwnershipFrame {
    const frame = new OwnershipFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the binary payload of the OWNE frame.
   * @param data - Raw field bytes beginning with the encoding byte.
   * @param _version - ID3v2 version (unused; parsing is version-independent).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    if (data.length < 1) return;

    this._encoding = data.get(0) as StringType;
    let offset = 1;

    // Price paid: null-terminated Latin1
    const priceEnd = findNullTerminator(data, StringType.Latin1, offset);
    if (priceEnd < 0) return;
    this._pricePaid = data.mid(offset, priceEnd - offset).toString(StringType.Latin1);
    offset = priceEnd + 1;

    // Date purchased: 8 bytes (YYYYMMDD)
    if (offset + 8 > data.length) return;
    this._datePurchased = data.mid(offset, 8).toString(StringType.Latin1);
    offset += 8;

    // Seller: remaining in encoding
    if (offset < data.length) {
      this._seller = data.mid(offset).toString(this._encoding);
    }
  }

  /**
   * Serialises the frame fields into a binary payload.
   * @param _version - ID3v2 version (unused; rendering is version-independent).
   * @returns A `ByteVector` containing the encoding byte, null-terminated price, 8-byte date, and seller string.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._encoding);
    v.append(ByteVector.fromString(this._pricePaid, StringType.Latin1));
    v.append(0); // null terminator
    // Ensure date is exactly 8 bytes
    const dateStr = this._datePurchased.padEnd(8, " ").slice(0, 8);
    v.append(ByteVector.fromString(dateStr, StringType.Latin1));
    v.append(ByteVector.fromString(this._seller, this._encoding));
    return v;
  }
}
