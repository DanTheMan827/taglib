import { describe, expect, it } from "vitest";
import { OggOpusFile } from "../ogg/opus/opusFile.js";
import { OggSpeexFile } from "../ogg/speex/speexFile.js";
import { OggVorbisFile } from "../ogg/vorbis/vorbisFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

/** Build a reproducible ASCII string of exactly `length` characters (matches C++ `longText`). */
function longText(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
  let t = "";
  for (let i = 0; i < length; i++) t += chars[i % chars.length];
  return t;
}

describe("OGG Vorbis", () => {
  it("should read audio properties", async () => {
    // TypeScript-only test
    const stream = openTestStream("empty.ogg");
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(3);
    expect(props?.lengthInMilliseconds).toBe(3685);
    expect(props?.bitrate).toBe(1);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(44100);
    expect(props?.vorbisVersion).toBe(0);
    expect(props?.bitrateMaximum).toBe(0);
    expect(props?.bitrateNominal).toBe(112000);
    expect(props?.bitrateMinimum).toBe(0);
  });

  it("should read test ogg file", async () => {
    // TypeScript-only test
    const stream = openTestStream("test.ogg");
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBeGreaterThan(0);
      expect(props.channels).toBeGreaterThan(0);
    }
  });

  it("should read simple tag", async () => {
    // TypeScript-only test
    const data = readTestData("empty.ogg");
    const stream = new ByteVectorStream(data);
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    const tag = f.tag();
    expect(tag).not.toBeNull();
    tag!.artist = "The Artist";
    await f.save();

    await stream.seek(0);
    const f2 = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag()?.artist).toBe("The Artist");
  });

  it("should read lowercase fields ogg", async () => {
    // TypeScript-only test
    const stream = openTestStream("lowercase-fields.ogg");
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should read empty_vorbis.oga", async () => {
    // TypeScript-only test
    const stream = openTestStream("empty_vorbis.oga");
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should handle split packets 1", async () => {
    // TypeScript-only test
    const text = longText(128 * 1024);

    // Phase 1: write large title
    const data = readTestData("empty.ogg");
    const stream = new ByteVectorStream(data);
    {
      const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      f.tag()!.title = text;
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(await f.fileLength()).toBe(136383);
      expect((await f.lastPageHeader())?.sequenceNumber).toBe(19);
      expect((await f.packet(0)).length).toBe(30);
      expect((await f.packet(1)).length).toBe(131127);
      expect((await f.packet(2)).length).toBe(3832);
      expect(f.tag()!.title).toBe(text);
      expect(f.audioProperties()?.lengthInMilliseconds).toBe(3685);

      // Phase 2: shrink back to small title
      f.tag()!.title = "ABCDE";
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(await f.fileLength()).toBe(4370);
      expect((await f.lastPageHeader())?.sequenceNumber).toBe(3);
      expect((await f.packet(0)).length).toBe(30);
      expect((await f.packet(1)).length).toBe(60);
      expect((await f.packet(2)).length).toBe(3832);
      expect(f.tag()!.title).toBe("ABCDE");
      expect(f.audioProperties()?.lengthInMilliseconds).toBe(3685);
    }
  });

  it("should handle split packets 2", async () => {
    // TypeScript-only test
    const text = longText(60890);

    const data = readTestData("empty.ogg");
    const stream = new ByteVectorStream(data);
    {
      const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      f.tag()!.title = text;
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.title).toBe(text);

      f.tag()!.title = "ABCDE";
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.title).toBe("ABCDE");
    }
  });

  it("should save and re-read", async () => {
    // TypeScript-only test
    const data = readTestData("empty.ogg");
    const stream = new ByteVectorStream(data);
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);

    if (f.isValid) {
      const tag = f.tag();
      if (tag) {
        tag.title = "Ogg Test";
        tag.artist = "Test Artist";
        await f.save();
      }

      await stream.seek(0);
      const f2 = await OggVorbisFile.open(stream, true, ReadStyle.Average);
      const tag2 = f2.tag();
      if (tag2) {
        expect(tag2.title).toBe("Ogg Test");
        expect(tag2.artist).toBe("Test Artist");
      }
    }
  });
});

describe("OGG Opus", () => {
  it("should read audio properties", async () => {
    // TypeScript-only test
    const stream = openTestStream("correctness_gain_silent_output.opus");
    const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(7);
    expect(props?.lengthInMilliseconds).toBe(7737);
    expect(props?.bitrate).toBe(36);
    expect(props?.channels).toBe(1);
    expect(props?.sampleRate).toBe(48000);
    expect(props?.inputSampleRate).toBe(48000);
    expect(props?.opusVersion).toBe(1);
    expect(props?.outputGain).toBe(-17920);
  });

  it("should read Opus comments", async () => {
    // TypeScript-only test
    const stream = openTestStream("correctness_gain_silent_output.opus");
    const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    expect(tag).not.toBeNull();
    expect(tag.fieldListMap().get("ENCODER")).toEqual(["Xiph.Org Opus testvectormaker"]);
    expect(tag.fieldListMap().has("TESTDESCRIPTION")).toBe(true);
    expect(tag.fieldListMap().has("ARTIST")).toBe(false);
    expect(tag.vendorId).toBe("libopus 0.9.11-66-g64c2dd7");
  });

  it("should write Opus comments", async () => {
    // TypeScript-only test
    const data = readTestData("correctness_gain_silent_output.opus");
    const stream = new ByteVectorStream(data);
    const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
    f.tag().artist = "Your Tester";
    await f.save();

    await stream.seek(0);
    const f2 = await OggOpusFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag().fieldListMap().get("ENCODER")).toEqual(["Xiph.Org Opus testvectormaker"]);
    expect(f2.tag().fieldListMap().has("TESTDESCRIPTION")).toBe(true);
    expect(f2.tag().fieldListMap().get("ARTIST")).toEqual(["Your Tester"]);
    expect(f2.tag().vendorId).toBe("libopus 0.9.11-66-g64c2dd7");
  });

  it("should handle split packets", async () => {
    // TypeScript-only test
    const text = longText(128 * 1024);

    // Phase 1: write large title
    const data = readTestData("correctness_gain_silent_output.opus");
    const stream = new ByteVectorStream(data);
    {
      const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
      f.tag().title = text;
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(await f.fileLength()).toBe(167534);
      expect((await f.lastPageHeader())?.sequenceNumber).toBe(27);
      expect((await f.packet(0)).length).toBe(19);
      expect((await f.packet(1)).length).toBe(131380);
      expect((await f.packet(2)).length).toBe(5);
      expect((await f.packet(3)).length).toBe(5);
      expect(f.tag().title).toBe(text);
      expect(f.audioProperties()?.lengthInMilliseconds).toBe(7737);

      // Phase 2: shrink back to small title
      f.tag().title = "ABCDE";
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(await f.fileLength()).toBe(35521);
      expect((await f.lastPageHeader())?.sequenceNumber).toBe(11);
      expect((await f.packet(0)).length).toBe(19);
      expect((await f.packet(1)).length).toBe(313);
      expect((await f.packet(2)).length).toBe(5);
      expect((await f.packet(3)).length).toBe(5);
      expect(f.tag().title).toBe("ABCDE");
      expect(f.audioProperties()?.lengthInMilliseconds).toBe(7737);
    }
  });
});

describe("OGG Speex", () => {
  it("should read audio properties", async () => {
    // TypeScript-only test
    const stream = openTestStream("empty.spx");
    const f = await OggSpeexFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(3);
    expect(props?.lengthInMilliseconds).toBe(3685);
    expect(props?.bitrate).toBe(53);
    expect(props?.bitrateNominal).toBe(-1);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(44100);
  });

  it("should handle split packets", async () => {
    // TypeScript-only test
    const text = longText(128 * 1024);

    // Phase 1: write large title
    const data = readTestData("empty.spx");
    const stream = new ByteVectorStream(data);
    {
      const f = await OggSpeexFile.open(stream, true, ReadStyle.Average);
      f.tag().title = text;
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggSpeexFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(await f.fileLength()).toBe(156330);
      expect((await f.lastPageHeader())?.sequenceNumber).toBe(23);
      expect((await f.packet(0)).length).toBe(80);
      expect((await f.packet(1)).length).toBe(131116);
      expect((await f.packet(2)).length).toBe(93);
      expect((await f.packet(3)).length).toBe(93);
      expect(f.tag().title).toBe(text);
      expect(f.audioProperties()?.lengthInMilliseconds).toBe(3685);

      // Phase 2: shrink back to small title
      f.tag().title = "ABCDE";
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await OggSpeexFile.open(stream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(await f.fileLength()).toBe(24317);
      expect((await f.lastPageHeader())?.sequenceNumber).toBe(7);
      expect((await f.packet(0)).length).toBe(80);
      expect((await f.packet(1)).length).toBe(49);
      expect((await f.packet(2)).length).toBe(93);
      expect((await f.packet(3)).length).toBe(93);
      expect(f.tag().title).toBe("ABCDE");
      expect(f.audioProperties()?.lengthInMilliseconds).toBe(3685);
    }
  });
});
