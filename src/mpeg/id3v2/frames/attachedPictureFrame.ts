/** @file ID3v2 attached picture frame (APIC). Stores embedded album art and other images. */

import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
  nullTerminatorSize,
} from "../id3v2Frame.js";

/** Standard picture types as defined in the ID3v2 specification. */
export enum PictureType {
  Other = 0x00,
  FileIcon = 0x01,
  OtherFileIcon = 0x02,
  FrontCover = 0x03,
  BackCover = 0x04,
  LeafletPage = 0x05,
  Media = 0x06,
  LeadArtist = 0x07,
  Artist = 0x08,
  Conductor = 0x09,
  Band = 0x0a,
  Composer = 0x0b,
  Lyricist = 0x0c,
  RecordingLocation = 0x0d,
  DuringRecording = 0x0e,
  DuringPerformance = 0x0f,
  MovieScreenCapture = 0x10,
  ColouredFish = 0x11,
  Illustration = 0x12,
  BandLogo = 0x13,
  PublisherLogo = 0x14,
}

/**
 * Attached picture frame (APIC).
 *
 * Structure: encoding(1) + mimeType(null-terminated Latin1) + pictureType(1)
 *            + description(null-terminated in encoding) + pictureData.
 */
export class AttachedPictureFrame extends Id3v2Frame {
  /** Text encoding used for the description field. Defaults to Latin1 matching C++ FrameFactory default. */
  private _encoding: StringType = StringType.Latin1;
  /** MIME type of the embedded image (e.g. `"image/jpeg"`). */
  private _mimeType: string = "";
  /** Semantic role of the picture within the tag. */
  private _pictureType: PictureType = PictureType.Other;
  /** Short description of the picture. */
  private _description: string = "";
  /** Raw binary image data. */
  private _picture: ByteVector = new ByteVector();

  /**
   * Creates a new, empty AttachedPictureFrame.
   * @param encoding - Text encoding to use for the description field.
   *                   Defaults to `StringType.Latin1` (matching C++ TagLib `FrameFactory` default).
   */
  constructor(encoding: StringType = StringType.Latin1) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("APIC", StringType.Latin1),
    );
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  /** Gets the text encoding used for the description field. */
  get encoding(): StringType {
    return this._encoding;
  }

  /** Sets the text encoding used for the description field. */
  set encoding(e: StringType) {
    this._encoding = e;
  }

  /** Gets the MIME type of the embedded image (e.g. `"image/jpeg"`). */
  get mimeType(): string {
    return this._mimeType;
  }

  /** Sets the MIME type of the embedded image. */
  set mimeType(value: string) {
    this._mimeType = value;
  }

  /** Gets the semantic picture type. */
  get pictureType(): PictureType {
    return this._pictureType;
  }

  /** Sets the semantic picture type. */
  set pictureType(value: PictureType) {
    this._pictureType = value;
  }

  /** Gets the short description of the picture. */
  get description(): string {
    return this._description;
  }

  /** Sets the short description of the picture. */
  set description(value: string) {
    this._description = value;
  }

  /** Gets the raw binary image data. */
  get picture(): ByteVector {
    return this._picture;
  }

  /** Sets the raw binary image data. */
  set picture(data: ByteVector) {
    this._picture = data;
  }

  /**
   * Returns a human-readable string combining the MIME type and description.
   * @returns A string in the form `"[mimeType] description"`.
   */
  toString(): string {
    return `[${this._mimeType}] ${this._description}`;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): AttachedPictureFrame {
    const frame = new AttachedPictureFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the raw APIC frame field data, populating all picture properties.
   * @param data - Decoded frame field bytes (after unsynchronisation/decompression).
   * @param version - ID3v2 version number (2 for v2.2, 3 for v2.3, 4 for v2.4).
   */
  protected parseFields(data: ByteVector, version: number): void {
    if (data.length < 1) return;

    this._encoding = data.get(0) as StringType;
    let offset = 1;

    if (version < 3) {
      // v2.2 PIC: 3-byte image format instead of null-terminated MIME
      this._mimeType = data.mid(offset, 3).toString(StringType.Latin1);
      offset += 3;
    } else {
      // Null-terminated Latin1 MIME type
      const mimeEnd = findNullTerminator(data, StringType.Latin1, offset);
      if (mimeEnd < 0) return;
      this._mimeType = data.mid(offset, mimeEnd - offset).toString(StringType.Latin1);
      offset = mimeEnd + 1;
    }

    if (offset >= data.length) return;
    this._pictureType = data.get(offset) as PictureType;
    offset += 1;

    // Null-terminated description in the frame's encoding
    const ntSize = nullTerminatorSize(this._encoding);
    const descEnd = findNullTerminator(data, this._encoding, offset);
    if (descEnd < 0) {
      this._description = data.mid(offset).toString(this._encoding);
      this._picture = new ByteVector();
    } else {
      this._description = data
        .mid(offset, descEnd - offset)
        .toString(this._encoding);
      this._picture = data.mid(descEnd + ntSize);
    }
  }

  /**
   * Renders the frame field data to bytes.
   * @param version - ID3v2 version number used to determine the on-disk format.
   * @returns A `ByteVector` containing the encoded APIC field data.
   */
  protected renderFields(version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._encoding);

    if (version < 3) {
      // ID3v2.2 PIC: 3-byte image format string (no null terminator)
      const fmt = this._mimeType.length >= 3
        ? this._mimeType.substring(0, 3)
        : this._mimeType.padEnd(3, "\0");
      v.append(ByteVector.fromString(fmt, StringType.Latin1));
    } else {
      // ID3v2.3+ APIC: null-terminated Latin1 MIME type
      v.append(ByteVector.fromString(this._mimeType, StringType.Latin1));
      v.append(0); // null terminator for MIME
    }

    v.append(this._pictureType);
    v.append(ByteVector.fromString(this._description, this._encoding));
    // Null terminator for description
    if (
      this._encoding === StringType.UTF16 ||
      this._encoding === StringType.UTF16BE ||
      this._encoding === StringType.UTF16LE
    ) {
      v.append(ByteVector.fromSize(2, 0));
    } else {
      v.append(0);
    }
    v.append(this._picture);
    return v;
  }
}
