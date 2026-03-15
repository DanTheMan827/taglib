import { describe, it, expect } from "vitest";
import { FileRef } from "../src/fileRef.js";
import { ByteVector } from "../src/byteVector.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";
import { Variant } from "../src/toolkit/variant.js";
import { readTestData } from "./testHelper.js";

describe("Debug MP3 picture", () => {
  it("should debug", async () => {
    const data = readTestData("xing.mp3");
    const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mp3");
    console.log("isNull:", ref.isNull);
    console.log("tag type:", ref.tag()?.constructor.name);
    
    const file = ref.file()!;
    console.log("file type:", file.constructor.name);
    const tag = file.tag();
    console.log("tag type:", tag.constructor.name);
    
    // Check if setComplexProperties on the tag directly returns true
    const pic = new Map<string, Variant>();
    pic.set("data", Variant.fromByteVector(new ByteVector(new Uint8Array(64))));
    pic.set("mimeType", Variant.fromString("image/jpeg"));
    pic.set("description", Variant.fromString("Test"));
    pic.set("pictureType", Variant.fromInt(3));
    
    // Try setting directly on the CombinedTag
    const result = tag.setComplexProperties("PICTURE", [pic]);
    console.log("setComplexProperties on tag result:", result);
    
    // Check keys on tag
    const keys = tag.complexPropertyKeys();
    console.log("keys after set:", keys);
    
    // Check complex properties on tag
    const tagPics = tag.complexProperties("PICTURE");
    console.log("tag pics count:", tagPics.length);
    
    // Now try file level
    const result2 = file.setComplexProperties("PICTURE", [pic]);
    console.log("setComplexProperties on file result:", result2);
    
    file.save();
    
    const stream = file.stream() as ByteVectorStream;
    const modified = stream.data().data;
    console.log("modified size:", modified.length);
    
    const ref2 = await FileRef.fromByteArray(new Uint8Array(modified), "test.mp3");
    const keys2 = ref2.complexPropertyKeys();
    console.log("re-read keys:", keys2);
    const pics2 = ref2.complexProperties("PICTURE");
    console.log("re-read pics count:", pics2.length);

    expect(true).toBe(true);
  });
});
