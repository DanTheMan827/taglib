import { describe, expect, it } from "vitest";
import { AiffFile } from "../riff/aiff/aiffFile.js";
import { WavFile } from "../riff/wav/wavFile.js";
import { ByteVector } from "../byteVector.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestData, readTestDataBV } from "./testHelper.js";

describe("WAV", () => {
  it("should test PCM properties", async () => {
    const stream = openTestStream("empty.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(3);
    expect(props?.lengthInMilliseconds).toBe(3675);
    expect(props?.bitrate).toBe(32);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(1000);
    expect(props?.bitsPerSample).toBe(16);
    expect(props?.sampleFrames).toBe(3675);
    expect(props?.format).toBe(1);
  });

  it("should test ALAW properties", async () => {
    const stream = openTestStream("alaw.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(3);
    expect(props?.lengthInMilliseconds).toBe(3550);
    expect(props?.bitrate).toBe(128);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(8000);
    expect(props?.bitsPerSample).toBe(8);
    expect(props?.sampleFrames).toBe(28400);
    expect(props?.format).toBe(6);
  });

  it("should test float64 properties", async () => {
    const stream = openTestStream("float64.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(0);
    expect(props?.lengthInMilliseconds).toBe(97);
    expect(props?.bitrate).toBe(5645);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(44100);
    expect(props?.bitsPerSample).toBe(64);
    expect(props?.sampleFrames).toBe(4281);
    expect(props?.format).toBe(3);
  });

  it("should test float properties without fact chunk", async () => {
    // Remove the fact chunk by renaming it (change 'fact' to 'fakt')
    const wavData = readTestDataBV("float64.wav");
    expect(wavData.mid(36, 4).toString()).toBe("fact");
    wavData.set(38, 0x6b); // 'k'
    const stream = new ByteVectorStream(wavData);
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(0);
    expect(props?.lengthInMilliseconds).toBe(97);
    expect(props?.bitrate).toBe(5645);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(44100);
    expect(props?.bitsPerSample).toBe(64);
    expect(props?.sampleFrames).toBe(4281);
    expect(props?.format).toBe(3);
  });

  it("should test WAVE_FORMAT_EXTENSIBLE properties", async () => {
    const stream = openTestStream("uint8we.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(2);
    expect(props?.lengthInMilliseconds).toBe(2937);
    expect(props?.bitrate).toBe(128);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(8000);
    expect(props?.bitsPerSample).toBe(8);
    expect(props?.sampleFrames).toBe(23493);
    expect(props?.format).toBe(1);
  });

  it("should test PCM with fact chunk properties", async () => {
    const stream = openTestStream("pcm_with_fact_chunk.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(3);
    expect(props?.lengthInMilliseconds).toBe(3675);
    expect(props?.bitrate).toBe(32);
    expect(props?.channels).toBe(2);
    expect(props?.sampleRate).toBe(1000);
    expect(props?.bitsPerSample).toBe(16);
    expect(props?.sampleFrames).toBe(3675);
    expect(props?.format).toBe(1);
  });

  it("should handle zero-size data chunk", async () => {
    const stream = openTestStream("zero-size-chunk.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should save and re-read ID3v2 tag", async () => {
    const wavData = readTestDataBV("empty.wav");
    const stream = new ByteVectorStream(wavData);
    let f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.hasId3v2Tag).toBe(false);

    f.id3v2Tag!.title = "Title";
    f.id3v2Tag!.artist = "Artist";
    await f.save();
    expect(f.hasId3v2Tag).toBe(true);

    await stream.seek(0);
    f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.hasId3v2Tag).toBe(true);
    expect(f.id3v2Tag?.title).toBe("Title");
    expect(f.id3v2Tag?.artist).toBe("Artist");

    f.id3v2Tag!.title = "";
    f.id3v2Tag!.artist = "";
    await f.save();
    expect(f.hasId3v2Tag).toBe(false);

    await stream.seek(0);
    f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.hasId3v2Tag).toBe(false);
    expect(f.id3v2Tag?.title).toBe("");
    expect(f.id3v2Tag?.artist).toBe("");
  });

  it("should save ID3v2 v3 tag", async () => {
    const wavData = readTestDataBV("empty.wav");
    const stream = new ByteVectorStream(wavData);
    const xxx = "X".repeat(254);

    let f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.hasId3v2Tag).toBe(false);
    f.id3v2Tag!.title = xxx;
    f.id3v2Tag!.artist = "Artist A";
    await f.save(3);
    expect(f.hasId3v2Tag).toBe(true);

    await stream.seek(0);
    f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.id3v2Tag?.header?.majorVersion).toBe(3);
    expect(f.id3v2Tag?.artist).toBe("Artist A");
    expect(f.id3v2Tag?.title).toBe(xxx);
  });

  it("should save and re-read INFO tag", async () => {
    const wavData = readTestDataBV("empty.wav");
    const stream = new ByteVectorStream(wavData);
    let f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.hasInfoTag).toBe(false);

    f.infoTag!.title = "Title";
    f.infoTag!.artist = "Artist";
    await f.save();
    expect(f.hasInfoTag).toBe(true);

    await stream.seek(0);
    f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.hasInfoTag).toBe(true);
    expect(f.infoTag?.title).toBe("Title");
    expect(f.infoTag?.artist).toBe("Artist");

    f.infoTag!.title = "";
    f.infoTag!.artist = "";
    await f.save();
    expect(f.hasInfoTag).toBe(false);

    await stream.seek(0);
    f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    expect(f.hasInfoTag).toBe(false);
    expect(f.infoTag?.title).toBe("");
    expect(f.infoTag?.artist).toBe("");
  });

  it("should handle duplicate tags", async () => {
    const stream = openTestStream("duplicate_tags.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);

    // duplicate_tags.wav has duplicate ID3v2/INFO tags.
    // title() returns "Title2" if can't skip the second tag.
    expect(f.hasId3v2Tag).toBe(true);
    expect(f.id3v2Tag?.title).toBe("Title1");

    expect(f.hasInfoTag).toBe(true);
    expect(f.infoTag?.title).toBe("Title1");

    await f.save();
    expect(await f.fileLength()).toBe(15898);
    expect(await f.find(ByteVector.fromString("Title2"))).toBe(-1);
  });

  it("should handle infloop (fuzzed) wav file", async () => {
    const stream = openTestStream("infloop.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props?.channels).toBe(1);
    expect(props?.bitrate).toBe(88);
    expect(props?.bitsPerSample).toBe(8);
    expect(props?.sampleRate).toBe(11025);
    expect(f.hasInfoTag).toBe(false);
    expect(f.hasId3v2Tag).toBe(false);
  });

  it("should handle segfault wav", async () => {
    const stream = openTestStream("segfault.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it("should handle invalid chunk wav file", async () => {
    // invalid-chunk.wav has an invalid chunk after a valid id3 chunk.
    // No fmt/data chunks, so audioProperties is null; C++ lengthInSeconds would be 0.
    const stream = openTestStream("invalid-chunk.wav");
    const f = await WavFile.open(stream, true, ReadStyle.Average);
    expect(f.audioProperties()?.lengthInSeconds ?? 0).toBe(0);
    expect(f.hasId3v2Tag).toBe(true);
  });
});

