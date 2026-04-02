import { describe, expect, it } from "vitest";
import { SynchData } from "../mpeg/id3v2/id3v2SynchData.js";
import { byteVectorFromArray } from "./testHelper.js";

describe("SynchData", () => {
  it("should encode/decode 127", () => {
    // TypeScript-only test
    const v = byteVectorFromArray([0, 0, 0, 127]);
    expect(SynchData.toUInt(v)).toBe(127);
    expect(SynchData.fromUInt(127).equals(v)).toBe(true);
  });

  it("should encode/decode 128", () => {
    // TypeScript-only test
    const v = byteVectorFromArray([0, 0, 1, 0]);
    expect(SynchData.toUInt(v)).toBe(128);
    expect(SynchData.fromUInt(128).equals(v)).toBe(true);
  });

  it("should encode/decode 129", () => {
    // TypeScript-only test
    const v = byteVectorFromArray([0, 0, 1, 1]);
    expect(SynchData.toUInt(v)).toBe(129);
    expect(SynchData.fromUInt(129).equals(v)).toBe(true);
  });

  it("should handle broken synchsafe data with high bit set", () => {
    // TypeScript-only test
    expect(SynchData.toUInt(byteVectorFromArray([0, 0, 0, 0xFF]))).toBe(255);
    expect(SynchData.toUInt(byteVectorFromArray([0, 0, 0xFF, 0xFF]))).toBe(65535);
  });

  it("should handle broken and too-large data", () => {
    // TypeScript-only test
    const v = byteVectorFromArray([0, 0, 0, 0xFF, 0]);
    expect(SynchData.toUInt(v)).toBe(255);
  });

  it("should decode synchsafe bytes - remove false sync", () => {
    // TypeScript-only test
    const a = byteVectorFromArray([0xFF, 0x00, 0x00]);
    const decoded = SynchData.decode(a);
    expect(decoded.length).toBe(2);
    expect(decoded.equals(byteVectorFromArray([0xFF, 0x00]))).toBe(true);
  });

  it("should decode - no false sync", () => {
    // TypeScript-only test
    const a = byteVectorFromArray([0xFF, 0x44]);
    const decoded = SynchData.decode(a);
    expect(decoded.length).toBe(2);
    expect(decoded.equals(byteVectorFromArray([0xFF, 0x44]))).toBe(true);
  });

  it("should decode - ff ff 00", () => {
    // TypeScript-only test
    const a = byteVectorFromArray([0xFF, 0xFF, 0x00]);
    const decoded = SynchData.decode(a);
    expect(decoded.length).toBe(2);
    expect(decoded.equals(byteVectorFromArray([0xFF, 0xFF]))).toBe(true);
  });

  it("should decode - ff ff ff unchanged", () => {
    // TypeScript-only test
    const a = byteVectorFromArray([0xFF, 0xFF, 0xFF]);
    const decoded = SynchData.decode(a);
    expect(decoded.length).toBe(3);
    expect(decoded.equals(byteVectorFromArray([0xFF, 0xFF, 0xFF]))).toBe(true);
  });
});
