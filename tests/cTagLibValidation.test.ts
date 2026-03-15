/**
 * Cross-validation test: tags files with taglib-ts, then validates with C TagLib.
 * This ensures taglib-ts output is compatible with the reference implementation.
 */
import { describe, it, expect } from "vitest";
import { FileRef } from "../src/fileRef.js";
import { ByteVector } from "../src/byteVector.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";
import { Variant, type VariantMap } from "../src/toolkit/variant.js";
import { readTestData } from "./testHelper.js";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const VALIDATOR = "/tmp/taglib_validate";

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

describe("C TagLib validation — basic tags", () => {
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

describe("C TagLib validation — audio properties preserved", () => {
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

describe("C TagLib validation — pictures", () => {
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

describe("C TagLib validation — OGG page structure", () => {
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
