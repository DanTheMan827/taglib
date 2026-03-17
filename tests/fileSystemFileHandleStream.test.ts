import { describe, it, expect, beforeEach } from "vitest";
import { ByteVector } from "../src/byteVector.js";
import { FileSystemFileHandleStream } from "../src/toolkit/fileSystemFileHandleStream.js";
import { Position } from "../src/toolkit/types.js";

// ---------------------------------------------------------------------------
// Mock FileSystemSyncAccessHandle backed by an ArrayBuffer
// ---------------------------------------------------------------------------

class MockSyncAccessHandle {
  private _buf: Uint8Array;
  private _cursor: number = 0;

  constructor(initial: Uint8Array = new Uint8Array()) {
    this._buf = new Uint8Array(initial);
  }

  read(buffer: ArrayBufferView, options?: { at?: number }): number {
    const pos = options?.at ?? this._cursor;
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const available = this._buf.length - pos;
    if (available <= 0) {
      return 0;
    }
    const toRead = Math.min(view.length, available);
    view.set(this._buf.subarray(pos, pos + toRead));
    if (options?.at === undefined) {
      this._cursor += toRead;
    }
    return toRead;
  }

  write(buffer: ArrayBufferView | DataView, options?: { at?: number }): number {
    const pos = options?.at ?? this._cursor;
    const src =
      buffer instanceof DataView
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    // Grow if necessary
    if (pos + src.length > this._buf.length) {
      const next = new Uint8Array(pos + src.length);
      next.set(this._buf);
      this._buf = next;
    }
    this._buf.set(src, pos);
    if (options?.at === undefined) {
      this._cursor += src.length;
    }
    return src.length;
  }

  seek(offset: number): void {
    this._cursor = offset;
  }

  truncate(size: number): void {
    const next = new Uint8Array(size);
    next.set(this._buf.subarray(0, size));
    this._buf = next;
  }

  getSize(): number {
    return this._buf.length;
  }

  flush(): void {
    /* no-op in mock */
  }

  close(): void {
    /* no-op in mock */
  }

  /** Test helper: snapshot the current buffer contents. */
  snapshot(): Uint8Array {
    return new Uint8Array(this._buf);
  }
}

// ---------------------------------------------------------------------------
// Mock FileSystemFileHandle
// ---------------------------------------------------------------------------

function makeMockFileHandle(initial: Uint8Array = new Uint8Array(), name = "test.bin"): {
  handle: FileSystemFileHandle;
  syncHandle: MockSyncAccessHandle;
} {
  const syncHandle = new MockSyncAccessHandle(initial);

  const handle = {
    name,
    kind: "file" as const,
    getFile: async () => new File([initial], name),
    createSyncAccessHandle: async () => syncHandle,

    isSameEntry: async (_other: FileSystemHandle) => false,
    queryPermission: async () => "granted" as PermissionState,
    requestPermission: async () => "granted" as PermissionState,
  } as unknown as FileSystemFileHandle;

  return { handle, syncHandle };
}

// ---------------------------------------------------------------------------
// Helper: build ByteVector from a plain number array
// ---------------------------------------------------------------------------

function bv(bytes: number[]): ByteVector {
  return ByteVector.fromUint8Array(new Uint8Array(bytes));
}

// ---------------------------------------------------------------------------
// Tests: read-write mode
// ---------------------------------------------------------------------------

describe("FileSystemFileHandleStream (read-write)", () => {
  let stream: FileSystemFileHandleStream;
  let syncHandle: MockSyncAccessHandle;

  beforeEach(async () => {
    const init = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const mock = makeMockFileHandle(init);
    syncHandle = mock.syncHandle;
    stream = await FileSystemFileHandleStream.open(mock.handle);
  });

  it("name() returns the file handle name", async () => {
    const mock = makeMockFileHandle(new Uint8Array(), "audio.mp3");
    const s = await FileSystemFileHandleStream.open(mock.handle);
    expect(s.name()).toBe("audio.mp3");
  });

  it("readOnly() returns false", async () => {
    expect(stream.readOnly()).toBe(false);
  });

  it("isOpen() returns true initially", () => {
    expect(stream.isOpen()).toBe(true);
  });

  it("isOpen() returns false after close()", async () => {
    await stream.close();
    expect(stream.isOpen()).toBe(false);
  });

  it("length() returns file size", async () => {
    expect(await stream.length()).toBe(5);
  });

  it("readBlock reads bytes from the beginning", async () => {
    const result = await stream.readBlock(3);
    expect(result.equals(bv([0x01, 0x02, 0x03]))).toBe(true);
  });

  it("readBlock advances the position", async () => {
    await stream.readBlock(2);
    expect(await stream.tell()).toBe(2);
  });

  it("readBlock from middle of file", async () => {
    await stream.seek(2);
    const result = await stream.readBlock(2);
    expect(result.equals(bv([0x03, 0x04]))).toBe(true);
  });

  it("readBlock at end returns empty ByteVector", async () => {
    await stream.seek(5);
    const result = await stream.readBlock(10);
    expect(result.isEmpty).toBe(true);
  });

  it("readBlock with length 0 returns empty ByteVector", async () => {
    const result = await stream.readBlock(0);
    expect(result.isEmpty).toBe(true);
  });

  it("writeBlock writes at current position", async () => {
    await stream.seek(1);
    await stream.writeBlock(bv([0xaa, 0xbb]));
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0xaa, 0xbb, 0x04, 0x05]));
  });

  it("writeBlock advances the position", async () => {
    await stream.writeBlock(bv([0xff]));
    expect(await stream.tell()).toBe(1);
  });

  it("writeBlock with empty data is a no-op", async () => {
    await stream.writeBlock(new ByteVector());
    expect(await stream.tell()).toBe(0);
  });

  it("tell() reflects current position", async () => {
    expect(await stream.tell()).toBe(0);
    await stream.readBlock(3);
    expect(await stream.tell()).toBe(3);
  });

  it("seek(offset) seeks from beginning", async () => {
    await stream.seek(3);
    expect(await stream.tell()).toBe(3);
  });

  it("seek from current position", async () => {
    await stream.seek(2);
    await stream.seek(1, Position.Current);
    expect(await stream.tell()).toBe(3);
  });

  it("seek from end", async () => {
    await stream.seek(-2, Position.End);
    expect(await stream.tell()).toBe(3);
  });

  it("clear() resets position to 0", async () => {
    await stream.seek(4);
    await stream.clear();
    expect(await stream.tell()).toBe(0);
  });

  it("truncate shrinks the file", async () => {
    await stream.truncate(3);
    expect(await stream.length()).toBe(3);
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0x02, 0x03]));
  });

  it("truncate clamps position to new length", async () => {
    await stream.seek(5);
    await stream.truncate(2);
    expect(await stream.tell()).toBe(2);
  });

  it("truncate extends the file with zeros", async () => {
    await stream.truncate(7);
    const snap = syncHandle.snapshot();
    expect(snap).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x00, 0x00]));
  });

  it("insert adds bytes and shifts tail", async () => {
    // File: [01 02 03 04 05] — insert [aa bb] at offset 2, replace 0
    await stream.insert(bv([0xaa, 0xbb]), 2, 0);
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0x02, 0xaa, 0xbb, 0x03, 0x04, 0x05]));
    expect(await stream.tell()).toBe(4);
  });

  it("insert replaces bytes when replace > 0 and same size", async () => {
    // Replace 2 bytes at offset 1 with 2 new bytes
    await stream.insert(bv([0xcc, 0xdd]), 1, 2);
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0xcc, 0xdd, 0x04, 0x05]));
  });

  it("insert with smaller data shrinks the file", async () => {
    // Replace 3 bytes at offset 1 with 1 new byte → file should shrink by 2
    await stream.insert(bv([0xee]), 1, 3);
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0xee, 0x05]));
    expect(await stream.length()).toBe(3);
  });

  it("insert with larger data grows the file", async () => {
    // Replace 1 byte at offset 2 with 3 bytes → file grows by 2
    await stream.insert(bv([0x10, 0x20, 0x30]), 2, 1);
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0x02, 0x10, 0x20, 0x30, 0x04, 0x05]));
    expect(await stream.length()).toBe(7);
  });

  it("removeBlock removes bytes and shifts tail", async () => {
    // File: [01 02 03 04 05] — remove 2 bytes at offset 1
    await stream.removeBlock(1, 2);
    expect(syncHandle.snapshot()).toEqual(new Uint8Array([0x01, 0x04, 0x05]));
    expect(await stream.length()).toBe(3);
  });

  it("removeBlock adjusts position when cursor is after removed range", async () => {
    await stream.seek(4);
    await stream.removeBlock(1, 2);
    expect(await stream.tell()).toBe(2);
  });

  it("removeBlock clamps position into removed range to start", async () => {
    await stream.seek(2);
    await stream.removeBlock(1, 3);
    expect(await stream.tell()).toBe(1);
  });

  it("removeBlock with length 0 is a no-op", async () => {
    await stream.removeBlock(0, 0);
    expect(await stream.length()).toBe(5);
  });

  it("removeBlock beyond end is a no-op", async () => {
    await stream.removeBlock(10, 2);
    expect(await stream.length()).toBe(5);
  });

  it("writeBlock throws on read-only stream", async () => {
    const mock = makeMockFileHandle();
    const s = await FileSystemFileHandleStream.open(mock.handle, true);
    await expect(s.writeBlock(bv([0x01]))).rejects.toThrow("read-only");
  });

  it("insert throws on read-only stream", async () => {
    const mock = makeMockFileHandle();
    const s = await FileSystemFileHandleStream.open(mock.handle, true);
    await expect(s.insert(bv([0x01]), 0)).rejects.toThrow("read-only");
  });

  it("removeBlock throws on read-only stream", async () => {
    const mock = makeMockFileHandle();
    const s = await FileSystemFileHandleStream.open(mock.handle, true);
    await expect(s.removeBlock(0, 1)).rejects.toThrow("read-only");
  });

  it("truncate throws on read-only stream", async () => {
    const mock = makeMockFileHandle();
    const s = await FileSystemFileHandleStream.open(mock.handle, true);
    await expect(s.truncate(0)).rejects.toThrow("read-only");
  });
});

// ---------------------------------------------------------------------------
// Tests: read-only mode (Blob)
// ---------------------------------------------------------------------------

describe("FileSystemFileHandleStream (read-only)", () => {
  let stream: FileSystemFileHandleStream;

  beforeEach(async () => {
    const init = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);
    const mock = makeMockFileHandle(init, "song.flac");
    stream = await FileSystemFileHandleStream.open(mock.handle, true);
  });

  it("name() returns the file handle name", () => {
    expect(stream.name()).toBe("song.flac");
  });

  it("readOnly() returns true", () => {
    expect(stream.readOnly()).toBe(true);
  });

  it("isOpen() returns true initially", () => {
    expect(stream.isOpen()).toBe(true);
  });

  it("isOpen() returns false after close()", async () => {
    await stream.close();
    expect(stream.isOpen()).toBe(false);
  });

  it("length() returns the blob size", async () => {
    expect(await stream.length()).toBe(5);
  });

  it("readBlock reads bytes from the blob", async () => {
    const result = await stream.readBlock(3);
    expect(result.equals(bv([0x10, 0x20, 0x30]))).toBe(true);
  });

  it("readBlock advances the position", async () => {
    await stream.readBlock(2);
    expect(await stream.tell()).toBe(2);
  });

  it("readBlock in multiple chunks", async () => {
    const first = await stream.readBlock(2);
    const second = await stream.readBlock(3);
    expect(first.equals(bv([0x10, 0x20]))).toBe(true);
    expect(second.equals(bv([0x30, 0x40, 0x50]))).toBe(true);
  });

  it("seek from beginning", async () => {
    await stream.seek(3);
    const result = await stream.readBlock(2);
    expect(result.equals(bv([0x40, 0x50]))).toBe(true);
  });

  it("seek from current", async () => {
    await stream.readBlock(1);
    await stream.seek(2, Position.Current);
    const result = await stream.readBlock(2);
    expect(result.equals(bv([0x40, 0x50]))).toBe(true);
  });

  it("seek from end", async () => {
    await stream.seek(-3, Position.End);
    const result = await stream.readBlock(3);
    expect(result.equals(bv([0x30, 0x40, 0x50]))).toBe(true);
  });

  it("clear() resets position to 0", async () => {
    await stream.readBlock(4);
    await stream.clear();
    expect(await stream.tell()).toBe(0);
  });

  it("readBlock at end returns empty ByteVector", async () => {
    await stream.seek(5);
    expect((await stream.readBlock(10)).isEmpty).toBe(true);
  });

  it("close() is a no-op for read-only streams (no error)", async () => {
    await expect(stream.close()).resolves.toBeUndefined();
    expect(stream.isOpen()).toBe(false);
  });
});
