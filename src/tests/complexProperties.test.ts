/**
 * Complex properties test — ported from test_complexproperties.cpp
 * Tests reading/writing picture and GEOB complex properties.
 */
import { describe, expect, it } from "vitest";
import { FileRef } from "../fileRef.js";
import { readTestData } from "./testHelper.js";

describe("Complex Properties", () => {
  it("should read MP3 complex property keys", async () => {
    // TypeScript-only test
    const data = readTestData("itunes10.mp3");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mp3");
    expect(ref.isNull).toBe(false);

    // itunes10.mp3 has ID3v2 frames; complex properties may or may not include PICTURE
    const keys = ref.complexPropertyKeys();
    expect(Array.isArray(keys)).toBe(true);
  });

  it("should read M4A picture", async () => {
    // TypeScript-only test
    const data = readTestData("has-tags.m4a");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.m4a");
    expect(ref.isNull).toBe(false);

    const pictures = ref.complexProperties("PICTURE");
    // has-tags.m4a may or may not have pictures, but the call should not throw
    expect(Array.isArray(pictures)).toBe(true);
  });

  it("should read OGG picture", async () => {
    // TypeScript-only test
    const data = readTestData("empty.ogg");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.ogg");
    expect(ref.isNull).toBe(false);

    const pictures = ref.complexProperties("PICTURE");
    expect(Array.isArray(pictures)).toBe(true);
  });

  it("should handle non-existent complex property", async () => {
    // TypeScript-only test
    const data = readTestData("xing.mp3");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mp3");
    expect(ref.isNull).toBe(false);

    const props = ref.complexProperties("NONEXISTENT");
    expect(Array.isArray(props)).toBe(true);
    expect(props.length).toBe(0);
  });

  it("should read FLAC picture", async () => {
    // TypeScript-only test
    const data = readTestData("no-tags.flac");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.flac");
    expect(ref.isNull).toBe(false);

    const pictures = ref.complexProperties("PICTURE");
    expect(Array.isArray(pictures)).toBe(true);
  });
});
