/** @file ID3v2 synchronized lyrics frame (SYLT). Stores timestamped lyrics or text. */
import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
  nullTerminatorSize,
} from "../id3v2Frame.js";

/** Content types for the SYLT frame. */
export enum SynchedTextType {
  Other = 0x00,
  Lyrics = 0x01,
  TextTranscription = 0x02,
  Movement = 0x03,
  Events = 0x04,
  Chord = 0x05,
  Trivia = 0x06,
  WebpageUrls = 0x07,
  ImageUrls = 0x08,
}

/** A single timed text entry in a SYLT frame. */
export interface SynchedText {
  /** Timestamp of the text entry, in units determined by the frame's timestamp format. */
  time: number;
  /** The text content of this entry. */
  text: string;
}

/**
 * Synchronized lyrics/text frame (SYLT).
 *
 * Structure: encoding(1) + language(3) + timestampFormat(1) + contentType(1)
 *            + description(null-terminated in encoding)
 *            + repeated (text(null-terminated in encoding) + timestamp(4 big-endian)).
 */
export class SynchronizedLyricsFrame extends Id3v2Frame {
  /** Text encoding used for strings in this frame. */
  private _encoding: StringType = StringType.UTF8;
  /** Three-byte ISO-639-2 language code for the content. */
  private _language: ByteVector = ByteVector.fromString("XXX", StringType.Latin1);
  /** Short content description string (null-terminated in the encoding). */
  private _description: string = "";
  /** Timestamp format: 1 = MPEG frames, 2 = milliseconds. */
  private _timestampFormat: number = 2;
  /** Content type of the synchronized text (e.g., lyrics, events). */
  private _textType: SynchedTextType = SynchedTextType.Other;
  /** Ordered list of timed text entries. */
  private _synchedText: SynchedText[] = [];

  /**
   * Creates a new SYLT frame with the specified text encoding.
   * @param encoding - The string encoding to use for all text fields. Defaults to {@link StringType.UTF8}.
   */
  constructor(encoding: StringType = StringType.UTF8) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("SYLT", StringType.Latin1),
    );
    super(header);
    this._encoding = encoding;
  }

  // -- Accessors --------------------------------------------------------------

  /**
   * Gets the text encoding used for strings in this frame.
   * @returns The current {@link StringType} encoding.
   */
  get encoding(): StringType {
    return this._encoding;
  }

  /**
   * Sets the text encoding for strings in this frame.
   * @param e - The {@link StringType} encoding to use.
   */
  set encoding(e: StringType) {
    this._encoding = e;
  }

  /**
   * Gets the three-byte ISO-639-2 language code.
   * @returns A {@link ByteVector} containing the three-byte language code.
   */
  get language(): ByteVector {
    return this._language;
  }

  /**
   * Sets the language code, truncating or padding to exactly three bytes.
   * @param lang - The language bytes to set.
   */
  set language(lang: ByteVector) {
    this._language = lang.mid(0, 3);
    if (this._language.length < 3) {
      this._language.resize(3, 0x20);
    }
  }

  /**
   * Gets the content description string.
   * @returns The description string.
   */
  get description(): string {
    return this._description;
  }

  /**
   * Sets the content description string.
   * @param value - The new description string.
   */
  set description(value: string) {
    this._description = value;
  }

  /**
   * Gets the timestamp format used for synched text entries.
   * 1 = MPEG frames, 2 = milliseconds.
   * @returns The numeric timestamp format identifier.
   */
  get timestampFormat(): number {
    return this._timestampFormat;
  }

  /**
   * Sets the timestamp format used for synched text entries.
   * @param v - 1 for MPEG frames, 2 for milliseconds.
   */
  set timestampFormat(v: number) {
    this._timestampFormat = v;
  }

  /**
   * Gets the content type of the synchronized text.
   * @returns The {@link SynchedTextType} of this frame.
   */
  get textType(): SynchedTextType {
    return this._textType;
  }

  /**
   * Sets the content type of the synchronized text.
   * @param v - The {@link SynchedTextType} to set.
   */
  set textType(v: SynchedTextType) {
    this._textType = v;
  }

  /**
   * Gets the ordered list of timed text entries.
   * @returns An array of {@link SynchedText} entries.
   */
  get synchedText(): SynchedText[] {
    return this._synchedText;
  }

  /**
   * Sets the ordered list of timed text entries.
   * @param text - The array of {@link SynchedText} entries to store.
   */
  set synchedText(text: SynchedText[]) {
    this._synchedText = text;
  }

  /**
   * Returns the description string.
   * @returns The content description of this frame.
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
  ): SynchronizedLyricsFrame {
    const frame = new SynchronizedLyricsFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the raw frame fields into structured SYLT data.
   * @param data - The raw field bytes of the frame.
   * @param _version - The ID3v2 version (unused).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    if (data.length < 6) return;

    this._encoding = data.get(0) as StringType;
    this._language = data.mid(1, 3);
    this._timestampFormat = data.get(4);
    this._textType = data.get(5) as SynchedTextType;

    const ntSize = nullTerminatorSize(this._encoding);
    let offset = 6;

    // Description (null-terminated in encoding)
    const descEnd = findNullTerminator(data, this._encoding, offset);
    if (descEnd < 0) {
      this._description = data.mid(offset).toString(this._encoding);
      return;
    }
    this._description = data
      .mid(offset, descEnd - offset)
      .toString(this._encoding);
    offset = descEnd + ntSize;

    // Parse synched text entries
    this._synchedText = [];
    while (offset < data.length) {
      const textEnd = findNullTerminator(data, this._encoding, offset);
      if (textEnd < 0) break;

      const text = data
        .mid(offset, textEnd - offset)
        .toString(this._encoding);
      offset = textEnd + ntSize;

      if (offset + 4 > data.length) break;
      const time = data.mid(offset, 4).toUInt();
      offset += 4;

      this._synchedText.push({ text, time });
    }
  }

  /**
   * Serializes the SYLT frame fields into bytes.
   * @param _version - The ID3v2 version (unused).
   * @returns A {@link ByteVector} containing the encoded frame fields.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._encoding);
    v.append(this._language.mid(0, 3));
    v.append(this._timestampFormat);
    v.append(this._textType);

    const ntBytes =
      this._encoding === StringType.UTF16 ||
      this._encoding === StringType.UTF16BE ||
      this._encoding === StringType.UTF16LE
        ? ByteVector.fromSize(2, 0)
        : ByteVector.fromSize(1, 0);

    // Description
    v.append(ByteVector.fromString(this._description, this._encoding));
    v.append(ntBytes);

    // Synched text entries
    for (const entry of this._synchedText) {
      v.append(ByteVector.fromString(entry.text, this._encoding));
      v.append(ntBytes);
      v.append(ByteVector.fromUInt(entry.time));
    }

    return v;
  }
}
