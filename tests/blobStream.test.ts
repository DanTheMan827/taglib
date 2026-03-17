import { describe, it, expect } from "vitest";
import { ByteVector } from "../src/byteVector.js";
import { BlobStream } from "../src/toolkit/blobStream.js";
import { Position } from "../src/toolkit/types.js";

/** Helper: build a Blob from a plain byte array. */
function makeBlob(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe("BlobStream", () => {
  it("reads all bytes from a blob", async () => {
    const bytes = [0x01, 0x02, 0x03, 0x04, 0x05];
    const stream = new BlobStream(makeBlob(bytes));

    const result = await stream.readBlock(5);

    expect(result.equals(ByteVector.fromUint8Array(new Uint8Array(bytes)))).toBe(true);
  });

  it("length() returns the blob size", async () => {
    const stream = new BlobStream(makeBlob([0x00, 0x01, 0x02]));
    expect(await stream.length()).toBe(3);
  });

  it("reads the full blob in multiple partial reads", async () => {
    const bytes = [0x0a, 0x0b, 0x0c, 0x0d];
    const stream = new BlobStream(makeBlob(bytes));

    const first = await stream.readBlock(2);
    const second = await stream.readBlock(2);

    expect(first.equals(ByteVector.fromUint8Array(new Uint8Array([0x0a, 0x0b])))).toBe(true);
    expect(second.equals(ByteVector.fromUint8Array(new Uint8Array([0x0c, 0x0d])))).toBe(true);
  });

  it("seek to middle then read remaining bytes", async () => {
    const bytes = [0x10, 0x20, 0x30, 0x40, 0x50];
    const stream = new BlobStream(makeBlob(bytes));

    await stream.seek(2);
    const result = await stream.readBlock(3);

    expect(result.equals(ByteVector.fromUint8Array(new Uint8Array([0x30, 0x40, 0x50])))).toBe(true);
  });

  it("seek from current position", async () => {
    const bytes = [0x01, 0x02, 0x03, 0x04, 0x05];
    const stream = new BlobStream(makeBlob(bytes));

    await stream.readBlock(1); // advance to position 1
    await stream.seek(2, Position.Current); // advance 2 more → position 3
    const result = await stream.readBlock(2);

    expect(result.equals(ByteVector.fromUint8Array(new Uint8Array([0x04, 0x05])))).toBe(true);
  });

  it("seek from end", async () => {
    const bytes = [0x01, 0x02, 0x03, 0x04, 0x05];
    const stream = new BlobStream(makeBlob(bytes));

    await stream.seek(-2, Position.End);
    const result = await stream.readBlock(2);

    expect(result.equals(ByteVector.fromUint8Array(new Uint8Array([0x04, 0x05])))).toBe(true);
  });

  it("tell() tracks current position", async () => {
    const stream = new BlobStream(makeBlob([0x00, 0x01, 0x02, 0x03]));

    expect(await stream.tell()).toBe(0);
    await stream.readBlock(2);
    expect(await stream.tell()).toBe(2);
    await stream.seek(1);
    expect(await stream.tell()).toBe(1);
  });

  it("clear() resets position to beginning", async () => {
    const bytes = [0x01, 0x02, 0x03];
    const stream = new BlobStream(makeBlob(bytes));

    await stream.readBlock(3);
    expect(await stream.tell()).toBe(3);

    await stream.clear();
    expect(await stream.tell()).toBe(0);

    const result = await stream.readBlock(3);
    expect(result.equals(ByteVector.fromUint8Array(new Uint8Array(bytes)))).toBe(true);
  });

  it("readBlock past end returns empty ByteVector", async () => {
    const stream = new BlobStream(makeBlob([0x01, 0x02]));

    await stream.readBlock(2);
    const result = await stream.readBlock(10);

    expect(result.isEmpty).toBe(true);
  });

  it("readBlock with length 0 returns empty ByteVector", async () => {
    const stream = new BlobStream(makeBlob([0x01, 0x02]));
    const result = await stream.readBlock(0);
    expect(result.isEmpty).toBe(true);
  });

  it("readOnly() returns true", () => {
    const stream = new BlobStream(makeBlob([0x01]));
    expect(stream.readOnly()).toBe(true);
  });

  it("isOpen() returns true", () => {
    const stream = new BlobStream(makeBlob([0x01]));
    expect(stream.isOpen()).toBe(true);
  });

  it("writeBlock() throws", async () => {
    const stream = new BlobStream(makeBlob([0x01]));
    await expect(stream.writeBlock(new ByteVector())).rejects.toThrow("BlobStream is read-only");
  });

  it("insert() throws", async () => {
    const stream = new BlobStream(makeBlob([0x01]));
    await expect(stream.insert(new ByteVector(), 0)).rejects.toThrow("BlobStream is read-only");
  });

  it("removeBlock() throws", async () => {
    const stream = new BlobStream(makeBlob([0x01]));
    await expect(stream.removeBlock(0, 1)).rejects.toThrow("BlobStream is read-only");
  });

  it("truncate() throws", async () => {
    const stream = new BlobStream(makeBlob([0x01]));
    await expect(stream.truncate(0)).rejects.toThrow("BlobStream is read-only");
  });

  it("name() returns empty string for plain Blob", () => {
    const stream = new BlobStream(makeBlob([0x01]));
    expect(stream.name()).toBe("");
  });

  it("name() returns the file name for a File object", () => {
    const file = new File([new Uint8Array([0x01, 0x02])], "audio.mp3", { type: "audio/mpeg" });
    const stream = new BlobStream(file);
    expect(stream.name()).toBe("audio.mp3");
  });

  it("File object reads correctly", async () => {
    const bytes = [0xaa, 0xbb, 0xcc];
    const file = new File([new Uint8Array(bytes)], "test.flac");
    const stream = new BlobStream(file);

    expect(await stream.length()).toBe(3);
    const result = await stream.readBlock(3);
    expect(result.equals(ByteVector.fromUint8Array(new Uint8Array(bytes)))).toBe(true);
  });
});
