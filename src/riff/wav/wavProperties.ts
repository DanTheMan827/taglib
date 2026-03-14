import { ByteVector } from "../../byteVector.js";
import { AudioProperties } from "../../audioProperties.js";
import { ReadStyle } from "../../toolkit/types.js";

/**
 * Audio properties parsed from a WAV "fmt " chunk.
 *
 * fmt  chunk layout (little-endian):
 *   format(2) + channels(2) + sampleRate(4) + avgBytesPerSec(4)
 *   + blockAlign(2) + bitsPerSample(2)
 */
export class WavProperties extends AudioProperties {
  private _format: number = 0;
  private _channels: number = 0;
  private _sampleRate: number = 0;
  private _avgBytesPerSec: number = 0;
  private _bitsPerSample: number = 0;
  private _streamLength: number = 0;

  constructor(
    data: ByteVector,
    streamLength: number,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(readStyle);
    this._streamLength = streamLength;

    if (data.length < 16) return;

    this._format = data.toUShort(0, false);
    this._channels = data.toUShort(2, false);
    this._sampleRate = data.toUInt(4, false);
    this._avgBytesPerSec = data.toUInt(8, false);
    // blockAlign at offset 12 (2 bytes) – not stored separately
    this._bitsPerSample = data.toUShort(14, false);
  }

  get lengthInMilliseconds(): number {
    if (this._avgBytesPerSec > 0) {
      return Math.round((this._streamLength * 1000) / this._avgBytesPerSec);
    }
    return 0;
  }

  override get bitrate(): number {
    if (this._avgBytesPerSec > 0) {
      return Math.round((this._avgBytesPerSec * 8) / 1000);
    }
    return 0;
  }

  override get sampleRate(): number {
    return this._sampleRate;
  }

  get channels(): number {
    return this._channels;
  }

  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /** Audio format tag (1 = PCM, 3 = IEEE float, etc.). */
  get format(): number {
    return this._format;
  }
}
