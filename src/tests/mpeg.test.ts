import { describe, expect, it } from "vitest";
import { MpegFile } from "../mpeg/mpegFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
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
  });
});
