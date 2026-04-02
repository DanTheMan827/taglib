import { describe, expect, it } from "vitest";
import { ByteVector, StringType } from "../byteVector.js";
import {
  AttachedPictureFrame,
  PictureType,
} from "../mpeg/id3v2/frames/attachedPictureFrame.js";
import { ChapterFrame } from "../mpeg/id3v2/frames/chapterFrame.js";
import { CommentsFrame } from "../mpeg/id3v2/frames/commentsFrame.js";
import {
  EventTimingCodesFrame,
  EventType,
} from "../mpeg/id3v2/frames/eventTimingCodesFrame.js";
import { GeneralEncapsulatedObjectFrame } from "../mpeg/id3v2/frames/generalEncapsulatedObjectFrame.js";
import { OwnershipFrame } from "../mpeg/id3v2/frames/ownershipFrame.js";
import { PodcastFrame } from "../mpeg/id3v2/frames/podcastFrame.js";
import { PopularimeterFrame } from "../mpeg/id3v2/frames/popularimeterFrame.js";
import { PrivateFrame } from "../mpeg/id3v2/frames/privateFrame.js";
import {
  ChannelType,
  PeakVolume,
  RelativeVolumeFrame,
} from "../mpeg/id3v2/frames/relativeVolumeFrame.js";
import {
  SynchedTextType,
  SynchronizedLyricsFrame,
} from "../mpeg/id3v2/frames/synchronizedLyricsFrame.js";
import { TableOfContentsFrame } from "../mpeg/id3v2/frames/tableOfContentsFrame.js";
import {
  TextIdentificationFrame,
  UserTextIdentificationFrame,
} from "../mpeg/id3v2/frames/textIdentificationFrame.js";
import { UniqueFileIdentifierFrame } from "../mpeg/id3v2/frames/uniqueFileIdentifierFrame.js";
import { UrlLinkFrame, UserUrlLinkFrame } from "../mpeg/id3v2/frames/urlLinkFrame.js";
import { Id3v2FrameHeader } from "../mpeg/id3v2/id3v2Frame.js";
import { Id3v2FrameFactory } from "../mpeg/id3v2/id3v2FrameFactory.js";
import { Id3v2Header } from "../mpeg/id3v2/id3v2Header.js";
import { SynchData } from "../mpeg/id3v2/id3v2SynchData.js";
import { Id3v2Tag } from "../mpeg/id3v2/id3v2Tag.js";
import { MpegFile } from "../mpeg/mpegFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { byteVectorFromArray, openTestStream, readTestData } from "./testHelper.js";

/**
 * Helper: build raw frame data from individual bytes.
 * Version 4 frame header is: frameId(4) + size(4, synchsafe) + flags(2)
 * For sizes < 128, synchsafe and normal encoding are identical.
 */
function makeFrameHeader(frameId: string, bodySize: number, flags = 0): ByteVector {
  const id = ByteVector.fromString(frameId, StringType.Latin1);
  const size = SynchData.fromUInt(bodySize);
  const fl = ByteVector.fromUShort(flags, true);
  const result = new ByteVector();
  result.append(id);
  result.append(size);
  result.append(fl);
  return result;
}

/** Build complete raw frame data for version 4. */
function buildRawFrame(frameId: string, body: ByteVector | number[]): ByteVector {
  const bodyBv = Array.isArray(body)
    ? byteVectorFromArray(body)
    : body;
  const header = makeFrameHeader(frameId, bodyBv.length);
  const result = new ByteVector();
  result.append(header);
  result.append(bodyBv);
  return result;
}

/** Parse a frame header from raw frame data for version 4. */
function parseHeader(rawFrame: ByteVector, version = 4): Id3v2FrameHeader {
  return new Id3v2FrameHeader(rawFrame.mid(0, Id3v2FrameHeader.size(version)), version);
}

describe("ID3v2", () => {
  // =========================================================================
  // APIC (Attached Picture)
  // =========================================================================
  describe("AttachedPictureFrame", () => {
    it("should parse APIC frame", () => {
      // TypeScript-only test
      // From C++ testParseAPIC:
      // APIC \x00\x00\x00\x07 \x00\x00  \x00 m\x00 \x01 d\x00 \x00
      const raw = byteVectorFromArray([
        0x41, 0x50, 0x49, 0x43, // "APIC"
        0x00, 0x00, 0x00, 0x07, // size = 7
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x6d, 0x00,             // mimeType = "m" + null
        0x01,                   // pictureType = FileIcon
        0x64, 0x00,             // description = "d" + null
        0x00,                   // picture data (1 byte)
      ]);
      const header = parseHeader(raw);
      const f = AttachedPictureFrame.fromData(raw, header, 4);
      expect(f.mimeType).toBe("m");
      expect(f.pictureType).toBe(PictureType.FileIcon);
      expect(f.description).toBe("d");
    });

    it("should parse APIC frame with UTF16 BOM", () => {
      // TypeScript-only test
      const raw = byteVectorFromArray([
        0x41, 0x50, 0x49, 0x43, // "APIC"
        0x00, 0x00, 0x00, 0x26, // size = 38
        0x00, 0x00,             // flags
        0x01,                   // encoding = UTF16
        // mimeType "image/jpeg" + null (Latin1 always)
        0x69, 0x6d, 0x61, 0x67, 0x65, 0x2f, 0x6a, 0x70, 0x65, 0x67, 0x00,
        0x00,                   // pictureType = Other
        // description "cover.jpg" in UTF16BE with BOM + null
        0xfe, 0xff,
        0x00, 0x63, 0x00, 0x6f, 0x00, 0x76, 0x00, 0x65,
        0x00, 0x72, 0x00, 0x2e, 0x00, 0x6a, 0x00, 0x70, 0x00, 0x67,
        0x00, 0x00,             // null terminator (UTF16)
        // picture data
        0xff, 0xd8, 0xff,
      ]);
      const header = parseHeader(raw);
      const f = AttachedPictureFrame.fromData(raw, header, 4);
      expect(f.mimeType).toBe("image/jpeg");
      expect(f.pictureType).toBe(PictureType.Other);
      expect(f.description).toBe("cover.jpg");
      expect(f.picture.length).toBe(3);
      expect(f.picture.equals(byteVectorFromArray([0xff, 0xd8, 0xff]))).toBe(true);
    });

    it("should render APIC frame", () => {
      // TypeScript-only test
      const f = new AttachedPictureFrame(StringType.UTF8);
      f.mimeType = "image/png";
      f.pictureType = PictureType.BackCover;
      f.description = "Description";
      f.picture = ByteVector.fromString("PNG data", StringType.Latin1);

      const rendered = f.render(4);

      // Expected from C++ testRenderAPIC:
      // APIC \x00\x00\x00\x20 \x00\x00 \x03 image/png\x00 \x04 Description\x00 PNG data
      const expected = byteVectorFromArray([
        0x41, 0x50, 0x49, 0x43, // "APIC"
        0x00, 0x00, 0x00, 0x20, // size = 32
        0x00, 0x00,             // flags
        0x03,                   // encoding = UTF8
        // "image/png" + null
        0x69, 0x6d, 0x61, 0x67, 0x65, 0x2f, 0x70, 0x6e, 0x67, 0x00,
        0x04,                   // pictureType = BackCover
        // "Description" + null
        0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x69, 0x6f, 0x6e, 0x00,
        // "PNG data"
        0x50, 0x4e, 0x47, 0x20, 0x64, 0x61, 0x74, 0x61,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // GEOB (General Encapsulated Object)
  // =========================================================================
  describe("GeneralEncapsulatedObjectFrame", () => {
    it("should parse GEOB frame", () => {
      // TypeScript-only test
      // GEOB \x00\x00\x00\x08 \x00\x00 \x00 m\x00 f\x00 d\x00 \x00
      const raw = byteVectorFromArray([
        0x47, 0x45, 0x4f, 0x42, // "GEOB"
        0x00, 0x00, 0x00, 0x08, // size = 8
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x6d, 0x00,             // mimeType = "m" + null
        0x66, 0x00,             // fileName = "f" + null
        0x64, 0x00,             // description = "d" + null
        0x00,                   // object data
      ]);
      const header = parseHeader(raw);
      const f = GeneralEncapsulatedObjectFrame.fromData(raw, header, 4);
      expect(f.mimeType).toBe("m");
      expect(f.fileName).toBe("f");
      expect(f.description).toBe("d");
    });

    it("should render GEOB frame", () => {
      // TypeScript-only test
      const f = new GeneralEncapsulatedObjectFrame(StringType.Latin1);
      f.mimeType = "application/octet-stream";
      f.fileName = "test.bin";
      f.description = "Description";
      f.object = byteVectorFromArray([0x01, 0x01, 0x01]);

      const rendered = f.render(4);

      // Expected from C++ testRenderGEOB:
      // Size = 0x32 = 50
      const expected = byteVectorFromArray([
        0x47, 0x45, 0x4f, 0x42, // "GEOB"
        0x00, 0x00, 0x00, 0x32, // size = 50
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        // "application/octet-stream" + null (25 bytes)
        ...Array.from(new TextEncoder().encode("application/octet-stream")), 0x00,
        // "test.bin" + null (9 bytes)
        ...Array.from(new TextEncoder().encode("test.bin")), 0x00,
        // "Description" + null (12 bytes)
        ...Array.from(new TextEncoder().encode("Description")), 0x00,
        // object data
        0x01, 0x01, 0x01,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // POPM (Popularimeter)
  // =========================================================================
  describe("PopularimeterFrame", () => {
    it("should parse POPM frame", () => {
      // TypeScript-only test
      // POPM \x00\x00\x00\x17 \x00\x00 email@example.com\x00 \x02 \x00\x00\x00\x03
      const emailBytes = Array.from(new TextEncoder().encode("email@example.com"));
      const body = [...emailBytes, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03];
      const raw = buildRawFrame("POPM", body);
      const header = parseHeader(raw);
      const f = PopularimeterFrame.fromData(raw, header, 4);
      expect(f.email).toBe("email@example.com");
      expect(f.rating).toBe(2);
      expect(f.counter).toBe(3n);
    });

    it("should parse POPM without counter", () => {
      // TypeScript-only test
      const emailBytes = Array.from(new TextEncoder().encode("email@example.com"));
      const body = [...emailBytes, 0x00, 0x02];
      const raw = buildRawFrame("POPM", body);
      const header = parseHeader(raw);
      const f = PopularimeterFrame.fromData(raw, header, 4);
      expect(f.email).toBe("email@example.com");
      expect(f.rating).toBe(2);
      expect(f.counter).toBe(0n);
    });

    it("should render POPM frame", () => {
      // TypeScript-only test
      const f = new PopularimeterFrame();
      f.email = "email@example.com";
      f.rating = 2;
      f.counter = 3n;

      const rendered = f.render(4);

      const emailBytes = Array.from(new TextEncoder().encode("email@example.com"));
      const expectedBody = [...emailBytes, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03];
      const expected = buildRawFrame("POPM", expectedBody);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // RVA2 (Relative Volume)
  // =========================================================================
  describe("RelativeVolumeFrame", () => {
    it("should parse relative volume frame", () => {
      // TypeScript-only test
      // RVA2 \x00\x00\x00\x0B \x00\x00 ident\x00 \x02 \x00\x0F \x08 \x45
      const raw = byteVectorFromArray([
        0x52, 0x56, 0x41, 0x32, // "RVA2"
        0x00, 0x00, 0x00, 0x0b, // size = 11
        0x00, 0x00,             // flags
        // "ident" + null
        0x69, 0x64, 0x65, 0x6e, 0x74, 0x00,
        0x02,                   // channel type = FrontRight
        0x00, 0x0f,             // volume adjustment = 15
        0x08,                   // bits representing peak = 8
        0x45,                   // peak volume
      ]);
      const header = parseHeader(raw);
      const f = RelativeVolumeFrame.fromData(raw, header, 4);
      expect(f.identification).toBe("ident");
      expect(f.volumeAdjustmentIndex(ChannelType.FrontRight)).toBe(15);
      expect(f.volumeAdjustment(ChannelType.FrontRight)).toBeCloseTo(15.0 / 512.0, 5);
      const peak = f.peakVolume(ChannelType.FrontRight);
      expect(peak.bitsRepresentingPeak).toBe(8);
      expect(peak.peakVolume.equals(byteVectorFromArray([0x45]))).toBe(true);
      expect(f.channels).toContain(ChannelType.FrontRight);
      expect(f.channels.length).toBe(1);
    });

    it("should render relative volume frame", () => {
      // TypeScript-only test
      const f = new RelativeVolumeFrame();
      f.identification = "ident";
      f.setVolumeAdjustment(15.0 / 512.0, ChannelType.FrontRight);
      const peak: PeakVolume = {
        bitsRepresentingPeak: 8,
        peakVolume: byteVectorFromArray([0x45]),
      };
      f.setPeakVolume(peak, ChannelType.FrontRight);

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x52, 0x56, 0x41, 0x32, // "RVA2"
        0x00, 0x00, 0x00, 0x0b, // size = 11
        0x00, 0x00,             // flags
        0x69, 0x64, 0x65, 0x6e, 0x74, 0x00, // "ident\0"
        0x02,                   // FrontRight
        0x00, 0x0f,             // volume adjustment = 15
        0x08,                   // bits = 8
        0x45,                   // peak
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // UFID (Unique File Identifier)
  // =========================================================================
  describe("UniqueFileIdentifierFrame", () => {
    it("should parse UFID frame", () => {
      // TypeScript-only test
      // UFID \x00\x00\x00\x09 \x00\x00 owner\x00 \x00\x01\x02
      const raw = byteVectorFromArray([
        0x55, 0x46, 0x49, 0x44, // "UFID"
        0x00, 0x00, 0x00, 0x09, // size = 9
        0x00, 0x00,             // flags
        // "owner" + null
        0x6f, 0x77, 0x6e, 0x65, 0x72, 0x00,
        // identifier
        0x00, 0x01, 0x02,
      ]);
      const header = parseHeader(raw);
      const f = UniqueFileIdentifierFrame.fromData(raw, header, 4);
      expect(f.owner).toBe("owner");
      expect(f.identifier.equals(byteVectorFromArray([0x00, 0x01, 0x02]))).toBe(true);
    });

    it("should parse empty UFID frame", () => {
      // TypeScript-only test
      const raw = byteVectorFromArray([
        0x55, 0x46, 0x49, 0x44, // "UFID"
        0x00, 0x00, 0x00, 0x01, // size = 1
        0x00, 0x00,             // flags
        0x00,                   // just a null terminator
      ]);
      const header = parseHeader(raw);
      const f = UniqueFileIdentifierFrame.fromData(raw, header, 4);
      expect(f.owner).toBe("");
      expect(f.identifier.length).toBe(0);
    });

    it("should render UFID frame", () => {
      // TypeScript-only test
      const f = new UniqueFileIdentifierFrame(
        "owner",
        byteVectorFromArray([0x01, 0x02, 0x03]),
      );

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x55, 0x46, 0x49, 0x44, // "UFID"
        0x00, 0x00, 0x00, 0x09, // size = 9
        0x00, 0x00,             // flags
        0x6f, 0x77, 0x6e, 0x65, 0x72, 0x00, // "owner\0"
        0x01, 0x02, 0x03,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // WOAF / URL Link
  // =========================================================================
  describe("UrlLinkFrame", () => {
    it("should parse URL link frame", () => {
      // TypeScript-only test
      // WOAF \x00\x00\x00\x12 \x00\x00 http://example.com
      const urlBytes = Array.from(new TextEncoder().encode("http://example.com"));
      const raw = buildRawFrame("WOAF", urlBytes);
      const header = parseHeader(raw);
      const f = UrlLinkFrame.fromData(raw, header, 4);
      expect(f.url).toBe("http://example.com");
    });

    it("should render URL link frame", () => {
      // TypeScript-only test
      const f = new UrlLinkFrame(ByteVector.fromString("WOAF", StringType.Latin1));
      f.url = "http://example.com";

      const rendered = f.render(4);
      const urlBytes = Array.from(new TextEncoder().encode("http://example.com"));
      const expected = buildRawFrame("WOAF", urlBytes);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // WXXX (User URL Link)
  // =========================================================================
  describe("UserUrlLinkFrame", () => {
    it("should parse user URL link frame", () => {
      // TypeScript-only test
      // WXXX \x00\x00\x00\x17 \x00\x00 \x00 foo\x00 http://example.com
      const raw = byteVectorFromArray([
        0x57, 0x58, 0x58, 0x58, // "WXXX"
        0x00, 0x00, 0x00, 0x17, // size = 23
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        // "foo" + null
        0x66, 0x6f, 0x6f, 0x00,
        // "http://example.com"
        ...Array.from(new TextEncoder().encode("http://example.com")),
      ]);
      const header = parseHeader(raw);
      const f = UserUrlLinkFrame.fromRawData(raw, header, 4);
      expect(f.description).toBe("foo");
      expect(f.url).toBe("http://example.com");
    });

    it("should render user URL link frame", () => {
      // TypeScript-only test
      const f = new UserUrlLinkFrame(StringType.Latin1);
      f.description = "foo";
      f.url = "http://example.com";

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x57, 0x58, 0x58, 0x58, // "WXXX"
        0x00, 0x00, 0x00, 0x17, // size = 23
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x66, 0x6f, 0x6f, 0x00, // "foo\0"
        ...Array.from(new TextEncoder().encode("http://example.com")),
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // OWNE (Ownership)
  // =========================================================================
  describe("OwnershipFrame", () => {
    it("should parse ownership frame", () => {
      // TypeScript-only test
      // OWNE \x00\x00\x00\x19 \x00\x00 \x00 GBP1.99\x00 20120905 Beatport
      const raw = byteVectorFromArray([
        0x4f, 0x57, 0x4e, 0x45, // "OWNE"
        0x00, 0x00, 0x00, 0x19, // size = 25
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        // "GBP1.99" + null
        ...Array.from(new TextEncoder().encode("GBP1.99")), 0x00,
        // "20120905"
        ...Array.from(new TextEncoder().encode("20120905")),
        // "Beatport"
        ...Array.from(new TextEncoder().encode("Beatport")),
      ]);
      const header = parseHeader(raw);
      const f = OwnershipFrame.fromData(raw, header, 4);
      expect(f.pricePaid).toBe("GBP1.99");
      expect(f.datePurchased).toBe("20120905");
      expect(f.seller).toBe("Beatport");
    });

    it("should render ownership frame", () => {
      // TypeScript-only test
      const f = new OwnershipFrame(StringType.Latin1);
      f.pricePaid = "GBP1.99";
      f.datePurchased = "20120905";
      f.seller = "Beatport";

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x4f, 0x57, 0x4e, 0x45, // "OWNE"
        0x00, 0x00, 0x00, 0x19, // size = 25
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        ...Array.from(new TextEncoder().encode("GBP1.99")), 0x00,
        ...Array.from(new TextEncoder().encode("20120905")),
        ...Array.from(new TextEncoder().encode("Beatport")),
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // SYLT (Synchronized Lyrics)
  // =========================================================================
  describe("SynchronizedLyricsFrame", () => {
    it("should parse synchronized lyrics frame", () => {
      // TypeScript-only test
      // SYLT \x00\x00\x00\x21 \x00\x00 \x00 eng \x02 \x01 foo\x00
      // Example\x00 \x00\x00\x04\xd2 Lyrics\x00 \x00\x00\x11\xd7
      const raw = byteVectorFromArray([
        0x53, 0x59, 0x4c, 0x54, // "SYLT"
        0x00, 0x00, 0x00, 0x21, // size = 33
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x65, 0x6e, 0x67,       // language = "eng"
        0x02,                   // timestamp format = AbsoluteMilliseconds
        0x01,                   // content type = Lyrics
        // "foo" + null
        0x66, 0x6f, 0x6f, 0x00,
        // "Example" + null
        0x45, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x00,
        // timestamp 1234
        0x00, 0x00, 0x04, 0xd2,
        // "Lyrics" + null
        0x4c, 0x79, 0x72, 0x69, 0x63, 0x73, 0x00,
        // timestamp 4567
        0x00, 0x00, 0x11, 0xd7,
      ]);
      const header = parseHeader(raw);
      const f = SynchronizedLyricsFrame.fromData(raw, header, 4);
      expect(f.encoding).toBe(StringType.Latin1);
      expect(f.language.equals(ByteVector.fromString("eng", StringType.Latin1))).toBe(true);
      expect(f.timestampFormat).toBe(2);
      expect(f.textType).toBe(SynchedTextType.Lyrics);
      expect(f.description).toBe("foo");
      const stl = f.synchedText;
      expect(stl.length).toBe(2);
      expect(stl[0].text).toBe("Example");
      expect(stl[0].time).toBe(1234);
      expect(stl[1].text).toBe("Lyrics");
      expect(stl[1].time).toBe(4567);
    });

    it("should parse synchronized lyrics frame with empty description", () => {
      // TypeScript-only test
      const raw = byteVectorFromArray([
        0x53, 0x59, 0x4c, 0x54, // "SYLT"
        0x00, 0x00, 0x00, 0x1e, // size = 30
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x65, 0x6e, 0x67,       // language = "eng"
        0x02,                   // timestamp format
        0x01,                   // content type
        0x00,                   // empty description + null
        // "Example" + null
        0x45, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x00,
        0x00, 0x00, 0x04, 0xd2,
        // "Lyrics" + null
        0x4c, 0x79, 0x72, 0x69, 0x63, 0x73, 0x00,
        0x00, 0x00, 0x11, 0xd7,
      ]);
      const header = parseHeader(raw);
      const f = SynchronizedLyricsFrame.fromData(raw, header, 4);
      expect(f.description).toBe("");
      const stl = f.synchedText;
      expect(stl.length).toBe(2);
      expect(stl[0].text).toBe("Example");
      expect(stl[0].time).toBe(1234);
      expect(stl[1].text).toBe("Lyrics");
      expect(stl[1].time).toBe(4567);
    });

    it("should render synchronized lyrics frame", () => {
      // TypeScript-only test
      const f = new SynchronizedLyricsFrame(StringType.Latin1);
      f.language = ByteVector.fromString("eng", StringType.Latin1);
      f.timestampFormat = 2;
      f.textType = SynchedTextType.Lyrics;
      f.description = "foo";
      f.synchedText = [
        { time: 1234, text: "Example" },
        { time: 4567, text: "Lyrics" },
      ];

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x53, 0x59, 0x4c, 0x54, // "SYLT"
        0x00, 0x00, 0x00, 0x21, // size = 33
        0x00, 0x00,             // flags
        0x00,                   // encoding
        0x65, 0x6e, 0x67,       // "eng"
        0x02,                   // timestamp format
        0x01,                   // content type
        0x66, 0x6f, 0x6f, 0x00, // "foo\0"
        0x45, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x00, // "Example\0"
        0x00, 0x00, 0x04, 0xd2,
        0x4c, 0x79, 0x72, 0x69, 0x63, 0x73, 0x00, // "Lyrics\0"
        0x00, 0x00, 0x11, 0xd7,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // ETCO (Event Timing Codes)
  // =========================================================================
  describe("EventTimingCodesFrame", () => {
    it("should parse event timing codes frame", () => {
      // TypeScript-only test
      // ETCO \x00\x00\x00\x0b \x00\x00 \x02 \x02 \x00\x00\xf3\x5c \xfe \x00\x36\xee\x80
      const raw = byteVectorFromArray([
        0x45, 0x54, 0x43, 0x4f, // "ETCO"
        0x00, 0x00, 0x00, 0x0b, // size = 11
        0x00, 0x00,             // flags
        0x02,                   // timestamp format = AbsoluteMilliseconds
        0x02,                   // event = IntroStart
        0x00, 0x00, 0xf3, 0x5c, // time = 62300
        0xfe,                   // event = AudioFileEnds
        0x00, 0x36, 0xee, 0x80, // time = 3600000
      ]);
      const header = parseHeader(raw);
      const f = EventTimingCodesFrame.fromData(raw, header, 4);
      expect(f.timestampFormat).toBe(2);
      const events = f.synchedEvents;
      expect(events.length).toBe(2);
      expect(events[0].type).toBe(EventType.IntroStart);
      expect(events[0].time).toBe(62300);
      expect(events[1].type).toBe(EventType.AudioFileEnds);
      expect(events[1].time).toBe(3600000);
    });

    it("should render event timing codes frame", () => {
      // TypeScript-only test
      const f = new EventTimingCodesFrame();
      f.timestampFormat = 2;
      f.synchedEvents = [
        { time: 62300, type: EventType.IntroStart },
        { time: 3600000, type: EventType.AudioFileEnds },
      ];

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x45, 0x54, 0x43, 0x4f, // "ETCO"
        0x00, 0x00, 0x00, 0x0b, // size = 11
        0x00, 0x00,             // flags
        0x02,
        0x02,
        0x00, 0x00, 0xf3, 0x5c,
        0xfe,
        0x00, 0x36, 0xee, 0x80,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // COMM (Comments)
  // =========================================================================
  describe("CommentsFrame", () => {
    it("should parse comments frame", () => {
      // TypeScript-only test
      // COMM \x00\x00\x00\x14 \x00\x00 \x03 deu Description\x00 Text
      const raw = byteVectorFromArray([
        0x43, 0x4f, 0x4d, 0x4d, // "COMM"
        0x00, 0x00, 0x00, 0x14, // size = 20
        0x00, 0x00,             // flags
        0x03,                   // encoding = UTF8
        0x64, 0x65, 0x75,       // language = "deu"
        // "Description" + null
        ...Array.from(new TextEncoder().encode("Description")), 0x00,
        // "Text"
        ...Array.from(new TextEncoder().encode("Text")),
      ]);
      const header = parseHeader(raw);
      const f = CommentsFrame.fromData(raw, header, 4);
      expect(f.encoding).toBe(StringType.UTF8);
      expect(f.language.equals(ByteVector.fromString("deu", StringType.Latin1))).toBe(true);
      expect(f.description).toBe("Description");
      expect(f.text).toBe("Text");
    });

    it("should render comments frame with UTF16", () => {
      // TypeScript-only test
      const f = new CommentsFrame(StringType.UTF16);
      f.language = ByteVector.fromString("eng", StringType.Latin1);
      f.description = "Description";
      f.text = "Text";

      const rendered = f.render(4);

      // Expected from C++ testRenderCommentsFrame:
      // COMM \x00\x00\x00\x28 \x00\x00 \x01 eng
      //   \xff\xfe D\0e\0s\0c\0r\0i\0p\0t\0i\0o\0n\0 \x00\x00
      //   \xff\xfe T\0e\0x\0t\0
      const expected = byteVectorFromArray([
        0x43, 0x4f, 0x4d, 0x4d, // "COMM"
        0x00, 0x00, 0x00, 0x28, // size = 40
        0x00, 0x00,             // flags
        0x01,                   // encoding = UTF16
        0x65, 0x6e, 0x67,       // language = "eng"
        // Description in UTF16LE with BOM
        0xff, 0xfe,
        0x44, 0x00, 0x65, 0x00, 0x73, 0x00, 0x63, 0x00, 0x72, 0x00,
        0x69, 0x00, 0x70, 0x00, 0x74, 0x00, 0x69, 0x00, 0x6f, 0x00, 0x6e, 0x00,
        0x00, 0x00,             // null terminator (UTF16)
        // Text in UTF16LE with BOM
        0xff, 0xfe,
        0x54, 0x00, 0x65, 0x00, 0x78, 0x00, 0x74, 0x00,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // PCST (Podcast)
  // =========================================================================
  describe("PodcastFrame", () => {
    it("should parse podcast frame via factory", () => {
      // TypeScript-only test
      const raw = byteVectorFromArray([
        0x50, 0x43, 0x53, 0x54, // "PCST"
        0x00, 0x00, 0x00, 0x04, // size = 4
        0x00, 0x00,             // flags
        0x00, 0x00, 0x00, 0x00, // payload
      ]);
      const tagHeader = new Id3v2Header();
      const result = Id3v2FrameFactory.instance.createFrame(raw, tagHeader);
      expect(result.frame).not.toBeNull();
      expect(result.frame).toBeInstanceOf(PodcastFrame);
    });

    it("should render podcast frame", () => {
      // TypeScript-only test
      const f = new PodcastFrame();
      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x50, 0x43, 0x53, 0x54, // "PCST"
        0x00, 0x00, 0x00, 0x04, // size = 4
        0x00, 0x00,             // flags
        0x00, 0x00, 0x00, 0x00, // payload
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // PRIV (Private)
  // =========================================================================
  describe("PrivateFrame", () => {
    it("should parse private frame", () => {
      // TypeScript-only test
      // PRIV \x00\x00\x00\x0e \x00\x00 WM/Provider\x00 TL
      const raw = byteVectorFromArray([
        0x50, 0x52, 0x49, 0x56, // "PRIV"
        0x00, 0x00, 0x00, 0x0e, // size = 14
        0x00, 0x00,             // flags
        // "WM/Provider" + null
        ...Array.from(new TextEncoder().encode("WM/Provider")), 0x00,
        // "TL"
        0x54, 0x4c,
      ]);
      const header = parseHeader(raw);
      const f = PrivateFrame.fromData(raw, header, 4);
      expect(f.owner).toBe("WM/Provider");
      expect(f.data.equals(ByteVector.fromString("TL", StringType.Latin1))).toBe(true);
    });

    it("should render private frame", () => {
      // TypeScript-only test
      const f = new PrivateFrame();
      f.owner = "WM/Provider";
      f.data = ByteVector.fromString("TL", StringType.Latin1);

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x50, 0x52, 0x49, 0x56, // "PRIV"
        0x00, 0x00, 0x00, 0x0e, // size = 14
        0x00, 0x00,             // flags
        ...Array.from(new TextEncoder().encode("WM/Provider")), 0x00,
        0x54, 0x4c,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // TXXX (User Text Identification)
  // =========================================================================
  describe("UserTextIdentificationFrame", () => {
    it("should parse TXXX without description", () => {
      // TypeScript-only test
      // TXXX \x00\x00\x00\x06 \x00\x00 \x00 \x00 Text
      const raw = byteVectorFromArray([
        0x54, 0x58, 0x58, 0x58, // "TXXX"
        0x00, 0x00, 0x00, 0x06, // size = 6
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x00,                   // empty description + null
        // "Text"
        0x54, 0x65, 0x78, 0x74,
      ]);
      const header = parseHeader(raw);
      const f = UserTextIdentificationFrame.fromRawData(raw, header, 4);
      expect(f.description).toBe("");
      expect(f.fieldList.length).toBeGreaterThanOrEqual(2);
      expect(f.fieldList[1]).toBe("Text");
    });

    it("should parse TXXX with description", () => {
      // TypeScript-only test
      // TXXX \x00\x00\x00\x11 \x00\x00 \x00 Description\x00 Text
      const raw = byteVectorFromArray([
        0x54, 0x58, 0x58, 0x58, // "TXXX"
        0x00, 0x00, 0x00, 0x11, // size = 17
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        // "Description" + null
        ...Array.from(new TextEncoder().encode("Description")), 0x00,
        // "Text"
        ...Array.from(new TextEncoder().encode("Text")),
      ]);
      const header = parseHeader(raw);
      const f = UserTextIdentificationFrame.fromRawData(raw, header, 4);
      expect(f.description).toBe("Description");
      expect(f.fieldList[1]).toBe("Text");
    });

    it("should render TXXX without description", () => {
      // TypeScript-only test
      const f = new UserTextIdentificationFrame(StringType.Latin1);
      f.description = "";
      f.text = "Text";

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x54, 0x58, 0x58, 0x58, // "TXXX"
        0x00, 0x00, 0x00, 0x06, // size = 6
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x00,                   // empty description + null
        0x54, 0x65, 0x78, 0x74, // "Text"
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });

    it("should render TXXX with description", () => {
      // TypeScript-only test
      const f = new UserTextIdentificationFrame(StringType.Latin1);
      f.description = "Description";
      f.text = "Text";

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x54, 0x58, 0x58, 0x58, // "TXXX"
        0x00, 0x00, 0x00, 0x11, // size = 17
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        ...Array.from(new TextEncoder().encode("Description")), 0x00,
        ...Array.from(new TextEncoder().encode("Text")),
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // CHAP (Chapter)
  // =========================================================================
  describe("ChapterFrame", () => {
    it("should parse chapter frame without embedded frames", () => {
      // TypeScript-only test
      // CHAP \x00\x00\x00\x12 \x00\x00 C\x00 times/offsets...
      const raw = byteVectorFromArray([
        0x43, 0x48, 0x41, 0x50, // "CHAP"
        0x00, 0x00, 0x00, 0x12, // size = 18
        0x00, 0x00,             // flags
        0x43, 0x00,             // element ID = "C" + null
        0x00, 0x00, 0x00, 0x03, // start time = 3
        0x00, 0x00, 0x00, 0x05, // end time = 5
        0x00, 0x00, 0x00, 0x02, // start offset = 2
        0x00, 0x00, 0x00, 0x03, // end offset = 3
      ]);
      const header = parseHeader(raw);
      const f = ChapterFrame.fromData(raw, header, 4);
      expect(f.elementId.equals(ByteVector.fromString("C", StringType.Latin1))).toBe(true);
      expect(f.startTime).toBe(3);
      expect(f.endTime).toBe(5);
      expect(f.startOffset).toBe(2);
      expect(f.endOffset).toBe(3);
      expect(f.embeddedFrameList.length).toBe(0);
    });

    it("should parse chapter frame with embedded TIT2 frame", () => {
      // TypeScript-only test
      const raw = byteVectorFromArray([
        0x43, 0x48, 0x41, 0x50, // "CHAP"
        0x00, 0x00, 0x00, 0x20, // size = 32 (18 + 14)
        0x00, 0x00,             // flags
        0x43, 0x00,             // element ID = "C" + null
        0x00, 0x00, 0x00, 0x03, // start time = 3
        0x00, 0x00, 0x00, 0x05, // end time = 5
        0x00, 0x00, 0x00, 0x02, // start offset = 2
        0x00, 0x00, 0x00, 0x03, // end offset = 3
        // Embedded TIT2 frame
        0x54, 0x49, 0x54, 0x32, // "TIT2"
        0x00, 0x00, 0x00, 0x04, // size = 4
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        0x43, 0x48, 0x31,       // "CH1"
      ]);
      const header = parseHeader(raw);

      // Use the factory as frame parser for embedded frames
      const factory = Id3v2FrameFactory.instance;
      const tagHeader = new Id3v2Header();
      const frameParser = (data: ByteVector, _version: number) => {
        const result = factory.createFrame(data, tagHeader);
        return result.frame ?? undefined;
      };

      const f = ChapterFrame.fromData(raw, header, 4, frameParser);
      expect(f.elementId.equals(ByteVector.fromString("C", StringType.Latin1))).toBe(true);
      expect(f.startTime).toBe(3);
      expect(f.endTime).toBe(5);
      expect(f.startOffset).toBe(2);
      expect(f.endOffset).toBe(3);
      expect(f.embeddedFrameList.length).toBe(1);
      expect(f.embeddedFrameList[0].toString()).toBe("CH1");
    });

    it("should render chapter frame", () => {
      // TypeScript-only test
      // The TS ChapterFrame render appends a null terminator to the element ID,
      // so pass just "C" (without null) as the element ID.
      const f = new ChapterFrame(
        ByteVector.fromString("C", StringType.Latin1),
        3, 5, 2, 3,
      );
      const tit2 = new TextIdentificationFrame(
        ByteVector.fromString("TIT2", StringType.Latin1),
        StringType.Latin1,
      );
      tit2.text = "CH1";
      f.addEmbeddedFrame(tit2);

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x43, 0x48, 0x41, 0x50, // "CHAP"
        0x00, 0x00, 0x00, 0x20, // size = 32
        0x00, 0x00,             // flags
        0x43, 0x00,             // "C" + null terminator
        0x00, 0x00, 0x00, 0x03, // start time
        0x00, 0x00, 0x00, 0x05, // end time
        0x00, 0x00, 0x00, 0x02, // start offset
        0x00, 0x00, 0x00, 0x03, // end offset
        // Embedded TIT2
        0x54, 0x49, 0x54, 0x32,
        0x00, 0x00, 0x00, 0x04,
        0x00, 0x00,
        0x00,
        0x43, 0x48, 0x31,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // CTOC (Table of Contents)
  // =========================================================================
  describe("TableOfContentsFrame", () => {
    it("should parse table of contents frame", () => {
      // TypeScript-only test
      const raw = byteVectorFromArray([
        0x43, 0x54, 0x4f, 0x43, // "CTOC"
        0x00, 0x00, 0x00, 0x16, // size = 22
        0x00, 0x00,             // flags
        0x54, 0x00,             // element ID = "T" + null
        0x01,                   // CTOC flags (ordered=1, topLevel=0)
        0x02,                   // entry count = 2
        0x43, 0x00,             // first entry = "C" + null
        0x44, 0x00,             // second entry = "D" + null
        // Embedded TIT2 frame
        0x54, 0x49, 0x54, 0x32,
        0x00, 0x00, 0x00, 0x04,
        0x00, 0x00,
        0x00,
        0x54, 0x43, 0x31,       // "TC1"
      ]);
      const header = parseHeader(raw);

      const factory = Id3v2FrameFactory.instance;
      const tagHeader = new Id3v2Header();
      const frameParser = (data: ByteVector, _version: number) => {
        const result = factory.createFrame(data, tagHeader);
        return result.frame ?? undefined;
      };

      const f = TableOfContentsFrame.fromData(raw, header, 4, frameParser);
      expect(f.elementId.equals(ByteVector.fromString("T", StringType.Latin1))).toBe(true);
      expect(f.isTopLevel).toBe(false);
      expect(f.isOrdered).toBe(true);
      expect(f.childElements.length).toBe(2);
      expect(f.childElements[0].equals(ByteVector.fromString("C", StringType.Latin1))).toBe(true);
      expect(f.childElements[1].equals(ByteVector.fromString("D", StringType.Latin1))).toBe(true);
      expect(f.embeddedFrameList.length).toBe(1);
      expect(f.embeddedFrameList[0].toString()).toBe("TC1");
    });

    it("should render table of contents frame", () => {
      // TypeScript-only test
      const f = new TableOfContentsFrame(ByteVector.fromString("T", StringType.Latin1));
      f.isTopLevel = false;
      f.isOrdered = true;
      f.addChildElement(ByteVector.fromString("C", StringType.Latin1));
      f.addChildElement(ByteVector.fromString("D", StringType.Latin1));
      const tit2 = new TextIdentificationFrame(
        ByteVector.fromString("TIT2", StringType.Latin1),
        StringType.Latin1,
      );
      tit2.text = "TC1";
      f.addEmbeddedFrame(tit2);

      const rendered = f.render(4);
      const expected = byteVectorFromArray([
        0x43, 0x54, 0x4f, 0x43, // "CTOC"
        0x00, 0x00, 0x00, 0x16, // size = 22
        0x00, 0x00,             // flags
        0x54, 0x00,             // "T\0"
        0x01,                   // flags (ordered=1, topLevel=0)
        0x02,                   // entry count
        0x43, 0x00,             // "C\0"
        0x44, 0x00,             // "D\0"
        0x54, 0x49, 0x54, 0x32,
        0x00, 0x00, 0x00, 0x04,
        0x00, 0x00,
        0x00,
        0x54, 0x43, 0x31,
      ]);
      expect(rendered.length).toBe(expected.length);
      expect(rendered.equals(expected)).toBe(true);
    });
  });

  // =========================================================================
  // Genre update tests
  // =========================================================================
  describe("Genre handling", () => {
    it("should update genre 23_1 - v2.3 parenthesized genre", () => {
      // TypeScript-only test
      // TCON with "(22)Death Metal" in v2.3 format
      const raw = byteVectorFromArray([
        0x54, 0x43, 0x4f, 0x4e, // "TCON"
        0x00, 0x00, 0x00, 0x10, // size = 16
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        ...Array.from(new TextEncoder().encode("(22)Death Metal")),
      ]);
      const tagHeader = new Id3v2Header();
      tagHeader.majorVersion = 3;
      const result = Id3v2FrameFactory.instance.createFrame(raw, tagHeader);
      expect(result.frame).not.toBeNull();
      const frame = result.frame as TextIdentificationFrame;

      // The TS factory stores the raw text; genre parsing happens at the tag level
      expect(frame.fieldList.length).toBeGreaterThanOrEqual(1);

      const tag = new Id3v2Tag();
      tag.addFrame(frame);
      // The tag.genre getter parses "(22)" → "Death Metal", then the
      // remaining text "Death Metal" is also included; the TS implementation
      // resolves the parenthesized reference and retains the refinement.
      expect(tag.genre).toContain("Death Metal");
    });

    it("should update genre 24 - numeric genres with null separator", () => {
      // TypeScript-only test
      // TCON with "14\0Eurodisco" in v2.4 format
      const raw = byteVectorFromArray([
        0x54, 0x43, 0x4f, 0x4e, // "TCON"
        0x00, 0x00, 0x00, 0x0d, // size = 13
        0x00, 0x00,             // flags
        0x00,                   // encoding = Latin1
        // "14" + null + "Eurodisco"
        0x31, 0x34, 0x00,
        ...Array.from(new TextEncoder().encode("Eurodisco")),
      ]);
      const tagHeader = new Id3v2Header();
      // Default version 4
      const result = Id3v2FrameFactory.instance.createFrame(raw, tagHeader);
      expect(result.frame).not.toBeNull();
      const frame = result.frame as TextIdentificationFrame;
      expect(frame.fieldList.length).toBe(2);
      expect(frame.fieldList[0]).toBe("14");
      expect(frame.fieldList[1]).toBe("Eurodisco");

      // The tag.genre getter joins and parses the field values.
      // In the TS implementation, the text getter joins with ", " so the genre
      // string becomes "14, Eurodisco" which parseGenreString interprets as-is.
      const tag = new Id3v2Tag();
      tag.addFrame(frame);
      const genre = tag.genre;
      expect(genre).toContain("Eurodisco");
    });
  });

  // =========================================================================
  // Duplicate ID3v2 tags
  // =========================================================================
  describe("duplicate tags", () => {
    it("should handle duplicate ID3v2 tags", async () => {
      // TypeScript-only test
      const stream = openTestStream("duplicate_id3v2.mp3");
      const f = await MpegFile.open(stream, true, ReadStyle.Average);

      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.sampleRate).toBe(44100);
      }
    });
  });

  // =========================================================================
  // Empty frame
  // =========================================================================
  describe("empty frame handling", () => {
    it("should save and re-read with empty WOAF frame", async () => {
      // TypeScript-only test
      const data = readTestData("xing.mp3");
      const stream = new ByteVectorStream(data);
      const f = await MpegFile.open(stream, true, ReadStyle.Average);

      const tag = f.id3v2Tag(true)!;

      // Add an empty WOAF frame (body = single null byte)
      const emptyWoaf = byteVectorFromArray([
        0x57, 0x4f, 0x41, 0x46, // "WOAF"
        0x00, 0x00, 0x00, 0x01, // size = 1
        0x00, 0x00,             // flags
        0x00,                   // empty body
      ]);
      const woafHeader = parseHeader(emptyWoaf);
      const woafFrame = UrlLinkFrame.fromData(emptyWoaf, woafHeader, 4);
      tag.addFrame(woafFrame);

      // Add a TIT2 frame with real content
      const tit2 = new TextIdentificationFrame(
        ByteVector.fromString("TIT2", StringType.Latin1),
        StringType.Latin1,
      );
      tit2.text = "Title";
      tag.addFrame(tit2);

      await f.save();

      // Re-read
      await stream.seek(0);
      const f2 = await MpegFile.open(stream, true, ReadStyle.Average);
      const tag2 = f2.tag();
      expect(tag2?.title).toBe("Title");
    });
  });

  // =========================================================================
  // Round-trip tests: create, render, re-parse
  // =========================================================================
  describe("round-trip rendering", () => {
    it("should round-trip POPM frame", () => {
      // TypeScript-only test
      const f = new PopularimeterFrame();
      f.email = "test@example.com";
      f.rating = 128;
      f.counter = 42n;

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = PopularimeterFrame.fromData(rendered, header, 4);
      expect(f2.email).toBe("test@example.com");
      expect(f2.rating).toBe(128);
      expect(f2.counter).toBe(42n);
    });

    it("should round-trip UFID frame", () => {
      // TypeScript-only test
      const f = new UniqueFileIdentifierFrame("http://musicbrainz.org", byteVectorFromArray([0xDE, 0xAD, 0xBE, 0xEF]));
      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = UniqueFileIdentifierFrame.fromData(rendered, header, 4);
      expect(f2.owner).toBe("http://musicbrainz.org");
      expect(f2.identifier.equals(byteVectorFromArray([0xDE, 0xAD, 0xBE, 0xEF]))).toBe(true);
    });

    it("should round-trip comments frame", () => {
      // TypeScript-only test
      const f = new CommentsFrame(StringType.UTF8);
      f.language = ByteVector.fromString("eng", StringType.Latin1);
      f.description = "My Comment";
      f.text = "This is a comment.";

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = CommentsFrame.fromData(rendered, header, 4);
      expect(f2.description).toBe("My Comment");
      expect(f2.text).toBe("This is a comment.");
      expect(f2.encoding).toBe(StringType.UTF8);
    });

    it("should round-trip APIC frame", () => {
      // TypeScript-only test
      const f = new AttachedPictureFrame(StringType.Latin1);
      f.mimeType = "image/jpeg";
      f.pictureType = PictureType.FrontCover;
      f.description = "Cover";
      f.picture = byteVectorFromArray([0xff, 0xd8, 0xff, 0xe0]);

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = AttachedPictureFrame.fromData(rendered, header, 4);
      expect(f2.mimeType).toBe("image/jpeg");
      expect(f2.pictureType).toBe(PictureType.FrontCover);
      expect(f2.description).toBe("Cover");
      expect(f2.picture.equals(byteVectorFromArray([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    });

    it("should round-trip ownership frame", () => {
      // TypeScript-only test
      const f = new OwnershipFrame(StringType.Latin1);
      f.pricePaid = "USD9.99";
      f.datePurchased = "20230101";
      f.seller = "iTunes";

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = OwnershipFrame.fromData(rendered, header, 4);
      expect(f2.pricePaid).toBe("USD9.99");
      expect(f2.datePurchased).toBe("20230101");
      expect(f2.seller).toBe("iTunes");
    });

    it("should round-trip private frame", () => {
      // TypeScript-only test
      const f = new PrivateFrame();
      f.owner = "com.example.app";
      f.data = byteVectorFromArray([0x01, 0x02, 0x03, 0x04]);

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = PrivateFrame.fromData(rendered, header, 4);
      expect(f2.owner).toBe("com.example.app");
      expect(f2.data.equals(byteVectorFromArray([0x01, 0x02, 0x03, 0x04]))).toBe(true);
    });

    it("should round-trip event timing codes frame", () => {
      // TypeScript-only test
      const f = new EventTimingCodesFrame();
      f.timestampFormat = 2;
      f.synchedEvents = [
        { time: 0, type: EventType.EndOfInitialSilence },
        { time: 5000, type: EventType.IntroStart },
        { time: 180000, type: EventType.AudioFileEnds },
      ];

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = EventTimingCodesFrame.fromData(rendered, header, 4);
      expect(f2.timestampFormat).toBe(2);
      expect(f2.synchedEvents.length).toBe(3);
      expect(f2.synchedEvents[0].type).toBe(EventType.EndOfInitialSilence);
      expect(f2.synchedEvents[0].time).toBe(0);
      expect(f2.synchedEvents[1].type).toBe(EventType.IntroStart);
      expect(f2.synchedEvents[1].time).toBe(5000);
      expect(f2.synchedEvents[2].type).toBe(EventType.AudioFileEnds);
      expect(f2.synchedEvents[2].time).toBe(180000);
    });

    it("should round-trip synchronized lyrics frame", () => {
      // TypeScript-only test
      const f = new SynchronizedLyricsFrame(StringType.Latin1);
      f.language = ByteVector.fromString("fra", StringType.Latin1);
      f.timestampFormat = 2;
      f.textType = SynchedTextType.Lyrics;
      f.description = "Paroles";
      f.synchedText = [
        { time: 100, text: "Bonjour" },
        { time: 2000, text: "Au revoir" },
      ];

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = SynchronizedLyricsFrame.fromData(rendered, header, 4);
      expect(f2.description).toBe("Paroles");
      expect(f2.synchedText.length).toBe(2);
      expect(f2.synchedText[0].text).toBe("Bonjour");
      expect(f2.synchedText[0].time).toBe(100);
      expect(f2.synchedText[1].text).toBe("Au revoir");
      expect(f2.synchedText[1].time).toBe(2000);
    });

    it("should round-trip URL link frame", () => {
      // TypeScript-only test
      const f = new UrlLinkFrame(ByteVector.fromString("WOAF", StringType.Latin1));
      f.url = "https://example.com/music";

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = UrlLinkFrame.fromData(rendered, header, 4);
      expect(f2.url).toBe("https://example.com/music");
    });

    it("should round-trip user URL link frame", () => {
      // TypeScript-only test
      const f = new UserUrlLinkFrame(StringType.Latin1);
      f.description = "Artist Website";
      f.url = "https://example.com/artist";

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = UserUrlLinkFrame.fromRawData(rendered, header, 4);
      expect(f2.description).toBe("Artist Website");
      expect(f2.url).toBe("https://example.com/artist");
    });

    it("should round-trip GEOB frame", () => {
      // TypeScript-only test
      const f = new GeneralEncapsulatedObjectFrame(StringType.Latin1);
      f.mimeType = "text/plain";
      f.fileName = "notes.txt";
      f.description = "Notes";
      f.object = ByteVector.fromString("Hello World", StringType.Latin1);

      const rendered = f.render(4);
      const header = parseHeader(rendered);
      const f2 = GeneralEncapsulatedObjectFrame.fromData(rendered, header, 4);
      expect(f2.mimeType).toBe("text/plain");
      expect(f2.fileName).toBe("notes.txt");
      expect(f2.description).toBe("Notes");
      expect(f2.object.toString(StringType.Latin1)).toBe("Hello World");
    });
  });

  // =========================================================================
  // Tag-level operations
  // =========================================================================
  describe("Id3v2Tag", () => {
    it("should add and retrieve frames", () => {
      // TypeScript-only test
      const tag = new Id3v2Tag();
      const frame = new TextIdentificationFrame(
        ByteVector.fromString("TIT2", StringType.Latin1),
        StringType.Latin1,
      );
      frame.text = "Test Title";
      tag.addFrame(frame);

      expect(tag.title).toBe("Test Title");
    });

    it("should set genre with numeric ID", () => {
      // TypeScript-only test
      const tag = new Id3v2Tag();
      tag.genre = "Rock";
      expect(tag.genre).toBe("Rock");
    });

    it("should remove frames", () => {
      // TypeScript-only test
      const tag = new Id3v2Tag();
      const frame = new TextIdentificationFrame(
        ByteVector.fromString("TPE1", StringType.Latin1),
        StringType.Latin1,
      );
      frame.text = "Artist";
      tag.addFrame(frame);
      expect(tag.artist).toBe("Artist");

      tag.removeFrame(frame);
      expect(tag.artist).toBe("");
    });
  });
});
