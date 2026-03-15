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
  private _elementId: ByteVector;
  private _isTopLevel: boolean = false;
  private _isOrdered: boolean = false;
  private _childElements: ByteVector[] = [];
  private _embeddedFrames: Id3v2Frame[] = [];

  constructor(elementId: ByteVector) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("CTOC", StringType.Latin1),
    );
    super(header);
    this._elementId = elementId;
  }

  // -- Accessors --------------------------------------------------------------

  get elementId(): ByteVector {
    return this._elementId;
  }

  set elementId(id: ByteVector) {
    this._elementId = id;
  }

  get isTopLevel(): boolean {
    return this._isTopLevel;
  }

  set isTopLevel(v: boolean) {
    this._isTopLevel = v;
  }

  get isOrdered(): boolean {
    return this._isOrdered;
  }

  set isOrdered(v: boolean) {
    this._isOrdered = v;
  }

  get childElements(): ByteVector[] {
    return this._childElements;
  }

  set childElements(v: ByteVector[]) {
    this._childElements = v;
  }

  get embeddedFrameList(): Id3v2Frame[] {
    return this._embeddedFrames;
  }

  addChildElement(id: ByteVector): void {
    this._childElements.push(id);
  }

  removeChildElement(id: ByteVector): void {
    const idx = this._childElements.findIndex(e => e.equals(id));
    if (idx >= 0) {
      this._childElements.splice(idx, 1);
    }
  }

  addEmbeddedFrame(frame: Id3v2Frame): void {
    this._embeddedFrames.push(frame);
  }

  removeEmbeddedFrame(frame: Id3v2Frame): void {
    const idx = this._embeddedFrames.indexOf(frame);
    if (idx >= 0) {
      this._embeddedFrames.splice(idx, 1);
    }
  }

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

  protected parseFields(data: ByteVector, version: number): void {
    this._parseTocFields(data, version);
  }

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
