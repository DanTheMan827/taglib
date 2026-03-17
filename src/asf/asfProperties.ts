/** @file Audio properties implementation for the ASF / WMA format. */

import { AudioProperties } from "../audioProperties.js";
import { ReadStyle } from "../toolkit/types.js";

// ---------------------------------------------------------------------------
// AsfCodec
// ---------------------------------------------------------------------------

/** Windows Media Audio codec variant. */
export enum AsfCodec {
  /** The codec could not be identified. */
  Unknown = 0,
  /** Windows Media Audio v1 (WMA1, format tag 0x0160). */
  WMA1,
  /** Windows Media Audio v2 (WMA2, format tag 0x0161). */
  WMA2,
  /** Windows Media Audio 9 Professional (format tag 0x0162). */
  WMA9Pro,
  /** Windows Media Audio 9 Lossless (format tag 0x0163). */
  WMA9Lossless,
}

// ---------------------------------------------------------------------------
// AsfProperties
// ---------------------------------------------------------------------------

/**
 * Audio properties extracted from an ASF/WMA stream.
 *
 * All setter methods are intended for use by {@link AsfFile} during parsing
 * and are not part of the public API.
 */
export class AsfProperties extends AudioProperties {
  /** Duration of the stream in milliseconds. */
  private _length = 0;
  /** Average bitrate in kb/s. */
  private _bitrate = 0;
  /** Sample rate in Hz. */
  private _sampleRate = 0;
  /** Number of audio channels. */
  private _channels = 0;
  /** Bits per sample (bit depth). */
  private _bitsPerSample = 0;
  /** Detected WMA codec variant. */
  private _codec: AsfCodec = AsfCodec.Unknown;
  /** Human-readable codec name from the Codec List Object. */
  private _codecName = "";
  /** Human-readable codec description from the Codec List Object. */
  private _codecDescription = "";
  /** `true` when any content-encryption object is found. */
  private _encrypted = false;

  /**
   * @param readStyle - Level of detail to use when reading properties.
   */
  constructor(readStyle: ReadStyle = ReadStyle.Average) {
    super(readStyle);
  }

  // -- AudioProperties interface --

  /** Duration of the audio stream in milliseconds. */
  get lengthInMilliseconds(): number { return this._length; }
  /** Average bitrate of the stream in kb/s. */
  get bitrate(): number { return this._bitrate; }
  /** Sample rate of the stream in Hz. */
  get sampleRate(): number { return this._sampleRate; }
  /** Number of audio channels. */
  get channels(): number { return this._channels; }

  // -- ASF-specific --

  /** Bits per sample (bit depth). */
  get bitsPerSample(): number { return this._bitsPerSample; }
  /** Detected WMA codec variant. */
  get codec(): AsfCodec { return this._codec; }
  /** Human-readable codec name (e.g. `"Windows Media Audio"`). */
  get codecName(): string { return this._codecName; }
  /** Human-readable codec description (e.g. bitrate/mode information). */
  get codecDescription(): string { return this._codecDescription; }
  /** `true` if the stream is encrypted with any DRM scheme. */
  get isEncrypted(): boolean { return this._encrypted; }

  // -- Setters (used by AsfFile during parsing) --

  /**
   * Set the stream duration.
   * @param value - Duration in milliseconds.
   */
  setLengthInMilliseconds(value: number): void { this._length = value; }
  /**
   * Set the average bitrate.
   * @param value - Bitrate in kb/s.
   */
  setBitrate(value: number): void { this._bitrate = value; }
  /**
   * Set the sample rate.
   * @param value - Sample rate in Hz.
   */
  setSampleRate(value: number): void { this._sampleRate = value; }
  /**
   * Set the channel count.
   * @param value - Number of audio channels.
   */
  setChannels(value: number): void { this._channels = value; }
  /**
   * Set the bit depth.
   * @param value - Bits per sample.
   */
  setBitsPerSample(value: number): void { this._bitsPerSample = value; }

  /**
   * Map a WMA format tag to the corresponding {@link AsfCodec} variant.
   * @param formatTag - The `wFormatTag` field from the WAVEFORMATEX structure.
   */
  setCodec(formatTag: number): void {
    switch (formatTag) {
      case 0x0160: this._codec = AsfCodec.WMA1; break;
      case 0x0161: this._codec = AsfCodec.WMA2; break;
      case 0x0162: this._codec = AsfCodec.WMA9Pro; break;
      case 0x0163: this._codec = AsfCodec.WMA9Lossless; break;
      default: this._codec = AsfCodec.Unknown; break;
    }
  }

  /**
   * Set the human-readable codec name.
   * @param value - Codec name string from the Codec List Object.
   */
  setCodecName(value: string): void { this._codecName = value; }
  /**
   * Set the human-readable codec description.
   * @param value - Description string from the Codec List Object.
   */
  setCodecDescription(value: string): void { this._codecDescription = value; }
  /**
   * Mark the stream as encrypted.
   * @param value - `true` when a content-encryption object is present.
   */
  setEncrypted(value: boolean): void { this._encrypted = value; }
}
