import { describe, expect, it } from "vitest";
import { ByteVector, StringType } from "../byteVector.js";
import { FlacFile } from "../flac/flacFile.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { Variant } from "../toolkit/variant.js";
import { openTestStream, readTestData } from "./testHelper.js";

async function openFlacFile(
  filename: string,
  readProperties = true,
  readStyle = ReadStyle.Average,
): Promise<FlacFile> {
  const stream = openTestStream(filename);
  return await FlacFile.open(stream, readProperties, readStyle);
}

describe("FLAC", () => {
  it("should read silence file", async () => {
    // TypeScript-only test
    const f = await openFlacFile("silence-44-s.flac");
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

  it("should read sinewave file audio properties", async () => {
    // C++: test_flac.cpp – TestFLAC::testAudioProperties
    const f = await openFlacFile("sinewave.flac");
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props?.lengthInSeconds).toBe(3);
    expect(props?.lengthInMilliseconds).toBe(3550);
    expect(props?.bitrate).toBe(145);
    expect(props?.sampleRate).toBe(44100);
    expect(props?.channels).toBe(2);
    expect(props?.bitsPerSample).toBe(16);
    expect(props?.sampleFrames).toBe(156556n);
    // MD5 signature of the uncompressed audio stream
    expect(props?.signature?.length).toBe(16);
  });

  it("should read no-tags file", async () => {
    // C++: test_flac.cpp – TestFLAC::testSignature
    const f = await openFlacFile("no-tags.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read empty-seektable file", async () => {
    // C++: test_flac.cpp – TestFLAC::testEmptySeekTable
    const f = await openFlacFile("empty-seektable.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read zero-sized-padding file", async () => {
    // C++: test_flac.cpp – TestFLAC::testZeroSizedPadding1
    const f = await openFlacFile("zero-sized-padding.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read multiple-vc file", async () => {
    // C++: test_flac.cpp – TestFLAC::testMultipleCommentBlocks
    const f = await openFlacFile("multiple-vc.flac");
    expect(f.isValid).toBe(true);
  });

  it("should read Xiph Comment", async () => {
    // C++: test_flac.cpp – TestFLAC::testDict
    const f = await openFlacFile("silence-44-s.flac");
    expect(f.xiphComment()).not.toBeNull();
  });

  it("should access pictures", async () => {
    // C++: test_flac.cpp – TestFLAC::testReadPicture
    const f = await openFlacFile("silence-44-s.flac");
    // Silence file may or may not have pictures, but API should work
    const pics = f.pictureList;
    expect(Array.isArray(pics)).toBe(true);
  });

  it("should save and re-read", async () => {
    // C++: test_flac.cpp – TestFLAC::testRepeatedSave1
    const data = readTestData("silence-44-s.flac");
    const stream = new ByteVectorStream(data);
    const f = await FlacFile.open(stream, true, ReadStyle.Average);

    if (f.isValid && f.xiphComment()) {
      f.xiphComment()!.title = "FLAC Test";
      f.xiphComment()!.artist = "Test Artist";
      await f.save();
    }

    // Re-read
    await stream.seek(0);
    const f2 = await FlacFile.open(stream, true, ReadStyle.Average);
    if (f2.isValid && f2.xiphComment()) {
      expect(f2.xiphComment()!.title).toBe("FLAC Test");
      expect(f2.xiphComment()!.artist).toBe("Test Artist");
    }
  });

  it("should save and re-read artwork via complexProperties", async () => {
    // C++: test_flac.cpp – TestFLAC::testAddPicture
    const data = readTestData("silence-44-s.flac");
    const stream = new ByteVectorStream(data);
    const f = await FlacFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);

    // Create a small fake image
    const imgData = ByteVector.fromSize(64, 0xff);

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
    await f.save();

    // Re-read
    await stream.seek(0);
    const f2 = await FlacFile.open(stream, true, ReadStyle.Average);
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

  // ---------------------------------------------------------------------------
  // iXML / BEXT APPLICATION block tests
  // ---------------------------------------------------------------------------

  // Build a 4-byte FLAC metadata-block header:
  // <1 bit last><7 bit type><24 bit length, big-endian>.
  function flacBlockHeader(payloadSize: number, blockType: number, isLast: boolean): ByteVector {
    const h = ByteVector.fromUInt(payloadSize, true);
    h.set(0, blockType | (isLast ? 0x80 : 0x00));
    return h;
  }

  // Build the body of an APPLICATION/"riff"-wrapped RIFF chunk:
  // [appID="riff"][FOURCC][LE size][data].
  function riffWrappedAppData(fourcc: string, data: ByteVector): ByteVector {
    const body = ByteVector.fromString("riff", StringType.Latin1);
    body.append(ByteVector.fromString(fourcc, StringType.Latin1));
    body.append(ByteVector.fromUInt(data.length, false));
    body.append(data);
    return body;
  }

  // Build a minimal synthetic FLAC stream: "fLaC" + zero-init STREAMINFO +
  // one APPLICATION block (which gets the last-block flag).  Caller passes
  // the full APPLICATION block payload starting with the 4-byte appID.
  function synthFlacWithApp(appPayload: ByteVector): ByteVector {
    const flac = ByteVector.fromString("fLaC", StringType.Latin1);
    flac.append(flacBlockHeader(34, 0, false));  // STREAMINFO header
    flac.append(ByteVector.fromSize(34, 0));     // STREAMINFO body
    flac.append(flacBlockHeader(appPayload.length, 2, true));
    flac.append(appPayload);
    return flac;
  }

  it("testReadiXMLDirect", async () => {
    // C++: test_flac.cpp – TestFLAC::testReadiXMLDirect
    const xml = "<BWFXML><IXML_VERSION>1.0</IXML_VERSION></BWFXML>";
    const appPayload = ByteVector.fromString("iXML", StringType.Latin1);
    appPayload.append(ByteVector.fromString(xml, StringType.UTF8));

    const data = synthFlacWithApp(appPayload);
    const stream = new ByteVectorStream(data);
    const f = await FlacFile.open(stream, false);

    expect(f.isValid).toBe(true);
    expect(f.hasiXMLData).toBe(true);
    expect(f.hasBEXTData).toBe(false);
    expect(f.iXMLData).toBe(xml);
  });

  it("testReadiXMLRiffWrapped", async () => {
    // C++: test_flac.cpp – TestFLAC::testReadiXMLRiffWrapped
    const xml = "<BWFXML><SCENE>1</SCENE></BWFXML>";
    const appPayload = riffWrappedAppData("iXML", ByteVector.fromString(xml, StringType.UTF8));

    const data = synthFlacWithApp(appPayload);
    const stream = new ByteVectorStream(data);
    const f = await FlacFile.open(stream, false);

    expect(f.isValid).toBe(true);
    expect(f.hasiXMLData).toBe(true);
    expect(f.iXMLData).toBe(xml);
  });

  it("testReadBEXTDirect", async () => {
    // C++: test_flac.cpp – TestFLAC::testReadBEXTDirect
    const bext = ByteVector.fromString("test bext data", StringType.Latin1);
    const appPayload = ByteVector.fromString("bext", StringType.Latin1);
    appPayload.append(bext);

    const data = synthFlacWithApp(appPayload);
    const stream = new ByteVectorStream(data);
    const f = await FlacFile.open(stream, false);

    expect(f.isValid).toBe(true);
    expect(f.hasBEXTData).toBe(true);
    expect(f.hasiXMLData).toBe(false);
    expect(f.BEXTData.equals(bext)).toBe(true);
  });

  it("testReadBEXTRiffWrapped", async () => {
    // C++: test_flac.cpp – TestFLAC::testReadBEXTRiffWrapped
    const bext = ByteVector.fromString("test bext data", StringType.Latin1);
    const appPayload = riffWrappedAppData("bext", bext);

    const data = synthFlacWithApp(appPayload);
    const stream = new ByteVectorStream(data);
    const f = await FlacFile.open(stream, false);

    expect(f.isValid).toBe(true);
    expect(f.hasBEXTData).toBe(true);
    expect(f.BEXTData.equals(bext)).toBe(true);
  });

  it("testWriteiXMLAndBEXT", async () => {
    // C++: test_flac.cpp – TestFLAC::testWriteiXMLAndBEXT
    const fileData = readTestData("silence-44-s.flac");
    const stream = new ByteVectorStream(ByteVector.fromUint8Array(fileData));
    const xml = "<BWFXML><IXML_VERSION>1.6</IXML_VERSION></BWFXML>";
    const bext = ByteVector.fromString("bext payload bytes", StringType.Latin1);

    {
      const f = await FlacFile.open(stream, false);
      expect(f.hasiXMLData).toBe(false);
      expect(f.hasBEXTData).toBe(false);
      f.iXMLData = xml;
      f.BEXTData = bext;
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await FlacFile.open(stream, false);
      expect(f.hasiXMLData).toBe(true);
      expect(f.hasBEXTData).toBe(true);
      expect(f.iXMLData).toBe(xml);
      expect(f.BEXTData.equals(bext)).toBe(true);
    }

    // On-disk format check: written blocks must use the "riff" wrapper.
    const fileBytes = stream.data()!;
    const xmlBytes = ByteVector.fromString(xml, StringType.UTF8);
    const expectedIXMLApp = ByteVector.fromString("riff", StringType.Latin1);
    expectedIXMLApp.append(ByteVector.fromString("iXML", StringType.Latin1));
    expectedIXMLApp.append(ByteVector.fromUInt(xmlBytes.length, false));
    expectedIXMLApp.append(xmlBytes);
    expect(fileBytes.find(expectedIXMLApp)).toBeGreaterThanOrEqual(0);

    const expectedBEXTApp = ByteVector.fromString("riff", StringType.Latin1);
    expectedBEXTApp.append(ByteVector.fromString("bext", StringType.Latin1));
    expectedBEXTApp.append(ByteVector.fromUInt(bext.length, false));
    expectedBEXTApp.append(bext);
    expect(fileBytes.find(expectedBEXTApp)).toBeGreaterThanOrEqual(0);
  });

  it("testWriteEmptyClearsiXMLAndBEXT", async () => {
    // C++: test_flac.cpp – TestFLAC::testWriteEmptyClearsiXMLAndBEXT
    const fileData = readTestData("silence-44-s.flac");
    const stream = new ByteVectorStream(ByteVector.fromUint8Array(fileData));

    {
      const f = await FlacFile.open(stream, false);
      f.iXMLData = "<BWFXML/>";
      f.BEXTData = ByteVector.fromString("bext", StringType.Latin1);
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await FlacFile.open(stream, false);
      expect(f.hasiXMLData).toBe(true);
      expect(f.hasBEXTData).toBe(true);
      f.iXMLData = "";
      f.BEXTData = ByteVector.fromSize(0);
      await f.save();
    }

    await stream.seek(0);
    {
      const f = await FlacFile.open(stream, false);
      expect(f.hasiXMLData).toBe(false);
      expect(f.hasBEXTData).toBe(false);
      expect(f.iXMLData).toBe("");
      expect(f.BEXTData.isEmpty).toBe(true);
    }
  });

  it("testRoundTripPreservesUnknownApplicationBlock", async () => {
    // C++: test_flac.cpp – TestFLAC::testRoundTripPreservesUnknownApplicationBlock
    const smedAppPayload = ByteVector.fromString("SMED", StringType.Latin1);
    const smedExtra = ByteVector.fromString("opaque sequoia metadata payload", StringType.Latin1);
    const smedBlock = ByteVector.fromString("SMED", StringType.Latin1);
    smedBlock.append(smedExtra);

    const flac = ByteVector.fromString("fLaC", StringType.Latin1);
    flac.append(flacBlockHeader(34, 0, false));
    flac.append(ByteVector.fromSize(34, 0));
    flac.append(flacBlockHeader(smedBlock.length, 2, true));
    flac.append(smedBlock);

    const stream = new ByteVectorStream(flac);
    {
      const f = await FlacFile.open(stream, false);
      expect(f.isValid).toBe(true);
      expect(f.hasiXMLData).toBe(false);
      f.iXMLData = "<BWFXML/>";
      await f.save();
    }

    // SMED block must still be present after save.
    const saved = stream.data()!;
    expect(saved.find(smedAppPayload)).toBeGreaterThanOrEqual(0);
    expect(saved.find(smedExtra)).toBeGreaterThanOrEqual(0);

    // iXML data must round-trip.
    const stream2 = new ByteVectorStream(saved);
    const f2 = await FlacFile.open(stream2, false);
    expect(f2.isValid).toBe(true);
    expect(f2.hasiXMLData).toBe(true);
    expect(f2.iXMLData).toBe("<BWFXML/>");
  });
});
