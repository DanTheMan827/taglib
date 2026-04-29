/** @packageDocumentation QuickTime-style MP4 chapter track support. */
import { ByteVector, StringType } from "../byteVector.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Position, type offset_t } from "../toolkit/types.js";
import { Mp4ChapterHolder, type Mp4Chapter } from "./mp4Chapter.js";
import { Mp4Atoms, type Mp4Atom } from "./mp4Atoms.js";
import {
  parseAtoms,
  renderAtom,
  renderFullBox,
  updateChunkOffsets,
  updateParentSizes,
} from "./mp4AtomHelpers.js";

// ---------------------------------------------------------------------------
// Internal helpers – movie info
// ---------------------------------------------------------------------------

/** Movie-level info from the `mvhd` atom. */
interface MovieInfo {
  /** Movie timescale (units per second). */
  timescale: number;
  /** Total movie duration in `timescale` units. */
  duration: number;
  /** Total movie duration converted to milliseconds. */
  durationMs: number;
}

/** Reads movie info from the `mvhd` atom. */
async function readMovieInfo(stream: IOStream, atoms: Mp4Atoms): Promise<MovieInfo> {
  const info: MovieInfo = { timescale: 0, duration: 0, durationMs: 0 };
  const moov = atoms.find("moov");
  if (!moov) return info;

  const mvhd = moov.find("mvhd");
  if (!mvhd) return info;

  await stream.seek(mvhd.offset);
  const data = await stream.readBlock(mvhd.length);
  if (data.length < 8 + 4) return info;

  const version = data.get(8);
  let timescale: number;
  let duration: number;

  if (version === 1 && data.length >= 8 + 28) {
    timescale = data.toUInt(28);
    duration = Number(data.toLongLong(32));
  } else if (data.length >= 8 + 16 + 4) {
    timescale = data.toUInt(20);
    duration = data.toUInt(24);
  } else {
    return info;
  }

  if (timescale > 0 && duration > 0) {
    info.timescale = timescale;
    info.duration = duration;
    info.durationMs = Math.round(duration * 1000.0 / timescale);
  }
  return info;
}

/** Audio track info. */
interface TrackInfo {
  trak: Mp4Atom | null;
  trackId: number;
}

/** Finds the first audio track (`soun` handler). */
async function findAudioTrack(stream: IOStream, atoms: Mp4Atoms): Promise<TrackInfo> {
  const info: TrackInfo = { trak: null, trackId: 0 };
  const moov = atoms.find("moov");
  if (!moov) return info;

  for (const trak of moov.findAll("trak")) {
    const hdlr = trak.find("mdia", "hdlr");
    if (!hdlr) continue;

    await stream.seek(hdlr.offset);
    const data = await stream.readBlock(hdlr.length);
    if (!data.containsAt(ByteVector.fromString("soun", StringType.Latin1), 16)) continue;

    info.trak = trak;
    const tkhd = trak.find("tkhd");
    if (tkhd) {
      await stream.seek(tkhd.offset);
      const tkhdData = await stream.readBlock(tkhd.length);
      const tkVersion = tkhdData.get(8);
      if (tkVersion === 1 && tkhdData.length >= 8 + 20 + 4) {
        info.trackId = tkhdData.toUInt(28);
      } else if (tkhdData.length >= 8 + 12 + 4) {
        info.trackId = tkhdData.toUInt(20);
      }
    }
    return info;
  }
  return info;
}

/** Reads the `next_track_ID` field from `mvhd`. */
async function getNextTrackId(stream: IOStream, atoms: Mp4Atoms): Promise<number> {
  const moov = atoms.find("moov");
  if (!moov) return 0;
  const mvhd = moov.find("mvhd");
  if (!mvhd) return 0;

  await stream.seek(mvhd.offset);
  const data = await stream.readBlock(mvhd.length);
  const version = data.get(8);
  const nextTrackIdOffset = version === 1 ? 116 : 104;
  if (data.length >= nextTrackIdOffset + 4) return data.toUInt(nextTrackIdOffset);
  return 0;
}

/** Writes the `next_track_ID` field in `mvhd`. */
async function setNextTrackId(stream: IOStream, atoms: Mp4Atoms, newId: number): Promise<void> {
  const moov = atoms.find("moov");
  if (!moov) return;
  const mvhd = moov.find("mvhd");
  if (!mvhd) return;

  await stream.seek(mvhd.offset);
  const data = await stream.readBlock(mvhd.length);
  const version = data.get(8);
  const nextTrackIdOffset = version === 1 ? 116 : 104;
  if (data.length >= nextTrackIdOffset + 4) {
    await stream.seek(mvhd.offset + nextTrackIdOffset);
    await stream.writeBlock(ByteVector.fromUInt(newId));
  }
}

/** Finds an existing chapter track referenced by the audio track's `tref/chap`. */
async function findChapterTrak(
  stream: IOStream,
  atoms: Mp4Atoms,
  audioTrak: Mp4Atom,
): Promise<Mp4Atom | null> {
  const moov = atoms.find("moov");
  if (!moov) return null;

  for (const child of audioTrak.children) {
    if (child.name !== "tref") continue;

    await stream.seek(child.offset + 8);
    const trefEnd = child.offset + child.length;

    while ((await stream.tell()) + 8 <= trefEnd) {
      const boxStart = await stream.tell();
      const header = await stream.readBlock(8);
      if (header.length < 8) break;

      const boxSize = header.toUInt();
      if (boxSize < 8) break;

      const boxName = header.mid(4, 4).toString(StringType.Latin1);
      if (boxName === "chap" && boxSize >= 12) {
        const refData = await stream.readBlock(boxSize - 8);
        const refTrackId = refData.toUInt();

        for (const t of moov.findAll("trak")) {
          const tkhd = t.find("tkhd");
          if (!tkhd) continue;

          await stream.seek(tkhd.offset);
          const tkhdData = await stream.readBlock(tkhd.length);
          if (tkhdData.length < 24) continue;

          const version = tkhdData.get(8);
          const tid = version === 1 && tkhdData.length >= 32
            ? tkhdData.toUInt(28)
            : tkhdData.toUInt(20);

          if (tid === refTrackId) return t;
        }
      }

      await stream.seek(boxStart + boxSize);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Text sample helpers
// ---------------------------------------------------------------------------

/** Size of the `encd` atom appended to each text sample (12 bytes). */
const ENCD_ATOM_SIZE = 12;

/** Builds a single text sample: 2-byte length + UTF-8 text + `encd` atom. */
function buildTextSample(title: string): ByteVector {
  const utf8 = ByteVector.fromString(title, StringType.UTF8);
  const textLen = utf8.length;

  const sample = new ByteVector();
  sample.append(ByteVector.fromShort(textLen));
  if (textLen > 0) sample.append(utf8);

  // encd atom: size(4) + "encd"(4) + padding(2) + encoding(2: 0x0100 = UTF-8)
  const encdData = new ByteVector();
  encdData.append(ByteVector.fromShort(0));        // padding
  encdData.append(ByteVector.fromShort(0x0100));   // UTF-8
  sample.append(renderAtom("encd", encdData));

  return sample;
}

/** Calculates per-sample sizes for the given chapter list. */
function calculateSampleSizes(chapters: Mp4Chapter[]): number[] {
  return chapters.map(ch => {
    const textLen = ByteVector.fromString(ch.title, StringType.UTF8).length;
    return 2 + textLen + ENCD_ATOM_SIZE;
  });
}

// ---------------------------------------------------------------------------
// stbl box builders
// ---------------------------------------------------------------------------

/** Builds an `stsd` atom for a QT text track. */
function buildStsd(): ByteVector {
  // QT text sample entry body (51 bytes), matching ffmpeg's chapter track output.
  const entryBody = new Uint8Array([
    // reserved(6) + dref_index(2)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    // display flags(4)
    0x00, 0x00, 0x00, 0x01,
    // text justification(4)
    0x00, 0x00, 0x00, 0x00,
    // background color RGB(6)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // default text box(8)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // font ID(2)
    0x00, 0x01,
    // style_flags(1) + font_size(1) + text_color(4)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // ftab: size(4)=13 + "ftab"(4) + entry_count(2)=1 + fontID(2)=1 + name_len(1)=0
    0x00, 0x00, 0x00, 0x0d, 0x66, 0x74, 0x61, 0x62,
    0x00, 0x01, 0x00, 0x01, 0x00,
  ]);

  const sampleEntry = ByteVector.fromUInt(8 + entryBody.length);
  sampleEntry.append(ByteVector.fromString("text", StringType.Latin1));
  sampleEntry.append(ByteVector.fromByteArray(entryBody));

  const stsdPayload = new ByteVector();
  stsdPayload.append(ByteVector.fromUInt(1)); // entry count
  stsdPayload.append(sampleEntry);

  return renderFullBox("stsd", 0, 0, stsdPayload);
}

/** Builds an `stts` (time-to-sample) atom for the given chapters. */
function buildStts(chapters: Mp4Chapter[], timescale: number, durationMs: number): ByteVector {
  const count = chapters.length;
  if (count === 0) return new ByteVector();

  const toTs = (ms: number) => Math.round(ms * timescale / 1000.0);
  const totalDuration = toTs(durationMs);

  const durations: number[] = [];
  for (let i = 0; i < count; i++) {
    const startTs = toTs(chapters[i].startTime);
    let dur: number;
    if (i + 1 < count) {
      const nextTs = toTs(chapters[i + 1].startTime);
      dur = nextTs - startTs;
    } else {
      dur = totalDuration > startTs ? totalDuration - startTs : 0;
    }
    durations.push(dur);
  }

  const payload = new ByteVector();
  payload.append(ByteVector.fromUInt(count));
  for (const d of durations) {
    payload.append(ByteVector.fromUInt(1)); // sample count
    payload.append(ByteVector.fromUInt(d)); // sample delta
  }

  return renderFullBox("stts", 0, 0, payload);
}

/** Builds an `stsz` (sample size) atom. */
function buildStsz(sampleSizes: number[]): ByteVector {
  const payload = new ByteVector();
  payload.append(ByteVector.fromUInt(0)); // default_sample_size = 0 (per-sample)
  payload.append(ByteVector.fromUInt(sampleSizes.length));
  for (const sz of sampleSizes) payload.append(ByteVector.fromUInt(sz));
  return renderFullBox("stsz", 0, 0, payload);
}

/** Builds an `stsc` (sample-to-chunk) atom placing all samples in one chunk. */
function buildStsc(sampleCount: number): ByteVector {
  const payload = new ByteVector();
  payload.append(ByteVector.fromUInt(1));            // entry count
  payload.append(ByteVector.fromUInt(1));            // first chunk
  payload.append(ByteVector.fromUInt(sampleCount));  // samples per chunk
  payload.append(ByteVector.fromUInt(1));            // sample description index
  return renderFullBox("stsc", 0, 0, payload);
}

/** Builds an `stco` (chunk offset) atom with a single entry. */
function buildStco(offset: number): ByteVector {
  const payload = new ByteVector();
  payload.append(ByteVector.fromUInt(1));       // entry count
  payload.append(ByteVector.fromUInt(offset));  // chunk offset
  return renderFullBox("stco", 0, 0, payload);
}

/** Builds a complete chapter `trak` atom with all required child atoms. */
function buildChapterTrak(
  trackId: number,
  timescale: number,
  durationMs: number,
  chapters: Mp4Chapter[],
  sampleSizes: number[],
  textDataOffset: offset_t,
  movieDuration: number,
): ByteVector {
  const count = chapters.length;
  const totalDuration = Math.round(durationMs * timescale / 1000.0);
  const chunkOffset = textDataOffset;

  // tkhd (track header)
  const tkhdData = new ByteVector();
  tkhdData.append(ByteVector.fromSize(4, 0));    // creation time
  tkhdData.append(ByteVector.fromSize(4, 0));    // modification time
  tkhdData.append(ByteVector.fromUInt(trackId));
  tkhdData.append(ByteVector.fromSize(4, 0));    // reserved
  tkhdData.append(ByteVector.fromUInt(totalDuration));
  tkhdData.append(ByteVector.fromSize(8, 0));    // reserved
  tkhdData.append(ByteVector.fromShort(0));      // layer
  tkhdData.append(ByteVector.fromShort(0));      // alternate_group
  tkhdData.append(ByteVector.fromShort(0));      // volume
  tkhdData.append(ByteVector.fromShort(0));      // reserved
  // Identity matrix
  tkhdData.append(ByteVector.fromUInt(0x00010000));
  tkhdData.append(ByteVector.fromSize(4, 0));
  tkhdData.append(ByteVector.fromSize(4, 0));
  tkhdData.append(ByteVector.fromSize(4, 0));
  tkhdData.append(ByteVector.fromUInt(0x00010000));
  tkhdData.append(ByteVector.fromSize(4, 0));
  tkhdData.append(ByteVector.fromSize(4, 0));
  tkhdData.append(ByteVector.fromSize(4, 0));
  tkhdData.append(ByteVector.fromUInt(0x40000000));
  tkhdData.append(ByteVector.fromUInt(0)); // width
  tkhdData.append(ByteVector.fromUInt(0)); // height
  const tkhd = renderFullBox("tkhd", 0, 0x02, tkhdData); // flags=0x02: track_in_movie

  // mdhd (media header)
  const mdhdData = new ByteVector();
  mdhdData.append(ByteVector.fromSize(4, 0));    // creation time
  mdhdData.append(ByteVector.fromSize(4, 0));    // modification time
  mdhdData.append(ByteVector.fromUInt(timescale));
  mdhdData.append(ByteVector.fromUInt(totalDuration));
  mdhdData.append(ByteVector.fromShort(0));      // language
  mdhdData.append(ByteVector.fromShort(0));      // pre_defined
  const mdhd = renderFullBox("mdhd", 0, 0, mdhdData);

  // hdlr (handler reference)
  const hdlrData = new ByteVector();
  hdlrData.append(ByteVector.fromSize(4, 0));    // pre_defined
  hdlrData.append(ByteVector.fromString("text", StringType.Latin1));
  hdlrData.append(ByteVector.fromSize(12, 0));   // reserved
  hdlrData.append(ByteVector.fromString("Chapter", StringType.Latin1));
  hdlrData.append(0);                            // null terminator
  const hdlr = renderFullBox("hdlr", 0, 0, hdlrData);

  // gmhd (base media information header) with gmin + text children
  const gminData = new ByteVector();
  gminData.append(ByteVector.fromShort(0x0040)); // graphicsMode = ditherCopy
  gminData.append(ByteVector.fromByteArray(new Uint8Array([0x80, 0x00, 0x80, 0x00, 0x80, 0x00]))); // opcolor
  gminData.append(ByteVector.fromShort(0));      // balance
  gminData.append(ByteVector.fromShort(0));      // reserved
  const gmin = renderFullBox("gmin", 0, 0, gminData);

  const textInfoData = new ByteVector();
  textInfoData.append(ByteVector.fromShort(1));
  textInfoData.append(ByteVector.fromSize(14, 0));
  textInfoData.append(ByteVector.fromShort(1));
  textInfoData.append(ByteVector.fromSize(14, 0));
  textInfoData.append(ByteVector.fromUInt(0x40000000));
  const textInfo = renderAtom("text", textInfoData);

  const gmhdContent = new ByteVector();
  gmhdContent.append(gmin);
  gmhdContent.append(textInfo);
  const gmhd = renderAtom("gmhd", gmhdContent);

  // dinf / dref (data reference)
  const drefEntry = renderFullBox("url ", 0, 1, new ByteVector()); // flags=1: self-contained
  const drefData = new ByteVector();
  drefData.append(ByteVector.fromUInt(1)); // entry count
  drefData.append(drefEntry);
  const dref = renderFullBox("dref", 0, 0, drefData);
  const dinf = renderAtom("dinf", dref);

  // stbl (sample table)
  const stsd = buildStsd();
  const stts = buildStts(chapters, timescale, durationMs);
  const stsz = buildStsz(sampleSizes);
  const stsc = buildStsc(count);
  const stco = buildStco(chunkOffset);

  const stblContent = new ByteVector();
  stblContent.append(stsd);
  stblContent.append(stts);
  stblContent.append(stsz);
  stblContent.append(stsc);
  stblContent.append(stco);
  const stbl = renderAtom("stbl", stblContent);

  // minf (media information)
  const minfContent = new ByteVector();
  minfContent.append(gmhd);
  minfContent.append(dinf);
  minfContent.append(stbl);
  const minf = renderAtom("minf", minfContent);

  // mdia (media)
  const mdiaContent = new ByteVector();
  mdiaContent.append(mdhd);
  mdiaContent.append(hdlr);
  mdiaContent.append(minf);
  const mdia = renderAtom("mdia", mdiaContent);

  // edts / elst (edit list)
  const elstData = new ByteVector();
  elstData.append(ByteVector.fromUInt(1));             // entry count
  elstData.append(ByteVector.fromUInt(movieDuration)); // segment duration
  elstData.append(ByteVector.fromUInt(0));             // media time
  elstData.append(ByteVector.fromUInt(0x00010000));    // media rate 1.0
  const elst = renderFullBox("elst", 0, 0, elstData);
  const edts = renderAtom("edts", elst);

  // trak
  const trakContent = new ByteVector();
  trakContent.append(tkhd);
  trakContent.append(edts);
  trakContent.append(mdia);
  return renderAtom("trak", trakContent);
}

/** Builds a `tref` atom containing a `chap` reference to the given track ID. */
function buildTref(chapterTrackId: number): ByteVector {
  const chapData = new ByteVector();
  chapData.append(ByteVector.fromUInt(chapterTrackId));
  const chap = renderAtom("chap", chapData);
  return renderAtom("tref", chap);
}

// ---------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------

interface ChapterTrackInfo {
  timescale: number;
  totalDuration: number;
}

async function readChapterTrackInfo(stream: IOStream, chapterTrak: Mp4Atom): Promise<ChapterTrackInfo> {
  const info: ChapterTrackInfo = { timescale: 0, totalDuration: 0 };
  const mdhd = chapterTrak.find("mdia", "mdhd");
  if (!mdhd) return info;

  await stream.seek(mdhd.offset);
  const data = await stream.readBlock(mdhd.length);
  if (data.length < 8 + 4) return info;

  const version = data.get(8);
  if (version === 1 && data.length >= 40) {
    info.timescale = data.toUInt(28);
    info.totalDuration = Number(data.toLongLong(32));
  } else if (version === 0 && data.length >= 28) {
    info.timescale = data.toUInt(20);
    info.totalDuration = data.toUInt(24);
  }
  return info;
}

interface SttsEntry {
  sampleCount: number;
  sampleDelta: number;
}

async function readStts(stream: IOStream, chapterTrak: Mp4Atom): Promise<SttsEntry[]> {
  const entries: SttsEntry[] = [];
  const stts = chapterTrak.find("mdia", "minf", "stbl", "stts");
  if (!stts) return entries;

  await stream.seek(stts.offset + 12);
  const data = await stream.readBlock(stts.length - 12);
  if (data.length < 4) return entries;

  const count = data.toUInt();
  let pos = 4;
  for (let i = 0; i < count && pos + 8 <= data.length; i++) {
    entries.push({ sampleCount: data.toUInt(pos), sampleDelta: data.toUInt(pos + 4) });
    pos += 8;
  }
  return entries;
}

async function readStco(stream: IOStream, chapterTrak: Mp4Atom): Promise<number[]> {
  const offsets: number[] = [];
  const stco = chapterTrak.find("mdia", "minf", "stbl", "stco");
  if (!stco) return offsets;

  await stream.seek(stco.offset + 12);
  const data = await stream.readBlock(stco.length - 12);
  if (data.length < 4) return offsets;

  const count = data.toUInt();
  let pos = 4;
  for (let i = 0; i < count && pos + 4 <= data.length; i++) {
    offsets.push(data.toUInt(pos));
    pos += 4;
  }
  return offsets;
}

interface SampleSizeInfo {
  defaultSize: number;
  sampleCount: number;
  perSampleSizes: number[];
}

async function readStsz(stream: IOStream, chapterTrak: Mp4Atom): Promise<SampleSizeInfo> {
  const info: SampleSizeInfo = { defaultSize: 0, sampleCount: 0, perSampleSizes: [] };
  const stsz = chapterTrak.find("mdia", "minf", "stbl", "stsz");
  if (!stsz) return info;

  await stream.seek(stsz.offset + 12);
  const data = await stream.readBlock(stsz.length - 12);
  if (data.length < 8) return info;

  info.defaultSize = data.toUInt();
  info.sampleCount = data.toUInt(4);

  if (info.defaultSize === 0) {
    let pos = 8;
    for (let i = 0; i < info.sampleCount && pos + 4 <= data.length; i++) {
      info.perSampleSizes.push(data.toUInt(pos));
      pos += 4;
    }
  }
  return info;
}

/** Resolves chunk-level offsets into per-sample file offsets. */
async function resolveSampleOffsets(
  stream: IOStream,
  chapterTrak: Mp4Atom,
  sizeInfo: SampleSizeInfo,
): Promise<number[]> {
  const chunkOffsets = await readStco(stream, chapterTrak);
  if (chunkOffsets.length === 0) return [];

  interface StscEntry { firstChunk: number; samplesPerChunk: number }
  const stscEntries: StscEntry[] = [];

  const stsc = chapterTrak.find("mdia", "minf", "stbl", "stsc");
  if (stsc) {
    await stream.seek(stsc.offset + 12);
    const data = await stream.readBlock(stsc.length - 12);
    if (data.length >= 4) {
      const entryCount = data.toUInt();
      let pos = 4;
      for (let i = 0; i < entryCount && pos + 12 <= data.length; i++) {
        stscEntries.push({ firstChunk: data.toUInt(pos), samplesPerChunk: data.toUInt(pos + 4) });
        pos += 12;
      }
    }
  }

  if (stscEntries.length === 0) stscEntries.push({ firstChunk: 1, samplesPerChunk: 1 });

  const sampleOffsets: number[] = [];
  let sampleIndex = 0;

  for (let chunkIdx = 0; chunkIdx < chunkOffsets.length; chunkIdx++) {
    const chunkNum = chunkIdx + 1;
    let samplesInChunk = stscEntries[0].samplesPerChunk;
    for (const e of stscEntries) {
      if (e.firstChunk <= chunkNum) samplesInChunk = e.samplesPerChunk;
      else break;
    }

    let offsetInChunk = 0;
    for (let s = 0; s < samplesInChunk; s++) {
      sampleOffsets.push(chunkOffsets[chunkIdx] + offsetInChunk);
      let sz = sizeInfo.defaultSize;
      if (sz === 0 && sampleIndex < sizeInfo.perSampleSizes.length) sz = sizeInfo.perSampleSizes[sampleIndex];
      offsetInChunk += sz;
      sampleIndex++;
    }
  }

  return sampleOffsets;
}

/** Reads a single text sample from the given file offset. */
async function readTextSample(stream: IOStream, offset: number, maxSize: number): Promise<string> {
  await stream.seek(offset);
  const data = await stream.readBlock(maxSize);
  if (data.length < 2) return "";

  const textLen = data.toUShort();
  if (textLen === 0 || textLen + 2 > data.length) return "";
  return data.mid(2, textLen).toString(StringType.UTF8);
}

// ---------------------------------------------------------------------------
// Remove helpers
// ---------------------------------------------------------------------------

/** Removes the `tref` atom from the audio track and updates sizes/offsets. */
async function removeAudioTref(
  stream: IOStream,
  atoms: Mp4Atoms,
  audioTrak: Mp4Atom,
): Promise<void> {
  for (const child of audioTrak.children) {
    if (child.name !== "tref") continue;

    const trefOff = child.offset;
    const trefLen = child.length;

    // Fix audio trak size on disk BEFORE removal, then update moov.
    await stream.seek(audioTrak.offset);
    const trakSize = (await stream.readBlock(4)).toUInt();
    await stream.seek(audioTrak.offset);
    await stream.writeBlock(ByteVector.fromUInt(trakSize - trefLen));

    const moovPath = atoms.path("moov");
    await updateParentSizes(stream, moovPath, -trefLen);

    await stream.removeBlock(trefOff, trefLen);

    const updatedAtoms = await parseAtoms(stream);
    await updateChunkOffsets(stream, updatedAtoms, -trefLen, trefOff);
    return;
  }
}

/** Finds the top-level `mdat` atom containing the given file offset (in its data region). */
function findMdatContaining(atoms: Mp4Atoms, fileOffset: offset_t): Mp4Atom | null {
  for (const atom of atoms.atoms) {
    if (atom.name !== "mdat") continue;
    const dataStart = atom.offset + 8;
    const end = atom.offset + atom.length;
    if (fileOffset >= dataStart && fileOffset < end) return atom;
  }
  return null;
}

/** Returns true if any stco/co64 entry points inside the given mdat region. */
async function mdatIsUsedByAnyTrack(
  stream: IOStream,
  atoms: Mp4Atoms,
  mdatStart: offset_t,
  mdatSize: number,
): Promise<boolean> {
  const dataStart = mdatStart + 8;
  const dataEnd = mdatStart + mdatSize;

  const moov = atoms.find("moov");
  if (!moov) return false;

  for (const stco of moov.findAll("stco", true)) {
    await stream.seek(stco.offset + 12);
    const data = await stream.readBlock(stco.length - 12);
    if (data.length < 4) continue;
    let count = data.toUInt();
    let pos = 4;
    const maxPos = data.length - 4;
    while (count-- > 0 && pos <= maxPos) {
      const o = data.toUInt(pos);
      if (o >= dataStart && o < dataEnd) return true;
      pos += 4;
    }
  }

  for (const co64 of moov.findAll("co64", true)) {
    await stream.seek(co64.offset + 12);
    const data = await stream.readBlock(co64.length - 12);
    if (data.length < 4) continue;
    let count = data.toUInt();
    let pos = 4;
    const maxPos = data.length - 8;
    while (count-- > 0 && pos <= maxPos) {
      const o = Number(data.toLongLong(pos));
      if (o >= dataStart && o < dataEnd) return true;
      pos += 8;
    }
  }

  return false;
}

/** Removes the QT chapter track, its tref, and (if safe) its mdat. */
async function removeQTChapterTrack(
  stream: IOStream,
  atoms: Mp4Atoms,
  moov: Mp4Atom,
  chapterTrak: Mp4Atom,
  audioTrak: Mp4Atom,
): Promise<void> {
  // Identify the chapter mdat BEFORE removal (while stco is still valid).
  let chapterMdatOffset: offset_t = -1;
  let chapterMdatSize: number = 0;
  {
    const stco = await readStco(stream, chapterTrak);
    if (stco.length > 0) {
      const mdat = findMdatContaining(atoms, stco[0]);
      if (mdat) {
        chapterMdatOffset = mdat.offset;
        chapterMdatSize = mdat.length;
      }
    }
  }

  // Capture tref location
  let trefOff: offset_t = -1;
  let trefLen = 0;
  for (const child of audioTrak.children) {
    if (child.name === "tref") {
      trefOff = child.offset;
      trefLen = child.length;
      break;
    }
  }

  // Remove chapter trak FIRST (higher offset in file).
  const chapterOff = chapterTrak.offset;
  const chapterLen = chapterTrak.length;

  // Remove from in-memory tree so updateChunkOffsets skips its stco.
  moov.removeChild(chapterTrak);

  // Update parent sizes BEFORE removing bytes (moov may extend to EOF,
  // so its declared size must not exceed remaining file space after removal).
  const moovPath = atoms.path("moov");
  await updateParentSizes(stream, moovPath, -chapterLen);

  await stream.removeBlock(chapterOff, chapterLen);

  const afterTrakRemoval = await parseAtoms(stream);
  await updateChunkOffsets(stream, afterTrakRemoval, -chapterLen, chapterOff);

  // Remove tref from audio trak (lower offset, still valid).
  const afterTrakAtoms = await parseAtoms(stream);
  const audioTrak2 = await findAudioTrack(stream, afterTrakAtoms);
  if (audioTrak2.trak) {
    await removeAudioTref(stream, afterTrakAtoms, audioTrak2.trak);
  }

  // Decide whether the chapter mdat is safe to delete.
  if (chapterMdatOffset < 0) return;

  // Shift the original mdat offset by however much was removed before it.
  let adjustedOffset = chapterMdatOffset;
  if (chapterMdatOffset > chapterOff) adjustedOffset -= chapterLen;
  if (trefOff >= 0 && chapterMdatOffset > trefOff) adjustedOffset -= trefLen;

  // Re-parse to verify no surviving track references this mdat.
  const cleanAtoms = await parseAtoms(stream);
  if (await mdatIsUsedByAnyTrack(stream, cleanAtoms, adjustedOffset, chapterMdatSize)) return;

  await stream.seek(adjustedOffset);
  const header = await stream.readBlock(8);
  if (header.length !== 8 || header.mid(4, 4).toString(StringType.Latin1) !== "mdat") return;
  if (header.toUInt() !== chapterMdatSize) return;

  await stream.removeBlock(adjustedOffset, chapterMdatSize);
}

// ---------------------------------------------------------------------------
// QtChapters – chapter holder
// ---------------------------------------------------------------------------

/**
 * Reads, writes, and removes QuickTime-style chapter tracks from MP4 files.
 *
 * A QT chapter track is a disabled text track (`hdlr` type `"text"`) referenced
 * by a `chap` track-reference in the audio track's `tref` box.
 *
 * Implements the lazy-read / dirty-write pattern via {@link Mp4ChapterHolder}.
 *
 * @example
 * ```ts
 * const holder = new QtChapters();
 * const chapters = await holder.getChapters(stream);
 * holder.setChapters([{ title: "Intro", startTime: 0 }]);
 * await holder.saveIfModified(stream);
 * ```
 */
export class QtChapters extends Mp4ChapterHolder {
  /**
   * Returns the chapter list, reading from disk on first call.
   *
   * @param stream - The MP4 file stream.
   * @returns The chapter list (start times in ms).
   */
  override async getChapters(stream: IOStream): Promise<Mp4Chapter[]> {
    if (!this._loaded) {
      await this.read(stream);
      this._loaded = true;
      this._modified = false;
    }
    return this._chapters;
  }

  /**
   * Reads QuickTime chapters from the chapter text track.
   *
   * @param stream - The MP4 file stream.
   * @returns `true` if a chapter track was found and parsed.
   */
  override async read(stream: IOStream): Promise<boolean> {
    this._modified = false;
    this._chapters = [];

    const atoms = await parseAtoms(stream);
    const audio = await findAudioTrack(stream, atoms);
    if (!audio.trak) return false;

    const chapterTrak = await findChapterTrak(stream, atoms, audio.trak);
    if (!chapterTrak) return false;

    const trackInfo = await readChapterTrackInfo(stream, chapterTrak);
    if (trackInfo.timescale === 0) return false;

    const sttsEntries = await readStts(stream, chapterTrak);
    const sizeInfo = await readStsz(stream, chapterTrak);
    const offsets = await resolveSampleOffsets(stream, chapterTrak, sizeInfo);
    if (offsets.length === 0) return false;

    let sampleIndex = 0;
    let currentTime = 0;

    for (const entry of sttsEntries) {
      for (let s = 0; s < entry.sampleCount; s++) {
        if (sampleIndex >= offsets.length) break;

        let sampleSize = sizeInfo.defaultSize;
        if (sampleSize === 0 && sampleIndex < sizeInfo.perSampleSizes.length) {
          sampleSize = sizeInfo.perSampleSizes[sampleIndex];
        }

        const title = await readTextSample(stream, offsets[sampleIndex], sampleSize);
        const startTimeMs = Math.round(currentTime * 1000.0 / trackInfo.timescale);
        this._chapters.push({ title, startTime: startTimeMs });

        currentTime += entry.sampleDelta;
        sampleIndex++;
      }
    }

    // Strip a leading dummy chapter (empty title at time 0) inserted during write
    // to preserve non-zero first-chapter start times.
    if (this._chapters.length > 1) {
      const first = this._chapters[0];
      if (first.startTime === 0 && first.title === "") {
        this._chapters.shift();
      }
    }

    return true;
  }

  /**
   * Writes QuickTime chapters as a new text track, replacing any existing one.
   * Writing an empty list removes the chapter track.
   *
   * @param stream - The MP4 file stream.
   * @returns `true` on success.
   */
  override async write(stream: IOStream): Promise<boolean> {
    if (this._chapters.length === 0) {
      return await this.remove(stream);
    }

    // Phase 1: Parse and gather info
    let atoms = await parseAtoms(stream);
    const moov = atoms.find("moov");
    if (!moov) return false;

    const movieInfo = await readMovieInfo(stream, atoms);
    if (movieInfo.durationMs <= 0) return false;
    const durationMs = movieInfo.durationMs;

    let audio = await findAudioTrack(stream, atoms);
    if (!audio.trak) return false;

    // Phase 2: Remove existing chapter data (if any)
    const existingChapter = await findChapterTrak(stream, atoms, audio.trak);
    if (existingChapter) {
      await removeQTChapterTrack(stream, atoms, moov, existingChapter, audio.trak);

      // Re-parse after cleanup
      atoms = await parseAtoms(stream);
      if (!atoms.find("moov")) return false;
      audio = await findAudioTrack(stream, atoms);
      if (!audio.trak) return false;
    }

    // Phase 3: Build and insert new chapter data
    // QT chapter tracks always start at media time 0. If the first chapter has a
    // non-zero start time, prepend a dummy chapter at time 0 with an empty title.
    const workingChapters: Mp4Chapter[] = [...this._chapters];
    if (workingChapters.length > 0 && workingChapters[0].startTime > 0) {
      workingChapters.unshift({ title: "", startTime: 0 });
    }

    const nextId = await getNextTrackId(stream, atoms);
    const chapterTrackId = nextId > 0 ? nextId : audio.trackId + 1;
    const timescale = 1000;
    const sampleSizes = calculateSampleSizes(workingChapters);

    // Build tref/chap atom for audio track
    const trefAtom = buildTref(chapterTrackId);

    // Two-pass build: first to measure size, then with correct stco offsets.
    const trakMeasure = buildChapterTrak(
      chapterTrackId, timescale, durationMs, workingChapters, sampleSizes, 0, movieInfo.duration,
    );
    const totalInsert = trefAtom.length + trakMeasure.length;
    // Text samples go inside an mdat atom at EOF; stco points past the 8-byte mdat header.
    const textDataOffset = await stream.length() + totalInsert + 8;

    const trakAtom = buildChapterTrak(
      chapterTrackId, timescale, durationMs, workingChapters, sampleSizes, textDataOffset, movieInfo.duration,
    );

    // Combined payload: tref (inside audio trak) + chapter trak (moov sibling)
    const combinedPayload = new ByteVector();
    combinedPayload.append(trefAtom);
    combinedPayload.append(trakAtom);

    // Insert at the end of the audio trak boundary.
    const insertOffset = audio.trak.offset + audio.trak.length;
    await stream.insert(combinedPayload, insertOffset, 0);

    // Fix audio trak size on disk (only tref goes inside audio trak)
    await stream.seek(audio.trak.offset);
    const audioTrakSize = (await stream.readBlock(4)).toUInt();
    await stream.seek(audio.trak.offset);
    await stream.writeBlock(ByteVector.fromUInt(audioTrakSize + trefAtom.length));

    // Fix moov size (both tref and chapter trak are inside moov)
    const updatedAtoms = await parseAtoms(stream);
    const moovPath = updatedAtoms.path("moov");
    await updateParentSizes(stream, moovPath, combinedPayload.length);

    // Fix existing chunk offsets (original atom tree only – new chapter stco is correct)
    await updateChunkOffsets(stream, updatedAtoms, combinedPayload.length, insertOffset);

    // Phase 4: Append text samples in mdat at EOF
    const textSamples = new ByteVector();
    for (const ch of workingChapters) textSamples.append(buildTextSample(ch.title));
    const mdatAtom = renderAtom("mdat", textSamples);

    await stream.seek(0, Position.End);
    await stream.writeBlock(mdatAtom);

    // Phase 5: Update mvhd next_track_ID
    const finalAtoms = await parseAtoms(stream);
    const currentNextId = await getNextTrackId(stream, finalAtoms);
    if (chapterTrackId >= currentNextId) {
      await setNextTrackId(stream, finalAtoms, chapterTrackId + 1);
    }

    this._modified = false;
    return true;
  }

  /**
   * Removes the QuickTime chapter track (if present) from the file.
   *
   * @param stream - The MP4 file stream.
   * @returns `true` on success (including when no chapter track exists).
   */
  async remove(stream: IOStream): Promise<boolean> {
    const atoms = await parseAtoms(stream);
    this._chapters = [];
    this._modified = false;

    const audio = await findAudioTrack(stream, atoms);
    if (!audio.trak) return true;

    const chapterTrak = await findChapterTrak(stream, atoms, audio.trak);
    if (!chapterTrak) return true;

    const moov = atoms.find("moov");
    if (!moov) return false;

    await removeQTChapterTrack(stream, atoms, moov, chapterTrak, audio.trak);
    return true;
  }
}
