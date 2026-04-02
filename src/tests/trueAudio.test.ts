import { describe, expect, it } from "vitest";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { TrueAudioFile, TrueAudioTagTypes } from "../trueaudio/trueAudioFile.js";
import { openTestStream, readTestData } from "./testHelper.js";

async function openTrueAudioFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): Promise<TrueAudioFile> {
  const stream = openTestStream(filename);
  return await TrueAudioFile.open(stream, readProperties, readStyle);
}

describe("TrueAudio", () => {
  it("testReadPropertiesWithoutID3v2", async () => {
    // C++: test_trueaudio.cpp – TestTrueAudio::testReadPropertiesWithoutID3v2
    const f = await openTrueAudioFile("empty.tta");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3685);
      expect(props.bitrate).toBe(173);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(162496);
      expect(props.ttaVersion).toBe(1);
    }
  });

  it("testReadPropertiesWithTags", async () => {
    // C++: test_trueaudio.cpp – TestTrueAudio::testReadPropertiesWithTags
    const f = await openTrueAudioFile("tagged.tta");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3685);
      expect(props.bitrate).toBe(173);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(162496);
      expect(props.ttaVersion).toBe(1);
    }
  });

  it("testStripAndProperties", async () => {
    // C++: test_trueaudio.cpp – TestTrueAudio::testStripAndProperties
    const data = readTestData("empty.tta");
    const stream = new ByteVectorStream(data);
    const f = await TrueAudioFile.open(stream, true, ReadStyle.Average);

    f.id3v2Tag(true)!.title = "ID3v2";
    f.id3v1Tag(true)!.title = "ID3v1";
    await f.save();

    await stream.seek(0);
    const f2 = await TrueAudioFile.open(stream, true, ReadStyle.Average);
    expect(f2.hasID3v1Tag).toBe(true);
    expect(f2.hasID3v2Tag).toBe(true);
    expect(f2.tag().title).toBe("ID3v2");

    f2.strip(TrueAudioTagTypes.ID3v2);
    await f2.save();

    await stream.seek(0);
    const f3 = await TrueAudioFile.open(stream, true, ReadStyle.Average);
    expect(f3.tag().title).toBe("ID3v1");

    f3.strip(TrueAudioTagTypes.ID3v1);
    await f3.save();

    await stream.seek(0);
    const f4 = await TrueAudioFile.open(stream, true, ReadStyle.Average);
    expect(f4.tag().title).toBe("");
  });

  it("testRepeatedSave", async () => {
    // C++: test_trueaudio.cpp – TestTrueAudio::testRepeatedSave
    const data = readTestData("empty.tta");
    const stream = new ByteVectorStream(data);
    const f = await TrueAudioFile.open(stream, true, ReadStyle.Average);

    expect(f.hasID3v2Tag).toBe(false);
    expect(f.hasID3v1Tag).toBe(false);

    f.id3v2Tag(true)!.title = "01234 56789 ABCDE FGHIJ";
    await f.save();

    f.id3v2Tag()!.title = "0";
    await f.save();

    f.id3v1Tag(true)!.title = "01234 56789 ABCDE FGHIJ";
    f.id3v2Tag()!.title = "01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789";
    await f.save();

    await stream.seek(0);
    const f2 = await TrueAudioFile.open(stream, true, ReadStyle.Average);
    expect(f2.hasID3v2Tag).toBe(true);
    expect(f2.hasID3v1Tag).toBe(true);
  });
});
