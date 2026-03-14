import { describe, it, expect } from "vitest";
import { ApeFile, ApeFileTagTypes } from "../src/ape/apeFile.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";
import { ReadStyle } from "../src/toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

function openApeFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): ApeFile {
  const stream = openTestStream(filename);
  return new ApeFile(stream, readProperties, readStyle);
}

describe("APE", () => {
  it("testProperties399", () => {
    const f = openApeFile("mac-399.ape");
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

  it("testProperties399Tagged", () => {
    const f = openApeFile("mac-399-tagged.ape");
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

  it("testProperties399Id3v2", () => {
    const f = openApeFile("mac-399-id3v2.ape");
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

  it("testProperties396", () => {
    const f = openApeFile("mac-396.ape");
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

  it("testProperties390", () => {
    const f = openApeFile("mac-390-hdr.ape");
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

  it("testFuzzedFile1 - longloop.ape", () => {
    expect(() => {
      const f = openApeFile("longloop.ape");
      expect(typeof f.isValid).toBe("boolean");
    }).not.toThrow();
  });

  it("testFuzzedFile2 - zerodiv.ape", () => {
    expect(() => {
      const f = openApeFile("zerodiv.ape");
      expect(typeof f.isValid).toBe("boolean");
    }).not.toThrow();
  });

  it("testStripAndProperties", () => {
    const data = readTestData("mac-399-tagged.ape");
    const stream = new ByteVectorStream(data);
    const f = new ApeFile(stream, true, ReadStyle.Average);

    // Verify the file has an APE tag
    expect(f.hasAPETag).toBe(true);

    // Strip APE tag and save
    f.strip(ApeFileTagTypes.APE);
    f.save();

    // Audio properties should still be valid
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.version).toBe(3990);
    }
  });

  it("testRepeatedSave", () => {
    const data = readTestData("mac-399.ape");
    const stream = new ByteVectorStream(data);
    const f = new ApeFile(stream, true, ReadStyle.Average);

    expect(f.hasAPETag).toBe(false);
    expect(f.hasID3v1Tag).toBe(false);

    f.apeTag(true)!.title = "01234 56789 ABCDE FGHIJ";
    f.save();

    f.apeTag()!.title = "0";
    f.save();

    f.id3v1Tag(true)!.title = "01234 56789 ABCDE FGHIJ";
    f.apeTag()!.title = "01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789";
    f.save();

    stream.seek(0);
    const f2 = new ApeFile(stream, true, ReadStyle.Average);
    expect(f2.hasAPETag).toBe(true);
    expect(f2.hasID3v1Tag).toBe(true);
  });
});
