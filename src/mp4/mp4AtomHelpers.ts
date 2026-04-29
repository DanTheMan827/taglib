/** @packageDocumentation Shared helpers for updating MP4 atom sizes and chunk offsets. */
import { ByteVector, StringType } from "../byteVector.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Position, type offset_t } from "../toolkit/types.js";
import type { Mp4Atom } from "./mp4Atoms.js";
import { Mp4Atoms } from "./mp4Atoms.js";

/**
 * Renders a simple MP4 atom: 4-byte size + 4-byte name + data.
 *
 * @param name - 4-character atom name.
 * @param data - Atom payload.
 * @returns The complete atom as a {@link ByteVector}.
 */
export function renderAtom(name: string, data: ByteVector): ByteVector {
  const result = ByteVector.fromUInt(data.length + 8);
  result.append(ByteVector.fromString(name, StringType.Latin1));
  result.append(data);
  return result;
}

/**
 * Renders an ISO base-media full-box (version byte + 3-byte flags + data).
 *
 * @param name - 4-character atom name.
 * @param version - Box version byte (0 or 1).
 * @param flags - 24-bit flags field.
 * @param data - Box payload (after version/flags).
 * @returns The complete full-box atom as a {@link ByteVector}.
 */
export function renderFullBox(name: string, version: number, flags: number, data: ByteVector): ByteVector {
  const flagsVec = ByteVector.fromUInt(flags);
  const vf = new ByteVector();
  vf.append(version & 0xff);
  vf.append(flagsVec.mid(1, 3)); // 3 bytes of flags
  vf.append(data);
  return renderAtom(name, vf);
}

/**
 * Parses a fresh MP4 atom tree from `stream`.
 * This is used instead of a cached tree when the file layout has just changed.
 *
 * @param stream - The I/O stream of the MP4 file.
 * @returns A freshly-parsed {@link Mp4Atoms} instance.
 */
export async function parseAtoms(stream: IOStream): Promise<Mp4Atoms> {
  return await Mp4Atoms.create(stream);
}

/**
 * Updates the on-disk sizes of all atoms in `path` (excluding the last
 * `ignore` atoms) by `delta` bytes.
 *
 * Mirrors C++ `updateParentSizes()` in mp4nerochapterlist.cpp and
 * mp4qtchapterlist.cpp.
 *
 * @param stream - The file stream.
 * @param path - Atom path from root to the modified child, as returned by
 *               {@link Mp4Atoms.path} or {@link Mp4Atom.path}.
 * @param delta - Number of bytes added (positive) or removed (negative).
 * @param ignore - Number of trailing path atoms to skip (default 0).
 */
export async function updateParentSizes(
  stream: IOStream,
  path: Mp4Atom[],
  delta: number,
  ignore = 0,
): Promise<void> {
  const end = path.length - ignore;
  for (let i = 0; i < end; i++) {
    const atom = path[i];
    await stream.seek(atom.offset);
    const sizeWord = (await stream.readBlock(4)).toUInt();
    if (sizeWord === 1) {
      // 64-bit extended size
      await stream.seek(4, Position.Current); // skip name
      const longSize = Number((await stream.readBlock(8)).toLongLong());
      await stream.seek(atom.offset + 8);
      await stream.writeBlock(ByteVector.fromLongLong(BigInt(longSize + delta)));
    } else {
      await stream.seek(atom.offset);
      await stream.writeBlock(ByteVector.fromUInt(sizeWord + delta));
    }
  }
}

/**
 * Updates `stco`/`co64`/`tfhd` chunk offsets for all relevant atoms
 * when a block is inserted or removed at `insertOffset`.
 *
 * Mirrors C++ `updateChunkOffsets()` in mp4nerochapterlist.cpp and
 * mp4qtchapterlist.cpp.
 *
 * @param stream - The file stream.
 * @param atoms - Freshly-parsed atom tree (after the structural change).
 * @param delta - Size of the inserted/removed region (positive = inserted).
 * @param insertOffset - File offset at which bytes were inserted/removed.
 */
export async function updateChunkOffsets(
  stream: IOStream,
  atoms: Mp4Atoms,
  delta: number,
  insertOffset: offset_t,
): Promise<void> {
  const moov = atoms.find("moov");
  if (moov) {
    // stco – 32-bit chunk offsets
    for (const atom of moov.findAll("stco", true)) {
      if (atom.offset > insertOffset) atom.addToOffset(delta);
      await stream.seek(atom.offset + 12);
      const data = await stream.readBlock(atom.length - 12);
      let count = data.toUInt();
      await stream.seek(atom.offset + 16);
      let pos = 4;
      const maxPos = data.length - 4;
      while (count-- > 0 && pos <= maxPos) {
        let o = data.toUInt(pos);
        if (o > insertOffset) o += delta;
        await stream.writeBlock(ByteVector.fromUInt(o));
        pos += 4;
      }
    }

    // co64 – 64-bit chunk offsets
    for (const atom of moov.findAll("co64", true)) {
      if (atom.offset > insertOffset) atom.addToOffset(delta);
      await stream.seek(atom.offset + 12);
      const data = await stream.readBlock(atom.length - 12);
      let count = data.toUInt();
      await stream.seek(atom.offset + 16);
      let pos = 4;
      const maxPos = data.length - 8;
      while (count-- > 0 && pos <= maxPos) {
        let o = Number(data.toLongLong(pos));
        if (o > insertOffset) o += delta;
        await stream.writeBlock(ByteVector.fromLongLong(BigInt(o)));
        pos += 8;
      }
    }
  }

  const moof = atoms.find("moof");
  if (moof) {
    for (const atom of moof.findAll("tfhd", true)) {
      if (atom.offset > insertOffset) atom.addToOffset(delta);
      await stream.seek(atom.offset + 9);
      const data = await stream.readBlock(atom.length - 9);
      const flags = data.toUInt(0, 3);
      if (flags & 1) {
        let o = Number(data.toLongLong(7));
        if (o > insertOffset) o += delta;
        await stream.seek(atom.offset + 16);
        await stream.writeBlock(ByteVector.fromLongLong(BigInt(o)));
      }
    }
  }
}
