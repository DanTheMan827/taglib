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
import { ByteVector, StringType } from "../byteVector.js";
import { DsdiffFile } from "../dsdiff/dsdiffFile.js";
import { DsfFile } from "../dsf/dsfFile.js";
import { MatroskaFile } from "../matroska/matroskaFile.js";
import { Mp4File } from "../mp4/mp4File.js";
import { ChapterFrame } from "../mpeg/id3v2/frames/chapterFrame.js";
import { TableOfContentsFrame } from "../mpeg/id3v2/frames/tableOfContentsFrame.js";
import { TextIdentificationFrame } from "../mpeg/id3v2/frames/textIdentificationFrame.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";
import { MpegFile } from "../mpeg/mpegFile.js";
import { AiffFile } from "../riff/aiff/aiffFile.js";
import { WavFile } from "../riff/wav/wavFile.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { Variant, type VariantMap } from "../toolkit/variant.js";
import { TrueAudioFile } from "../trueaudio/trueAudioFile.js";
import { FileRef } from "../fileRef.js";
import { readTestData } from "./testHelper.js";

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const VALIDATOR = process.env.TAGLIB_VALIDATE ?? "/tmp/taglib_validate";
const C_TAGGER = process.env.TAGLIB_TAGGER ?? "/tmp/tag_with_c_full";
const HAS_C_TAGLIB = existsSync(VALIDATOR) && existsSync(C_TAGGER);

const describeIfC = HAS_C_TAGLIB ? describe : describe.skip;

// Fixed tag values – identical for both C and TypeScript tagging.
// Strings include CJK (kanji/katakana) characters to verify that all Unicode
// code paths work correctly across every format.
const TAG = {
  title:   "Unicode テスト",   // CJK katakana
  artist:  "音楽 Artist",      // CJK kanji
  album:   "日本語 Album",     // CJK kanji
  comment: "コメント Comment", // CJK katakana
  genre:   "Electronic",
  year:    2025,
  track:   7,
};

// Extended tag values – identical for both C and TypeScript tagging.
// Strings include CJK characters to exercise Unicode paths in every format.
const EXT = {
  albumArtist: "アルバムアーティスト",
  composer:    "Composer 作曲家",
  discNumber:  "1",
};

// Chapter data matching tag_with_c_full.cpp CHAP*_TITLE / CHAP*_START / CHAP*_END constants.
// Times are in milliseconds for ID3v2 / MP4.
const CHAP1 = { title: "第一章", startTime: 0,      endTime: 30_000 };
const CHAP2 = { title: "第二章", startTime: 30_000, endTime: 60_000 };

// Matroska chapter times in nanoseconds (CHAP*_START_NS / CHAP*_END_NS in tag_with_c_full.cpp).
const MKV_CHAP1 = { title: "第一章", startTime: 0,                endTime: 30_000_000_000 };
const MKV_CHAP2 = { title: "第二章", startTime: 30_000_000_000,  endTime: 60_000_000_000 };

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
  /** Always present in the validator output (empty string when not set). */
  albumartist: string;
  /** Always present in the validator output (empty string when not set). */
  composer: string;
  /** Always present in the validator output (empty string when not set). */
  discnumber: string;
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
  /** ID3v2 chapter frames sorted by startTime (times in milliseconds). */
  id3v2Chapters?: Array<{ title: string; startTime: number; endTime: number }>;
  /** Matroska chapter atoms from the first edition (times in nanoseconds). */
  matroskaChapters?: Array<{ title: string; startTime: number; endTime: number }>;
  /** MP4 Nero-style (chpl) chapters (times in milliseconds, no endTime). */
  neroChapters?: Array<{ title: string; startTime: number }>;
  /** MP4 QuickTime-style (text track) chapters (times in milliseconds, no endTime). */
  qtChapters?: Array<{ title: string; startTime: number }>;
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
// Extended-tag and chapter helpers
// ---------------------------------------------------------------------------

/**
 * Apply ALL 10 tags (basic 7 + extended 3) to an ID3v2 tag instance via a
 * single setProperties() call with keys in strict alphabetical order.
 * This matches C++ applyAllTagsViaProps() which calls ID3v2Tag::setProperties()
 * with a sorted PropertyMap, producing frames in alphabetical property-key order.
 */
function applyAllTagsToId3(id3: Id3v2Tag): void {
  const all = new PropertyMap();
  all.replace("ALBUM",       [TAG.album]);
  all.replace("ALBUMARTIST", [EXT.albumArtist]);
  all.replace("ARTIST",      [TAG.artist]);
  all.replace("COMMENT",     [TAG.comment]);
  all.replace("COMPOSER",    [EXT.composer]);
  all.replace("DATE",        [String(TAG.year)]);
  all.replace("DISCNUMBER",  [EXT.discNumber]);
  all.replace("GENRE",       [TAG.genre]);
  all.replace("TITLE",       [TAG.title]);
  all.replace("TRACKNUMBER", [String(TAG.track)]);
  id3.setProperties(all);
}

/** Add the CTOC frame + two CHAP frames matching tag_with_c_full.cpp addID3v2Chapters(). */
function addId3v2ChapterFrames(id3: Id3v2Tag): void {
  const tocId = ByteVector.fromString("toc", StringType.Latin1);
  const ch1Id = ByteVector.fromString("ch1", StringType.Latin1);
  const ch2Id = ByteVector.fromString("ch2", StringType.Latin1);

  const ctoc = new TableOfContentsFrame(tocId);
  ctoc.isTopLevel = true;
  ctoc.isOrdered  = true;
  ctoc.addChildElement(ch1Id);
  ctoc.addChildElement(ch2Id);
  id3.addFrame(ctoc);

  const chap1 = new ChapterFrame(ch1Id, CHAP1.startTime, CHAP1.endTime);
  const tit1  = new TextIdentificationFrame(ByteVector.fromString("TIT2", StringType.Latin1), StringType.UTF8);
  tit1.text   = CHAP1.title;
  chap1.addEmbeddedFrame(tit1);
  id3.addFrame(chap1);

  const chap2 = new ChapterFrame(ch2Id, CHAP2.startTime, CHAP2.endTime);
  const tit2  = new TextIdentificationFrame(ByteVector.fromString("TIT2", StringType.Latin1), StringType.UTF8);
  tit2.text   = CHAP2.title;
  chap2.addEmbeddedFrame(tit2);
  id3.addFrame(chap2);
}

/**
 * Tag a file with all 10 tags (basic 7 + extended 3) via a single
 * setProperties() call with keys in strict alphabetical order.
 * This matches C++ applyAllTagsViaProps(), ensuring byte-identical output.
 */
async function tagWithTSExt(
  testFile: string,
  ext: string,
  opts: { picture?: boolean } = {},
): Promise<Uint8Array> {
  const data = readTestData(testFile);
  const ref  = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
  expect(ref.isNull).toBe(false);

  // All keys in alphabetical order to match C++ applyAllTagsViaProps() /
  // std::map iteration order, producing byte-identical tag field ordering.
  const props = new PropertyMap();
  props.replace("ALBUM",       [TAG.album]);
  props.replace("ALBUMARTIST", [EXT.albumArtist]);
  props.replace("ARTIST",      [TAG.artist]);
  props.replace("COMMENT",     [TAG.comment]);
  props.replace("COMPOSER",    [EXT.composer]);
  props.replace("DATE",        [String(TAG.year)]);
  props.replace("DISCNUMBER",  [EXT.discNumber]);
  props.replace("GENRE",       [TAG.genre]);
  props.replace("TITLE",       [TAG.title]);
  props.replace("TRACKNUMBER", [String(TAG.track)]);
  ref.setProperties(props);

  if (opts.picture) {
    ref.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  }

  await ref.save();
  const stream = ref.file()!.stream() as ByteVectorStream;
  return new Uint8Array(stream.data().data);
}

/**
 * Tag a Matroska file with basic + extended tags using a single PropertyMap
 * in strict alphabetical key order, matching C++ applyAllTagsMatroska().
 * (MatroskaTag.setProperties() replaces ALL translatable tags, so all fields
 * must be supplied in one call.)
 */
async function tagWithTSMkvExt(testFile: string, ext: string): Promise<Uint8Array> {
  const data = readTestData(testFile);
  const ref  = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
  expect(ref.isNull).toBe(false);

  // All keys inserted in alphabetical order to match C++ std::map iteration.
  const props = new PropertyMap();
  props.replace("ALBUM",       [TAG.album]);
  props.replace("ALBUMARTIST", [EXT.albumArtist]);
  props.replace("ARTIST",      [TAG.artist]);
  props.replace("COMMENT",     [TAG.comment]);
  props.replace("COMPOSER",    [EXT.composer]);
  props.replace("DATE",        [String(TAG.year)]);
  props.replace("DISCNUMBER",  [EXT.discNumber]);
  props.replace("GENRE",       [TAG.genre]);
  props.replace("TITLE",       [TAG.title]);
  props.replace("TRACKNUMBER", [String(TAG.track)]);
  ref.setProperties(props);

  await ref.save();
  const stream = ref.file()!.stream() as ByteVectorStream;
  return new Uint8Array(stream.data().data);
}

// ---------------------------------------------------------------------------
// Format-specific ID3v2 chapter taggers (basic + extended + CHAP + picture)
// ---------------------------------------------------------------------------

async function tagWithTSChapMp3(): Promise<Uint8Array> {
  const stream = new ByteVectorStream(readTestData("xing.mp3"));
  const f      = await MpegFile.open(stream);
  const id3    = f.id3v2Tag(true)!;
  applyAllTagsToId3(id3);
  addId3v2ChapterFrames(id3);
  id3.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  await f.save();
  return new Uint8Array((f.stream() as ByteVectorStream).data().data);
}

async function tagWithTSChapWav(): Promise<Uint8Array> {
  const stream = new ByteVectorStream(readTestData("empty.wav"));
  const f      = await WavFile.open(stream);
  const id3    = f.id3v2Tag!;
  applyAllTagsToId3(id3);
  addId3v2ChapterFrames(id3);
  id3.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  await f.save();
  return new Uint8Array((f.stream() as ByteVectorStream).data().data);
}

async function tagWithTSChapAiff(): Promise<Uint8Array> {
  const stream = new ByteVectorStream(readTestData("empty.aiff"));
  const f      = await AiffFile.open(stream);
  const id3    = f.id3v2Tag!;
  applyAllTagsToId3(id3);
  addId3v2ChapterFrames(id3);
  id3.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  await f.save();
  return new Uint8Array((f.stream() as ByteVectorStream).data().data);
}

async function tagWithTSChapTta(): Promise<Uint8Array> {
  const stream = new ByteVectorStream(readTestData("empty.tta"));
  const f      = await TrueAudioFile.open(stream);
  const id3    = f.id3v2Tag(true)!;
  applyAllTagsToId3(id3);
  addId3v2ChapterFrames(id3);
  id3.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  await f.save();
  return new Uint8Array((f.stream() as ByteVectorStream).data().data);
}

async function tagWithTSChapDsf(): Promise<Uint8Array> {
  const stream = new ByteVectorStream(readTestData("empty10ms.dsf"));
  const f      = await DsfFile.open(stream);
  const id3    = f.tag() as Id3v2Tag;
  applyAllTagsToId3(id3);
  addId3v2ChapterFrames(id3);
  id3.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  await f.save();
  return new Uint8Array((f.stream() as ByteVectorStream).data().data);
}

async function tagWithTSChapDsdiff(): Promise<Uint8Array> {
  const stream = new ByteVectorStream(readTestData("empty10ms.dff"));
  const f      = await DsdiffFile.open(stream);
  const id3    = f.id3v2Tag(true)!;
  applyAllTagsToId3(id3);
  addId3v2ChapterFrames(id3);
  id3.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  await f.save();
  return new Uint8Array((f.stream() as ByteVectorStream).data().data);
}

// ---------------------------------------------------------------------------
// MP4 chapter taggers (basic + extended + Nero or QT chapters + picture)
// ---------------------------------------------------------------------------

async function tagWithTSChapMp4Nero(): Promise<Uint8Array> {
  const data = readTestData("no-tags.m4a");
  const ref  = await FileRef.fromByteArray(new Uint8Array(data), "test.m4a");
  expect(ref.isNull).toBe(false);
  // All keys in alphabetical order to match C++ applyAllTagsViaProps() / std::map ordering.
  const props = new PropertyMap();
  props.replace("ALBUM",       [TAG.album]);
  props.replace("ALBUMARTIST", [EXT.albumArtist]);
  props.replace("ARTIST",      [TAG.artist]);
  props.replace("COMMENT",     [TAG.comment]);
  props.replace("COMPOSER",    [EXT.composer]);
  props.replace("DATE",        [String(TAG.year)]);
  props.replace("DISCNUMBER",  [EXT.discNumber]);
  props.replace("GENRE",       [TAG.genre]);
  props.replace("TITLE",       [TAG.title]);
  props.replace("TRACKNUMBER", [String(TAG.track)]);
  ref.setProperties(props);
  ref.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  (ref.file() as Mp4File).setNeroChapters([
    { title: CHAP1.title, startTime: CHAP1.startTime },
    { title: CHAP2.title, startTime: CHAP2.startTime },
  ]);
  await ref.save();
  return new Uint8Array((ref.file()!.stream() as ByteVectorStream).data().data);
}

async function tagWithTSChapMp4Qt(): Promise<Uint8Array> {
  const data = readTestData("no-tags.m4a");
  const ref  = await FileRef.fromByteArray(new Uint8Array(data), "test.m4a");
  expect(ref.isNull).toBe(false);
  // All keys in alphabetical order to match C++ applyAllTagsViaProps() / std::map ordering.
  const props = new PropertyMap();
  props.replace("ALBUM",       [TAG.album]);
  props.replace("ALBUMARTIST", [EXT.albumArtist]);
  props.replace("ARTIST",      [TAG.artist]);
  props.replace("COMMENT",     [TAG.comment]);
  props.replace("COMPOSER",    [EXT.composer]);
  props.replace("DATE",        [String(TAG.year)]);
  props.replace("DISCNUMBER",  [EXT.discNumber]);
  props.replace("GENRE",       [TAG.genre]);
  props.replace("TITLE",       [TAG.title]);
  props.replace("TRACKNUMBER", [String(TAG.track)]);
  ref.setProperties(props);
  ref.setComplexProperties("PICTURE", [makePictureMap(makeTestJPEG())]);
  (ref.file() as Mp4File).setQtChapters([
    { title: CHAP1.title, startTime: CHAP1.startTime },
    { title: CHAP2.title, startTime: CHAP2.startTime },
  ]);
  await ref.save();
  return new Uint8Array((ref.file()!.stream() as ByteVectorStream).data().data);
}

// ---------------------------------------------------------------------------
// Matroska chapter tagger (all tags via alphabetical PropertyMap + chapters)
// ---------------------------------------------------------------------------

async function tagWithTSChapMkv(): Promise<Uint8Array> {
  const data = readTestData("no-tags.mka");
  const ref  = await FileRef.fromByteArray(new Uint8Array(data), "test.mka");
  expect(ref.isNull).toBe(false);

  // All keys alphabetical to match C++ applyAllTagsMatroska() + std::map ordering.
  const props = new PropertyMap();
  props.replace("ALBUM",       [TAG.album]);
  props.replace("ALBUMARTIST", [EXT.albumArtist]);
  props.replace("ARTIST",      [TAG.artist]);
  props.replace("COMMENT",     [TAG.comment]);
  props.replace("COMPOSER",    [EXT.composer]);
  props.replace("DATE",        [String(TAG.year)]);
  props.replace("DISCNUMBER",  [EXT.discNumber]);
  props.replace("GENRE",       [TAG.genre]);
  props.replace("TITLE",       [TAG.title]);
  props.replace("TRACKNUMBER", [String(TAG.track)]);
  ref.setProperties(props);

  const mkv      = ref.file() as MatroskaFile;
  const chapters = mkv.chapters(true)!;
  chapters.addEdition({
    uid: 0, isDefault: true, isOrdered: false,
    chapters: [
      {
        uid: 1, isHidden: false,
        timeStart: MKV_CHAP1.startTime, timeEnd: MKV_CHAP1.endTime,
        displays: [{ string: MKV_CHAP1.title, language: "und" }],
      },
      {
        uid: 2, isHidden: false,
        timeStart: MKV_CHAP2.startTime, timeEnd: MKV_CHAP2.endTime,
        displays: [{ string: MKV_CHAP2.title, language: "und" }],
      },
    ],
  });

  await ref.save();
  return new Uint8Array((ref.file()!.stream() as ByteVectorStream).data().data);
}

// ---------------------------------------------------------------------------
// Assertion helpers for extended tags and chapters
// ---------------------------------------------------------------------------

/** Assert that a ValidatorResult contains the expected extended tag values. */
function expectExtTagsMatch(
  result: ValidatorResult,
  opts: { skipComment?: boolean } = {},
): void {
  expectTagsMatch(result, opts);
  expect(result.albumartist).toBe(EXT.albumArtist);
  expect(result.composer).toBe(EXT.composer);
  expect(result.discnumber).toBe(EXT.discNumber);
}

/**
 * Assert that taglib-ts can read the expected basic + extended tags from bytes.
 * Extended tags are checked via the PropertyMap interface.
 */
async function expectExtTSReadsOK(
  bytes: Uint8Array,
  ext: string,
  opts: { skipComment?: boolean } = {},
): Promise<void> {
  await expectTSReadsOK(bytes, ext, opts);
  const ref   = await FileRef.fromByteArray(bytes, "test" + ext);
  const props = ref.properties();
  expect(props.get("ALBUMARTIST")?.[0]).toBe(EXT.albumArtist);
  expect(props.get("COMPOSER")?.[0]).toBe(EXT.composer);
  expect(props.get("DISCNUMBER")?.[0]).toBe(EXT.discNumber);
}

/**
 * Return the ID3v2 tag from a byte array for the given audio format extension.
 * Used to inspect CHAP frames without going through the generic FileRef API.
 */
async function getId3v2TagFromBytes(bytes: Uint8Array, ext: string): Promise<Id3v2Tag | null> {
  const stream = new ByteVectorStream(bytes);
  switch (ext) {
    case ".mp3":  return (await MpegFile.open(stream)).id3v2Tag();
    case ".wav":  return (await WavFile.open(stream)).id3v2Tag;
    case ".aiff": return (await AiffFile.open(stream)).id3v2Tag;
    case ".tta":  return (await TrueAudioFile.open(stream)).id3v2Tag();
    case ".dsf":  return (await DsfFile.open(stream)).tag() as Id3v2Tag;
    case ".dff":  return (await DsdiffFile.open(stream)).id3v2Tag();
    default:      return null;
  }
}

/** Assert that an ID3v2 tag contains the two expected CHAP frames. */
function expectId3v2ChapsOk(id3: Id3v2Tag): void {
  const frames = (id3.frameListMap().get("CHAP") ?? []).map(f => f as ChapterFrame);
  frames.sort((a, b) => a.startTime - b.startTime);
  expect(frames).toHaveLength(2);

  expect(frames[0].startTime).toBe(CHAP1.startTime);
  expect(frames[0].endTime).toBe(CHAP1.endTime);
  const title0 = frames[0].embeddedFrameList
    .find(f => f.frameId.toString(StringType.Latin1) === "TIT2") as TextIdentificationFrame | undefined;
  expect(title0?.text).toBe(CHAP1.title);

  expect(frames[1].startTime).toBe(CHAP2.startTime);
  expect(frames[1].endTime).toBe(CHAP2.endTime);
  const title1 = frames[1].embeddedFrameList
    .find(f => f.frameId.toString(StringType.Latin1) === "TIT2") as TextIdentificationFrame | undefined;
  expect(title1?.text).toBe(CHAP2.title);
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
    label: "DSDIFF",
    testFile: "empty10ms.dff",
    ext: ".dff",
    format: "dff",
    hasPicture: true,
    // Byte equality: DSDIFF writes ID3v2 tags, matching C++ DSDIFF::File::save().
  },
  {
    label: "OGG FLAC",
    testFile: "empty_flac.oga",
    ext: ".oga",
    format: "oggflac",
    hasPicture: true,
    // Byte equality: XiphComment fields sorted alphabetically + pictures last.
  },
  {
    label: "Matroska",
    testFile: "no-tags.mka",
    ext: ".mka",
    format: "mkv",
    skipComment: true,
  },
];

// ---------------------------------------------------------------------------
// Extended-tag format configurations
// ---------------------------------------------------------------------------

interface FormatExtCfg extends FormatTestCfg {
  /**
   * When `true`, use {@link tagWithTSMkvExt} (all tags via one alphabetical PropertyMap)
   * instead of {@link tagWithTSExt} (setters + selective PropertyMap).
   */
  usesMkvExtTagger?: boolean;
}

const FORMATS_EXT: FormatExtCfg[] = [
  { label: "MP3",       testFile: "xing.mp3",                          ext: ".mp3",  format: "mp3-ext",     hasPicture: true },
  { label: "FLAC",      testFile: "no-tags.flac",                      ext: ".flac", format: "flac-ext",    hasPicture: true },
  { label: "OGG Vorbis",testFile: "empty.ogg",                         ext: ".ogg",  format: "ogg-ext",     hasPicture: true },
  { label: "OGG Opus",  testFile: "correctness_gain_silent_output.opus",ext: ".opus", format: "opus-ext",    hasPicture: true },
  { label: "OGG Speex", testFile: "empty.spx",                         ext: ".spx",  format: "speex-ext",   hasPicture: true, skipComment: true },
  { label: "M4A",       testFile: "no-tags.m4a",                       ext: ".m4a",  format: "m4a-ext",     hasPicture: true },
  { label: "WAV",       testFile: "empty.wav",                         ext: ".wav",  format: "wav-ext",     hasPicture: true },
  { label: "AIFF",      testFile: "empty.aiff",                        ext: ".aiff", format: "aiff-ext",    hasPicture: true },
  { label: "MPC",       testFile: "click.mpc",                         ext: ".mpc",  format: "mpc-ext",     skipAudioProps: true },
  { label: "WavPack",   testFile: "click.wv",                          ext: ".wv",   format: "wv-ext" },
  { label: "APE",       testFile: "mac-399.ape",                       ext: ".ape",  format: "ape-ext" },
  { label: "TrueAudio", testFile: "empty.tta",                         ext: ".tta",  format: "tta-ext",     hasPicture: true },
  { label: "DSF",       testFile: "empty10ms.dsf",                     ext: ".dsf",  format: "dsf-ext",     hasPicture: true },
  { label: "ASF/WMA",   testFile: "lossless.wma",                      ext: ".wma",  format: "asf-ext",     hasPicture: true },
  { label: "DSDIFF",    testFile: "empty10ms.dff",                     ext: ".dff",  format: "dff-ext",     hasPicture: true },
  { label: "OGG FLAC",  testFile: "empty_flac.oga",                    ext: ".oga",  format: "oggflac-ext", hasPicture: true },
  {
    label: "Matroska",
    testFile: "no-tags.mka",
    ext: ".mka",
    format: "mkv-ext",
    skipComment: true,
    usesMkvExtTagger: true,
  },
];

// ---------------------------------------------------------------------------
// Chapter format configurations
// ---------------------------------------------------------------------------

interface FormatChapCfg {
  label: string;
  testFile: string;
  ext: string;
  /** Format string passed to the C tagger binary. */
  format: string;
  hasPicture?: boolean;
  skipComment?: boolean;
  /** TypeScript chapter-tagger function for this format. */
  tagger: () => Promise<Uint8Array>;
}

const FORMATS_CHAP: FormatChapCfg[] = [
  { label: "MP3",         testFile: "xing.mp3",       ext: ".mp3",  format: "mp3-chap",  hasPicture: true, tagger: tagWithTSChapMp3 },
  { label: "WAV",         testFile: "empty.wav",       ext: ".wav",  format: "wav-chap",  hasPicture: true, tagger: tagWithTSChapWav },
  { label: "AIFF",        testFile: "empty.aiff",      ext: ".aiff", format: "aiff-chap", hasPicture: true, tagger: tagWithTSChapAiff },
  { label: "TrueAudio",   testFile: "empty.tta",       ext: ".tta",  format: "tta-chap",  hasPicture: true, tagger: tagWithTSChapTta },
  { label: "DSF",         testFile: "empty10ms.dsf",   ext: ".dsf",  format: "dsf-chap",  hasPicture: true, tagger: tagWithTSChapDsf },
  { label: "DSDIFF",      testFile: "empty10ms.dff",   ext: ".dff",  format: "dff-chap",  hasPicture: true, tagger: tagWithTSChapDsdiff },
  { label: "M4A (Nero)",  testFile: "no-tags.m4a",     ext: ".m4a",  format: "m4a-nero",  hasPicture: true, tagger: tagWithTSChapMp4Nero },
  { label: "M4A (QT)",    testFile: "no-tags.m4a",     ext: ".m4a",  format: "m4a-qt",    hasPicture: true, tagger: tagWithTSChapMp4Qt },
  {
    label: "Matroska",
    testFile: "no-tags.mka",
    ext: ".mka",
    format: "mkv-chap",
    skipComment: true,
    tagger: tagWithTSChapMkv,
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
// Extended tags: C TagLib → taglib-ts reads
// ---------------------------------------------------------------------------

describeIfC("Extended tags: C TagLib → taglib-ts reads", () => {
  for (const cfg of FORMATS_EXT) {
    it(`${cfg.label}: taglib-ts reads extended tags written by C TagLib`, async () => {
      const cBytes = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      await expectExtTSReadsOK(cBytes, cfg.ext, cfg);
    });
  }
});

// ---------------------------------------------------------------------------
// Extended tags: taglib-ts → C TagLib validates
// ---------------------------------------------------------------------------

describeIfC("Extended tags: taglib-ts → C TagLib validates", () => {
  for (const cfg of FORMATS_EXT) {
    it(`${cfg.label}: C TagLib reads extended tags written by taglib-ts`, async () => {
      const tsBytes = cfg.usesMkvExtTagger
        ? await tagWithTSMkvExt(cfg.testFile, cfg.ext)
        : await tagWithTSExt(cfg.testFile, cfg.ext, { picture: cfg.hasPicture });
      const result = validateWithC(tsBytes, cfg.ext);
      expectExtTagsMatch(result, cfg);
    });
  }
});

// ---------------------------------------------------------------------------
// Extended tag byte equality
// ---------------------------------------------------------------------------

describeIfC("Extended tag byte equality: taglib-ts output matches C TagLib output", () => {
  for (const cfg of FORMATS_EXT) {
    if (cfg.skipByteEquality) {
      it.skip(`${cfg.label}: extended-tag byte equality (skipped – known implementation differences)`, () => { /* skip */ });
      continue;
    }
    it(`${cfg.label}: byte-for-byte identical extended-tag output`, async () => {
      const cBytes  = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      const tsBytes = cfg.usesMkvExtTagger
        ? await tagWithTSMkvExt(cfg.testFile, cfg.ext)
        : await tagWithTSExt(cfg.testFile, cfg.ext, { picture: cfg.hasPicture });
      expect(tsBytes.length).toBe(cBytes.length);
      expect(Buffer.from(tsBytes).equals(Buffer.from(cBytes))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Chapters: C TagLib → taglib-ts reads
// ---------------------------------------------------------------------------

describeIfC("Chapters: C TagLib → taglib-ts reads", () => {
  for (const cfg of FORMATS_CHAP) {
    it(`${cfg.label}: taglib-ts reads chapters written by C TagLib`, async () => {
      // TypeScript-only test (no C++ counterpart; verifies TS chapter read)
      const cBytes = tagWithC(cfg.testFile, cfg.ext, cfg.format);

      if (cfg.ext === ".mka") {
        // Matroska: read chapters via MatroskaFile.chapters()
        const stream = new ByteVectorStream(cBytes);
        const f      = await MatroskaFile.open(stream);
        const chaps  = f.chapters();
        expect(chaps).not.toBeNull();
        expect(chaps!.editions).toHaveLength(1);
        const ed = chaps!.editions[0];
        expect(ed.chapters).toHaveLength(2);
        const sorted = [...ed.chapters].sort((a, b) => a.timeStart - b.timeStart);
        expect(sorted[0].timeStart).toBe(MKV_CHAP1.startTime);
        expect(sorted[0].timeEnd).toBe(MKV_CHAP1.endTime);
        expect(sorted[0].displays[0]?.string).toBe(MKV_CHAP1.title);
        expect(sorted[1].timeStart).toBe(MKV_CHAP2.startTime);
        expect(sorted[1].timeEnd).toBe(MKV_CHAP2.endTime);
        expect(sorted[1].displays[0]?.string).toBe(MKV_CHAP2.title);
      } else if (cfg.ext === ".m4a" && cfg.format === "m4a-nero") {
        // MP4 Nero chapters
        const stream = new ByteVectorStream(cBytes);
        const f      = await Mp4File.open(stream);
        const chaps  = await f.neroChapters();
        expect(chaps).toHaveLength(2);
        const sorted = [...chaps].sort((a, b) => a.startTime - b.startTime);
        expect(sorted[0].startTime).toBe(CHAP1.startTime);
        expect(sorted[0].title).toBe(CHAP1.title);
        expect(sorted[1].startTime).toBe(CHAP2.startTime);
        expect(sorted[1].title).toBe(CHAP2.title);
      } else if (cfg.ext === ".m4a" && cfg.format === "m4a-qt") {
        // MP4 QT chapters
        const stream = new ByteVectorStream(cBytes);
        const f      = await Mp4File.open(stream);
        const chaps  = await f.qtChapters();
        expect(chaps).toHaveLength(2);
        const sorted = [...chaps].sort((a, b) => a.startTime - b.startTime);
        expect(sorted[0].startTime).toBe(CHAP1.startTime);
        expect(sorted[0].title).toBe(CHAP1.title);
        expect(sorted[1].startTime).toBe(CHAP2.startTime);
        expect(sorted[1].title).toBe(CHAP2.title);
      } else {
        // ID3v2-based chapter formats
        const id3 = await getId3v2TagFromBytes(cBytes, cfg.ext);
        expect(id3).not.toBeNull();
        expectId3v2ChapsOk(id3!);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Chapters: taglib-ts → C TagLib validates
// ---------------------------------------------------------------------------

describeIfC("Chapters: taglib-ts → C TagLib validates", () => {
  for (const cfg of FORMATS_CHAP) {
    it(`${cfg.label}: C TagLib reads chapters written by taglib-ts`, async () => {
      const tsBytes = await cfg.tagger();
      const result  = validateWithC(tsBytes, cfg.ext);

      expectTagsMatch(result, cfg);
      expect(result.albumartist).toBe(EXT.albumArtist);
      expect(result.composer).toBe(EXT.composer);
      expect(result.discnumber).toBe(EXT.discNumber);

      if (cfg.ext === ".mka") {
        expect(result.matroskaChapters).toBeDefined();
        const mChaps = result.matroskaChapters!;
        expect(mChaps).toHaveLength(2);
        const sorted = [...mChaps].sort((a, b) => a.startTime - b.startTime);
        expect(sorted[0].title).toBe(MKV_CHAP1.title);
        expect(sorted[0].startTime).toBe(MKV_CHAP1.startTime);
        expect(sorted[0].endTime).toBe(MKV_CHAP1.endTime);
        expect(sorted[1].title).toBe(MKV_CHAP2.title);
        expect(sorted[1].startTime).toBe(MKV_CHAP2.startTime);
        expect(sorted[1].endTime).toBe(MKV_CHAP2.endTime);
      } else if (cfg.format === "m4a-nero") {
        expect(result.neroChapters).toBeDefined();
        const nChaps = result.neroChapters!;
        expect(nChaps).toHaveLength(2);
        const sorted = [...nChaps].sort((a, b) => a.startTime - b.startTime);
        expect(sorted[0].title).toBe(CHAP1.title);
        expect(sorted[0].startTime).toBe(CHAP1.startTime);
        expect(sorted[1].title).toBe(CHAP2.title);
        expect(sorted[1].startTime).toBe(CHAP2.startTime);
      } else if (cfg.format === "m4a-qt") {
        expect(result.qtChapters).toBeDefined();
        const qChaps = result.qtChapters!;
        expect(qChaps).toHaveLength(2);
        const sorted = [...qChaps].sort((a, b) => a.startTime - b.startTime);
        expect(sorted[0].title).toBe(CHAP1.title);
        expect(sorted[0].startTime).toBe(CHAP1.startTime);
        expect(sorted[1].title).toBe(CHAP2.title);
        expect(sorted[1].startTime).toBe(CHAP2.startTime);
      } else {
        // ID3v2 chapter formats
        expect(result.id3v2Chapters).toBeDefined();
        const i2Chaps = result.id3v2Chapters!;
        expect(i2Chaps).toHaveLength(2);
        const sorted = [...i2Chaps].sort((a, b) => a.startTime - b.startTime);
        expect(sorted[0].title).toBe(CHAP1.title);
        expect(sorted[0].startTime).toBe(CHAP1.startTime);
        expect(sorted[0].endTime).toBe(CHAP1.endTime);
        expect(sorted[1].title).toBe(CHAP2.title);
        expect(sorted[1].startTime).toBe(CHAP2.startTime);
        expect(sorted[1].endTime).toBe(CHAP2.endTime);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Chapter byte equality
// ---------------------------------------------------------------------------

describeIfC("Chapter byte equality: taglib-ts output matches C TagLib output", () => {
  for (const cfg of FORMATS_CHAP) {
    it(`${cfg.label}: byte-for-byte identical chapter output`, async () => {
      const cBytes  = tagWithC(cfg.testFile, cfg.ext, cfg.format);
      const tsBytes = await cfg.tagger();
      expect(tsBytes.length).toBe(cBytes.length);
      expect(Buffer.from(tsBytes).equals(Buffer.from(cBytes))).toBe(true);
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
    expect(headerPageCount).toBeGreaterThanOrEqual(2);
  });
});
