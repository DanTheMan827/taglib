/** @file ASF attribute value type and {@link AsfAttribute} implementation. */

import { ByteVector, StringType } from "../byteVector.js";
import type { File } from "../file.js";
import { AsfPicture } from "./asfPicture.js";
import { readWORD, readDWORD, readQWORD, readString, renderString } from "./asfUtils.js";

// ---------------------------------------------------------------------------
// AsfAttributeType
// ---------------------------------------------------------------------------

/** Discriminates the value type stored in an {@link AsfAttribute}. */
export enum AsfAttributeType {
  /** A null-terminated UTF-16LE string. */
  UnicodeType = 0,
  /** Arbitrary binary data. */
  BytesType = 1,
  /** Boolean flag, encoded as a WORD or DWORD depending on the object kind. */
  BoolType = 2,
  /** Unsigned 32-bit integer. */
  DWordType = 3,
  /** Unsigned 64-bit integer. */
  QWordType = 4,
  /** Unsigned 16-bit integer. */
  WordType = 5,
  /** 16-byte GUID value. */
  GuidType = 6,
}

// ---------------------------------------------------------------------------
// AsfAttribute
// ---------------------------------------------------------------------------

/**
 * Represents a single attribute value in an ASF tag.
 *
 * An attribute can be one of several typed values ({@link AsfAttributeType})
 * and may be associated with a particular stream or language index when stored
 * in the Metadata or Metadata Library objects.
 */
export class AsfAttribute {
  /** Discriminator for the value stored in this attribute. */
  private _type: AsfAttributeType = AsfAttributeType.UnicodeType;
  /** String payload (UnicodeType attributes). */
  private _stringValue = "";
  /** Binary payload (BytesType / GuidType attributes). */
  private _byteVectorValue = new ByteVector();
  /** Embedded picture payload (BytesType WM/Picture attributes). */
  private _pictureValue: AsfPicture = AsfPicture.fromInvalid();
  /** Numeric payload, stored as BigInt for lossless 64-bit handling. */
  private _numericValue = 0n;
  /** Stream number this attribute belongs to (Metadata / Metadata Library). */
  private _stream = 0;
  /** Language list index this attribute belongs to (Metadata Library only). */
  private _language = 0;

  // -- Constructors (static factories) --

  /** Create an empty Unicode attribute. */
  constructor() {}

  /**
   * Create a Unicode string attribute.
   * @param value - The string to store.
   */
  static fromString(value: string): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.UnicodeType;
    a._stringValue = value;
    return a;
  }

  /**
   * Create a binary byte-array attribute.
   * @param value - The binary data to store.
   */
  static fromByteVector(value: ByteVector): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.BytesType;
    a._byteVectorValue = value;
    return a;
  }

  /**
   * Create a BytesType attribute whose payload is the rendered form of `value`.
   * @param value - The picture to embed.
   */
  static fromPicture(value: AsfPicture): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.BytesType;
    a._pictureValue = value;
    return a;
  }

  /**
   * Create a DWord (unsigned 32-bit) attribute.
   * @param value - Value in the range [0, 2³²−1].
   */
  static fromUInt(value: number): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.DWordType;
    a._numericValue = BigInt(value >>> 0);
    return a;
  }

  /**
   * Create a QWord (unsigned 64-bit) attribute.
   * @param value - The BigInt value to store.
   */
  static fromULongLong(value: bigint): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.QWordType;
    a._numericValue = value;
    return a;
  }

  /**
   * Create a Word (unsigned 16-bit) attribute.
   * @param value - Value in the range [0, 65535].
   */
  static fromUShort(value: number): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.WordType;
    a._numericValue = BigInt(value & 0xFFFF);
    return a;
  }

  /**
   * Create a Bool attribute.
   * @param value - The boolean value to store.
   */
  static fromBool(value: boolean): AsfAttribute {
    const a = new AsfAttribute();
    a._type = AsfAttributeType.BoolType;
    a._numericValue = value ? 1n : 0n;
    return a;
  }

  // -- Accessors --

  /** The discriminated type of the value held by this attribute. */
  get type(): AsfAttributeType { return this._type; }

  /** Returns the Unicode string value, or `""` for non-string attributes. */
  toString(): string { return this._stringValue; }

  /**
   * Returns the binary data value.
   * For embedded pictures the rendered picture bytes are returned.
   */
  toByteVector(): ByteVector {
    if (this._pictureValue.isValid) return this._pictureValue.render();
    return this._byteVectorValue;
  }

  /** Returns `1` if the boolean value is true, otherwise `0`. */
  toBool(): number { return this._numericValue !== 0n ? 1 : 0; }
  /** Returns the numeric value truncated to an unsigned 16-bit integer. */
  toUShort(): number { return Number(this._numericValue & 0xFFFFn); }
  /** Returns the numeric value truncated to an unsigned 32-bit integer. */
  toUInt(): number { return Number(this._numericValue & 0xFFFFFFFFn); }
  /** Returns the full unsigned 64-bit integer value as a BigInt. */
  toULongLong(): bigint { return this._numericValue; }

  /** Returns the embedded picture value (may be invalid). */
  toPicture(): AsfPicture { return this._pictureValue; }

  /** Language list index for Metadata Library objects; `0` for all others. */
  get language(): number { return this._language; }
  /** @param value - Language list index. */
  set language(value: number) { this._language = value; }

  /** Stream number for Metadata / Metadata Library objects; `0` for Extended Content Description. */
  get stream(): number { return this._stream; }
  /** @param value - Stream number. */
  set stream(value: number) { this._stream = value; }

  // -- Parsing --

  /**
   * Parse an attribute from an ASF file.
   * @param kind 0 = extended content descriptor, 1 = metadata, 2 = metadata library
   * @returns the attribute name
   */
  async parse(file: File, kind = 0): Promise<string> {
    let size: number;
    let nameLength: number;
    let name: string;

    this._pictureValue = AsfPicture.fromInvalid();

    if (kind === 0) {
      // Extended content descriptor
      nameLength = (await readWORD(file)).value;
      name = await readString(file, nameLength);
      this._type = (await readWORD(file)).value as AsfAttributeType;
      size = (await readWORD(file)).value;
    } else {
      // Metadata or metadata library
      const temp = (await readWORD(file)).value;
      if (kind === 2) {
        this._language = temp;
      }
      this._stream = (await readWORD(file)).value;
      nameLength = (await readWORD(file)).value;
      this._type = (await readWORD(file)).value as AsfAttributeType;
      size = (await readDWORD(file)).value;
      name = await readString(file, nameLength);
    }

    switch (this._type) {
      case AsfAttributeType.WordType:
        this._numericValue = BigInt((await readWORD(file)).value);
        break;

      case AsfAttributeType.BoolType:
        if (kind === 0) {
          this._numericValue = (await readDWORD(file)).value !== 0 ? 1n : 0n;
        } else {
          this._numericValue = (await readWORD(file)).value !== 0 ? 1n : 0n;
        }
        break;

      case AsfAttributeType.DWordType:
        this._numericValue = BigInt((await readDWORD(file)).value);
        break;

      case AsfAttributeType.QWordType:
        this._numericValue = (await readQWORD(file)).value;
        break;

      case AsfAttributeType.UnicodeType:
        this._stringValue = await readString(file, size);
        break;

      case AsfAttributeType.BytesType:
      case AsfAttributeType.GuidType:
        this._byteVectorValue = await file.readBlock(size);
        break;
    }

    if (this._type === AsfAttributeType.BytesType && name === "WM/Picture") {
      this._pictureValue = AsfPicture.create();
      this._pictureValue.parse(this._byteVectorValue);
      if (this._pictureValue.isValid) {
        this._byteVectorValue = new ByteVector();
      }
    }

    return name;
  }

  // -- Data size --

  /**
   * Size in bytes of the encoded value, **excluding** the attribute header
   * (name, type, and length fields).
   */
  get dataSize(): number {
    switch (this._type) {
      case AsfAttributeType.WordType: return 2;
      case AsfAttributeType.BoolType:
      case AsfAttributeType.DWordType: return 4;
      case AsfAttributeType.QWordType: return 8;
      case AsfAttributeType.UnicodeType:
        return ByteVector.fromString(this._stringValue, StringType.UTF16LE).length + 2;
      case AsfAttributeType.BytesType:
        if (this._pictureValue.isValid) return this._pictureValue.dataSize;
        return this._byteVectorValue.length;
      case AsfAttributeType.GuidType:
        return this._byteVectorValue.length;
    }
    return 0;
  }

  // -- Rendering --

  /**
   * Serialize this attribute to bytes for inclusion in an ASF file.
   *
   * @param name - The attribute name to write.
   * @param kind - Object kind: `0` = Extended Content Descriptor,
   *   `1` = Metadata, `2` = Metadata Library.
   * @returns The serialized bytes.
   */
  render(name: string, kind = 0): ByteVector {
    let data = new ByteVector();

    switch (this._type) {
      case AsfAttributeType.WordType:
        data = ByteVector.fromUShort(this.toUShort(), false);
        break;
      case AsfAttributeType.BoolType:
        if (kind === 0) {
          data = ByteVector.fromUInt(this.toBool(), false);
        } else {
          data = ByteVector.fromUShort(this.toBool(), false);
        }
        break;
      case AsfAttributeType.DWordType:
        data = ByteVector.fromUInt(this.toUInt(), false);
        break;
      case AsfAttributeType.QWordType:
        data = ByteVector.fromLongLong(this.toULongLong(), false);
        break;
      case AsfAttributeType.UnicodeType:
        data = renderString(this._stringValue);
        break;
      case AsfAttributeType.BytesType:
        if (this._pictureValue.isValid) {
          data = this._pictureValue.render();
        } else {
          data = ByteVector.fromByteVector(this._byteVectorValue);
        }
        break;
      case AsfAttributeType.GuidType:
        data = ByteVector.fromByteVector(this._byteVectorValue);
        break;
    }

    if (kind === 0) {
      const nameRendered = renderString(name, true);
      const typeBytes = ByteVector.fromUShort(this._type, false);
      const sizeBytes = ByteVector.fromUShort(data.length, false);
      const result = ByteVector.fromByteVector(nameRendered);
      result.append(typeBytes);
      result.append(sizeBytes);
      result.append(data);
      return result;
    } else {
      const nameData = renderString(name);
      const langBytes = ByteVector.fromUShort(kind === 2 ? this._language : 0, false);
      const streamBytes = ByteVector.fromUShort(this._stream, false);
      const nameLenBytes = ByteVector.fromUShort(nameData.length, false);
      const typeBytes = ByteVector.fromUShort(this._type, false);
      const dataSizeBytes = ByteVector.fromUInt(data.length, false);
      const result = ByteVector.fromByteVector(langBytes);
      result.append(streamBytes);
      result.append(nameLenBytes);
      result.append(typeBytes);
      result.append(dataSizeBytes);
      result.append(nameData);
      result.append(data);
      return result;
    }
  }
}
