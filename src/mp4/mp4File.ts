/** @packageDocumentation MP4/M4A/AAC/ALAC file format handler. */
import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { VariantMap } from "../toolkit/variant.js";
import { Mp4Atoms } from "./mp4Atoms.js";
import { Mp4Tag } from "./mp4Tag.js";
import { Mp4Properties } from "./mp4Properties.js";
import { NeroChapters } from "./mp4NeroChapters.js";
import { QtChapters } from "./mp4QtChapters.js";
import type { Mp4Chapter } from "./mp4Chapter.js";

// ---------------------------------------------------------------------------
// Mp4File
// ---------------------------------------------------------------------------

export class Mp4File extends File {
  private _atoms: Mp4Atoms | null = null;
  private _tag: Mp4Tag | null = null;
  private _properties: Mp4Properties | null = null;
  /** @internal Lazily-created Nero chapter holder. */
  private _neroChapters: NeroChapters | null = null;
  /** @internal Lazily-created QuickTime chapter holder. */
  private _qtChapters: QtChapters | null = null;

  private constructor(stream: IOStream) {
    super(stream);
  }

  static async open(
    stream: IOStream,
    readProperties = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<Mp4File> {
    const file = new Mp4File(stream);
    if (file.isOpen) {
      await file.read(readProperties, readStyle);
    }
    return file;
  }

  // -- File interface --

  tag(): Mp4Tag | null {
    return this._tag;
  }

  audioProperties(): Mp4Properties | null {
    return this._properties;
  }

  async save(): Promise<boolean> {
    if (this.readOnly) return false;
    if (!this.isValid) return false;

    const tagOk = (await this._tag?.save()) ?? false;
    const neroOk = this._neroChapters
      ? await this._neroChapters.saveIfModified(this._stream)
      : true;
    const qtOk = this._qtChapters
      ? await this._qtChapters.saveIfModified(this._stream)
      : true;

    return tagOk && neroOk && qtOk;
  }

  // -- Convenience --

  hasMP4Tag(): boolean {
    return this._atoms?.find("moov", "udta", "meta", "ilst") != null;
  }

  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const header = await stream.readBlock(8);
    return header.containsAt(
      ByteVector.fromString("ftyp", StringType.Latin1),
      4,
    );
  }

  // -- Nero chapters --

  /**
   * Returns the Nero-style chapter list (`chpl` atom at `moov/udta/chpl`).
   *
   * Chapters are read from disk lazily on the first call.
   *
   * @returns Array of chapters with `title` and `startTime` (in ms).
   */
  async neroChapters(): Promise<Mp4Chapter[]> {
    if (!this._neroChapters) {
      this._neroChapters = new NeroChapters();
    }
    return await this._neroChapters.getChapters(this._stream);
  }

  /**
   * Sets the Nero-style chapters.  Changes are written to disk on the next
   * {@link save} call.  Pass an empty array to remove the `chpl` atom.
   *
   * @param chapters - Replacement chapter list (start times in ms).
   */
  setNeroChapters(chapters: Mp4Chapter[]): void {
    if (!this._neroChapters) {
      this._neroChapters = new NeroChapters();
    }
    this._neroChapters.setChapters(chapters);
  }

  // -- QuickTime chapters --

  /**
   * Returns the QuickTime-style chapter list (text track referenced by
   * `tref/chap` in the audio track).
   *
   * Chapters are read from disk lazily on the first call.
   *
   * @returns Array of chapters with `title` and `startTime` (in ms).
   */
  async qtChapters(): Promise<Mp4Chapter[]> {
    if (!this._qtChapters) {
      this._qtChapters = new QtChapters();
    }
    return await this._qtChapters.getChapters(this._stream);
  }

  /**
   * Sets the QuickTime-style chapters.  Changes are written to disk on the
   * next {@link save} call.  Pass an empty array to remove the chapter track.
   *
   * @param chapters - Replacement chapter list (start times in ms).
   */
  setQtChapters(chapters: Mp4Chapter[]): void {
    if (!this._qtChapters) {
      this._qtChapters = new QtChapters();
    }
    this._qtChapters.setChapters(chapters);
  }

  // -- PropertyMap delegation --

  override properties(): PropertyMap {
    return this._tag?.properties() ?? new PropertyMap();
  }

  override setProperties(properties: PropertyMap): PropertyMap {
    return this._tag?.setProperties(properties) ?? properties;
  }

  override removeUnsupportedProperties(properties: string[]): void {
    this._tag?.removeUnsupportedProperties(properties);
  }

  override complexPropertyKeys(): string[] {
    return this._tag?.complexPropertyKeys() ?? [];
  }

  override complexProperties(key: string): VariantMap[] {
    return this._tag?.complexProperties(key) ?? [];
  }

  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    return this._tag?.setComplexProperties(key, value) ?? false;
  }

  // -- Internal --

  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    if (!this.isValid) return;

    this._atoms = await Mp4Atoms.create(this._stream);
    if (!this._atoms.checkRootLevelAtoms()) {
      this._valid = false;
      return;
    }

    if (!this._atoms.find("moov")) {
      this._valid = false;
      return;
    }

    this._tag = await Mp4Tag.create(this._stream, this._atoms);

    if (readProperties) {
      this._properties = await Mp4Properties.create(this._stream, this._atoms, readStyle);
    }
  }
}

