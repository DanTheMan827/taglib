import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { FileRef } from "../fileRef.js";
import { MatroskaFile } from "../matroska/matroskaFile.js";
import { type SimpleTag, TargetTypeValue } from "../matroska/matroskaTag.js";
import { ByteVector } from "../byteVector.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import { ReadStyle } from "../toolkit/types.js";
import { Variant } from "../toolkit/variant.js";
import { openTestStream } from "./testHelper.js";

const TEST_DATA_DIR = resolve(import.meta.dirname ?? __dirname, "data");

async function openMatroskaFile(
  filename: string,
  readProperties = true,
  readStyle = ReadStyle.Average,
): Promise<MatroskaFile> {
  const stream = openTestStream(filename);
  return await MatroskaFile.open(stream, readProperties, readStyle);
}

describe("Matroska", () => {
  describe("Properties", () => {
    it("should read MKA properties", async () => {
      // C++: test_matroska.cpp – TestMatroska::testPropertiesMka
      const f = await openMatroskaFile("no-tags.mka");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.lengthInSeconds).toBe(0);
      expect(props!.lengthInMilliseconds).toBe(444);
      expect(props!.bitrate).toBe(223);
      expect(props!.channels).toBe(2);
      expect(props!.sampleRate).toBe(44100);
      expect(props!.docType).toBe("matroska");
      expect(props!.docTypeVersion).toBe(4);
      expect(props!.codecName).toBe("A_MPEG/L3");
      expect(props!.title).toBe("");
    });

    it("should read MKV properties", async () => {
      // C++: test_matroska.cpp – TestMatroska::testPropertiesMkv
      const f = await openMatroskaFile("tags-before-cues.mkv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.lengthInSeconds).toBe(0);
      expect(props!.lengthInMilliseconds).toBe(120);
      expect(props!.bitrate).toBe(227);
      expect(props!.channels).toBe(0);
      expect(props!.sampleRate).toBe(0);
      expect(props!.docType).toBe("matroska");
      expect(props!.docTypeVersion).toBe(4);
      expect(props!.codecName).toBe("");
      expect(props!.title).toBe("handbrake");
    });

    it("should read WebM properties", async () => {
      // C++: test_matroska.cpp – TestMatroska::testPropertiesWebm
      const f = await openMatroskaFile("no-tags.webm");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.lengthInSeconds).toBe(0);
      expect(props!.lengthInMilliseconds).toBe(1);
      expect(props!.bitrate).toBe(2816);
      expect(props!.channels).toBe(0);
      expect(props!.sampleRate).toBe(0);
      expect(props!.docType).toBe("webm");
      expect(props!.docTypeVersion).toBe(4);
      expect(props!.codecName).toBe("");
      expect(props!.title).toBe("");
    });

    it("should not read properties when readProperties=false", async () => {
      // C++: test_matroska.cpp – TestMatroska::testPropertiesWebm
      const f = await openMatroskaFile("no-tags.webm", false);
      expect(f.isValid).toBe(true);
      expect(f.audioProperties()).toBeNull();
    });
  });

  describe("Tags", () => {
    it("should read tags from MKV", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("tags-before-cues.mkv");
      expect(f.isValid).toBe(true);
      // tags-before-cues.mkv has a TITLE tag added by Handbrake
      expect(f.tag()).not.toBeNull();
      expect(f.tag()!.title).toBe("handbrake");
    });

    it("should handle file with no tags", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("no-tags.mka");
      // No tags element in the file - always returns an empty tag
      const tag = f.tag();
      expect(tag).not.toBeNull();
      expect(tag!.isEmpty).toBe(true);
    });

    it("should support PropertyMap interface", async () => {
      // C++: test_matroska.cpp – TestMatroska::testPropertyInterface
      const f = await openMatroskaFile("tags-before-cues.mkv");
      // The file should be readable and produce a PropertyMap
      const props = f.properties();
      expect(props).toBeTruthy();
    });
  });

  describe("Save and re-read", () => {
    it("should save and re-read tags for MKA (no existing tags)", async () => {
      // C++: test_matroska.cpp – TestMatroska::testSimpleTagsAndAttachments
      const origStream = openTestStream("no-tags.mka");
      const f = await MatroskaFile.open(origStream, true, ReadStyle.Accurate);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.isEmpty).toBe(true);
      expect(f.tag()!.attachedFiles.length).toBe(0);

      const tag = f.tag()!;
      tag.addSimpleTag({
        name: "Test Name 2",
        value: "Test Value 2",
        language: "und",
        defaultLanguageFlag: true,
        targetTypeValue: TargetTypeValue.Album,
        trackUid: 0x72ac,
        editionUid: 0xed17,
        chapterUid: 0xca97,
        attachmentUid: 0xa7ac,
      });
      tag.insertSimpleTag(0, {
        name: "Test Name 1",
        value: "Test Value 1",
        language: "en",
        defaultLanguageFlag: true,
        targetTypeValue: TargetTypeValue.Track,
        trackUid: 0,
        editionUid: 0,
        chapterUid: 0,
        attachmentUid: 0,
      });
      tag.insertSimpleTag(1, {
        name: "Test Name 3",
        value: "Test Value 3",
        language: "und",
        defaultLanguageFlag: true,
        targetTypeValue: TargetTypeValue.None,
        trackUid: 0,
        editionUid: 0,
        chapterUid: 0,
        attachmentUid: 0,
      });
      tag.removeSimpleTag(1);
      tag.title = "Test title";
      tag.artist = "Test artist";
      tag.year = 1969;
      tag.attachedFiles.push({
        description: "Cover",
        fileName: "cover.jpg",
        mediaType: "image/jpeg",
        data: ByteVector.fromString("JPEG data"),
        uid: 5081000385627515000, // Note: JS precision loss from 5081000385627515072ULL
      });

      expect(await f.save()).toBe(true);

      const modified = (f.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(modified), true, ReadStyle.Accurate);
      expect(f2.isValid).toBe(true);
      const tag2 = f2.tag()!;
      expect(tag2.isEmpty).toBe(false);

      expect(tag2.title).toBe("Test title");
      expect(tag2.artist).toBe("Test artist");
      expect(tag2.year).toBe(1969);
      expect(tag2.album).toBe("");
      expect(tag2.comment).toBe("");
      expect(tag2.genre).toBe("");
      expect(tag2.track).toBe(0);

      // Verify the simple tags (5 total after round-trip: the (Track,no-uid) group comes
      // first in the rendered file, then the (Album,uids) group second)
      // Rendered order: Test Name 1, TITLE, ARTIST, DATE_RECORDED (all Track/no-uid), then Test Name 2 (Album/uids)
      const simpleTags2 = tag2.simpleTags;
      expect(simpleTags2.length).toBe(5);

      expect(simpleTags2[0].language).toBe("en");
      expect(simpleTags2[0].name).toBe("Test Name 1");
      expect(simpleTags2[0].value).toBe("Test Value 1");
      expect(simpleTags2[0].binaryValue).toBeUndefined();
      expect(simpleTags2[0].defaultLanguageFlag).toBe(true);
      expect(simpleTags2[0].targetTypeValue).toBe(TargetTypeValue.Track);
      expect(simpleTags2[0].trackUid).toBe(0);
      expect(simpleTags2[0].editionUid).toBe(0);
      expect(simpleTags2[0].chapterUid).toBe(0);
      expect(simpleTags2[0].attachmentUid).toBe(0);

      expect(simpleTags2[4].language).toBe("und");
      expect(simpleTags2[4].name).toBe("Test Name 2");
      expect(simpleTags2[4].value).toBe("Test Value 2");
      expect(simpleTags2[4].binaryValue).toBeUndefined();
      expect(simpleTags2[4].defaultLanguageFlag).toBe(true);
      expect(simpleTags2[4].targetTypeValue).toBe(TargetTypeValue.Album);
      expect(simpleTags2[4].trackUid).toBe(0x72ac);
      expect(simpleTags2[4].editionUid).toBe(0xed17);
      expect(simpleTags2[4].chapterUid).toBe(0xca97);
      expect(simpleTags2[4].attachmentUid).toBe(0xa7ac);

      // Check attachments
      expect(tag2.attachedFiles.length).toBe(1);
      expect(tag2.attachedFiles[0].fileName).toBe("cover.jpg");
      expect(tag2.attachedFiles[0].mediaType).toBe("image/jpeg");
      expect(tag2.attachedFiles[0].description).toBe("Cover");
    });

    it("testAddRemoveTagsAttachments", async () => {
      // C++: test_matroska.cpp – TestMatroska::testAddRemoveTagsAttachments
      const origStream = openTestStream("no-tags.mka");
      const f = await MatroskaFile.open(origStream, true, ReadStyle.Accurate);
      f.tag()!.comment = "C";
      expect(await f.save()).toBe(true);

      const data1 = (f.stream() as ByteVectorStream).data();
      const f1 = await MatroskaFile.open(new ByteVectorStream(data1), true, ReadStyle.Accurate);
      expect(f1.isValid).toBe(true);
      expect(f1.tag()!.comment).toBe("C");

      f1.tag()!.comment = "";
      expect(await f1.save()).toBe(true);

      const data2 = (f1.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data2), true, ReadStyle.Accurate);
      expect(f2.isValid).toBe(true);
      expect(f2.tag()!.isEmpty).toBe(true);

      // Add an attachment
      f2.tag()!.attachedFiles.push({
        description: "",
        fileName: "",
        mediaType: "",
        data: new ByteVector(new Uint8Array(0)),
        uid: 0,
      });
      expect(await f2.save()).toBe(true);

      const data3 = (f2.stream() as ByteVectorStream).data();
      const f3 = await MatroskaFile.open(new ByteVectorStream(data3), true, ReadStyle.Accurate);
      expect(f3.isValid).toBe(true);
      expect(f3.tag()!.attachedFiles.length).toBe(1);

      // Remove the attachment
      const uid = f3.tag()!.attachedFiles[0].uid;
      f3.tag()!.attachedFiles = f3.tag()!.attachedFiles.filter(af => af.uid !== uid);
      expect(await f3.save()).toBe(true);

      const data4 = (f3.stream() as ByteVectorStream).data();
      const f4 = await MatroskaFile.open(new ByteVectorStream(data4), true, ReadStyle.Accurate);
      expect(f4.isValid).toBe(true);
      expect(f4.tag()!.isEmpty).toBe(true);
      expect(f4.tag()!.attachedFiles.length).toBe(0);
    });

    it("testTagsWebm", async () => {
      // C++: test_matroska.cpp – TestMatroska::testTagsWebm
      const origStream = openTestStream("no-tags.webm");
      const origData = (origStream as ByteVectorStream).data();
      const f = await MatroskaFile.open(new ByteVectorStream(origData), true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.isEmpty).toBe(true);
      expect(f.tag()!.attachedFiles.length).toBe(0);

      const pm = new PropertyMap();
      pm.insert("ARTIST", ["First artist", "second artist"]);
      f.setProperties(pm);
      // Adding a tag with empty name is invalid and should be ignored on round-trip
      f.tag()!.addSimpleTag({
        name: "",
        value: "",
        binaryValue: ByteVector.fromString("Not valid"),
        language: "und",
        defaultLanguageFlag: true,
        targetTypeValue: TargetTypeValue.None,
        trackUid: 0,
        editionUid: 0,
        chapterUid: 0,
        attachmentUid: 0,
      });
      expect(await f.save()).toBe(true);

      const data1 = (f.stream() as ByteVectorStream).data();
      const f1 = await MatroskaFile.open(new ByteVectorStream(data1), false, ReadStyle.Accurate);
      expect(f1.isValid).toBe(true);
      expect(f1.tag()!.isEmpty).toBe(false);
      expect(f1.tag()!.attachedFiles.length).toBe(0);
      expect(f1.tag()!.artist).toBe("First artist");
      expect(f1.properties().get("ARTIST")).toEqual(["First artist", "second artist"]);

      f1.tag()!.album = "Album";
      f1.tag()!.track = 5;
      expect(await f1.save()).toBe(true);

      const data2 = (f1.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data2), false, ReadStyle.Accurate);
      expect(f2.isValid).toBe(true);
      expect(f2.tag()!.artist).toBe("First artist");
      expect(f2.tag()!.album).toBe("Album");
      expect(f2.tag()!.track).toBe(5);

      f2.tag()!.artist = "";
      // Remove the TITLE tag with Album targetTypeValue (which is ALBUM in PropertyMap)
      f2.tag()!.removeSimpleTag("TITLE", TargetTypeValue.Album);
      f2.tag()!.track = 0;
      expect(await f2.save()).toBe(true);

      const data3 = (f2.stream() as ByteVectorStream).data();
      const f3 = await MatroskaFile.open(new ByteVectorStream(data3), false, ReadStyle.Accurate);
      expect(f3.tag()!.isEmpty).toBe(true);
      expect(f3.tag()!.attachedFiles.length).toBe(0);

      // File with no tags should be byte-identical to original
      expect(data3.equals(origData)).toBe(true);
    });

    it("testRepeatedSave", async () => {
      // C++: test_matroska.cpp – TestMatroska::testRepeatedSave
      const origStream = openTestStream("no-tags.mka");
      const f = await MatroskaFile.open(origStream, true, ReadStyle.Average);
      const text = "01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789";

      expect(await f.save()).toBe(true);
      f.tag()!.title = text.substring(0, 23);
      expect(await f.save()).toBe(true);
      f.tag()!.title = text.substring(0, 5);
      expect(await f.save()).toBe(true);
      f.tag()!.title = text;
      expect(await f.save()).toBe(true);

      const data = (f.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data), true, ReadStyle.Accurate);
      expect(f2.isValid).toBe(true);
      expect(f2.tag()!.title).toBe(text);
    });
  });

  describe("PropertyInterface", () => {
    it("testPropertyInterface", async () => {
      // C++: test_matroska.cpp – TestMatroska::testPropertyInterface
      const f = await openMatroskaFile("tags-before-cues.mkv");
      expect(f.isValid).toBe(true);
      expect(f.tag()!.isEmpty).toBe(false);
      expect(f.tag()!.attachedFiles.length).toBe(0);

      expect(f.tag()!.title).toBe("handbrake");
      expect(f.tag()!.artist).toBe("Actors");
      expect(f.tag()!.album).toBe("");
      expect(f.tag()!.comment).toBe("");
      expect(f.tag()!.genre).toBe("Genre");
      expect(f.tag()!.track).toBe(0);

      const simpleTags = f.tag()!.simpleTags;
      expect(simpleTags.length).toBe(9);

      expect(simpleTags[0].language).toBe("und");
      expect(simpleTags[0].name).toBe("DURATION");
      expect(simpleTags[0].value).toBe("00:00:00.120000000");
      expect(simpleTags[0].binaryValue).toBeUndefined();
      expect(simpleTags[0].defaultLanguageFlag).toBe(true);
      expect(simpleTags[0].targetTypeValue).toBe(TargetTypeValue.None);
      // Note: JS number precision limits trackUid to approximate value for large 64-bit UIDs
      expect(simpleTags[0].trackUid).toBeGreaterThan(0);
      expect(simpleTags[0].editionUid).toBe(0);
      expect(simpleTags[0].chapterUid).toBe(0);
      expect(simpleTags[0].attachmentUid).toBe(0);

      expect(simpleTags[1].name).toBe("ARTIST");
      expect(simpleTags[1].value).toBe("Actors");
      expect(simpleTags[1].targetTypeValue).toBe(TargetTypeValue.Track);
      expect(simpleTags[1].trackUid).toBe(0);

      // Verify complex property key for DURATION
      const keys = f.complexPropertyKeys();
      expect(keys).toContain("DURATION");
      const durationProps = f.complexProperties("DURATION");
      expect(durationProps.length).toBe(1);
      expect(durationProps[0].get("name")?.toString()).toBe("DURATION");
      expect(durationProps[0].get("value")?.toString()).toBe("00:00:00.120000000");

      const initialProps = f.properties();
      expect(initialProps.get("ARTIST")).toEqual(["Actors"]);
      expect(initialProps.get("GENRE")).toEqual(["Genre"]);
    });
  });

  describe("Complex properties", () => {
    it("testComplexProperties", async () => {
      // C++: test_matroska.cpp – TestMatroska::testComplexProperties
      const origStream = openTestStream("no-tags.mka");
      const origData = (origStream as ByteVectorStream).data();
      const f = await MatroskaFile.open(new ByteVectorStream(origData), true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.isEmpty).toBe(true);
      expect(f.tag()!.attachedFiles.length).toBe(0);
      expect(f.complexPropertyKeys()).toEqual([]);
      expect(f.complexProperties("PICTURE")).toEqual([]);

      // Set PICTURE and file.ttf attachments
      const picture: Map<string, ReturnType<typeof Variant.fromString>> = new Map([
        ["data", Variant.fromByteVector(ByteVector.fromString("JPEG data"))],
        ["mimeType", Variant.fromString("image/jpeg")],
        ["description", Variant.fromString("Cover")],
        ["fileName", Variant.fromString("folder.jpg")],
        ["uid", Variant.fromULongLong(123n)],
      ]);
      const font: Map<string, ReturnType<typeof Variant.fromString>> = new Map([
        ["data", Variant.fromByteVector(ByteVector.fromString("TTF data"))],
        ["mimeType", Variant.fromString("font/ttf")],
        ["description", Variant.fromString("Subtitle font")],
        ["fileName", Variant.fromString("file.ttf")],
        ["uid", Variant.fromULongLong(456n)],
      ]);
      expect(f.setComplexProperties("PICTURE", [picture])).toBe(true);
      expect(f.setComplexProperties("file.ttf", [font])).toBe(true);
      expect(await f.save()).toBe(true);

      const data1 = (f.stream() as ByteVectorStream).data();
      const f1 = await MatroskaFile.open(new ByteVectorStream(data1), true, ReadStyle.Accurate);
      expect(f1.isValid).toBe(true);
      expect(f1.tag()!.isEmpty).toBe(true);
      const attachedFiles = f1.tag()!.attachedFiles;
      expect(attachedFiles.length).toBe(2);
      expect(attachedFiles[0].fileName).toBe("folder.jpg");
      expect(attachedFiles[0].mediaType).toBe("image/jpeg");
      expect(attachedFiles[0].description).toBe("Cover");
      expect(attachedFiles[0].uid).toBe(123);
      expect(attachedFiles[1].fileName).toBe("file.ttf");
      expect(attachedFiles[1].mediaType).toBe("font/ttf");
      expect(attachedFiles[1].description).toBe("Subtitle font");
      expect(attachedFiles[1].uid).toBe(456);

      expect(f1.complexPropertyKeys()).toContain("PICTURE");
      expect(f1.complexPropertyKeys()).toContain("file.ttf");

      // Set DURATION complex property (SimpleTag with trackUid)
      const trackUidTag: Map<string, ReturnType<typeof Variant.fromString>> = new Map([
        ["defaultLanguage", Variant.fromBool(true)],
        ["language", Variant.fromString("und")],
        ["name", Variant.fromString("DURATION")],
        ["trackUid", Variant.fromULongLong(8315232342706310039n)],
        ["value", Variant.fromString("00:00:00.120000000")],
      ]);
      expect(f1.setComplexProperties("DURATION", [trackUidTag])).toBe(true);
      expect(await f1.save()).toBe(true);

      const data2 = (f1.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data2), true, ReadStyle.Accurate);
      expect(f2.isValid).toBe(true);
      const st2 = f2.tag()!.simpleTags;
      expect(st2.length).toBe(1);
      expect(st2[0].value).toBe("00:00:00.120000000");
      expect(st2[0].name).toBe("DURATION");
      expect(st2[0].defaultLanguageFlag).toBe(true);
      expect(st2[0].language).toBe("und");
      expect(st2[0].trackUid).toBeGreaterThan(0);
      expect(st2[0].editionUid).toBe(0);
      expect(st2[0].chapterUid).toBe(0);
      expect(st2[0].attachmentUid).toBe(0);
      expect(st2[0].targetTypeValue).toBe(TargetTypeValue.None);

      const keys2 = f2.complexPropertyKeys();
      expect(keys2).toContain("DURATION");
      expect(keys2).toContain("PICTURE");
      expect(keys2).toContain("file.ttf");
    });
  });

  describe("Invalid file handling", () => {
    it("testOpenInvalid", async () => {
      // C++: test_matroska.cpp – TestMatroska::testOpenInvalid
      // Opening a non-Matroska file should fail
      const stream = openTestStream("garbage.mp3");
      const f = await MatroskaFile.open(stream, true);
      expect(f.isValid).toBe(false);

      // Opening a truncated Matroska file should fail
      // (truncate just before the Tracks element at offset 289; SeekHead entry
      // would point beyond the truncated length, causing SeekHead validation to fail
      // in Accurate mode — matching C++ SeekHead::isValid() behavior)
      const origStream = openTestStream("no-tags.mka");
      const origData = (origStream as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(origData), true, ReadStyle.Accurate);
      expect(f2.isValid).toBe(true);

      const truncated = origData.mid(0, 260);
      const f3 = await MatroskaFile.open(new ByteVectorStream(truncated), true, ReadStyle.Accurate);
      expect(f3.isValid).toBe(false);
    });
  });

  describe("Segment size", () => {
    it("testSegmentSizeChange", async () => {
      // C++: test_matroska.cpp – TestMatroska::testSegmentSizeChange
      const origStream = openTestStream("optimized.mkv");
      const f = await MatroskaFile.open(origStream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.isEmpty).toBe(false);
      expect(f.tag()!.attachedFiles.length).toBe(0);

      // Add a large attachment (20000 bytes) to trigger segment size change
      f.tag()!.attachedFiles.push({
        description: "Cover",
        fileName: "cover.jpg",
        mediaType: "image/jpeg",
        data: ByteVector.fromByteArray(new Uint8Array(20000).fill(0x78)), // 'x' * 20000
        uid: 5081000385627515000, // Note: JS precision loss from 5081000385627515072ULL
      });
      expect(await f.save()).toBe(true);

      const data1 = (f.stream() as ByteVectorStream).data();
      const f1 = await MatroskaFile.open(new ByteVectorStream(data1), true, ReadStyle.Accurate);
      expect(f1.isValid).toBe(true);
      expect(f1.tag()!.isEmpty).toBe(false);
      expect(f1.tag()!.attachedFiles.length).toBe(1);
      expect(f1.tag()!.attachedFiles[0].fileName).toBe("cover.jpg");
    });
  });

  describe("Chapters", () => {
    it("testChapters", async () => {
      // C++: test_matroska.cpp – TestMatroska::testChapters
      const origStream = openTestStream("tags-before-cues.mkv");
      const f = await MatroskaFile.open(origStream, true, ReadStyle.Average);
      expect(f.isValid).toBe(true);
      expect(f.tag()!.isEmpty).toBe(false);
      expect(f.tag()!.attachedFiles.length).toBe(0);
      expect(f.chapters()).toBeNull();
      expect(f.complexPropertyKeys()).toContain("DURATION");
      expect(f.complexProperties("CHAPTERS")).toEqual([]);

      // Add a chapter edition with 3 chapters
      f.chapters(true)!.addEdition({
        uid: 0,
        isDefault: true,
        isOrdered: false,
        chapters: [
          {
            uid: 1,
            timeStart: 0,
            timeEnd: 40000,
            isHidden: false,
            displays: [{ string: "Chapter 1", language: "eng" }],
          },
          {
            uid: 2,
            timeStart: 40000,
            timeEnd: 80000,
            isHidden: false,
            displays: [
              { string: "Chapter 2", language: "eng" },
              { string: "Kapitel 2", language: "deu" },
            ],
          },
          {
            uid: 3,
            timeStart: 80000,
            timeEnd: 120000,
            isHidden: true,
            displays: [{ string: "Chapter 3", language: "und" }],
          },
        ],
      });
      expect(await f.save()).toBe(true);

      const data1 = (f.stream() as ByteVectorStream).data();
      const f1 = await MatroskaFile.open(new ByteVectorStream(data1), true, ReadStyle.Average);
      expect(f1.isValid).toBe(true);
      expect(f1.tag()!.isEmpty).toBe(false);
      expect(f1.tag()!.attachedFiles.length).toBe(0);

      const chapters1 = f1.chapters();
      expect(chapters1).not.toBeNull();
      expect(f1.complexPropertyKeys()).toContain("CHAPTERS");
      const chaptersProps = f1.complexProperties("CHAPTERS");
      expect(chaptersProps.length).toBe(1);

      // Check edition properties
      const editions = chapters1!.editions;
      expect(editions.length).toBe(1);
      const edition = editions[0];
      expect(edition.isDefault).toBe(true);
      expect(edition.isOrdered).toBe(false);
      expect(edition.uid).toBe(0);

      // Check chapter list
      const chapterList = edition.chapters;
      expect(chapterList.length).toBe(3);

      expect(chapterList[0].uid).toBe(1);
      expect(chapterList[0].isHidden).toBe(false);
      expect(chapterList[0].timeStart).toBe(0);
      expect(chapterList[0].timeEnd).toBe(40000);
      expect(chapterList[0].displays.length).toBe(1);
      expect(chapterList[0].displays[0].string).toBe("Chapter 1");
      expect(chapterList[0].displays[0].language).toBe("eng");

      expect(chapterList[1].uid).toBe(2);
      expect(chapterList[1].isHidden).toBe(false);
      expect(chapterList[1].timeStart).toBe(40000);
      expect(chapterList[1].timeEnd).toBe(80000);
      expect(chapterList[1].displays.length).toBe(2);
      expect(chapterList[1].displays[0].string).toBe("Chapter 2");
      expect(chapterList[1].displays[0].language).toBe("eng");
      expect(chapterList[1].displays[1].string).toBe("Kapitel 2");
      expect(chapterList[1].displays[1].language).toBe("deu");

      expect(chapterList[2].uid).toBe(3);
      expect(chapterList[2].isHidden).toBe(true);
      expect(chapterList[2].timeStart).toBe(80000);
      expect(chapterList[2].timeEnd).toBe(120000);
      expect(chapterList[2].displays.length).toBe(1);
      expect(chapterList[2].displays[0].string).toBe("Chapter 3");
      expect(chapterList[2].displays[0].language).toBe("und");

      // Check complex properties format
      const chapterEditionProp = chaptersProps[0];
      expect(chapterEditionProp.get("isDefault")?.toBool()).toBe(true);
      expect(chapterEditionProp.has("uid")).toBe(false); // uid=0, omitted
      const chapsCpx = chapterEditionProp.get("chapters")?.toList() ?? [];
      expect(chapsCpx.length).toBe(3);
      expect(chapsCpx[0].toMap().get("uid")?.toLongLong()).toBe(1n);
      expect(chapsCpx[0].toMap().get("timeStart")?.toLongLong()).toBe(0n);
      expect(chapsCpx[0].toMap().get("timeEnd")?.toLongLong()).toBe(40000n);

      // Remove chapters
      f1.setComplexProperties("CHAPTERS", []);
      expect(await f1.save()).toBe(true);

      const data2 = (f1.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data2), true, ReadStyle.Average);
      expect(f2.chapters()).toBeNull();
      expect(f2.complexPropertyKeys()).not.toContain("CHAPTERS");
    });
  });

  describe("FileRef integration", () => {
    it("should detect MKA by extension", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "no-tags.mka"));
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mka");
      expect(ref.isValid).toBe(true);
      expect(ref.audioProperties()).toBeTruthy();
      expect(ref.audioProperties()!.lengthInMilliseconds).toBe(444);
    });

    it("should detect MKV by extension", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "tags-before-cues.mkv"));
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.mkv");
      expect(ref.isValid).toBe(true);
    });

    it("should detect WebM by extension", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "no-tags.webm"));
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.webm");
      expect(ref.isValid).toBe(true);
    });

    it("should detect Matroska by content", async () => {
      // TypeScript-only test
      const data = readFileSync(resolve(TEST_DATA_DIR, "no-tags.mka"));
      // Pass no extension so it falls through to content detection
      const ref = await FileRef.fromByteArray(new Uint8Array(data), "test.unknown");
      expect(ref.isValid).toBe(true);
      expect(ref.audioProperties()!.lengthInMilliseconds).toBe(444);
    });
  });

  describe("Tag title fallback", () => {
    it("should use segment title when no TITLE tag present", async () => {
      // TypeScript-only test
      const f = await openMatroskaFile("tags-before-cues.mkv");
      // MKV with "handbrake" as segment title
      const props = f.audioProperties();
      expect(props).toBeTruthy();
      expect(props!.title).toBe("handbrake");
    });
  });
});

