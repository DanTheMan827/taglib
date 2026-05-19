import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { FileRef } from "../fileRef.js";
import {
  EbmlId,
  combineByteVectors,
  readElement,
  renderEbmlElement,
  renderStringElement,
  renderUintElement,
} from "../matroska/ebml/ebmlElement.js";
import { MatroskaFile, MatroskaWriteStyle } from "../matroska/matroskaFile.js";
import { MatroskaChapters } from "../matroska/matroskaChapters.js";
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

    it("should synthesize UIDs for chapters without ChapterUID", async () => {
      // TypeScript-only test
      const wrappedChapter = renderEbmlElement(
        EbmlId.ChapterAtom,
        combineByteVectors([
          renderUintElement(EbmlId.ChapterTimeStart, 0),
          renderUintElement(EbmlId.ChapterTimeEnd, 1_000),
          renderUintElement(EbmlId.ChapterFlagHidden, 0),
          renderEbmlElement(
            EbmlId.ChapterDisplay,
            combineByteVectors([
              renderStringElement(EbmlId.ChapString, "Wrapped chapter"),
              renderStringElement(EbmlId.ChapLanguage, "eng"),
            ]),
          ),
        ]),
      );
      const orphanChapter = renderEbmlElement(
        EbmlId.ChapterAtom,
        combineByteVectors([
          renderUintElement(EbmlId.ChapterTimeStart, 1_000),
          renderUintElement(EbmlId.ChapterTimeEnd, 2_000),
          renderUintElement(EbmlId.ChapterFlagHidden, 0),
          renderEbmlElement(
            EbmlId.ChapterDisplay,
            combineByteVectors([
              renderStringElement(EbmlId.ChapString, "Orphan chapter"),
              renderStringElement(EbmlId.ChapLanguage, "eng"),
            ]),
          ),
        ]),
      );
      const data = renderEbmlElement(
        EbmlId.Chapters,
        combineByteVectors([
          renderEbmlElement(
            EbmlId.EditionEntry,
            combineByteVectors([
              renderUintElement(EbmlId.EditionFlagDefault, 1),
              renderUintElement(EbmlId.EditionFlagOrdered, 0),
              wrappedChapter,
            ]),
          ),
          orphanChapter,
        ]),
      );
      const stream = new ByteVectorStream(data);
      const chaptersEl = await readElement(stream);

      expect(chaptersEl).not.toBeNull();
      expect(chaptersEl!.id).toBe(EbmlId.Chapters);

      const chapters = await MatroskaChapters.parseFromStream(stream, chaptersEl!);
      expect(chapters.editions.length).toBe(2);

      const wrappedEdition = chapters.editions[0];
      expect(wrappedEdition.chapters.length).toBe(1);
      expect(wrappedEdition.chapters[0].uid).toBeGreaterThan(0);
      expect(wrappedEdition.chapters[0].displays[0].string).toBe("Wrapped chapter");

      const orphanEdition = chapters.editions[1];
      expect(orphanEdition.isDefault).toBe(true);
      expect(orphanEdition.chapters.length).toBe(1);
      expect(orphanEdition.chapters[0].uid).toBeGreaterThan(0);
      expect(orphanEdition.chapters[0].displays[0].string).toBe("Orphan chapter");

      expect(wrappedEdition.chapters[0].uid).not.toBe(orphanEdition.chapters[0].uid);
    });
  });

  describe("WriteStyle", () => {
    it("testSaveTypes", async () => {
      // C++: test_matroska.cpp – TestMatroska::testSaveTypes
      const setLargeTags = (f: MatroskaFile) => {
        const tag = f.tag()!;
        tag.simpleTags.push(
          { name: "TITLE", value: "A Very Long Title That Takes Up A Lot Of Space In The File 1234567890", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
          { name: "ARTIST", value: "A Very Long Artist Name That Takes Up A Lot Of Space In The File 1234567890", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        );
      };
      const setSmallTags = (f: MatroskaFile) => {
        const tag = f.tag()!;
        tag.simpleTags.push(
          { name: "TITLE", value: "Short", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        );
      };
      const setMediumTags = (f: MatroskaFile) => {
        const tag = f.tag()!;
        tag.simpleTags.push(
          { name: "TITLE", value: "Medium Title 12345678901234", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
          { name: "ARTIST", value: "Medium Artist", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        );
      };
      const setExtraLargeTags = (f: MatroskaFile) => {
        const tag = f.tag()!;
        tag.simpleTags.push(
          { name: "TITLE", value: "An Extremely Long Title That Is Even Larger Than The Previous Large Title With Extra Content To Ensure Growth 0123456789ABCDEF", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
          { name: "ARTIST", value: "An Extremely Long Artist Name Exceeding The Prior Large Artist Value With Even More Content To Guarantee Growth 0123456789ABCDEF", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        );
      };

      const setLargeAttachments = (f: MatroskaFile) => {
        f.tag()!.attachedFiles.push({ data: ByteVector.fromByteArray(new Uint8Array(200).fill(0x78)), fileName: "cover.jpg", mediaType: "image/jpeg", uid: 111, description: "Cover" });
      };
      const setSmallAttachments = (f: MatroskaFile) => {
        f.tag()!.attachedFiles.push({ data: ByteVector.fromByteArray(new Uint8Array(20).fill(0x78)), fileName: "img.png", mediaType: "image/png", uid: 222, description: "Img" });
      };
      const setMediumAttachments = (f: MatroskaFile) => {
        f.tag()!.attachedFiles.push({ data: ByteVector.fromByteArray(new Uint8Array(80).fill(0x78)), fileName: "cover.jpg", mediaType: "image/jpeg", uid: 333, description: "Cover" });
      };
      const setExtraLargeAttachments = (f: MatroskaFile) => {
        f.tag()!.attachedFiles.push({ data: ByteVector.fromByteArray(new Uint8Array(500).fill(0x78)), fileName: "cover.jpg", mediaType: "image/jpeg", uid: 444, description: "Cover" });
      };

      const setLargeChapters = (f: MatroskaFile) => {
        f.chapters(true)!.addEdition({ uid: 0, isDefault: true, isOrdered: false, chapters: [
          { uid: 1, timeStart: 0, timeEnd: 40000, isHidden: false, displays: [{ string: "Chapter One Long Name", language: "eng" }] },
          { uid: 2, timeStart: 40000, timeEnd: 80000, isHidden: false, displays: [{ string: "Chapter Two Long Name", language: "eng" }] },
        ] });
      };
      const setSmallChapters = (f: MatroskaFile) => {
        f.chapters(true)!.addEdition({ uid: 0, isDefault: false, isOrdered: false, chapters: [
          { uid: 1, timeStart: 0, timeEnd: 1000, isHidden: false, displays: [{ string: "A", language: "und" }] },
        ] });
      };
      const setMediumChapters = (f: MatroskaFile) => {
        f.chapters(true)!.addEdition({ uid: 0, isDefault: true, isOrdered: false, chapters: [
          { uid: 1, timeStart: 0, timeEnd: 40000, isHidden: false, displays: [{ string: "Chapter Medium", language: "eng" }] },
        ] });
      };
      const setExtraLargeChapters = (f: MatroskaFile) => {
        f.chapters(true)!.addEdition({ uid: 0, isDefault: true, isOrdered: true, chapters: [
          { uid: 1, timeStart: 0, timeEnd: 40000, isHidden: false, displays: [{ string: "Chapter One Extremely Long Name Here", language: "eng" }, { string: "Kapitel Eins Sehr Langer Name", language: "deu" }] },
          { uid: 2, timeStart: 40000, timeEnd: 80000, isHidden: false, displays: [{ string: "Chapter Two Extremely Long Name Here", language: "eng" }, { string: "Kapitel Zwei Sehr Langer Name", language: "deu" }] },
          { uid: 3, timeStart: 80000, timeEnd: 120000, isHidden: true, displays: [{ string: "Chapter Three Extra Large", language: "eng" }] },
        ] });
      };

      const verifyRound = async (
        data: ByteVector,
        label: string,
        expectedTitle: string,
        expectedAttachmentUid: number,
        expectedChapterCount: number,
        expectedFirstChapterEnd: number,
      ) => {
        const f = await MatroskaFile.open(new ByteVectorStream(data), true, ReadStyle.Accurate);
        expect(f.isValid, `${label} valid`).toBe(true);
        const tag = f.tag()!;
        const foundTitle = tag.simpleTags.some(st => st.name === "TITLE" && st.value === expectedTitle);
        expect(foundTitle, `${label} TITLE roundtrip`).toBe(true);
        const foundAtt = tag.attachedFiles.some(a => a.uid === expectedAttachmentUid);
        expect(foundAtt, `${label} attachment uid roundtrip`).toBe(true);
        const chs = f.chapters()!;
        expect(chs, `${label} chapters`).not.toBeNull();
        expect(chs.editions.length, `${label} edition count`).toBe(1);
        const edition = chs.editions[0];
        expect(edition.chapters.length, `${label} chapter count`).toBe(expectedChapterCount);
        expect(edition.chapters[0].timeEnd, `${label} first chapter end`).toBe(expectedFirstChapterEnd);
      };

      for (const writeStyle of [MatroskaWriteStyle.Compact, MatroskaWriteStyle.DoNotShrink, MatroskaWriteStyle.AvoidInsert]) {
        // Start from a clean file each write-style iteration
        const origStream = openTestStream("no-tags.mka");
        const f1 = await MatroskaFile.open(origStream, true, ReadStyle.Average);

        // --- Round 1: save large data ---
        setLargeTags(f1);
        setLargeAttachments(f1);
        setLargeChapters(f1);
        expect(await f1.save(writeStyle), `Round1 save ws=${writeStyle}`).toBe(true);
        const sizeAfterRound1 = (f1.stream() as ByteVectorStream).data().length;
        await verifyRound((f1.stream() as ByteVectorStream).data(), `Round1 ws=${writeStyle}`,
          "A Very Long Title That Takes Up A Lot Of Space In The File 1234567890", 111, 2, 40000);

        // --- Round 2: save smaller data ---
        f1.tag()!.simpleTags.splice(0);
        f1.tag()!.attachedFiles = [];
        f1.chapters()!.editions.splice(0);
        setSmallTags(f1);
        setSmallAttachments(f1);
        setSmallChapters(f1);
        expect(await f1.save(writeStyle), `Round2 save ws=${writeStyle}`).toBe(true);
        const sizeAfterRound2 = (f1.stream() as ByteVectorStream).data().length;
        await verifyRound((f1.stream() as ByteVectorStream).data(), `Round2 ws=${writeStyle}`,
          "Short", 222, 1, 1000);

        if (writeStyle === MatroskaWriteStyle.Compact) {
          expect(sizeAfterRound2, `Compact Round2 < Round1 ws=${writeStyle}`).toBeLessThan(sizeAfterRound1);
        } else if (writeStyle === MatroskaWriteStyle.AvoidInsert) {
          expect(sizeAfterRound2, `AvoidInsert Round2 <= Round1 ws=${writeStyle}`).toBeLessThanOrEqual(sizeAfterRound1);
        } else {
          expect(sizeAfterRound2, `DoNotShrink Round2 = Round1 ws=${writeStyle}`).toBe(sizeAfterRound1);
        }

        // --- Round 3: save medium data ---
        f1.tag()!.simpleTags.splice(0);
        f1.tag()!.attachedFiles = [];
        f1.chapters()!.editions.splice(0);
        setMediumTags(f1);
        setMediumAttachments(f1);
        setMediumChapters(f1);
        expect(await f1.save(writeStyle), `Round3 save ws=${writeStyle}`).toBe(true);
        const sizeAfterRound3 = (f1.stream() as ByteVectorStream).data().length;
        await verifyRound((f1.stream() as ByteVectorStream).data(), `Round3 ws=${writeStyle}`,
          "Medium Title 12345678901234", 333, 1, 40000);

        if (writeStyle === MatroskaWriteStyle.Compact) {
          expect(sizeAfterRound3, `Compact Round3 != Round2 ws=${writeStyle}`).not.toBe(sizeAfterRound2);
          expect(sizeAfterRound3, `Compact Round3 < Round1 ws=${writeStyle}`).toBeLessThan(sizeAfterRound1);
        } else if (writeStyle === MatroskaWriteStyle.AvoidInsert) {
          expect(sizeAfterRound3, `AvoidInsert Round3 <= Round1 ws=${writeStyle}`).toBeLessThanOrEqual(sizeAfterRound1);
        } else {
          expect(sizeAfterRound3, `DoNotShrink Round3 = Round1 ws=${writeStyle}`).toBe(sizeAfterRound1);
        }

        // --- Round 4: save extra-large data ---
        f1.tag()!.simpleTags.splice(0);
        f1.tag()!.attachedFiles = [];
        f1.chapters()!.editions.splice(0);
        setExtraLargeTags(f1);
        setExtraLargeAttachments(f1);
        setExtraLargeChapters(f1);
        expect(await f1.save(writeStyle), `Round4 save ws=${writeStyle}`).toBe(true);
        const sizeAfterRound4 = (f1.stream() as ByteVectorStream).data().length;
        await verifyRound((f1.stream() as ByteVectorStream).data(), `Round4 ws=${writeStyle}`,
          "An Extremely Long Title That Is Even Larger Than The Previous Large Title With Extra Content To Ensure Growth 0123456789ABCDEF",
          444, 3, 40000);

        expect(sizeAfterRound4, `Round4 > Round1 all styles ws=${writeStyle}`).toBeGreaterThan(sizeAfterRound1);
      }
    });

    it("testSaveTypesBeforeCues", async () => {
      // C++: test_matroska.cpp – TestMatroska::testSaveTypesBeforeCues
      // tags-before-cues.mkv layout:
      //   SeekHead | Void | SegInfo | Tracks | Tags | Cluster | Cues
      const origStream = openTestStream("tags-before-cues.mkv");
      const origF = await MatroskaFile.open(origStream, true, ReadStyle.Average);
      const origData = (origF.stream() as ByteVectorStream).data();

      // Cluster ID does not appear in the SeekHead of this file
      const clusterIdBytes = ByteVector.fromUInt(0x1F43B675, true);
      const tagsIdBytes    = ByteVector.fromUInt(0x1254C367, true);
      const cuesIdBytes    = ByteVector.fromUInt(0x1C53BB6B, true);
      const origClusterPos = origData.find(clusterIdBytes);
      expect(origClusterPos).toBeGreaterThan(0);

      const longTitle = "An Extremely Long Title Value That Is Definitely Larger Than The Original Tags Element In The File Because It Contains Many Characters To Ensure That The AvoidInsert Move-To-End Behavior Triggers Here";
      const longArtist = "An Extremely Long Artist Name Value That Is Also Larger Than The Original Tags Element And Together With The Title Tag Makes The Rendered Output Exceed The Original Tags Size So The AvoidInsert Triggers";

      for (const writeStyle of [MatroskaWriteStyle.Compact, MatroskaWriteStyle.DoNotShrink, MatroskaWriteStyle.AvoidInsert]) {
        const wsLabel = `ws=${writeStyle}`;
        // Start fresh from original for each write style
        const stream1 = new ByteVectorStream(origData);
        const f = await MatroskaFile.open(stream1, true, ReadStyle.Average);
        expect(f.isValid, `Open ${wsLabel}`).toBe(true);

        // Clear existing simple tags and set long new ones
        f.tag()!.simpleTags.splice(0);
        f.tag()!.simpleTags.push(
          { name: "TITLE", value: longTitle, language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
          { name: "ARTIST", value: longArtist, language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        );
        expect(await f.save(writeStyle), `Save ${wsLabel}`).toBe(true);

        // Validate with Accurate mode (verifies SeekHead entries)
        const savedData = (f.stream() as ByteVectorStream).data();
        const f2 = await MatroskaFile.open(new ByteVectorStream(savedData), true, ReadStyle.Accurate);
        expect(f2.isValid, `Reopen valid ${wsLabel}`).toBe(true);
        const tag2 = f2.tag();
        expect(tag2, `Tag exists ${wsLabel}`).not.toBeNull();
        const foundTitle = tag2!.simpleTags.some(st => st.name === "TITLE" && st.value === longTitle);
        const foundArtist = tag2!.simpleTags.some(st => st.name === "ARTIST" && st.value === longArtist);
        expect(foundTitle, `TITLE roundtrip ${wsLabel}`).toBe(true);
        expect(foundArtist, `ARTIST roundtrip ${wsLabel}`).toBe(true);

        const newClusterPos = savedData.find(clusterIdBytes);
        expect(newClusterPos, `Cluster present ${wsLabel}`).toBeGreaterThan(0);

        if (writeStyle === MatroskaWriteStyle.AvoidInsert) {
          // Cluster must NOT shift in AvoidInsert mode
          expect(newClusterPos, `AvoidInsert must not shift Cluster`).toBe(origClusterPos);
          // Tags must be appended after Cues
          const cuesPos    = savedData.find(cuesIdBytes, newClusterPos);
          const newTagsPos = savedData.find(tagsIdBytes, cuesPos + 4);
          expect(newTagsPos, `Tags appended after Cues ${wsLabel}`).toBeGreaterThan(cuesPos);
        } else {
          // Compact/DoNotShrink: Tags grew in place → Cluster must shift
          expect(newClusterPos, `Cluster must shift when growing in place ${wsLabel}`).toBeGreaterThan(origClusterPos);
        }
      }
    });

    it("testSaveTypesNoTrailingVoid", async () => {
      // C++: test_matroska.cpp – TestMatroska::testSaveTypesNoTrailingVoid
      const origStream = openTestStream("tags-before-cues.mkv");
      const origF = await MatroskaFile.open(origStream, true, ReadStyle.Average);
      const origData = (origF.stream() as ByteVectorStream).data();

      const longTitle = "An Extremely Long Title Value That Is Definitely Larger Than The Original Tags Element In The File Because It Contains Many Characters To Ensure That The AvoidInsert Move-To-End Behavior Triggers Here";
      const longArtist = "An Extremely Long Artist Name Value That Is Also Larger Than The Original Tags Element And Together With The Title Tag Makes The Rendered Output Exceed The Original Tags Size So The AvoidInsert Triggers";

      // Round 1: enlarge Tags so they get moved to the end (AvoidInsert)
      const stream1 = new ByteVectorStream(origData);
      const f1 = await MatroskaFile.open(stream1, true, ReadStyle.Average);
      expect(f1.isValid).toBe(true);
      f1.tag()!.simpleTags.splice(0);
      f1.tag()!.simpleTags.push(
        { name: "TITLE", value: longTitle, language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        { name: "ARTIST", value: longArtist, language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
      );
      expect(await f1.save(MatroskaWriteStyle.AvoidInsert)).toBe(true);
      const sizeAfterRound1 = (f1.stream() as ByteVectorStream).data().length;

      // Round 2: shrink Tags – trailing element must shrink without leaving a Void
      const data1 = (f1.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data1), true, ReadStyle.Average);
      expect(f2.isValid).toBe(true);
      f2.tag()!.simpleTags.splice(0);
      f2.tag()!.simpleTags.push(
        { name: "TITLE", value: "X", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
      );
      expect(await f2.save(MatroskaWriteStyle.AvoidInsert)).toBe(true);

      const f3 = await MatroskaFile.open(new ByteVectorStream((f2.stream() as ByteVectorStream).data()), true, ReadStyle.Accurate);
      expect(f3.isValid).toBe(true);
      expect(f3.tag()).not.toBeNull();

      const newData = (f2.stream() as ByteVectorStream).data();

      // File must have shrunk
      expect(newData.length).toBeLessThan(sizeAfterRound1);

      // The last bytes must be the (small) Tags element, not a Void.
      // Find Tags element after Cues and verify the file ends exactly at Tags' end.
      const clusterIdBytes = ByteVector.fromUInt(0x1F43B675, true);
      const cuesIdBytes    = ByteVector.fromUInt(0x1C53BB6B, true);
      const tagsIdBytes    = ByteVector.fromUInt(0x1254C367, true);
      const clusterPos = newData.find(clusterIdBytes);
      const cuesPos    = newData.find(cuesIdBytes, clusterPos);
      const tagsPos    = newData.find(tagsIdBytes, cuesPos + 4);
      expect(tagsPos).toBeGreaterThan(cuesPos);

      // Decode VINT data size of the Tags element (4-byte ID, then VINT)
      const vintFirst = newData.get(tagsPos + 4);
      let vintLen = 1;
      for (let b = 0; b < 8; b++) {
        if (vintFirst & (0x80 >> b)) { vintLen = b + 1; break; }
      }
      let dataSize = vintFirst & ((0x80 >> (vintLen - 1)) - 1);
      for (let i = 1; i < vintLen; i++) {
        dataSize = (dataSize * 256) + newData.get(tagsPos + 4 + i);
      }
      const tagsEnd = tagsPos + 4 + vintLen + dataSize;
      expect(tagsEnd, "No trailing EBML void must remain at the end of the segment").toBe(newData.length);
    });

    it("testSaveTypesReclaimVoid", async () => {
      // C++: test_matroska.cpp – TestMatroska::testSaveTypesReclaimVoid
      const origStream = openTestStream("tags-before-cues.mkv");
      const origF = await MatroskaFile.open(origStream, true, ReadStyle.Average);
      const origData = (origF.stream() as ByteVectorStream).data();

      const longTitle = "An Extremely Long Title Value That Is Definitely Larger Than The Original Tags Element In The File Because It Contains Many Characters To Ensure That The AvoidInsert Move-To-End Behavior Triggers Here";
      const longArtist = "An Extremely Long Artist Name Value That Is Also Larger Than The Original Tags Element And Together With The Title Tag Makes The Rendered Output Exceed The Original Tags Size So The AvoidInsert Triggers";

      // Step 1: AvoidInsert with enlarged Tags → Tags moved to end, Void in original slot
      const stream1 = new ByteVectorStream(origData);
      const f1 = await MatroskaFile.open(stream1, true, ReadStyle.Average);
      expect(f1.isValid).toBe(true);
      f1.tag()!.simpleTags.splice(0);
      f1.tag()!.simpleTags.push(
        { name: "TITLE", value: longTitle, language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
        { name: "ARTIST", value: longArtist, language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
      );
      expect(await f1.save(MatroskaWriteStyle.AvoidInsert)).toBe(true);
      const sizeAfterAvoidInsert = (f1.stream() as ByteVectorStream).data().length;
      expect(sizeAfterAvoidInsert).toBeGreaterThan(origData.length);

      // Step 2: Compact with short tag – reclaim the void from the prior move
      const data1 = (f1.stream() as ByteVectorStream).data();
      const f2 = await MatroskaFile.open(new ByteVectorStream(data1), true, ReadStyle.Average);
      expect(f2.isValid).toBe(true);
      f2.tag()!.simpleTags.splice(0);
      f2.tag()!.simpleTags.push(
        { name: "TITLE", value: "X", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
      );
      expect(await f2.save(MatroskaWriteStyle.Compact)).toBe(true);
      const sizeAfterCompact = (f2.stream() as ByteVectorStream).data().length;
      expect(sizeAfterCompact, "Compact must reclaim space after AvoidInsert grew the file").toBeLessThan(sizeAfterAvoidInsert);

      // Reference: applying Compact directly to original with same tiny tags
      const refStream = new ByteVectorStream(origData);
      const fRef = await MatroskaFile.open(refStream, true, ReadStyle.Average);
      fRef.tag()!.simpleTags.splice(0);
      fRef.tag()!.simpleTags.push(
        { name: "TITLE", value: "X", language: "und", defaultLanguageFlag: true, targetTypeValue: TargetTypeValue.Track, trackUid: 0, editionUid: 0, chapterUid: 0, attachmentUid: 0 },
      );
      expect(await fRef.save(MatroskaWriteStyle.Compact)).toBe(true);
      const referenceCompactSize = (fRef.stream() as ByteVectorStream).data().length;
      expect(referenceCompactSize).toBeLessThanOrEqual(sizeAfterCompact);

      // File must round-trip correctly
      const f3 = await MatroskaFile.open(new ByteVectorStream((f2.stream() as ByteVectorStream).data()), true, ReadStyle.Accurate);
      expect(f3.isValid).toBe(true);
      const tag3 = f3.tag();
      expect(tag3).not.toBeNull();
      const foundTitle = tag3!.simpleTags.some(st => st.name === "TITLE" && st.value === "X");
      expect(foundTitle).toBe(true);
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
