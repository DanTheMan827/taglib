import { describe, expect, it } from "vitest";
import { DsfFile } from "../dsf/dsfFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

async function openDsfFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): Promise<DsfFile> {
  const stream = openTestStream(filename);
  return await DsfFile.open(stream, readProperties, readStyle);
}

describe("DSF", () => {
  it("testBasic", async () => {
    // C++: test_dsf.cpp – TestDSF::testBasic
    const f = await openDsfFile("empty10ms.dsf");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(10);
      expect(props.bitrate).toBe(5645);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(2822400);
      expect(props.bitsPerSample).toBe(1);
    }
  });

  it("testTags", async () => {
    // C++: test_dsf.cpp – TestDSF::testTags
    const data = readTestData("empty10ms.dsf");
    const stream = new ByteVectorStream(data);
    const f = await DsfFile.open(stream, true, ReadStyle.Average);

    const tag = f.tag();
    expect(tag).not.toBeNull();
    if (tag) {
      expect(tag.artist).toBe("");
      tag.artist = "The Artist";
      await f.save();
    }

    await stream.seek(0);
    const f2 = await DsfFile.open(stream, true, ReadStyle.Average);
    const tag2 = f2.tag();
    expect(tag2).not.toBeNull();
    if (tag2) {
      expect(tag2.artist).toBe("The Artist");
      tag2.title = "";
      tag2.artist = "";
    }
  });
});
