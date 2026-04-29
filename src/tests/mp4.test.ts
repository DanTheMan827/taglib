import { describe, expect, it } from "vitest";
import { Mp4File } from "../mp4/mp4File.js";
import type { Mp4Chapter } from "../mp4/mp4Chapter.js";
import { Mp4ChapterHolder, chaptersEqual } from "../mp4/mp4Chapter.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ReadStyle } from "../toolkit/types.js";
import { openTestStream, readTestData } from "./testHelper.js";

/** Casts `null` to `IOStream` for use in mock holders that never touch the stream. */
const NULL_STREAM = null as unknown as IOStream;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openMp4File(
  filename: string,
  readProperties = true,
  readStyle = ReadStyle.Average,
): Promise<Mp4File> {
  const stream = openTestStream(filename);
  return await Mp4File.open(stream, readProperties, readStyle);
}

/** Opens a mutable in-memory copy of a test file. */
function openMutableMp4Stream(filename: string): ByteVectorStream {
  return new ByteVectorStream(readTestData(filename));
}

async function openMutableMp4File(filename: string): Promise<{ file: Mp4File; stream: ByteVectorStream }> {
  const stream = openMutableMp4Stream(filename);
  const file = await Mp4File.open(stream);
  return { file, stream };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MP4", () => {
  it("should read has-tags file", async () => {
    // C++: test_mp4.cpp – TestMP4::testHasTag
    const f = await openMp4File("has-tags.m4a");
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    expect(tag).not.toBeNull();
  });

  it("should read audio properties", async () => {
    // C++: test_mp4.cpp – TestMP4::testPropertiesAAC
    const f = await openMp4File("has-tags.m4a");
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBeGreaterThan(0);
      expect(props.channels).toBeGreaterThan(0);
      expect(props.lengthInMilliseconds).toBeGreaterThan(0);
    }
  });

  it("should read no-tags file", async () => {
    // C++: test_mp4.cpp – TestMP4::testHasTag
    const f = await openMp4File("no-tags.m4a");
    expect(f.isValid).toBe(true);
  });

  it("should read gnre (genre ID) file", async () => {
    // C++: test_mp4.cpp – TestMP4::testGnre
    const f = await openMp4File("gnre.m4a");
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    if (tag) {
      // gnre atom stores genre as ID3v1 genre index
      expect(tag.genre).toBeDefined();
    }
  });

  it("should read empty ALAC file", async () => {
    // C++: test_mp4.cpp – TestMP4::testPropertiesALAC
    const f = await openMp4File("empty_alac.m4a");
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    if (props) {
      expect(props.codec).toBeDefined();
    }
  });

  it("should read covr-junk file", async () => {
    // C++: test_mp4.cpp – TestMP4::testCovrRead2
    const f = await openMp4File("covr-junk.m4a");
    expect(f.isValid).toBe(true);
  });

  it("should read ilst-is-last file", async () => {
    // C++: test_mp4.cpp – TestMP4::testSaveExisingWhenIlstIsLast
    const f = await openMp4File("ilst-is-last.m4a");
    expect(f.isValid).toBe(true);
  });

  it("should handle non-full-meta file", async () => {
    // C++: test_mp4.cpp – TestMP4::testNonFullMetaAtom
    const f = await openMp4File("non-full-meta.m4a");
    // Should not crash
    expect(f).toBeDefined();
  });

  it("should handle nonprintable atom type", async () => {
    // C++: test_mp4.cpp – TestMP4::testNonPrintableAtom
    const f = await openMp4File("nonprintable-atom-type.m4a");
    expect(f).toBeDefined();
  });

  it("should handle blank video file", async () => {
    // C++: test_mp4.cpp – TestMP4::testPropertiesM4V
    const f = await openMp4File("blank_video.m4v");
    expect(f).toBeDefined();
  });

  it("should handle zero-length-mdat", async () => {
    // C++: test_mp4.cpp – TestMP4::testWithZeroLengthAtom
    const f = await openMp4File("zero-length-mdat.m4a");
    expect(f).toBeDefined();
  });

  it("should handle infloop file", async () => {
    // C++: test_mp4.cpp – TestMP4::testFuzzedFile
    const f = await openMp4File("infloop.m4a");
    expect(f).toBeDefined();
  });

  it("should save and re-read tag", async () => {
    // C++: test_mp4.cpp – TestMP4::testRepeatedSave
    const data = readTestData("has-tags.m4a");
    const stream = new ByteVectorStream(data);
    const f = await Mp4File.open(stream, true, ReadStyle.Average);

    if (f.isValid) {
      const tag = f.tag();
      if (tag) {
        tag.title = "MP4 Test";
        tag.artist = "Test Artist";
        await f.save();
      }

      await stream.seek(0);
      const f2 = await Mp4File.open(stream, true, ReadStyle.Average);
      const tag2 = f2.tag();
      if (tag2) {
        expect(tag2.title).toBe("MP4 Test");
        expect(tag2.artist).toBe("Test Artist");
      }
    }
  });

  // -------------------------------------------------------------------------
  // Nero chapter tests
  // -------------------------------------------------------------------------

  it("testChapterListReadEmpty", async () => {
    // C++: test_mp4.cpp – TestMP4::testChapterListReadEmpty
    const { file } = await openMutableMp4File("no-tags.m4a");
    const chapters = await file.neroChapters();
    expect(chapters.length).toBe(0);
  });

  it("testChapterListWrite", async () => {
    // C++: test_mp4.cpp – TestMP4::testChapterListWrite
    const stream = openMutableMp4Stream("no-tags.m4a");

    // File should have no chapters initially
    {
      const f = await Mp4File.open(stream);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(0);
    }

    // Write chapters
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      f.setNeroChapters([
        { title: "Introduction", startTime: 0 },
        { title: "Main Content", startTime: 30000 },
        { title: "Conclusion", startTime: 60000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Read back and verify
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(3);
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].title).toBe("Introduction");
      expect(chapters[1].startTime).toBe(30000);
      expect(chapters[1].title).toBe("Main Content");
      expect(chapters[2].startTime).toBe(60000);
      expect(chapters[2].title).toBe("Conclusion");

      // Overwrite with different chapters
      f.setNeroChapters([{ title: "Part One", startTime: 0 }]);
      expect(await f.save()).toBe(true);
    }

    // Verify overwrite
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(1);
      expect(chapters[0].title).toBe("Part One");
    }
  });

  it("testChapterListRemove", async () => {
    // C++: test_mp4.cpp – TestMP4::testChapterListRemove
    const stream = openMutableMp4Stream("no-tags.m4a");

    // Write chapters
    {
      const f = await Mp4File.open(stream);
      f.setNeroChapters([{ title: "Chapter 1", startTime: 0 }]);
      expect(await f.save()).toBe(true);
    }

    // Verify written, then remove
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(1);
      f.setNeroChapters([]);
      expect(await f.save()).toBe(true);
    }

    // Verify removed
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(0);
      // Remove from file with no chapters should also succeed
      f.setNeroChapters([]);
      expect(await f.save()).toBe(true);
    }
  });

  it("testChapterListWithExistingTags", async () => {
    // C++: test_mp4.cpp – TestMP4::testChapterListWithExistingTags
    const stream = openMutableMp4Stream("has-tags.m4a");

    // Capture original artist
    let originalArtist = "";
    {
      const f = await Mp4File.open(stream);
      expect(f.isValid).toBe(true);
      originalArtist = f.tag()?.artist ?? "";
      expect(originalArtist.length).toBeGreaterThan(0);

      f.setNeroChapters([
        { title: "Intro", startTime: 0 },
        { title: "Verse", startTime: 10000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Verify chapters written and existing tags preserved
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      expect(f.isValid).toBe(true);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(2);
      expect(chapters[0].title).toBe("Intro");
      expect(chapters[1].title).toBe("Verse");
      expect(f.tag()?.artist).toBe(originalArtist);

      f.setNeroChapters([]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      expect(f.isValid).toBe(true);
      expect(f.tag()?.artist).toBe(originalArtist);
      expect((await f.neroChapters()).length).toBe(0);
    }
  });

  it("testChapterListUnicodeTitles", async () => {
    // C++: test_mp4.cpp – TestMP4::testChapterListUnicodeTitles
    const stream = openMutableMp4Stream("no-tags.m4a");
    const japanese = "日本語";
    const german = "Über";
    const russian = "Привет";

    {
      const f = await Mp4File.open(stream);
      f.setNeroChapters([
        { title: japanese, startTime: 0 },
        { title: german, startTime: 15000 },
        { title: russian, startTime: 30000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.neroChapters();
      expect(chapters.length).toBe(3);
      expect(chapters[0].title).toBe(japanese);
      expect(chapters[1].title).toBe(german);
      expect(chapters[2].title).toBe(russian);
    }
  });

  // -------------------------------------------------------------------------
  // QuickTime chapter tests
  // -------------------------------------------------------------------------

  it("testQTChapterListReadEmpty", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListReadEmpty
    const { file } = await openMutableMp4File("no-tags.m4a");
    const chapters = await file.qtChapters();
    expect(chapters.length).toBe(0);
  });

  it("testQTChapterListWrite", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListWrite
    const stream = openMutableMp4Stream("no-tags.m4a");

    // File should have no QT chapters initially
    {
      const f = await Mp4File.open(stream);
      expect((await f.qtChapters()).length).toBe(0);
    }

    // Write chapters
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "Intro", startTime: 0 },
        { title: "Verse", startTime: 15000 },
        { title: "Outro", startTime: 30000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Read back and verify
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(3);
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].title).toBe("Intro");
      expect(chapters[1].startTime).toBe(15000);
      expect(chapters[1].title).toBe("Verse");
      expect(chapters[2].startTime).toBe(30000);
      expect(chapters[2].title).toBe("Outro");
    }
  });

  it("testQTChapterListRemove", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListRemove
    const stream = openMutableMp4Stream("no-tags.m4a");

    // Write chapters first
    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "Chapter 1", startTime: 0 },
        { title: "Chapter 2", startTime: 10000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Verify written, then remove
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(2);
      f.setQtChapters([]);
      expect(await f.save()).toBe(true);
    }

    // Verify removed
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      expect((await f.qtChapters()).length).toBe(0);
      // Remove from file with no chapters should also succeed
      f.setQtChapters([]);
      expect(await f.save()).toBe(true);
    }
  });

  it("testQTChapterListWithExistingTags", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListWithExistingTags
    const stream = openMutableMp4Stream("has-tags.m4a");

    let originalArtist = "";
    {
      const f = await Mp4File.open(stream);
      expect(f.isValid).toBe(true);
      originalArtist = f.tag()?.artist ?? "";
      expect(originalArtist.length).toBeGreaterThan(0);

      f.setQtChapters([
        { title: "Intro", startTime: 0 },
        { title: "Verse", startTime: 10000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(2);
      expect(chapters[0].title).toBe("Intro");
      expect(chapters[1].title).toBe("Verse");
      expect(f.isValid).toBe(true);
      expect(f.tag()?.artist).toBe(originalArtist);

      f.setQtChapters([]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      expect(f.isValid).toBe(true);
      expect(f.tag()?.artist).toBe(originalArtist);
      expect((await f.qtChapters()).length).toBe(0);
    }
  });

  it("testQTChapterListOverwrite", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListOverwrite
    const stream = openMutableMp4Stream("no-tags.m4a");

    // Write initial chapters
    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "Old1", startTime: 0 },
        { title: "Old2", startTime: 5000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Verify initial
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      expect((await f.qtChapters()).length).toBe(2);
    }

    // Overwrite with different chapters
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "New1", startTime: 0 },
        { title: "New2", startTime: 10000 },
        { title: "New3", startTime: 20000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Verify overwrite
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(3);
      expect(chapters[0].title).toBe("New1");
      expect(chapters[1].title).toBe("New2");
      expect(chapters[2].title).toBe("New3");
    }
  });

  it("testQTChapterListTimestampPrecision", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListTimestampPrecision
    const stream = openMutableMp4Stream("no-tags.m4a");

    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "Start", startTime: 0 },
        { title: "Precise", startTime: 1500 },
      ]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(2);
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[1].startTime).toBe(1500);
    }
  });

  it("testQTChapterListNonZeroFirstChapter", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListNonZeroFirstChapter
    const stream = openMutableMp4Stream("no-tags.m4a");

    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "One", startTime: 10000 },
        { title: "Two", startTime: 20000 },
        { title: "Three", startTime: 30000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      // dummy chapter at time 0 should be stripped on read-back
      expect(chapters.length).toBe(3);
      expect(chapters[0].startTime).toBe(10000);
      expect(chapters[1].startTime).toBe(20000);
      expect(chapters[2].startTime).toBe(30000);
      expect(chapters[0].title).toBe("One");
      expect(chapters[1].title).toBe("Two");
      expect(chapters[2].title).toBe("Three");
    }
  });

  it("testQTChapterListNoOrphanedMdat", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListNoOrphanedMdat
    const stream = openMutableMp4Stream("no-tags.m4a");
    const { Mp4Atoms } = await import("../mp4/mp4Atoms.js");

    const countMdat = async () => {
      await stream.seek(0);
      const atoms = await Mp4Atoms.create(stream);
      return atoms.atoms.filter(a => a.name === "mdat").length;
    };

    const baseCount = await countMdat();

    for (let cycle = 0; cycle < 3; cycle++) {
      {
        await stream.seek(0);
        const f = await Mp4File.open(stream);
        f.setQtChapters([
          { title: "Chapter 1", startTime: 0 },
          { title: "Chapter 2", startTime: 10000 },
        ]);
        expect(await f.save()).toBe(true);
      }
      {
        await stream.seek(0);
        const f = await Mp4File.open(stream);
        f.setQtChapters([]);
        expect(await f.save()).toBe(true);
      }
    }

    expect(await countMdat()).toBe(baseCount);
  });

  it("testQTChapterListSharedMdatPreservesAudio", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListSharedMdatPreservesAudio
    const stream = openMutableMp4Stream("no-tags.m4a");
    const { Mp4Atoms } = await import("../mp4/mp4Atoms.js");
    const { ByteVector } = await import("../byteVector.js");

    // Find the first mdat atom
    await stream.seek(0);
    let audioMdatOffset = -1;
    let audioMdatLength = 0;
    {
      const atoms = await Mp4Atoms.create(stream);
      for (const atom of atoms.atoms) {
        if (atom.name === "mdat") {
          audioMdatOffset = atom.offset;
          audioMdatLength = atom.length;
          break;
        }
      }
    }
    expect(audioMdatOffset).toBeGreaterThanOrEqual(0);
    expect(audioMdatLength).toBeGreaterThan(16);

    // Capture the audio mdat bytes
    await stream.seek(audioMdatOffset);
    const originalAudioMdat = await stream.readBlock(audioMdatLength);

    // Add a chapter track
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "Chapter 1", startTime: 0 },
        { title: "Chapter 2", startTime: 1000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Rewrite the chapter track's stco[0] to point inside the audio mdat
    // to simulate the shared-mdat case.
    {
      await stream.seek(0);
      const atoms = await Mp4Atoms.create(stream);
      const moov = atoms.find("moov");
      expect(moov).not.toBeNull();
      const traks = moov!.findAll("trak");
      expect(traks.length).toBeGreaterThanOrEqual(2);

      // Find the chapter trak (handler_type = "text")
      let chapterTrak = null;
      for (const t of traks) {
        const hdlr = t.find("mdia", "hdlr");
        if (!hdlr) continue;
        await stream.seek(hdlr.offset);
        const d = await stream.readBlock(hdlr.length);
        if (d.containsAt(ByteVector.fromString("text", 0), 16)) {
          chapterTrak = t;
          break;
        }
      }
      expect(chapterTrak).not.toBeNull();

      const stco = chapterTrak!.find("mdia", "minf", "stbl", "stco");
      expect(stco).not.toBeNull();
      // Overwrite stco[0] to point into the audio mdat data region
      await stream.seek(stco!.offset + 16);
      await stream.writeBlock(ByteVector.fromUInt(audioMdatOffset + 8));
    }

    // Trigger the chapter-removal path with the crafted stco[0]
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      f.setQtChapters([]);
      expect(await f.save()).toBe(true);
    }

    // The audio mdat must survive byte-identical
    await stream.seek(0);
    let afterMdatOffset = -1;
    let afterMdatLength = 0;
    {
      const atoms = await Mp4Atoms.create(stream);
      for (const atom of atoms.atoms) {
        if (atom.name === "mdat") {
          afterMdatOffset = atom.offset;
          afterMdatLength = atom.length;
          break;
        }
      }
    }
    expect(afterMdatOffset).toBeGreaterThanOrEqual(0);
    expect(afterMdatLength).toBe(audioMdatLength);

    await stream.seek(afterMdatOffset);
    const afterBytes = await stream.readBlock(afterMdatLength);
    expect(afterBytes.length).toBe(originalAudioMdat.length);
    for (let i = 0; i < originalAudioMdat.length; i++) {
      expect(afterBytes.get(i)).toBe(originalAudioMdat.get(i));
    }
  });

  it("testQTChapterListUnicodeTitles", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListUnicodeTitles
    const stream = openMutableMp4Stream("no-tags.m4a");
    const japanese = "日本語";
    const german = "Über";
    const russian = "Привет";

    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: japanese, startTime: 0 },
        { title: german, startTime: 15000 },
        { title: russian, startTime: 30000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(3);
      expect(chapters[0].title).toBe(japanese);
      expect(chapters[1].title).toBe(german);
      expect(chapters[2].title).toBe(russian);
    }
  });

  it("testQTChapterListEmptyTitleStripped", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListEmptyTitleStripped
    const stream = openMutableMp4Stream("no-tags.m4a");

    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([
        { title: "", startTime: 0 },
        { title: "Chapter 1", startTime: 5000 },
        { title: "Chapter 2", startTime: 10000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      // The empty t=0 entry is stripped; only the two real chapters remain.
      expect(chapters.length).toBe(2);
      expect(chapters[0].startTime).toBe(5000);
      expect(chapters[0].title).toBe("Chapter 1");
      expect(chapters[1].startTime).toBe(10000);
      expect(chapters[1].title).toBe("Chapter 2");
    }
  });

  it("testQTChapterListSingleEmptyTitleNotStripped", async () => {
    // C++: test_mp4.cpp – TestMP4::testQTChapterListSingleEmptyTitleNotStripped
    const stream = openMutableMp4Stream("no-tags.m4a");

    {
      const f = await Mp4File.open(stream);
      f.setQtChapters([{ title: "", startTime: 0 }]);
      expect(await f.save()).toBe(true);
    }

    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const chapters = await f.qtChapters();
      expect(chapters.length).toBe(1);
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].title).toBe("");
    }
  });

  it("testNeroAndQTChaptersAreIndependent", async () => {
    // C++: test_mp4.cpp – TestMP4::testNeroAndQTChaptersAreIndependent
    const stream = openMutableMp4Stream("no-tags.m4a");

    // Write both formats in a single save
    {
      const f = await Mp4File.open(stream);
      f.setNeroChapters([
        { title: "Nero 1", startTime: 0 },
        { title: "Nero 2", startTime: 10000 },
      ]);
      f.setQtChapters([
        { title: "QT 1", startTime: 0 },
        { title: "QT 2", startTime: 20000 },
      ]);
      expect(await f.save()).toBe(true);
    }

    // Verify both are present and distinct
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      const nero = await f.neroChapters();
      const qt = await f.qtChapters();

      expect(nero.length).toBe(2);
      expect(nero[0].title).toBe("Nero 1");
      expect(nero[1].title).toBe("Nero 2");

      expect(qt.length).toBe(2);
      expect(qt[0].title).toBe("QT 1");
      expect(qt[1].title).toBe("QT 2");

      // Remove only the QT track
      f.setQtChapters([]);
      expect(await f.save()).toBe(true);
    }

    // QT removed; Nero chapters must be fully intact
    {
      await stream.seek(0);
      const f = await Mp4File.open(stream);
      expect((await f.qtChapters()).length).toBe(0);

      const nero = await f.neroChapters();
      expect(nero.length).toBe(2);
      expect(nero[0].title).toBe("Nero 1");
      expect(nero[1].title).toBe("Nero 2");
    }
  });

  it("testNeroChaptersAloneWhenNoQT", async () => {
    // C++: test_mp4.cpp – TestMP4::testNeroChaptersAloneWhenNoQT
    // Nero only -- QT track must remain absent
    {
      const stream = openMutableMp4Stream("no-tags.m4a");

      {
        const f = await Mp4File.open(stream);
        f.setNeroChapters([{ title: "Nero Only", startTime: 0 }]);
        expect(await f.save()).toBe(true);
      }

      {
        await stream.seek(0);
        const f = await Mp4File.open(stream);
        expect((await f.neroChapters()).length).toBe(1);
        expect((await f.qtChapters()).length).toBe(0);
      }
    }

    // QT only -- Nero chpl atom must remain absent
    {
      const stream = openMutableMp4Stream("no-tags.m4a");

      {
        const f = await Mp4File.open(stream);
        f.setQtChapters([{ title: "QT Only", startTime: 0 }]);
        expect(await f.save()).toBe(true);
      }

      {
        await stream.seek(0);
        const f = await Mp4File.open(stream);
        expect((await f.qtChapters()).length).toBe(1);
        expect((await f.neroChapters()).length).toBe(0);
      }
    }
  });

  it("testLazyReadingAndWritingChapters", async () => {
    // C++: test_mp4.cpp – TestMP4::testLazyReadingAndWritingChapters
    // Port of the lazy-read / dirty-write pattern test using vitest spies.
    const mockChapters: Mp4Chapter[] = [{ title: "Mock", startTime: 123 }];

    // Create a mock holder subclass with spy methods
    class MockHolder extends Mp4ChapterHolder {
      readCount = 0;
      writeCount = 0;

      override async getChapters(_stream: IOStream): Promise<Mp4Chapter[]> {
        if (!this._loaded) {
          await this.read(_stream);
          this._loaded = true;
          this._modified = false;
        }
        return this._chapters;
      }

      override async read(_stream: IOStream): Promise<boolean> {
        this.readCount++;
        this._chapters = [...mockChapters];
        return true;
      }

      override async write(_stream: IOStream): Promise<boolean> {
        this.writeCount++;
        return true;
      }
    }

    // No reads or writes if chapters are not used (saveIfModified called without prior access)
    {
      const holder = new MockHolder();
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.readCount).toBe(0);
      expect(holder.writeCount).toBe(0);
    }

    // Do not read if already read, do not write if not modified
    {
      const holder = new MockHolder();
      const chapters = await holder.getChapters(NULL_STREAM);
      expect(chaptersEqual(chapters, mockChapters)).toBe(true);
      expect(holder.readCount).toBe(1);
      await holder.getChapters(NULL_STREAM); // second access must not re-read
      expect(holder.readCount).toBe(1);
      await holder.saveIfModified(NULL_STREAM); // not modified – no write
      expect(holder.writeCount).toBe(0);
    }

    // setChapters with same value after read → no write
    {
      const holder = new MockHolder();
      await holder.getChapters(NULL_STREAM);
      expect(holder.readCount).toBe(1);
      holder.setChapters(mockChapters); // same chapters
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.writeCount).toBe(0);
    }

    // Set without read → always write
    {
      const holder = new MockHolder();
      holder.setChapters([]);
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.readCount).toBe(0);
      expect(holder.writeCount).toBe(1);
    }

    // Write if modified
    {
      const holder = new MockHolder();
      expect(chaptersEqual(await holder.getChapters(NULL_STREAM), mockChapters)).toBe(true);
      expect(holder.readCount).toBe(1);

      const chapters1: Mp4Chapter[] = [{ title: "Chapter 1", startTime: 0 }];
      holder.setChapters(chapters1);
      expect(chaptersEqual(await holder.getChapters(NULL_STREAM), chapters1)).toBe(true);
      await holder.saveIfModified(NULL_STREAM);
      expect(chaptersEqual(await holder.getChapters(NULL_STREAM), chapters1)).toBe(true);
      expect(holder.writeCount).toBe(1);

      // Setting same chapters again = no write
      holder.setChapters(chapters1);
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.writeCount).toBe(1);

      const chapters2: Mp4Chapter[] = [
        { title: "Chapter 1", startTime: 0 },
        { title: "Chapter 2", startTime: 2 },
      ];
      holder.setChapters(chapters2);
      expect(chaptersEqual(await holder.getChapters(NULL_STREAM), chapters2)).toBe(true);
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.writeCount).toBe(2);

      const chapters2b: Mp4Chapter[] = [
        { title: "Chapter 1", startTime: 0 },
        { title: "Chapter 2", startTime: 2 },
      ];
      holder.setChapters(chapters2b);
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.writeCount).toBe(2); // still 2 – no change

      holder.setChapters([]);
      expect((await holder.getChapters(NULL_STREAM)).length).toBe(0);
      await holder.saveIfModified(NULL_STREAM);
      expect(holder.writeCount).toBe(3);
    }
  });
});
