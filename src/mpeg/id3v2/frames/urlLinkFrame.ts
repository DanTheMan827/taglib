import { ByteVector, StringType } from '../../../byteVector.js';
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
  nullTerminatorSize,
} from '../id3v2Frame.js';

/**
 * URL link frame (W*** except WXXX).
 *
 * Structure: url (Latin1 text, no encoding byte, no null terminator).
 */
export class UrlLinkFrame extends Id3v2Frame {
  private _url: string = '';
  private _rawData: ByteVector | undefined;

  constructor(frameId: ByteVector) {
    const header = new Id3v2FrameHeader(frameId);
    super(header);
  }

  // -- Accessors --------------------------------------------------------------

  get url(): string {
    this._parseRawData();
    return this._url;
  }

  set url(value: string) {
    this._parseRawData();
    this._url = value;
  }

  toString(): string {
    return this.url;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): UrlLinkFrame {
    const frame = new UrlLinkFrame(header.frameId);
    frame._header = header;
    frame._rawData = Id3v2Frame.fieldData(data, header, version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  protected parseFields(data: ByteVector, _version: number): void {
    this._rawData = data;
  }

  protected renderFields(_version: number): ByteVector {
    this._parseRawData();
    return ByteVector.fromString(this._url, StringType.Latin1);
  }

  // -- Private ----------------------------------------------------------------

  private _parseRawData(): void {
    if (this._rawData === undefined) return;
    const data = this._rawData;
    this._rawData = undefined;
    this._url = data.toString(StringType.Latin1);
  }
}

/**
 * User URL link frame (WXXX).
 *
 * Structure: encoding(1) + description(null-terminated in encoding) + url.
 */
export class UserUrlLinkFrame extends UrlLinkFrame {
  private _encoding: StringType = StringType.UTF8;
  private _description: string = '';
  private _rawWxxxData: ByteVector | undefined;

  constructor(encoding: StringType = StringType.UTF8) {
    super(ByteVector.fromString('WXXX', StringType.Latin1));
    this._encoding = encoding;
  }

  get encoding(): StringType {
    this._parseWxxxRaw();
    return this._encoding;
  }

  set encoding(e: StringType) {
    this._parseWxxxRaw();
    this._encoding = e;
  }

  get description(): string {
    this._parseWxxxRaw();
    return this._description;
  }

  set description(value: string) {
    this._parseWxxxRaw();
    this._description = value;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromRawData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): UserUrlLinkFrame {
    const frame = new UserUrlLinkFrame();
    frame._header = header;
    frame._rawWxxxData = Id3v2Frame.fieldData(data, header, version);
    return frame;
  }

  static find(
    tag: { frames?: Id3v2Frame[] },
    description: string,
  ): UserUrlLinkFrame | null {
    if (!tag.frames) return null;
    for (const frame of tag.frames) {
      if (
        frame instanceof UserUrlLinkFrame &&
        frame.description === description
      ) {
        return frame;
      }
    }
    return null;
  }

  // -- Protected --------------------------------------------------------------

  protected override renderFields(_version: number): ByteVector {
    this._parseWxxxRaw();
    const v = new ByteVector();
    v.append(this._encoding);
    v.append(ByteVector.fromString(this._description, this._encoding));
    // Null terminator
    if (
      this._encoding === StringType.UTF16 ||
      this._encoding === StringType.UTF16BE ||
      this._encoding === StringType.UTF16LE
    ) {
      v.append(ByteVector.fromSize(2, 0));
    } else {
      v.append(0);
    }
    v.append(ByteVector.fromString(this.url, StringType.Latin1));
    return v;
  }

  // -- Private ----------------------------------------------------------------

  private _parseWxxxRaw(): void {
    if (this._rawWxxxData === undefined) return;
    const data = this._rawWxxxData;
    this._rawWxxxData = undefined;

    if (data.length < 1) return;

    this._encoding = data.get(0) as StringType;
    const ntSize = nullTerminatorSize(this._encoding);
    const descEnd = findNullTerminator(data, this._encoding, 1);

    if (descEnd < 0) {
      this._description = data.mid(1).toString(this._encoding);
    } else {
      this._description = data
        .mid(1, descEnd - 1)
        .toString(this._encoding);
      // URL is always Latin1
      this.url = data.mid(descEnd + ntSize).toString(StringType.Latin1);
    }
  }
}
