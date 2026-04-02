import { describe, expect, it } from "vitest";
import { ItFile } from "../it/itFile.js";
import { ModTag } from "../mod/modTag.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestDataBV } from "./testHelper.js";

const titleBefore = "test song name";
const titleAfter = "changed title";

const commentBefore =
  "This is a sample name.\n" +
  "In module file formats\n" +
  "sample names are abused\n" +
  "as multiline comments.\n" +
  " ";

const newComment =
  "This is a sample name!\n" +
  "In module file formats\n" +
  "sample names are abused\n" +
  "as multiline comments.\n" +
  "-----------------------------------\n" +
  "The previous line is truncated but starting with this line\n" +
  "the comment is not limeted in the line length but to 8000\n" +
  "additional characters (bytes).\n" +
  "\n" +
  "This is because it is saved in the 'message' proportion of\n" +
  "IT files.";

const commentAfter =
  "This is a sample name!\n" +
  "In module file formats\n" +
  "sample names are abused\n" +
  "as multiline comments.\n" +
  "-------------------------\n" +
  "The previous line is truncated but starting with this line\n" +
  "the comment is not limeted in the line length but to 8000\n" +
  "additional characters (bytes).\n" +
  "\n" +
  "This is because it is saved in the 'message' proportion of\n" +
  "IT files.";

async function testRead(stream: ByteVectorStream, title: string, comment: string) {
  const file = await ItFile.open(stream, true, ReadStyle.Average);
  expect(file.isValid).toBe(true);

  const p = file.audioProperties();
  const t = file.tag();
  expect(p).not.toBeNull();
  expect(t).not.toBeNull();

  expect(p!.lengthInSeconds).toBe(0);
  expect(p!.bitrate).toBe(0);
  expect(p!.sampleRate).toBe(0);
  expect(p!.channels).toBe(64);
  expect(p!.lengthInPatterns).toBe(0);
  expect(p!.stereo).toBe(true);
  expect(p!.instrumentCount).toBe(0);
  expect(p!.sampleCount).toBe(5);
  expect(p!.patternCount).toBe(1);
  expect(p!.version).toBe(535);
  expect(p!.compatibleVersion).toBe(532);
  expect(p!.flags).toBe(9);
  expect(p!.globalVolume).toBe(128);
  expect(p!.mixVolume).toBe(48);
  expect(p!.tempo).toBe(125);
  expect(p!.bpmSpeed).toBe(6);
  expect(p!.panningSeparation).toBe(128);
  expect(p!.pitchWheelDepth).toBe(0);
  expect(t!.title).toBe(title);
  expect(t!.artist).toBe("");
  expect(t!.album).toBe("");
  expect(t!.comment).toBe(comment);
  expect(t!.genre).toBe("");
  expect(t!.year).toBe(0);
  expect(t!.track).toBe(0);
  expect((t as ModTag).trackerName).toBe("Impulse Tracker");
}

describe("IT", () => {
  it("should read tags", async () => {
    // TypeScript-only test
    const stream = openTestStream("test.it");
    await testRead(stream, titleBefore, commentBefore);
  });

  it("should write tags", async () => {
    // TypeScript-only test
    const data = readTestDataBV("test.it");
    const stream = new ByteVectorStream(data);
    const file = await ItFile.open(stream, true, ReadStyle.Average);
    expect(file.tag()).not.toBeNull();
    file.tag()!.title = titleAfter;
    file.tag()!.comment = newComment;
    (file.tag() as ModTag).trackerName = "won't be saved";
    expect(await file.save()).toBe(true);

    await stream.seek(0);
    await testRead(stream, titleAfter, commentAfter);
  });
});
