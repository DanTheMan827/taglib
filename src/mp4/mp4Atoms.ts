/** @file MP4/M4A atom tree parser. */
import { StringType } from "../byteVector.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { type offset_t, Position } from "../toolkit/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTAINERS = new Set([
  "moov", "udta", "mdia", "meta", "ilst",
  "stbl", "minf", "moof", "traf", "trak",
  "stsd", "stem",
]);

const META_CHILDREN_NAMES = new Set(["hdlr", "ilst", "mhdr", "ctry", "lang"]);

// ---------------------------------------------------------------------------
// Mp4Atom
// ---------------------------------------------------------------------------

export class Mp4Atom {
  name: string;
  offset: offset_t;
  length: number;
  headerSize: number;
  children: Mp4Atom[];

  private constructor() {
    this.name = "";
    this.offset = 0;
    this.length = 0;
    this.headerSize = 8;
    this.children = [];
  }

  /** Parse one atom from the current stream position. */
  static async parse(stream: IOStream): Promise<Mp4Atom> {
    const atom = new Mp4Atom();
    atom.offset = await stream.tell();

    const header = await stream.readBlock(8);
    if (header.length !== 8) {
      atom.name = "";
      atom.length = 0;
      await stream.seek(0, Position.End);
      return atom;
    }

    let size = header.toUInt();

    if (size === 0) {
      // Atom extends to end of file
      size = (await stream.length()) - atom.offset;
    } else if (size === 1) {
      // 64-bit extended size
      const extSize = await stream.readBlock(8);
      size = Number(extSize.toLongLong());
      atom.headerSize = 16;
    }

    if (size < 8 || size > (await stream.length()) - atom.offset) {
      atom.name = "";
      atom.length = 0;
      await stream.seek(0, Position.End);
      return atom;
    }

    atom.length = size;
    atom.name = header.mid(4, 4).toString(StringType.Latin1);

    // "stem" is not parsed as a container (per C++ reference)
    if (atom.name === "stem") {
      await stream.seek(atom.length - 8, Position.Current);
      return atom;
    }

    if (CONTAINERS.has(atom.name)) {
      if (atom.name === "meta") {
        // meta may or may not be a "full box" (version + flags before children).
        // Peek at the next 8 bytes: if bytes 4..8 match a known child name,
        // it is NOT a full box.
        const posAfterMeta = await stream.tell();
        const peek = await stream.readBlock(8);
        const nextName = peek.mid(4, 4).toString(StringType.Latin1);
        const isFullAtom = !META_CHILDREN_NAMES.has(nextName);
        await stream.seek(posAfterMeta + (isFullAtom ? 4 : 0));
      } else if (atom.name === "stsd") {
        // Skip 8-byte version/flags + entry count
        await stream.seek(8, Position.Current);
      }

      while ((await stream.tell()) < atom.offset + atom.length) {
        const child = await Mp4Atom.parse(stream);
        atom.children.push(child);
        if (child.length === 0) return atom;
      }
      return atom;
    }

    // Leaf atom – skip past its data
    await stream.seek(atom.offset + atom.length);
    return atom;
  }

  /**
   * Navigate children by successive names.
   * `find("mdia", "hdlr")` finds child "mdia", then its child "hdlr".
   */
  find(...names: string[]): Mp4Atom | null {
    if (names.length === 0) return this;
    const [first, ...rest] = names;
    const child = this.children.find(c => c.name === first);
    return child ? child.find(...rest) : null;
  }

  /** Collect all descendants (optionally recursive) matching `name`. */
  findAll(name: string, recursive = false): Mp4Atom[] {
    const result: Mp4Atom[] = [];
    for (const child of this.children) {
      if (child.name === name) result.push(child);
      if (recursive) result.push(...child.findAll(name, true));
    }
    return result;
  }

  /**
   * Build a path from this atom through children matching successive names.
   * Returns true if the full path was found.
   */
  path(result: Mp4Atom[], ...names: string[]): boolean {
    result.push(this);
    if (names.length === 0) return true;
    const [first, ...rest] = names;
    const child = this.children.find(c => c.name === first);
    return child ? child.path(result, ...rest) : false;
  }

  addToOffset(delta: number): void {
    this.offset += delta;
  }

  prependChild(atom: Mp4Atom): void {
    this.children.unshift(atom);
  }

  removeChild(child: Mp4Atom): boolean {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mp4Atoms – root-level atom list
// ---------------------------------------------------------------------------

export class Mp4Atoms {
  atoms: Mp4Atom[];

  private constructor() {
    this.atoms = [];
  }

  static async create(stream: IOStream): Promise<Mp4Atoms> {
    const mp4Atoms = new Mp4Atoms();
    await stream.seek(0, Position.End);
    const end = await stream.tell();
    await stream.seek(0);
    while ((await stream.tell()) + 8 <= end) {
      const atom = await Mp4Atom.parse(stream);
      mp4Atoms.atoms.push(atom);
      if (atom.length === 0) break;
    }
    return mp4Atoms;
  }

  /** Navigate from a root-level atom through successive child names. */
  find(...names: string[]): Mp4Atom | null {
    if (names.length === 0) return null;
    const [first, ...rest] = names;
    const root = this.atoms.find(a => a.name === first);
    return root ? root.find(...rest) : null;
  }

  /** Build atom path from root through child hierarchy. */
  path(...names: string[]): Mp4Atom[] {
    const result: Mp4Atom[] = [];
    if (names.length === 0) return result;
    const [first, ...rest] = names;
    const root = this.atoms.find(a => a.name === first);
    if (root && !root.path(result, ...rest)) {
      result.length = 0;
    }
    return result;
  }

  /**
   * Validate root-level atoms.  Returns false if moov or moof atoms are
   * invalid.  Trailing garbage after a valid moov is trimmed.
   */
  checkRootLevelAtoms(): boolean {
    let moovValid = false;
    for (let i = 0; i < this.atoms.length; i++) {
      const atom = this.atoms[i];
      const invalid = atom.length === 0 || !checkValid(atom.children);
      if (!moovValid && !invalid && atom.name === "moov") {
        moovValid = true;
      }
      if (invalid) {
        if (!moovValid || atom.name === "moof") return false;
        // Trim trailing invalid atoms (garbage after valid moov)
        this.atoms.splice(i);
        return true;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkValid(children: Mp4Atom[]): boolean {
  return children.every(
    a => a.length !== 0 && checkValid(a.children),
  );
}
