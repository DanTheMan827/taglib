import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
  findNullTerminator,
} from "../id3v2Frame.js";

/**
 * Popularimeter frame (POPM).
 *
 * Structure: email(null-terminated Latin1) + rating(1 byte) + counter(variable, big-endian).
 */
export class PopularimeterFrame extends Id3v2Frame {
  private _email: string = "";
  private _rating: number = 0;
  private _counter: bigint = 0n;

  constructor() {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("POPM", StringType.Latin1),
    );
    super(header);
  }

  // -- Accessors --------------------------------------------------------------

  get email(): string {
    return this._email;
  }

  set email(value: string) {
    this._email = value;
  }

  /** Rating value 0–255. */
  get rating(): number {
    return this._rating;
  }

  set rating(value: number) {
    this._rating = Math.max(0, Math.min(255, value | 0));
  }

  get counter(): bigint {
    return this._counter;
  }

  set counter(value: bigint) {
    this._counter = value < 0n ? 0n : value;
  }

  toString(): string {
    return `${this._email} ${this._rating}/255`;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): PopularimeterFrame {
    const frame = new PopularimeterFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  protected parseFields(data: ByteVector, _version: number): void {
    const nullIdx = findNullTerminator(data, StringType.Latin1, 0);
    if (nullIdx < 0) {
      this._email = data.toString(StringType.Latin1);
      return;
    }

    this._email = data.mid(0, nullIdx).toString(StringType.Latin1);
    let offset = nullIdx + 1;

    if (offset < data.length) {
      this._rating = data.get(offset);
      offset += 1;
    }

    if (offset < data.length) {
      // Counter can be 1–8 bytes, big-endian unsigned integer
      const counterData = data.mid(offset);
      let counter = 0n;
      for (let i = 0; i < counterData.length && i < 8; i++) {
        counter = counter * 256n + BigInt(counterData.get(i));
      }
      this._counter = counter;
    }
  }

  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(ByteVector.fromString(this._email, StringType.Latin1));
    v.append(0); // null terminator
    v.append(this._rating & 0xff);

    // Render counter as big-endian variable-width, minimum 4 bytes
    if (this._counter <= 0xffffffffn) {
      v.append(ByteVector.fromUInt(Number(this._counter)));
    } else {
      // 5–8 bytes for large counters
      const bytes: number[] = [];
      let c = this._counter;
      while (c > 0n) {
        bytes.unshift(Number(c & 0xffn));
        c >>= 8n;
      }
      while (bytes.length < 4) bytes.unshift(0);
      for (const b of bytes) v.append(b);
    }

    return v;
  }
}
