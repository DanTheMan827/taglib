import { ByteVector, StringType } from "../../byteVector.js";
import { AudioProperties } from "../../audioProperties.js";
import { ReadStyle } from "../../toolkit/types.js";

/**
 * Audio properties parsed from an AIFF/AIFC COMM chunk.
 *
 * COMM chunk layout (big-endian):
 *   channels(2) + sampleFrames(4) + bitsPerSample(2)
 *   + sampleRate(10 bytes, IEEE 754 80-bit extended float)
 * For AIFC, additionally:
 *   + compressionType(4) + compressionName(Pascal string)
 */
export class AiffProperties extends AudioProperties {
  private _channels: number = 0;
  private _sampleFrames: number = 0;
  private _bitsPerSample: number = 0;
  private _sampleRate: number = 0;
  private _streamLength: number = 0;
  private _isAifc: boolean = false;
  private _compressionType: string = "";
  private _compressionName: string = "";

  constructor(
    commData: ByteVector,
    streamLength: number,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(readStyle);
    this._streamLength = streamLength;

    if (commData.length < 18) return;

    this._channels = commData.toUShort(0, true);
    this._sampleFrames = commData.toUInt(2, true);
    this._bitsPerSample = commData.toUShort(6, true);
    this._sampleRate = commData.toFloat80BE(8);

    // AIFC extension: compressionType + compressionName after byte 18
    if (commData.length >= 22) {
      this._isAifc = true;
      this._compressionType = commData.mid(18, 4).toString(StringType.Latin1);

      // Pascal string: first byte is length, followed by that many chars
      if (commData.length >= 23) {
        const nameLen = commData.get(22);
        if (commData.length >= 23 + nameLen) {
          this._compressionName = commData
            .mid(23, nameLen)
            .toString(StringType.Latin1);
        }
      }
    }
  }

  get lengthInMilliseconds(): number {
    if (this._sampleRate > 0) {
      return Math.round((this._sampleFrames * 1000) / this._sampleRate);
    }
    return 0;
  }

  override get bitrate(): number {
    if (this.lengthInMilliseconds > 0) {
      return Math.round(
        (this._streamLength * 8) / this.lengthInMilliseconds,
      );
    }
    return 0;
  }

  override get sampleRate(): number {
    return Math.round(this._sampleRate);
  }

  get channels(): number {
    return this._channels;
  }

  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  get sampleFrames(): number {
    return this._sampleFrames;
  }

  get isAifc(): boolean {
    return this._isAifc;
  }

  get compressionType(): string {
    return this._compressionType;
  }

  get compressionName(): string {
    return this._compressionName;
  }
}
