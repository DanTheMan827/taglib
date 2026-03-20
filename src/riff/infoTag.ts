/** @file RIFF INFO tag implementation. Reads and writes metadata stored in a LIST/INFO chunk. */

import { ByteVector, StringType } from "../byteVector.js";
import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";

// =============================================================================
// Chunk ID ↔ property name mapping
// =============================================================================

/** Maps RIFF INFO chunk IDs to canonical property names used by {@link PropertyMap}. */
const INFO_TO_PROPERTY: ReadonlyMap<string, string> = new Map([
  ["INAM", "TITLE"],
  ["IART", "ARTIST"],
  ["IPRD", "ALBUM"],
  ["ICMT", "COMMENT"],
  ["IGNR", "GENRE"],
  ["ICRD", "DATE"],
  ["IPRT", "TRACKNUMBER"],
  ["ITRK", "TRACKNUMBER"],
  ["ISFT", "ENCODER"],
  ["ISBJ", "SUBTITLE"],
  ["ICOP", "COPYRIGHT"],
  ["IENG", "ENGINEER"],
]);

/** Maps canonical property names to the preferred RIFF INFO chunk IDs used when writing. */
const PROPERTY_TO_INFO: ReadonlyMap<string, string> = new Map([
  ["TITLE", "INAM"],
  ["ARTIST", "IART"],
  ["ALBUM", "IPRD"],
  ["COMMENT", "ICMT"],
  ["GENRE", "IGNR"],
  ["DATE", "ICRD"],
  ["TRACKNUMBER", "IPRT"],
  ["ENCODER", "ISFT"],
  ["SUBTITLE", "ISBJ"],
  ["COPYRIGHT", "ICOP"],
  ["ENGINEER", "IENG"],
]);

// =============================================================================
// RiffInfoTag
// =============================================================================

/**
 * RIFF INFO tag: a series of sub-chunks inside a LIST/INFO RIFF chunk.
 *
 * Each sub-chunk consists of a 4-character ASCII ID, a 4-byte little-endian
 * size, and a null-terminated UTF-8 string padded to an even byte boundary.
 */
export class RiffInfoTag extends Tag {
  /** Internal map from uppercase INFO chunk IDs to their string values. */
  private _fields: Map<string, string> = new Map();

  // ---------------------------------------------------------------------------
  // Tag abstract property implementations
  // ---------------------------------------------------------------------------

  /**
   * Track title (`INAM`).
   * @returns The title string, or `""` if not set.
   */
  get title(): string {
    return this.fieldText("INAM");
  }
  /**
   * Sets the track title (`INAM`).
   * @param v - New title value; pass `""` to remove.
   */
  set title(v: string) {
    this.setFieldText("INAM", v);
  }

  /**
   * Track artist (`IART`).
   * @returns The artist string, or `""` if not set.
   */
  get artist(): string {
    return this.fieldText("IART");
  }
  /**
   * Sets the track artist (`IART`).
   * @param v - New artist value; pass `""` to remove.
   */
  set artist(v: string) {
    this.setFieldText("IART", v);
  }

  /**
   * Album name (`IPRD`).
   * @returns The album string, or `""` if not set.
   */
  get album(): string {
    return this.fieldText("IPRD");
  }
  /**
   * Sets the album name (`IPRD`).
   * @param v - New album value; pass `""` to remove.
   */
  set album(v: string) {
    this.setFieldText("IPRD", v);
  }

  /**
   * Comment text (`ICMT`).
   * @returns The comment string, or `""` if not set.
   */
  get comment(): string {
    return this.fieldText("ICMT");
  }
  /**
   * Sets the comment text (`ICMT`).
   * @param v - New comment value; pass `""` to remove.
   */
  set comment(v: string) {
    this.setFieldText("ICMT", v);
  }

  /**
   * Genre string (`IGNR`).
   * @returns The genre string, or `""` if not set.
   */
  get genre(): string {
    return this.fieldText("IGNR");
  }
  /**
   * Sets the genre string (`IGNR`).
   * @param v - New genre value; pass `""` to remove.
   */
  set genre(v: string) {
    this.setFieldText("IGNR", v);
  }

  /**
   * Release year (`ICRD`), parsed as an integer.
   * @returns The year, or `0` if absent or unparseable.
   */
  get year(): number {
    return parseInt(this.fieldText("ICRD"), 10) || 0;
  }
  /**
   * Sets the release year (`ICRD`).
   * @param v - New year value; pass `0` to remove.
   */
  set year(v: number) {
    this.setFieldText("ICRD", v > 0 ? String(v) : "");
  }

  /**
   * Track number (`IPRT` preferred, falls back to `ITRK`).
   * @returns The track number, or `0` if absent or unparseable.
   */
  get track(): number {
    const iprt = this.fieldText("IPRT");
    if (iprt !== "") return parseInt(iprt, 10) || 0;
    return parseInt(this.fieldText("ITRK"), 10) || 0;
  }
  /**
   * Sets the track number (`IPRT`); also removes any `ITRK` value.
   * @param v - New track number; pass `0` to remove.
   */
  set track(v: number) {
    this.setFieldText("IPRT", v > 0 ? String(v) : "");
    this.removeField("ITRK");
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Parse INFO sub-chunks from raw data (the contents inside a LIST/INFO chunk,
   * after the `"INFO"` fourCC).
   * @param data - Raw bytes of the INFO chunk body.
   * @returns A new {@link RiffInfoTag} populated with the parsed fields.
   */
  static readFrom(data: ByteVector): RiffInfoTag {
    const tag = new RiffInfoTag();
    let pos = 0;

    while (pos + 8 <= data.length) {
      const id = data.mid(pos, 4).toString(StringType.Latin1);
      pos += 4;

      const size = data.toUInt(pos, false);
      pos += 4;

      if (pos + size > data.length) break;

      // Read null-terminated string
      let strLen = size;
      for (let i = 0; i < size; i++) {
        if (data.get(pos + i) === 0) {
          strLen = i;
          break;
        }
      }
      const value = data.mid(pos, strLen).toString(StringType.UTF8);
      if (value !== "") {
        tag._fields.set(id.toUpperCase(), value);
      }

      // Advance past data, padded to even boundary
      pos += size;
      if (size % 2 !== 0) pos++;
    }

    return tag;
  }

  // ---------------------------------------------------------------------------
  // Field access
  // ---------------------------------------------------------------------------

  /**
   * Returns the string value stored for the given INFO chunk ID.
   * @param id - Four-character INFO chunk ID (case-insensitive).
   * @returns The stored string, or `""` if not present.
   */
  fieldText(id: string): string {
    return this._fields.get(id.toUpperCase()) ?? "";
  }

  /**
   * Sets (or removes) the string value for the given INFO chunk ID.
   * @param id - Four-character INFO chunk ID (case-insensitive).
   * @param value - New value; pass `""` to delete the field.
   */
  setFieldText(id: string, value: string): void {
    const key = id.toUpperCase();
    if (value === "") {
      this._fields.delete(key);
    } else {
      this._fields.set(key, value);
    }
  }

  /**
   * Removes the field with the given INFO chunk ID from the tag.
   * @param id - Four-character INFO chunk ID (case-insensitive).
   */
  removeField(id: string): void {
    this._fields.delete(id.toUpperCase());
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

  /**
   * Returns a {@link PropertyMap} built from the INFO fields currently set.
   * @returns A map of canonical property names to their values.
   */
  override properties(): PropertyMap {
    const map = new PropertyMap();
    for (const [id, value] of this._fields) {
      const propName = INFO_TO_PROPERTY.get(id);
      if (propName) {
        // ITRK and IPRT both map to TRACKNUMBER; merge if both present
        if (map.contains(propName)) {
          continue;
        }
        map.replace(propName, [value]);
      } else {
        map.addUnsupportedData(id);
      }
    }
    return map;
  }

  /**
   * Applies the given {@link PropertyMap} to this tag, updating INFO fields accordingly.
   * @param props - Property map containing new values to apply.
   * @returns A {@link PropertyMap} of properties that could not be mapped to INFO fields.
   */
  override setProperties(props: PropertyMap): PropertyMap {
    const unsupported = new PropertyMap();

    // Remove fields for properties being set
    for (const key of props.keys()) {
      const infoId = PROPERTY_TO_INFO.get(key);
      if (infoId) {
        this._fields.delete(infoId);
        // Also clear ITRK when writing TRACKNUMBER
        if (key === "TRACKNUMBER") {
          this._fields.delete("ITRK");
        }
      }
    }

    for (const [key, values] of props.entries()) {
      const infoId = PROPERTY_TO_INFO.get(key);
      if (!infoId) {
        unsupported.replace(key, values);
        continue;
      }
      if (values.length > 0 && values[0] !== "") {
        this._fields.set(infoId, values[0]);
      } else {
        this._fields.delete(infoId);
      }
    }

    return unsupported;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Renders all INFO fields as a byte sequence suitable for inclusion inside a
   * `LIST/INFO` chunk (sub-chunks only, without the outer `LIST` header or
   * `"INFO"` fourCC).
   * @returns A {@link ByteVector} containing the serialised INFO sub-chunks.
   */
  render(): ByteVector {
    const result = new ByteVector();

    for (const [id, value] of this._fields) {
      // Pad id to exactly 4 bytes
      const idStr = id.padEnd(4, " ").substring(0, 4);
      const idBytes = ByteVector.fromString(idStr, StringType.Latin1);

      // Value as null-terminated UTF-8
      const valueBytes = ByteVector.fromString(value, StringType.UTF8);
      const dataSize = valueBytes.length + 1; // +1 for null terminator

      result.append(idBytes);
      result.append(ByteVector.fromUInt(dataSize, false));
      result.append(valueBytes);
      result.append(0); // null terminator

      // Pad to even size
      if (dataSize % 2 !== 0) {
        result.append(0);
      }
    }

    return result;
  }
}
