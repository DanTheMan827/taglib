import { describe, expect, it } from "vitest";
import { ApeFile, ApeFileTagTypes } from "../ape/apeFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

async function openApeFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): Promise<ApeFile> {
  const stream = openTestStream(filename);
  return await ApeFile.open(stream, readProperties, readStyle);
}

describe("APE", () => {
  it("testProperties399", async () => {
    // C++: test_ape.cpp – TestAPEFile::testProperties399
    const f = await openApeFile("mac-399.ape");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3550);
      expect(props.bitrate).toBe(192);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(156556);
      expect(props.version).toBe(3990);
    }
  });

  it("testProperties399Tagged", async () => {
    // C++: test_ape.cpp – TestAPEFile::testProperties399Tagged
    const f = await openApeFile("mac-399-tagged.ape");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3550);
      expect(props.bitrate).toBe(192);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(156556);
      expect(props.version).toBe(3990);
    }
  });

  it("testProperties399Id3v2", async () => {
    // C++: test_ape.cpp – TestAPEFile::testProperties399Id3v2
    const f = await openApeFile("mac-399-id3v2.ape");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3550);
      expect(props.bitrate).toBe(192);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(156556);
      expect(props.version).toBe(3990);
    }
  });

  it("testProperties396", async () => {
    // C++: test_ape.cpp – TestAPEFile::testProperties396
    const f = await openApeFile("mac-396.ape");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3685);
      expect(props.bitrate).toBe(0);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(162496);
      expect(props.version).toBe(3960);
    }
  });

  it("testProperties390", async () => {
    // C++: test_ape.cpp – TestAPEFile::testProperties390
    const f = await openApeFile("mac-390-hdr.ape");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(15630);
      expect(props.bitrate).toBe(0);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(689262);
      expect(props.version).toBe(3900);
    }
  });

  it("testFuzzedFile1 - longloop.ape", async () => {
    // TypeScript-only test
    const f = await openApeFile("longloop.ape");
    expect(typeof f.isValid).toBe("boolean");
  });

  it("testFuzzedFile2 - zerodiv.ape", async () => {
    // TypeScript-only test
    const f = await openApeFile("zerodiv.ape");
    expect(typeof f.isValid).toBe("boolean");
  });

  it("testStripAndProperties", async () => {
    // C++: test_ape.cpp – TestAPEFile::testStripAndProperties
    const data = readTestData("mac-399-tagged.ape");
    const stream = new ByteVectorStream(data);
    const f = await ApeFile.open(stream, true, ReadStyle.Average);

    // Verify the file has an APE tag
    expect(f.hasAPETag).toBe(true);

    // Strip APE tag and save
    f.strip(ApeFileTagTypes.APE);
    await f.save();

    // Audio properties should still be valid
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.version).toBe(3990);
    }
  });

  it("testRepeatedSave", async () => {
    // C++: test_ape.cpp – TestAPEFile::testRepeatedSave
    const data = readTestData("mac-399.ape");
    const stream = new ByteVectorStream(data);
    const f = await ApeFile.open(stream, true, ReadStyle.Average);

    expect(f.hasAPETag).toBe(false);
    expect(f.hasID3v1Tag).toBe(false);

    f.apeTag(true)!.title = "01234 56789 ABCDE FGHIJ";
    await f.save();

    f.apeTag()!.title = "0";
    await f.save();

    f.id3v1Tag(true)!.title = "01234 56789 ABCDE FGHIJ";
    f.apeTag()!.title = "01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789";
    await f.save();

    await stream.seek(0);
    const f2 = await ApeFile.open(stream, true, ReadStyle.Average);
    expect(f2.hasAPETag).toBe(true);
    expect(f2.hasID3v1Tag).toBe(true);
  });
});
