/** @packageDocumentation Matroska/WebM file format handler. */
import { File } from "../file.js";
import { IOStream } from "../toolkit/ioStream.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { VariantMap } from "../toolkit/variant.js";
import { Variant } from "../toolkit/variant.js";
import { ByteVector } from "../byteVector.js";
import { MatroskaTag, type AttachedFile } from "./matroskaTag.js";
import { MatroskaProperties } from "./matroskaProperties.js";
import { MatroskaChapters } from "./matroskaChapters.js";
import {
  EbmlId,
  idSize,
  readElement,
  readElementId,
  skipElement,
  findElement,
  readChildElements,
  readUintValue,
  readFloatValue,
  readStringValue,
  renderVoidElement,
  encodeId,
  encodeVint,
  combineByteVectors,
  renderEbmlElement,
  renderUintElement,
  type EbmlElement,
} from "./ebml/ebmlElement.js";

/**
 * Returns the complex property key corresponding to an attached file.
 * @param af - The attached file.
 * @returns `"PICTURE"` for images, fileName if set, mediaType if set, otherwise uid as string.
 */
function keyForAttachedFile(af: AttachedFile): string {
  if (af.mediaType.startsWith("image/")) return "PICTURE";
  if (af.fileName) return af.fileName;
  if (af.mediaType) return af.mediaType;
  return af.uid ? String(af.uid) : "";
}

/**
 * Returns `true` if the given key matches the attached file.
 * @param key - The complex property key.
 * @param af - The attached file.
 */
function keyMatchesAttachedFile(key: string, af: AttachedFile): boolean {
  if (!key) return false;
  return (
    (key === "PICTURE" && af.mediaType.startsWith("image/")) ||
    key === af.fileName ||
    key === af.mediaType ||
    (af.uid !== 0 && key === String(af.uid))
  );
}

/**
 * Generate a random 64-bit attachment UID (as a number, may lose precision for large values).
 * Mimics TagLib's random UID generation.
 */
function generateAttachmentUid(): number {
  // Use crypto random bytes to generate a non-zero UID
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  // Combine two 32-bit values into a safe integer range (lower 53 bits)
  const hi = arr[0] & 0x1FFFFF; // 21 bits
  const lo = arr[1] >>> 0;       // 32 bits
  return hi * 0x100000000 + lo || 1;
}

/**
 * An implementation of TagLib::File for Matroska containers
 * (MKV, MKA, WebM).
 */
export class MatroskaFile extends File {
  /** The Matroska tag for this file, or `null` if not yet parsed. */
  private _tag: MatroskaTag | null = null;
  /** Audio properties for this file, or `null` if not yet parsed. */
  private _properties: MatroskaProperties | null = null;
  /** Read style used during parsing, retained for lazy property construction. */
  private _readStyle: ReadStyle;

  // Element locations saved during read, used during save
  /** The parsed Tags EBML element, or `null` if absent. */
  private _tagsEl: EbmlElement | null = null;
  /** The parsed Attachments EBML element, or `null` if absent. */
  private _attachmentsEl: EbmlElement | null = null;
  /** The parsed chapters, or `null` if absent. */
  private _chapters: MatroskaChapters | null = null;
  /** The parsed Chapters EBML element, or `null` if absent. */
  private _chaptersEl: EbmlElement | null = null;
  // Segment size VINT location: byte offset right after the segment ID
  /** Byte offset of the segment size VINT, or -1 if unknown. */
  private _segmentSizeVintOffset: number = -1;
  /** Byte length of the segment size VINT encoding. */
  private _segmentSizeVintLength: number = 0;
  /** Absolute byte offset of the segment data start (after Segment ID + size VINT). */
  private _segmentDataOffset: number = -1;
  /**
   * The SeekHead element parsed from the file, or `null` if absent.
   * Used to add new SeekEntries when Tags/Attachments are appended.
   */
  private _seekHeadEl: EbmlElement | null = null;
  /**
   * The Void element that immediately follows the SeekHead (pre-allocated padding),
   * or `null` if absent.  This space is available for expanding the SeekHead.
   */
  private _voidAfterSeekHeadEl: EbmlElement | null = null;

  /**
   * Private constructor — use {@link MatroskaFile.open} instead.
   * @param stream - The underlying I/O stream.
   * @param readStyle - Detail level for audio property parsing.
   */
  private constructor(stream: IOStream, readStyle: ReadStyle = ReadStyle.Average) {
    super(stream);
    this._readStyle = readStyle;
  }

  /**
   * Open and parse a Matroska file.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Detail level for audio property parsing.
   * @returns A fully initialized {@link MatroskaFile} instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<MatroskaFile> {
    const f = new MatroskaFile(stream, readStyle);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  /** Returns the Matroska tag, or `null` if not present. */
  tag(): MatroskaTag | null {
    return this._tag;
  }

  /**
   * Returns the chapters object, optionally creating it if not present.
   * @param create - If `true`, creates an empty chapters object when absent.
   * @returns The chapters object, or `null` if absent and `create` is `false`.
   */
  chapters(create: boolean = false): MatroskaChapters | null {
    if (!this._chapters && create) {
      this._chapters = new MatroskaChapters();
    }
    return this._chapters;
  }

  /** Returns the audio properties, or `null` if not parsed. */
  audioProperties(): MatroskaProperties | null {
    return this._properties;
  }

  /**
   * Write the current tag and attachments back to the file.
   * @returns `true` on success, `false` if the file is read-only or invalid.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) {
      return false;
    }

    if (!this._valid) {
      return false;
    }

    // Create empty tag if needed (so we can always serialize)
    if (!this._tag) {
      this._tag = new MatroskaTag();
    }

    // Render the new Tags element (null if empty)
    const newTagsData = this._tag.renderTags();
    const newAttachmentsData = this._tag.renderAttachments();
    const newChaptersData = this._chapters?.renderChapters() ?? null;

    // Replace or insert Tags element
    const tagsOk = await this.replaceOrInsertElement(
      this._tagsEl,
      newTagsData,
      EbmlId.Tags,
    );

    // Replace or insert Attachments element
    const attachOk = await this.replaceOrInsertElement(
      this._attachmentsEl,
      newAttachmentsData,
      EbmlId.Attachments,
    );

    // Replace or insert Chapters element
    const chaptersOk = await this.replaceOrInsertElement(
      this._chaptersEl,
      newChaptersData,
      EbmlId.Chapters,
    );

    return tagsOk && attachOk && chaptersOk;
  }

  /**
   * Replace an existing EBML element with new data, or insert at end of segment.
   * Uses Void elements to fill any leftover space if the new data is smaller.
   */
  private async replaceOrInsertElement(
    existing: EbmlElement | null,
    newData: ByteVector | null,
    elementId: number,
  ): Promise<boolean> {
    if (!newData || newData.length === 0) {
      // If empty and no existing element, nothing to do
      if (!existing) return true;

      await this.removeSeekHeadEntry(elementId);

      // If the element is at the end of the file, truncate instead of voiding.
      // This allows save→clear to restore the file to its pre-write state (C++ parity).
      const elementEnd = existing.offset + existing.headSize + existing.dataSize;
      const fileLength = await this._stream.length();
      if (elementEnd >= fileLength) {
        await this._stream.truncate(existing.offset);
        // Shrink the segment size VINT to reflect the truncation
        if (this._segmentSizeVintOffset >= 0 && this._segmentSizeVintLength > 0
            && this._segmentDataOffset >= 0) {
          const newSegmentDataSize = existing.offset - this._segmentDataOffset;
          const newSizeVint = encodeVint(newSegmentDataSize, this._segmentSizeVintLength);
          if (newSizeVint.length === this._segmentSizeVintLength) {
            await this._stream.seek(this._segmentSizeVintOffset, Position.Beginning);
            await this._stream.writeBlock(newSizeVint);
          }
        }
        return true;
      }

      // Otherwise replace with Void
      const voidEl = renderVoidElement(existing.headSize + existing.dataSize);
      await this._stream.seek(existing.offset, Position.Beginning);
      await this._stream.writeBlock(voidEl);
      return true;
    }

    if (existing) {
      const oldTotalSize = existing.headSize + existing.dataSize;
      const newTotalSize = newData.length;

      if (newTotalSize <= oldTotalSize) {
        // Write new element in place, pad with Void if needed
        await this._stream.seek(existing.offset, Position.Beginning);
        await this._stream.writeBlock(newData);
        const leftover = oldTotalSize - newTotalSize;
        if (leftover >= 2) {
          // Write a Void element to fill the gap
          const voidEl = renderVoidElement(leftover);
          await this._stream.writeBlock(voidEl);
        } else if (leftover === 1) {
          // 1 byte gap: write a null byte (absorbed by surrounding elements)
          await this._stream.writeBlock(new ByteVector(new Uint8Array([0x00])));
        }
        return true;
      } else {
        // New element is larger than existing.
        const existingEnd = existing.offset + oldTotalSize;
        const fileLength = await this._stream.length();
        if (existingEnd >= fileLength) {
          // Existing element is at EOF — overwrite in place and extend the file.
          // The offset stays the same so no SeekHead update is needed.
          await this._stream.seek(existing.offset, Position.Beginning);
          await this._stream.writeBlock(newData);
          // Update segment size
          if (this._segmentSizeVintOffset >= 0 && this._segmentSizeVintLength > 0
              && this._segmentDataOffset >= 0) {
            const newSegmentDataSize = existing.offset + newData.length - this._segmentDataOffset;
            const newSizeVint = encodeVint(newSegmentDataSize, this._segmentSizeVintLength);
            if (newSizeVint.length === this._segmentSizeVintLength) {
              await this._stream.seek(this._segmentSizeVintOffset, Position.Beginning);
              await this._stream.writeBlock(newSizeVint);
            }
          }
        } else {
          // Existing element is not at EOF — replace with Void, append new at EOF
          const voidEl = renderVoidElement(oldTotalSize);
          await this._stream.seek(existing.offset, Position.Beginning);
          await this._stream.writeBlock(voidEl);
          await this.appendAtEndOfSegment(newData, elementId);
        }
        return true;
      }
    } else {
      // No existing element — append at end of segment
      await this.appendAtEndOfSegment(newData, elementId);
      return true;
    }
  }

  /**
   * Render a Void element using the same size-VINT strategy as C++ TagLib's
   * VoidElement::renderSize(): sizeLength = min(totalSize - 1, 8), meaning
   * large Voids always use an 8-byte size VINT (matching the on-disk format).
   */
  private renderTaglibCompatVoidElement(totalSize: number): ByteVector {
    if (totalSize < 1) return new ByteVector(new Uint8Array(0));
    const idByte = new ByteVector(new Uint8Array([0xEC]));
    if (totalSize === 1) return idByte;
    const bytesNeeded = totalSize - 1; // bytes after the 1-byte ID
    const sizeLength = Math.min(bytesNeeded, 8);
    const dataSize = bytesNeeded - sizeLength;
    const vint = encodeVint(dataSize, sizeLength);
    const padding = new ByteVector(new Uint8Array(dataSize));
    return combineByteVectors([idByte, vint, padding]);
  }

  /**
   * Update the SeekHead in-place to include (or replace) an entry for the given
   * element ID at the given segment-relative offset.  Uses the Void element
   * immediately after the SeekHead as padding buffer.  If the new SeekHead would
   * exceed the combined SeekHead + Void space, the update is silently skipped.
   */
  private async updateSeekHeadEntry(elementId: number, relativeOffset: number): Promise<void> {
    await this._modifySeekHeadEntry(elementId, relativeOffset);
  }

  /**
   * Remove an element's entry from the SeekHead in-place.
   * Called when an element is voided out and no longer exists in the file.
   * @param elementId - The EBML element ID to remove from the SeekHead.
   */
  private async removeSeekHeadEntry(elementId: number): Promise<void> {
    await this._modifySeekHeadEntry(elementId, null);
  }

  /**
   * Internal helper: re-read the SeekHead, add/update or remove an entry for
   * `elementId`, and write the updated SeekHead back to the stream.
   * @param elementId - The EBML element ID to modify.
   * @param relativeOffset - New relative offset to set, or `null` to remove the entry.
   */
  private async _modifySeekHeadEntry(elementId: number, relativeOffset: number | null): Promise<void> {
    if (!this._seekHeadEl) return;

    // Re-parse the existing SeekHead entries from the stream
    const seekDataOffset = this._seekHeadEl.offset + this._seekHeadEl.headSize;
    const children = await readChildElements(this._stream, seekDataOffset, this._seekHeadEl.dataSize);

    const entries = new Map<number, number>(); // elementId → relativeOffset
    for (const child of children) {
      if (child.id === EbmlId.Seek) {
        const seekChildren = await readChildElements(
          this._stream, child.offset + child.headSize, child.dataSize,
        );
        let seekId = 0, seekPos = 0;
        for (const sc of seekChildren) {
          if (sc.id === EbmlId.SeekID) seekId = await readUintValue(this._stream, sc);
          if (sc.id === EbmlId.SeekPosition) seekPos = await readUintValue(this._stream, sc);
        }
        if (seekId) entries.set(seekId, seekPos);
      }
    }

    // Add/update or remove the entry
    if (relativeOffset !== null) {
      entries.set(elementId, relativeOffset);
    } else {
      entries.delete(elementId);
    }
    const sortedEntries = [...entries.entries()].sort((a, b) => a[1] - b[1]);

    // Render each Seek element: SeekID (binary element ID) + SeekPosition (uint)
    const seekElements = sortedEntries.map(([id, pos]) => renderEbmlElement(
      EbmlId.Seek,
      combineByteVectors([
        renderEbmlElement(EbmlId.SeekID, encodeId(id)),
        renderUintElement(EbmlId.SeekPosition, pos),
      ]),
    ));
    const newSeekHeadData = combineByteVectors(seekElements);

    // Compute new SeekHead total size
    const newSeekHeadIdSize = idSize(EbmlId.SeekHead); // 4 bytes
    const newSeekHeadSizeVint = encodeVint(newSeekHeadData.length);
    const newSeekHeadTotal = newSeekHeadIdSize + newSeekHeadSizeVint.length + newSeekHeadData.length;

    // Available space = old SeekHead + Void padding immediately after it
    const oldSeekHeadTotal = this._seekHeadEl.headSize + this._seekHeadEl.dataSize;
    const oldVoidTotal = this._voidAfterSeekHeadEl
      ? this._voidAfterSeekHeadEl.headSize + this._voidAfterSeekHeadEl.dataSize
      : 0;
    const totalAvailable = oldSeekHeadTotal + oldVoidTotal;

    if (newSeekHeadTotal > totalAvailable) {
      // Not enough space in the SeekHead + Void area — the new element will still
      // be appended but the SeekHead will not reference it.
      return;
    }

    // Write new SeekHead
    await this._stream.seek(this._seekHeadEl.offset, Position.Beginning);
    await this._stream.writeBlock(combineByteVectors([
      encodeId(EbmlId.SeekHead),
      newSeekHeadSizeVint,
      newSeekHeadData,
    ]));

    // Update the in-memory SeekHead element descriptor to reflect the new size
    // (so the next call to updateSeekHeadEntry reads the correct number of bytes)
    const newSeekHeadHeadSize = newSeekHeadIdSize + newSeekHeadSizeVint.length;
    this._seekHeadEl = {
      id: EbmlId.SeekHead,
      dataSize: newSeekHeadData.length,
      headSize: newSeekHeadHeadSize,
      offset: this._seekHeadEl.offset,
    };

    // Fill remaining space with a C++-compatible Void element
    const remaining = totalAvailable - newSeekHeadTotal;
    if (remaining >= 1) {
      const voidEl = this.renderTaglibCompatVoidElement(remaining);
      await this._stream.writeBlock(voidEl);
      // Compute the head size of the void element to update _voidAfterSeekHeadEl
      const voidIdSize = 1; // 0xEC is 1-byte ID
      const voidSizeVintLength = Math.min(remaining - voidIdSize, 8);
      const voidDataSize = remaining - voidIdSize - voidSizeVintLength;
      this._voidAfterSeekHeadEl = {
        id: EbmlId.VoidElement,
        dataSize: voidDataSize,
        headSize: voidIdSize + voidSizeVintLength,
        offset: this._seekHeadEl.offset + newSeekHeadHeadSize + newSeekHeadData.length,
      };
    } else {
      this._voidAfterSeekHeadEl = null;
    }
  }

  /**
   * Append data at the end of the segment.
   * Updates the segment size VINT to the exact new size (matching C++ TagLib's
   * Segment::render() which uses renderVINT(newDataSize, sizeLength)).
   * Also updates the SeekHead to include the new element's position.
   */
  private async appendAtEndOfSegment(data: ByteVector, elementId?: number): Promise<void> {
    // Determine the absolute offset where the new element will be placed
    await this._stream.seek(0, Position.End);
    const newElementAbsoluteOffset = await this._stream.tell();

    // Update the segment size VINT with the exact new segment data size
    const canUpdateSegmentSize = this._segmentSizeVintOffset >= 0
      && this._segmentSizeVintLength > 0
      && this._segmentDataOffset >= 0;
    if (canUpdateSegmentSize) {
      const oldSegmentDataSize = newElementAbsoluteOffset - this._segmentDataOffset;
      const newSegmentDataSize = oldSegmentDataSize + data.length;
      const newSizeVint = encodeVint(newSegmentDataSize, this._segmentSizeVintLength);
      // Only write the size VINT if it fits in the original allocated space.
      // If the new size requires more bytes, skip the update to avoid overwriting
      // the first byte(s) of segment content.
      if (newSizeVint.length === this._segmentSizeVintLength) {
        await this._stream.seek(this._segmentSizeVintOffset, Position.Beginning);
        await this._stream.writeBlock(newSizeVint);
      }
    }

    // Update the SeekHead to point to the new element
    if (elementId !== undefined && this._seekHeadEl && this._segmentDataOffset >= 0) {
      const relativeOffset = newElementAbsoluteOffset - this._segmentDataOffset;
      await this.updateSeekHeadEntry(elementId, relativeOffset);
    }

    // Append the new element at end of file
    await this._stream.seek(0, Position.End);
    await this._stream.writeBlock(data);
  }

  /** Returns the tag's PropertyMap, or an empty map if no tag exists. */
  override properties(): PropertyMap {
    return this._tag?.properties() ?? new PropertyMap();
  }

  /**
   * Set tag properties from a PropertyMap.
   * @param properties - The properties to apply.
   * @returns A map of properties that could not be set.
   */
  override setProperties(properties: PropertyMap): PropertyMap {
    if (!this._tag) {
      this._tag = new MatroskaTag();
    }
    return this._tag.setProperties(properties);
  }

  /**
   * Remove unsupported properties from the tag.
   * @param properties - Property keys to remove.
   */
  override removeUnsupportedProperties(properties: string[]): void {
    this._tag?.removeUnsupportedProperties(properties);
  }

  /** Returns the list of supported complex property keys (e.g. `"PICTURE"`). */
  override complexPropertyKeys(): string[] {
    // Start with complex simple-tag keys from the tag
    const keys = this._tag?.complexPropertyKeys() ?? [];
    // Add attachment keys
    const attachedFiles = this._tag?.attachedFiles ?? [];
    for (const af of attachedFiles) {
      const k = keyForAttachedFile(af);
      if (k && !keys.includes(k)) {
        keys.push(k);
      }
    }
    // Add CHAPTERS if present
    if (this._chapters && !this._chapters.isEmpty() && !keys.includes("CHAPTERS")) {
      keys.push("CHAPTERS");
    }
    return keys;
  }

  /**
   * Returns complex property values for the given key.
   * @param key - The complex property key (e.g. `"PICTURE"`).
   * @returns An array of variant maps, one per complex property value.
   */
  override complexProperties(key: string): VariantMap[] {
    if (key.toUpperCase() === "CHAPTERS") {
      return this._chapters?.toComplexProperties() ?? [];
    }
    // Check if any attachments match this key
    const attachedFiles = this._tag?.attachedFiles ?? [];
    const matchingFiles = attachedFiles.filter(af => keyMatchesAttachedFile(key, af));
    if (matchingFiles.length > 0) {
      return matchingFiles.map(af => {
        const m: VariantMap = new Map();
        m.set("data", Variant.fromByteVector(af.data));
        m.set("mimeType", Variant.fromString(af.mediaType));
        m.set("description", Variant.fromString(af.description));
        m.set("fileName", Variant.fromString(af.fileName));
        m.set("uid", Variant.fromULongLong(BigInt(af.uid)));
        return m;
      });
    }
    return this._tag?.complexProperties(key) ?? [];
  }

  /**
   * Set complex property values for the given key.
   * @param key - The complex property key (e.g. `"PICTURE"`).
   * @param value - An array of variant maps to set.
   * @returns `true` if the key was handled, `false` otherwise.
   */
  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    if (key.toUpperCase() === "CHAPTERS") {
      if (value.length === 0) {
        this._chapters = null;
      } else {
        if (!this._chapters) {
          this._chapters = new MatroskaChapters();
        }
        this._chapters.fromComplexProperties(value);
      }
      return true;
    }

    if (!this._tag) {
      this._tag = new MatroskaTag();
    }

    // Try complex simple-tag handling first (DURATION with trackUid, etc.)
    if (this._tag.setComplexProperties(key, value)) {
      return true;
    }

    // Handle attachment-typed complex properties (PICTURE, file.ttf, font/ttf, etc.)
    // Remove existing attached files matching this key
    this._tag.attachedFiles = this._tag.attachedFiles.filter(
      af => !keyMatchesAttachedFile(key, af),
    );

    for (const m of value) {
      if (m.size === 0) continue;
      let mimeType = m.get("mimeType")?.toString() ?? "";
      const data = m.get("data")?.toByteVector() ?? new ByteVector(new Uint8Array(0));
      let fileName = m.get("fileName")?.toString() ?? "";
      let uid = Number(m.get("uid")?.toLongLong() ?? 0n);
      const description = m.get("description")?.toString() ?? "";

      if (key.toUpperCase() === "PICTURE" && !mimeType.startsWith("image/")) {
        // Guess mime type from data
        const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        const isPng = pngMagic.every((b, i) => data.get(i) === b);
        mimeType = isPng ? "image/png" : "image/jpeg";
      } else if (!mimeType && key.includes("/")) {
        mimeType = key;
      } else if (!fileName && key.includes(".")) {
        fileName = key;
      }

      if (!uid) {
        uid = generateAttachmentUid();
      }

      if (!fileName && mimeType) {
        const slashPos = mimeType.lastIndexOf("/");
        let ext = slashPos >= 0 ? mimeType.slice(slashPos + 1) : mimeType;
        if (ext === "jpeg") ext = "jpg";
        fileName = `attachment.${ext}`;
      }

      if (mimeType && fileName) {
        this._tag.attachedFiles.push({ description, fileName, mediaType: mimeType, data, uid });
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse the EBML/Matroska structure from the stream.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Detail level for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    const fileLength = await this.fileLength();
    await this._stream.seek(0, Position.Beginning);

    // Read EBML header element
    const header = await readElement(this._stream);
    if (!header || header.id !== EbmlId.EBMLHeader) {
      this._valid = false;
      return;
    }

    // Parse EBML header children for DocType info
    let docType = "";
    let docTypeVersion = 0;
    if (readProperties) {
      const headerChildren = await readChildElements(
        this._stream,
        header.offset + header.headSize,
        header.dataSize,
      );
      for (const child of headerChildren) {
        switch (child.id) {
          case EbmlId.DocType:
            docType = await readStringValue(this._stream, child);
            break;
          case EbmlId.DocTypeVersion:
            docTypeVersion = await readUintValue(this._stream, child);
            break;
        }
      }
    }

    // Skip past header to find Segment
    await this._stream.seek(header.offset + header.headSize + header.dataSize, Position.Beginning);

    // Find the Segment element
    const segment = await findElement(this._stream, EbmlId.Segment, fileLength);
    if (!segment) {
      this._valid = false;
      return;
    }

    // Track where the segment size VINT is stored (for updating when we grow the file)
    this._segmentSizeVintOffset = segment.offset + idSize(EbmlId.Segment);
    this._segmentSizeVintLength = segment.headSize - idSize(EbmlId.Segment);

    const segmentDataOffset = segment.offset + segment.headSize;
    this._segmentDataOffset = segmentDataOffset;
    // Segment may have "unknown" EBML size (all 1-bits); use fileLength as cap
    const segmentEnd = Math.min(segmentDataOffset + segment.dataSize, fileLength);

    // Parse segment children, using SeekHead to find major elements
    await this._stream.seek(segmentDataOffset, Position.Beginning);

    // Collect positions of major elements from SeekHead
    const elementPositions = new Map<number, number>();

    // Limit initial linear scan: 512 KB for Fast mode, full segment otherwise
    const FAST_SCAN_LIMIT = 512 * 1024;
    const maxScanLimit = readStyle === ReadStyle.Fast ? FAST_SCAN_LIMIT : segment.dataSize;
    const maxScanOffset = Math.min(segmentEnd, segmentDataOffset + maxScanLimit);
    let seekHeadFound = false;

    while ((await this._stream.tell()) < maxScanOffset) {
      const el = await readElement(this._stream);
      if (!el) break;

      if (el.id === EbmlId.SeekHead) {
        this._seekHeadEl = el;
        await this.parseSeekHead(segmentDataOffset, el, elementPositions);
        // Check if the element immediately after SeekHead is a Void (SeekHead padding)
        const afterSeekHead = el.offset + el.headSize + el.dataSize;
        await this._stream.seek(afterSeekHead, Position.Beginning);
        const maybeVoid = await readElement(this._stream);
        if (maybeVoid && maybeVoid.id === EbmlId.VoidElement) {
          this._voidAfterSeekHeadEl = maybeVoid;
        }
        // SeekHead found: use its entries to locate elements directly, stop linear scan
        seekHeadFound = true;
        break;
      }

      // Process elements we encounter directly (no SeekHead: linear scan)
      if (el.id === EbmlId.Tags || el.id === EbmlId.Tracks ||
          el.id === EbmlId.Info || el.id === EbmlId.Attachments ||
          el.id === EbmlId.Chapters) {
        elementPositions.set(el.id, el.offset);
      }

      await skipElement(this._stream, el);
    }

    // If no SeekHead was found, do a fallback full-segment scan for missing elements.
    // (When a SeekHead is present we trust its entries and do not scan further.)
    if (!seekHeadFound &&
        (!elementPositions.has(EbmlId.Tags) || !elementPositions.has(EbmlId.Attachments))) {
      const scanFrom = await this._stream.tell();
      await this._stream.seek(scanFrom, Position.Beginning);
      while ((await this._stream.tell()) < segmentEnd) {
        const el = await readElement(this._stream);
        if (!el) break;
        if (el.id === EbmlId.Tags || el.id === EbmlId.Attachments ||
            el.id === EbmlId.Chapters) {
          elementPositions.set(el.id, el.offset);
        }
        await skipElement(this._stream, el);
      }
    }

    // Parse Info
    const infoOffset = elementPositions.get(EbmlId.Info);
    if (infoOffset !== undefined && readProperties) {
      await this._stream.seek(infoOffset, Position.Beginning);
      const infoEl = await readElement(this._stream);
      if (infoEl && infoEl.id === EbmlId.Info) {
        await this.parseInfo(infoEl, readProperties);
      }
    }

    // Parse Tracks
    const tracksOffset = elementPositions.get(EbmlId.Tracks);
    if (tracksOffset !== undefined && readProperties) {
      await this._stream.seek(tracksOffset, Position.Beginning);
      const tracksEl = await readElement(this._stream);
      if (tracksEl && tracksEl.id === EbmlId.Tracks) {
        await this.parseTracks(tracksEl);
      }
    }

    // Parse Tags
    const tagsOffset = elementPositions.get(EbmlId.Tags);
    if (tagsOffset !== undefined) {
      await this._stream.seek(tagsOffset, Position.Beginning);
      const tagsEl = await readElement(this._stream);
      if (tagsEl && tagsEl.id === EbmlId.Tags) {
        this._tagsEl = tagsEl;
        this._tag = await MatroskaTag.parseFromStream(this._stream, tagsEl);
      }
    }

    // Parse Attachments
    const attachmentsOffset = elementPositions.get(EbmlId.Attachments);
    if (attachmentsOffset !== undefined) {
      await this._stream.seek(attachmentsOffset, Position.Beginning);
      const attachmentsEl = await readElement(this._stream);
      if (attachmentsEl && attachmentsEl.id === EbmlId.Attachments) {
        this._attachmentsEl = attachmentsEl;
        if (!this._tag) this._tag = new MatroskaTag();
        await this._tag.parseAttachments(this._stream, attachmentsEl);
      }
    }

    // Parse Chapters
    const chaptersOffset = elementPositions.get(EbmlId.Chapters);
    if (chaptersOffset !== undefined) {
      await this._stream.seek(chaptersOffset, Position.Beginning);
      const chaptersEl = await readElement(this._stream);
      if (chaptersEl && chaptersEl.id === EbmlId.Chapters) {
        this._chaptersEl = chaptersEl;
        this._chapters = await MatroskaChapters.parseFromStream(this._stream, chaptersEl);
        if (this._chapters.isEmpty()) {
          this._chapters = null;
        }
      }
    }

    // Set properties
    if (readProperties) {
      if (!this._properties) {
        this._properties = new MatroskaProperties(readStyle);
      }
      this._properties.setDocType(docType);
      this._properties.setDocTypeVersion(docTypeVersion);
      this._properties.setFileLength(fileLength);

      if (this._tag) {
        this._tag.segmentTitle = this._properties.title;
      }
    }

    // Ensure a tag object always exists (even if empty)
    if (!this._tag) {
      this._tag = new MatroskaTag();
    }

    // In Accurate mode: validate that each SeekHead entry actually points to the
    // expected element.  Mirrors C++ SeekHead::isValid().
    if (seekHeadFound && readStyle === ReadStyle.Accurate) {
      for (const [id, pos] of elementPositions) {
        await this._stream.seek(pos, Position.Beginning);
        const [foundId] = await readElementId(this._stream);
        if (!foundId || foundId !== id) {
          this._valid = false;
          return;
        }
      }
    }

    this._valid = true;
  }

  /**
   * Parse a SeekHead element and populate `positions` with element ID → absolute offset.
   * @param segmentDataOffset - Absolute byte offset of the segment data start.
   * @param seekHeadEl - The SeekHead EBML element to parse.
   * @param positions - Map to populate with element ID → file offset entries.
   */
  private async parseSeekHead(
    segmentDataOffset: number,
    seekHeadEl: EbmlElement,
    positions: Map<number, number>,
  ): Promise<void> {
    const dataOffset = seekHeadEl.offset + seekHeadEl.headSize;
    const children = await readChildElements(this._stream, dataOffset, seekHeadEl.dataSize);

    for (const child of children) {
      if (child.id === EbmlId.Seek) {
        await this.parseSeekEntry(segmentDataOffset, child, positions);
      }
    }
  }

  /**
   * Parse a single Seek entry and add the resolved absolute offset to `positions`.
   * @param segmentDataOffset - Absolute byte offset of the segment data start.
   * @param seekEl - The Seek EBML element to parse.
   * @param positions - Map to update with element ID → file offset.
   */
  private async parseSeekEntry(
    segmentDataOffset: number,
    seekEl: EbmlElement,
    positions: Map<number, number>,
  ): Promise<void> {
    const dataOffset = seekEl.offset + seekEl.headSize;
    const children = await readChildElements(this._stream, dataOffset, seekEl.dataSize);

    let seekId = 0;
    let seekPosition = 0;

    for (const child of children) {
      switch (child.id) {
        case EbmlId.SeekID:
          seekId = await readUintValue(this._stream, child);
          break;
        case EbmlId.SeekPosition:
          seekPosition = await readUintValue(this._stream, child);
          break;
      }
    }

    if (seekId) {
      positions.set(seekId, segmentDataOffset + seekPosition);
    }
  }

  /**
   * Parse the Segment Info element and update audio properties with duration and title.
   * @param infoEl - The Info EBML element to parse.
   * @param readProperties - Whether to populate audio properties.
   */
  private async parseInfo(infoEl: EbmlElement, readProperties: boolean): Promise<void> {
    if (!readProperties) return;
    if (!this._properties) {
      this._properties = new MatroskaProperties(this._readStyle);
    }

    const dataOffset = infoEl.offset + infoEl.headSize;
    const children = await readChildElements(this._stream, dataOffset, infoEl.dataSize);

    let timestampScale = 1000000; // Default: 1ms in nanoseconds
    let duration = 0;
    let title = "";

    for (const child of children) {
      switch (child.id) {
        case EbmlId.TimestampScale:
          timestampScale = await readUintValue(this._stream, child);
          break;
        case EbmlId.Duration:
          duration = await readFloatValue(this._stream, child);
          break;
        case EbmlId.Title:
          title = await readStringValue(this._stream, child);
          break;
      }
    }

    // Duration is in TimestampScale units; convert to milliseconds
    if (duration > 0) {
      const durationMs = Math.round((duration * timestampScale) / 1000000);
      this._properties.setLengthInMilliseconds(durationMs);
    }
    if (title) {
      this._properties.setTitle(title);
    }
  }

  /**
   * Parse the Tracks element to locate the first audio track.
   * @param tracksEl - The Tracks EBML element to parse.
   */
  private async parseTracks(tracksEl: EbmlElement): Promise<void> {
    if (!this._properties) {
      this._properties = new MatroskaProperties(this._readStyle);
    }

    const dataOffset = tracksEl.offset + tracksEl.headSize;
    const children = await readChildElements(this._stream, dataOffset, tracksEl.dataSize);

    let foundAudioTrack = false;

    for (const child of children) {
      if (child.id === EbmlId.TrackEntry) {
        await this.parseTrackEntry(child, foundAudioTrack);
        if (!foundAudioTrack && this._properties!.codecName) {
          foundAudioTrack = true;
        }
      }
    }
  }

  /**
   * Parse a single TrackEntry element and extract audio codec information.
   * @param trackEntryEl - The TrackEntry EBML element to parse.
   * @param audioAlreadyFound - Whether an audio track has already been processed.
   */
  private async parseTrackEntry(trackEntryEl: EbmlElement, audioAlreadyFound: boolean): Promise<void> {
    const dataOffset = trackEntryEl.offset + trackEntryEl.headSize;
    const children = await readChildElements(this._stream, dataOffset, trackEntryEl.dataSize);

    let trackType = 0;
    let codecId = "";

    for (const child of children) {
      switch (child.id) {
        case EbmlId.TrackType:
          trackType = await readUintValue(this._stream, child);
          break;
        case EbmlId.CodecID:
          codecId = await readStringValue(this._stream, child);
          break;
      }
    }

    // Only set audio properties from the first audio track (trackType === 2)
    if (trackType === 2 && !audioAlreadyFound) {
      this._properties!.setCodecName(codecId);

      // Parse Audio sub-element
      for (const child of children) {
        if (child.id === EbmlId.Audio) {
          await this.parseAudioElement(child);
          break;
        }
      }
    }
  }

  /**
   * Parse the Audio sub-element of a TrackEntry and populate sample rate,
   * channel count, and bit depth on the audio properties.
   * @param audioEl - The Audio EBML element to parse.
   */
  private async parseAudioElement(audioEl: EbmlElement): Promise<void> {
    const dataOffset = audioEl.offset + audioEl.headSize;
    const children = await readChildElements(this._stream, dataOffset, audioEl.dataSize);

    for (const child of children) {
      switch (child.id) {
        case EbmlId.SamplingFrequency: {
          const freq = await readFloatValue(this._stream, child);
          this._properties!.setSampleRate(Math.round(freq));
          break;
        }
        case EbmlId.Channels:
          this._properties!.setChannels(await readUintValue(this._stream, child));
          break;
        case EbmlId.BitDepth:
          this._properties!.setBitsPerSample(await readUintValue(this._stream, child));
          break;
      }
    }
  }
}
