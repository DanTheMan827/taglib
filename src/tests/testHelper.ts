/**
 * Test helper utilities for loading test data files.
 */
import { copyFileSync, mkdtempSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { ByteVector } from "../byteVector.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";

const TEST_DATA_DIR = resolve(import.meta.dirname ?? __dirname, "data");

export function testDataPath(filename: string): string {
  return join(TEST_DATA_DIR, filename);
}

export function readTestData(filename: string): Uint8Array {
  return readFileSync(testDataPath(filename));
}

export function readTestDataBV(filename: string): ByteVector {
  return ByteVector.fromByteArray(readTestData(filename));
}

export function openTestStream(filename: string): ByteVectorStream {
  return new ByteVectorStream(readTestDataBV(filename));
}

/**
 * Temporarily resets the provided stream to the start (offset 0), invokes the given async callback using that stream, and restores the stream's previous position afterward.
 *
 * The current position is captured via `stream.tell()` before seeking to `0`. After the callback completes, the original position is restored using `stream.seek(pos)`.
 *
 * @param stream - The ByteVectorStream whose position will be temporarily set to 0 for the duration of the callback.
 * @param fn - An asynchronous function that performs operations on the stream. It receives the same stream instance positioned at 0.
 * @returns A promise that resolves when the callback completes and the original stream position has been restored.
 */
export async function reuseTestStream(stream: ByteVectorStream, fn: (stream: ByteVectorStream) => Promise<void>): Promise<void> {
  const pos = await stream.tell();
  await stream.seek(0);
  try {
    await fn(stream);
  } finally {
    await stream.seek(pos);
  }
}

/**
 * Create a temporary copy of a test data file for write tests.
 * Returns the path to the temporary file and a cleanup function.
 */
export function copyTestFile(filename: string, ext?: string): { path: string; cleanup: () => void } {
  const suffix = ext ?? filename.substring(filename.lastIndexOf("."));
  const dir = mkdtempSync(join(tmpdir(), "taglib-test-"));
  const dest = join(dir, "test" + suffix);
  copyFileSync(testDataPath(filename), dest);
  return {
    path: dest,
    cleanup: () => {
      try { unlinkSync(dest); } catch { /* ignore */ }
    },
  };
}

export function byteVectorFromArray(bytes: number[]): ByteVector {
  return ByteVector.fromByteArray(new Uint8Array(bytes));
}
