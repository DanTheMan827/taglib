/** @packageDocumentation Matroska Chapters element parsing and writing. */
import type { VariantMap } from "../toolkit/variant.js";
import { Variant } from "../toolkit/variant.js";
import { ByteVector } from "../byteVector.js";
import { IOStream } from "../toolkit/ioStream.js";
import {
  EbmlId,
  readChildElements,
  readUintValue,
  readStringValue,
  renderEbmlElement,
  renderStringElement,
  renderUintElement,
  combineByteVectors,
  type EbmlElement,
} from "./ebml/ebmlElement.js";

/**
 * Represents a single chapter display entry (localised title + language).
 */
export interface ChapterDisplay {
  /** The localised chapter title. */
  string: string;
  /** BCP-47 language code (e.g. `"eng"`, `"und"`). */
  language: string;
}

/**
 * Represents a single chapter atom inside an edition.
 */
export interface Chapter {
  /** Unique ID for this chapter (0 = none). */
  uid: number;
  /** Start timestamp in nanoseconds. */
  timeStart: number;
  /** End timestamp in nanoseconds (0 = unset). */
  timeEnd: number;
  /** Whether this chapter is hidden. */
  isHidden: boolean;
  /** Localised display entries. */
  displays: ChapterDisplay[];
}

/**
 * Represents one ordered-chapters edition inside a Chapters element.
 */
export interface ChapterEdition {
  /** Unique ID for this edition (0 = none). */
  uid: number;
  /** Whether this is the default edition. */
  isDefault: boolean;
  /** Whether chapters within this edition are ordered. */
  isOrdered: boolean;
  /** Chapters belonging to this edition. */
  chapters: Chapter[];
}

/**
 * Parses and renders Matroska `Chapters` EBML elements.
 */
export class MatroskaChapters {
  /** The list of parsed chapter editions. */
  private _editions: ChapterEdition[] = [];

  /** Returns all chapter editions. */
  get editions(): ChapterEdition[] {
    return this._editions;
  }

  /**
   * Adds a chapter edition.
   * @param edition - The edition to add.
   */
  addEdition(edition: ChapterEdition): void {
    this._editions.push(edition);
  }

  /**
   * Removes a chapter edition by UID.
   * @param uid - Edition UID to remove.  Use 0 to remove the first edition with uid=0.
   */
  removeEdition(uid: number): void {
    const idx = this._editions.findIndex(e => e.uid === uid);
    if (idx >= 0) this._editions.splice(idx, 1);
  }

  /**
   * Returns `true` if there are no editions.
   */
  isEmpty(): boolean {
    return this._editions.length === 0;
  }

  /**
   * Parse a Chapters EBML element from the stream.
   * @param stream - The I/O stream to read from.
   * @param chaptersEl - The Chapters EBML element descriptor.
   * @returns A new {@link MatroskaChapters} instance.
   */
  static async parseFromStream(
    stream: IOStream,
    chaptersEl: EbmlElement,
  ): Promise<MatroskaChapters> {
    const chapters = new MatroskaChapters();
    const dataOffset = chaptersEl.offset + chaptersEl.headSize;
    const editionEls = await readChildElements(stream, dataOffset, chaptersEl.dataSize);

    // Collect any orphan ChapterAtom elements not wrapped in an EditionEntry.
    // The Matroska spec requires ChapterAtom to be inside an EditionEntry, but
    // some muxers produce files with ChapterAtom directly under Chapters.
    // MKVToolNix and FFmpeg handle this case by treating orphan atoms as
    // belonging to an implicit default edition.
    const orphanChapters: Chapter[] = [];

    for (const edEl of editionEls) {
      if (edEl.id === EbmlId.ChapterAtom) {
        const chapter = await MatroskaChapters.parseChapter(stream, edEl);
        if (chapter.uid !== 0) {
          orphanChapters.push(chapter);
        }
      } else if (edEl.id === EbmlId.EditionEntry) {
        const edition = await MatroskaChapters.parseEdition(stream, edEl);
        chapters._editions.push(edition);
      }
    }

    // If orphan chapters were found, wrap them in an implicit default edition
    // so they are not silently lost.
    if (orphanChapters.length > 0) {
      chapters._editions.push({
        uid: 0,
        isDefault: true,
        isOrdered: false,
        chapters: orphanChapters,
      });
    }

    return chapters;
  }

  /**
   * Parse a single EditionEntry element.
   */
  private static async parseEdition(
    stream: IOStream,
    edEl: EbmlElement,
  ): Promise<ChapterEdition> {
    const edition: ChapterEdition = {
      uid: 0,
      isDefault: false,
      isOrdered: false,
      chapters: [],
    };
    const children = await readChildElements(stream, edEl.offset + edEl.headSize, edEl.dataSize);
    for (const child of children) {
      switch (child.id) {
        case EbmlId.EditionUID:
          edition.uid = await readUintValue(stream, child);
          break;
        case EbmlId.EditionFlagDefault:
          edition.isDefault = (await readUintValue(stream, child)) !== 0;
          break;
        case EbmlId.EditionFlagOrdered:
          edition.isOrdered = (await readUintValue(stream, child)) !== 0;
          break;
        case EbmlId.ChapterAtom: {
          const chapter = await MatroskaChapters.parseChapter(stream, child);
          edition.chapters.push(chapter);
          break;
        }
      }
    }
    return edition;
  }

  /**
   * Parse a single ChapterAtom element.
   */
  private static async parseChapter(
    stream: IOStream,
    atomEl: EbmlElement,
  ): Promise<Chapter> {
    const chapter: Chapter = {
      uid: 0,
      timeStart: 0,
      timeEnd: 0,
      isHidden: false,
      displays: [],
    };
    const children = await readChildElements(stream, atomEl.offset + atomEl.headSize, atomEl.dataSize);
    for (const child of children) {
      switch (child.id) {
        case EbmlId.ChapterUID:
          chapter.uid = await readUintValue(stream, child);
          break;
        case EbmlId.ChapterTimeStart:
          chapter.timeStart = await readUintValue(stream, child);
          break;
        case EbmlId.ChapterTimeEnd:
          chapter.timeEnd = await readUintValue(stream, child);
          break;
        case EbmlId.ChapterFlagHidden:
          chapter.isHidden = (await readUintValue(stream, child)) !== 0;
          break;
        case EbmlId.ChapterDisplay: {
          const display = await MatroskaChapters.parseDisplay(stream, child);
          chapter.displays.push(display);
          break;
        }
      }
    }
    return chapter;
  }

  /**
   * Parse a single ChapterDisplay element.
   */
  private static async parseDisplay(
    stream: IOStream,
    displayEl: EbmlElement,
  ): Promise<ChapterDisplay> {
    const display: ChapterDisplay = { string: "", language: "" };
    const children = await readChildElements(
      stream,
      displayEl.offset + displayEl.headSize,
      displayEl.dataSize,
    );
    for (const child of children) {
      switch (child.id) {
        case EbmlId.ChapString:
          display.string = await readStringValue(stream, child);
          break;
        case EbmlId.ChapLanguage:
          display.language = await readStringValue(stream, child);
          break;
      }
    }
    return display;
  }

  /**
   * Renders all editions into a `Chapters` EBML element.
   * Returns `null` if there are no editions.
   */
  renderChapters(): ByteVector | null {
    if (this._editions.length === 0) return null;
    const editionBufs = this._editions.map(ed => MatroskaChapters.renderEdition(ed));
    return renderEbmlElement(EbmlId.Chapters, combineByteVectors(editionBufs));
  }

  /**
   * Render a single edition.
   */
  private static renderEdition(edition: ChapterEdition): ByteVector {
    const parts: ByteVector[] = [];
    if (edition.uid) {
      parts.push(renderUintElement(EbmlId.EditionUID, edition.uid));
    }
    // Always write EditionFlagDefault and EditionFlagOrdered (even when 0) to
    // match C++ TagLib's matroskachapters.cpp renderInternal() which always
    // appends these elements regardless of their value.
    parts.push(renderUintElement(EbmlId.EditionFlagDefault, edition.isDefault ? 1 : 0));
    parts.push(renderUintElement(EbmlId.EditionFlagOrdered, edition.isOrdered ? 1 : 0));
    for (const chapter of edition.chapters) {
      parts.push(MatroskaChapters.renderChapter(chapter));
    }
    return renderEbmlElement(EbmlId.EditionEntry, combineByteVectors(parts));
  }

  /**
   * Render a single chapter atom.
   */
  private static renderChapter(chapter: Chapter): ByteVector {
    const parts: ByteVector[] = [];
    if (chapter.uid) {
      parts.push(renderUintElement(EbmlId.ChapterUID, chapter.uid));
    }
    parts.push(renderUintElement(EbmlId.ChapterTimeStart, chapter.timeStart));
    if (chapter.timeEnd !== undefined) {
      parts.push(renderUintElement(EbmlId.ChapterTimeEnd, chapter.timeEnd));
    }
    // Always write ChapterFlagHidden (even when 0) to match C++ TagLib's
    // matroskachapters.cpp renderInternal() which always appends this element.
    parts.push(renderUintElement(EbmlId.ChapterFlagHidden, chapter.isHidden ? 1 : 0));
    for (const display of chapter.displays) {
      parts.push(MatroskaChapters.renderDisplay(display));
    }
    return renderEbmlElement(EbmlId.ChapterAtom, combineByteVectors(parts));
  }

  /**
   * Render a single display entry.
   */
  private static renderDisplay(display: ChapterDisplay): ByteVector {
    const parts: ByteVector[] = [];
    if (display.string) {
      parts.push(renderStringElement(EbmlId.ChapString, display.string));
    }
    if (display.language) {
      parts.push(renderStringElement(EbmlId.ChapLanguage, display.language));
    }
    return renderEbmlElement(EbmlId.ChapterDisplay, combineByteVectors(parts));
  }

  /**
   * Returns this chapters object as a complex properties array
   * (one entry per edition).
   */
  toComplexProperties(): VariantMap[] {
    return this._editions.map(edition => {
      const m: VariantMap = new Map();
      if (edition.uid) {
        m.set("uid", Variant.fromULongLong(BigInt(edition.uid)));
      }
      if (edition.isDefault) {
        m.set("isDefault", Variant.fromBool(edition.isDefault));
      }
      if (edition.isOrdered) {
        m.set("isOrdered", Variant.fromBool(edition.isOrdered));
      }
      if (edition.chapters.length > 0) {
        const chaps = edition.chapters.map(ch => {
          const chMap: VariantMap = new Map();
          if (ch.uid) {
            chMap.set("uid", Variant.fromULongLong(BigInt(ch.uid)));
          }
          if (ch.isHidden) {
            chMap.set("isHidden", Variant.fromBool(ch.isHidden));
          }
          chMap.set("timeStart", Variant.fromULongLong(BigInt(ch.timeStart)));
          if (ch.timeEnd) {
            chMap.set("timeEnd", Variant.fromULongLong(BigInt(ch.timeEnd)));
          }
          if (ch.displays.length > 0) {
            const disps = ch.displays.map(d => {
              const dMap: VariantMap = new Map();
              if (d.string) {
                dMap.set("string", Variant.fromString(d.string));
              }
              if (d.language) {
                dMap.set("language", Variant.fromString(d.language));
              }
              return dMap;
            });
            chMap.set("displays", Variant.fromList(disps.map(d => Variant.fromMap(d))));
          }
          return chMap;
        });
        m.set("chapters", Variant.fromList(chaps.map(ch => Variant.fromMap(ch))));
      }
      return m;
    });
  }

  /**
   * Set chapters from complex properties (one entry per edition).
   * Replaces all existing editions.
   * @param properties - Array of edition VariantMaps.
   */
  fromComplexProperties(properties: VariantMap[]): void {
    this._editions = [];
    for (const m of properties) {
      const edition: ChapterEdition = {
        uid: Number(m.get("uid")?.toLongLong() ?? 0n),
        isDefault: m.get("isDefault")?.toBool() ?? false,
        isOrdered: m.get("isOrdered")?.toBool() ?? false,
        chapters: [],
      };
      const chapsList = m.get("chapters")?.toList() ?? [];
      for (const chVar of chapsList) {
        const chMap = chVar.toMap();
        const chapter: Chapter = {
          uid: Number(chMap.get("uid")?.toLongLong() ?? 0n),
          isHidden: chMap.get("isHidden")?.toBool() ?? false,
          timeStart: Number(chMap.get("timeStart")?.toLongLong() ?? 0n),
          timeEnd: Number(chMap.get("timeEnd")?.toLongLong() ?? 0n),
          displays: [],
        };
        const dispsList = chMap.get("displays")?.toList() ?? [];
        for (const dVar of dispsList) {
          const dMap = dVar.toMap();
          chapter.displays.push({
            string: dMap.get("string")?.toString() ?? "",
            language: dMap.get("language")?.toString() ?? "",
          });
        }
        edition.chapters.push(chapter);
      }
      this._editions.push(edition);
    }
  }
}
