import { describe, expect, it } from "vitest";
import { ByteVector, StringType } from "../byteVector.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { Position } from "../toolkit/types.js";

describe("ByteVectorStream", () => {
  it("should initialize with data", () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcd", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    expect(stream.data().equals(ByteVector.fromString("abcd", StringType.Latin1))).toBe(true);
  });

  it("should write block", async () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcd", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    await stream.seek(1);
    await stream.writeBlock(ByteVector.fromString("xx", StringType.Latin1));
    expect(stream.data().equals(ByteVector.fromString("axxd", StringType.Latin1))).toBe(true);
  });

  it("should write block with resize", async () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcd", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    await stream.seek(3);
    await stream.writeBlock(ByteVector.fromString("xx", StringType.Latin1));
    expect(stream.data().equals(ByteVector.fromString("abcxx", StringType.Latin1))).toBe(true);
    await stream.seek(5);
    await stream.writeBlock(ByteVector.fromString("yy", StringType.Latin1));
    expect(stream.data().equals(ByteVector.fromString("abcxxyy", StringType.Latin1))).toBe(true);
  });

  it("should read block", async () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcd", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    expect((await stream.readBlock(1)).equals(ByteVector.fromString("a", StringType.Latin1))).toBe(true);
    expect((await stream.readBlock(2)).equals(ByteVector.fromString("bc", StringType.Latin1))).toBe(true);
    expect((await stream.readBlock(3)).equals(ByteVector.fromString("d", StringType.Latin1))).toBe(true);
    expect((await stream.readBlock(3)).isEmpty).toBe(true);
  });

  it("should remove block", async () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcd", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    await stream.removeBlock(1, 1);
    expect(stream.data().equals(ByteVector.fromString("acd", StringType.Latin1))).toBe(true);
    await stream.removeBlock(0, 2);
    expect(stream.data().equals(ByteVector.fromString("d", StringType.Latin1))).toBe(true);
    await stream.removeBlock(0, 2);
    expect(stream.data().isEmpty).toBe(true);
  });

  it("should insert", async () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcd", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    await stream.insert(ByteVector.fromString("xx", StringType.Latin1), 1, 1);
    expect(stream.data().equals(ByteVector.fromString("axxcd", StringType.Latin1))).toBe(true);
    await stream.insert(ByteVector.fromString("yy", StringType.Latin1), 0, 2);
    expect(stream.data().equals(ByteVector.fromString("yyxcd", StringType.Latin1))).toBe(true);
    await stream.insert(ByteVector.fromString("foa", StringType.Latin1), 3, 2);
    expect(stream.data().equals(ByteVector.fromString("yyxfoa", StringType.Latin1))).toBe(true);
    await stream.insert(ByteVector.fromString("123", StringType.Latin1), 3, 0);
    expect(stream.data().equals(ByteVector.fromString("yyx123foa", StringType.Latin1))).toBe(true);
  });

  it("should seek from end", async () => {
    // TypeScript-only test
    const v = ByteVector.fromString("abcdefghijklmnopqrstuvwxyz", StringType.Latin1);
    const stream = new ByteVectorStream(v);
    expect(await stream.length()).toBe(26);

    await stream.seek(-4, Position.End);
    expect((await stream.readBlock(1)).equals(ByteVector.fromString("w", StringType.Latin1))).toBe(true);

    await stream.seek(-25, Position.End);
    expect((await stream.readBlock(1)).equals(ByteVector.fromString("b", StringType.Latin1))).toBe(true);
  });
});
