/** @packageDocumentation Xiph/Vorbis comment tag implementation used by OGG-based formats (Vorbis, Opus, Speex, FLAC-in-OGG). */

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
  /** The vendor identification string written by the encoder. */
  private _vendorId: string = "";
  /** Map of uppercased field names to their ordered list of values. */
  private _fields: Map<string, string[]> = new Map();

  // ---------------------------------------------------------------------------
  // Tag abstract property implementations
  // ---------------------------------------------------------------------------

  /** Track title stored in the "TITLE" field. */
  get title(): string {
    return this.firstFieldValue("TITLE");
  }
  /** @param v - New title string; empty string removes the field. */
  set title(v: string) {
    this.addField("TITLE", v, true);
  }

  /** Lead artist/performer stored in the "ARTIST" field. */
  get artist(): string {
    return this.firstFieldValue("ARTIST");
  }
  /** @param v - New artist string; empty string removes the field. */
  set artist(v: string) {
    this.addField("ARTIST", v, true);
  }

  /** Album title stored in the "ALBUM" field. */
  get album(): string {
    return this.firstFieldValue("ALBUM");
  }
  /** @param v - New album string; empty string removes the field. */
  set album(v: string) {
    this.addField("ALBUM", v, true);
  }

  /**
   * User comment, read from "COMMENT" (preferred, matching C++ TagLib default) or
   * "DESCRIPTION" as a fallback for tags written by older encoders.
   * @returns The comment string, or `""` if neither field is set.
   */
  get comment(): string {
    const comment = this.firstFieldValue("COMMENT");
    return comment !== "" ? comment : this.firstFieldValue("DESCRIPTION");
  }
  /**
   * Sets the comment. Matches C++ TagLib `XiphComment::setComment()`: if a
   * "DESCRIPTION" field already exists (loaded from file), update that field;
   * otherwise write to "COMMENT" (the standard Vorbis comment field name).
   * @param v - New comment string; empty string removes the field.
   */
  set comment(v: string) {
    // Match C++ TagLib: prefer "DESCRIPTION" if already present, else use "COMMENT"
    if (this._fields.has("DESCRIPTION")) {
      this.addField("DESCRIPTION", v, true);
      this.removeField("COMMENT");
    } else {
      this.addField("COMMENT", v, true);
      this.removeField("DESCRIPTION");
    }
  }

  /** Genre stored in the "GENRE" field. */
  get genre(): string {
    return this.firstFieldValue("GENRE");
  }
  /** @param v - New genre string; empty string removes the field. */
  set genre(v: string) {
    this.addField("GENRE", v, true);
  }

  /**
   * Release year, read from "DATE" (preferred) or "YEAR" as a fallback.
   * Returns `0` when not set.
   */
  get year(): number {
    const date = parseInt(this.firstFieldValue("DATE"), 10);
    if (date) return date;
    return parseInt(this.firstFieldValue("YEAR"), 10) || 0;
  }
  /**
   * Sets the year in the "DATE" field and removes any "YEAR" alias.
   * @param v - Four-digit year, or `0` to remove the field.
   */
  set year(v: number) {
    this.addField("DATE", v > 0 ? String(v) : "", true);
    this.removeField("YEAR");
  }

  /**
   * Track number, read from "TRACKNUMBER" (preferred) or "TRACKNUM" as a fallback.
   * Returns `0` when not set.
   */
  get track(): number {
    const tn = parseInt(this.firstFieldValue("TRACKNUMBER"), 10);
    if (tn) return tn;
    return parseInt(this.firstFieldValue("TRACKNUM"), 10) || 0;
  }
  /**
   * Sets the track number in "TRACKNUMBER" and removes any "TRACKNUM" alias.
   * @param v - Track number, or `0` to remove the field.
   */
  set track(v: number) {
    this.addField("TRACKNUMBER", v > 0 ? String(v) : "", true);
    this.removeField("TRACKNUM");
  }

  /**
   * A Xiph comment is empty when all field lists are empty.
   * This matches the C++ TagLib behaviour and ensures tags with only
   * METADATA_BLOCK_PICTURE or other non-standard fields are not stripped.
   */
  override get isEmpty(): boolean {
    for (const values of this._fields.values()) {
      if (values.length > 0) return false;
    }
    return true;
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

  /** The vendor identification string embedded in the comment header. */
  get vendorId(): string {
    return this._vendorId;
  }
  /** @param v - New vendor ID string. */
  set vendorId(v: string) {
    this._vendorId = v;
  }

  /** Total number of individual field values across all keys. */
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

  /**
   * Returns a shallow copy of the internal field map.
   * @returns A new `Map` of uppercased field names to their value arrays.
   */
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

  /**
   * Remove all values for the specified field key.
   * @param key - Field name (case-insensitive).
   */
  removeField(key: string): void;
  /**
   * Remove a specific value from the specified field key.
   * Other values for the same key are left intact.
   * @param key - Field name (case-insensitive).
   * @param value - The exact value to remove.
   */
  removeField(key: string, value: string): void;
  removeField(key: string, value?: string): void {
    const upperKey = key.toUpperCase();
    if (value === undefined) {
      this._fields.delete(upperKey);
    } else {
      const existing = this._fields.get(upperKey);
      if (existing) {
        const filtered = existing.filter(v => v !== value);
        if (filtered.length === 0) {
          this._fields.delete(upperKey);
        } else {
          this._fields.set(upperKey, filtered);
        }
      }
    }
  }

  /** Remove all fields from this comment, leaving an empty tag. */
  removeAllFields(): void {
    this._fields.clear();
  }

  /**
   * Check whether a field with the given key is present.
   * @param key - Field name (case-insensitive).
   * @returns `true` if at least one value exists for `key`.
   */
  contains(key: string): boolean {
    return this._fields.has(key.toUpperCase());
  }

  /**
   * Validate a Vorbis comment field key.
   *
   * Keys must consist only of ASCII characters in the range 0x20–0x7D,
   * excluding `'='` (0x3D), and must be at least one character long.
   * @param key - The field key to validate.
   * @returns `true` if the key is valid.
   */
  static checkKey(key: string): boolean {
    if (key.length === 0) return false;
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      if (c < 0x20 || c > 0x7D || c === 0x3D) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Picture support (METADATA_BLOCK_PICTURE)
  // ---------------------------------------------------------------------------

  /**
   * Decode and return all embedded pictures from METADATA_BLOCK_PICTURE fields.
   * @returns Array of {@link FlacPicture} objects decoded from Base64, or an empty array if none.
   */
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

  /**
   * Encode and append a picture to the METADATA_BLOCK_PICTURE field.
   * @param picture - The {@link FlacPicture} to embed as Base64-encoded data.
   */
  addPicture(picture: FlacPicture): void {
    const rendered = picture.render();
    const b64 = rendered.toBase64().toString(StringType.Latin1);
    this.addField("METADATA_BLOCK_PICTURE", b64, false);
  }

  /**
   * Remove a specific picture from the METADATA_BLOCK_PICTURE field.
   * @param picture - The {@link FlacPicture} to remove (matched by rendered bytes).
   */
  removePicture(picture: FlacPicture): void {
    const rendered = picture.render();
    const target = rendered.toBase64().toString(StringType.Latin1);
    const entries = this._fields.get("METADATA_BLOCK_PICTURE");
    if (!entries) return;
    const filtered = entries.filter(v => v !== target);
    if (filtered.length === 0) {
      this._fields.delete("METADATA_BLOCK_PICTURE");
    } else {
      this._fields.set("METADATA_BLOCK_PICTURE", filtered);
    }
  }

  /** Remove all pictures by deleting the METADATA_BLOCK_PICTURE field entirely. */
  removeAllPictures(): void {
    this._fields.delete("METADATA_BLOCK_PICTURE");
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

  /**
   * Build a {@link PropertyMap} from all fields, excluding METADATA_BLOCK_PICTURE.
   * @returns A populated {@link PropertyMap} with all text fields.
   */
  override properties(): PropertyMap {
    const map = new PropertyMap();
    for (const [key, values] of this._fields) {
      if (key === "METADATA_BLOCK_PICTURE") continue;
      map.replace(key, [...values]);
    }
    return map;
  }

  /**
   * Replace tag fields with the provided {@link PropertyMap}.
   * METADATA_BLOCK_PICTURE keys are returned as unsupported.
   * @param props - The properties to set.
   * @returns A {@link PropertyMap} of unsupported properties.
   */
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

  /**
   * Returns the list of complex property keys supported by this tag.
   * @returns `["PICTURE"]` if any embedded pictures are present, otherwise `[]`.
   */
  override complexPropertyKeys(): string[] {
    if (this._fields.has("METADATA_BLOCK_PICTURE")) {
      return ["PICTURE"];
    }
    return [];
  }

  /**
   * Returns structured complex property data for the given key.
   * @param key - The complex property key (only "PICTURE" is supported).
   * @returns Array of variant maps describing each embedded picture, or `[]` for unknown keys.
   */
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

  /**
   * Replaces all complex properties for the given key.
   * @param key - The complex property key (only "PICTURE" is supported).
   * @param value - Array of variant maps describing each picture to embed.
   * @returns `true` if the key was handled, `false` otherwise.
   */
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

    // Collect all field entries.  To match C++ TagLib's XiphComment::render():
    //   1. Regular text fields are iterated in sorted (alphabetical) key order,
    //      matching std::map<String, StringList> iteration order.
    //   2. METADATA_BLOCK_PICTURE entries are appended last, matching the
    //      separate d->pictureList written after fieldListMap.
    const entries: ByteVector[] = [];
    const sortedKeys = [...this._fields.keys()]
      .filter(k => k !== "METADATA_BLOCK_PICTURE")
      .sort();
    for (const key of sortedKeys) {
      const values = this._fields.get(key)!;
      for (const value of values) {
        entries.push(ByteVector.fromString(`${key}=${value}`, StringType.UTF8));
      }
    }
    const picEntries = this._fields.get("METADATA_BLOCK_PICTURE") ?? [];
    for (const value of picEntries) {
      entries.push(ByteVector.fromString(`METADATA_BLOCK_PICTURE=${value}`, StringType.UTF8));
    }

    // Calculate total size: vendor length(4) + vendor + entry count(4) + entries(length(4) + data each) + optional framing
    let totalSize = 4 + vendorBytes.length + 4;
    for (const entry of entries) {
      totalSize += 4 + entry.length;
    }
    if (addFramingBit) totalSize += 1;

    const arr = new Uint8Array(totalSize);
    const view = new DataView(arr.buffer);
    let pos = 0;

    // Vendor string (little-endian length + data)
    view.setUint32(pos, vendorBytes.length, true); pos += 4;
    arr.set(vendorBytes.data, pos); pos += vendorBytes.length;

    // Entry count (little-endian)
    view.setUint32(pos, entries.length, true); pos += 4;

    // Entries (little-endian length + data each)
    for (const entry of entries) {
      view.setUint32(pos, entry.length, true); pos += 4;
      arr.set(entry.data, pos); pos += entry.length;
    }

    if (addFramingBit) {
      arr[pos] = 0x01;
    }

    return new ByteVector(arr);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the first value for the given field key, or `""` if absent.
   * @param key - Field name (case-insensitive).
   * @returns The first value string, or `""` if the field is not set.
   */
  private firstFieldValue(key: string): string {
    const values = this._fields.get(key.toUpperCase());
    return values && values.length > 0 ? values[0] : "";
  }
}
