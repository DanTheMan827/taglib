/**
 * Test helper utilities for loading test data files.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ByteVector } from '../../src/byteVector.js';
import { ByteVectorStream } from '../../src/toolkit/byteVectorStream.js';

const TEST_DATA_DIR = resolve(import.meta.dirname ?? __dirname, '..', 'data');

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
 * Create a temporary copy of a test data file for write tests.
 * Returns the path to the temporary file and a cleanup function.
 */
export function copyTestFile(filename: string, ext?: string): { path: string; cleanup: () => void } {
  const suffix = ext ?? filename.substring(filename.lastIndexOf('.'));
  const dir = mkdtempSync(join(tmpdir(), 'taglib-test-'));
  const dest = join(dir, 'test' + suffix);
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
