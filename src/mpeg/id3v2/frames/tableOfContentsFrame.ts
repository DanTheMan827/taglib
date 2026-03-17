/** @file ID3v2 table of contents frame (CTOC). Defines hierarchical chapter structure with ordered child entries. */
import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
} from "../id3v2Frame.js";

/**
 * Table of contents frame (CTOC).
 *
 * Structure: elementId(null-terminated Latin1) + flags(1) + entryCount(1)
 *            + childElementIds(null-terminated Latin1, repeated entryCount times)
 *            + embedded sub-frames.
 */
export class TableOfContentsFrame extends Id3v2Frame {
  /** Unique element identifier for this CTOC entry, stored as Latin1 bytes. */
  private _elementId: ByteVector;
  /** Whether this is the root (top-level) table-of-contents entry in the tag. */
  private _isTopLevel: boolean = false;
  /** Whether the child entries are ordered (must be played in sequence). */
  private _isOrdered: boolean = false;
  /** Ordered list of child element IDs referenced by this CTOC entry. */
  private _childElements: ByteVector[] = [];
  /** Sub-frames embedded within this CTOC frame. */
  private _embeddedFrames: Id3v2Frame[] = [];

  /**
   * Creates a new CTOC frame with the given element identifier.
   * @param elementId - The unique Latin1 element identifier for this table-of-contents entry.
   */
  constructor(elementId: ByteVector) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("CTOC", StringType.Latin1),
    );
    super(header);
    this._elementId = elementId;
  }

  // -- Accessors --------------------------------------------------------------

  /**
   * Gets the element identifier for this CTOC entry.
   * @returns A {@link ByteVector} containing the Latin1-encoded element ID.
   */
  get elementId(): ByteVector {
    return this._elementId;
  }

  /**
   * Sets the element identifier for this CTOC entry.
   * @param id - The new Latin1-encoded element ID.
   */
  set elementId(id: ByteVector) {
    this._elementId = id;
  }

  /**
   * Gets whether this is the top-level (root) table-of-contents entry.
   * @returns `true` if this is the root CTOC entry.
   */
  get isTopLevel(): boolean {
    return this._isTopLevel;
  }

  /**
   * Sets whether this is the top-level table-of-contents entry.
   * @param v - `true` to mark this as the root CTOC entry.
   */
  set isTopLevel(v: boolean) {
    this._isTopLevel = v;
  }

  /**
   * Gets whether the child entries must be played in order.
   * @returns `true` if playback order is enforced.
   */
  get isOrdered(): boolean {
    return this._isOrdered;
  }

  /**
   * Sets whether the child entries must be played in order.
   * @param v - `true` to enforce sequential playback of child entries.
   */
  set isOrdered(v: boolean) {
    this._isOrdered = v;
  }

  /**
   * Gets the list of child element IDs referenced by this CTOC entry.
   * @returns An array of {@link ByteVector} element IDs.
   */
  get childElements(): ByteVector[] {
    return this._childElements;
  }

  /**
   * Replaces the list of child element IDs.
   * @param v - The new array of child element IDs.
   */
  set childElements(v: ByteVector[]) {
    this._childElements = v;
  }

  /**
   * Gets the list of frames embedded within this CTOC frame.
   * @returns An array of {@link Id3v2Frame} sub-frames.
   */
  get embeddedFrameList(): Id3v2Frame[] {
    return this._embeddedFrames;
  }

  /**
   * Appends a child element ID to this CTOC entry.
   * @param id - The Latin1-encoded element ID to add.
   */
  addChildElement(id: ByteVector): void {
    this._childElements.push(id);
  }

  /**
   * Removes the first child element ID equal to the given value.
   * @param id - The element ID to remove.
   */
  removeChildElement(id: ByteVector): void {
    const idx = this._childElements.findIndex(e => e.equals(id));
    if (idx >= 0) {
      this._childElements.splice(idx, 1);
    }
  }

  /**
   * Appends a sub-frame to the embedded frame list.
   * @param frame - The {@link Id3v2Frame} to embed in this CTOC frame.
   */
  addEmbeddedFrame(frame: Id3v2Frame): void {
    this._embeddedFrames.push(frame);
  }

  /**
   * Removes a sub-frame from the embedded frame list.
   * @param frame - The {@link Id3v2Frame} instance to remove.
   */
  removeEmbeddedFrame(frame: Id3v2Frame): void {
    const idx = this._embeddedFrames.indexOf(frame);
    if (idx >= 0) {
      this._embeddedFrames.splice(idx, 1);
    }
  }

  /**
   * Returns the element ID as a Latin1 string.
   * @returns The element identifier decoded as a Latin1 string.
   */
  toString(): string {
    return this._elementId.toString(StringType.Latin1);
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
    frameParser?: (data: ByteVector, version: number) => Id3v2Frame | undefined,
  ): TableOfContentsFrame {
    const fieldData = Id3v2Frame.fieldData(data, header, version);
    const frame = new TableOfContentsFrame(new ByteVector());
    frame._header = header;
    frame._parseTocFields(fieldData, version, frameParser);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the raw frame fields into structured CTOC data.
   * @param data - The raw field bytes of the frame.
   * @param version - The ID3v2 version used for parsing embedded sub-frames.
   */
  protected parseFields(data: ByteVector, version: number): void {
    this._parseTocFields(data, version);
  }

  /**
   * Serializes the CTOC frame fields into bytes.
   * @param version - The ID3v2 version used for rendering embedded sub-frames.
   * @returns A {@link ByteVector} containing the encoded frame fields.
   */
  protected renderFields(version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._elementId);
    v.append(0); // null terminator for element ID

    let flags = 0;
    if (this._isTopLevel) flags |= 0x02;
    if (this._isOrdered) flags |= 0x01;
    v.append(flags);

    v.append(this._childElements.length & 0xff);

    for (const child of this._childElements) {
      v.append(child);
      v.append(0); // null terminator
    }

    for (const frame of this._embeddedFrames) {
      v.append(frame.render(version));
    }

    return v;
  }

  // -- Private ----------------------------------------------------------------

  /**
   * Parses the raw CTOC field data into this frame's properties.
   * @param data - The raw bytes of the CTOC frame payload.
   * @param version - The ID3v2 version used for parsing embedded sub-frames.
   * @param frameParser - Optional callback to parse individual embedded sub-frames.
   */
  private _parseTocFields(
    data: ByteVector,
    version: number,
    frameParser?: (data: ByteVector, version: number) => Id3v2Frame | undefined,
  ): void {
    this._embeddedFrames = [];
    // Element ID: null-terminated
    let nullIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (data.get(i) === 0) {
        nullIdx = i;
        break;
      }
    }
    if (nullIdx < 0) return;

    this._elementId = data.mid(0, nullIdx);
    let offset = nullIdx + 1;

    if (offset >= data.length) return;
    const flags = data.get(offset);
    this._isTopLevel = (flags & 0x02) !== 0;
    this._isOrdered = (flags & 0x01) !== 0;
    offset += 1;

    if (offset >= data.length) return;
    const entryCount = data.get(offset);
    offset += 1;

    // Child element IDs
    this._childElements = [];
    for (let i = 0; i < entryCount && offset < data.length; i++) {
      let childNull = -1;
      for (let j = offset; j < data.length; j++) {
        if (data.get(j) === 0) {
          childNull = j;
          break;
        }
      }
      if (childNull < 0) break;
      this._childElements.push(data.mid(offset, childNull - offset));
      offset = childNull + 1;
    }

    // Parse embedded sub-frames
    if (frameParser) {
      while (offset < data.length) {
        const headerSize = Id3v2FrameHeader.size(version);
        if (offset + headerSize > data.length) break;

        const subHeader = new Id3v2FrameHeader(
          data.mid(offset),
          version,
        );
        if (subHeader.frameSize === 0) break;

        const totalFrameSize = headerSize + subHeader.frameSize;
        if (offset + totalFrameSize > data.length) break;

        const subFrameData = data.mid(offset, totalFrameSize);
        const subFrame = frameParser(subFrameData, version);
        if (subFrame) {
          this._embeddedFrames.push(subFrame);
        }
        offset += totalFrameSize;
      }
    }
  }
}
