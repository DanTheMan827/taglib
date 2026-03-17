/** @file Audio properties implementation for the DSF (DSD Stream File) format. */
import { AudioProperties } from "../audioProperties.js";
import { ByteVector } from "../byteVector.js";
import type { ReadStyle } from "../toolkit/types.js";

// =============================================================================
// DsfProperties
// =============================================================================

/**
 * Audio properties for DSD Stream File (DSF) format.
 *
 * Constructed from the 36-byte payload of the "fmt " chunk (after chunk
 * header). The data layout is all little-endian:
 *   formatVersion (4) + formatID (4) + channelType (4) + channels (4) +
 *   sampleRate (4) + bitsPerSample (4) + sampleCount (8) +
 *   blockSizePerChannel (4)
 */
export class DsfProperties extends AudioProperties {
  /** Format version from the "fmt " chunk (must be 1). */
  private _formatVersion: number = 0;
  /** Format ID: 0 = DSD uncompressed. */
  private _formatID: number = 0;
  /** Channel type identifier (e.g. 2 = stereo). */
  private _channelType: number = 0;
  /** Number of audio channels. */
  private _channels: number = 0;
  /** Sample rate in Hz (e.g. 2822400 for DSD64). */
  private _sampleRate: number = 0;
  /** Number of bits per sample (typically 1 for DSD). */
  private _bitsPerSample: number = 0;
  /** Total number of sample frames across all channels. */
  private _sampleCount: bigint = 0n;
  /** Block size per channel in bytes. */
  private _blockSizePerChannel: number = 0;
  /** Approximate bitrate in kbit/s. */
  private _bitrate: number = 0;
  /** Track duration in milliseconds. */
  private _lengthInMs: number = 0;

  /**
   * Constructs DSF audio properties by parsing the "fmt " chunk payload.
   * @param data Raw bytes from the "fmt " chunk payload (at least 36 bytes).
   * @param readStyle Read style hint (passed to the base class).
   */
  constructor(data: ByteVector, readStyle: ReadStyle) {
    super(readStyle);
    this.read(data);
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
  // DSF-specific
  // ---------------------------------------------------------------------------

  /** Format version number from the "fmt " chunk (must be 1). */
  get formatVersion(): number {
    return this._formatVersion;
  }

  /** Format ID: 0 indicates DSD uncompressed audio. */
  get formatID(): number {
    return this._formatID;
  }

  /** Channel type identifier (e.g. 2 = stereo, 3 = 3 channels). */
  get channelType(): number {
    return this._channelType;
  }

  /** Number of bits per sample (typically 1 for DSD). */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /** Total number of sample frames across all channels. */
  get sampleCount(): bigint {
    return this._sampleCount;
  }

  /** Block size per channel in bytes. */
  get blockSizePerChannel(): number {
    return this._blockSizePerChannel;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Parses the "fmt " chunk payload into audio property fields.
   * @param data Raw bytes from the "fmt " chunk (at least 36 bytes, little-endian).
   */
  private read(data: ByteVector): void {
    if (data.length < 36) return;

    this._formatVersion = data.toUInt(0, false);
    this._formatID = data.toUInt(4, false);
    this._channelType = data.toUInt(8, false);
    this._channels = data.toUInt(12, false);
    this._sampleRate = data.toUInt(16, false);
    this._bitsPerSample = data.toUInt(20, false);
    this._sampleCount = data.toLongLong(24, false);
    this._blockSizePerChannel = data.toUInt(32, false);

    this._bitrate = Math.round(
      (this._sampleRate * this._bitsPerSample * this._channels) / 1000.0,
    );

    if (this._sampleRate > 0) {
      this._lengthInMs = Math.round(
        (Number(this._sampleCount) * 1000.0) / this._sampleRate,
      );
    }
  }
}
