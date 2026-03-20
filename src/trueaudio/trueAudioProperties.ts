/** @file Audio properties for TrueAudio (TTA) streams. Parses the 18-byte TTA1 header. */

import { AudioProperties } from "../audioProperties.js";
import { ByteVector, StringType } from "../byteVector.js";
import type { offset_t, ReadStyle } from "../toolkit/types.js";

/**
 * Size of the TTA1 header in bytes:
 * `"TTA"` (3) + version (1) + format (2) + channels (2) +
 * bitsPerSample (2) + sampleRate (4) + sampleFrames (4) = 18 bytes.
 */
export const TTA_HEADER_SIZE = 18;

// =============================================================================
// TrueAudioProperties
// =============================================================================

/**
 * Audio properties for TrueAudio (TTA) streams.
 *
 * Parses the 18-byte TTA1 header: `"TTA"` + version byte + audio format (2) +
 * channels (2) + bitsPerSample (2) + sampleRate (4) + sampleFrames (4).
 */
export class TrueAudioProperties extends AudioProperties {
  /** TTA stream version number (e.g. `1` for TTA1). */
  private _version: number = 0;
  /** Playback duration in milliseconds. */
  private _lengthInMs: number = 0;
  /** Average bitrate in kilobits per second. */
  private _bitrate: number = 0;
  /** Sample rate in Hz. */
  private _sampleRate: number = 0;
  /** Number of audio channels. */
  private _channels: number = 0;
  /** Bits per sample (bit depth). */
  private _bitsPerSample: number = 0;
  /** Total number of PCM sample frames. */
  private _sampleFrames: number = 0;

  /**
   * Constructs a {@link TrueAudioProperties} instance by parsing the TTA1 header.
   * @param data - Raw bytes beginning with `"TTA"` (must be at least {@link TTA_HEADER_SIZE} bytes for TTA1).
   * @param streamLength - Byte length of the audio stream (excluding tags), used to compute bitrate.
   * @param readStyle - Level of detail for property parsing.
   */
  constructor(data: ByteVector, streamLength: offset_t, readStyle: ReadStyle) {
    super(readStyle);
    this.read(data, streamLength);
  }

  // ---------------------------------------------------------------------------
  // AudioProperties interface
  // ---------------------------------------------------------------------------

  /**
   * Playback duration in milliseconds.
   * @returns Duration in milliseconds, or `0` if unknown.
   */
  get lengthInMilliseconds(): number {
    return this._lengthInMs;
  }

  /**
   * Average bitrate of the stream in kilobits per second.
   * @returns Bitrate in kbps, or `0` if unknown.
   */
  override get bitrate(): number {
    return this._bitrate;
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

  // ---------------------------------------------------------------------------
  // TTA-specific
  // ---------------------------------------------------------------------------

  /**
   * TrueAudio stream version number.
   * @returns The version (e.g. `1` for TTA1).
   */
  get ttaVersion(): number {
    return this._version;
  }

  /**
   * Bits per sample (bit depth) of the audio stream.
   * @returns Bit depth (e.g. `16`, `24`).
   */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /**
   * Total number of PCM sample frames in the stream.
   * @returns Sample frame count.
   */
  get sampleFrames(): number {
    return this._sampleFrames;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Parses the TTA1 header bytes and populates all audio property fields.
   * @param data - Raw header bytes starting with `"TTA"`.
   * @param streamLength - Byte length of the audio stream (excluding tags).
   */
  private read(data: ByteVector, streamLength: offset_t): void {
    if (data.length < 4) return;

    const tta = ByteVector.fromString("TTA", StringType.Latin1);
    if (!data.startsWith(tta)) return;

    let pos = 3;

    // Version byte is ASCII digit: '1' → 1
    this._version = data.get(pos) - 0x30; // '0' = 0x30
    pos += 1;

    // Only TTA1 is fully specified
    if (this._version === 1) {
      if (data.length < TTA_HEADER_SIZE) return;

      // Skip 2-byte audio format field
      pos += 2;

      this._channels = data.toShort(pos, false);
      pos += 2;

      this._bitsPerSample = data.toShort(pos, false);
      pos += 2;

      this._sampleRate = data.toUInt(pos, false);
      pos += 4;

      this._sampleFrames = data.toUInt(pos, false);

      if (this._sampleFrames > 0 && this._sampleRate > 0) {
        const length = (this._sampleFrames * 1000.0) / this._sampleRate;
        this._lengthInMs = Math.round(length);
        this._bitrate = Math.round((streamLength * 8.0) / length);
      }
    }
  }
}
