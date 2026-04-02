import { describe, expect, it } from "vitest";
import { ModFile } from "../mod/modFile.js";
import { ModTag } from "../mod/modTag.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestDataBV } from "./testHelper.js";

const titleBefore = "title of song";
const titleAfter = "changed title";

const commentBefore =
  "Instrument names\n" +
  "are abused as\n" +
  "comments in\n" +
  "module file formats.\n" +
  "-+-+-+-+-+-+-+-+-+-+-+\n" +
  "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n";

const newComment =
  "This line will be truncated because it is too long for a mod instrument name.\n" +
  "This line is ok.";

const commentAfter =
  "This line will be trun\n" +
  "This line is ok.\n" +
  "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n";

async function testRead(stream: ByteVectorStream, title: string, comment: string) {
  const file = await ModFile.open(stream, true, ReadStyle.Average);
  expect(file.isValid).toBe(true);

  const p = file.audioProperties();
  const t = file.tag();
  expect(p).not.toBeNull();
  expect(t).not.toBeNull();

  expect(p!.lengthInSeconds).toBe(0);
  expect(p!.bitrate).toBe(0);
  expect(p!.sampleRate).toBe(0);
  expect(p!.channels).toBe(8);
  expect(p!.instrumentCount).toBe(31);
  expect(p!.lengthInPatterns).toBe(1);
  expect(t!.title).toBe(title);
  expect(t!.artist).toBe("");
  expect(t!.album).toBe("");
  expect(t!.comment).toBe(comment);
  expect(t!.genre).toBe("");
  expect(t!.year).toBe(0);
  expect(t!.track).toBe(0);
  expect((t as ModTag).trackerName).toBe("StarTrekker");
}

describe("MOD", () => {
  it("should read tags", async () => {
    // TypeScript-only test
    const stream = openTestStream("test.mod");
    await testRead(stream, titleBefore, commentBefore);
  });

  it("should write tags", async () => {
    // TypeScript-only test
    const data = readTestDataBV("test.mod");
    const stream = new ByteVectorStream(data);
    const file = await ModFile.open(stream, true, ReadStyle.Average);
    expect(file.tag()).not.toBeNull();
    file.tag()!.title = titleAfter;
    file.tag()!.comment = newComment;
    expect(await file.save()).toBe(true);

    await stream.seek(0);
    await testRead(stream, titleAfter, commentAfter);
  });

  it("should handle property interface", async () => {
    // TypeScript-only test
    const t = new ModTag();
    const properties = new PropertyMap();
    properties.replace("BLA", ["bla"]);
    properties.replace("ARTIST", ["artist1", "artist2"]);
    properties.replace("TITLE", ["title"]);

    const unsupported = t.setProperties(properties);
    expect(unsupported.contains("BLA")).toBe(true);
    expect(unsupported.contains("ARTIST")).toBe(true);
    expect(unsupported.get("ARTIST")).toEqual(["artist1", "artist2"]);
    expect(unsupported.contains("TITLE")).toBe(false);

    const result = t.properties();
    expect(result.get("TITLE")).toEqual(["title"]);
  });
});
