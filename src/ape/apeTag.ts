import { ByteVector, StringType } from "../byteVector.js";
import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { IOStream } from "../toolkit/ioStream.js";
import type { offset_t } from "../toolkit/types.js";
import { Position } from "../toolkit/types.js";

// =============================================================================
// ApeItemType
// =============================================================================

export enum ApeItemType {
  Text = 0,
  Binary = 1,
  Locator = 2,
}

// =============================================================================
// ApeItem
// =============================================================================

/**
 * A single APE tag item.
 *
 * Binary layout:
 *   valueLength(4 LE) + flags(4 LE) + key(null-terminated ASCII) + value
 */
export class ApeItem {
  key: string = "";
  values: string[] = [];
  type: ApeItemType = ApeItemType.Text;
  readOnly: boolean = false;
  binaryData: ByteVector = new ByteVector();

  /**
   * Parse one APE item starting at `offset` in `data`.
   * Returns the parsed item and how many bytes were consumed, or null on error.
   */
  static parse(
    data: ByteVector,
    offset: number,
  ): { item: ApeItem; bytesUsed: number } | null {
    if (offset + 8 > data.length) return null;

    const valueLength = data.toUInt(offset, false);
    const flags = data.toUInt(offset + 4, false);
    offset += 8;

    // Read null-terminated key (ASCII)
    const keyStart = offset;
    while (offset < data.length && data.get(offset) !== 0) {
      offset++;
    }
    if (offset >= data.length) return null;
    const keyBytes = data.mid(keyStart, offset - keyStart);
    offset++; // skip null terminator

    const item = new ApeItem();
    item.key = keyBytes.toString(StringType.Latin1);
    item.readOnly = (flags & 0x01) !== 0;
    item.type = ((flags >> 1) & 0x03) as ApeItemType;

    if (offset + valueLength > data.length) return null;

    if (item.type === ApeItemType.Text || item.type === ApeItemType.Locator) {
      const raw = data.mid(offset, valueLength).toString(StringType.UTF8);
      // Multiple values are separated by null bytes
      item.values = raw.split("\0");
    } else {
      item.binaryData = data.mid(offset, valueLength);
    }

    const totalUsed = 8 + (keyBytes.length + 1) + valueLength;
    return { item, bytesUsed: totalUsed };
  }

  /**
   * Render this item to bytes.
   */
  render(): ByteVector {
    let valueData: ByteVector;
    if (this.type === ApeItemType.Text || this.type === ApeItemType.Locator) {
      valueData = ByteVector.fromString(
        this.values.join("\0"),
        StringType.UTF8,
      );
    } else {
      valueData = this.binaryData;
    }

    const flags =
      (this.readOnly ? 0x01 : 0x00) | ((this.type & 0x03) << 1);

    const result = new ByteVector();
    result.append(ByteVector.fromUInt(valueData.length, false));
    result.append(ByteVector.fromUInt(flags, false));
    result.append(ByteVector.fromString(this.key, StringType.Latin1));
    result.append(0); // null terminator
    result.append(valueData);
    return result;
  }

  toString(): string {
    if (this.type === ApeItemType.Binary) {
      return `[binary data, ${this.binaryData.length} bytes]`;
    }
    return this.values.join(", ");
  }
}

// =============================================================================
// ApeFooter
// =============================================================================

/**
 * 32-byte APE tag footer (or header).
 *
 * Layout:
 *   "APETAGEX"(8) + version(4 LE) + tagSize(4 LE) +
 *   itemCount(4 LE) + flags(4 LE) + reserved(8 zeros)
 */
export class ApeFooter {
  version: number = 2000;
  tagSize: number = 0;
  itemCount: number = 0;
  flags: number = 0;

  static readonly SIZE = 32;
  static readonly FILE_IDENTIFIER: ByteVector = ByteVector.fromString(
    "APETAGEX",
    StringType.Latin1,
  );

  get isHeader(): boolean {
    return (this.flags & 0x20000000) !== 0;
  }

  get hasHeader(): boolean {
    return (this.flags & 0x80000000) !== 0;
  }

  /**
   * Parse a 32-byte block as an APE footer/header.
   */
  static parse(data: ByteVector): ApeFooter | null {
    if (data.length < ApeFooter.SIZE) return null;
    if (!data.startsWith(ApeFooter.FILE_IDENTIFIER)) return null;

    const f = new ApeFooter();
    f.version = data.toUInt(8, false);
    f.tagSize = data.toUInt(12, false);
    f.itemCount = data.toUInt(16, false);
    f.flags = data.toUInt(20, false);
    return f;
  }

  /**
   * Render as a 32-byte footer block.
   */
  render(): ByteVector {
    // Footer: clear the "this is a header" bit
    const footerFlags = this.flags & ~0x20000000;
    return this.renderBlock(footerFlags);
  }

  /**
   * Render as a 32-byte header block.
   */
  renderHeader(): ByteVector {
    // Header: set the "this is a header" bit
    const headerFlags = this.flags | 0x20000000;
    return this.renderBlock(headerFlags);
  }

  private renderBlock(flagsValue: number): ByteVector {
    const result = new ByteVector();
    result.append(ApeFooter.FILE_IDENTIFIER);
    result.append(ByteVector.fromUInt(this.version, false));
    result.append(ByteVector.fromUInt(this.tagSize, false));
    result.append(ByteVector.fromUInt(this.itemCount, false));
    result.append(ByteVector.fromUInt(flagsValue, false));
    result.append(ByteVector.fromSize(8, 0)); // reserved
    return result;
  }
}

// =============================================================================
// APE key ↔ property name mapping
// =============================================================================

const APE_TO_PROPERTY: ReadonlyMap<string, string> = new Map([
  ["TITLE", "TITLE"],
  ["ARTIST", "ARTIST"],
  ["ALBUM", "ALBUM"],
  ["COMMENT", "COMMENT"],
  ["GENRE", "GENRE"],
  ["DATE", "DATE"],
  ["TRACKNUMBER", "TRACKNUMBER"],
  ["ALBUMARTIST", "ALBUMARTIST"],
  ["DISCNUMBER", "DISCNUMBER"],
  ["COMPOSER", "COMPOSER"],
  ["SUBTITLE", "SUBTITLE"],
  ["ISRC", "ISRC"],
  ["LABEL", "LABEL"],
  ["CONDUCTOR", "CONDUCTOR"],
  ["LYRICS", "LYRICS"],
  ["REMIXER", "REMIXER"],
  ["COMPILATION", "COMPILATION"],
  ["COPYRIGHT", "COPYRIGHT"],
  ["ENCODER", "ENCODER"],
]);

const PROPERTY_TO_APE: ReadonlyMap<string, string> = new Map(
  [...APE_TO_PROPERTY.entries()].map(([ape, prop]) => [prop, ape]),
);

// =============================================================================
// ApeTag
// =============================================================================

/**
 * APE (APEv2) tag implementation.
 */
export class ApeTag extends Tag {
  private _items: ApeItem[] = [];

  // ---------------------------------------------------------------------------
  // Tag abstract property implementations
  // ---------------------------------------------------------------------------

  get title(): string {
    return this.textValue("TITLE");
  }
  set title(v: string) {
    this.setTextValue("TITLE", v);
  }

  get artist(): string {
    return this.textValue("ARTIST");
  }
  set artist(v: string) {
    this.setTextValue("ARTIST", v);
  }

  get album(): string {
    return this.textValue("ALBUM");
  }
  set album(v: string) {
    this.setTextValue("ALBUM", v);
  }

  get comment(): string {
    return this.textValue("COMMENT");
  }
  set comment(v: string) {
    this.setTextValue("COMMENT", v);
  }

  get genre(): string {
    return this.textValue("GENRE");
  }
  set genre(v: string) {
    this.setTextValue("GENRE", v);
  }

  get year(): number {
    const s = this.textValue("DATE");
    return parseInt(s, 10) || 0;
  }
  set year(v: number) {
    this.setTextValue("DATE", v > 0 ? String(v) : "");
  }

  get track(): number {
    const s = this.textValue("TRACKNUMBER");
    return parseInt(s, 10) || 0;
  }
  set track(v: number) {
    this.setTextValue("TRACKNUMBER", v > 0 ? String(v) : "");
  }

  // ---------------------------------------------------------------------------
  // Read from stream
  // ---------------------------------------------------------------------------

  /**
   * Read an APE tag from the given stream. `offset` points to the start of
   * the 32-byte footer.
   */
  static readFrom(stream: IOStream, offset: offset_t): ApeTag {
    const tag = new ApeTag();

    stream.seek(offset, Position.Beginning);
    const footerData = stream.readBlock(ApeFooter.SIZE);
    const footer = ApeFooter.parse(footerData);
    if (!footer) return tag;

    // offset points to the footer start. tagSize includes the footer but not
    // the header, so items begin at (footer_start - tagSize + footer_size).
    const dataStart = offset - footer.tagSize + ApeFooter.SIZE;
    const dataSize = footer.tagSize - ApeFooter.SIZE;
    if (dataSize <= 0) return tag;

    stream.seek(dataStart, Position.Beginning);
    const itemData = stream.readBlock(dataSize);

    let pos = 0;
    for (let i = 0; i < footer.itemCount && pos < itemData.length; i++) {
      const result = ApeItem.parse(itemData, pos);
      if (!result) break;
      tag._items.push(result.item);
      pos += result.bytesUsed;
    }

    return tag;
  }

  // ---------------------------------------------------------------------------
  // Item access
  // ---------------------------------------------------------------------------

  get items(): ApeItem[] {
    return [...this._items];
  }

  /** Find an item by key (case-insensitive). */
  item(key: string): ApeItem | undefined {
    const upper = key.toUpperCase();
    return this._items.find((it) => it.key.toUpperCase() === upper);
  }

  /** Set (or replace) an item. Matching is case-insensitive by key. */
  setItem(item: ApeItem): void {
    const upper = item.key.toUpperCase();
    const idx = this._items.findIndex(
      (it) => it.key.toUpperCase() === upper,
    );
    if (idx >= 0) {
      this._items[idx] = item;
    } else {
      this._items.push(item);
    }
  }

  /** Remove an item by key (case-insensitive). */
  removeItem(key: string): void {
    const upper = key.toUpperCase();
    this._items = this._items.filter(
      (it) => it.key.toUpperCase() !== upper,
    );
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

  override properties(): PropertyMap {
    const map = new PropertyMap();
    for (const it of this._items) {
      if (it.type !== ApeItemType.Text) {
        map.addUnsupportedData(it.key);
        continue;
      }
      const propName = APE_TO_PROPERTY.get(it.key.toUpperCase());
      if (propName) {
        map.replace(propName, [...it.values]);
      } else {
        map.addUnsupportedData(it.key);
      }
    }
    return map;
  }

  override setProperties(props: PropertyMap): PropertyMap {
    const unsupported = new PropertyMap();

    // Remove items for any property keys being set
    for (const key of props.keys()) {
      const apeKey = PROPERTY_TO_APE.get(key);
      if (apeKey) {
        this.removeItem(apeKey);
      }
    }

    for (const [key, values] of props.entries()) {
      const apeKey = PROPERTY_TO_APE.get(key);
      if (!apeKey) {
        unsupported.replace(key, values);
        continue;
      }
      if (values.length === 0) {
        this.removeItem(apeKey);
      } else {
        const item = new ApeItem();
        item.key = apeKey;
        item.values = [...values];
        item.type = ApeItemType.Text;
        this.setItem(item);
      }
    }

    return unsupported;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Render the complete APE tag (header + items + footer).
   */
  render(): ByteVector {
    const itemData = new ByteVector();
    for (const it of this._items) {
      itemData.append(it.render());
    }

    const footer = new ApeFooter();
    footer.version = 2000;
    footer.itemCount = this._items.length;
    footer.tagSize = itemData.length + ApeFooter.SIZE;
    footer.flags = 0x80000000; // has header

    const result = new ByteVector();
    result.append(footer.renderHeader());
    result.append(itemData);
    result.append(footer.render());
    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private textValue(key: string): string {
    const it = this.item(key);
    if (!it || it.type !== ApeItemType.Text || it.values.length === 0) {
      return "";
    }
    return it.values[0];
  }

  private setTextValue(key: string, value: string): void {
    if (value === "") {
      this.removeItem(key);
      return;
    }
    const it = new ApeItem();
    it.key = key;
    it.values = [value];
    it.type = ApeItemType.Text;
    this.setItem(it);
  }
}
