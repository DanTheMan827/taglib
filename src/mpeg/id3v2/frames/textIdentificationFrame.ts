import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
  nullTerminatorSize,
} from "../id3v2Frame.js";

/**
 * Text identification frame (T*** except TXXX).
 *
 * Structure: encoding(1) + text (in encoding, multiple values separated by null).
 */
export class TextIdentificationFrame extends Id3v2Frame {
  private _encoding: StringType = StringType.UTF8;
  private _fieldList: string[] = [];
  private _rawData: ByteVector | undefined;
  private _rawVersion: number = 4;

  constructor(frameId: ByteVector, encoding: StringType = StringType.UTF8) {
    const header = new Id3v2FrameHeader(frameId);
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  get encoding(): StringType {
    this._parseRawData();
    return this._encoding;
  }

  set encoding(e: StringType) {
    this._parseRawData();
    this._encoding = e;
  }

  get fieldList(): string[] {
    this._parseRawData();
    return this._fieldList;
  }

  set fieldList(fields: string[]) {
    this._parseRawData();
    this._fieldList = fields;
  }

  get text(): string {
    this._parseRawData();
    return this._fieldList.length > 0 ? this._fieldList.join(", ") : "";
  }

  set text(value: string) {
    this._parseRawData();
    this._fieldList = [value];
  }

  toString(): string {
    return this.text;
  }

  // -- Static factories -------------------------------------------------------

  static createTextFrame(
    id: ByteVector,
    values: string[],
  ): TextIdentificationFrame {
    const frame = new TextIdentificationFrame(id, StringType.UTF8);
    frame._fieldList = values;
    return frame;
  }

  /** @internal Create from raw frame data (used by frame factory). */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): TextIdentificationFrame {
    const frame = new TextIdentificationFrame(header.frameId);
    frame._header = header;
    frame._rawData = Id3v2Frame.fieldData(data, header, version);
    frame._rawVersion = version;
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  protected parseFields(data: ByteVector, version: number): void {
    this._rawData = data;
    this._rawVersion = version;
  }

  protected renderFields(version: number): ByteVector {
    this._parseRawData();
    const v = new ByteVector();
    v.append(this._encoding);

    if (version >= 4) {
      // ID3v2.4: NUL-separated multiple values
      const nt = this._encoding === StringType.UTF16 ||
        this._encoding === StringType.UTF16BE ||
        this._encoding === StringType.UTF16LE
        ? ByteVector.fromSize(2, 0)
        : ByteVector.fromSize(1, 0);

      for (let i = 0; i < this._fieldList.length; i++) {
        if (i > 0) {
          v.append(nt);
        }
        v.append(ByteVector.fromString(this._fieldList[i], this._encoding));
      }
    } else {
      // ID3v2.3 and earlier: '/' separated multiple values (rendered as Latin1 separator)
      const joined = this._fieldList.join("/");
      v.append(ByteVector.fromString(joined, this._encoding));
    }

    return v;
  }

  // -- Private ----------------------------------------------------------------

  private _parseRawData(): void {
    if (this._rawData === undefined) return;
    const data = this._rawData;
    this._rawData = undefined;

    if (data.length < 1) {
      this._fieldList = [];
      return;
    }

    this._encoding = data.get(0) as StringType;
    const textData = data.mid(1);

    if (textData.isEmpty) {
      this._fieldList = [];
      return;
    }

    const ntSize = nullTerminatorSize(this._encoding);
    const fields: string[] = [];
    let offset = 0;

    while (offset < textData.length) {
      const nullIdx = findNullTerminator(textData, this._encoding, offset);
      if (nullIdx < 0) {
        fields.push(textData.mid(offset).toString(this._encoding));
        break;
      }
      fields.push(textData.mid(offset, nullIdx - offset).toString(this._encoding));
      offset = nullIdx + ntSize;
    }

    this._fieldList = fields;
  }
}

/**
 * User text identification frame (TXXX).
 *
 * Structure: encoding(1) + description(null-terminated) + value(in encoding).
 * The first field is the description, the rest are values.
 */
export class UserTextIdentificationFrame extends TextIdentificationFrame {
  constructor(encoding: StringType = StringType.UTF8) {
    super(ByteVector.fromString("TXXX", StringType.Latin1), encoding);
  }

  get description(): string {
    const fl = this.fieldList;
    return fl.length > 0 ? fl[0] : "";
  }

  set description(value: string) {
    const fl = this.fieldList;
    if (fl.length > 0) {
      fl[0] = value;
    } else {
      fl.unshift(value);
    }
    this.fieldList = fl;
  }

  override get fieldList(): string[] {
    return super.fieldList;
  }

  override set fieldList(fields: string[]) {
    super.fieldList = fields;
  }

  override get text(): string {
    const fl = this.fieldList;
    return fl.length > 1 ? fl.slice(1).join(", ") : "";
  }

  override set text(value: string) {
    const fl = this.fieldList;
    if (fl.length > 0) {
      this.fieldList = [fl[0], value];
    } else {
      this.fieldList = ["", value];
    }
  }

  /** @internal Create from raw frame data. */
  static fromRawData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): UserTextIdentificationFrame {
    const frame = new UserTextIdentificationFrame();
    frame._header = header;
    const fieldData = Id3v2Frame.fieldData(data, header, version);
    frame.parseFields(fieldData, version);
    return frame;
  }

  static find(
    tag: { frames?: Id3v2Frame[] },
    description: string,
  ): UserTextIdentificationFrame | null {
    if (!tag.frames) return null;
    for (const frame of tag.frames) {
      if (
        frame instanceof UserTextIdentificationFrame &&
        frame.description === description
      ) {
        return frame;
      }
    }
    return null;
  }
}
