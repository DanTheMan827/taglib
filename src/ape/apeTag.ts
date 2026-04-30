/** @packageDocumentation APEv2 tag implementation, including item, footer, and tag classes. */

import { ByteVector, StringType } from "../byteVector.js";
import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { IOStream } from "../toolkit/ioStream.js";
import type { offset_t } from "../toolkit/types.js";
import { Position } from "../toolkit/types.js";

// =============================================================================
// ApeItemType
// =============================================================================

/** Value type for an APE tag item. */
export enum ApeItemType {
  /** Item contains one or more UTF-8 text strings separated by null bytes. */
  Text = 0,
  /** Item contains raw binary data. */
  Binary = 1,
  /** Item contains a URI locator string. */
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
  /** Case-sensitive ASCII key identifying this item. */
  key: string = "";
  /** Decoded text values (for Text/Locator items). */
  values: string[] = [];
  /** Data type of this item's value. */
  type: ApeItemType = ApeItemType.Text;
  /** Whether this item is marked read-only in the tag. */
  readOnly: boolean = false;
  /** Raw binary payload (for Binary items). */
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

  /** Returns a human-readable representation of this item's value. */
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
  /** APEv2 format version (e.g. 2000 for APEv2). */
  version: number = 2000;
  /** Size in bytes of the tag data, including the footer but excluding the header. */
  tagSize: number = 0;
  /** Number of items stored in this tag. */
  itemCount: number = 0;
  /** Bit-field of tag flags (header presence, read-only, etc.). */
  flags: number = 0;

  static readonly SIZE = 32;
  static readonly FILE_IDENTIFIER: ByteVector = ByteVector.fromString(
    "APETAGEX",
    StringType.Latin1,
  );

  /** `true` if this 32-byte block represents a header rather than a footer. */
  get isHeader(): boolean {
    return (this.flags & 0x20000000) !== 0;
  }

  /** `true` if a 32-byte header precedes the tag items in the stream. */
  get hasHeader(): boolean {
    return (this.flags & 0x80000000) !== 0;
  }

  /** Total tag size including header (if present), items, and footer. */
  get completeTagSize(): number {
    return this.hasHeader ? this.tagSize + ApeFooter.SIZE : this.tagSize;
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

  /**
   * Render this footer/header block with the given flag overrides.
   *
   * @param flagsValue - The flags field to encode in the output block.
   * @returns A 32-byte `ByteVector`.
   */
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

/** Mapping from upper-cased APE item keys to standard property names. */
const APE_TO_PROPERTY: ReadonlyMap<string, string> = new Map([
  ["TITLE", "TITLE"],
  ["ARTIST", "ARTIST"],
  ["ALBUM", "ALBUM"],
  ["COMMENT", "COMMENT"],
  ["GENRE", "GENRE"],
  ["YEAR", "DATE"],
  ["DATE", "DATE"],
  ["TRACK", "TRACKNUMBER"],
  ["TRACKNUMBER", "TRACKNUMBER"],
  ["ALBUMARTIST", "ALBUMARTIST"],
  // C++ TagLib writes ALBUMARTIST as "ALBUM ARTIST" via setProperties(); accept both spellings.
  ["ALBUM ARTIST", "ALBUMARTIST"],
  ["DISCNUMBER", "DISCNUMBER"],
  // C++ TagLib writes DISCNUMBER as "DISC" via setProperties(); accept both spellings.
  ["DISC", "DISCNUMBER"],
  ["COMPOSER", "COMPOSER"],
  ["SUBTITLE", "SUBTITLE"],
  ["ISRC", "ISRC"],
  ["LABEL", "LABEL"],
  ["CONDUCTOR", "CONDUCTOR"],
  ["LYRICS", "LYRICS"],
  // C++ TagLib writes REMIXER as "MIXARTIST" via setProperties(); accept both spellings.
  ["REMIXER", "REMIXER"],
  ["MIXARTIST", "REMIXER"],
  ["COMPILATION", "COMPILATION"],
  ["COPYRIGHT", "COPYRIGHT"],
  ["ENCODER", "ENCODER"],
]);

/** Mapping from standard property names back to preferred APE item keys. */
const PROPERTY_TO_APE: ReadonlyMap<string, string> = new Map([
  ["TITLE", "TITLE"],
  ["ARTIST", "ARTIST"],
  ["ALBUM", "ALBUM"],
  ["COMMENT", "COMMENT"],
  ["GENRE", "GENRE"],
  ["DATE", "YEAR"],
  ["TRACKNUMBER", "TRACK"],
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

// =============================================================================
// ApeTag
// =============================================================================

/**
 * APE (APEv2) tag implementation.
 */
export class ApeTag extends Tag {
  /** Internal list of all APE items in tag order. */
  private _items: ApeItem[] = [];

  // ---------------------------------------------------------------------------
  // Tag abstract property implementations
  // ---------------------------------------------------------------------------

  /** Track title stored in the "TITLE" item. */
  get title(): string {
    return this.textValue("TITLE");
  }
  /** @param v - New title string; empty string removes the item. */
  set title(v: string) {
    this.setTextValue("TITLE", v);
  }

  /** Lead artist/performer stored in the "ARTIST" item. */
  get artist(): string {
    return this.textValue("ARTIST");
  }
  /** @param v - New artist string; empty string removes the item. */
  set artist(v: string) {
    this.setTextValue("ARTIST", v);
  }

  /** Album title stored in the "ALBUM" item. */
  get album(): string {
    return this.textValue("ALBUM");
  }
  /** @param v - New album string; empty string removes the item. */
  set album(v: string) {
    this.setTextValue("ALBUM", v);
  }

  /** User comment stored in the "COMMENT" item. */
  get comment(): string {
    return this.textValue("COMMENT");
  }
  /** @param v - New comment string; empty string removes the item. */
  set comment(v: string) {
    this.setTextValue("COMMENT", v);
  }

  /** Genre stored in the "GENRE" item. */
  get genre(): string {
    return this.textValue("GENRE");
  }
  /** @param v - New genre string; empty string removes the item. */
  set genre(v: string) {
    this.setTextValue("GENRE", v);
  }

  /**
   * Release year, read from the "YEAR" item (falling back to "DATE").
   * Returns `0` when not set.
   */
  get year(): number {
    const s = this.textValue("YEAR") || this.textValue("DATE");
    return parseInt(s, 10) || 0;
  }
  /**
   * @param v - Four-digit year, or `0` to remove the item.
   * Any pre-existing "DATE" alias item is also removed.
   */
  set year(v: number) {
    this.setTextValueExclusive("YEAR", v > 0 ? String(v) : "", "DATE");
  }

  /**
   * Track number, read from the "TRACK" item (falling back to "TRACKNUMBER").
   * Returns `0` when not set.
   */
  get track(): number {
    const s = this.textValue("TRACK") || this.textValue("TRACKNUMBER");
    return parseInt(s, 10) || 0;
  }
  /**
   * @param v - Track number, or `0` to remove the item.
   * Any pre-existing "TRACKNUMBER" alias item is also removed.
   */
  set track(v: number) {
    this.setTextValueExclusive("TRACK", v > 0 ? String(v) : "", "TRACKNUMBER");
  }

  /** An APE tag is empty when it contains no items. */
  override get isEmpty(): boolean {
    return this._items.length === 0;
  }

  // ---------------------------------------------------------------------------
  // Read from stream
  // ---------------------------------------------------------------------------

  /**
   * Asynchronously read an APE tag from the given stream. `offset` points to
   * the start of the 32-byte footer. Returns a `Promise<ApeTag>`.
   *
   * @param stream - The stream to read from.
   * @param offset - Byte offset of the 32-byte APE footer within `stream`.
   * @returns A resolved promise containing the populated tag (may be empty on
   *   parse failure).
   */
  static async readFrom(stream: IOStream, offset: offset_t): Promise<ApeTag> {
    const tag = new ApeTag();

    await stream.seek(offset, Position.Beginning);
    const footerData = await stream.readBlock(ApeFooter.SIZE);
    const footer = ApeFooter.parse(footerData);
    if (!footer) return tag;

    // offset points to the footer start. tagSize includes the footer but not
    // the header, so items begin at (footer_start - tagSize + footer_size).
    const dataStart = offset - footer.tagSize + ApeFooter.SIZE;
    const dataSize = footer.tagSize - ApeFooter.SIZE;
    if (dataSize <= 0) return tag;

    await stream.seek(dataStart, Position.Beginning);
    const itemData = await stream.readBlock(dataSize);

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

  /** A shallow copy of all items in this tag. */
  get items(): ApeItem[] {
    return [...this._items];
  }

  /**
   * Returns a map of item key (upper-cased) to item, mirroring the C++ `itemListMap()`.
   * @returns A `Map` from uppercased item key to the corresponding {@link ApeItem}.
   */
  itemListMap(): Map<string, ApeItem> {
    const map = new Map<string, ApeItem>();
    for (const item of this._items) {
      map.set(item.key.toUpperCase(), item);
    }
    return map;
  }

  /** Find an item by key (case-insensitive). */
  item(key: string): ApeItem | undefined {
    const upper = key.toUpperCase();
    return this._items.find(it => it.key.toUpperCase() === upper);
  }

  /** Set (or replace) an item. Matching is case-insensitive by key. */
  setItem(item: ApeItem): void {
    const upper = item.key.toUpperCase();
    const idx = this._items.findIndex(
      it => it.key.toUpperCase() === upper,
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
      it => it.key.toUpperCase() !== upper,
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
    // Sort items alphabetically by key (case-insensitive) to match C++ std::map ordering.
    const sorted = [...this._items].sort((a, b) =>
      a.key.toUpperCase().localeCompare(b.key.toUpperCase()),
    );
    for (const it of sorted) {
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

  /**
   * Return the first text value for `key`, or `""` when not present or not a
   * Text-type item.
   *
   * @param key - Upper-cased APE item key.
   */
  private textValue(key: string): string {
    const it = this.item(key);
    if (!it || it.type !== ApeItemType.Text || it.values.length === 0) {
      return "";
    }
    return it.values[0];
  }

  /**
   * Set `key` to a single text value, or remove the item when `value` is `""`.
   *
   * @param key - Upper-cased APE item key.
   * @param value - Value to store, or `""` to remove.
   */
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

  /**
   * Set a text value under `key`, simultaneously removing any legacy aliases
   * for the same field (e.g. replacing "DATE" when writing "YEAR").
   */
  private setTextValueExclusive(
    key: string,
    value: string,
    ...legacyKeys: string[]
  ): void {
    this.setTextValue(key, value);
    const upperLegacy = legacyKeys.map(k => k.toUpperCase());
    this._items = this._items.filter(
      i => !upperLegacy.includes(i.key.toUpperCase()),
    );
  }
}
