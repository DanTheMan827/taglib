/** @file Picture type enumeration and {@link AsfPicture} class for embedded artwork in ASF files. */

import { ByteVector, StringType } from "../byteVector.js";

// ---------------------------------------------------------------------------
// PictureType - same as ID3v2 APIC frame types
// ---------------------------------------------------------------------------

/**
 * Embedded picture type constants, compatible with the ID3v2 APIC frame
 * specification and used by ASF's `WM/Picture` attribute.
 */
export enum AsfPictureType {
  /** General picture not fitting any other category. */
  Other = 0x00,
  /** Small square icon, typically 32×32 pixels, PNG only. */
  FileIcon = 0x01,
  /** Another file icon (not necessarily square or PNG). */
  OtherFileIcon = 0x02,
  /** Front cover artwork. */
  FrontCover = 0x03,
  /** Back cover artwork. */
  BackCover = 0x04,
  /** Leaflet/booklet page. */
  LeafletPage = 0x05,
  /** Media label (e.g. CD). */
  Media = 0x06,
  /** Lead/sole artist or performer. */
  LeadArtist = 0x07,
  /** Artist or performer. */
  Artist = 0x08,
  /** Conductor. */
  Conductor = 0x09,
  /** Band or orchestra. */
  Band = 0x0a,
  /** Composer. */
  Composer = 0x0b,
  /** Lyricist or text writer. */
  Lyricist = 0x0c,
  /** Recording location. */
  RecordingLocation = 0x0d,
  /** Picture taken during recording. */
  DuringRecording = 0x0e,
  /** Picture taken during performance. */
  DuringPerformance = 0x0f,
  /** Movie/video screen capture. */
  MovieScreenCapture = 0x10,
  /** A bright coloured fish (yes, really; part of the ID3v2 spec). */
  ColouredFish = 0x11,
  /** Illustration related to the track. */
  Illustration = 0x12,
  /** Artist/band logo. */
  BandLogo = 0x13,
  /** Publisher/studio logo. */
  PublisherLogo = 0x14,
}

/** Lookup table mapping each {@link AsfPictureType} to its display name. */
const pictureTypeNames: [AsfPictureType, string][] = [
  [AsfPictureType.Other, "Other"],
  [AsfPictureType.FileIcon, "File Icon"],
  [AsfPictureType.OtherFileIcon, "Other File Icon"],
  [AsfPictureType.FrontCover, "Front Cover"],
  [AsfPictureType.BackCover, "Back Cover"],
  [AsfPictureType.LeafletPage, "Leaflet Page"],
  [AsfPictureType.Media, "Media"],
  [AsfPictureType.LeadArtist, "Lead Artist"],
  [AsfPictureType.Artist, "Artist"],
  [AsfPictureType.Conductor, "Conductor"],
  [AsfPictureType.Band, "Band"],
  [AsfPictureType.Composer, "Composer"],
  [AsfPictureType.Lyricist, "Lyricist"],
  [AsfPictureType.RecordingLocation, "Recording Location"],
  [AsfPictureType.DuringRecording, "During Recording"],
  [AsfPictureType.DuringPerformance, "During Performance"],
  [AsfPictureType.MovieScreenCapture, "Movie Screen Capture"],
  [AsfPictureType.ColouredFish, "Coloured Fish"],
  [AsfPictureType.Illustration, "Illustration"],
  [AsfPictureType.BandLogo, "Band Logo"],
  [AsfPictureType.PublisherLogo, "Publisher Logo"],
];

/**
 * Convert an {@link AsfPictureType} to its human-readable name.
 *
 * @param type - The picture type constant.
 * @returns The display name, or `"Other"` for unrecognised values.
 */
export function pictureTypeToString(type: AsfPictureType): string {
  for (const [t, name] of pictureTypeNames) {
    if (t === type) return name;
  }
  return "Other";
}

/**
 * Convert a human-readable picture type name to the corresponding
 * {@link AsfPictureType} constant (case-insensitive).
 *
 * @param str - The display name (e.g. `"Front Cover"`).
 * @returns The matching constant, or {@link AsfPictureType.Other} when not found.
 */
export function pictureTypeFromString(str: string): AsfPictureType {
  const lower = str.toLowerCase();
  for (const [t, name] of pictureTypeNames) {
    if (name.toLowerCase() === lower) return t;
  }
  return AsfPictureType.Other;
}

// ---------------------------------------------------------------------------
// AsfPicture
// ---------------------------------------------------------------------------

/**
 * Represents an embedded picture stored in an ASF `WM/Picture` attribute.
 *
 * Create instances via {@link AsfPicture.create} (valid picture) or
 * {@link AsfPicture.fromInvalid} (sentinel / placeholder).
 */
export class AsfPicture {
  /** Whether this picture object holds valid data. */
  private _valid: boolean;
  /** Picture type (album art category). */
  private _type: AsfPictureType = AsfPictureType.Other;
  /** MIME type of the picture data (e.g. `"image/jpeg"`). */
  private _mimeType = "";
  /** Optional description / caption. */
  private _description = "";
  /** Raw encoded picture bytes. */
  private _picture = new ByteVector();

  /**
   * @param valid - Whether this instance holds valid picture data.
   */
  private constructor(valid: boolean) {
    this._valid = valid;
  }

  /** Create a new valid empty picture. */
  static create(): AsfPicture {
    return new AsfPicture(true);
  }

  /** Create an invalid (sentinel) picture. */
  static fromInvalid(): AsfPicture {
    return new AsfPicture(false);
  }

  /** `true` if this object was successfully parsed or explicitly created. */
  get isValid(): boolean { return this._valid; }

  /** MIME type string (e.g. `"image/jpeg"`). */
  get mimeType(): string { return this._mimeType; }
  /** @param value - The new MIME type. */
  set mimeType(value: string) { this._mimeType = value; }

  /** Picture category/type. */
  get type(): AsfPictureType { return this._type; }
  /** @param value - The new picture type. */
  set type(value: AsfPictureType) { this._type = value; }

  /** Optional description or caption for the picture. */
  get description(): string { return this._description; }
  /** @param value - The new description. */
  set description(value: string) { this._description = value; }

  /** Raw encoded picture bytes (JPEG, PNG, etc.). */
  get picture(): ByteVector { return this._picture; }
  /** @param value - The new picture data. */
  set picture(value: ByteVector) { this._picture = value; }

  /**
   * Byte size of this picture when serialized inside an ASF attribute.
   * Accounts for the type byte, 4-byte size field, and null-terminated
   * UTF-16LE MIME type and description strings.
   */
  get dataSize(): number {
    return 9 + (this._mimeType.length + this._description.length) * 2 + this._picture.length;
  }

  /**
   * Serialize this picture to bytes for storage in an ASF `WM/Picture`
   * attribute.  Returns an empty `ByteVector` if this instance is invalid.
   */
  render(): ByteVector {
    if (!this._valid) return new ByteVector();

    const typeByte = ByteVector.fromByteArray(new Uint8Array([this._type]));
    const pictureSize = ByteVector.fromUInt(this._picture.length, false);
    const mimeStr = renderUTF16LEString(this._mimeType);
    const descStr = renderUTF16LEString(this._description);

    const result = ByteVector.fromByteVector(typeByte);
    result.append(pictureSize);
    result.append(mimeStr);
    result.append(descStr);
    result.append(this._picture);
    return result;
  }

  /**
   * Deserialize a `WM/Picture` payload into this instance.
   *
   * Sets {@link isValid} to `true` on success and `false` on malformed input.
   *
   * @param bytes - The raw bytes of the attribute value.
   */
  parse(bytes: ByteVector): void {
    this._valid = false;
    if (bytes.length < 9) return;

    let pos = 0;
    this._type = bytes.get(0) as AsfPictureType;
    pos++;

    const dataLen = bytes.toUInt(pos, false);
    pos += 4;

    const nullTerminator = ByteVector.fromByteArray(new Uint8Array([0, 0]));

    // Read mime type (null-terminated UTF-16LE)
    const mimeEnd = bytes.find(nullTerminator, pos, 2);
    if (mimeEnd < 0) return;
    this._mimeType = bytes.mid(pos, mimeEnd - pos).toString(StringType.UTF16LE);
    pos = mimeEnd + 2;

    // Read description (null-terminated UTF-16LE)
    const descEnd = bytes.find(nullTerminator, pos, 2);
    if (descEnd < 0) return;
    this._description = bytes.mid(pos, descEnd - pos).toString(StringType.UTF16LE);
    pos = descEnd + 2;

    if (dataLen + pos !== bytes.length) return;

    this._picture = bytes.mid(pos, dataLen);
    this._valid = true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode `str` as a null-terminated UTF-16LE byte sequence.
 *
 * @param str - The string to encode.
 * @returns UTF-16LE bytes with a two-byte null terminator appended.
 */
function renderUTF16LEString(str: string): ByteVector {
  const encoded = ByteVector.fromString(str, StringType.UTF16LE);
  const result = ByteVector.fromByteVector(encoded);
  result.append(ByteVector.fromUShort(0, false));
  return result;
}
