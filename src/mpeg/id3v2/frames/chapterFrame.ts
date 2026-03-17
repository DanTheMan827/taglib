/** @file ID3v2 chapter frame (CHAP). Marks a chapter within the audio stream. */

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
  /** Unique chapter identifier as a null-terminated Latin1 byte sequence. */
  private _elementId: ByteVector;
  /** Chapter start time in milliseconds from the beginning of the audio. */
  private _startTime: number = 0;
  /** Chapter end time in milliseconds from the beginning of the audio. */
  private _endTime: number = 0;
  /** Chapter start byte offset, or 0xFFFFFFFF if unused. */
  private _startOffset: number = 0xffffffff;
  /** Chapter end byte offset, or 0xFFFFFFFF if unused. */
  private _endOffset: number = 0xffffffff;
  /** Embedded ID3v2 sub-frames associated with this chapter (e.g. TIT2). */
  private _embeddedFrames: Id3v2Frame[] = [];

  /**
   * Creates a new ChapterFrame.
   * @param elementId - Unique chapter identifier as a `ByteVector`.
   * @param startTime - Chapter start time in milliseconds. Defaults to `0`.
   * @param endTime - Chapter end time in milliseconds. Defaults to `0`.
   * @param startOffset - Chapter start byte offset. Defaults to `0xFFFFFFFF` (unused).
   * @param endOffset - Chapter end byte offset. Defaults to `0xFFFFFFFF` (unused).
   */
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

  /** Gets the unique chapter identifier as a `ByteVector`. */
  get elementId(): ByteVector {
    return this._elementId;
  }

  /** Gets the chapter start time in milliseconds. */
  get startTime(): number {
    return this._startTime;
  }

  /** Sets the chapter start time in milliseconds. */
  set startTime(v: number) {
    this._startTime = v;
  }

  /** Gets the chapter end time in milliseconds. */
  get endTime(): number {
    return this._endTime;
  }

  /** Sets the chapter end time in milliseconds. */
  set endTime(v: number) {
    this._endTime = v;
  }

  /** Gets the chapter start byte offset, or 0xFFFFFFFF if unused. */
  get startOffset(): number {
    return this._startOffset;
  }

  /** Sets the chapter start byte offset. */
  set startOffset(v: number) {
    this._startOffset = v;
  }

  /** Gets the chapter end byte offset, or 0xFFFFFFFF if unused. */
  get endOffset(): number {
    return this._endOffset;
  }

  /** Sets the chapter end byte offset. */
  set endOffset(v: number) {
    this._endOffset = v;
  }

  /** Gets the list of embedded ID3v2 sub-frames attached to this chapter. */
  get embeddedFrameList(): Id3v2Frame[] {
    return this._embeddedFrames;
  }

  /**
   * Appends a sub-frame to the list of embedded frames for this chapter.
   * @param frame - The `Id3v2Frame` to append.
   */
  addEmbeddedFrame(frame: Id3v2Frame): void {
    this._embeddedFrames.push(frame);
  }

  /**
   * Removes the first occurrence of the given sub-frame from the embedded frame list.
   * @param frame - The `Id3v2Frame` to remove.
   */
  removeEmbeddedFrame(frame: Id3v2Frame): void {
    const idx = this._embeddedFrames.indexOf(frame);
    if (idx >= 0) {
      this._embeddedFrames.splice(idx, 1);
    }
  }

  /**
   * Returns the element ID as a Latin1 string.
   * @returns The element ID string.
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
  ): ChapterFrame {
    const fieldData = Id3v2Frame.fieldData(data, header, version);
    const frame = new ChapterFrame(new ByteVector());
    frame._header = header;
    frame._parseChapterFields(fieldData, version, frameParser);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the raw CHAP frame field data, populating all chapter properties.
   * @param data - Decoded frame field bytes.
   * @param version - ID3v2 version number.
   */
  protected parseFields(data: ByteVector, version: number): void {
    this._parseChapterFields(data, version);
  }

  /**
   * Renders the CHAP frame field data to bytes.
   * @param version - ID3v2 version number used to render embedded sub-frames.
   * @returns A `ByteVector` containing the encoded CHAP field data.
   */
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

  /**
   * Internal implementation that parses chapter fields from decoded frame bytes,
   * optionally using a caller-supplied parser for embedded sub-frames.
   * @param data - Decoded field bytes to parse.
   * @param version - ID3v2 version number.
   * @param frameParser - Optional function that converts raw sub-frame bytes into
   *                      an `Id3v2Frame` instance. When omitted, embedded frames
   *                      are not parsed.
   */
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
