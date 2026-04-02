import { describe, expect, it } from "vitest";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { WavPackFile, WavPackTagTypes } from "../wavpack/wavpackFile.js";
import { openTestStream, readTestDataBV } from "./testHelper.js";

async function openWavPackFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): Promise<WavPackFile> {
  const stream = openTestStream(filename);
  return await WavPackFile.open(stream, readProperties, readStyle);
}

describe("WavPack", () => {
  describe("properties", () => {
    it("should read no_length properties", async () => {
      // TypeScript-only test
      const f = await openWavPackFile("no_length.wv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.lengthInMilliseconds).toBe(3705);
        expect(props.bitrate).toBe(1);
        expect(props.channels).toBe(2);
        expect(props.bitsPerSample).toBe(16);
        expect(props.isLossless).toBe(true);
        expect(props.sampleRate).toBe(44100);
        expect(props.sampleFrames).toBe(163392);
        expect(props.version).toBe(1031);
      }
    });

    it("should read multi-channel properties", async () => {
      // TypeScript-only test
      const f = await openWavPackFile("four_channels.wv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.channels).toBe(4);
        expect(props.isLossless).toBe(false);
        expect(props.bitrate).toBe(112);
        expect(props.lengthInMilliseconds).toBe(3833);
        expect(props.sampleFrames).toBe(169031);
        expect(props.version).toBe(1031);
      }
    });

    it("should read DSD stereo properties", async () => {
      // TypeScript-only test
      const f = await openWavPackFile("dsd_stereo.wv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.isDsd).toBe(true);
        expect(props.isLossless).toBe(true);
        expect(props.channels).toBe(2);
        expect(props.sampleRate).toBe(352800);
        expect(props.bitsPerSample).toBe(8);
        // Bitrate is ~2097 kbps but rounding differs between integer arithmetic implementations
        expect(props.bitrate).toBeGreaterThanOrEqual(2096);
        expect(props.bitrate).toBeLessThanOrEqual(2098);
        expect(props.sampleFrames).toBe(70560);
        expect(props.version).toBe(1040);
      }
    });

    it("should read non-standard rate properties", async () => {
      // TypeScript-only test
      const f = await openWavPackFile("non_standard_rate.wv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.sampleRate).toBe(1000);
        expect(props.sampleFrames).toBe(3675);
        expect(props.version).toBe(1040);
      }
    });

    it("should read tagged file properties", async () => {
      // TypeScript-only test
      const f = await openWavPackFile("tagged.wv");
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.bitrate).toBe(172);
        expect(props.isLossless).toBe(false);
        expect(props.version).toBe(1031);
      }
    });
  });

  describe("fuzzed files", () => {
    it("should handle infloop.wv without crashing", async () => {
      // TypeScript-only test
      const f = await openWavPackFile("infloop.wv");
      expect(f.isValid).toBe(true);
    });
  });

  describe("strip and properties", () => {
    it("should strip tags in-memory and reflect in properties", async () => {
      // TypeScript-only test
      const data = readTestDataBV("click.wv");
      const stream = new ByteVectorStream(data);
      const f = await WavPackFile.open(stream, true, ReadStyle.Average);

      // Create both tags and set titles
      f.apeTag(true)!.title = "APE";
      f.id3v1Tag(true)!.title = "ID3v1";

      // Combined tag should expose both titles
      const props = f.tag().properties();
      const titles = props.get("TITLE");
      expect(titles).toBeDefined();
      expect(titles!.length).toBeGreaterThanOrEqual(1);

      // Strip APE tag — ID3v1 should become visible
      f.strip(WavPackTagTypes.APE);
      const props2 = f.tag().properties();
      const titles2 = props2.get("TITLE");
      expect(titles2).toBeDefined();
      expect(titles2![0]).toBe("ID3v1");

      // Strip ID3v1 tag — no titles left
      f.strip(WavPackTagTypes.ID3v1);
      const props3 = f.tag().properties();
      expect(props3.size).toBe(0);
    });

    it("should persist tag changes after save", async () => {
      // TypeScript-only test
      const data = readTestDataBV("click.wv");
      const stream = new ByteVectorStream(data);

      // Add both tags and save
      {
        const f = await WavPackFile.open(stream, true, ReadStyle.Average);
        f.apeTag(true)!.title = "APE";
        f.id3v1Tag(true)!.title = "ID3v1";
        await f.save();
      }

      // Re-read, verify both tags exist, then strip and save
      {
        await stream.seek(0);
        const f = await WavPackFile.open(stream, true, ReadStyle.Average);
        expect(f.hasAPETag).toBe(true);
        expect(f.hasID3v1Tag).toBe(true);

        // Verify title is present
        const props = f.tag().properties();
        expect(props.get("TITLE")).toBeDefined();

        f.strip(WavPackTagTypes.APE);
        const props2 = f.tag().properties();
        expect(props2.get("TITLE")![0]).toBe("ID3v1");

        f.strip(WavPackTagTypes.ID3v1);
        expect(f.tag().properties().size).toBe(0);
      }
    });
  });

  describe("repeated save", () => {
    it("should handle multiple saves correctly", async () => {
      // TypeScript-only test
      const data = readTestDataBV("click.wv");
      const stream = new ByteVectorStream(data);

      // Phase 1: Multiple saves with different tag values
      {
        const f = await WavPackFile.open(stream, true, ReadStyle.Average);
        expect(f.hasAPETag).toBe(false);
        expect(f.hasID3v1Tag).toBe(false);

        f.apeTag(true)!.title = "01234 56789 ABCDE FGHIJ";
        await f.save();

        f.apeTag()!.title = "0";
        await f.save();

        f.id3v1Tag(true)!.title = "01234 56789 ABCDE FGHIJ";
        f.apeTag()!.title = "01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789";
        await f.save();
      }

      // Phase 2: Re-read and verify both tags exist
      {
        await stream.seek(0);
        const f = await WavPackFile.open(stream, true, ReadStyle.Average);
        expect(f.hasAPETag).toBe(true);
        expect(f.hasID3v1Tag).toBe(true);
      }
    });
  });
});
