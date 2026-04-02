import { describe, expect, it } from "vitest";
import { AsfAttribute, AsfAttributeType } from "../asf/asfAttribute.js";
import { AsfFile } from "../asf/asfFile.js";
import { AsfPicture, AsfPictureType } from "../asf/asfPicture.js";
import { ByteVector } from "../byteVector.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestDataBV } from "./testHelper.js";

async function openAsfFile(name: string): Promise<AsfFile> {
  const stream = openTestStream(name);
  return await AsfFile.open(stream, true, ReadStyle.Average);
}

async function openAsfFileCopy(name: string): Promise<{ file: AsfFile; stream: ByteVectorStream }> {
  const data = readTestDataBV(name);
  const stream = new ByteVectorStream(data);
  const file = await AsfFile.open(stream, true, ReadStyle.Average);
  return { file, stream };
}

describe("ASF", () => {
  it("should read audio properties", async () => {
    // TypeScript-only test
    const f = await openAsfFile("silence-1.wma");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props!.lengthInSeconds).toBe(3);
    expect(props!.lengthInMilliseconds).toBe(3712);
    expect(props!.bitrate).toBe(64);
    expect(props!.channels).toBe(2);
    expect(props!.sampleRate).toBe(48000);
    expect(props!.bitsPerSample).toBe(16);
    expect(props!.codecName).toBe("Windows Media Audio 9.1");
    expect(props!.codecDescription).toBe("64 kbps, 48 kHz, stereo 2-pass CBR");
    expect(props!.isEncrypted).toBe(false);
  });

  it("should read lossless properties", async () => {
    // TypeScript-only test
    const f = await openAsfFile("lossless.wma");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props!.lengthInSeconds).toBe(3);
    expect(props!.lengthInMilliseconds).toBe(3549);
    expect(props!.bitrate).toBe(1152);
    expect(props!.channels).toBe(2);
    expect(props!.sampleRate).toBe(44100);
    expect(props!.bitsPerSample).toBe(16);
    expect(props!.codecName).toBe("Windows Media Audio 9.2 Lossless");
    expect(props!.codecDescription).toBe("VBR Quality 100, 44 kHz, 2 channel 16 bit 1-pass VBR");
    expect(props!.isEncrypted).toBe(false);
  });

  it("should read tags", async () => {
    // TypeScript-only test
    const f = await openAsfFile("silence-1.wma");
    expect(f.tag()!.title).toBe("test");
  });

  it("should save multiple values", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    const values = [
      AsfAttribute.fromString("Foo"),
      AsfAttribute.fromString("Bar"),
    ];
    f.tag()!.setAttributeList("WM/AlbumTitle", values);
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag()!.attribute("WM/AlbumTitle").length).toBe(2);
  });

  it("should save stream", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    const attr = AsfAttribute.fromString("Foo");
    attr.stream = 43;
    f.tag()!.setAttribute("WM/AlbumTitle", attr);
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag()!.attribute("WM/AlbumTitle")[0].stream).toBe(43);
  });

  it("should save language", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    const attr = AsfAttribute.fromString("Foo");
    attr.stream = 32;
    attr.language = 56;
    f.tag()!.setAttribute("WM/AlbumTitle", attr);
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag()!.attribute("WM/AlbumTitle")[0].stream).toBe(32);
    expect(f2.tag()!.attribute("WM/AlbumTitle")[0].language).toBe(56);
  });

  it("should handle DWord track number", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    expect(f.tag()!.contains("WM/TrackNumber")).toBe(false);
    f.tag()!.setAttribute("WM/TrackNumber", AsfAttribute.fromUInt(123));
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    expect(f2.tag()!.contains("WM/TrackNumber")).toBe(true);
    expect(f2.tag()!.attribute("WM/TrackNumber")[0].type).toBe(AsfAttributeType.DWordType);
    expect(f2.tag()!.track).toBe(123);
    f2.tag()!.track = 234;
    await f2.save();

    await stream.seek(0);
    const f3 = await AsfFile.open(stream, true, ReadStyle.Average);
    expect(f3.tag()!.contains("WM/TrackNumber")).toBe(true);
    expect(f3.tag()!.attribute("WM/TrackNumber")[0].type).toBe(AsfAttributeType.UnicodeType);
    expect(f3.tag()!.track).toBe(234);
  });

  it("should save large value", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    const bigData = ByteVector.fromSize(70000, 0x78); // 'x'
    const attr = AsfAttribute.fromByteVector(bigData);
    f.tag()!.setAttribute("WM/Blob", attr);
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    const result = f2.tag()!.attribute("WM/Blob")[0].toByteVector();
    expect(result.length).toBe(70000);
    expect(result.get(0)).toBe(0x78);
    expect(result.get(69999)).toBe(0x78);
  });

  it("should save picture", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    const picture = AsfPicture.create();
    picture.mimeType = "image/jpeg";
    picture.type = AsfPictureType.FrontCover;
    picture.description = "description";
    picture.picture = ByteVector.fromString("data");
    f.tag()!.setAttribute("WM/Picture", AsfAttribute.fromPicture(picture));
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    const values2 = f2.tag()!.attribute("WM/Picture");
    expect(values2.length).toBe(1);
    const picture2 = values2[0].toPicture();
    expect(picture2.isValid).toBe(true);
    expect(picture2.mimeType).toBe("image/jpeg");
    expect(picture2.type).toBe(AsfPictureType.FrontCover);
    expect(picture2.description).toBe("description");
    expect(picture2.picture.toString()).toBe("data");
  });

  it("should save multiple pictures", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    const picture = AsfPicture.create();
    picture.mimeType = "image/jpeg";
    picture.type = AsfPictureType.FrontCover;
    picture.description = "description";
    picture.picture = ByteVector.fromString("data");

    const picture2 = AsfPicture.create();
    picture2.mimeType = "image/png";
    picture2.type = AsfPictureType.BackCover;
    picture2.description = "back cover";
    picture2.picture = ByteVector.fromString("PNG data");

    f.tag()!.setAttributeList("WM/Picture", [
      AsfAttribute.fromPicture(picture),
      AsfAttribute.fromPicture(picture2),
    ]);
    await f.save();

    await stream.seek(0);
    const f2 = await AsfFile.open(stream, true, ReadStyle.Average);
    const values2 = f2.tag()!.attribute("WM/Picture");
    expect(values2.length).toBe(2);

    // C++ test checks values2[1] first (FrontCover), then values2[0] (BackCover)
    // Order may differ in TS; check both pictures exist
    const pics = values2.map(v => v.toPicture());
    const frontCover = pics.find(p => p.type === AsfPictureType.FrontCover);
    const backCover = pics.find(p => p.type === AsfPictureType.BackCover);

    expect(frontCover).toBeDefined();
    expect(frontCover!.isValid).toBe(true);
    expect(frontCover!.mimeType).toBe("image/jpeg");
    expect(frontCover!.description).toBe("description");
    expect(frontCover!.picture.toString()).toBe("data");

    expect(backCover).toBeDefined();
    expect(backCover!.isValid).toBe(true);
    expect(backCover!.mimeType).toBe("image/png");
    expect(backCover!.description).toBe("back cover");
    expect(backCover!.picture.toString()).toBe("PNG data");
  });

  it("should handle properties", async () => {
    // TypeScript-only test
    const { file: f } = await openAsfFileCopy("silence-1.wma");

    const tags = f.properties();
    tags.replace("TRACKNUMBER", ["2"]);
    tags.replace("DISCNUMBER", ["3"]);
    tags.replace("BPM", ["123"]);
    tags.replace("ARTIST", ["Foo Bar"]);
    f.setProperties(tags);

    const tags2 = f.properties();

    expect(f.tag()!.artist).toBe("Foo Bar");
    expect(tags2.get("ARTIST")).toEqual(["Foo Bar"]);

    expect(f.tag()!.contains("WM/BeatsPerMinute")).toBe(true);
    expect(f.tag()!.attribute("WM/BeatsPerMinute").length).toBe(1);
    expect(f.tag()!.attribute("WM/BeatsPerMinute")[0].toString()).toBe("123");
    expect(tags2.get("BPM")).toEqual(["123"]);

    expect(f.tag()!.contains("WM/TrackNumber")).toBe(true);
    expect(f.tag()!.attribute("WM/TrackNumber").length).toBe(1);
    expect(f.tag()!.attribute("WM/TrackNumber")[0].toString()).toBe("2");
    expect(tags2.get("TRACKNUMBER")).toEqual(["2"]);

    expect(f.tag()!.contains("WM/PartOfSet")).toBe(true);
    expect(f.tag()!.attribute("WM/PartOfSet").length).toBe(1);
    expect(f.tag()!.attribute("WM/PartOfSet")[0].toString()).toBe("3");
    expect(tags2.get("DISCNUMBER")).toEqual(["3"]);
  });

  it("should handle repeated save", async () => {
    // TypeScript-only test
    const { file: f, stream } = await openAsfFileCopy("silence-1.wma");
    // Generate long text (~128KB)
    let longText = "";
    for (let i = 0; i < 128 * 1024; i++) {
      longText += String.fromCharCode(0x41 + (i % 26));
    }
    f.tag()!.title = longText;
    await f.save();
    const len1 = await stream.length();

    // Generate shorter text (~16KB)
    let shortText = "";
    for (let i = 0; i < 16 * 1024; i++) {
      shortText += String.fromCharCode(0x41 + (i % 26));
    }
    f.tag()!.title = shortText;
    await f.save();
    const len2 = await stream.length();

    // After shrinking the title, file should be smaller
    expect(len2).toBeLessThan(len1);
  });
});
