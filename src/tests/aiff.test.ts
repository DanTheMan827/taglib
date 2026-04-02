import { describe, expect, it } from "vitest";
import { openTestStream, readTestData, reuseTestStream } from "./testHelper.js";
import { AiffFile } from "../riff/aiff/aiffFile";
import { ReadStyle } from "../toolkit/types";
import { ByteVector } from "../byteVector.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";

describe("AIFF", () => {
  it("should test aiff properties", async () => {
    // TypeScript-only test
    const stream = openTestStream("empty.aiff");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(0);
    expect(props?.lengthInMilliseconds).toBe(67);
    expect(props?.bitrate).toBe(706);
    expect(props?.sampleRate).toBe(44100);
    expect(props?.channels).toBe(1);
    expect(props?.bitsPerSample).toBe(16);
    expect(props?.sampleFrames).toBe(2941);
    expect(props?.isAifc).toBe(false);
  });

  it("should test aiffc properties", async () => {
    // TypeScript-only test
    const stream = openTestStream("alaw.aifc");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(0);
    expect(props?.lengthInMilliseconds).toBe(37);
    expect(props?.bitrate).toBe(355);
    expect(props?.sampleRate).toBe(44100);
    expect(props?.channels).toBe(1);
    expect(props?.bitsPerSample).toBe(16);
    expect(props?.sampleFrames).toBe(1622);
    expect(props?.isAifc).toBe(true);
    expect(props?.compressionType).toBe("ALAW");
    expect(props?.compressionName).toBe("SGI CCITT G.711 A-law");
  });

  it("should test saving ID3v2 tag", async () => {
    // TypeScript-only test
    const stream = openTestStream("empty.aiff");
    await reuseTestStream(stream, async () => {
      const f = await AiffFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.id3v2Tag?.isEmpty).toBe(true);
      f.tag()!.title = "TitleXXX";
      await f.save();
      expect(f.id3v2Tag?.isEmpty).toBe(false);
    });

    await reuseTestStream(stream, async () => {
      const f = await AiffFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.id3v2Tag?.isEmpty).toBe(false);
      expect(f.tag()?.title).toBe("TitleXXX");
      f.tag()!.title = "";
      await f.save();
      expect(f.id3v2Tag?.isEmpty).toBe(true);
    });

    await reuseTestStream(stream, async () => {
      const f = await AiffFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.id3v2Tag?.isEmpty).toBe(true);
    });
  });

  it("should test saving ID3v2 v3 tag", async () => {
    // TypeScript-only test
    const stream = openTestStream("empty.aiff");
    const xxx = "X".repeat(254);

    await reuseTestStream(stream, async () => {
      const f = await AiffFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      f.tag()!.title = xxx;
      f.tag()!.artist = "Artist A";
      await f.save(3);
    });

    await reuseTestStream(stream, async () => {
      const f = await AiffFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()).toBeInstanceOf(Id3v2Tag);
      const tag = f.tag() as Id3v2Tag;
      expect(tag.header.majorVersion).toBe(3);
      expect(tag.artist).toBe("Artist A");
      expect(tag.title).toBe(xxx);
    });
  });

  it("should handle duplicate ID3v2 tags", async () => {
    // TypeScript-only test
    const stream = openTestStream("duplicate_id3v2.aiff");

    // duplicate_id3v2.aiff has duplicate ID3v2 tag chunks.
    // title() returns "Title2" if can't skip the second tag.
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.tag()?.isEmpty).toBe(false);
    expect(f.tag()?.title).toBe("Title1");
    await f.save();

    expect(await f.fileLength()).toBe(7030);
    expect(await f.find(ByteVector.fromString("Title2"))).toBe(-1);
  });

  it("should handle segfault aif", async () => {
    // TypeScript-only test
    const stream = openTestStream("segfault.aif");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
    expect(f.isValid).toBe(true);
  });

  it("should handle excessive alloc aif", async () => {
    // TypeScript-only test
    const stream = openTestStream("excessive_alloc.aif");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
    expect(f.isValid).toBe(true);
  });

  it("should read noise aif file", async () => {
    // TypeScript-only test
    const stream = openTestStream("noise.aif");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should read noise_odd aif file", async () => {
    // TypeScript-only test
    const stream = openTestStream("noise_odd.aif");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should read duplicate_id3v2 aiff file", async () => {
    // TypeScript-only test
    const stream = openTestStream("duplicate_id3v2.aiff");
    const f = await AiffFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });
});
