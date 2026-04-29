/** @packageDocumentation Nero-style MP4 chapter support (chpl atom at moov/udta/chpl). */
import { ByteVector, StringType } from "../byteVector.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { chaptersEqual, Mp4ChapterHolder, type Mp4Chapter } from "./mp4Chapter.js";
import {
  parseAtoms,
  renderAtom,
  updateChunkOffsets,
  updateParentSizes,
} from "./mp4AtomHelpers.js";

// ---------------------------------------------------------------------------
// Parsing / rendering helpers
// ---------------------------------------------------------------------------

/**
 * Parses the binary payload of a `chpl` atom (Nero-style chapters).
 *
 * On-disk format:
 * - 1 byte: version
 * - 3 bytes: flags
 * - (version >= 1) 4 bytes: reserved
 * - 1 byte: chapter count (max 255)
 * - For each chapter:
 *   - 8 bytes big-endian: start time in 100-nanosecond units
 *   - 1 byte: title length
 *   - N bytes: UTF-8 title
 *
 * @param data - Raw atom payload (after the 8-byte atom header).
 * @returns Array of parsed {@link Mp4Chapter} objects (start times in ms).
 */
function parseChplData(data: ByteVector): Mp4Chapter[] {
  const chapters: Mp4Chapter[] = [];

  // Minimum: version(1) + flags(3) + count(1) = 5 bytes (version 0)
  if (data.length < 5) return chapters;

  let pos = 0;
  const version = data.get(pos++);

  // Skip flags (3 bytes)
  pos += 3;

  // Version 1 has 4 reserved bytes
  if (version >= 1) pos += 4;

  if (pos >= data.length) return chapters;

  const count = data.get(pos++);

  for (let i = 0; i < count && pos + 9 <= data.length; i++) {
    const startTime100ns = Number(data.toLongLong(pos));
    pos += 8;

    const titleLen = data.get(pos++);

    let title = "";
    if (titleLen > 0 && pos + titleLen <= data.length) {
      title = data.mid(pos, titleLen).toString(StringType.UTF8);
      pos += titleLen;
    }

    chapters.push({ title, startTime: Math.round(startTime100ns / 10000) });
  }

  return chapters;
}

/**
 * Renders an array of chapters into the binary payload of a `chpl` atom.
 *
 * Chapter count is capped at 255 (Nero format limit).
 *
 * @param chapters - Chapters to encode (start times in ms).
 * @returns Encoded `chpl` atom payload.
 */
function renderChplData(chapters: Mp4Chapter[]): ByteVector {
  const count = Math.min(chapters.length, 255);

  const data = new ByteVector();
  // Version (1 byte) + flags (3 bytes) + reserved (4 bytes)
  data.append(0x01);                          // version 1
  data.append(ByteVector.fromSize(3, 0));     // flags
  data.append(ByteVector.fromSize(4, 0));     // reserved

  // Chapter count (1 byte)
  data.append(count & 0xff);

  for (let i = 0; i < count; i++) {
    const ch = chapters[i];
    // Start time: 8 bytes big-endian in 100-nanosecond units
    data.append(ByteVector.fromLongLong(BigInt(ch.startTime) * 10000n));

    // Title: 1-byte length + UTF-8 bytes (max 255 bytes)
    const titleBytes = ByteVector.fromString(ch.title, StringType.UTF8);
    const titleLen = Math.min(titleBytes.length, 255);
    data.append(titleLen & 0xff);
    if (titleLen > 0) data.append(titleBytes.mid(0, titleLen));
  }

  return data;
}

// ---------------------------------------------------------------------------
// NeroChapters – chapter holder
// ---------------------------------------------------------------------------

/**
 * Reads, writes, and removes Nero-style chapter markers (`chpl` atom at
 * `moov/udta/chpl`) from MP4 files.
 *
 * Implements the lazy-read / dirty-write pattern via {@link Mp4ChapterHolder}.
 *
 * @example
 * ```ts
 * const holder = new NeroChapters();
 * const chapters = await holder.getChapters(stream);
 * holder.setChapters([{ title: "Intro", startTime: 0 }]);
 * await holder.saveIfModified(stream);
 * ```
 */
export class NeroChapters extends Mp4ChapterHolder {
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
   * Reads Nero chapters from the `moov/udta/chpl` atom.
   *
   * @param stream - The MP4 file stream.
   * @returns `true` if a `chpl` atom was found and parsed.
   */
  override async read(stream: IOStream): Promise<boolean> {
    this._modified = false;
    this._chapters = [];

    const atoms = await parseAtoms(stream);
    const chpl = atoms.find("moov", "udta", "chpl");
    if (!chpl) return false;

    // Read the atom content (skip 8-byte atom header)
    await stream.seek(chpl.offset + 8);
    const data = await stream.readBlock(chpl.length - 8);
    this._chapters = parseChplData(data);
    return true;
  }

  /**
   * Writes Nero chapters to the `moov/udta/chpl` atom, creating or replacing it.
   * Writing an empty list removes the `chpl` atom.
   *
   * @param stream - The MP4 file stream.
   * @returns `true` on success.
   */
  override async write(stream: IOStream): Promise<boolean> {
    if (this._chapters.length === 0) {
      return await this.remove(stream);
    }

    const atoms = await parseAtoms(stream);
    if (!atoms.find("moov")) return false;

    const chplPayload = renderChplData(this._chapters);
    const chplAtom = renderAtom("chpl", chplPayload);

    const existingChpl = atoms.find("moov", "udta", "chpl");
    if (existingChpl) {
      // Replace existing chpl atom
      const offset = existingChpl.offset;
      const oldLength = existingChpl.length;
      const delta = chplAtom.length - oldLength;

      if (delta < 0) {
        // Shrinking: update parent sizes BEFORE the replacement so that the
        // moov atom's declared size never exceeds the remaining file space.
        const parentPath = atoms.path("moov", "udta");
        await updateParentSizes(stream, parentPath, delta);
        await stream.insert(chplAtom, offset, oldLength);
        const updatedAtoms = await parseAtoms(stream);
        await updateChunkOffsets(stream, updatedAtoms, delta, offset);
      } else if (delta > 0) {
        await stream.insert(chplAtom, offset, oldLength);
        const updatedAtoms = await parseAtoms(stream);
        const parentPath = updatedAtoms.path("moov", "udta");
        await updateParentSizes(stream, parentPath, delta);
        await updateChunkOffsets(stream, updatedAtoms, delta, offset);
      }
      // delta === 0: in-place replacement, no size changes needed
    } else {
      // Need to insert a new chpl atom
      const udtaPath = atoms.path("moov", "udta");
      if (udtaPath.length === 2) {
        // udta exists – insert chpl at the beginning of udta's content
        const insertOffset = udtaPath[udtaPath.length - 1].offset + 8;
        await stream.insert(chplAtom, insertOffset, 0);

        const updatedAtoms = await parseAtoms(stream);
        const updatedUdtaPath = updatedAtoms.path("moov", "udta");
        await updateParentSizes(stream, updatedUdtaPath, chplAtom.length);
        await updateChunkOffsets(stream, updatedAtoms, chplAtom.length, insertOffset);
      } else {
        // No udta – insert udta + chpl at the beginning of moov's content
        const udtaAtom = renderAtom("udta", chplAtom);
        const moovPath = atoms.path("moov");
        if (moovPath.length === 0) return false;

        const insertOffset = moovPath[moovPath.length - 1].offset + 8;
        await stream.insert(udtaAtom, insertOffset, 0);

        const updatedAtoms = await parseAtoms(stream);
        const updatedMoovPath = updatedAtoms.path("moov");
        await updateParentSizes(stream, updatedMoovPath, udtaAtom.length);
        await updateChunkOffsets(stream, updatedAtoms, udtaAtom.length, insertOffset);
      }
    }

    this._modified = false;
    return true;
  }

  /**
   * Removes the `chpl` atom from the file (if present).
   *
   * @param stream - The MP4 file stream.
   * @returns `true` on success (including when no `chpl` atom exists).
   */
  async remove(stream: IOStream): Promise<boolean> {
    this._chapters = [];
    this._modified = false;

    const atoms = await parseAtoms(stream);
    const chpl = atoms.find("moov", "udta", "chpl");
    if (!chpl) return true;

    const offset = chpl.offset;
    const length = chpl.length;

    // Update parent sizes BEFORE removing bytes.  If moov extends to EOF,
    // its declared size would exceed the remaining file space after removal,
    // causing the atom parser to reject it.
    const parentPath = atoms.path("moov", "udta");
    await updateParentSizes(stream, parentPath, -length);

    await stream.removeBlock(offset, length);

    // Chunk offsets: re-parse now that sizes and content are consistent.
    const updatedAtoms = await parseAtoms(stream);
    await updateChunkOffsets(stream, updatedAtoms, -length, offset);

    return true;
  }
}

/**
 * Creates a {@link NeroChapters} holder that is pre-loaded with the given
 * chapters and marked as modified.  Used by {@link Mp4File} when the caller
 * calls `setNeroChapters()` before ever reading.
 *
 * @internal
 */
export function createNeroChapterHolder(chapters: Mp4Chapter[]): NeroChapters {
  const holder = new NeroChapters();
  holder.setChapters(chapters);
  return holder;
}

/**
 * Checks equality between two chapter lists using {@link chaptersEqual}.
 * Re-exported here for convenience.
 *
 * @param a - First chapter list.
 * @param b - Second chapter list.
 * @returns `true` if lists are identical.
 */
export { chaptersEqual };
