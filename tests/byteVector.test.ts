import { describe, it, expect } from 'vitest';
import { ByteVector, StringType } from '../src/byteVector.js';
import { byteVectorFromArray } from './testHelper.js';

describe('ByteVector', () => {
  describe('constructors and factories', () => {
    it('should create empty ByteVector', () => {
      const bv = new ByteVector();
      expect(bv.length).toBe(0);
      expect(bv.isEmpty).toBe(true);
    });

    it('should create from size', () => {
      const bv = ByteVector.fromSize(4, 0);
      expect(bv.length).toBe(4);
      expect(bv.get(0)).toBe(0);
    });

    it('should create from size with fill', () => {
      const bv = ByteVector.fromSize(3, 0x42);
      expect(bv.length).toBe(3);
      expect(bv.get(0)).toBe(0x42);
      expect(bv.get(1)).toBe(0x42);
      expect(bv.get(2)).toBe(0x42);
    });

    it('should create from byte array', () => {
      const arr = new Uint8Array([1, 2, 3, 4]);
      const bv = ByteVector.fromByteArray(arr);
      expect(bv.length).toBe(4);
      expect(bv.get(0)).toBe(1);
      expect(bv.get(3)).toBe(4);
    });

    it('should create from string Latin1', () => {
      const bv = ByteVector.fromString('abcd', StringType.Latin1);
      expect(bv.length).toBe(4);
      expect(bv.get(0)).toBe(0x61); // 'a'
      expect(bv.get(3)).toBe(0x64); // 'd'
    });

    it('should create from string UTF8', () => {
      const bv = ByteVector.fromString('abc', StringType.UTF8);
      expect(bv.length).toBe(3);
      expect(bv.get(0)).toBe(0x61);
    });

    it('should create from string UTF16 with BOM', () => {
      const bv = ByteVector.fromString('a', StringType.UTF16);
      expect(bv.length).toBe(4); // BOM + char
      expect(bv.get(0)).toBe(0xFF); // BOM LE
      expect(bv.get(1)).toBe(0xFE);
      expect(bv.get(2)).toBe(0x61);
      expect(bv.get(3)).toBe(0x00);
    });

    it('should create from string UTF16BE', () => {
      const bv = ByteVector.fromString('a', StringType.UTF16BE);
      expect(bv.length).toBe(2);
      expect(bv.get(0)).toBe(0x00);
      expect(bv.get(1)).toBe(0x61);
    });

    it('should create from string UTF16LE', () => {
      const bv = ByteVector.fromString('a', StringType.UTF16LE);
      expect(bv.length).toBe(2);
      expect(bv.get(0)).toBe(0x61);
      expect(bv.get(1)).toBe(0x00);
    });
  });

  describe('data access', () => {
    it('should get and set bytes', () => {
      const bv = ByteVector.fromSize(4, 0);
      bv.set(0, 0xAB);
      expect(bv.get(0)).toBe(0xAB);
    });

    it('should extract mid section', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      const mid = bv.mid(2, 3);
      expect(mid.length).toBe(3);
      expect(mid.toString(StringType.Latin1)).toBe('cde');
    });

    it('should extract mid to end', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      const mid = bv.mid(4);
      expect(mid.length).toBe(2);
      expect(mid.toString(StringType.Latin1)).toBe('ef');
    });
  });

  describe('search', () => {
    it('should find pattern', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      const pattern = ByteVector.fromString('cd', StringType.Latin1);
      expect(bv.find(pattern)).toBe(2);
    });

    it('should find with offset', () => {
      const bv = ByteVector.fromString('abcabc', StringType.Latin1);
      const pattern = ByteVector.fromString('bc', StringType.Latin1);
      expect(bv.find(pattern, 2)).toBe(4);
    });

    it('should return -1 for not found', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      const pattern = ByteVector.fromString('xyz', StringType.Latin1);
      expect(bv.find(pattern)).toBe(-1);
    });

    it('should find with byte alignment', () => {
      const bv = ByteVector.fromString('aabcddbc', StringType.Latin1);
      const pattern = ByteVector.fromString('bc', StringType.Latin1);
      expect(bv.find(pattern, 0, 2)).toBe(2);
    });

    it('should rfind pattern', () => {
      const bv = ByteVector.fromString('abcabc', StringType.Latin1);
      const pattern = ByteVector.fromString('bc', StringType.Latin1);
      expect(bv.rfind(pattern)).toBe(4);
    });

    it('should containsAt correctly', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      const pattern = ByteVector.fromString('cd', StringType.Latin1);
      expect(bv.containsAt(pattern, 2)).toBe(true);
      expect(bv.containsAt(pattern, 3)).toBe(false);
    });

    it('should check startsWith', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      expect(bv.startsWith(ByteVector.fromString('abc', StringType.Latin1))).toBe(true);
      expect(bv.startsWith(ByteVector.fromString('bcd', StringType.Latin1))).toBe(false);
    });

    it('should check endsWith', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      expect(bv.endsWith(ByteVector.fromString('def', StringType.Latin1))).toBe(true);
      expect(bv.endsWith(ByteVector.fromString('cde', StringType.Latin1))).toBe(false);
    });
  });

  describe('manipulation', () => {
    it('should append ByteVector', () => {
      const bv1 = ByteVector.fromString('abc', StringType.Latin1);
      const bv2 = ByteVector.fromString('def', StringType.Latin1);
      bv1.append(bv2);
      expect(bv1.length).toBe(6);
      expect(bv1.toString(StringType.Latin1)).toBe('abcdef');
    });

    it('should append single byte', () => {
      const bv = ByteVector.fromString('abc', StringType.Latin1);
      bv.append(0x64); // 'd'
      expect(bv.length).toBe(4);
      expect(bv.toString(StringType.Latin1)).toBe('abcd');
    });

    it('should clear', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      bv.clear();
      expect(bv.length).toBe(0);
      expect(bv.isEmpty).toBe(true);
    });

    it('should resize larger', () => {
      const bv = ByteVector.fromString('abc', StringType.Latin1);
      bv.resize(5, 0);
      expect(bv.length).toBe(5);
      expect(bv.get(0)).toBe(0x61);
      expect(bv.get(3)).toBe(0);
      expect(bv.get(4)).toBe(0);
    });

    it('should resize smaller', () => {
      const bv = ByteVector.fromString('abcdef', StringType.Latin1);
      bv.resize(3);
      expect(bv.length).toBe(3);
      expect(bv.toString(StringType.Latin1)).toBe('abc');
    });
  });

  describe('integer conversions', () => {
    it('should convert to/from UInt big-endian', () => {
      const bv = ByteVector.fromUInt(0x01020304, true);
      expect(bv.length).toBe(4);
      expect(bv.get(0)).toBe(0x01);
      expect(bv.get(1)).toBe(0x02);
      expect(bv.get(2)).toBe(0x03);
      expect(bv.get(3)).toBe(0x04);
      expect(bv.toUInt(true)).toBe(0x01020304);
    });

    it('should convert to/from UInt little-endian', () => {
      const bv = ByteVector.fromUInt(0x01020304, false);
      expect(bv.get(0)).toBe(0x04);
      expect(bv.get(1)).toBe(0x03);
      expect(bv.get(2)).toBe(0x02);
      expect(bv.get(3)).toBe(0x01);
      expect(bv.toUInt(false)).toBe(0x01020304);
    });

    it('should convert to/from Short', () => {
      const bv = ByteVector.fromShort(-1, true);
      expect(bv.length).toBe(2);
      expect(bv.toShort(true)).toBe(-1);
    });

    it('should convert to/from UShort', () => {
      const bv = ByteVector.fromUShort(0x0102, true);
      expect(bv.length).toBe(2);
      expect(bv.get(0)).toBe(0x01);
      expect(bv.get(1)).toBe(0x02);
      expect(bv.toUShort(true)).toBe(0x0102);
    });

    it('should convert to/from LongLong', () => {
      const bv = ByteVector.fromLongLong(-1n, true);
      expect(bv.length).toBe(8);
      expect(bv.toLongLong(true)).toBe(-1n);
    });

    it('should convert to/from ULongLong', () => {
      const val = 0x0102030405060708n;
      const bv = ByteVector.fromULongLong(val, true);
      expect(bv.length).toBe(8);
      expect(bv.toULongLong(true)).toBe(val);
    });

    it('should handle zero UInt', () => {
      const bv = ByteVector.fromUInt(0);
      expect(bv.toUInt()).toBe(0);
    });
  });

  describe('float conversions', () => {
    it('should convert Float32BE round-trip', () => {
      const bv = ByteVector.fromFloat32BE(1.5);
      expect(bv.length).toBe(4);
      expect(bv.toFloat32BE(0)).toBeCloseTo(1.5, 5);
    });

    it('should convert Float32LE round-trip', () => {
      const bv = ByteVector.fromFloat32LE(2.5);
      expect(bv.length).toBe(4);
      expect(bv.toFloat32LE(0)).toBeCloseTo(2.5, 5);
    });

    it('should convert Float64BE round-trip', () => {
      const bv = ByteVector.fromFloat64BE(3.14159);
      expect(bv.length).toBe(8);
      expect(bv.toFloat64BE(0)).toBeCloseTo(3.14159, 10);
    });

    it('should convert Float64LE round-trip', () => {
      const bv = ByteVector.fromFloat64LE(2.71828);
      expect(bv.length).toBe(8);
      expect(bv.toFloat64LE(0)).toBeCloseTo(2.71828, 10);
    });
  });

  describe('hex and base64', () => {
    it('should convert to hex', () => {
      const bv = ByteVector.fromByteArray(new Uint8Array([0xAB, 0xCD, 0xEF]));
      const hex = bv.toHex();
      expect(hex.toString(StringType.Latin1)).toBe('abcdef');
    });

    it('should round-trip base64', () => {
      const original = ByteVector.fromString('Hello, World!', StringType.Latin1);
      const encoded = original.toBase64();
      const decoded = ByteVector.fromBase64(encoded);
      expect(decoded.equals(original)).toBe(true);
    });
  });

  describe('comparison', () => {
    it('should compare equal ByteVectors', () => {
      const a = ByteVector.fromString('abc', StringType.Latin1);
      const b = ByteVector.fromString('abc', StringType.Latin1);
      expect(a.equals(b)).toBe(true);
    });

    it('should compare unequal ByteVectors', () => {
      const a = ByteVector.fromString('abc', StringType.Latin1);
      const b = ByteVector.fromString('abd', StringType.Latin1);
      expect(a.equals(b)).toBe(false);
    });

    it('should compare different lengths', () => {
      const a = ByteVector.fromString('ab', StringType.Latin1);
      const b = ByteVector.fromString('abc', StringType.Latin1);
      expect(a.equals(b)).toBe(false);
    });

    it('should handle lessThan', () => {
      const a = ByteVector.fromString('abc', StringType.Latin1);
      const b = ByteVector.fromString('abd', StringType.Latin1);
      expect(a.lessThan(b)).toBe(true);
      expect(b.lessThan(a)).toBe(false);
    });
  });

  describe('string encoding', () => {
    it('should round-trip Latin1', () => {
      const str = 'Hello World';
      const bv = ByteVector.fromString(str, StringType.Latin1);
      expect(bv.toString(StringType.Latin1)).toBe(str);
    });

    it('should round-trip UTF8', () => {
      const str = 'Hello ñ';
      const bv = ByteVector.fromString(str, StringType.UTF8);
      expect(bv.toString(StringType.UTF8)).toBe(str);
    });

    it('should round-trip UTF16BE', () => {
      const str = 'AB';
      const bv = ByteVector.fromString(str, StringType.UTF16BE);
      expect(bv.toString(StringType.UTF16BE)).toBe(str);
    });

    it('should round-trip UTF16LE', () => {
      const str = 'CD';
      const bv = ByteVector.fromString(str, StringType.UTF16LE);
      expect(bv.toString(StringType.UTF16LE)).toBe(str);
    });
  });

  describe('replace', () => {
    it('should replace single byte', () => {
      const bv = ByteVector.fromString('abcabc', StringType.Latin1);
      bv.replace(0x61, 0x78); // 'a' -> 'x'
      expect(bv.toString(StringType.Latin1)).toBe('xbcxbc');
    });
  });
});
