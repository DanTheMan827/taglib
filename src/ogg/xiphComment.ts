import { ByteVector, StringType } from "../byteVector.js";
import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { VariantMap } from "../toolkit/variant.js";
import { Variant } from "../toolkit/variant.js";
import { FlacPicture } from "../flac/flacPicture.js";

// =============================================================================
// XiphComment
// =============================================================================

/**
 * Xiph/Vorbis comment tag implementation.
 *
 * Binary format:
 *   vendorLength(4 LE) + vendor(UTF-8) +
 *   commentCount(4 LE) +
 *   for each: stringLength(4 LE) + "KEY=VALUE"(UTF-8)
 */
export class XiphComment extends Tag {
  private _vendorId: string = "";
  private _fields: Map<string, string[]> = new Map();

  // ---------------------------------------------------------------------------
  // Tag abstract property implementations
  // ---------------------------------------------------------------------------

  get title(): string {
    return this.firstFieldValue("TITLE");
  }
  set title(v: string) {
    this.addField("TITLE", v, true);
  }

  get artist(): string {
    return this.firstFieldValue("ARTIST");
  }
  set artist(v: string) {
    this.addField("ARTIST", v, true);
  }

  get album(): string {
    return this.firstFieldValue("ALBUM");
  }
  set album(v: string) {
    this.addField("ALBUM", v, true);
  }

  get comment(): string {
    const desc = this.firstFieldValue("DESCRIPTION");
    return desc !== "" ? desc : this.firstFieldValue("COMMENT");
  }
  set comment(v: string) {
    this.addField("DESCRIPTION", v, true);
    this.removeField("COMMENT");
  }

  get genre(): string {
    return this.firstFieldValue("GENRE");
  }
  set genre(v: string) {
    this.addField("GENRE", v, true);
  }

  get year(): number {
    const date = parseInt(this.firstFieldValue("DATE"), 10);
    if (date) return date;
    return parseInt(this.firstFieldValue("YEAR"), 10) || 0;
  }
  set year(v: number) {
    this.addField("DATE", v > 0 ? String(v) : "", true);
    this.removeField("YEAR");
  }

  get track(): number {
    const tn = parseInt(this.firstFieldValue("TRACKNUMBER"), 10);
    if (tn) return tn;
    return parseInt(this.firstFieldValue("TRACKNUM"), 10) || 0;
  }
  set track(v: number) {
    this.addField("TRACKNUMBER", v > 0 ? String(v) : "", true);
    this.removeField("TRACKNUM");
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Parse a Xiph comment block from the given ByteVector.
   * @param data   Raw bytes containing the Vorbis comment
   * @param offset Starting position within `data` (default 0)
   */
  static readFrom(data: ByteVector, offset: number = 0): XiphComment {
    const tag = new XiphComment();
    let pos = offset;

    if (pos + 4 > data.length) return tag;
    const vendorLen = data.toUInt(pos, false);
    pos += 4;

    if (vendorLen > 0 && pos + vendorLen <= data.length) {
      tag._vendorId = data.mid(pos, vendorLen).toString(StringType.UTF8);
    }
    pos += vendorLen;

    if (pos + 4 > data.length) return tag;
    const count = data.toUInt(pos, false);
    pos += 4;

    for (let i = 0; i < count; i++) {
      if (pos + 4 > data.length) break;
      const strLen = data.toUInt(pos, false);
      pos += 4;

      if (pos + strLen > data.length) break;
      const entry = data.mid(pos, strLen).toString(StringType.UTF8);
      pos += strLen;

      const eq = entry.indexOf("=");
      if (eq < 0) continue;

      const key = entry.substring(0, eq).toUpperCase();
      const value = entry.substring(eq + 1);

      const existing = tag._fields.get(key);
      if (existing) {
        existing.push(value);
      } else {
        tag._fields.set(key, [value]);
      }
    }

    return tag;
  }

  // ---------------------------------------------------------------------------
  // Vendor
  // ---------------------------------------------------------------------------

  get vendorId(): string {
    return this._vendorId;
  }
  set vendorId(v: string) {
    this._vendorId = v;
  }

  get fieldCount(): number {
    let count = 0;
    for (const values of this._fields.values()) {
      count += values.length;
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Field access
  // ---------------------------------------------------------------------------

  fieldListMap(): Map<string, string[]> {
    return new Map(this._fields);
  }

  /**
   * Add or replace a field value.
   * @param key     Field name (case-insensitive, stored uppercase)
   * @param value   The value to set. Empty string removes the field.
   * @param replace If true (default), replaces all existing values for this key
   */
  addField(key: string, value: string, replace: boolean = true): void {
    const k = key.toUpperCase();
    if (value === "") {
      if (replace) {
        this._fields.delete(k);
      }
      return;
    }
    if (replace) {
      this._fields.set(k, [value]);
    } else {
      const existing = this._fields.get(k);
      if (existing) {
        existing.push(value);
      } else {
        this._fields.set(k, [value]);
      }
    }
  }

  removeField(key: string): void {
    this._fields.delete(key.toUpperCase());
  }

  removeAllFields(): void {
    this._fields.clear();
  }

  contains(key: string): boolean {
    return this._fields.has(key.toUpperCase());
  }

  // ---------------------------------------------------------------------------
  // Picture support (METADATA_BLOCK_PICTURE)
  // ---------------------------------------------------------------------------

  pictureList(): FlacPicture[] {
    const pics: FlacPicture[] = [];
    const entries = this._fields.get("METADATA_BLOCK_PICTURE");
    if (!entries) return pics;

    for (const b64 of entries) {
      const raw = ByteVector.fromBase64(
        ByteVector.fromString(b64, StringType.Latin1),
      );
      if (raw.length > 0) {
        pics.push(FlacPicture.parse(raw));
      }
    }
    return pics;
  }

  addPicture(picture: FlacPicture): void {
    const rendered = picture.render();
    const b64 = rendered.toBase64().toString(StringType.Latin1);
    this.addField("METADATA_BLOCK_PICTURE", b64, false);
  }

  removePicture(picture: FlacPicture): void {
    const rendered = picture.render();
    const target = rendered.toBase64().toString(StringType.Latin1);
    const entries = this._fields.get("METADATA_BLOCK_PICTURE");
    if (!entries) return;
    const filtered = entries.filter((v) => v !== target);
    if (filtered.length === 0) {
      this._fields.delete("METADATA_BLOCK_PICTURE");
    } else {
      this._fields.set("METADATA_BLOCK_PICTURE", filtered);
    }
  }

  removeAllPictures(): void {
    this._fields.delete("METADATA_BLOCK_PICTURE");
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

  override properties(): PropertyMap {
    const map = new PropertyMap();
    for (const [key, values] of this._fields) {
      if (key === "METADATA_BLOCK_PICTURE") continue;
      map.replace(key, [...values]);
    }
    return map;
  }

  override setProperties(props: PropertyMap): PropertyMap {
    const unsupported = new PropertyMap();

    // Remove fields that are being set
    for (const key of props.keys()) {
      if (key === "METADATA_BLOCK_PICTURE") continue;
      this._fields.delete(key);
    }

    for (const [key, values] of props.entries()) {
      if (key === "METADATA_BLOCK_PICTURE") {
        unsupported.replace(key, values);
        continue;
      }
      if (values.length === 0) {
        this._fields.delete(key);
      } else {
        this._fields.set(key, [...values]);
      }
    }

    return unsupported;
  }

  // ---------------------------------------------------------------------------
  // Complex properties (pictures)
  // ---------------------------------------------------------------------------

  override complexPropertyKeys(): string[] {
    if (this._fields.has("METADATA_BLOCK_PICTURE")) {
      return ["PICTURE"];
    }
    return [];
  }

  override complexProperties(key: string): VariantMap[] {
    if (key.toUpperCase() !== "PICTURE") return [];

    const result: VariantMap[] = [];
    for (const pic of this.pictureList()) {
      const m: VariantMap = new Map();
      m.set("data", Variant.fromByteVector(pic.data));
      m.set("mimeType", Variant.fromString(pic.mimeType));
      m.set("description", Variant.fromString(pic.description));
      m.set("pictureType", Variant.fromInt(pic.pictureType));
      m.set("width", Variant.fromInt(pic.width));
      m.set("height", Variant.fromInt(pic.height));
      m.set("numColors", Variant.fromInt(pic.numColors));
      m.set("colorDepth", Variant.fromInt(pic.colorDepth));
      result.push(m);
    }
    return result;
  }

  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    if (key.toUpperCase() !== "PICTURE") return false;

    this.removeAllPictures();
    for (const m of value) {
      const pic = new FlacPicture();
      const dataV = m.get("data");
      if (dataV) pic.data = dataV.toByteVector();
      const mimeV = m.get("mimeType");
      if (mimeV) pic.mimeType = mimeV.toString();
      const descV = m.get("description");
      if (descV) pic.description = descV.toString();
      const typeV = m.get("pictureType");
      if (typeV) pic.pictureType = typeV.toInt();
      const widthV = m.get("width");
      if (widthV) pic.width = widthV.toInt();
      const heightV = m.get("height");
      if (heightV) pic.height = heightV.toInt();
      const numColorsV = m.get("numColors");
      if (numColorsV) pic.numColors = numColorsV.toInt();
      const colorDepthV = m.get("colorDepth");
      if (colorDepthV) pic.colorDepth = colorDepthV.toInt();
      this.addPicture(pic);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Render the Vorbis comment to bytes.
   * @param addFramingBit If true, append a 0x01 framing bit (used in Ogg Vorbis)
   */
  render(addFramingBit: boolean = false): ByteVector {
    const vendorBytes = ByteVector.fromString(
      this._vendorId,
      StringType.UTF8,
    );

    const result = new ByteVector();
    result.append(ByteVector.fromUInt(vendorBytes.length, false));
    result.append(vendorBytes);

    // Count total individual entries
    let entryCount = 0;
    const entries: ByteVector[] = [];
    for (const [key, values] of this._fields) {
      for (const value of values) {
        const entry = ByteVector.fromString(
          `${key}=${value}`,
          StringType.UTF8,
        );
        entries.push(entry);
        entryCount++;
      }
    }

    result.append(ByteVector.fromUInt(entryCount, false));
    for (const entry of entries) {
      result.append(ByteVector.fromUInt(entry.length, false));
      result.append(entry);
    }

    if (addFramingBit) {
      result.append(0x01);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private firstFieldValue(key: string): string {
    const values = this._fields.get(key.toUpperCase());
    return values && values.length > 0 ? values[0] : "";
  }
}
