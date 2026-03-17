/** @file FLAC picture metadata block — parsing and rendering. */
import { ByteVector, StringType } from "../byteVector.js";

/**
 * FLAC picture metadata block. All integer fields are big-endian.
 *
 * Layout:
 *   pictureType(4) + mimeTypeLength(4) + mimeType(UTF-8) +
 *   descriptionLength(4) + description(UTF-8) +
 *   width(4) + height(4) + colorDepth(4) + numColors(4) +
 *   dataLength(4) + data
 */
export class FlacPicture {
  /** Picture type code as defined by the ID3v2 APIC frame (e.g. 3 = cover art). */
  pictureType: number = 0;
  /** MIME type string (e.g. `"image/jpeg"`). */
  mimeType: string = "";
  /** UTF-8 description of the picture. */
  description: string = "";
  /** Image width in pixels. */
  width: number = 0;
  /** Image height in pixels. */
  height: number = 0;
  /** Colour depth (bits per pixel). */
  colorDepth: number = 0;
  /** Number of colours for indexed images, or 0 for non-indexed formats. */
  numColors: number = 0;
  /** Raw binary image data. */
  data: ByteVector = new ByteVector();

  /**
   * Parse a FLAC picture block from raw bytes.
   * @param data The raw picture block payload (big-endian integers).
   * @returns A {@link FlacPicture} populated from the data, or a default instance if the data is too short.
   */
  static parse(data: ByteVector): FlacPicture {
    const pic = new FlacPicture();
    let pos = 0;

    if (data.length < 32) {
      return pic;
    }

    pic.pictureType = data.toUInt(pos, true);
    pos += 4;

    const mimeLen = data.toUInt(pos, true);
    pos += 4;
    if (mimeLen > 0 && pos + mimeLen <= data.length) {
      pic.mimeType = data.mid(pos, mimeLen).toString(StringType.UTF8);
    }
    pos += mimeLen;

    if (pos + 4 > data.length) return pic;
    const descLen = data.toUInt(pos, true);
    pos += 4;
    if (descLen > 0 && pos + descLen <= data.length) {
      pic.description = data.mid(pos, descLen).toString(StringType.UTF8);
    }
    pos += descLen;

    if (pos + 20 > data.length) return pic;
    pic.width = data.toUInt(pos, true);
    pos += 4;
    pic.height = data.toUInt(pos, true);
    pos += 4;
    pic.colorDepth = data.toUInt(pos, true);
    pos += 4;
    pic.numColors = data.toUInt(pos, true);
    pos += 4;

    const dataLen = data.toUInt(pos, true);
    pos += 4;
    if (dataLen > 0 && pos + dataLen <= data.length) {
      pic.data = data.mid(pos, dataLen);
    }

    return pic;
  }

  /**
   * Render the picture block back to bytes (big-endian).
   * @returns A {@link ByteVector} containing the serialised picture block payload.
   */
  render(): ByteVector {
    const mimeBytes = ByteVector.fromString(this.mimeType, StringType.UTF8);
    const descBytes = ByteVector.fromString(this.description, StringType.UTF8);

    // Pre-calculate total size: 4*9 fixed fields + mimeType + description + data
    const totalSize = 4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 + 4 + 4 + 4 + 4 + this.data.length;
    const arr = new Uint8Array(totalSize);
    const view = new DataView(arr.buffer);
    let pos = 0;

    view.setUint32(pos, this.pictureType); pos += 4;
    view.setUint32(pos, mimeBytes.length); pos += 4;
    arr.set(mimeBytes.data, pos); pos += mimeBytes.length;
    view.setUint32(pos, descBytes.length); pos += 4;
    arr.set(descBytes.data, pos); pos += descBytes.length;
    view.setUint32(pos, this.width); pos += 4;
    view.setUint32(pos, this.height); pos += 4;
    view.setUint32(pos, this.colorDepth); pos += 4;
    view.setUint32(pos, this.numColors); pos += 4;
    view.setUint32(pos, this.data.length); pos += 4;
    arr.set(this.data.data, pos);

    return new ByteVector(arr);
  }
}
