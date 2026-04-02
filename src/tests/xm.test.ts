import { describe, expect, it } from "vitest";
import { ModTag } from "../mod/modTag.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { XmFile } from "../xm/xmFile.js";
import { openTestStream, readTestDataBV } from "./testHelper.js";

const titleBefore = "title of song";
const titleAfter = "changed title";

const trackerNameBefore = "MilkyTracker        ";
const trackerNameAfter = "TagLib";

const commentBefore =
  "Instrument names\n" +
  "are abused as\n" +
  "comments in\n" +
  "module file formats.\n" +
  "-+-+-+-+-+-+-+-+-+-+-+\n" +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n\n\n" +
  "Sample\n" +
  "names\n" +
  "are sometimes\n" +
  "also abused as\n" +
  "comments.";

const newCommentShort =
  "Instrument names\n" +
  "are abused as\n" +
  "comments in\n" +
  "module file formats.\n" +
  "======================\n" +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n\n\n" +
  "Sample names\n" +
  "are sometimes\n" +
  "also abused as\n" +
  "comments.";

const newCommentLong =
  "Instrument names\n" +
  "are abused as\n" +
  "comments in\n" +
  "module file formats.\n" +
  "======================\n" +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n\n\n" +
  "Sample names\n" +
  "are sometimes\n" +
  "also abused as\n" +
  "comments.\n" +
  "\n\n\n\n\n\n\n" +
  "TEST";

const commentAfter =
  "Instrument names\n" +
  "are abused as\n" +
  "comments in\n" +
  "module file formats.\n" +
  "======================\n" +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n".repeat(30) +
  "\n\n\n" +
  "Sample names\n" +
  "are sometimes\n" +
  "also abused as\n" +
  "comments.\n";

async function testRead(
  stream: ByteVectorStream,
  title: string,
  comment: string,
  trackerName: string,
) {
  const file = await XmFile.open(stream, true, ReadStyle.Average);
  expect(file.isValid).toBe(true);

  const p = file.audioProperties();
  const t = file.tag();
  expect(p).not.toBeNull();
  expect(t).not.toBeNull();

  expect(p!.lengthInSeconds).toBe(0);
  expect(p!.bitrate).toBe(0);
  expect(p!.sampleRate).toBe(0);
  expect(p!.channels).toBe(8);
  expect(p!.lengthInPatterns).toBe(1);
  expect(p!.version).toBe(260);
  expect(p!.restartPosition).toBe(0);
  expect(p!.patternCount).toBe(1);
  expect(p!.instrumentCount).toBe(128);
  expect(p!.flags).toBe(1);
  expect(p!.tempo).toBe(6);
  expect(p!.bpmSpeed).toBe(125);
  expect(t!.title).toBe(title);
  expect(t!.artist).toBe("");
  expect(t!.album).toBe("");
  expect(t!.comment).toBe(comment);
  expect(t!.genre).toBe("");
  expect(t!.year).toBe(0);
  expect(t!.track).toBe(0);
  expect((t as ModTag).trackerName).toBe(trackerName);
}

describe("XM", () => {
  it("should read tags", async () => {
    // TypeScript-only test
    const stream = openTestStream("test.xm");
    await testRead(stream, titleBefore, commentBefore, trackerNameBefore);
  });

  it("should read stripped tags", async () => {
    // TypeScript-only test
    const stream = openTestStream("stripped.xm");
    const file = await XmFile.open(stream, true, ReadStyle.Average);
    expect(file.isValid).toBe(true);

    const p = file.audioProperties();
    const t = file.tag();
    expect(p).not.toBeNull();
    expect(t).not.toBeNull();

    expect(p!.lengthInSeconds).toBe(0);
    expect(p!.bitrate).toBe(0);
    expect(p!.sampleRate).toBe(0);
    expect(p!.channels).toBe(8);
    expect(p!.lengthInPatterns).toBe(1);
    expect(p!.version).toBe(0);
    expect(p!.restartPosition).toBe(0);
    expect(p!.patternCount).toBe(1);
    expect(p!.instrumentCount).toBe(0);
    expect(p!.flags).toBe(1);
    expect(p!.tempo).toBe(6);
    expect(p!.bpmSpeed).toBe(125);
    expect(t!.title).toBe(titleBefore);
    expect(t!.artist).toBe("");
    expect(t!.album).toBe("");
    expect(t!.comment).toBe("");
    expect(t!.genre).toBe("");
    expect(t!.year).toBe(0);
    expect(t!.track).toBe(0);
    expect((t as ModTag).trackerName).toBe("");
  });

  it("should write tags (short comment)", async () => {
    // TypeScript-only test
    const data = readTestDataBV("test.xm");
    const stream = new ByteVectorStream(data);
    const file = await XmFile.open(stream, true, ReadStyle.Average);
    expect(file.tag()).not.toBeNull();
    file.tag()!.title = titleAfter;
    file.tag()!.comment = newCommentShort;
    (file.tag() as ModTag).trackerName = trackerNameAfter;
    expect(await file.save()).toBe(true);

    await stream.seek(0);
    await testRead(stream, titleAfter, commentAfter, trackerNameAfter);
  });

  it("should write tags (long comment)", async () => {
    // TypeScript-only test
    const data = readTestDataBV("test.xm");
    const stream = new ByteVectorStream(data);
    const file = await XmFile.open(stream, true, ReadStyle.Average);
    expect(file.tag()).not.toBeNull();
    file.tag()!.title = titleAfter;
    file.tag()!.comment = newCommentLong;
    (file.tag() as ModTag).trackerName = trackerNameAfter;
    expect(await file.save()).toBe(true);

    await stream.seek(0);
    await testRead(stream, titleAfter, commentAfter, trackerNameAfter);
  });
});
