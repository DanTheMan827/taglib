import { describe, it, expect } from "vitest";
import { FlacFile } from "../src/flac/flacFile.js";
import { ByteVector } from "../src/byteVector.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";
import { ReadStyle } from "../src/toolkit/types.js";
import { Variant } from "../src/toolkit/variant.js";
import { openTestStream, readTestData } from "./testHelper.js";

function openFlacFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): FlacFile {
  const stream = openTestStream(filename);
  return new FlacFile(stream, readProperties, readStyle);
}

describe("FLAC", () => {
  it("should read silence file", () => {
    const f = openFlacFile("silence-44-s.flac");
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBe(44100);
      expect(props.channels).toBe(2);
      expect(props.bitsPerSample).toBe(16);
      expect(props.lengthInMilliseconds).toBeGreaterThan(0);
    }
  });

  it("should read sinewave file", () => {
    const f = openFlacFile("sinewave.flac");
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
  });

  it("should read no-tags file", () => {
    const f = openFlacFile("no-tags.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read empty-seektable file", () => {
    const f = openFlacFile("empty-seektable.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read zero-sized-padding file", () => {
    const f = openFlacFile("zero-sized-padding.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read multiple-vc file", () => {
    const f = openFlacFile("multiple-vc.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read Xiph Comment", () => {
    const f = openFlacFile("silence-44-s.flac");
    expect(f.xiphComment).not.toBeNull();
  });

  it("should access pictures", () => {
    const f = openFlacFile("silence-44-s.flac");
    // Silence file may or may not have pictures, but API should work
    const pics = f.pictureList;
    expect(Array.isArray(pics)).toBe(true);
  });

  it("should save and re-read", () => {
    const data = readTestData("silence-44-s.flac");
    const stream = new ByteVectorStream(data);
    const f = new FlacFile(stream, true, ReadStyle.Average);

    if (f.isValid && f.xiphComment) {
      f.xiphComment.title = "FLAC Test";
      f.xiphComment.artist = "Test Artist";
      f.save();
    }

    // Re-read
    stream.seek(0);
    const f2 = new FlacFile(stream, true, ReadStyle.Average);
    if (f2.isValid && f2.xiphComment) {
      expect(f2.xiphComment.title).toBe("FLAC Test");
      expect(f2.xiphComment.artist).toBe("Test Artist");
    }
  });

  it("should save and re-read artwork via complexProperties", () => {
    const data = readTestData("silence-44-s.flac");
    const stream = new ByteVectorStream(data);
    const f = new FlacFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);

    // Create a small fake image
    const imgData = ByteVector.fromSize(64, 0xFF);

    const pictureMap: Map<string, Variant> = new Map();
    pictureMap.set("data", Variant.fromByteVector(imgData));
    pictureMap.set("mimeType", Variant.fromString("image/png"));
    pictureMap.set("description", Variant.fromString("Cover"));
    pictureMap.set("pictureType", Variant.fromInt(3));
    pictureMap.set("width", Variant.fromInt(100));
    pictureMap.set("height", Variant.fromInt(100));
    pictureMap.set("colorDepth", Variant.fromInt(24));
    pictureMap.set("numColors", Variant.fromInt(0));

    f.setComplexProperties("PICTURE", [pictureMap]);
    f.save();

    // Re-read
    stream.seek(0);
    const f2 = new FlacFile(stream, true, ReadStyle.Average);
    expect(f2.isValid).toBe(true);
    expect(f2.pictureList.length).toBe(1);
    expect(f2.pictureList[0].mimeType).toBe("image/png");
    expect(f2.pictureList[0].description).toBe("Cover");
    expect(f2.pictureList[0].pictureType).toBe(3);
    expect(f2.pictureList[0].width).toBe(100);
    expect(f2.pictureList[0].height).toBe(100);
    expect(f2.pictureList[0].data.length).toBe(64);

    // Also check via complexProperties
    const pics = f2.complexProperties("PICTURE");
    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")?.toString()).toBe("image/png");
  });
});
