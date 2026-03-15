import { ByteVector, StringType } from "../../byteVector.js";
import { Tag } from "../../tag.js";
import { IOStream } from "../../toolkit/ioStream.js";
import type { offset_t } from "../../toolkit/types.js";
import {
  genre as genreName,
  genreIndex as genreNameToIndex,
} from "./id3v1Genres.js";

/**
 * ID3v1 tag implementation.
 *
 * ID3v1 is a fixed 128-byte tag appended to the end of an MP3 file.
 * Field lengths are fixed and strings are Latin1-encoded.
 */
export class ID3v1Tag extends Tag {
  private _title: string = "";
  private _artist: string = "";
  private _album: string = "";
  private _year: string = "";
  private _comment: string = "";
  private _track: number = 0;
  private _genre: number = 255;

  constructor() {
    super();
  }

  /**
   * Read and parse an ID3v1 tag from the given stream at the specified
   * offset.  The offset should point to the first byte of the 128-byte tag
   * (i.e. the "T" in "TAG").
   */
  static readFrom(stream: IOStream, tagOffset: offset_t): ID3v1Tag {
    const tag = new ID3v1Tag();

    stream.seek(tagOffset);
    const data = stream.readBlock(128);

    if (data.length === 128 && data.startsWith(ID3v1Tag.fileIdentifier())) {
      tag.parse(data);
    }

    return tag;
  }

  // ---------------------------------------------------------------------------
  // Tag interface
  // ---------------------------------------------------------------------------

  get title(): string {
    return this._title;
  }
  set title(value: string) {
    this._title = value;
  }

  get artist(): string {
    return this._artist;
  }
  set artist(value: string) {
    this._artist = value;
  }

  get album(): string {
    return this._album;
  }
  set album(value: string) {
    this._album = value;
  }

  get comment(): string {
    return this._comment;
  }
  set comment(value: string) {
    this._comment = value;
  }

  get genre(): string {
    return genreName(this._genre);
  }
  set genre(value: string) {
    // Support ID3v2-style "(17)" genre references.
    const match = /^\((\d+)\)/.exec(value);
    if (match) {
      this._genre = parseInt(match[1], 10);
      return;
    }
    this._genre = genreNameToIndex(value) & 0xff;
  }

  get year(): number {
    const n = parseInt(this._year, 10);
    return isNaN(n) ? 0 : n;
  }
  set year(value: number) {
    this._year = value > 0 ? String(value) : "";
  }

  get track(): number {
    return this._track;
  }
  set track(value: number) {
    this._track = Math.max(0, Math.min(255, value | 0));
  }

  // ---------------------------------------------------------------------------
  // ID3v1-specific
  // ---------------------------------------------------------------------------

  get genreNumber(): number {
    return this._genre;
  }
  set genreNumber(value: number) {
    this._genre = Math.max(0, Math.min(255, value | 0));
  }

  /** Returns the "TAG" file identifier as a ByteVector. */
  static fileIdentifier(): ByteVector {
    return ByteVector.fromString("TAG", StringType.Latin1);
  }

  /** Render the tag as a 128-byte ByteVector. */
  render(): ByteVector {
    const data = new ByteVector();

    data.append(ID3v1Tag.fileIdentifier());
    data.append(
      ByteVector.fromString(this._title, StringType.Latin1).resize(30),
    );
    data.append(
      ByteVector.fromString(this._artist, StringType.Latin1).resize(30),
    );
    data.append(
      ByteVector.fromString(this._album, StringType.Latin1).resize(30),
    );
    data.append(
      ByteVector.fromString(this._year, StringType.Latin1).resize(4),
    );

    if (this._track > 0) {
      data.append(
        ByteVector.fromString(this._comment, StringType.Latin1).resize(28),
      );
      data.append(0x00);
      data.append(this._track & 0xff);
    } else {
      data.append(
        ByteVector.fromString(this._comment, StringType.Latin1).resize(30),
      );
    }

    data.append(this._genre & 0xff);

    return data;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private parse(data: ByteVector): void {
    let offset = 3;

    this._title = this.parseString(data.mid(offset, 30));
    offset += 30;

    this._artist = this.parseString(data.mid(offset, 30));
    offset += 30;

    this._album = this.parseString(data.mid(offset, 30));
    offset += 30;

    this._year = this.parseString(data.mid(offset, 4));
    offset += 4;

    // ID3v1.1: if byte 125 (offset+28) is 0 and byte 126 (offset+29) is
    // non-zero, the comment is 28 bytes and byte 126 is the track number.
    if (data.get(offset + 28) === 0 && data.get(offset + 29) !== 0) {
      this._comment = this.parseString(data.mid(offset, 28));
      this._track = data.get(offset + 29);
    } else {
      this._comment = this.parseString(data.mid(offset, 30));
    }
    offset += 30;

    this._genre = data.get(offset);
  }

  private parseString(data: ByteVector): string {
    return data.toString(StringType.Latin1).replace(/\0+$/, "").trimEnd();
  }
}
