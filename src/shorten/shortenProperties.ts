import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/** Values parsed from a Shorten file header. */
export interface ShortenPropertyValues {
  version: number;
  fileType: number;
  channelCount: number;
  sampleRate: number;
  bitsPerSample: number;
  sampleFrames: number;
}

/**
 * Audio properties for Shorten (.shn) files.
 */
export class ShortenProperties extends AudioProperties {
  private _version: number = 0;
  private _fileType: number = 0;
  private _channelCount: number = 0;
  private _sampleRate: number = 0;
  private _bitsPerSample: number = 0;
  private _sampleFrames: number = 0;
  private _bitrate: number = 0;
  private _lengthMs: number = 0;

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

  get lengthInMilliseconds(): number {
    return this._lengthMs;
  }

  override get bitrate(): number {
    return this._bitrate;
  }

  override get sampleRate(): number {
    return this._sampleRate;
  }

  get channels(): number {
    return this._channelCount;
  }

  get shortenVersion(): number {
    return this._version;
  }

  get fileType(): number {
    return this._fileType;
  }

  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  get sampleFrames(): number {
    return this._sampleFrames;
  }
}
