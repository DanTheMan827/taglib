/**
 * String encoding types matching TagLib's String::Type enum.
 */
export enum StringType {
  Latin1 = 0,
  UTF16 = 1,
  UTF16BE = 2,
  UTF8 = 3,
  UTF16LE = 4,
}

const textEncoder = new TextEncoder();
const textDecoderUtf8 = new TextDecoder("utf-8");

/**
 * A binary data container wrapping a Uint8Array, providing methods for
 * searching, manipulation, integer/float conversions, encoding, and comparison.
 * This is a TypeScript port of TagLib's ByteVector class.
 */
export class ByteVector {
  private _data: Uint8Array;

  constructor(data?: Uint8Array) {
    this._data = data ? data : new Uint8Array(0);
  }

  // ---------------------------------------------------------------------------
  // Static factory methods
  // ---------------------------------------------------------------------------

  static fromByteArray(data: Uint8Array): ByteVector {
    return new ByteVector(new Uint8Array(data));
  }

  static fromSize(size: number, fill: number = 0): ByteVector {
    const arr = new Uint8Array(size);
    if (fill !== 0) {
      arr.fill(fill & 0xff);
    }
    return new ByteVector(arr);
  }

  static fromString(s: string, encoding: StringType = StringType.UTF8): ByteVector {
    switch (encoding) {
      case StringType.Latin1: {
        const arr = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) {
          arr[i] = s.charCodeAt(i) & 0xff;
        }
        return new ByteVector(arr);
      }
      case StringType.UTF8:
        return new ByteVector(textEncoder.encode(s));
      case StringType.UTF16: {
        // UTF-16 with BOM (little-endian by default)
        const arr = new Uint8Array(2 + s.length * 2);
        arr[0] = 0xff;
        arr[1] = 0xfe;
        for (let i = 0; i < s.length; i++) {
          const code = s.charCodeAt(i);
          arr[2 + i * 2] = code & 0xff;
          arr[2 + i * 2 + 1] = (code >> 8) & 0xff;
        }
        return new ByteVector(arr);
      }
      case StringType.UTF16BE: {
        const arr = new Uint8Array(s.length * 2);
        for (let i = 0; i < s.length; i++) {
          const code = s.charCodeAt(i);
          arr[i * 2] = (code >> 8) & 0xff;
          arr[i * 2 + 1] = code & 0xff;
        }
        return new ByteVector(arr);
      }
      case StringType.UTF16LE: {
        const arr = new Uint8Array(s.length * 2);
        for (let i = 0; i < s.length; i++) {
          const code = s.charCodeAt(i);
          arr[i * 2] = code & 0xff;
          arr[i * 2 + 1] = (code >> 8) & 0xff;
        }
        return new ByteVector(arr);
      }
      default:
        return new ByteVector(textEncoder.encode(s));
    }
  }

  static fromUint8Array(data: Uint8Array): ByteVector {
    return new ByteVector(new Uint8Array(data));
  }

  static fromByteVector(other: ByteVector): ByteVector {
    return new ByteVector(new Uint8Array(other._data));
  }

  // ---------------------------------------------------------------------------
  // Data access
  // ---------------------------------------------------------------------------

  get(index: number): number {
    if (index < 0 || index >= this._data.length) {
      return 0;
    }
    return this._data[index];
  }

  set(index: number, value: number): void {
    if (index >= 0 && index < this._data.length) {
      this._data[index] = value & 0xff;
    }
  }

  get data(): Uint8Array {
    return this._data;
  }

  mid(index: number, length?: number): ByteVector {
    if (index < 0) {
      index = 0;
    }
    if (index >= this._data.length) {
      return new ByteVector();
    }
    const maxLen = this._data.length - index;
    const len = length !== undefined ? Math.min(length, maxLen) : maxLen;
    if (len <= 0) {
      return new ByteVector();
    }
    return new ByteVector(new Uint8Array(this._data.buffer, this._data.byteOffset + index, len).slice());
  }

  get length(): number {
    return this._data.length;
  }

  get isEmpty(): boolean {
    return this._data.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  find(pattern: ByteVector, offset: number = 0, byteAlign: number = 1): number {
    if (pattern._data.length === 0 || this._data.length === 0) {
      return -1;
    }
    if (offset < 0) {
      offset = 0;
    }
    const patLen = pattern._data.length;
    const dataLen = this._data.length;

    if (patLen > dataLen) {
      return -1;
    }

    const lastPossible = dataLen - patLen;
    for (let i = offset; i <= lastPossible; i++) {
      if (byteAlign > 1 && (i - offset) % byteAlign !== 0) {
        continue;
      }
      let match = true;
      for (let j = 0; j < patLen; j++) {
        if (this._data[i + j] !== pattern._data[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        return i;
      }
    }
    return -1;
  }

  rfind(pattern: ByteVector, offset: number = 0, byteAlign: number = 1): number {
    if (pattern._data.length === 0 || this._data.length === 0) {
      return -1;
    }
    const patLen = pattern._data.length;
    const dataLen = this._data.length;

    if (patLen > dataLen) {
      return -1;
    }

    // offset=0 means search from the very end (no constraint).
    // offset>0 means the search starts backwards from that position.
    const lastPossible = dataLen - patLen;
    const start = offset > 0 && offset <= lastPossible ? offset : lastPossible;

    for (let i = start; i >= 0; i--) {
      if (byteAlign > 1 && (start - i) % byteAlign !== 0) {
        continue;
      }
      let match = true;
      for (let j = 0; j < patLen; j++) {
        if (this._data[i + j] !== pattern._data[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        return i;
      }
    }
    return -1;
  }

  containsAt(
    pattern: ByteVector,
    offset: number,
    patternOffset: number = 0,
    patternLength?: number,
  ): boolean {
    if (pattern._data.length === 0 || this._data.length === 0) {
      return false;
    }
    const pLen =
      patternLength !== undefined
        ? Math.min(patternLength, pattern._data.length - patternOffset)
        : pattern._data.length - patternOffset;
    if (pLen <= 0) {
      return false;
    }
    if (offset + pLen > this._data.length) {
      return false;
    }
    for (let i = 0; i < pLen; i++) {
      if (this._data[offset + i] !== pattern._data[patternOffset + i]) {
        return false;
      }
    }
    return true;
  }

  startsWith(pattern: ByteVector): boolean {
    if (pattern._data.length === 0 || this._data.length === 0) {
      return false;
    }
    return this.containsAt(pattern, 0);
  }

  endsWith(pattern: ByteVector): boolean {
    if (pattern._data.length === 0 || this._data.length === 0) {
      return false;
    }
    return this.containsAt(pattern, this._data.length - pattern._data.length);
  }

  /**
   * Checks whether the last bytes of this vector partially match the
   * beginning of `pattern`. Returns the index within this vector where the
   * partial match starts, or -1 if no partial match is found.
   */
  endsWithPartialMatch(pattern: ByteVector): number {
    if (pattern._data.length === 0 || this._data.length === 0) {
      return -1;
    }
    const patLen = pattern._data.length;
    // Check partial matches from length patLen-1 down to 1
    for (let len = patLen - 1; len > 0; len--) {
      const startIdx = this._data.length - len;
      if (startIdx < 0) {
        continue;
      }
      let match = true;
      for (let j = 0; j < len; j++) {
        if (this._data[startIdx + j] !== pattern._data[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        return startIdx;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Manipulation
  // ---------------------------------------------------------------------------

  append(other: ByteVector | number): ByteVector {
    if (typeof other === "number") {
      const newData = new Uint8Array(this._data.length + 1);
      newData.set(this._data);
      newData[this._data.length] = other & 0xff;
      this._data = newData;
    } else {
      if (other._data.length === 0) {
        return this;
      }
      const newData = new Uint8Array(this._data.length + other._data.length);
      newData.set(this._data);
      // Use a copy of other's data in case other === this
      newData.set(new Uint8Array(other._data), this._data.length);
      this._data = newData;
    }
    return this;
  }

  clear(): ByteVector {
    this._data = new Uint8Array(0);
    return this;
  }

  resize(size: number, padding: number = 0): ByteVector {
    if (size === this._data.length) {
      return this;
    }
    if (size <= 0) {
      this._data = new Uint8Array(0);
      return this;
    }
    const newData = new Uint8Array(size);
    if (size > this._data.length) {
      newData.set(this._data);
      if (padding !== 0) {
        newData.fill(padding & 0xff, this._data.length);
      }
    } else {
      newData.set(this._data.subarray(0, size));
    }
    this._data = newData;
    return this;
  }

  /**
   * Replace bytes. Supports both single-byte replacement and pattern-based
   * replacement (ByteVector pattern → ByteVector replacement).
   */
  replace(oldByte: number | ByteVector, newByte: number | ByteVector): ByteVector {
    if (typeof oldByte === "number" && typeof newByte === "number") {
      // Single byte replacement
      const old = oldByte & 0xff;
      const rep = newByte & 0xff;
      // Work on a copy to ensure detachment semantics
      this._data = new Uint8Array(this._data);
      for (let i = 0; i < this._data.length; i++) {
        if (this._data[i] === old) {
          this._data[i] = rep;
        }
      }
      return this;
    }

    // ByteVector-based replace
    const pattern = oldByte instanceof ByteVector ? oldByte : ByteVector.fromSize(1, oldByte as number);
    const replacement = newByte instanceof ByteVector ? newByte : ByteVector.fromSize(1, newByte as number);

    if (pattern._data.length === 0 || pattern._data.length > this._data.length) {
      return this;
    }

    // Collect all match positions
    const positions: number[] = [];
    let searchFrom = 0;
    while (searchFrom <= this._data.length - pattern._data.length) {
      let match = true;
      for (let j = 0; j < pattern._data.length; j++) {
        if (this._data[searchFrom + j] !== pattern._data[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        positions.push(searchFrom);
        searchFrom += pattern._data.length;
      } else {
        searchFrom++;
      }
    }

    if (positions.length === 0) {
      return this;
    }

    // Build new data
    const newLen =
      this._data.length + positions.length * (replacement._data.length - pattern._data.length);
    const result = new Uint8Array(newLen);
    let srcIdx = 0;
    let dstIdx = 0;
    for (const pos of positions) {
      // Copy bytes before this match
      if (pos > srcIdx) {
        result.set(this._data.subarray(srcIdx, pos), dstIdx);
        dstIdx += pos - srcIdx;
      }
      // Copy replacement
      result.set(replacement._data, dstIdx);
      dstIdx += replacement._data.length;
      srcIdx = pos + pattern._data.length;
    }
    // Copy remaining bytes
    if (srcIdx < this._data.length) {
      result.set(this._data.subarray(srcIdx), dstIdx);
    }

    this._data = result;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Integer conversions - helpers
  // ---------------------------------------------------------------------------

  /**
   * Read an unsigned integer from up to `maxBytes` bytes starting at
   * `offset`. When fewer bytes are available than requested, only the
   * available bytes contribute to the value (the remaining high-order bits
   * are zero). This matches the C++ TagLib behaviour for partial reads.
   */
  private readUnsigned(offset: number, maxBytes: number, msbFirst: boolean): number {
    const available = Math.max(0, Math.min(maxBytes, this._data.length - offset));
    if (available <= 0) return 0;

    let value = 0;
    if (msbFirst) {
      for (let i = 0; i < available; i++) {
        value = (value << 8) | this._data[offset + i];
      }
    } else {
      for (let i = available - 1; i >= 0; i--) {
        value = (value << 8) | this._data[offset + i];
      }
    }
    return value >>> 0;
  }

  /**
   * Same as readUnsigned but returns a BigInt, supporting up to 8 bytes.
   */
  private readUnsignedBig(offset: number, maxBytes: number, msbFirst: boolean): bigint {
    const available = Math.max(0, Math.min(maxBytes, this._data.length - offset));
    if (available <= 0) return 0n;

    let value = 0n;
    if (msbFirst) {
      for (let i = 0; i < available; i++) {
        value = (value << 8n) | BigInt(this._data[offset + i]);
      }
    } else {
      for (let i = available - 1; i >= 0; i--) {
        value = (value << 8n) | BigInt(this._data[offset + i]);
      }
    }
    return value;
  }

  private static parseOffsetMsb(
    offsetOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): [number, boolean] {
    let offset = 0;
    let msb = true;
    if (typeof offsetOrMsb === "boolean") {
      msb = offsetOrMsb;
    } else if (typeof offsetOrMsb === "number") {
      offset = offsetOrMsb;
      msb = msbFirst !== undefined ? msbFirst : true;
    }
    return [offset, msb];
  }

  // ---------------------------------------------------------------------------
  // toInt overloads
  // ---------------------------------------------------------------------------

  toInt(): number;
  toInt(msbFirst: boolean): number;
  toInt(offset: number, msbFirst?: boolean): number;
  toInt(
    offsetOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): number {
    const [offset, msb] = ByteVector.parseOffsetMsb(offsetOrMsb, msbFirst);
    const u = this.readUnsigned(offset, 4, msb);
    return u > 0x7fffffff ? u - 0x100000000 : u;
  }

  // ---------------------------------------------------------------------------
  // toUInt overloads
  // ---------------------------------------------------------------------------

  toUInt(): number;
  toUInt(msbFirst: boolean): number;
  toUInt(offset: number, msbFirst?: boolean): number;
  toUInt(offset: number, length: number, msbFirst?: boolean): number;
  toUInt(
    offsetOrMsb?: number | boolean,
    lengthOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): number {
    let offset = 0;
    let len = 4;
    let msb = true;

    if (arguments.length === 0) {
      // toUInt()
    } else if (arguments.length === 1) {
      if (typeof offsetOrMsb === "boolean") {
        msb = offsetOrMsb;
      } else {
        offset = offsetOrMsb as number;
      }
    } else if (arguments.length === 2) {
      offset = offsetOrMsb as number;
      if (typeof lengthOrMsb === "boolean") {
        msb = lengthOrMsb;
      } else {
        len = lengthOrMsb as number;
      }
    } else {
      offset = offsetOrMsb as number;
      len = lengthOrMsb as number;
      msb = msbFirst !== undefined ? msbFirst : true;
    }

    if (len <= 0 || len > 4) {
      len = 4;
    }

    return this.readUnsigned(offset, len, msb);
  }

  // ---------------------------------------------------------------------------
  // toShort overloads
  // ---------------------------------------------------------------------------

  toShort(): number;
  toShort(msbFirst: boolean): number;
  toShort(offset: number, msbFirst?: boolean): number;
  toShort(
    offsetOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): number {
    const [offset, msb] = ByteVector.parseOffsetMsb(offsetOrMsb, msbFirst);
    const u = this.readUnsigned(offset, 2, msb) & 0xffff;
    return u > 0x7fff ? u - 0x10000 : u;
  }

  // ---------------------------------------------------------------------------
  // toUShort overloads
  // ---------------------------------------------------------------------------

  toUShort(): number;
  toUShort(msbFirst: boolean): number;
  toUShort(offset: number, msbFirst?: boolean): number;
  toUShort(
    offsetOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): number {
    const [offset, msb] = ByteVector.parseOffsetMsb(offsetOrMsb, msbFirst);
    return this.readUnsigned(offset, 2, msb) & 0xffff;
  }

  // ---------------------------------------------------------------------------
  // toLongLong overloads
  // ---------------------------------------------------------------------------

  toLongLong(): bigint;
  toLongLong(msbFirst: boolean): bigint;
  toLongLong(offset: number, msbFirst?: boolean): bigint;
  toLongLong(
    offsetOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): bigint {
    const [offset, msb] = ByteVector.parseOffsetMsb(offsetOrMsb, msbFirst);
    const u = this.readUnsignedBig(offset, 8, msb);
    return u > 0x7fffffffffffffffn ? u - 0x10000000000000000n : u;
  }

  // ---------------------------------------------------------------------------
  // toULongLong overloads
  // ---------------------------------------------------------------------------

  toULongLong(): bigint;
  toULongLong(msbFirst: boolean): bigint;
  toULongLong(offset: number, msbFirst?: boolean): bigint;
  toULongLong(
    offsetOrMsb?: number | boolean,
    msbFirst?: boolean,
  ): bigint {
    const [offset, msb] = ByteVector.parseOffsetMsb(offsetOrMsb, msbFirst);
    return this.readUnsignedBig(offset, 8, msb);
  }

  // ---------------------------------------------------------------------------
  // Static integer construction
  // ---------------------------------------------------------------------------

  static fromUInt(value: number, msbFirst: boolean = true): ByteVector {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setUint32(0, value >>> 0, !msbFirst);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromShort(value: number, msbFirst: boolean = true): ByteVector {
    const buf = new ArrayBuffer(2);
    const dv = new DataView(buf);
    dv.setInt16(0, value, !msbFirst);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromUShort(value: number, msbFirst: boolean = true): ByteVector {
    const buf = new ArrayBuffer(2);
    const dv = new DataView(buf);
    dv.setUint16(0, value, !msbFirst);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromLongLong(value: bigint, msbFirst: boolean = true): ByteVector {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setBigInt64(0, value, !msbFirst);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromULongLong(value: bigint, msbFirst: boolean = true): ByteVector {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setBigUint64(0, value, !msbFirst);
    return new ByteVector(new Uint8Array(buf));
  }

  // ---------------------------------------------------------------------------
  // Floating-point conversions
  // ---------------------------------------------------------------------------

  toFloat32BE(offset: number): number {
    const bytes = readBytesFromArray(this._data, offset, 4);
    if (bytes.every((b) => b === 0)) return 0;
    const dv = new DataView(bytes.buffer);
    return dv.getFloat32(0, false);
  }

  toFloat32LE(offset: number): number {
    const bytes = readBytesFromArray(this._data, offset, 4);
    if (bytes.every((b) => b === 0)) return 0;
    const dv = new DataView(bytes.buffer);
    return dv.getFloat32(0, true);
  }

  toFloat64BE(offset: number): number {
    const bytes = readBytesFromArray(this._data, offset, 8);
    if (bytes.every((b) => b === 0)) return 0;
    const dv = new DataView(bytes.buffer);
    return dv.getFloat64(0, false);
  }

  toFloat64LE(offset: number): number {
    const bytes = readBytesFromArray(this._data, offset, 8);
    if (bytes.every((b) => b === 0)) return 0;
    const dv = new DataView(bytes.buffer);
    return dv.getFloat64(0, true);
  }

  /**
   * Decode an 80-bit IEEE 754 extended-precision float (big-endian).
   * Layout: 1 sign bit, 15 exponent bits, 64 mantissa bits (with explicit
   * integer bit).
   */
  toFloat80BE(offset: number): number {
    const bytes = readBytesFromArray(this._data, offset, 10);
    if (bytes.every((b) => b === 0)) return 0;
    return decodeFloat80(bytes, false);
  }

  /**
   * Decode an 80-bit IEEE 754 extended-precision float (little-endian).
   */
  toFloat80LE(offset: number): number {
    const bytes = readBytesFromArray(this._data, offset, 10);
    if (bytes.every((b) => b === 0)) return 0;
    return decodeFloat80(bytes, true);
  }

  static fromFloat32BE(value: number): ByteVector {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, false);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromFloat32LE(value: number): ByteVector {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromFloat64BE(value: number): ByteVector {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, false);
    return new ByteVector(new Uint8Array(buf));
  }

  static fromFloat64LE(value: number): ByteVector {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    return new ByteVector(new Uint8Array(buf));
  }

  // ---------------------------------------------------------------------------
  // Encoding
  // ---------------------------------------------------------------------------

  /**
   * Return a new ByteVector where each byte is represented as two ASCII hex
   * characters (lowercase).
   */
  toHex(): ByteVector {
    const hexChars = "0123456789abcdef";
    const result = new Uint8Array(this._data.length * 2);
    for (let i = 0; i < this._data.length; i++) {
      result[i * 2] = hexChars.charCodeAt((this._data[i] >> 4) & 0x0f);
      result[i * 2 + 1] = hexChars.charCodeAt(this._data[i] & 0x0f);
    }
    return new ByteVector(result);
  }

  /**
   * Base64-encode this vector's bytes and return the result as a new
   * ByteVector containing the ASCII base64 text.
   */
  toBase64(): ByteVector {
    if (this._data.length === 0) {
      return new ByteVector();
    }
    return new ByteVector(textEncoder.encode(base64Encode(this._data)));
  }

  /**
   * Decode a base64-encoded ByteVector. Returns an empty ByteVector on
   * invalid input.
   */
  static fromBase64(input: ByteVector): ByteVector {
    if (input._data.length === 0) {
      return new ByteVector();
    }
    const decoded = base64Decode(input._data);
    if (decoded === null) {
      return new ByteVector();
    }
    return new ByteVector(decoded);
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------

  equals(other: ByteVector): boolean {
    if (this._data.length !== other._data.length) {
      return false;
    }
    for (let i = 0; i < this._data.length; i++) {
      if (this._data[i] !== other._data[i]) {
        return false;
      }
    }
    return true;
  }

  /** Lexicographic less-than comparison. */
  lessThan(other: ByteVector): boolean {
    const minLen = Math.min(this._data.length, other._data.length);
    for (let i = 0; i < minLen; i++) {
      if (this._data[i] < other._data[i]) return true;
      if (this._data[i] > other._data[i]) return false;
    }
    return this._data.length < other._data.length;
  }

  /**
   * Convert the byte data to a string using the given encoding.
   */
  toString(encoding: StringType = StringType.UTF8): string {
    if (this._data.length === 0) {
      return "";
    }
    switch (encoding) {
      case StringType.Latin1: {
        let s = "";
        for (let i = 0; i < this._data.length; i++) {
          s += String.fromCharCode(this._data[i]);
        }
        return s;
      }
      case StringType.UTF8:
        return textDecoderUtf8.decode(this._data);
      case StringType.UTF16: {
        // Detect BOM
        if (this._data.length >= 2) {
          if (this._data[0] === 0xff && this._data[1] === 0xfe) {
            return decodeUtf16(this._data.subarray(2), true);
          }
          if (this._data[0] === 0xfe && this._data[1] === 0xff) {
            return decodeUtf16(this._data.subarray(2), false);
          }
        }
        // Default to big-endian if no BOM
        return decodeUtf16(this._data, false);
      }
      case StringType.UTF16BE:
        return decodeUtf16(this._data, false);
      case StringType.UTF16LE:
        return decodeUtf16(this._data, true);
      default:
        return textDecoderUtf8.decode(this._data);
    }
  }

  // ---------------------------------------------------------------------------
  // Iteration
  // ---------------------------------------------------------------------------

  *[Symbol.iterator](): Generator<number, void, undefined> {
    for (let i = 0; i < this._data.length; i++) {
      yield this._data[i];
    }
  }
}

// =============================================================================
// Internal helper functions
// =============================================================================

/**
 * Read up to `count` bytes starting at `offset` from a Uint8Array,
 * zero-padding any bytes that fall beyond the end.
 */
function readBytesFromArray(data: Uint8Array, offset: number, count: number): Uint8Array {
  const buf = new Uint8Array(count);
  const available = Math.max(0, Math.min(count, data.length - offset));
  if (available > 0 && offset >= 0) {
    buf.set(data.subarray(offset, offset + available));
  }
  return buf;
}

function decodeUtf16(data: Uint8Array, littleEndian: boolean): string {
  let s = "";
  const len = data.length - (data.length % 2);
  for (let i = 0; i < len; i += 2) {
    const code = littleEndian
      ? data[i] | (data[i + 1] << 8)
      : (data[i] << 8) | data[i + 1];
    s += String.fromCharCode(code);
  }
  return s;
}

/**
 * Decode a 10-byte IEEE 754 extended-precision (80-bit) float.
 * @param bytes - exactly 10 bytes
 * @param littleEndian - true if the bytes are in little-endian order
 */
function decodeFloat80(bytes: Uint8Array, littleEndian: boolean): number {
  // Normalise to big-endian
  let b: Uint8Array;
  if (littleEndian) {
    b = new Uint8Array(10);
    for (let i = 0; i < 10; i++) {
      b[i] = bytes[9 - i];
    }
  } else {
    b = bytes;
  }

  const sign = (b[0] >> 7) & 1;
  const exponent = ((b[0] & 0x7f) << 8) | b[1];
  // 64-bit mantissa (with explicit integer bit)
  let mantissa = BigInt(0);
  for (let i = 2; i < 10; i++) {
    mantissa = (mantissa << BigInt(8)) | BigInt(b[i]);
  }

  if (exponent === 0 && mantissa === BigInt(0)) {
    return sign ? -0 : 0;
  }
  if (exponent === 0x7fff) {
    // Infinity or NaN
    if (mantissa === BigInt(0)) {
      return sign ? -Infinity : Infinity;
    }
    return NaN;
  }

  // The bias for 80-bit extended is 16383
  const bias = 16383;
  const exp = exponent - bias;

  // The mantissa has an explicit integer bit (bit 63).
  // Convert the 64-bit mantissa to a floating-point fraction.
  const mantissaF = Number(mantissa) / 2 ** 63;

  const value = mantissaF * 2 ** exp;
  return sign ? -value : value;
}

// =============================================================================
// Base64 helpers (manual implementation – no dependency on atob/btoa)
// =============================================================================

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Encode(data: Uint8Array): string {
  let result = "";
  const len = data.length;
  let i = 0;
  while (i < len) {
    const a = data[i++];
    const b = i < len ? data[i++] : -1;
    const c = i < len ? data[i++] : -1;

    result += BASE64_CHARS[a >> 2];

    if (b === -1) {
      result += BASE64_CHARS[(a & 0x03) << 4];
      result += "==";
    } else if (c === -1) {
      result += BASE64_CHARS[((a & 0x03) << 4) | (b >> 4)];
      result += BASE64_CHARS[(b & 0x0f) << 2];
      result += "=";
    } else {
      result += BASE64_CHARS[((a & 0x03) << 4) | (b >> 4)];
      result += BASE64_CHARS[((b & 0x0f) << 2) | (c >> 6)];
      result += BASE64_CHARS[c & 0x3f];
    }
  }
  return result;
}

/**
 * Build a reverse lookup table for base64.
 */
const BASE64_DECODE_TABLE: Int8Array = (() => {
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    t[BASE64_CHARS.charCodeAt(i)] = i;
  }
  t["=".charCodeAt(0)] = -2; // padding marker
  return t;
})();

/**
 * Strict base64 decode – returns null on any invalid input. Requires length
 * to be a multiple of 4 and all characters to be valid base64 characters.
 */
function base64Decode(data: Uint8Array): Uint8Array | null {
  const len = data.length;
  if (len === 0) return new Uint8Array(0);
  if (len % 4 !== 0) return null;

  // Validate all characters first
  for (let i = 0; i < len; i++) {
    const v = BASE64_DECODE_TABLE[data[i]];
    if (v === -1) return null;
    // Padding ('=') must only appear in the last two positions
    if (v === -2 && i < len - 2) return null;
  }

  // Count padding
  let padding = 0;
  if (data[len - 1] === 0x3d) padding++;
  if (data[len - 2] === 0x3d) padding++;

  const outputLen = (len / 4) * 3 - padding;
  const result = new Uint8Array(outputLen);
  let outIdx = 0;

  for (let i = 0; i < len; i += 4) {
    const a = BASE64_DECODE_TABLE[data[i]];
    const b = BASE64_DECODE_TABLE[data[i + 1]];
    const cVal = BASE64_DECODE_TABLE[data[i + 2]];
    const dVal = BASE64_DECODE_TABLE[data[i + 3]];

    // -2 means padding '='
    const c = cVal === -2 ? 0 : cVal;
    const d = dVal === -2 ? 0 : dVal;

    result[outIdx++] = (a << 2) | (b >> 4);
    if (outIdx < outputLen) result[outIdx++] = ((b & 0x0f) << 4) | (c >> 2);
    if (outIdx < outputLen) result[outIdx++] = ((c & 0x03) << 6) | d;
  }

  return result;
}
