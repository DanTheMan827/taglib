import { ByteVector, StringType } from "../byteVector.js";
import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";

// =============================================================================
// Chunk ID ↔ property name mapping
// =============================================================================

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

// Reverse mapping (prefer IPRT for TRACKNUMBER when writing)
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
 * Each sub-chunk:
 *   chunkId(4 ASCII) + chunkSize(4 LE) + data(null-terminated string,
 *   padded to even size)
 */
export class RiffInfoTag extends Tag {
  private _fields: Map<string, string> = new Map();

  // ---------------------------------------------------------------------------
  // Tag abstract property implementations
  // ---------------------------------------------------------------------------

  get title(): string {
    return this.fieldText("INAM");
  }
  set title(v: string) {
    this.setFieldText("INAM", v);
  }

  get artist(): string {
    return this.fieldText("IART");
  }
  set artist(v: string) {
    this.setFieldText("IART", v);
  }

  get album(): string {
    return this.fieldText("IPRD");
  }
  set album(v: string) {
    this.setFieldText("IPRD", v);
  }

  get comment(): string {
    return this.fieldText("ICMT");
  }
  set comment(v: string) {
    this.setFieldText("ICMT", v);
  }

  get genre(): string {
    return this.fieldText("IGNR");
  }
  set genre(v: string) {
    this.setFieldText("IGNR", v);
  }

  get year(): number {
    return parseInt(this.fieldText("ICRD"), 10) || 0;
  }
  set year(v: number) {
    this.setFieldText("ICRD", v > 0 ? String(v) : "");
  }

  get track(): number {
    const iprt = this.fieldText("IPRT");
    if (iprt !== "") return parseInt(iprt, 10) || 0;
    return parseInt(this.fieldText("ITRK"), 10) || 0;
  }
  set track(v: number) {
    this.setFieldText("IPRT", v > 0 ? String(v) : "");
    this.removeField("ITRK");
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Parse INFO sub-chunks from raw data (the contents inside LIST/INFO,
   * after the "INFO" fourCC).
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

  fieldText(id: string): string {
    return this._fields.get(id.toUpperCase()) ?? "";
  }

  setFieldText(id: string, value: string): void {
    const key = id.toUpperCase();
    if (value === "") {
      this._fields.delete(key);
    } else {
      this._fields.set(key, value);
    }
  }

  removeField(id: string): void {
    this._fields.delete(id.toUpperCase());
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

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
   * Render as the content of a LIST/INFO chunk (sub-chunks only,
   * without the outer LIST header or "INFO" fourCC).
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
