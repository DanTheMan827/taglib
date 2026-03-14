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
  pictureType: number = 0;
  mimeType: string = "";
  description: string = "";
  width: number = 0;
  height: number = 0;
  colorDepth: number = 0;
  numColors: number = 0;
  data: ByteVector = new ByteVector();

  /**
   * Parse a FLAC picture block from raw bytes.
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
   */
  render(): ByteVector {
    const mimeBytes = ByteVector.fromString(this.mimeType, StringType.UTF8);
    const descBytes = ByteVector.fromString(this.description, StringType.UTF8);

    const result = new ByteVector();
    result.append(ByteVector.fromUInt(this.pictureType, true));
    result.append(ByteVector.fromUInt(mimeBytes.length, true));
    result.append(mimeBytes);
    result.append(ByteVector.fromUInt(descBytes.length, true));
    result.append(descBytes);
    result.append(ByteVector.fromUInt(this.width, true));
    result.append(ByteVector.fromUInt(this.height, true));
    result.append(ByteVector.fromUInt(this.colorDepth, true));
    result.append(ByteVector.fromUInt(this.numColors, true));
    result.append(ByteVector.fromUInt(this.data.length, true));
    result.append(this.data);

    return result;
  }
}
