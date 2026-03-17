/** @file Audio properties implementation for the DSDIFF (DSD Interchange File Format). */
import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

// =============================================================================
// DsdiffProperties
// =============================================================================

/**
 * Audio properties for DSD Interchange File Format (DSDIFF).
 *
 * Unlike most properties classes, DSDIFF properties are constructed from
 * pre-computed values extracted during the chunk-walking phase of file
 * parsing, rather than from raw byte data.
 */
export class DsdiffProperties extends AudioProperties {
  /** Sample rate in Hz (e.g. 2822400 for DSD64). */
  private _sampleRate: number;
  /** Number of audio channels. */
  private _channels: number;
  /** Total number of DSD sample frames (per channel). */
  private _sampleCount: bigint;
  /** Approximate bitrate in kbit/s. */
  private _bitrate: number;
  /** Track duration in milliseconds. */
  private _lengthInMs: number;

  /**
   * Constructs DSDIFF audio properties from pre-computed values.
   * @param sampleRate Sample rate in Hz.
   * @param channels Number of audio channels.
   * @param sampleCount Total DSD sample frames (per channel).
   * @param bitrate Approximate bitrate in kbit/s.
   * @param readStyle Read style hint (passed to the base class).
   */
  constructor(
    sampleRate: number,
    channels: number,
    sampleCount: bigint,
    bitrate: number,
    readStyle: ReadStyle,
  ) {
    super(readStyle);

    this._sampleRate = sampleRate;
    this._channels = channels;
    this._sampleCount = sampleCount;
    this._bitrate = bitrate;

    this._lengthInMs =
      sampleRate > 0
        ? Math.round((Number(sampleCount) * 1000.0) / sampleRate)
        : 0;
  }

  // ---------------------------------------------------------------------------
  // AudioProperties interface
  // ---------------------------------------------------------------------------

  /** Track duration in milliseconds. */
  get lengthInMilliseconds(): number {
    return this._lengthInMs;
  }

  /** Approximate bitrate in kbit/s. */
  override get bitrate(): number {
    return this._bitrate;
  }

  /** Sample rate in Hz. */
  override get sampleRate(): number {
    return this._sampleRate;
  }

  /** Number of audio channels. */
  get channels(): number {
    return this._channels;
  }

  // ---------------------------------------------------------------------------
  // DSDIFF-specific
  // ---------------------------------------------------------------------------

  /** DSD audio is always 1 bit per sample. */
  get bitsPerSample(): number {
    return 1;
  }

  /** Total number of DSD sample frames per channel. */
  get sampleCount(): bigint {
    return this._sampleCount;
  }
}
