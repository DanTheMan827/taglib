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
  private _encoding: StringType = StringType.UTF8;
  private _mimeType: string = "";
  private _pictureType: PictureType = PictureType.Other;
  private _description: string = "";
  private _picture: ByteVector = new ByteVector();

  constructor(encoding: StringType = StringType.UTF8) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("APIC", StringType.Latin1),
    );
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  get encoding(): StringType {
    return this._encoding;
  }

  set encoding(e: StringType) {
    this._encoding = e;
  }

  get mimeType(): string {
    return this._mimeType;
  }

  set mimeType(value: string) {
    this._mimeType = value;
  }

  get pictureType(): PictureType {
    return this._pictureType;
  }

  set pictureType(value: PictureType) {
    this._pictureType = value;
  }

  get description(): string {
    return this._description;
  }

  set description(value: string) {
    this._description = value;
  }

  get picture(): ByteVector {
    return this._picture;
  }

  set picture(data: ByteVector) {
    this._picture = data;
  }

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
