/** @file ID3v1 tag implementation. Reads and writes the fixed 128-byte ID3v1 tag block. */

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
  /** The track title. */
  private _title: string = "";
  /** The lead artist or performer. */
  private _artist: string = "";
  /** The album or collection name. */
  private _album: string = "";
  /** The release year stored as a 4-character Latin1 string. */
  private _year: string = "";
  /** Free-form comment text. */
  private _comment: string = "";
  /** The track number within the album (0 if unset). */
  private _track: number = 0;
  /** The genre index into the ID3v1 genre table (255 = unknown). */
  private _genre: number = 255;

  /** Creates a new, empty ID3v1Tag. */
  constructor() {
    super();
  }

  /**
   * Asynchronously read and parse an ID3v1 tag from the given stream at the
   * specified offset. The offset should point to the first byte of the
   * 128-byte tag (i.e. the "T" in "TAG"). Returns a `Promise<ID3v1Tag>`.
   */
  static async readFrom(stream: IOStream, tagOffset: offset_t): Promise<ID3v1Tag> {
    const tag = new ID3v1Tag();

    await stream.seek(tagOffset);
    const data = await stream.readBlock(128);

    if (data.length === 128 && data.startsWith(ID3v1Tag.fileIdentifier())) {
      tag.parse(data);
    }

    return tag;
  }

  // ---------------------------------------------------------------------------
  // Tag interface
  // ---------------------------------------------------------------------------

  /** Gets the track title. */
  get title(): string {
    return this._title;
  }
  /** Sets the track title. */
  set title(value: string) {
    this._title = value;
  }

  /** Gets the lead artist or performer. */
  get artist(): string {
    return this._artist;
  }
  /** Sets the lead artist or performer. */
  set artist(value: string) {
    this._artist = value;
  }

  /** Gets the album or collection name. */
  get album(): string {
    return this._album;
  }
  /** Sets the album or collection name. */
  set album(value: string) {
    this._album = value;
  }

  /** Gets the free-form comment text. */
  get comment(): string {
    return this._comment;
  }
  /** Sets the free-form comment text. */
  set comment(value: string) {
    this._comment = value;
  }

  /** Gets the genre name resolved from the stored genre index. */
  get genre(): string {
    return genreName(this._genre);
  }
  /**
   * Sets the genre by name. Supports ID3v2-style numeric references such as
   * `"(17)"`. Unrecognised names are stored as index 255 (unknown).
   */
  set genre(value: string) {
    // Support ID3v2-style "(17)" genre references.
    const match = /^\((\d+)\)/.exec(value);
    if (match) {
      this._genre = parseInt(match[1], 10);
      return;
    }
    this._genre = genreNameToIndex(value) & 0xff;
  }

  /** Gets the release year, or 0 if unset or unparseable. */
  get year(): number {
    const n = parseInt(this._year, 10);
    return isNaN(n) ? 0 : n;
  }
  /** Sets the release year. A value ≤ 0 clears the field. */
  set year(value: number) {
    this._year = value > 0 ? String(value) : "";
  }

  /** Gets the track number within the album (0 if unset). */
  get track(): number {
    return this._track;
  }
  /** Sets the track number, clamped to the range 0–255. */
  set track(value: number) {
    this._track = Math.max(0, Math.min(255, value | 0));
  }

  // ---------------------------------------------------------------------------
  // ID3v1-specific
  // ---------------------------------------------------------------------------

  /** Gets the raw numeric genre index (0–254, or 255 for unknown). */
  get genreNumber(): number {
    return this._genre;
  }
  /** Sets the raw numeric genre index, clamped to the range 0–255. */
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

  /**
   * Parses a raw 128-byte ID3v1 tag buffer, populating all tag fields.
   * @param data - Raw 128-byte tag buffer including the "TAG" identifier.
   */
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

  /**
   * Strips null bytes and trailing whitespace from a fixed-length Latin1 string field.
   * @param data - The raw fixed-length string field.
   * @returns The trimmed string.
   */
  private parseString(data: ByteVector): string {
    return data.toString(StringType.Latin1).replace(/\0+$/, "").trimEnd();
  }
}
