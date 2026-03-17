/** @file MP4/M4A/AAC/ALAC file format handler. */
import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { VariantMap } from "../toolkit/variant.js";
import { Mp4Atoms } from "./mp4Atoms.js";
import { Mp4Tag } from "./mp4Tag.js";
import { Mp4Properties } from "./mp4Properties.js";

// ---------------------------------------------------------------------------
// Mp4File
// ---------------------------------------------------------------------------

export class Mp4File extends File {
  private _atoms: Mp4Atoms | null = null;
  private _tag: Mp4Tag | null = null;
  private _properties: Mp4Properties | null = null;

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
    return (await this._tag?.save()) ?? false;
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
