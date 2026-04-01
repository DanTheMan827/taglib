import { describe, expect, it } from "vitest";
import { OggOpusFile } from "../ogg/opus/opusFile.js";
import { OggSpeexFile } from "../ogg/speex/speexFile.js";
import { OggVorbisFile } from "../ogg/vorbis/vorbisFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

describe("OGG Vorbis", () => {
  it("should read audio properties", async () => {
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
    const stream = openTestStream("lowercase-fields.ogg");
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should read empty_vorbis.oga", async () => {
    const stream = openTestStream("empty_vorbis.oga");
    const f = await OggVorbisFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should save and re-read", async () => {
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
    const stream = openTestStream("correctness_gain_silent_output.opus");
    const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    expect(tag).not.toBeNull();
    // Verify ENCODER field is present
    expect(tag.fieldListMap().has("ENCODER")).toBeTruthy();
    expect(tag.vendorId).toBe("libopus 0.9.11-66-g64c2dd7");
    expect(tag.fieldListMap().has("ARTIST")).toBeFalsy();
    expect(tag.fieldListMap().has("TESTDESCRIPTION")).toBeTruthy();
  });

  it("should write Opus comments", async () => {
    const data = readTestData("correctness_gain_silent_output.opus");
    const stream = new ByteVectorStream(data);
    const f = await OggOpusFile.open(stream, true, ReadStyle.Average);
    f.tag().artist = "Your Tester";
    await f.save();

    await stream.seek(0);
    const f2 = await OggOpusFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag().artist).toBe("Your Tester");
    // ENCODER should still be present
    expect(f2.tag().fieldListMap().has("ENCODER")).toBeTruthy();
  });
});

describe("OGG Speex", () => {
  it("should read audio properties", async () => {
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
});
