import { describe, it, expect } from 'vitest';
import { ByteVector, StringType } from '../../src/byteVector.js';
import { ByteVectorStream } from '../../src/toolkit/byteVectorStream.js';
import { Position } from '../../src/toolkit/types.js';

describe('ByteVectorStream', () => {
  it('should initialize with data', () => {
    const v = ByteVector.fromString('abcd', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    expect(stream.data().equals(ByteVector.fromString('abcd', StringType.Latin1))).toBe(true);
  });

  it('should write block', () => {
    const v = ByteVector.fromString('abcd', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    stream.seek(1);
    stream.writeBlock(ByteVector.fromString('xx', StringType.Latin1));
    expect(stream.data().equals(ByteVector.fromString('axxd', StringType.Latin1))).toBe(true);
  });

  it('should write block with resize', () => {
    const v = ByteVector.fromString('abcd', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    stream.seek(3);
    stream.writeBlock(ByteVector.fromString('xx', StringType.Latin1));
    expect(stream.data().equals(ByteVector.fromString('abcxx', StringType.Latin1))).toBe(true);
    stream.seek(5);
    stream.writeBlock(ByteVector.fromString('yy', StringType.Latin1));
    expect(stream.data().equals(ByteVector.fromString('abcxxyy', StringType.Latin1))).toBe(true);
  });

  it('should read block', () => {
    const v = ByteVector.fromString('abcd', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    expect(stream.readBlock(1).equals(ByteVector.fromString('a', StringType.Latin1))).toBe(true);
    expect(stream.readBlock(2).equals(ByteVector.fromString('bc', StringType.Latin1))).toBe(true);
    expect(stream.readBlock(3).equals(ByteVector.fromString('d', StringType.Latin1))).toBe(true);
    expect(stream.readBlock(3).isEmpty).toBe(true);
  });

  it('should remove block', () => {
    const v = ByteVector.fromString('abcd', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    stream.removeBlock(1, 1);
    expect(stream.data().equals(ByteVector.fromString('acd', StringType.Latin1))).toBe(true);
    stream.removeBlock(0, 2);
    expect(stream.data().equals(ByteVector.fromString('d', StringType.Latin1))).toBe(true);
    stream.removeBlock(0, 2);
    expect(stream.data().isEmpty).toBe(true);
  });

  it('should insert', () => {
    const v = ByteVector.fromString('abcd', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    stream.insert(ByteVector.fromString('xx', StringType.Latin1), 1, 1);
    expect(stream.data().equals(ByteVector.fromString('axxcd', StringType.Latin1))).toBe(true);
    stream.insert(ByteVector.fromString('yy', StringType.Latin1), 0, 2);
    expect(stream.data().equals(ByteVector.fromString('yyxcd', StringType.Latin1))).toBe(true);
    stream.insert(ByteVector.fromString('foa', StringType.Latin1), 3, 2);
    expect(stream.data().equals(ByteVector.fromString('yyxfoa', StringType.Latin1))).toBe(true);
    stream.insert(ByteVector.fromString('123', StringType.Latin1), 3, 0);
    expect(stream.data().equals(ByteVector.fromString('yyx123foa', StringType.Latin1))).toBe(true);
  });

  it('should seek from end', () => {
    const v = ByteVector.fromString('abcdefghijklmnopqrstuvwxyz', StringType.Latin1);
    const stream = new ByteVectorStream(v);
    expect(stream.length()).toBe(26);

    stream.seek(-4, Position.End);
    expect(stream.readBlock(1).equals(ByteVector.fromString('w', StringType.Latin1))).toBe(true);

    stream.seek(-25, Position.End);
    expect(stream.readBlock(1).equals(ByteVector.fromString('b', StringType.Latin1))).toBe(true);
  });
});
