/**
 * Cross-validation test suite: taglib-ts ↔ C TagLib (v2.2.1) compatibility.
 *
 * Strategy per format:
 *   1. Tag a clean copy of a test file using the C tagger binary.
 *   2. Tag the SAME original file using taglib-ts in memory.
 *   3. Both outputs are validated with the C TagLib validator binary.
 *   4. Both outputs are also read back with taglib-ts to verify tag values.
 *   5. All simple tag properties (title, artist, album, comment, genre,
 *      year, track) are checked.  Where the format supports it, a test
 *      picture is embedded and verified.
 *
 * Byte equality check: For each format we compare the raw bytes produced by
 * C TagLib and taglib-ts.  Because some formats include implementation-specific
 * metadata (vendor strings for OGG/FLAC, padding strategies for ID3v2), byte
 * equality is only expected for formats with a fully-deterministic binary
 * layout.  When bytes differ for other formats the semantic checks still
 * enforce correctness.
 *
 * Environment variables:
 *   TAGLIB_VALIDATE  – path to the taglib_validate binary
 *   TAGLIB_TAGGER    – path to the tag_with_c_full binary
 *
 * If the binaries are absent all tests in the "C TagLib" describe blocks are
 * skipped automatically.
 */

import { execSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ByteVector } from "../byteVector.js";
import { FileRef } from "../fileRef.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { Variant, type VariantMap } from "../toolkit/variant.js";
import { readTestData } from "./testHelper.js";

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const VALIDATOR = process.env.TAGLIB_VALIDATE ?? "/tmp/taglib_validate";
const C_TAGGER = process.env.TAGLIB_TAGGER ?? "/tmp/tag_with_c_full";
const HAS_C_TAGLIB = existsSync(VALIDATOR) && existsSync(C_TAGGER);

const describeIfC = HAS_C_TAGLIB ? describe : describe.skip;

// Fixed tag values – identical for both C and TypeScript tagging
const TAG = {
  title: "Cross-Validation Test",
  artist: "Cross-Validation Artist",
  album: "Cross-Validation Album",
  comment: "Cross-Validation Comment",
  genre: "Electronic",
  year: 2025,
  track: 7,
};

// Deterministic 512-byte JPEG-like buffer (same as in tag_with_c_full.cpp)
function makeTestJPEG(): Uint8Array {
  const raw = new Uint8Array(512);
  raw[0] = 0xFF;
  raw[1] = 0xD8;
  for (let i = 2; i < 512; i++) raw[i] = ((i * 37 + 13) & 0xFF);
  return raw;
}

function makePictureMap(data: Uint8Array): VariantMap {
  const m: VariantMap = new Map();
  m.set("data", Variant.fromByteVector(new ByteVector(data)));
  m.set("mimeType", Variant.fromString("image/jpeg"));
  m.set("description", Variant.fromString("Front Cover"));
  m.set("pictureType", Variant.fromInt(3));
  return m;
}

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
  pictureCount: number;
  pictures?: Array<{
    mimeType?: string;
    description?: string;
    type?: number;
    size?: number;
  }>;
}

function validateWithC(data: Uint8Array, ext: string): ValidatorResult {
  const dir = mkdtempSync(join(tmpdir(), "taglib-validate-"));
  const file = join(dir, "test" + ext);
  try {
    writeFileSync(file, data);
    const out = execSync(`"${VALIDATOR}" "${file}"`, {
      encoding: "utf-8",
      timeout: 10_000,
    });
    return JSON.parse(out);
  } finally {
    try { unlinkSync(file); } catch { /* ignore */ }
  }
}

function tagWithC(testFile: string, ext: string, format: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "taglib-c-tagger-"));
  const input = join(__dirname, "data", testFile);
  const output = join(dir, "tagged" + ext);
  execSync(`"${C_TAGGER}" "${input}" "${output}" "${format}"`, {
    timeout: 10_000,
  });
  const result = readFileSync(output);
  try { unlinkSync(output); } catch { /* ignore */ }
  return new Uint8Array(result);
}

async function tagWithTS(
  testFile: string,
  ext: string,
  opts: { picture?: boolean } = {},
): Promise<Uint8Array> {
  const data = readTestData(testFile);
  const ref = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
  expect(ref.isNull).toBe(false);

  const tag = ref.tag()!;
  tag.title = TAG.title;
  tag.artist = TAG.artist;
  tag.album = TAG.album;
  tag.comment = TAG.comment;
  tag.genre = TAG.genre;
  tag.year = TAG.year;
  tag.track = TAG.track;

  if (opts.picture) {
    ref.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  }

  await ref.save();
  const stream = ref.file()!.stream() as ByteVectorStream;
  return new Uint8Array(stream.data().data);
}

/** Assert that the C-validator result matches the expected tag values. */
function expectTagsMatch(
  result: ValidatorResult,
  opts: { skipComment?: boolean } = {},
) {
  expect(result.valid).toBe(true);
  expect(result.title).toBe(TAG.title);
  expect(result.artist).toBe(TAG.artist);
  expect(result.album).toBe(TAG.album);
  if (!opts.skipComment) expect(result.comment).toBe(TAG.comment);
  expect(result.genre).toBe(TAG.genre);
  expect(result.year).toBe(TAG.year);
  expect(result.track).toBe(TAG.track);
}

/** Assert that taglib-ts reads the expected tag values from the given bytes. */
async function expectTSReadsOK(
  bytes: Uint8Array,
  ext: string,
  opts: { skipComment?: boolean } = {},
) {
  const ref = await FileRef.fromByteArray(bytes, "test" + ext);
  expect(ref.isNull).toBe(false);
  const tag = ref.tag()!;
  expect(tag.title).toBe(TAG.title);
  expect(tag.artist).toBe(TAG.artist);
  expect(tag.album).toBe(TAG.album);
  if (!opts.skipComment) expect(tag.comment).toBe(TAG.comment);
  expect(tag.genre).toBe(TAG.genre);
  expect(tag.year).toBe(TAG.year);
  expect(tag.track).toBe(TAG.track);
}

// ---------------------------------------------------------------------------
// Per-format test configuration
// ---------------------------------------------------------------------------

interface FormatTestCfg {
  label: string;
  testFile: string;
  ext: string;
  format: string;
  hasPicture?: boolean;
  skipComment?: boolean;
  skipByteEquality?: boolean;
  skipAudioProps?: boolean;
  /** True when taglib-ts cannot write this format (read-only in taglib-ts) */
  tsReadOnly?: boolean;
}

const FORMATS: FormatTestCfg[] = [
  {
    label: "MP3",
    testFile: "xing.mp3",
    ext: ".mp3",
    format: "mp3",
    hasPicture: true,
    // Byte equality: ID3v2 sorted frames + Latin1 encoding + 1024-byte padding.
  },
  {
    label: "FLAC",
    testFile: "no-tags.flac",
    ext: ".flac",
    format: "flac",
    hasPicture: true,
    // Byte equality: vendor string preserved from original file; XiphComment fields
    // sorted alphabetically + pictures last, matching C++ TagLib.
  },
  {
    label: "OGG Vorbis",
    testFile: "empty.ogg",
    ext: ".ogg",
    format: "ogg",
    hasPicture: true,
    // Byte equality: vendor string preserved from original file; XiphComment fields
    // sorted alphabetically + pictures last, matching C++ TagLib.
  },
  {
    label: "OGG Opus",
    testFile: "correctness_gain_silent_output.opus",
    ext: ".opus",
    format: "opus",
    hasPicture: true,
    // Byte equality: vendor string preserved from original file.
  },
  {
    label: "OGG Speex",
    testFile: "empty.spx",
    ext: ".spx",
    format: "speex",
    hasPicture: true,
    // Byte equality: vendor string preserved from original file.
    skipComment: true,
  },
  {
    label: "M4A",
    testFile: "no-tags.m4a",
    ext: ".m4a",
    format: "m4a",
    hasPicture: true,
    // Byte equality: MP4 items sorted alphabetically + deterministic padIlst.
  },
  {
    label: "WAV",
    testFile: "empty.wav",
    ext: ".wav",
    format: "wav",
    hasPicture: true,
    // Byte equality: ID3v2-only chunk (INFO not auto-created), sorted frames,
    // Latin1 encoding, 1024-byte padding.
  },
  {
    label: "AIFF",
    testFile: "empty.aiff",
    ext: ".aiff",
    format: "aiff",
    hasPicture: true,
    // Byte equality: ID3v2, sorted frames, Latin1, 1024-byte padding.
  },
  {
    label: "MPC",
    testFile: "click.mpc",
    ext: ".mpc",
    format: "mpc",
    // Byte equality: APEv2 items sorted alphabetically.
    skipAudioProps: true,
  },
  {
    label: "WavPack",
    testFile: "click.wv",
    ext: ".wv",
    format: "wv",
    // Byte equality: APEv2 items sorted alphabetically.
  },
  {
    label: "APE",
    testFile: "mac-399.ape",
    ext: ".ape",
    format: "ape",
    // Byte equality: APEv2 items sorted alphabetically.
  },
  {
    label: "TrueAudio",
    testFile: "empty.tta",
    ext: ".tta",
    format: "tta",
    hasPicture: true,
    // Byte equality: ID3v2 sorted frames + Latin1 + 1024-byte padding.
  },
  {
    label: "DSF",
    testFile: "empty10ms.dsf",
    ext: ".dsf",
    format: "dsf",
    hasPicture: true,
    // Byte equality: ID3v2 sorted frames + Latin1 + 1024-byte padding.
  },
  {
    label: "ASF/WMA",
    testFile: "lossless.wma",
    ext: ".wma",
    format: "asf",
    hasPicture: true,
    // Byte equality: ASF attributes sorted alphabetically, matching C++ TagLib::Map.
  },
  {
    label: "Matroska",
    testFile: "no-tags.mka",
    ext: ".mka",
    format: "mkv",
    tsReadOnly: true,
    skipComment: true,
  },
];

// ---------------------------------------------------------------------------
// Cross-validation: C TagLib → taglib-ts reads
// ---------------------------------------------------------------------------

describeIfC("C TagLib → taglib-ts: read tags written by C TagLib", () => {
  for (const cfg of FORMATS) {
    it(`${cfg.label}: taglib-ts reads C TagLib output`, async () => {
      const cBytes = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      await expectTSReadsOK(cBytes, cfg.ext, cfg);
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-validation: taglib-ts → C TagLib reads
// ---------------------------------------------------------------------------

describeIfC("taglib-ts → C TagLib: read tags written by taglib-ts", () => {
  for (const cfg of FORMATS) {
    if (cfg.tsReadOnly) {
      it.skip(`${cfg.label}: C TagLib reads taglib-ts output (skipped – taglib-ts is read-only for this format)`, () => { /* skip */ });
      continue;
    }
    it(`${cfg.label}: C TagLib reads taglib-ts output`, async () => {
      const tsBytes = await tagWithTS(cfg.testFile, cfg.ext,
        { picture: cfg.hasPicture });
      const result = validateWithC(tsBytes, cfg.ext);
      expectTagsMatch(result, cfg);
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-validation: audio properties preserved after tagging
// ---------------------------------------------------------------------------

describeIfC("Audio properties preserved after tagging", () => {
  for (const cfg of FORMATS.filter(f => !f.skipAudioProps)) {
    it(`${cfg.label}: audio props match between C TagLib and taglib-ts`, async () => {
      const cBytes = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      const cResult = validateWithC(cBytes, cfg.ext);

      // Verify C output has valid audio properties
      if (cResult.sampleRate !== undefined)
        expect(cResult.sampleRate).toBeGreaterThan(0);
      if (cResult.channels !== undefined)
        expect(cResult.channels).toBeGreaterThan(0);

      if (cfg.tsReadOnly) return;

      // Verify TS output has the same audio properties as C
      const tsBytes = await tagWithTS(cfg.testFile, cfg.ext);
      const tsResult = validateWithC(tsBytes, cfg.ext);

      // sampleRate and channels must match exactly
      if (cResult.sampleRate !== undefined && tsResult.sampleRate !== undefined)
        expect(tsResult.sampleRate).toBe(cResult.sampleRate);
      if (cResult.channels !== undefined && tsResult.channels !== undefined)
        expect(tsResult.channels).toBe(cResult.channels);
      // bitrate and duration are allowed a ±1 tolerance
      if (cResult.bitrate !== undefined && tsResult.bitrate !== undefined)
        expect(Math.abs(tsResult.bitrate - cResult.bitrate)).toBeLessThanOrEqual(1);
      if (cResult.duration !== undefined && tsResult.duration !== undefined)
        expect(Math.abs(tsResult.duration - cResult.duration)).toBeLessThanOrEqual(1);
    });

    it(`${cfg.label}: taglib-ts reads correct audio props from its own output`, async () => {
      if (cfg.tsReadOnly) return;
      const tsBytes = await tagWithTS(cfg.testFile, cfg.ext);
      const ref = await FileRef.fromByteArray(tsBytes, "test" + cfg.ext);
      const props = ref.audioProperties();
      if (!props) return;
      if (props.sampleRate !== undefined)
        expect(props.sampleRate).toBeGreaterThan(0);
      if (props.channels !== undefined)
        expect(props.channels).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-validation: pictures
// ---------------------------------------------------------------------------

describeIfC("Pictures: C TagLib → taglib-ts", () => {
  for (const cfg of FORMATS.filter(f => f.hasPicture)) {
    it(`${cfg.label}: taglib-ts reads picture written by C TagLib`, async () => {
      const cBytes = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      const ref = await FileRef.fromByteArray(cBytes, "test" + cfg.ext);
      const pics = ref.complexProperties("PICTURE");
      expect(pics.length).toBeGreaterThanOrEqual(1);
      const pic = pics[0];
      expect(pic.get("mimeType")?.toString()).toBe("image/jpeg");
      expect(pic.get("data")?.toByteVector().length).toBe(512);
    });
  }
});

describeIfC("Pictures: taglib-ts → C TagLib", () => {
  for (const cfg of FORMATS.filter(f => f.hasPicture && !f.tsReadOnly)) {
    it(`${cfg.label}: C TagLib reads picture written by taglib-ts`, async () => {
      const tsBytes = await tagWithTS(cfg.testFile, cfg.ext, { picture: true });
      const result = validateWithC(tsBytes, cfg.ext);
      expect(result.pictureCount).toBeGreaterThanOrEqual(1);
      if (result.pictures && result.pictures.length > 0) {
        expect(result.pictures[0].mimeType).toBe("image/jpeg");
        expect(result.pictures[0].size).toBe(512);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Byte equality check
// ---------------------------------------------------------------------------

describeIfC("Byte equality: taglib-ts output matches C TagLib output", () => {
  for (const cfg of FORMATS) {
    if (cfg.skipByteEquality) {
      it.skip(
        `${cfg.label}: byte equality (skipped – known implementation differences)`,
        () => { /* intentionally skipped */ },
      );
      continue;
    }

    it(`${cfg.label}: byte-for-byte identical output`, async () => {
      const cBytes = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      const tsBytes = await tagWithTS(cfg.testFile, cfg.ext,
        { picture: cfg.hasPicture });
      expect(tsBytes.length).toBe(cBytes.length);
      expect(Buffer.from(tsBytes).equals(Buffer.from(cBytes))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Round-trip: taglib-ts → C TagLib → taglib-ts
// ---------------------------------------------------------------------------

describeIfC("Round-trip: taglib-ts → C TagLib validate → taglib-ts re-read", () => {
  // All formats that taglib-ts can write and that the C validator can read
  const roundTripFormats = FORMATS.filter(f => !f.tsReadOnly && !f.skipAudioProps);

  for (const cfg of roundTripFormats) {
    it(`${cfg.label}: TS → C validate → TS re-read`, async () => {
      const tsBytes = await tagWithTS(cfg.testFile, cfg.ext,
        { picture: cfg.hasPicture });

      const cResult = validateWithC(tsBytes, cfg.ext);
      expectTagsMatch(cResult, cfg);

      await expectTSReadsOK(tsBytes, cfg.ext, cfg);
    });
  }
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

    const ref = await FileRef.fromByteArray(new Uint8Array(original), "test.ogg");
    ref.tag()!.title = "OGG Structure Test";
    ref.tag()!.artist = "Test";
    await ref.save();

    const stream = ref.file()!.stream() as ByteVectorStream;
    const tagged = parseOggPages(new Uint8Array(stream.data().data));

    expect(tagged[0].bos).toBe(true);
    expect(tagged[tagged.length - 1].eos).toBe(true);

    for (let i = 1; i < tagged.length; i++) {
      expect(tagged[i].seqNum).toBe(tagged[i - 1].seqNum + 1);
    }

    const origLastGranule = origPages[origPages.length - 1].granule;
    const taggedLastGranule = tagged[tagged.length - 1].granule;
    expect(taggedLastGranule).toBe(origLastGranule);

    expect(tagged[tagged.length - 1].dataSize)
      .toBe(origPages[origPages.length - 1].dataSize);
  });

  it("OGG Vorbis: no granule = -1 pages (broken audio)", async () => {
    const data = readTestData("empty.ogg");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.ogg");
    ref.tag()!.title = "Check for broken pages";
    await ref.save();

    const stream = ref.file()!.stream() as ByteVectorStream;
    const pages = parseOggPages(new Uint8Array(stream.data().data));
    for (const page of pages) {
      expect(page.granule).not.toBe(-1n);
    }
  });

  it("OGG Vorbis: header pages have granule = 0", async () => {
    const data = readTestData("empty.ogg");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.ogg");
    ref.tag()!.title = "Header granule check";
    await ref.save();

    const stream = ref.file()!.stream() as ByteVectorStream;
    const pages = parseOggPages(new Uint8Array(stream.data().data));

    let headerPageCount = 0;
    for (const page of pages) {
      if (page.granule === 0n) headerPageCount++;
      else break;
    }
    expect(headerPageCount).toBeGreaterThanOrEqual(3);
  });
});
