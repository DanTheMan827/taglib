import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { FileRef } from "../fileRef.js";
import { MatroskaFile } from "../matroska/matroskaFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream } from "./testHelper.js";

const TEST_DATA_DIR = resolve(import.meta.dirname ?? __dirname, "data");

async function openMatroskaFile(
  filename: string,
  readProperties = true,
  readStyle = ReadStyle.Average,
): Promise<MatroskaFile> {
  const stream = openTestStream(filename);
  return await MatroskaFile.open(stream, readProperties, readStyle);
}

describe("Matroska", () => {
  describe("Properties", () => {
    it("should read MKA properties", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("no-tags.mka");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.lengthInSeconds).toBe(0);
      expect(props!.lengthInMilliseconds).toBe(444);
      expect(props!.bitrate).toBe(223);
      expect(props!.channels).toBe(2);
      expect(props!.sampleRate).toBe(44100);
      expect(props!.docType).toBe("matroska");
      expect(props!.docTypeVersion).toBe(4);
      expect(props!.codecName).toBe("A_MPEG/L3");
      expect(props!.title).toBe("");
    });

    it("should read MKV properties", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("tags-before-cues.mkv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.lengthInSeconds).toBe(0);
      expect(props!.lengthInMilliseconds).toBe(120);
      expect(props!.bitrate).toBe(227);
      expect(props!.channels).toBe(0);
      expect(props!.sampleRate).toBe(0);
      expect(props!.docType).toBe("matroska");
      expect(props!.docTypeVersion).toBe(4);
      expect(props!.codecName).toBe("");
      expect(props!.title).toBe("handbrake");
    });

    it("should read WebM properties", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("no-tags.webm");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.lengthInSeconds).toBe(0);
      expect(props!.lengthInMilliseconds).toBe(1);
      expect(props!.bitrate).toBe(2816);
      expect(props!.channels).toBe(0);
      expect(props!.sampleRate).toBe(0);
      expect(props!.docType).toBe("webm");
      expect(props!.docTypeVersion).toBe(4);
      expect(props!.codecName).toBe("");
      expect(props!.title).toBe("");
    });

    it("should not read properties when readProperties=false", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("no-tags.webm", false);
      expect(f.isValid).toBe(true);
      expect(f.audioProperties()).toBeNull();
    });
  });

  describe("Tags", () => {
    it("should read tags from MKV", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("tags-before-cues.mkv");
      expect(f.isValid).toBe(true);
      // tags-before-cues.mkv has a TITLE tag added by Handbrake
      expect(f.tag()).not.toBeNull();
      expect(f.tag()!.title).toBe("handbrake");
    });

    it("should handle file with no tags", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("no-tags.mka");
      // No tags element in the file - always returns an empty tag
      const tag = f.tag();
      expect(tag).not.toBeNull();
      expect(tag!.isEmpty).toBe(true);
    });

    it("should support PropertyMap interface", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("tags-before-cues.mkv");
      // The file should be readable and produce a PropertyMap
      const props = f.properties();
      expect(props).toBeTruthy();
    });
  });

  describe("Save and re-read", () => {
    it("should save and re-read tags for MKA (no existing tags)", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("no-tags.mka");
      expect(f.isValid).toBe(true);

      const tag = f.tag()!;
      tag.title = "Test Title";
      tag.artist = "Test Artist";
      tag.album = "Test Album";
      tag.year = 2024;
      tag.track = 5;
      tag.comment = "Test Comment";
      tag.genre = "Electronic";

      expect(await f.save()).toBe(true);

      const modified = (f.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(modified));
      expect(f2.isValid).toBe(true);
      const tag2 = f2.tag()!;
      expect(tag2.title).toBe("Test Title");
      expect(tag2.artist).toBe("Test Artist");
      expect(tag2.album).toBe("Test Album");
      expect(tag2.year).toBe(2024);
      expect(tag2.track).toBe(5);
      expect(tag2.comment).toBe("Test Comment");
      expect(tag2.genre).toBe("Electronic");
    });
  });

  describe("FileRef integration", () => {
    it("should detect MKA by extension", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "no-tags.mka"));
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mka");
      expect(ref.isValid).toBe(true);
      expect(ref.audioProperties()).toBeTruthy();
      expect(ref.audioProperties()!.lengthInMilliseconds).toBe(444);
    });

    it("should detect MKV by extension", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "tags-before-cues.mkv"));
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mkv");
      expect(ref.isValid).toBe(true);
    });

    it("should detect WebM by extension", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "no-tags.webm"));
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.webm");
      expect(ref.isValid).toBe(true);
    });

    it("should detect Matroska by content", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "no-tags.mka"));
      // Pass no extension so it falls through to content detection
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.unknown");
      expect(ref.isValid).toBe(true);
      expect(ref.audioProperties()!.lengthInMilliseconds).toBe(444);
    });
  });

  describe("Tag title fallback", () => {
    it("should use segment title when no TITLE tag present", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("tags-before-cues.mkv");
      // MKV with "handbrake" as segment title
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.title).toBe("handbrake");
    });
  });
});
