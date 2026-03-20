/** @file Audio properties for WAV files. Parses the RIFF "fmt " chunk. */

import { ByteVector } from "../../byteVector.js";
import { AudioProperties } from "../../audioProperties.js";
import { ReadStyle } from "../../toolkit/types.js";

/**
 * Audio properties parsed from a WAV `"fmt "` chunk.
 *
 * `fmt ` chunk layout (little-endian):
 * `format(2)` + `channels(2)` + `sampleRate(4)` + `avgBytesPerSec(4)`
 * + `blockAlign(2)` + `bitsPerSample(2)`
 */
export class WavProperties extends AudioProperties {
  /** Audio format tag (e.g. `1` = PCM, `3` = IEEE float). */
  private _format: number = 0;
  /** Number of audio channels. */
  private _channels: number = 0;
  /** Sample rate in Hz. */
  private _sampleRate: number = 0;
  /** Average bytes per second (used to compute duration and bitrate). */
  private _avgBytesPerSec: number = 0;
  /** Bits per sample (bit depth). */
  private _bitsPerSample: number = 0;
  /** Byte length of the `"data"` chunk (raw PCM samples). */
  private _streamLength: number = 0;

  /**
   * Constructs a {@link WavProperties} instance by parsing a `"fmt "` chunk.
   * @param data - Raw bytes of the `"fmt "` chunk (must be at least 16 bytes).
   * @param streamLength - Byte length of the `"data"` chunk.
   * @param readStyle - Level of detail for property parsing. Defaults to `ReadStyle.Average`.
   */
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

  /**
   * Playback duration in milliseconds, derived from `avgBytesPerSec` and `streamLength`.
   * @returns Duration in milliseconds, or `0` if `avgBytesPerSec` is zero.
   */
  get lengthInMilliseconds(): number {
    if (this._avgBytesPerSec > 0) {
      return Math.round((this._streamLength * 1000) / this._avgBytesPerSec);
    }
    return 0;
  }

  /**
   * Average bitrate of the stream in kilobits per second.
   * @returns Bitrate in kbps, or `0` if `avgBytesPerSec` is zero.
   */
  override get bitrate(): number {
    if (this._avgBytesPerSec > 0) {
      return Math.round((this._avgBytesPerSec * 8) / 1000);
    }
    return 0;
  }

  /**
   * Sample rate of the audio stream in Hz.
   * @returns Sample rate in Hz, or `0` if unknown.
   */
  override get sampleRate(): number {
    return this._sampleRate;
  }

  /**
   * Number of audio channels.
   * @returns Channel count (e.g. `2` for stereo).
   */
  get channels(): number {
    return this._channels;
  }

  /**
   * Bits per sample (bit depth) of the audio stream.
   * @returns Bit depth (e.g. `16`, `24`, `32`).
   */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /**
   * Audio format tag from the `"fmt "` chunk.
   * Common values: `1` = PCM, `3` = IEEE float, `6` = A-law, `7` = μ-law.
   * @returns The format tag value.
   */
  get format(): number {
    return this._format;
  }
}
