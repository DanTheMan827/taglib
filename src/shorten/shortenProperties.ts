/** @file Audio properties for Shorten (.shn) lossless audio files. */

import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Values parsed from a Shorten file header, passed to {@link ShortenProperties}.
 */
export interface ShortenPropertyValues {
  /** Shorten format version (1–3). */
  version: number;
  /** Shorten internal file type code describing the audio encoding. */
  fileType: number;
  /** Number of audio channels. */
  channelCount: number;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Bits per sample. */
  bitsPerSample: number;
  /** Total number of PCM sample frames. */
  sampleFrames: number;
}

/**
 * Audio properties for Shorten (.shn) files.
 *
 * Shorten stores audio metadata (sample rate, bits per sample, channel count)
 * inside an embedded verbatim WAVE or AIFF header at the start of the stream.
 * Duration and bitrate are derived from those values.
 */
export class ShortenProperties extends AudioProperties {
  /** Shorten format version number (1–3). */
  private _version: number = 0;
  /** Shorten internal file type code. */
  private _fileType: number = 0;
  /** Number of audio channels. */
  private _channelCount: number = 0;
  /** Sample rate in Hz. */
  private _sampleRate: number = 0;
  /** Bits per sample. */
  private _bitsPerSample: number = 0;
  /** Total number of PCM sample frames. */
  private _sampleFrames: number = 0;
  /** Uncompressed bitrate in kilobits per second. */
  private _bitrate: number = 0;
  /** Track duration in milliseconds, derived from sample frames and sample rate. */
  private _lengthMs: number = 0;

  /**
   * Constructs a `ShortenProperties` instance from parsed header values.
   * @param values - The parsed property values, or `null` to create an empty instance.
   * @param readStyle - The level of detail used when parsing audio properties.
   */
  constructor(values: ShortenPropertyValues | null, readStyle: ReadStyle) {
    super(readStyle);
    if (values) {
      this._version = values.version;
      this._fileType = values.fileType;
      this._channelCount = values.channelCount;
      this._sampleRate = values.sampleRate;
      this._bitsPerSample = values.bitsPerSample;
      this._sampleFrames = values.sampleFrames;

      this._bitrate = Math.round(
        this._sampleRate * this._bitsPerSample * this._channelCount / 1000.0 + 0.5,
      );
      if (this._sampleRate > 0) {
        this._lengthMs = Math.round(
          (this._sampleFrames * 1000.0) / this._sampleRate + 0.5,
        );
      }
    }
  }

  /**
   * Returns the track duration in milliseconds.
   * @returns Duration computed from sample frames and sample rate.
   */
  get lengthInMilliseconds(): number {
    return this._lengthMs;
  }

  /**
   * Returns the uncompressed bitrate in kilobits per second.
   * @returns Bitrate computed from sample rate, bits per sample, and channel count.
   */
  override get bitrate(): number {
    return this._bitrate;
  }

  /**
   * Returns the sample rate in Hz.
   * @returns The sample rate.
   */
  override get sampleRate(): number {
    return this._sampleRate;
  }

  /**
   * Returns the number of audio channels.
   * @returns The channel count.
   */
  get channels(): number {
    return this._channelCount;
  }

  /**
   * Returns the Shorten format version number (1–3).
   * @returns The version number.
   */
  get shortenVersion(): number {
    return this._version;
  }

  /**
   * Returns the Shorten internal file type code describing the audio encoding.
   * @returns The file type code.
   */
  get fileType(): number {
    return this._fileType;
  }

  /**
   * Returns the number of bits per sample.
   * @returns Bits per sample (e.g. `16`).
   */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /**
   * Returns the total number of PCM sample frames in the stream.
   * @returns The sample frame count.
   */
  get sampleFrames(): number {
    return this._sampleFrames;
  }
}
