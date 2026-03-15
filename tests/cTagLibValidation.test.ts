/**
 * Cross-validation test: tags files with taglib-ts, then validates with C TagLib.
 * This ensures taglib-ts output is compatible with the reference implementation.
 *
 * These tests require the C TagLib validator and tagger binaries. The binary
 * paths are resolved from environment variables (TAGLIB_VALIDATE and
 * TAGLIB_TAGGER), falling back to /tmp/taglib_validate and /tmp/tag_with_c_full.
 *
 * In CI the binaries are built from the taglib submodule (validator/) and the
 * paths are exported as environment variables by the build workflow.
 */
import { describe, it, expect } from "vitest";
import { FileRef } from "../src/fileRef.js";
import { ByteVector } from "../src/byteVector.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";
import { Variant, type VariantMap } from "../src/toolkit/variant.js";
import { readTestData } from "./testHelper.js";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const VALIDATOR = process.env.TAGLIB_VALIDATE ?? "/tmp/taglib_validate";
const HAS_C_TAGLIB = existsSync(VALIDATOR);
// ^^ Falls back to /tmp/taglib_validate for local development convenience.

// Use describe.skipIf to skip all tests when C TagLib binaries aren't available
const describeIfCTagLib = HAS_C_TAGLIB ? describe : describe.skip;

interface ValidatorResult {
  valid: boolean;
  title: string;
  artist: string;
  album: string;
  comment: string;
  genre: string;
  year: number;
  track: number;
  duration?: number;
  durationMs?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  properties?: Record<string, string[]>;
  pictures?: Array<{
    mimeType?: string;
    description?: string;
    type?: number;
    size?: number;
    format?: number;
    width?: number;
    height?: number;
  }>;
  pictureCount: number;
}

function validateWithCTagLib(data: Uint8Array, ext: string): ValidatorResult {
  const dir = mkdtempSync(join(tmpdir(), "taglib-validate-"));
  const filepath = join(dir, "test" + ext);
  try {
    writeFileSync(filepath, data);
    const output = execSync(`${VALIDATOR} "${filepath}"`, { encoding: "utf-8", timeout: 10000 });
    return JSON.parse(output);
  } finally {
    try { unlinkSync(filepath); } catch { /* ignore */ }
  }
}

async function tagAndValidate(
  testFile: string,
  ext: string,
  opts?: {
    skipAudioCheck?: boolean;
    pictures?: VariantMap[];
  },
): Promise<ValidatorResult> {
  const data = readTestData(testFile);
  const ref = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
  expect(ref.isNull).toBe(false);

  // Set basic tags
  const tag = ref.tag()!;
  tag.title = "Validation Test";
  tag.artist = "Test Artist";
  tag.album = "Test Album";
  tag.comment = "Test Comment";
  tag.genre = "Rock";
  tag.year = 2024;
  tag.track = 7;

  // Set pictures if provided
  if (opts?.pictures) {
    ref.setComplexProperties("PICTURE", opts.pictures);
  }

  ref.save();

  const stream = ref.file()!.stream() as ByteVectorStream;
  const modified = stream.data().data;

  return validateWithCTagLib(new Uint8Array(modified), ext);
}

function makePicture(opts: {
  size?: number;
  mimeType?: string;
  description?: string;
  pictureType?: number;
} = {}): VariantMap {
  const size = opts.size ?? 256;
  const raw = new Uint8Array(size);
  for (let i = 0; i < size; i++) raw[i] = i & 0xFF;
  const m: VariantMap = new Map();
  m.set("data", Variant.fromByteVector(new ByteVector(raw)));
  m.set("mimeType", Variant.fromString(opts.mimeType ?? "image/png"));
  m.set("description", Variant.fromString(opts.description ?? "Front Cover"));
  m.set("pictureType", Variant.fromInt(opts.pictureType ?? 3));
  return m;
}

// ---------------------------------------------------------------------------
// Tag validation tests
// ---------------------------------------------------------------------------

describeIfCTagLib("C TagLib validation — basic tags", () => {
  it("FLAC: tags readable by C TagLib", async () => {
    const result = await tagAndValidate("silence-44-s.flac", ".flac");
    expect(result.valid).toBe(true);
    expect(result.title).toBe("Validation Test");
    expect(result.artist).toBe("Test Artist");
    expect(result.album).toBe("Test Album");
    expect(result.comment).toBe("Test Comment");
    expect(result.genre).toBe("Rock");
    expect(result.year).toBe(2024);
    expect(result.track).toBe(7);
  });

  it("MP3: tags readable by C TagLib", async () => {
    const result = await tagAndValidate("xing.mp3", ".mp3");
    expect(result.valid).toBe(true);
    expect(result.title).toBe("Validation Test");
    expect(result.artist).toBe("Test Artist");
    expect(result.album).toBe("Test Album");
    expect(result.genre).toBe("Rock");
    expect(result.year).toBe(2024);
    expect(result.track).toBe(7);
  });

  it("M4A: tags readable by C TagLib", async () => {
    const result = await tagAndValidate("has-tags.m4a", ".m4a");
    expect(result.valid).toBe(true);
    expect(result.title).toBe("Validation Test");
    expect(result.artist).toBe("Test Artist");
    expect(result.album).toBe("Test Album");
    expect(result.year).toBe(2024);
    expect(result.track).toBe(7);
  });

  it("OGG Vorbis: tags readable by C TagLib", async () => {
    const result = await tagAndValidate("empty.ogg", ".ogg");
    expect(result.valid).toBe(true);
    expect(result.title).toBe("Validation Test");
    expect(result.artist).toBe("Test Artist");
    expect(result.album).toBe("Test Album");
    expect(result.genre).toBe("Rock");
    expect(result.year).toBe(2024);
    expect(result.track).toBe(7);
  });

  it("WAV: tags readable by C TagLib", async () => {
    const result = await tagAndValidate("empty.wav", ".wav");
    expect(result.valid).toBe(true);
    expect(result.title).toBe("Validation Test");
    expect(result.artist).toBe("Test Artist");
  });

  it("AIFF: tags readable by C TagLib", async () => {
    const result = await tagAndValidate("noise.aif", ".aif");
    expect(result.valid).toBe(true);
    expect(result.title).toBe("Validation Test");
    expect(result.artist).toBe("Test Artist");
  });
});

describeIfCTagLib("C TagLib validation — audio properties preserved", () => {
  it("FLAC: audio properties intact after tagging", async () => {
    const result = await tagAndValidate("silence-44-s.flac", ".flac");
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
  });

  it("MP3: audio properties intact after tagging", async () => {
    const result = await tagAndValidate("xing.mp3", ".mp3");
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
  });

  it("OGG: audio properties intact after tagging", async () => {
    const result = await tagAndValidate("empty.ogg", ".ogg");
    expect(result.sampleRate).toBeGreaterThan(0);
    expect(result.channels).toBeGreaterThan(0);
  });
});

describeIfCTagLib("C TagLib validation — pictures", () => {
  it("FLAC: picture readable by C TagLib", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", size: 512 });
    const result = await tagAndValidate("silence-44-s.flac", ".flac", { pictures: [pic] });
    expect(result.pictureCount).toBe(1);
    expect(result.pictures?.[0]?.mimeType).toBe("image/jpeg");
    expect(result.pictures?.[0]?.size).toBe(512);
  });

  it("MP3: picture readable by C TagLib", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", size: 256 });
    const result = await tagAndValidate("xing.mp3", ".mp3", { pictures: [pic] });
    expect(result.pictureCount).toBe(1);
    expect(result.pictures?.[0]?.mimeType).toBe("image/jpeg");
    expect(result.pictures?.[0]?.size).toBe(256);
  });

  it("M4A: picture readable by C TagLib", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", size: 128 });
    const result = await tagAndValidate("has-tags.m4a", ".m4a", { pictures: [pic] });
    expect(result.pictureCount).toBe(1);
    expect(result.pictures?.[0]?.size).toBe(128);
  });

  it("OGG: picture readable by C TagLib", async () => {
    const pic = makePicture({ mimeType: "image/png", size: 256 });
    const result = await tagAndValidate("empty.ogg", ".ogg", { pictures: [pic] });
    expect(result.pictureCount).toBe(1);
    expect(result.pictures?.[0]?.mimeType).toBe("image/png");
    expect(result.pictures?.[0]?.size).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// OGG page structure validation
// ---------------------------------------------------------------------------

interface OggPageInfo {
  seqNum: number;
  granule: bigint;
  bos: boolean;
  eos: boolean;
  dataSize: number;
}

function parseOggPages(data: Uint8Array): OggPageInfo[] {
  const pages: OggPageInfo[] = [];
  let offset = 0;
  while (offset + 27 < data.length) {
    if (data[offset] !== 0x4F || data[offset + 1] !== 0x67 ||
        data[offset + 2] !== 0x67 || data[offset + 3] !== 0x53) break;
    const headerType = data[offset + 5];
    let granule = 0n;
    for (let b = 7; b >= 0; b--) {
      granule = (granule << 8n) | BigInt(data[offset + 6 + b]);
    }
    if (granule >= 2n ** 63n) granule -= 2n ** 64n;
    const seqNum = data[offset + 18] | (data[offset + 19] << 8) |
                   (data[offset + 20] << 16) | (data[offset + 21] << 24);
    const segCount = data[offset + 26];
    let dataSize = 0;
    for (let i = 0; i < segCount; i++) dataSize += data[offset + 27 + i];
    pages.push({
      seqNum,
      granule,
      bos: !!(headerType & 0x02),
      eos: !!(headerType & 0x04),
      dataSize,
    });
    offset += 27 + segCount + dataSize;
  }
  return pages;
}

describe("OGG page structure validation", () => {
  it("OGG Vorbis: audio pages preserve granule positions", async () => {
    const original = readTestData("empty.ogg");
    const origPages = parseOggPages(original);

    // Tag the file
    const ref = await FileRef.fromByteArray(new Uint8Array(original), "test.ogg");
    ref.tag()!.title = "OGG Structure Test";
    ref.tag()!.artist = "Test";
    ref.save();

    const stream = ref.file()!.stream() as ByteVectorStream;
    const tagged = parseOggPages(new Uint8Array(stream.data().data));

    // First page must have BOS
    expect(tagged[0].bos).toBe(true);
    // Last page must have EOS
    expect(tagged[tagged.length - 1].eos).toBe(true);

    // Page sequence numbers must be monotonically increasing
    for (let i = 1; i < tagged.length; i++) {
      expect(tagged[i].seqNum).toBe(tagged[i - 1].seqNum + 1);
    }

    // Audio pages (last page of original) must preserve granule position
    const origLastGranule = origPages[origPages.length - 1].granule;
    const taggedLastGranule = tagged[tagged.length - 1].granule;
    expect(taggedLastGranule).toBe(origLastGranule);

    // Audio page data size must be preserved
    const origLastDataSize = origPages[origPages.length - 1].dataSize;
    const taggedLastDataSize = tagged[tagged.length - 1].dataSize;
    expect(taggedLastDataSize).toBe(origLastDataSize);
  });

  it("OGG Vorbis: no granule = -1 pages (broken audio)", async () => {
    const data = readTestData("empty.ogg");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.ogg");
    ref.tag()!.title = "Check for broken pages";
    ref.save();

    const stream = ref.file()!.stream() as ByteVectorStream;
    const pages = parseOggPages(new Uint8Array(stream.data().data));

    // No page should have granule = -1 (0xFFFFFFFFFFFFFFFF)
    for (const page of pages) {
      expect(page.granule).not.toBe(-1n);
    }
  });

  it("OGG Vorbis: header pages have granule = 0", async () => {
    const data = readTestData("empty.ogg");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.ogg");
    ref.tag()!.title = "Header granule check";
    ref.save();

    const stream = ref.file()!.stream() as ByteVectorStream;
    const pages = parseOggPages(new Uint8Array(stream.data().data));

    // Vorbis has 3 header packets, so at least 3 pages with granule=0
    // (could be more if comment header is very large)
    let headerPageCount = 0;
    for (const page of pages) {
      if (page.granule === 0n) headerPageCount++;
      else break;
    }
    expect(headerPageCount).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Bidirectional validation: C TagLib → taglib-ts
// ---------------------------------------------------------------------------

const C_TAGGER = process.env.TAGLIB_TAGGER ?? "/tmp/tag_with_c_full";
// ^^ Falls back to /tmp/tag_with_c_full for local development convenience.

function tagWithCTagLib(testFile: string, ext: string, format: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "taglib-bidir-"));
  const input = join(__dirname, "data", testFile);
  const output = join(dir, "tagged" + ext);
  execSync(`${C_TAGGER} "${input}" "${output}" "${format}"`, { timeout: 10000 });
  const { readFileSync } = require("fs") as typeof import("fs");
  const result = readFileSync(output);
  try { unlinkSync(output); } catch { /* ignore */ }
  return new Uint8Array(result);
}

describeIfCTagLib("C TagLib → taglib-ts: read tags written by C TagLib", () => {
  it("MP3: taglib-ts reads C TagLib output", async () => {
    const data = tagWithCTagLib("xing.mp3", ".mp3", "mp3");
    const ref = await FileRef.fromByteArray(data, "test.mp3");
    const tag = ref.tag()!;
    expect(tag.title).toBe("C TagLib Title");
    expect(tag.artist).toBe("C TagLib Artist");
    expect(tag.album).toBe("C TagLib Album");
    expect(tag.comment).toBe("C TagLib Comment");
    expect(tag.genre).toBe("Rock");
    expect(tag.year).toBe(2025);
    expect(tag.track).toBe(42);

    // Verify picture
    const pics = ref.complexProperties("PICTURE");
    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/jpeg");
    expect(pics[0].get("data")!.toByteVector().length).toBe(128);
  });

  it("FLAC: taglib-ts reads C TagLib output", async () => {
    const data = tagWithCTagLib("silence-44-s.flac", ".flac", "flac");
    const ref = await FileRef.fromByteArray(data, "test.flac");
    const tag = ref.tag()!;
    expect(tag.title).toBe("C TagLib Title");
    expect(tag.artist).toBe("C TagLib Artist");
    expect(tag.year).toBe(2025);
    expect(tag.track).toBe(42);

    const pics = ref.complexProperties("PICTURE");
    expect(pics.length).toBeGreaterThanOrEqual(1);
    // Find the picture added by C TagLib (silence-44-s.flac may already have one)
    const cPic = pics.find(
      p => p.get("mimeType")?.toString() === "image/jpeg" &&
           p.get("data")?.toByteVector().length === 128,
    );
    expect(cPic).toBeDefined();
  });

  it("OGG: taglib-ts reads C TagLib output", async () => {
    const data = tagWithCTagLib("empty.ogg", ".ogg", "ogg");
    const ref = await FileRef.fromByteArray(data, "test.ogg");
    const tag = ref.tag()!;
    expect(tag.title).toBe("C TagLib Title");
    expect(tag.artist).toBe("C TagLib Artist");
    expect(tag.year).toBe(2025);
    expect(tag.track).toBe(42);

    const pics = ref.complexProperties("PICTURE");
    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/jpeg");
  });

  it("M4A: taglib-ts reads C TagLib output", async () => {
    const data = tagWithCTagLib("has-tags.m4a", ".m4a", "m4a");
    const ref = await FileRef.fromByteArray(data, "test.m4a");
    const tag = ref.tag()!;
    expect(tag.title).toBe("C TagLib Title");
    expect(tag.artist).toBe("C TagLib Artist");
    expect(tag.year).toBe(2025);
    expect(tag.track).toBe(42);

    const pics = ref.complexProperties("PICTURE");
    expect(pics.length).toBe(1);
    expect(pics[0].get("data")!.toByteVector().length).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: taglib-ts → C TagLib → taglib-ts
// ---------------------------------------------------------------------------

describeIfCTagLib("Round-trip: taglib-ts → C TagLib → taglib-ts", () => {
  it("MP3: tag with TS, validate with C, re-read with TS", async () => {
    // Tag with taglib-ts
    const data = readTestData("xing.mp3");
    let ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mp3");
    ref.tag()!.title = "Round Trip";
    ref.tag()!.artist = "TS Artist";
    ref.tag()!.year = 2026;
    ref.save();

    const tsOutput = (ref.file()!.stream() as ByteVectorStream).data().data;

    // Validate with C TagLib
    const cResult = validateWithCTagLib(new Uint8Array(tsOutput), ".mp3");
    expect(cResult.title).toBe("Round Trip");
    expect(cResult.artist).toBe("TS Artist");
    expect(cResult.year).toBe(2026);

    // Re-read with taglib-ts
    ref = await FileRef.fromByteArray(new Uint8Array(tsOutput), "test.mp3");
    expect(ref.tag()!.title).toBe("Round Trip");
    expect(ref.tag()!.artist).toBe("TS Artist");
    expect(ref.tag()!.year).toBe(2026);
  });

  it("FLAC: tag with TS, validate with C, re-read with TS", async () => {
    const data = readTestData("silence-44-s.flac");
    let ref = await FileRef.fromByteArray(new Uint8Array(data), "test.flac");
    ref.tag()!.title = "FLAC Round Trip";
    ref.tag()!.artist = "FLAC Artist";
    ref.tag()!.track = 99;
    ref.save();

    const tsOutput = (ref.file()!.stream() as ByteVectorStream).data().data;
    const cResult = validateWithCTagLib(new Uint8Array(tsOutput), ".flac");
    expect(cResult.title).toBe("FLAC Round Trip");
    expect(cResult.track).toBe(99);

    ref = await FileRef.fromByteArray(new Uint8Array(tsOutput), "test.flac");
    expect(ref.tag()!.title).toBe("FLAC Round Trip");
    expect(ref.tag()!.track).toBe(99);
  });

  it("OGG: tag with TS, validate with C, re-read with TS", async () => {
    const data = readTestData("empty.ogg");
    let ref = await FileRef.fromByteArray(new Uint8Array(data), "test.ogg");
    ref.tag()!.title = "OGG Round Trip";
    ref.tag()!.genre = "Jazz";
    ref.save();

    const tsOutput = (ref.file()!.stream() as ByteVectorStream).data().data;
    const cResult = validateWithCTagLib(new Uint8Array(tsOutput), ".ogg");
    expect(cResult.title).toBe("OGG Round Trip");
    expect(cResult.genre).toBe("Jazz");
    // Verify audio properties are preserved
    expect(cResult.sampleRate).toBe(44100);
    expect(cResult.channels).toBe(2);

    ref = await FileRef.fromByteArray(new Uint8Array(tsOutput), "test.ogg");
    expect(ref.tag()!.title).toBe("OGG Round Trip");
    expect(ref.tag()!.genre).toBe("Jazz");
  });

  it("M4A: tag with TS, validate with C, re-read with TS", async () => {
    const data = readTestData("has-tags.m4a");
    let ref = await FileRef.fromByteArray(new Uint8Array(data), "test.m4a");
    ref.tag()!.title = "M4A Round Trip";
    ref.tag()!.album = "M4A Album";
    ref.save();

    const tsOutput = (ref.file()!.stream() as ByteVectorStream).data().data;
    const cResult = validateWithCTagLib(new Uint8Array(tsOutput), ".m4a");
    expect(cResult.title).toBe("M4A Round Trip");
    expect(cResult.album).toBe("M4A Album");

    ref = await FileRef.fromByteArray(new Uint8Array(tsOutput), "test.m4a");
    expect(ref.tag()!.title).toBe("M4A Round Trip");
    expect(ref.tag()!.album).toBe("M4A Album");
  });
});
