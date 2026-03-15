import { ByteVector, StringType } from "../../../byteVector.js";
import {
  Id3v2Frame,
  Id3v2FrameHeader,
} from "../id3v2Frame.js";

/**
 * Chapter frame (CHAP).
 *
 * Structure: elementId(null-terminated Latin1)
 *            + startTime(4, big-endian ms) + endTime(4) + startOffset(4) + endOffset(4)
 *            + embedded sub-frames.
 */
export class ChapterFrame extends Id3v2Frame {
  private _elementId: ByteVector;
  private _startTime: number = 0;
  private _endTime: number = 0;
  private _startOffset: number = 0xffffffff;
  private _endOffset: number = 0xffffffff;
  private _embeddedFrames: Id3v2Frame[] = [];

  constructor(
    elementId: ByteVector,
    startTime: number = 0,
    endTime: number = 0,
    startOffset: number = 0xffffffff,
    endOffset: number = 0xffffffff,
  ) {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("CHAP", StringType.Latin1),
    );
    super(header);
    this._elementId = elementId;
    this._startTime = startTime;
    this._endTime = endTime;
    this._startOffset = startOffset;
    this._endOffset = endOffset;
  }

  // -- Accessors --------------------------------------------------------------

  get elementId(): ByteVector {
    return this._elementId;
  }

  get startTime(): number {
    return this._startTime;
  }

  set startTime(v: number) {
    this._startTime = v;
  }

  get endTime(): number {
    return this._endTime;
  }

  set endTime(v: number) {
    this._endTime = v;
  }

  get startOffset(): number {
    return this._startOffset;
  }

  set startOffset(v: number) {
    this._startOffset = v;
  }

  get endOffset(): number {
    return this._endOffset;
  }

  set endOffset(v: number) {
    this._endOffset = v;
  }

  get embeddedFrameList(): Id3v2Frame[] {
    return this._embeddedFrames;
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
  ): ChapterFrame {
    const fieldData = Id3v2Frame.fieldData(data, header, version);
    const frame = new ChapterFrame(new ByteVector());
    frame._header = header;
    frame._parseChapterFields(fieldData, version, frameParser);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  protected parseFields(data: ByteVector, version: number): void {
    this._parseChapterFields(data, version);
  }

  protected renderFields(version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._elementId);
    v.append(0); // null terminator

    v.append(ByteVector.fromUInt(this._startTime));
    v.append(ByteVector.fromUInt(this._endTime));
    v.append(ByteVector.fromUInt(this._startOffset));
    v.append(ByteVector.fromUInt(this._endOffset));

    for (const frame of this._embeddedFrames) {
      v.append(frame.render(version));
    }

    return v;
  }

  // -- Private ----------------------------------------------------------------

  private _parseChapterFields(
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

    if (offset + 16 > data.length) return;

    this._startTime = data.mid(offset, 4).toUInt();
    offset += 4;
    this._endTime = data.mid(offset, 4).toUInt();
    offset += 4;
    this._startOffset = data.mid(offset, 4).toUInt();
    offset += 4;
    this._endOffset = data.mid(offset, 4).toUInt();
    offset += 4;

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
