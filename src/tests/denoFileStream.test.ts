import { beforeEach, describe, expect, it } from "vitest";
import { ByteVector } from "../byteVector.js";
import { DenoFileStream } from "../toolkit/denoFileStream.js";
import { Position } from "../toolkit/types.js";

// ---------------------------------------------------------------------------
// Mock Deno.FsFile backed by an ArrayBuffer
// ---------------------------------------------------------------------------

class MockDenoFsFile {
  private _buf: Uint8Array;
  private _cursor: number = 0;

  constructor(initial: Uint8Array = new Uint8Array()) {
    this._buf = new Uint8Array(initial);
  }

  async read(p: Uint8Array): Promise<number | null> {
    const available = this._buf.length - this._cursor;
    if (available <= 0) {
      return null;
    }
    const toRead = Math.min(p.length, available);
    p.set(this._buf.subarray(this._cursor, this._cursor + toRead));
    this._cursor += toRead;
    return toRead;
  }

  async write(p: Uint8Array): Promise<number> {
    const end = this._cursor + p.length;
    if (end > this._buf.length) {
      const next = new Uint8Array(end);
      next.set(this._buf);
      this._buf = next;
    }
    this._buf.set(p, this._cursor);
    this._cursor += p.length;
    return p.length;
  }

  async seek(offset: number, whence: 0 | 1 | 2): Promise<number> {
    if (whence === 0) {
      // Start
      this._cursor = Math.max(0, offset);
    } else if (whence === 1) {
      // Current
      this._cursor = Math.max(0, this._cursor + offset);
    } else {
      // End
      this._cursor = Math.max(0, this._buf.length + offset);
    }
    return this._cursor;
  }

  async truncate(len: number = 0): Promise<void> {
    const next = new Uint8Array(len);
    next.set(this._buf.subarray(0, len));
    this._buf = next;
    if (this._cursor > len) {
      this._cursor = len;
    }
  }

  async stat(): Promise<{ size: number }> {
    return { size: this._buf.length };
  }

  close(): void {
    /* no-op in mock */
  }

  get readable(): ReadableStream<Uint8Array> {
    throw new Error("not implemented in mock");
  }

  get writable(): WritableStream<Uint8Array> {
    throw new Error("not implemented in mock");
  }

  /** Test helper: snapshot the current buffer contents. */
  snapshot(): Uint8Array {
    return new Uint8Array(this._buf);
  }
}

// ---------------------------------------------------------------------------
// Mock Deno global — installed before imports resolve in the module under test
// ---------------------------------------------------------------------------

type MockFileMap = Map<string, MockDenoFsFile>;
const mockFiles: MockFileMap = new Map();

function setupDeno(): void {
  (globalThis as Record<string, unknown>)["Deno"] = {
    open: async (path: string, options?: { read?: boolean; write?: boolean; create?: boolean }) => {
      let file = mockFiles.get(path);
      if (!file) {
        if (options?.create) {
          file = new MockDenoFsFile();
          mockFiles.set(path, file);
        } else if (options?.write && !options?.create) {
          // read-write without create: file must exist (we allow it for tests)
          file = new MockDenoFsFile();
          mockFiles.set(path, file);
        } else {
          // read-only: file must exist
          file = new MockDenoFsFile();
          mockFiles.set(path, file);
        }
      }
      return file;
    },
    SeekMode: { Start: 0, Current: 1, End: 2 },
  };
}

setupDeno();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bv(bytes: number[]): ByteVector {
  return ByteVector.fromUint8Array(new Uint8Array(bytes));
}

/**
 * Creates a mock file at `path` pre-populated with `initial` bytes, then
 * opens a read-write DenoFileStream for it.
 */
async function openStream(initial: number[], path = "test.bin"): Promise<{ stream: DenoFileStream; mock: MockDenoFsFile }> {
  const mock = new MockDenoFsFile(new Uint8Array(initial));
  mockFiles.set(path, mock);
  const stream = await DenoFileStream.open(path);
  return { stream, mock };
}

/**
 * Creates a mock file at `path` pre-populated with `initial` bytes, then
 * opens a read-only DenoFileStream for it.
 */
async function openReadOnlyStream(
  initial: number[],
  path = "readonly.bin",
): Promise<{ stream: DenoFileStream; mock: MockDenoFsFile }> {
  const mock = new MockDenoFsFile(new Uint8Array(initial));
  mockFiles.set(path, mock);
  const stream = await DenoFileStream.openReadOnly(path);
  return { stream, mock };
}

// ---------------------------------------------------------------------------
// Tests: read-write mode
// ---------------------------------------------------------------------------

describe("DenoFileStream (read-write)", () => {
  let stream: DenoFileStream;
  let mock: MockDenoFsFile;

  beforeEach(async () => {
    ({ stream, mock } = await openStream([0x01, 0x02, 0x03, 0x04, 0x05]));
  });

  it("name() returns the file path", async () => {
    // TypeScript-only test
    const { stream: s } = await openStream([], "audio.mp3");
    expect(s.name()).toBe("audio.mp3");
  });

  it("readOnly() returns false", () => {
    // TypeScript-only test
    expect(stream.readOnly()).toBe(false);
  });

  it("isOpen() returns true initially", () => {
    // TypeScript-only test
    expect(stream.isOpen()).toBe(true);
  });

  it("isOpen() returns false after close()", async () => {
    // TypeScript-only test
    await stream.close();
    expect(stream.isOpen()).toBe(false);
  });

  it("length() returns file size", async () => {
    // TypeScript-only test
    expect(await stream.length()).toBe(5);
  });

  it("readBlock reads bytes from the beginning", async () => {
    // TypeScript-only test
    const result = await stream.readBlock(3);
    expect(result.equals(bv([0x01, 0x02, 0x03]))).toBe(true);
  });

  it("readBlock advances the position", async () => {
    // TypeScript-only test
    await stream.readBlock(2);
    expect(await stream.tell()).toBe(2);
  });

  it("readBlock from middle of file", async () => {
    // TypeScript-only test
    await stream.seek(2);
    const result = await stream.readBlock(2);
    expect(result.equals(bv([0x03, 0x04]))).toBe(true);
  });

  it("readBlock at end returns empty ByteVector", async () => {
    // TypeScript-only test
    await stream.seek(5);
    const result = await stream.readBlock(10);
    expect(result.isEmpty).toBe(true);
  });

  it("readBlock with length 0 returns empty ByteVector", async () => {
    // TypeScript-only test
    const result = await stream.readBlock(0);
    expect(result.isEmpty).toBe(true);
  });

  it("writeBlock writes at current position", async () => {
    // TypeScript-only test
    await stream.seek(1);
    await stream.writeBlock(bv([0xaa, 0xbb]));
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0xaa, 0xbb, 0x04, 0x05]));
  });

  it("writeBlock advances the position", async () => {
    // TypeScript-only test
    await stream.writeBlock(bv([0xff]));
    expect(await stream.tell()).toBe(1);
  });

  it("writeBlock with empty data is a no-op", async () => {
    // TypeScript-only test
    await stream.writeBlock(new ByteVector());
    expect(await stream.tell()).toBe(0);
  });

  it("tell() reflects current position", async () => {
    // TypeScript-only test
    expect(await stream.tell()).toBe(0);
    await stream.readBlock(3);
    expect(await stream.tell()).toBe(3);
  });

  it("seek(offset) seeks from beginning", async () => {
    // TypeScript-only test
    await stream.seek(3);
    expect(await stream.tell()).toBe(3);
  });

  it("seek from current position", async () => {
    // TypeScript-only test
    await stream.seek(2);
    await stream.seek(1, Position.Current);
    expect(await stream.tell()).toBe(3);
  });

  it("seek from end", async () => {
    // TypeScript-only test
    await stream.seek(-2, Position.End);
    expect(await stream.tell()).toBe(3);
  });

  it("clear() resets position to 0", async () => {
    // TypeScript-only test
    await stream.seek(4);
    await stream.clear();
    expect(await stream.tell()).toBe(0);
  });

  it("truncate shrinks the file", async () => {
    // TypeScript-only test
    await stream.truncate(3);
    expect(await stream.length()).toBe(3);
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0x02, 0x03]));
  });

  it("truncate extends the file with zeros", async () => {
    // TypeScript-only test
    await stream.truncate(7);
    const snap = mock.snapshot();
    expect(snap).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x00, 0x00]));
  });

  it("insert adds bytes and shifts tail", async () => {
    // TypeScript-only test
    // File: [01 02 03 04 05] — insert [aa bb] at offset 2, replace 0
    await stream.insert(bv([0xaa, 0xbb]), 2, 0);
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0x02, 0xaa, 0xbb, 0x03, 0x04, 0x05]));
    expect(await stream.tell()).toBe(4);
  });

  it("insert replaces bytes when replace > 0 and same size", async () => {
    // TypeScript-only test
    // Replace 2 bytes at offset 1 with 2 new bytes
    await stream.insert(bv([0xcc, 0xdd]), 1, 2);
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0xcc, 0xdd, 0x04, 0x05]));
  });

  it("insert with smaller data shrinks the file", async () => {
    // TypeScript-only test
    // Replace 3 bytes at offset 1 with 1 new byte → file should shrink by 2
    await stream.insert(bv([0xee]), 1, 3);
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0xee, 0x05]));
    expect(await stream.length()).toBe(3);
  });

  it("insert with larger data grows the file", async () => {
    // TypeScript-only test
    // Replace 1 byte at offset 2 with 3 bytes → file grows by 2
    await stream.insert(bv([0x10, 0x20, 0x30]), 2, 1);
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0x02, 0x10, 0x20, 0x30, 0x04, 0x05]));
    expect(await stream.length()).toBe(7);
  });

  it("removeBlock removes bytes and shifts tail", async () => {
    // TypeScript-only test
    // File: [01 02 03 04 05] — remove 2 bytes at offset 1
    await stream.removeBlock(1, 2);
    expect(mock.snapshot()).toEqual(new Uint8Array([0x01, 0x04, 0x05]));
    expect(await stream.length()).toBe(3);
  });

  it("removeBlock with length 0 is a no-op", async () => {
    // TypeScript-only test
    await stream.removeBlock(0, 0);
    expect(await stream.length()).toBe(5);
  });

  it("removeBlock beyond end is a no-op", async () => {
    // TypeScript-only test
    await stream.removeBlock(10, 2);
    expect(await stream.length()).toBe(5);
  });

  it("writeBlock throws on read-only stream", async () => {
    // TypeScript-only test
    const { stream: s } = await openReadOnlyStream([]);
    await expect(s.writeBlock(bv([0x01]))).rejects.toThrow("read-only");
  });

  it("insert throws on read-only stream", async () => {
    // TypeScript-only test
    const { stream: s } = await openReadOnlyStream([], "ro2.bin");
    await expect(s.insert(bv([0x01]), 0)).rejects.toThrow("read-only");
  });

  it("removeBlock throws on read-only stream", async () => {
    // TypeScript-only test
    const { stream: s } = await openReadOnlyStream([], "ro3.bin");
    await expect(s.removeBlock(0, 1)).rejects.toThrow("read-only");
  });

  it("truncate throws on read-only stream", async () => {
    // TypeScript-only test
    const { stream: s } = await openReadOnlyStream([], "ro4.bin");
    await expect(s.truncate(0)).rejects.toThrow("read-only");
  });
});

// ---------------------------------------------------------------------------
// Tests: read-only mode
// ---------------------------------------------------------------------------

describe("DenoFileStream (read-only)", () => {
  let stream: DenoFileStream;

  beforeEach(async () => {
    ({ stream } = await openReadOnlyStream([0x10, 0x20, 0x30, 0x40, 0x50], "song.flac"));
  });

  it("name() returns the file path", () => {
    // TypeScript-only test
    expect(stream.name()).toBe("song.flac");
  });

  it("readOnly() returns true", () => {
    // TypeScript-only test
    expect(stream.readOnly()).toBe(true);
  });

  it("isOpen() returns true initially", () => {
    // TypeScript-only test
    expect(stream.isOpen()).toBe(true);
  });

  it("isOpen() returns false after close()", async () => {
    // TypeScript-only test
    await stream.close();
    expect(stream.isOpen()).toBe(false);
  });

  it("length() returns the file size", async () => {
    // TypeScript-only test
    expect(await stream.length()).toBe(5);
  });

  it("readBlock reads bytes from the file", async () => {
    // TypeScript-only test
    const result = await stream.readBlock(3);
    expect(result.equals(bv([0x10, 0x20, 0x30]))).toBe(true);
  });

  it("readBlock advances the position", async () => {
    // TypeScript-only test
    await stream.readBlock(2);
    expect(await stream.tell()).toBe(2);
  });

  it("readBlock in multiple chunks", async () => {
    // TypeScript-only test
    const first = await stream.readBlock(2);
    const second = await stream.readBlock(3);
    expect(first.equals(bv([0x10, 0x20]))).toBe(true);
    expect(second.equals(bv([0x30, 0x40, 0x50]))).toBe(true);
  });

  it("seek from beginning", async () => {
    // TypeScript-only test
    await stream.seek(3);
    const result = await stream.readBlock(2);
    expect(result.equals(bv([0x40, 0x50]))).toBe(true);
  });

  it("seek from current", async () => {
    // TypeScript-only test
    await stream.readBlock(1);
    await stream.seek(2, Position.Current);
    const result = await stream.readBlock(2);
    expect(result.equals(bv([0x40, 0x50]))).toBe(true);
  });

  it("seek from end", async () => {
    // TypeScript-only test
    await stream.seek(-3, Position.End);
    const result = await stream.readBlock(3);
    expect(result.equals(bv([0x30, 0x40, 0x50]))).toBe(true);
  });

  it("clear() resets position to 0", async () => {
    // TypeScript-only test
    await stream.readBlock(4);
    await stream.clear();
    expect(await stream.tell()).toBe(0);
  });

  it("readBlock at end returns empty ByteVector", async () => {
    // TypeScript-only test
    await stream.seek(5);
    expect((await stream.readBlock(10)).isEmpty).toBe(true);
  });

  it("close() closes the stream without error", async () => {
    // TypeScript-only test
    await expect(stream.close()).resolves.toBeUndefined();
    expect(stream.isOpen()).toBe(false);
  });
});
