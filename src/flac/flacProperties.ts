/** @file FLAC audio properties parsed from the STREAMINFO metadata block. */
import { AudioProperties } from "../audioProperties.js";
import { ByteVector } from "../byteVector.js";
import { ReadStyle } from "../toolkit/types.js";

/**
 * FLAC audio properties, parsed from the STREAMINFO metadata block.
 *
 * STREAMINFO layout (34 bytes minimum):
 *   minBlockSize(2) + maxBlockSize(2) + minFrameSize(3) + maxFrameSize(3) +
 *   sampleRate:20 | channels-1:3 | bitsPerSample-1:5 | totalSamplesHigh:4 (4 bytes) +
 *   totalSamplesLow(4) + md5Signature(16)
 */
export class FlacProperties extends AudioProperties {
  /** Track duration in milliseconds. */
  private _lengthInMs: number = 0;
  /** Approximate bitrate in kbit/s, derived from stream length and sample count. */
  private _bitrate: number = 0;
  /** Sample rate in Hz. */
  private _sampleRate: number = 0;
  /** Number of bits per sample. */
  private _bitsPerSample: number = 0;
  /** Number of audio channels. */
  private _channels: number = 0;
  /** Total number of inter-channel sample frames in the stream. */
  private _sampleFrames: bigint = 0n;
  /** MD5 signature of the uncompressed audio data (16 bytes). */
  private _signature: ByteVector = new ByteVector();

  /**
   * Constructs FLAC audio properties from a STREAMINFO block.
   * @param streamInfoData Raw bytes of the STREAMINFO block payload (at least 18 bytes).
   * @param streamLength Total byte length of the audio stream (used to estimate bitrate).
   * @param readStyle Read style hint (passed to the base class).
   */
  constructor(
    streamInfoData: ByteVector,
    streamLength: number,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(readStyle);
    this.read(streamInfoData, streamLength);
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
  // FLAC-specific
  // ---------------------------------------------------------------------------

  /** Number of bits per sample. */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /** Total number of inter-channel sample frames in the stream. */
  get sampleFrames(): bigint {
    return this._sampleFrames;
  }

  /** MD5 signature of the uncompressed audio stream. */
  get signature(): ByteVector {
    return this._signature;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Parses the STREAMINFO block payload and populates all property fields.
   * @param data Raw bytes of the STREAMINFO block (at least 18 bytes, big-endian).
   * @param streamLength Total byte length of the audio stream, used to derive bitrate.
   */
  private read(data: ByteVector, streamLength: number): void {
    if (data.length < 18) {
      return;
    }

    // Skip min/max block sizes (4 bytes) and min/max frame sizes (6 bytes)
    let pos = 10;

    const flags = data.toUInt(pos, true);
    pos += 4;

    this._sampleRate = flags >>> 12;
    this._channels = ((flags >>> 9) & 7) + 1;
    this._bitsPerSample = ((flags >>> 4) & 31) + 1;

    // Total samples: upper 4 bits from flags, lower 32 bits from next word
    const hi = BigInt(flags & 0x0f);
    const lo = BigInt(data.toUInt(pos, true) >>> 0);
    pos += 4;

    this._sampleFrames = (hi << 32n) | lo;

    if (this._sampleFrames > 0n && this._sampleRate > 0) {
      const length =
        Number(this._sampleFrames) * 1000.0 / this._sampleRate;
      this._lengthInMs = Math.round(length);
      this._bitrate = Math.round((streamLength * 8.0) / length);
    }

    if (data.length >= pos + 16) {
      this._signature = data.mid(pos, 16);
    }
  }
}
