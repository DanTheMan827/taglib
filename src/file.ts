import { ByteVector } from "./byteVector.js";
import { type offset_t, Position } from "./toolkit/types.js";
import { IOStream } from "./toolkit/ioStream.js";
import type { Tag } from "./tag.js";
import type { AudioProperties } from "./audioProperties.js";
import { PropertyMap } from "./toolkit/propertyMap.js";
import type { VariantMap } from "./toolkit/variant.js";

/**
 * Abstract base class for file format implementations. Provides common
 * I/O helpers and delegates metadata access to the format-specific Tag
 * and AudioProperties objects.
 */
export abstract class File {
  protected _stream: IOStream;
  protected _valid: boolean = true;

  constructor(stream: IOStream) {
    this._stream = stream;
  }

  // ---------------------------------------------------------------------------
  // Abstract interface
  // ---------------------------------------------------------------------------

  get name(): string {
    return this._stream.name();
  }

  /** The underlying I/O stream used by this file. */
  stream(): IOStream {
    return this._stream;
  }

  abstract tag(): Tag | null;
  abstract audioProperties(): AudioProperties | null;
  abstract save(): boolean;

  // ---------------------------------------------------------------------------
  // PropertyMap delegation
  // ---------------------------------------------------------------------------

  properties(): PropertyMap {
    const t = this.tag();
    return t ? t.properties() : new PropertyMap();
  }

  setProperties(properties: PropertyMap): PropertyMap {
    const t = this.tag();
    return t ? t.setProperties(properties) : new PropertyMap();
  }

  removeUnsupportedProperties(properties: string[]): void {
    this.tag()?.removeUnsupportedProperties(properties);
  }

  complexPropertyKeys(): string[] {
    const t = this.tag();
    return t ? t.complexPropertyKeys() : [];
  }

  complexProperties(key: string): VariantMap[] {
    const t = this.tag();
    return t ? t.complexProperties(key) : [];
  }

  setComplexProperties(key: string, value: VariantMap[]): boolean {
    const t = this.tag();
    return t ? t.setComplexProperties(key, value) : false;
  }

  // ---------------------------------------------------------------------------
  // I/O delegation
  // ---------------------------------------------------------------------------

  readBlock(length: number): ByteVector {
    return this._stream.readBlock(length);
  }

  writeBlock(data: ByteVector): void {
    this._stream.writeBlock(data);
  }

  insert(data: ByteVector, start: offset_t = 0, replace: number = 0): void {
    this._stream.insert(data, start, replace);
  }

  removeBlock(start: offset_t = 0, length: number = 0): void {
    this._stream.removeBlock(start, length);
  }

  get readOnly(): boolean {
    return this._stream.readOnly();
  }

  get isOpen(): boolean {
    return this._stream.isOpen();
  }

  get isValid(): boolean {
    return this._valid;
  }

  seek(offset: offset_t, position: Position = Position.Beginning): void {
    this._stream.seek(offset, position);
  }

  clear(): void {
    this._stream.clear();
  }

  tell(): offset_t {
    return this._stream.tell();
  }

  get fileLength(): number {
    return this._stream.length();
  }

  truncate(length: offset_t): void {
    this._stream.truncate(length);
  }

  // ---------------------------------------------------------------------------
  // Pattern search
  // ---------------------------------------------------------------------------

  /**
   * Search the stream forward for `pattern` starting at `fromOffset`.
   * If `before` is provided, searching stops when `before` is encountered.
   * Returns the byte offset of the first match, or -1 if not found.
   */
  find(
    pattern: ByteVector,
    fromOffset: offset_t = 0,
    before?: ByteVector,
  ): offset_t {
    if (pattern.length === 0 || pattern.length > File.bufferSize()) {
      return -1;
    }

    const originalPos = this._stream.tell();
    const fileLen = this._stream.length();

    if (fromOffset < 0) {
      fromOffset = 0;
    }
    if (fromOffset >= fileLen) {
      return -1;
    }

    this._stream.seek(fromOffset);
    const chunkSize = File.bufferSize();

    // Keep previous partial-match tail to handle patterns spanning chunks
    let previousPartial = new ByteVector();
    let absoluteOffset = fromOffset;

    while (absoluteOffset < fileLen) {
      const block = this._stream.readBlock(chunkSize);
      if (block.length === 0) break;

      // Combine previous tail with current block for cross-boundary matches
      const combined = ByteVector.fromByteVector(previousPartial);
      combined.append(block);

      // Search for `before` in the combined buffer
      if (before && before.length > 0) {
        const beforeIdx = combined.find(before);
        if (beforeIdx >= 0) {
          // Only search up to where `before` was found
          const limited = combined.mid(0, beforeIdx);
          const idx = limited.find(pattern);
          if (idx >= 0) {
            this._stream.seek(originalPos);
            return absoluteOffset - previousPartial.length + idx;
          }
          this._stream.seek(originalPos);
          return -1;
        }
      }

      const idx = combined.find(pattern);
      if (idx >= 0) {
        this._stream.seek(originalPos);
        return absoluteOffset - previousPartial.length + idx;
      }

      // Retain the last (pattern.length - 1) bytes for cross-boundary matching
      const tailLen = Math.min(pattern.length - 1, combined.length);
      previousPartial = combined.mid(combined.length - tailLen, tailLen);
      absoluteOffset += block.length;
    }

    this._stream.seek(originalPos);
    return -1;
  }

  /**
   * Search the stream backward for `pattern` starting at `fromOffset`
   * (default: end of file). If `before` is provided, searching stops when
   * `before` is encountered. Returns the byte offset of the match, or -1.
   */
  rfind(
    pattern: ByteVector,
    fromOffset: offset_t = 0,
    before?: ByteVector,
  ): offset_t {
    if (pattern.length === 0 || pattern.length > File.bufferSize()) {
      return -1;
    }

    const originalPos = this._stream.tell();
    const fileLen = this._stream.length();

    if (fileLen === 0) {
      return -1;
    }

    // fromOffset === 0 means "search from the very end"
    let end = fromOffset > 0 && fromOffset < fileLen
      ? Math.min(fromOffset + pattern.length, fileLen)
      : fileLen;
    const chunkSize = File.bufferSize();

    let nextPartial = new ByteVector();

    while (end > 0) {
      const start = Math.max(0, end - chunkSize);
      const readLen = end - start;

      this._stream.seek(start);
      const block = this._stream.readBlock(readLen);
      if (block.length === 0) break;

      // Combine block with the start of the next chunk for boundary matching
      const combined = ByteVector.fromByteVector(block);
      combined.append(nextPartial);

      // If `before` appears in this chunk, limit search
      if (before && before.length > 0) {
        const beforeIdx = combined.rfind(before);
        if (beforeIdx >= 0) {
          // Search only after the `before` pattern
          const afterBefore = combined.mid(beforeIdx + before.length);
          const idx = afterBefore.rfind(pattern);
          if (idx >= 0) {
            this._stream.seek(originalPos);
            return start + beforeIdx + before.length + idx;
          }
          this._stream.seek(originalPos);
          return -1;
        }
      }

      const idx = combined.rfind(pattern);
      if (idx >= 0) {
        this._stream.seek(originalPos);
        return start + idx;
      }

      // Keep the first (pattern.length - 1) bytes for cross-boundary matching
      const headLen = Math.min(pattern.length - 1, combined.length);
      nextPartial = combined.mid(0, headLen);
      end = start;
    }

    this._stream.seek(originalPos);
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  static bufferSize(): number {
    return 1024;
  }
}
