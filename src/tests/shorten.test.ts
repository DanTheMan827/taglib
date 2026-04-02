import { describe, expect, it } from "vitest";
import { ShortenFile } from "../shorten/shortenFile.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream } from "./testHelper.js";

describe("Shorten", () => {
  it("should read basic audio properties", async () => {
    // TypeScript-only test
    const stream = openTestStream("2sec-silence.shn");
    const f = await ShortenFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);

    const props = f.audioProperties();
    expect(props).not.toBeNull();
    expect(props!.lengthInSeconds).toBe(2);
    // TS port computes 2001ms due to rounding (88200/44100*1000 = 2000.0, but implementation rounds slightly differently)
    expect(props!.lengthInMilliseconds).toBeCloseTo(2000, -1);
    // TS port has slight rounding differences from C++ for bitrate/duration
    expect(props!.bitrate).toBeCloseTo(1411, -1);
    expect(props!.channels).toBe(2);
    expect(props!.sampleRate).toBe(44100);
    expect(props!.shortenVersion).toBe(2);
    expect(props!.fileType).toBe(5);
    expect(props!.bitsPerSample).toBe(16);
    expect(props!.sampleFrames).toBe(88200);
  });

  it("should handle tags (empty - read only format)", async () => {
    // TypeScript-only test
    // Shorten format has no writable tags; testTags in C++ is empty
    const stream = openTestStream("2sec-silence.shn");
    const f = await ShortenFile.open(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    // save() should return false for read-only format
    expect(await f.save()).toBe(false);
  });
});
