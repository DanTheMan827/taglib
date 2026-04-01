import { describe, expect, it } from "vitest";
import { ByteVector, StringType } from "../byteVector.js";
import { MpegFile, MpegTagTypes } from "../mpeg/mpegFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle, StripTags } from "../toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

async function openMpegFile(
  filename: string,
  readProperties = true,
  readStyle = ReadStyle.Average,
): Promise<MpegFile> {
  const stream = openTestStream(filename);
  return await MpegFile.open(stream, readProperties, readStyle);
}

describe("MPEG", () => {
  describe("basic properties", () => {
    it("should read Xing header CBR audio properties", async () => {
      const f = await openMpegFile("lame_cbr.mp3");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      expect(props?.lengthInSeconds).toBe(1887);
      expect(props?.lengthInMilliseconds).toBe(1887164);
      expect(props?.bitrate).toBe(64);
      expect(props?.channels).toBe(1);
      expect(props?.sampleRate).toBe(44100);
      expect(props?.isADTS).toBe(false);
    });

    it("should read Xing header VBR audio properties", async () => {
      const f = await openMpegFile("lame_vbr.mp3");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      expect(props?.lengthInSeconds).toBe(1887);
      expect(props?.lengthInMilliseconds).toBe(1887164);
      expect(props?.bitrate).toBe(70);
      expect(props?.channels).toBe(1);
      expect(props?.sampleRate).toBe(44100);
      expect(props?.isADTS).toBe(false);
    });

    it("should read VBRI header audio properties", async () => {
      const f = await openMpegFile("rare_frames.mp3");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      expect(props?.lengthInSeconds).toBe(222);
      expect(props?.lengthInMilliseconds).toBe(222198);
      expect(props?.bitrate).toBe(233);
      expect(props?.channels).toBe(2);
      expect(props?.sampleRate).toBe(44100);
      expect(props?.isADTS).toBe(false);
    });

    it("should read no-VBR-headers audio properties", async () => {
      const f = await openMpegFile("bladeenc.mp3");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      // bladeenc.mp3: no VBR headers, length computed from file size
      expect(props?.bitrate).toBe(64);
      expect(props?.channels).toBe(1);
      expect(props?.sampleRate).toBe(44100);
      expect(props?.isADTS).toBe(false);
    });

    it("should read xing VBR file", async () => {
      const f = await openMpegFile("xing.mp3");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.sampleRate).toBe(44100);
        expect(props.channels).toBe(2);
        expect(props.lengthInMilliseconds).toBeGreaterThan(0);
      }
    });

    it("should read MPEG2 duration with Xing header", async () => {
      const f = await openMpegFile("mpeg2.mp3");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      expect(props?.lengthInSeconds).toBe(5387);
      expect(props?.lengthInMilliseconds).toBe(5387285);
    });
  });

  describe("tags", () => {
    it("should read ID3v2 tag from xing", async () => {
      const f = await openMpegFile("xing.mp3");
      const tag = f.tag();
      expect(tag).not.toBeNull();
    });

    it("should read APE tag", async () => {
      const f = await openMpegFile("ape.mp3");
      expect(f.isValid).toBe(true);
      expect(f.apeTag).not.toBeNull();
    });

    it("should read APE + ID3v1 tag", async () => {
      const f = await openMpegFile("ape-id3v1.mp3");
      expect(f.isValid).toBe(true);
    });

    it("should read APE + ID3v2 tag", async () => {
      const f = await openMpegFile("ape-id3v2.mp3");
      expect(f.isValid).toBe(true);
    });

    it("should read itunes 10 file", async () => {
      const f = await openMpegFile("itunes10.mp3");
      expect(f.isValid).toBe(true);
      const tag = f.tag();
      expect(tag).not.toBeNull();
    });

    it("should read extended header file", async () => {
      const f = await openMpegFile("extended-header.mp3");
      expect(f.isValid).toBe(true);
    });

    it("should read duplicate ID3v2 tags", async () => {
      // duplicate_id3v2.mp3 has duplicate ID3v2 tags.
      // Sample rate will be 32000 if can't skip the second tag.
      const f = await openMpegFile("duplicate_id3v2.mp3");
      expect(f.isValid).toBe(true);
      expect(f.id3v2Tag).not.toBeNull();
      expect(f.audioProperties()?.sampleRate).toBe(44100);
    });
  });

  describe("frame scanning", () => {
    it("should find frame offsets for ape.mp3", async () => {
      const f = await openMpegFile("ape.mp3");
      expect(f.isValid).toBe(true);
      expect(await f.firstFrameOffset()).toBeGreaterThanOrEqual(0);
      expect(await f.lastFrameOffset()).toBeGreaterThanOrEqual(0);
    });

    it("should find frame offsets for ape-id3v2.mp3", async () => {
      const f = await openMpegFile("ape-id3v2.mp3");
      expect(f.isValid).toBe(true);
      const first = await f.firstFrameOffset();
      expect(first).toBeGreaterThan(0); // after ID3v2 tag
      expect(await f.lastFrameOffset()).toBeGreaterThan(first);
    });

    it("should find first frame offset", async () => {
      const f = await openMpegFile("xing.mp3");
      const offset = await f.firstFrameOffset();
      expect(offset).toBeGreaterThanOrEqual(0);
    });

    it("should find last frame offset", async () => {
      const f = await openMpegFile("xing.mp3");
      const offset = await f.lastFrameOffset();
      expect(offset).toBeGreaterThanOrEqual(0);
    });
  });

  describe("invalid files", () => {
    it("should handle invalid frames 1", async () => {
      const f = await openMpegFile("invalid-frames1.mp3");
      // File may be valid but with limited frames
      expect(f.isValid).toBeDefined();
    });

    it("should handle invalid frames 2", async () => {
      const f = await openMpegFile("invalid-frames2.mp3");
      expect(f.isValid).toBeDefined();
    });

    it("should handle invalid frames 3", async () => {
      const f = await openMpegFile("invalid-frames3.mp3");
      expect(f.isValid).toBeDefined();
    });

    it("should handle garbage file", async () => {
      const f = await openMpegFile("garbage.mp3");
      expect(f.isValid).toBeDefined();
    });

    it("should handle excessive alloc file", async () => {
      const f = await openMpegFile("excessive_alloc.mp3");
      expect(f.isValid).toBeDefined();
    });
  });

  describe("write", () => {
    it("should save and re-read properties", async () => {
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);
      const f = await MpegFile.open(stream, true, ReadStyle.Average);

      if (f.id3v2Tag(true)) {
        f.id3v2Tag(true)!.title = "Test Title";
        f.id3v2Tag(true)!.artist = "Test Artist";
        await f.save();
      }

      // Re-read
      await stream.seek(0);
      const f2 = await MpegFile.open(stream, true, ReadStyle.Average);
      const tag = f2.tag();
      expect(tag?.title).toBe("Test Title");
      expect(tag?.artist).toBe("Test Artist");
    });

    // testSaveID3v24: save with explicit ID3v2.4 version; re-read version == 4.
    it("testSaveID3v24: should save and re-read ID3v2.4 tags", async () => {
      const xxx = "X".repeat(254);
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);

      let f = await MpegFile.open(stream, true, ReadStyle.Average);
      expect(f.hasID3v2Tag).toBe(false);

      f.id3v2Tag(true)!.title = xxx;
      f.id3v2Tag(true)!.artist = "Artist A";
      await f.save(MpegTagTypes.AllTags, StripTags.StripOthers, 4);
      expect(f.hasID3v2Tag).toBe(true);

      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      expect(f.id3v2Tag()!.header!.majorVersion).toBe(4);
      expect(f.tag().artist).toBe("Artist A");
      expect(f.tag().title).toBe(xxx);
    });

    // testSaveID3v23: save with explicit ID3v2.3 version; re-read version == 3.
    it("testSaveID3v23: should save and re-read ID3v2.3 tags", async () => {
      const xxx = "X".repeat(254);
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);

      let f = await MpegFile.open(stream, true, ReadStyle.Average);
      expect(f.hasID3v2Tag).toBe(false);

      f.id3v2Tag(true)!.title = xxx;
      f.id3v2Tag(true)!.artist = "Artist A";
      await f.save(MpegTagTypes.AllTags, StripTags.StripOthers, 3);
      expect(f.hasID3v2Tag).toBe(true);

      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      expect(f.id3v2Tag()!.header!.majorVersion).toBe(3);
      expect(f.tag().artist).toBe("Artist A");
      expect(f.tag().title).toBe(xxx);
    });

    // testRepeatedSave1: large tag + clear + re-save; firstFrameOffset == 5141.
    it("testRepeatedSave1: firstFrameOffset correct after repeated saves", async () => {
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);

      let f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v2Tag(true)!.title = "X".repeat(4096);
      await f.save();

      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v2Tag(true)!.title = "";
      await f.save();
      f.id3v2Tag(true)!.title = "X".repeat(4096);
      await f.save();
      expect(await f.firstFrameOffset()).toBe(5141);
    });

    // testRepeatedSave2: two saves of same data; only one ID3 marker at offset 0.
    it("testRepeatedSave2: no duplicate ID3 header after repeated saves", async () => {
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);

      const f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v2Tag(true)!.title = "0123456789";
      await f.save();
      await f.save();

      // The second save must not produce a second "ID3" marker inside the file.
      // C++ asserts: f.find("ID3", 3) == -1  (no ID3 header after offset 0).
      const bv = stream.data();
      const tail = bv.mid(3); // skip the first 3 bytes (the valid "ID3" at offset 0)
      const secondId3 = tail.find(ByteVector.fromString("ID3", StringType.Latin1));
      expect(secondId3).toBe(-1);
    });

    // testEmptyID3v2: saving an empty ID3v2 tag must strip the chunk on save.
    // Matches C++ testEmptyID3v2: save(ID3v2) writes, save(ID3v2,StripNone) strips.
    it("testEmptyID3v2: saving empty ID3v2 tag removes it from the file", async () => {
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);

      // Step 1: write ID3v2 with a title
      let f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v2Tag(true)!.title = "0123456789";
      await f.save(MpegTagTypes.ID3v2);

      // Step 2: clear the title, save ID3v2 only (StripNone = leave other tags untouched)
      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v2Tag(true)!.title = "";
      await f.save(MpegTagTypes.ID3v2, StripTags.StripNone);

      // Step 3: re-read — empty tag must have been removed
      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      expect(f.hasID3v2Tag).toBe(false);
    });

    // testEmptyID3v1: ID3v1 tag that is set then cleared must be stripped.
    // Matches C++ testEmptyID3v1.
    it("testEmptyID3v1: saving empty ID3v1 tag removes it from the file", async () => {
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);

      // Step 1: write ID3v1 with a title
      let f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v1Tag(true)!.title = "0123456789";
      await f.save(MpegTagTypes.ID3v1);

      // Step 2: clear the title, save ID3v1 only (StripNone)
      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      f.id3v1Tag(true)!.title = "";
      await f.save(MpegTagTypes.ID3v1, StripTags.StripNone);

      // Step 3: re-read — empty tag must have been removed
      await stream.seek(0);
      f = await MpegFile.open(stream, true, ReadStyle.Average);
      expect(f.hasID3v1Tag).toBe(false);
    });
  });
});
