import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { AudioProperties } from "../audioProperties.js";
import { Tag } from "../tag.js";
import { type offset_t, Position, ReadStyle } from "../toolkit/types.js";
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

  constructor(
    stream: IOStream,
    readProperties = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    if (this.isOpen) {
      this.read(readProperties, readStyle);
    }
  }

  // -- File interface --

  tag(): Mp4Tag | null {
    return this._tag;
  }

  audioProperties(): Mp4Properties | null {
    return this._properties;
  }

  save(): boolean {
    if (this.readOnly) return false;
    if (!this.isValid) return false;
    return this._tag?.save() ?? false;
  }

  // -- Convenience --

  hasMP4Tag(): boolean {
    return this._atoms?.find("moov", "udta", "meta", "ilst") != null;
  }

  static isSupported(stream: IOStream): boolean {
    stream.seek(0);
    const header = stream.readBlock(8);
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

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    if (!this.isValid) return;

    this._atoms = new Mp4Atoms(this._stream);
    if (!this._atoms.checkRootLevelAtoms()) {
      this._valid = false;
      return;
    }

    if (!this._atoms.find("moov")) {
      this._valid = false;
      return;
    }

    this._tag = new Mp4Tag(this._stream, this._atoms);

    if (readProperties) {
      this._properties = new Mp4Properties(this._stream, this._atoms, readStyle);
    }
  }
}
