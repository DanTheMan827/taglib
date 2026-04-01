/** @file ID3v2 comments frame (COMM). Stores free-form comments with language and description. */

import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
  nullTerminatorSize,
} from "../id3v2Frame.js";

/**
 * Comments frame (COMM).
 *
 * Structure: encoding(1) + language(3) + description(null-terminated) + text.
 */
export class CommentsFrame extends Id3v2Frame {
  /** Text encoding used for the description and comment text fields. Defaults to Latin1 matching C++ FrameFactory default. */
  private _encoding: StringType = StringType.Latin1;
  /**
   * Three-byte ISO-639-2 language code. Stored as empty by default; rendered
   * as `"XXX"` (unknown language) when not exactly 3 bytes — matching C++
   * `CommentsFrame::renderFields()`: `d->language.size() == 3 ? d->language : "XXX"`.
   */
  private _language: ByteVector = new ByteVector();
  /** Short content description that distinguishes multiple COMM frames. */
  private _description: string = "";
  /** The actual comment text. */
  private _text: string = "";

  /**
   * Creates a new, empty CommentsFrame.
   * @param encoding - Text encoding to use for description and comment text.
   *                   Defaults to `StringType.Latin1` (matching C++ TagLib `FrameFactory` default).
   */
  constructor(encoding: StringType = StringType.Latin1) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("COMM", StringType.Latin1),
    );
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  /** Gets the text encoding used for description and comment text fields. */
  get encoding(): StringType {
    return this._encoding;
  }

  /** Sets the text encoding used for description and comment text fields. */
  set encoding(e: StringType) {
    this._encoding = e;
  }

  /** Gets the three-byte ISO-639-2 language code. */
  get language(): ByteVector {
    return this._language;
  }

  /**
   * Sets the language code. The value is truncated or padded with spaces to
   * exactly 3 bytes.
   */
  set language(lang: ByteVector) {
    this._language = lang.mid(0, 3);
    if (this._language.length < 3) {
      this._language.resize(3, 0x20); // pad with space
    }
  }

  /** Gets the short content description. */
  get description(): string {
    return this._description;
  }

  /** Sets the short content description. */
  set description(value: string) {
    this._description = value;
  }

  /** Gets the comment text. */
  get text(): string {
    return this._text;
  }

  /** Sets the comment text. */
  set text(value: string) {
    this._text = value;
  }

  /**
   * Returns the comment text.
   * @returns The comment text string.
   */
  toString(): string {
    return this._text;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): CommentsFrame {
    const frame = new CommentsFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  /**
   * Searches for a `CommentsFrame` with the given description in an ID3v2 tag.
   * @param tag - An object exposing a `frames` array of `Id3v2Frame` instances.
   * @param description - The content description to match against.
   * @returns The first matching `CommentsFrame`, or `null` if none is found.
   */
  static findByDescription(
    tag: { frames?: Id3v2Frame[] },
    description: string,
  ): CommentsFrame | null {
    if (!tag.frames) return null;
    for (const frame of tag.frames) {
      if (
        frame instanceof CommentsFrame &&
        frame._description === description
      ) {
        return frame;
      }
    }
    return null;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the raw COMM frame field data, populating all comment properties.
   * @param data - Decoded frame field bytes.
   * @param _version - ID3v2 version number (unused for COMM parsing).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    if (data.length < 4) return;

    this._encoding = data.get(0) as StringType;
    this._language = data.mid(1, 3);

    const ntSize = nullTerminatorSize(this._encoding);
    const descStart = 4;
    const nullIdx = findNullTerminator(data, this._encoding, descStart);

    if (nullIdx < 0) {
      this._description = data.mid(descStart).toString(this._encoding);
      this._text = "";
    } else {
      this._description = data
        .mid(descStart, nullIdx - descStart)
        .toString(this._encoding);
      this._text = data
        .mid(nullIdx + ntSize)
        .toString(this._encoding);
    }
  }

  /**
   * Renders the COMM frame field data to bytes.
   * @param _version - ID3v2 version number (unused for COMM rendering).
   * @returns A `ByteVector` containing the encoded COMM field data.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._encoding);
    // Match C++: d->language.size() == 3 ? d->language : "XXX"
    v.append(this._language.length === 3
      ? this._language.mid(0, 3)
      : ByteVector.fromString("XXX", StringType.Latin1));
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
    v.append(ByteVector.fromString(this._text, this._encoding));
    return v;
  }
}
