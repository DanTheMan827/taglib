/**
 * Picture write/read-back tests.
 * Writes artwork via complexProperties, saves, re-reads, and verifies the
 * picture data is correctly preserved. Covers all formats that support
 * embedded pictures.
 */
import { describe, it, expect } from "vitest";
import { FileRef } from "../src/fileRef.js";
import { ByteVector } from "../src/byteVector.js";
import { ByteVectorStream } from "../src/toolkit/byteVectorStream.js";
import { Variant, type VariantMap } from "../src/toolkit/variant.js";
import { readTestData } from "./testHelper.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a VariantMap for a PICTURE complex property.
 * Uses a deterministic fake image payload so round-trip byte equality is easy.
 */
function makePicture(opts: {
  size?: number;
  mimeType?: string;
  description?: string;
  pictureType?: number;
  width?: number;
  height?: number;
  colorDepth?: number;
  numColors?: number;
} = {}): VariantMap {
  const size = opts.size ?? 256;
  // Fill with a recognisable pattern: 0x00..0xFF repeating
  const raw = new Uint8Array(size);
  for (let i = 0; i < size; i++) raw[i] = i & 0xFF;

  const m: VariantMap = new Map();
  m.set("data", Variant.fromByteVector(new ByteVector(raw)));
  m.set("mimeType", Variant.fromString(opts.mimeType ?? "image/png"));
  m.set("description", Variant.fromString(opts.description ?? "Front Cover"));
  m.set("pictureType", Variant.fromInt(opts.pictureType ?? 3)); // Front Cover
  if (opts.width !== undefined) m.set("width", Variant.fromInt(opts.width));
  if (opts.height !== undefined) m.set("height", Variant.fromInt(opts.height));
  if (opts.colorDepth !== undefined) m.set("colorDepth", Variant.fromInt(opts.colorDepth));
  if (opts.numColors !== undefined) m.set("numColors", Variant.fromInt(opts.numColors));
  return m;
}

/**
 * Generic picture write→save→re-read cycle via FileRef.
 * @returns The pictures array read back after save.
 */
async function writePictureAndReRead(
  testFile: string,
  ext: string,
  pictures: VariantMap[],
): Promise<VariantMap[]> {
  const data = readTestData(testFile);
  let ref = await FileRef.fromByteArray(new Uint8Array(data), "test" + ext);
  expect(ref.isNull).toBe(false);

  const ok = ref.setComplexProperties("PICTURE", pictures);
  expect(ok).toBe(true);
  ref.save();

  // Capture modified bytes and re-read
  const stream = ref.file()!.stream() as ByteVectorStream;
  const modified = stream.data().data;

  ref = await FileRef.fromByteArray(new Uint8Array(modified), "test" + ext);
  expect(ref.isNull).toBe(false);
  return ref.complexProperties("PICTURE");
}

// ---------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------

describe("Picture write/read — FLAC", () => {
  it("should write and read back a single picture", async () => {
    const pic = makePicture({ width: 300, height: 300, colorDepth: 24, numColors: 0 });
    const pics = await writePictureAndReRead("silence-44-s.flac", ".flac", [pic]);

    expect(pics.length).toBe(1);
    const p = pics[0];
    expect(p.get("mimeType")!.toString()).toBe("image/png");
    expect(p.get("description")!.toString()).toBe("Front Cover");
    expect(p.get("pictureType")!.toInt()).toBe(3);
    expect(p.get("width")!.toInt()).toBe(300);
    expect(p.get("height")!.toInt()).toBe(300);
    expect(p.get("colorDepth")!.toInt()).toBe(24);
    expect(p.get("data")!.toByteVector().length).toBe(256);
    // Verify byte-for-byte data integrity
    const readData = p.get("data")!.toByteVector();
    for (let i = 0; i < 256; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should write and read back multiple pictures", async () => {
    const front = makePicture({ mimeType: "image/jpeg", description: "Front", pictureType: 3 });
    const back = makePicture({ mimeType: "image/png", description: "Back", pictureType: 4, size: 128 });
    const pics = await writePictureAndReRead("silence-44-s.flac", ".flac", [front, back]);

    expect(pics.length).toBe(2);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/jpeg");
    expect(pics[0].get("description")!.toString()).toBe("Front");
    expect(pics[1].get("mimeType")!.toString()).toBe("image/png");
    expect(pics[1].get("description")!.toString()).toBe("Back");
    expect(pics[1].get("data")!.toByteVector().length).toBe(128);
  });

  it("should replace existing pictures", async () => {
    // First, write one picture
    const data = readTestData("silence-44-s.flac");
    let ref = await FileRef.fromByteArray(new Uint8Array(data), "test.flac");
    ref.setComplexProperties("PICTURE", [makePicture({ description: "Old" })]);
    ref.save();

    const stream1 = ref.file()!.stream() as ByteVectorStream;
    const modified1 = stream1.data().data;

    // Now replace with a different picture
    ref = await FileRef.fromByteArray(new Uint8Array(modified1), "test.flac");
    ref.setComplexProperties("PICTURE", [makePicture({ description: "New", size: 64 })]);
    ref.save();

    const stream2 = ref.file()!.stream() as ByteVectorStream;
    const modified2 = stream2.data().data;

    ref = await FileRef.fromByteArray(new Uint8Array(modified2), "test.flac");
    const pics = ref.complexProperties("PICTURE");
    expect(pics.length).toBe(1);
    expect(pics[0].get("description")!.toString()).toBe("New");
    expect(pics[0].get("data")!.toByteVector().length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// MP4 (M4A)
// ---------------------------------------------------------------------------

describe("Picture write/read — MP4 (M4A)", () => {
  it("should write and read back a JPEG picture", async () => {
    const pic = makePicture({ mimeType: "image/jpeg" });
    const pics = await writePictureAndReRead("has-tags.m4a", ".m4a", [pic]);

    expect(pics.length).toBe(1);
    const p = pics[0];
    expect(p.get("mimeType")!.toString()).toBe("image/jpeg");
    expect(p.get("data")!.toByteVector().length).toBe(256);
    // Verify data integrity
    const readData = p.get("data")!.toByteVector();
    for (let i = 0; i < 256; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should write and read back a PNG picture", async () => {
    const pic = makePicture({ mimeType: "image/png" });
    const pics = await writePictureAndReRead("has-tags.m4a", ".m4a", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/png");
  });

  it("should write and read back multiple cover arts", async () => {
    const a = makePicture({ mimeType: "image/jpeg", size: 100 });
    const b = makePicture({ mimeType: "image/png", size: 200 });
    const pics = await writePictureAndReRead("has-tags.m4a", ".m4a", [a, b]);

    expect(pics.length).toBe(2);
    expect(pics[0].get("data")!.toByteVector().length).toBe(100);
    expect(pics[1].get("data")!.toByteVector().length).toBe(200);
  });

  it("should work on file with no existing tags", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", size: 64 });
    const pics = await writePictureAndReRead("no-tags.m4a", ".m4a", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("data")!.toByteVector().length).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// MP3 (ID3v2 APIC frames)
// ---------------------------------------------------------------------------

describe("Picture write/read — MP3 (ID3v2)", () => {
  it("should write and read back a picture via APIC frame", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", description: "Album art" });
    const pics = await writePictureAndReRead("xing.mp3", ".mp3", [pic]);

    expect(pics.length).toBe(1);
    const p = pics[0];
    expect(p.get("mimeType")!.toString()).toBe("image/jpeg");
    expect(p.get("description")!.toString()).toBe("Album art");
    // ID3v2 stores pictureType as string
    expect(parseInt(p.get("pictureType")!.toString(), 10)).toBe(3);
    expect(p.get("data")!.toByteVector().length).toBe(256);
    // Verify data integrity
    const readData = p.get("data")!.toByteVector();
    for (let i = 0; i < 256; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should write and read back multiple pictures", async () => {
    const front = makePicture({ mimeType: "image/jpeg", description: "Front", pictureType: 3 });
    const back = makePicture({ mimeType: "image/png", description: "Back Cover", pictureType: 4, size: 128 });
    const pics = await writePictureAndReRead("xing.mp3", ".mp3", [front, back]);

    expect(pics.length).toBe(2);
    expect(pics[0].get("description")!.toString()).toBe("Front");
    expect(pics[1].get("description")!.toString()).toBe("Back Cover");
    expect(pics[1].get("data")!.toByteVector().length).toBe(128);
  });

  it("should work on file with existing ID3v2 tags", async () => {
    // Use lame_cbr.mp3 which has standard ID3v2.3 tags (itunes10.mp3 has
    // legacy v2.2 tags with 3-char frame IDs that cause format mismatches)
    const pic = makePicture({ size: 512 });
    const pics = await writePictureAndReRead("lame_cbr.mp3", ".mp3", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("data")!.toByteVector().length).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// OGG Vorbis (XiphComment METADATA_BLOCK_PICTURE)
// ---------------------------------------------------------------------------

describe("Picture write/read — OGG Vorbis", () => {
  it("should write and read back a picture via METADATA_BLOCK_PICTURE", async () => {
    const pic = makePicture({
      mimeType: "image/jpeg",
      description: "OGG Cover",
      width: 640,
      height: 480,
      colorDepth: 24,
      numColors: 0,
    });
    const pics = await writePictureAndReRead("empty.ogg", ".ogg", [pic]);

    expect(pics.length).toBe(1);
    const p = pics[0];
    expect(p.get("mimeType")!.toString()).toBe("image/jpeg");
    expect(p.get("description")!.toString()).toBe("OGG Cover");
    expect(p.get("pictureType")!.toInt()).toBe(3);
    expect(p.get("width")!.toInt()).toBe(640);
    expect(p.get("height")!.toInt()).toBe(480);
    expect(p.get("data")!.toByteVector().length).toBe(256);
    // Verify data integrity
    const readData = p.get("data")!.toByteVector();
    for (let i = 0; i < 256; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should write and read back multiple pictures", async () => {
    const a = makePicture({ description: "Front", size: 100 });
    const b = makePicture({ description: "Artist", pictureType: 8, size: 200 });
    const pics = await writePictureAndReRead("empty.ogg", ".ogg", [a, b]);

    expect(pics.length).toBe(2);
    expect(pics[0].get("description")!.toString()).toBe("Front");
    expect(pics[1].get("description")!.toString()).toBe("Artist");
  });
});

// ---------------------------------------------------------------------------
// WAV (ID3v2 embedded in RIFF)
// ---------------------------------------------------------------------------

describe("Picture write/read — WAV", () => {
  it("should write and read back a picture via ID3v2 in RIFF", async () => {
    const pic = makePicture({ mimeType: "image/png", description: "WAV Cover" });
    const pics = await writePictureAndReRead("empty.wav", ".wav", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/png");
    expect(pics[0].get("description")!.toString()).toBe("WAV Cover");
    expect(pics[0].get("data")!.toByteVector().length).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// AIFF (ID3v2 embedded in AIFF)
// ---------------------------------------------------------------------------

describe("Picture write/read — AIFF", () => {
  it("should write and read back a picture via ID3v2 in AIFF", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", description: "AIFF Cover" });
    const pics = await writePictureAndReRead("noise.aif", ".aif", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/jpeg");
    expect(pics[0].get("description")!.toString()).toBe("AIFF Cover");
    expect(pics[0].get("data")!.toByteVector().length).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// ASF / WMA (WM/Picture attribute)
// ---------------------------------------------------------------------------

describe("Picture write/read — ASF (WMA)", () => {
  it("should write and read back a picture via WM/Picture", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", description: "WMA Cover" });
    const pics = await writePictureAndReRead("silence-1.wma", ".wma", [pic]);

    expect(pics.length).toBe(1);
    const p = pics[0];
    expect(p.get("mimeType")!.toString()).toBe("image/jpeg");
    expect(p.get("description")!.toString()).toBe("WMA Cover");
    expect(p.get("data")!.toByteVector().length).toBe(256);
    // Verify data integrity
    const readData = p.get("data")!.toByteVector();
    for (let i = 0; i < 256; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });
});

// ---------------------------------------------------------------------------
// MPEG formats with APE tags (MPC, WavPack, APE file) — no picture support
// via complexProperties, but verify the API doesn't crash.
// Also test formats that use ID3v2 for pictures.
// ---------------------------------------------------------------------------

describe("Picture write/read — DSF (ID3v2)", () => {
  it("should write and read back a picture via ID3v2 in DSF", async () => {
    const pic = makePicture({ mimeType: "image/png", description: "DSF Art" });
    const pics = await writePictureAndReRead("empty10ms.dsf", ".dsf", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/png");
    expect(pics[0].get("description")!.toString()).toBe("DSF Art");
    expect(pics[0].get("data")!.toByteVector().length).toBe(256);
  });
});

describe("Picture write/read — TrueAudio (ID3v2)", () => {
  it("should write and read back a picture via ID3v2 in TTA", async () => {
    const pic = makePicture({ mimeType: "image/jpeg", description: "TTA Art" });
    const pics = await writePictureAndReRead("empty.tta", ".tta", [pic]);

    expect(pics.length).toBe(1);
    expect(pics[0].get("mimeType")!.toString()).toBe("image/jpeg");
    expect(pics[0].get("description")!.toString()).toBe("TTA Art");
    expect(pics[0].get("data")!.toByteVector().length).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// Cross-format data integrity test
// ---------------------------------------------------------------------------

describe("Picture data integrity", () => {
  it("should preserve large picture data (4KB) through FLAC round-trip", async () => {
    const pic = makePicture({ size: 4096, mimeType: "image/jpeg" });
    const pics = await writePictureAndReRead("silence-44-s.flac", ".flac", [pic]);

    expect(pics.length).toBe(1);
    const readData = pics[0].get("data")!.toByteVector();
    expect(readData.length).toBe(4096);
    for (let i = 0; i < 4096; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should preserve large picture data (4KB) through MP3 round-trip", async () => {
    const pic = makePicture({ size: 4096, mimeType: "image/jpeg" });
    const pics = await writePictureAndReRead("xing.mp3", ".mp3", [pic]);

    expect(pics.length).toBe(1);
    const readData = pics[0].get("data")!.toByteVector();
    expect(readData.length).toBe(4096);
    for (let i = 0; i < 4096; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should preserve large picture data (4KB) through M4A round-trip", async () => {
    const pic = makePicture({ size: 4096, mimeType: "image/png" });
    const pics = await writePictureAndReRead("has-tags.m4a", ".m4a", [pic]);

    expect(pics.length).toBe(1);
    const readData = pics[0].get("data")!.toByteVector();
    expect(readData.length).toBe(4096);
    for (let i = 0; i < 4096; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });

  it("should preserve large picture data (4KB) through OGG round-trip", async () => {
    const pic = makePicture({ size: 4096, mimeType: "image/jpeg" });
    const pics = await writePictureAndReRead("empty.ogg", ".ogg", [pic]);

    expect(pics.length).toBe(1);
    const readData = pics[0].get("data")!.toByteVector();
    expect(readData.length).toBe(4096);
    for (let i = 0; i < 4096; i++) {
      expect(readData.get(i)).toBe(i & 0xFF);
    }
  });
});
