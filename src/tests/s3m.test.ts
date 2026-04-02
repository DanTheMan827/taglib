import { describe, expect, it } from "vitest";
import { ModTag } from "../mod/modTag.js";
import { S3mFile } from "../s3m/s3mFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestDataBV } from "./testHelper.js";

const titleBefore = "test song name";
const titleAfter = "changed title";

const commentBefore =
  "This is an instrument name.\n" +
  "Module file formats\n" +
  "abuse instrument names\n" +
  "as multiline comments.\n" +
  " ";

const newComment =
  "This is an instrument name!\n" +
  "Module file formats\n" +
  "abuse instrument names\n" +
  "as multiline comments.\n" +
  "-----------------------------------\n" +
  "This line will be dropped and the previous is truncated.";

const commentAfter =
  "This is an instrument name!\n" +
  "Module file formats\n" +
  "abuse instrument names\n" +
  "as multiline comments.\n" +
  "---------------------------";

async function testRead(stream: ByteVectorStream, title: string, comment: string) {
  const file = await S3mFile.open(stream, true, ReadStyle.Average);
  expect(file.isValid).toBe(true);

  const p = file.audioProperties();
  const t = file.tag();
  expect(p).not.toBeNull();
  expect(t).not.toBeNull();

  expect(p!.lengthInSeconds).toBe(0);
  expect(p!.bitrate).toBe(0);
  expect(p!.sampleRate).toBe(0);
  expect(p!.channels).toBe(16);
  expect(p!.lengthInPatterns).toBe(0);
  expect(p!.stereo).toBe(false);
  expect(p!.sampleCount).toBe(5);
  expect(p!.patternCount).toBe(1);
  expect(p!.flags).toBe(0);
  expect(p!.trackerVersion).toBe(4896);
  expect(p!.fileFormatVersion).toBe(2);
  expect(p!.globalVolume).toBe(64);
  expect(p!.masterVolume).toBe(48);
  expect(p!.tempo).toBe(125);
  expect(p!.bpmSpeed).toBe(6);
  expect(t!.title).toBe(title);
  expect(t!.artist).toBe("");
  expect(t!.album).toBe("");
  expect(t!.comment).toBe(comment);
  expect(t!.genre).toBe("");
  expect(t!.year).toBe(0);
  expect(t!.track).toBe(0);
  expect((t as ModTag).trackerName).toBe("ScreamTracker III");
}

describe("S3M", () => {
  it("should read tags", async () => {
    // TypeScript-only test
    const stream = openTestStream("test.s3m");
    await testRead(stream, titleBefore, commentBefore);
  });

  it("should write tags", async () => {
    // TypeScript-only test
    const data = readTestDataBV("test.s3m");
    const stream = new ByteVectorStream(data);
    const file = await S3mFile.open(stream, true, ReadStyle.Average);
    expect(file.tag()).not.toBeNull();
    file.tag()!.title = titleAfter;
    file.tag()!.comment = newComment;
    (file.tag() as ModTag).trackerName = "won't be saved";
    expect(await file.save()).toBe(true);

    await stream.seek(0);
    await testRead(stream, titleAfter, commentAfter);
  });
});
