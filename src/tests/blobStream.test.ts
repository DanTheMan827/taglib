import { beforeEach, describe, expect, it } from "vitest";
import { ByteVector } from "../byteVector.js";
import { BlobStream } from "../toolkit/blobStream.js";
import { Position } from "../toolkit/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a plain Blob from an array of byte values (and optional MIME type). */
function makeBlob(bytes: number[], type = ""): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

/** Wraps byte values in a ByteVector. */
function bv(bytes: number[]): ByteVector {
  return new ByteVector(new Uint8Array(bytes));
}

/**
 * Reads the full logical content of a BlobStream by calling toBlob() and
 * converting the resulting blob's ArrayBuffer to a Uint8Array.
 */
async function streamContent(stream: BlobStream): Promise<Uint8Array> {
  return new Uint8Array(await stream.toBlob().arrayBuffer());
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("BlobStream", () => {
  /** Stream pre-loaded with bytes 1–10, mirroring ChunkedByteVectorStream setup. */
  let stream: BlobStream;

  beforeEach(() => {
    stream = new BlobStream(makeBlob([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  // ── Construction & basic reads ─────────────────────────────────────────────

  it("initializes with a blob and length() returns the blob size", async () => {
    expect(await stream.length()).toBe(10);
  });

  it("reads all bytes sequentially", async () => {
    const result = await stream.readBlock(10);
    expect(result.data).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });

  it("reads the blob in multiple partial reads", async () => {
    const a = await stream.readBlock(4);
    const b = await stream.readBlock(3);
    const c = await stream.readBlock(10); // only 3 bytes left
    expect(a.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(b.data).toEqual(new Uint8Array([5, 6, 7]));
    expect(c.data).toEqual(new Uint8Array([8, 9, 10]));
    expect((await stream.readBlock(1)).isEmpty).toBe(true); // EOF
  });

  it("seek to middle then reads remaining bytes", async () => {
    await stream.seek(5);
    const result = await stream.readBlock(4);
    expect(result.data).toEqual(new Uint8Array([6, 7, 8, 9]));
  });

  it("seek from current position", async () => {
    await stream.readBlock(1); // position → 1
    await stream.seek(2, Position.Current); // position → 3
    const result = await stream.readBlock(2);
    expect(result.data).toEqual(new Uint8Array([4, 5]));
  });

  it("seek from end", async () => {
    await stream.seek(-2, Position.End);
    const result = await stream.readBlock(2);
    expect(result.data).toEqual(new Uint8Array([9, 10]));
  });

  it("tell() tracks current position", async () => {
    expect(await stream.tell()).toBe(0);
    await stream.readBlock(3);
    expect(await stream.tell()).toBe(3);
    await stream.seek(1);
    expect(await stream.tell()).toBe(1);
  });

  it("clear() resets position to beginning", async () => {
    await stream.readBlock(10);
    expect(await stream.tell()).toBe(10);
    await stream.clear();
    expect(await stream.tell()).toBe(0);
    const result = await stream.readBlock(3);
    expect(result.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("readBlock past end returns empty ByteVector", async () => {
    await stream.seek(0, Position.End);
    expect((await stream.readBlock(10)).isEmpty).toBe(true);
  });

  it("readBlock with length 0 returns empty ByteVector", async () => {
    expect((await stream.readBlock(0)).isEmpty).toBe(true);
  });

  it("readOnly() returns false", () => {
    expect(stream.readOnly()).toBe(false);
  });

  it("isOpen() returns true", () => {
    expect(stream.isOpen()).toBe(true);
  });

  // ── name() ─────────────────────────────────────────────────────────────────

  it("name() returns empty string for a plain Blob", () => {
    expect(stream.name()).toBe("");
  });

  it("name() returns the file name for a File object", () => {
    const file = new File([new Uint8Array([1, 2])], "audio.mp3", { type: "audio/mpeg" });
    expect(new BlobStream(file).name()).toBe("audio.mp3");
  });

  // ── writeBlock ─────────────────────────────────────────────────────────────

  it("writeBlock overwrites existing bytes", async () => {
    await stream.seek(2);
    await stream.writeBlock(bv([99, 100]));
    expect(await streamContent(stream)).toEqual(
      new Uint8Array([1, 2, 99, 100, 5, 6, 7, 8, 9, 10]),
    );
  });

  it("writeBlock appends new data when writing past end", async () => {
    await stream.seek(10);
    await stream.writeBlock(bv([11, 12]));
    expect(await streamContent(stream)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    );
    expect(await stream.length()).toBe(12);
  });

  it("writeBlock advances the position", async () => {
    await stream.seek(0);
    await stream.writeBlock(bv([50, 51, 52]));
    expect(await stream.tell()).toBe(3);
  });

  // ── insert ─────────────────────────────────────────────────────────────────

  it("inserts data at start, replacing bytes", async () => {
    await stream.insert(bv([50, 51]), 0, 2);
    expect(await streamContent(stream)).toEqual(
      new Uint8Array([50, 51, 3, 4, 5, 6, 7, 8, 9, 10]),
    );
  });

  it("inserts data in middle, inserting more than replaced (net growth)", async () => {
    await stream.insert(bv([60, 61, 62, 63, 64, 65]), 4, 2);
    expect(await streamContent(stream)).toEqual(
      new Uint8Array([1, 2, 3, 4, 60, 61, 62, 63, 64, 65, 7, 8, 9, 10]),
    );
  });

  it("inserts data in middle, inserting fewer than replaced (net shrink)", async () => {
    await stream.insert(bv([60, 61, 62]), 4, 5);
    expect(await streamContent(stream)).toEqual(new Uint8Array([1, 2, 3, 4, 60, 61, 62, 10]));
  });

  it("inserts data at end, no overwrite", async () => {
    await stream.insert(bv([99]), 10);
    expect(await streamContent(stream)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]),
    );
  });

  it("insert sets position to start + data.length", async () => {
    await stream.insert(bv([7, 8, 9]), 2, 0);
    expect(await stream.tell()).toBe(5); // 2 + 3
  });

  // ── removeBlock ────────────────────────────────────────────────────────────

  it("removes a block from the middle", async () => {
    await stream.removeBlock(3, 4);
    expect(await streamContent(stream)).toEqual(new Uint8Array([1, 2, 3, 8, 9, 10]));
  });

  it("removes a block at the start", async () => {
    await stream.removeBlock(0, 3);
    expect(await streamContent(stream)).toEqual(new Uint8Array([4, 5, 6, 7, 8, 9, 10]));
  });

  it("removes a block at the end", async () => {
    await stream.removeBlock(7, 3);
    expect(await streamContent(stream)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
    expect(await stream.length()).toBe(7);
  });

  it("removeBlock clamps position when it falls inside removed range", async () => {
    await stream.seek(5);
    await stream.removeBlock(3, 4); // removes bytes at 3-6, position was 5
    expect(await stream.tell()).toBe(3);
  });

  it("removeBlock adjusts position when it falls after removed range", async () => {
    await stream.seek(8);
    await stream.removeBlock(3, 4);
    expect(await stream.tell()).toBe(4); // 8 - 4
  });

  // ── truncate ───────────────────────────────────────────────────────────────

  it("truncates to a shorter length", async () => {
    await stream.truncate(5);
    expect(await streamContent(stream)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(await stream.length()).toBe(5);
  });

  it("truncates and zero-pads to a longer length", async () => {
    await stream.truncate(12);
    expect(await streamContent(stream)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0]),
    );
    expect(await stream.length()).toBe(12);
  });

  it("truncate clamps position when it exceeds new length", async () => {
    await stream.seek(8);
    await stream.truncate(5);
    expect(await stream.tell()).toBe(5);
  });

  // ── toBlob ─────────────────────────────────────────────────────────────────

  it("toBlob() returns the original content when unmodified", async () => {
    const blob = stream.toBlob();
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    );
  });

  it("toBlob() reflects writes correctly", async () => {
    await stream.seek(2);
    await stream.writeBlock(bv([99, 100]));
    const blob = stream.toBlob();
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 99, 100, 5, 6, 7, 8, 9, 10]),
    );
  });

  it("toBlob() preserves the MIME type of the source blob", () => {
    const typed = new BlobStream(makeBlob([1, 2, 3], "audio/mpeg"));
    const blob = typed.toBlob();
    expect(blob.type).toBe("audio/mpeg");
  });

  it("toBlob() preserves the MIME type of a File source", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "song.mp3", { type: "audio/mpeg" });
    const typed = new BlobStream(file);
    const blob = typed.toBlob();
    expect(blob.type).toBe("audio/mpeg");
  });

  it("toBlob() returns empty blob when stream is empty", () => {
    const empty = new BlobStream(new Blob([]));
    const blob = empty.toBlob();
    expect(blob.size).toBe(0);
  });

  // ── round-trip: write → toBlob → new BlobStream → read ────────────────────

  it("round-trips content through toBlob correctly", async () => {
    await stream.seek(3);
    await stream.writeBlock(bv([77, 78, 79]));
    await stream.removeBlock(8, 2);

    const blob = stream.toBlob();
    const stream2 = new BlobStream(blob);
    const result = await stream2.readBlock(await stream2.length());
    expect(result.data).toEqual(new Uint8Array([1, 2, 3, 77, 78, 79, 7, 8]));
  });

  // ── File object ─────────────────────────────────────────────────────────────

  it("File object reads and writes correctly", async () => {
    const bytes = [0xaa, 0xbb, 0xcc, 0xdd];
    const file = new File([new Uint8Array(bytes)], "test.flac", { type: "audio/flac" });
    const s = new BlobStream(file);

    expect(await s.length()).toBe(4);
    await s.writeBlock(bv([0x11, 0x22]));
    expect(await streamContent(s)).toEqual(new Uint8Array([0x11, 0x22, 0xcc, 0xdd]));
    expect(s.toBlob().type).toBe("audio/flac");
  });

  // ── reads back correctly after multiple edits ──────────────────────────────

  it("reads back correctly after interleaved writes and inserts", async () => {
    await stream.insert(bv([20, 21]), 5); // [1,2,3,4,5,20,21,6,7,8,9,10], position → 7
    // insert() sets position to start + data.length; verify, then read from there
    expect(await stream.tell()).toBe(7);
    const result = await stream.readBlock(5); // reads from position 7
    expect(result.data).toEqual(new Uint8Array([6, 7, 8, 9, 10]));
  });
});
