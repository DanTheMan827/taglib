import { ByteVector } from "../../byteVector.js";

/**
 * Synchsafe integer encoding/decoding for ID3v2.
 *
 * ID3v2 uses "synchsafe integers" where the most significant bit of each byte
 * is always zero, giving 7 bits of data per byte. This avoids false MPEG sync
 * signals (0xFF followed by a byte with bit 7 set) in the tag data.
 */
export class SynchData {
  /**
   * Decode a synchsafe integer to a normal unsigned number.
   * Each byte contributes 7 bits. Up to 4 bytes are read (28 bits of data).
   *
   * If any byte has bit 7 set, the data is assumed to have been written by
   * buggy software as a normal big-endian integer and is decoded accordingly.
   */
  static toUInt(data: ByteVector): number {
    let sum = 0;
    let notSynchSafe = false;
    const last = data.length > 4 ? 3 : data.length - 1;

    for (let i = 0; i <= last; i++) {
      if (data.get(i) & 0x80) {
        notSynchSafe = true;
        break;
      }
      sum |= (data.get(i) & 0x7f) << ((last - i) * 7);
    }

    if (notSynchSafe) {
      // Invalid data; assume buggy software wrote a normal big-endian integer.
      if (data.length >= 4) {
        sum = data.toUInt(0, true);
      } else {
        const tmp = ByteVector.fromByteVector(data);
        tmp.resize(4);
        sum = tmp.toUInt(0, true);
      }
    }

    return sum;
  }

  /**
   * Encode a normal unsigned number to a 4-byte synchsafe ByteVector.
   */
  static fromUInt(value: number): ByteVector {
    const v = ByteVector.fromSize(4, 0);
    for (let i = 0; i < 4; i++) {
      v.set(i, (value >>> ((3 - i) * 7)) & 0x7f);
    }
    return v;
  }

  /**
   * Decode synchsafe data by removing false sync bytes.
   * Any 0x00 byte following a 0xFF byte is stripped out.
   */
  static decode(data: ByteVector): ByteVector {
    if (data.isEmpty) {
      return new ByteVector();
    }

    const src = data.data;
    const result = new Uint8Array(src.length);
    let srcIdx = 0;
    let dstIdx = 0;

    while (srcIdx < src.length - 1) {
      result[dstIdx++] = src[srcIdx++];
      if (src[srcIdx - 1] === 0xff && src[srcIdx] === 0x00) {
        srcIdx++;
      }
    }

    if (srcIdx < src.length) {
      result[dstIdx++] = src[srcIdx++];
    }

    return new ByteVector(result.slice(0, dstIdx));
  }

  /**
   * Encode data to synchsafe form by inserting a 0x00 byte after every 0xFF.
   */
  static encode(data: ByteVector): ByteVector {
    if (data.isEmpty) {
      return new ByteVector();
    }

    const src = data.data;
    // Worst case: every byte is 0xFF, doubling the size
    const result = new Uint8Array(src.length * 2);
    let dstIdx = 0;

    for (let i = 0; i < src.length; i++) {
      result[dstIdx++] = src[i];
      if (src[i] === 0xff) {
        result[dstIdx++] = 0x00;
      }
    }

    return new ByteVector(result.slice(0, dstIdx));
  }
}
