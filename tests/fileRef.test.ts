/**
 * FileRef test — ported from test_fileref.cpp
 * Tests save/re-read cycle via FileRef for all supported formats.
 */
import { describe, it, expect } from "vitest";
import { FileRef } from "../src/fileRef.js";
import { readTestData } from "./testHelper.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";

/**
 * Shared save/re-read cycle test.
 * Writes tags, saves, re-reads and verifies values, then updates again.
 */
async function fileRefSave(filename: string, ext: string): Promise<void> {
  const data = readTestData(filename + ext);

  // --- First round: write via FileRef from byte array ---
  let ref = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
  expect(ref.isNull).toBe(false);
  expect(ref.isValid).toBe(true);

  const tag = ref.tag();
  expect(tag).not.toBeNull();

  tag!.title = "test title";
  tag!.artist = "test artist";
  tag!.genre = "Test!";
  tag!.album = "albummmm";
  tag!.comment = "a comment";
  tag!.track = 5;
  tag!.year = 2020;
  ref.save();

  // Capture modified bytes
  const stream1 = ref.file()!.stream() as ByteVectorStream;
  const modified1 = stream1.data().data;

  // --- Re-read from modified bytes ---
  ref = await FileRef.fromByteArray(new Uint8Array(modified1), "test" + ext);
  expect(ref.isNull).toBe(false);
  const tag2 = ref.tag()!;
  expect(tag2.title).toBe("test title");
  expect(tag2.artist).toBe("test artist");
  expect(tag2.genre).toBe("Test!");
  expect(tag2.album).toBe("albummmm");
  expect(tag2.comment).toBe("a comment");
  expect(tag2.track).toBe(5);
  expect(tag2.year).toBe(2020);

  // --- Second round: update values ---
  tag2.title = "ytest title";
  tag2.artist = "ttest artist";
  tag2.genre = "uTest!";
  tag2.album = "ialbummmm";
  tag2.comment = "another comment";
  tag2.track = 7;
  tag2.year = 2080;
  ref.save();

  const stream2 = ref.file()!.stream() as ByteVectorStream;
  const modified2 = stream2.data().data;

  // --- Verify second round ---
  ref = await FileRef.fromByteArray(new Uint8Array(modified2), "test" + ext);
  expect(ref.isNull).toBe(false);
  const tag3 = ref.tag()!;
  expect(tag3.title).toBe("ytest title");
  expect(tag3.artist).toBe("ttest artist");
  expect(tag3.genre).toBe("uTest!");
  expect(tag3.album).toBe("ialbummmm");
  expect(tag3.comment).toBe("another comment");
  expect(tag3.track).toBe(7);
  expect(tag3.year).toBe(2080);
}

describe("FileRef", () => {
  it("should save and re-read MP3", async () => {
    await fileRefSave("xing", ".mp3");
  });

  it("should save and re-read FLAC", async () => {
    await fileRefSave("no-tags", ".flac");
  });

  it("should save and re-read OGG Vorbis", async () => {
    await fileRefSave("empty", ".ogg");
  });

  it("should save and re-read Speex", async () => {
    await fileRefSave("empty", ".spx");
  });

  it("should save and re-read MP4 (has-tags)", async () => {
    await fileRefSave("has-tags", ".m4a");
  });

  it("should save and re-read MP4 (no-tags)", async () => {
    await fileRefSave("no-tags", ".m4a");
  });

  it("should save and re-read WAV", async () => {
    await fileRefSave("empty", ".wav");
  });

  it("should save and re-read AIFF", async () => {
    await fileRefSave("empty", ".aiff");
  });

  it("should save and re-read TrueAudio", async () => {
    await fileRefSave("empty", ".tta");
  });

  it("should save and re-read MPC", async () => {
    await fileRefSave("click", ".mpc");
  });

  it("should save and re-read WavPack", async () => {
    await fileRefSave("click", ".wv");
  });

  it("should save and re-read APE", async () => {
    await fileRefSave("mac-399", ".ape");
  });

  it("should save and re-read Opus", async () => {
    await fileRefSave("correctness_gain_silent_output", ".opus");
  });

  it("should save and re-read DSF", async () => {
    await fileRefSave("empty10ms", ".dsf");
  });

  it("should save and re-read DSDIFF", async () => {
    await fileRefSave("empty10ms", ".dff");
  });

  it("should save and re-read ASF", async () => {
    await fileRefSave("silence-1", ".wma");
  });

  it("should save and re-read Matroska (MKA)", async () => {
    await fileRefSave("no-tags", ".mka");
  });

  it("should save and re-read OGG FLAC", async () => {
    await fileRefSave("empty_flac", ".oga");
  });

  // Tracker formats only support title (and optionally comment) — artist, album,
  // genre, year, track are silently ignored by the format.
  async function fileRefSaveTrackerTitle(filename: string, ext: string): Promise<void> {
    const data = readTestData(filename + ext);

    let ref = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
    expect(ref.isNull).toBe(false);
    expect(ref.isValid).toBe(true);

    const tag = ref.tag();
    expect(tag).not.toBeNull();
    tag!.title = "tracker title";
    ref.save();

    const stream1 = ref.file()!.stream() as ByteVectorStream;
    const modified1 = stream1.data().data;

    ref = await FileRef.fromByteArray(new Uint8Array(modified1), "test" + ext);
    expect(ref.isNull).toBe(false);
    expect(ref.tag()!.title).toBe("tracker title");

    ref.tag()!.title = "updated title";
    ref.save();

    const stream2 = ref.file()!.stream() as ByteVectorStream;
    const modified2 = stream2.data().data;

    ref = await FileRef.fromByteArray(new Uint8Array(modified2), "test" + ext);
    expect(ref.isNull).toBe(false);
    expect(ref.tag()!.title).toBe("updated title");
  }

  it("should save and re-read MOD", async () => {
    await fileRefSaveTrackerTitle("test", ".mod");
  });

  it("should save and re-read S3M", async () => {
    await fileRefSaveTrackerTitle("test", ".s3m");
  });

  it("should save and re-read XM", async () => {
    await fileRefSaveTrackerTitle("test", ".xm");
  });

  it("should save and re-read IT", async () => {
    await fileRefSaveTrackerTitle("test", ".it");
  });

  it("should open Shorten (read-only) without error", async () => {
    const data = readTestData("2sec-silence.shn");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.shn");
    expect(ref.isNull).toBe(false);
    expect(ref.isValid).toBe(true);
    expect(ref.tag()).not.toBeNull();
    // Shorten is read-only — save() returns false
    expect(ref.save()).toBe(false);
  });

  it("should return null for unsupported files", async () => {
    const ref = await FileRef.fromByteArray(new Uint8Array([0, 1, 2, 3]), "unsupported.xx");
    expect(ref.isNull).toBe(true);
  });

  it("should read audio properties via FileRef", async () => {
    const data = readTestData("xing.mp3");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mp3");
    expect(ref.isNull).toBe(false);
    const props = ref.audioProperties();
    expect(props).not.toBeNull();
    expect(props!.lengthInSeconds).toBe(2);
    expect(props!.lengthInMilliseconds).toBeGreaterThan(2000);
    expect(props!.lengthInMilliseconds).toBeLessThan(2100);
  });

  it("should list default file extensions", () => {
    const exts = FileRef.defaultFileExtensions();
    expect(exts).toContain("mp3");
    expect(exts).toContain("flac");
    expect(exts).toContain("ogg");
    expect(exts).toContain("m4a");
    expect(exts).toContain("wav");
    expect(exts).toContain("aiff");
    expect(exts).toContain("mpc");
    expect(exts).toContain("wv");
    expect(exts).toContain("ape");
    expect(exts).toContain("tta");
    expect(exts).toContain("dsf");
    expect(exts).toContain("dff");
    expect(exts).toContain("opus");
    expect(exts).toContain("spx");
    expect(exts).toContain("wma");
    expect(exts).toContain("mkv");
    expect(exts).toContain("mka");
    expect(exts).toContain("webm");
    expect(exts).toContain("xm");
    expect(exts).toContain("shn");
  });
});
