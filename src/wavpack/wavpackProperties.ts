/** @file Audio properties for WavPack streams. Parses block headers including non-standard sample rates and DSD audio. */

import { AudioProperties } from "../audioProperties.js";
import { ByteVector, StringType } from "../byteVector.js";
import type { offset_t, ReadStyle } from "../toolkit/types.js";
import type { File } from "../file.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Size of a WavPack block header in bytes. */
export const HeaderSize = 32;

/** Bit mask for the bytes-stored field (bits 0–1). Used to compute `bitsPerSample`. */
const BYTES_STORED = 3;
/** Flag bit: stream is mono when set. */
const MONO_FLAG = 4;
/** Flag bit: stream uses hybrid (lossy) encoding when set. */
const HYBRID_FLAG = 8;
/** Flag bit: stream contains DSD audio when set. */
const DSD_FLAG = 0x80000000;

/** LSB position of the shift field within the flags word. */
const SHIFT_LSB = 13;
/** Bit mask for the shift field (5 bits starting at {@link SHIFT_LSB}). */
const SHIFT_MASK = 0x1f << SHIFT_LSB;

/** LSB position of the sample-rate index field within the flags word. */
const SRATE_LSB = 23;
/** Bit mask for the 4-bit sample-rate index field (starting at {@link SRATE_LSB}). */
const SRATE_MASK = 0xf << SRATE_LSB;

/** Flag bit: this block is the first in a multi-block sequence. */
const INITIAL_BLOCK = 0x800;
/** Flag bit: this block is the last in a multi-block sequence. */
const FINAL_BLOCK = 0x1000;

/** Minimum supported WavPack stream version. */
const MIN_STREAM_VERS = 0x402;
/** Maximum supported WavPack stream version. */
const MAX_STREAM_VERS = 0x410;

/** Metadata block ID for DSD rate information. */
const ID_DSD_BLOCK = 0x0e;
/** Metadata block ID flag indicating optional data. */
const ID_OPTIONAL_DATA = 0x20;
/** Metadata block ID mask for unique IDs. */
const ID_UNIQUE = 0x3f;
/** Metadata block ID flag: data size is odd (one pad byte appended). */
const ID_ODD_SIZE = 0x40;
/** Metadata block ID flag: size field is 3 bytes instead of 1. */
const ID_LARGE = 0x80;
/** Compound metadata block ID for a non-standard sample rate chunk (`ID_OPTIONAL_DATA | 0x7`). */
const ID_SAMPLE_RATE = ID_OPTIONAL_DATA | 0x7; // 0x27

/** Standard sample rate lookup table indexed by the 4-bit sample-rate field in block flags. */
const sampleRates = [
  6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000,
  32000, 44100, 48000, 64000, 88200, 96000, 192000, 0,
];

// ---------------------------------------------------------------------------
// Helpers – metadata chunk parsing
// ---------------------------------------------------------------------------

/**
 * Parse metadata blocks within a WavPack block (excluding the 32-byte header)
 * looking for the chunk with the given `id`.
 *
 * - For `ID_SAMPLE_RATE` (0x27): returns the non-standard sample rate.
 * - For `ID_DSD_BLOCK` (0x0e): returns the DSD rate shift value.
 * @param block - The WavPack block body (bytes after the 32-byte header).
 * @param id - The metadata block ID to search for (`ID_SAMPLE_RATE` or `ID_DSD_BLOCK`).
 * @returns The extracted value, or `0` if the chunk was not found or is malformed.
 */
function getMetaDataChunk(block: ByteVector, id: number): number {
  if (id !== ID_SAMPLE_RATE && id !== ID_DSD_BLOCK) return 0;

  const blockSize = block.length;
  let index = 0;

  while (index + 1 < blockSize) {
    const metaId = block.get(index);
    let metaBc = block.get(index + 1) << 1;
    index += 2;

    if (metaId & ID_LARGE) {
      if (index + 2 > blockSize) return 0;
      metaBc += (block.get(index) << 9) + (block.get(index + 1) << 17);
      index += 2;
    }

    if (index + metaBc > blockSize) return 0;

    // Non-standard sample rate
    if (
      id === ID_SAMPLE_RATE &&
      (metaId & ID_UNIQUE) === ID_SAMPLE_RATE &&
      metaBc === 4
    ) {
      let sampleRate = block.get(index);
      sampleRate |= block.get(index + 1) << 8;
      sampleRate |= block.get(index + 2) << 16;

      // Only use 4th byte if it's really there (even size)
      if (!(metaId & ID_ODD_SIZE)) {
        sampleRate |= (block.get(index + 3) & 0x7f) << 24;
      }
      return sampleRate;
    }

    // DSD rate shift
    if (
      id === ID_DSD_BLOCK &&
      (metaId & ID_UNIQUE) === ID_DSD_BLOCK &&
      metaBc > 0
    ) {
      const rateShift = block.get(index);
      if (rateShift <= 31) return rateShift;
    }

    index += metaBc;
  }

  return 0;
}

/**
 * Reads a non-standard sample rate from a WavPack block body.
 * @param block - The WavPack block body (bytes after the 32-byte header).
 * @returns The non-standard sample rate in Hz, or `0` if not found.
 */
function getNonStandardRate(block: ByteVector): number {
  return getMetaDataChunk(block, ID_SAMPLE_RATE);
}

/**
 * Reads the DSD rate shift value from a WavPack block body.
 * @param block - The WavPack block body (bytes after the 32-byte header).
 * @returns The DSD rate shift (0–31), or `0` if not found.
 */
function getDsdRateShifter(block: ByteVector): number {
  return getMetaDataChunk(block, ID_DSD_BLOCK);
}

// =============================================================================
// WavPackProperties
// =============================================================================

/**
 * Audio properties for WavPack streams.
 *
 * Supports standard and non-standard sample rates, hybrid (lossy) and
 * lossless modes, multi-channel configurations, and DSD audio.
 */
export class WavPackProperties extends AudioProperties {
  /** Playback duration in milliseconds. */
  private _lengthInMs: number = 0;
  /** Average bitrate in kilobits per second. */
  private _bitrate: number = 0;
  /** Sample rate in Hz. */
  private _sampleRate: number = 0;
  /** Number of audio channels accumulated across multi-block sequences. */
  private _channels: number = 0;
  /** WavPack stream version from the block header. */
  private _version: number = 0;
  /** Bits per sample (bit depth). */
  private _bitsPerSample: number = 0;
  /** `true` if the stream is lossless (hybrid flag not set). */
  private _lossless: boolean = false;
  /** `true` if the stream contains DSD audio. */
  private _dsd: boolean = false;
  /** Total number of PCM sample frames in the stream. */
  private _sampleFrames: number = 0;

  /**
   * Private constructor — use {@link WavPackProperties.create} to instantiate.
   * @param readStyle - Level of detail requested for property parsing.
   */
  private constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  /**
   * Reads WavPack block headers from `file` and creates a populated properties instance.
   * @param file - The WavPack file positioned at the start of the audio stream.
   * @param streamLength - Byte length of the audio stream (excluding tags).
   * @param readStyle - Level of detail for property parsing.
   * @returns A fully populated {@link WavPackProperties} instance.
   */
  static async create(file: File, streamLength: offset_t, readStyle: ReadStyle): Promise<WavPackProperties> {
    const p = new WavPackProperties(readStyle);
    await p.read(file, streamLength);
    return p;
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
  // WavPack-specific
  // ---------------------------------------------------------------------------

  /**
   * WavPack stream version number read from the block header.
   * @returns The stream version (e.g. `0x407`).
   */
  get version(): number {
    return this._version;
  }

  /**
   * Bits per sample (bit depth) of the audio stream.
   * @returns Bit depth (e.g. `16`, `24`, `32`).
   */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /**
   * Whether the stream is losslessly encoded.
   * @returns `true` for lossless, `false` for hybrid (lossy) mode.
   */
  get isLossless(): boolean {
    return this._lossless;
  }

  /**
   * Whether the stream contains DSD (Direct Stream Digital) audio.
   * @returns `true` for DSD audio, `false` for standard PCM.
   */
  get isDsd(): boolean {
    return this._dsd;
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
   * Walks WavPack block headers from the start of the file to populate all fields.
   * @param file - Open file handle positioned at byte 0.
   * @param streamLength - Byte length of the audio stream (excluding tags).
   */
  private async read(file: File, streamLength: offset_t): Promise<void> {
    const wvpk = ByteVector.fromString("wvpk", StringType.Latin1);
    let offset: offset_t = 0;

    while (true) {
      await file.seek(offset);
      const data = await file.readBlock(HeaderSize);

      if (data.length < HeaderSize) break;
      if (!data.startsWith(wvpk)) break;

      const blockSize = data.toUInt(4, false);
      const smplFrames = data.toUInt(12, false);
      const blockSamples = data.toUInt(20, false);
      const flags = data.toUInt(24, false);
      let smplRate = sampleRates[(flags & SRATE_MASK) >>> SRATE_LSB];

      if (blockSize < 24 || blockSize > 1048576) break;

      if (!blockSamples) {
        // Ignore blocks with no samples
        offset += blockSize + 8;
        continue;
      }

      // For non-standard sample rates or DSD audio, parse the block body
      if (!smplRate || (flags & DSD_FLAG)) {
        const adjustedBlockSize = blockSize - 24;
        const block = await file.readBlock(adjustedBlockSize);

        if (block.length < adjustedBlockSize) break;

        if (!smplRate) {
          smplRate = getNonStandardRate(block);
        }

        if (smplRate && (flags & DSD_FLAG)) {
          smplRate <<= getDsdRateShifter(block);
        }
      }

      if (flags & INITIAL_BLOCK) {
        this._version = data.toShort(8, false);
        if (this._version < MIN_STREAM_VERS || this._version > MAX_STREAM_VERS)
          break;

        this._bitsPerSample =
          ((flags & BYTES_STORED) + 1) * 8 -
          ((flags & SHIFT_MASK) >>> SHIFT_LSB);
        this._sampleRate = smplRate;
        this._lossless = !(flags & HYBRID_FLAG);
        this._dsd = (flags & DSD_FLAG) !== 0;
        this._sampleFrames = smplFrames;
      }

      this._channels += flags & MONO_FLAG ? 1 : 2;

      if (flags & FINAL_BLOCK) break;

      offset += blockSize + 8;
    }

    // 0xFFFFFFFF means the frame count is unknown — seek backward for it
    if (this._sampleFrames === 0xffffffff) {
      this._sampleFrames = await this.seekFinalIndex(file, streamLength);
    }

    if (this._sampleFrames > 0 && this._sampleRate > 0) {
      const length = (this._sampleFrames * 1000.0) / this._sampleRate;
      this._lengthInMs = Math.round(length);
      this._bitrate = Math.round((streamLength * 8.0) / length);
    }
  }

  /**
   * Searches backward from `streamLength` for the last valid WavPack block
   * to determine the true total sample count when the header reports `0xFFFFFFFF`.
   * @param file - Open file handle.
   * @param streamLength - Byte offset to begin the backward search from.
   * @returns The total sample frame count, or `0` if it cannot be determined.
   */
  private async seekFinalIndex(file: File, streamLength: offset_t): Promise<number> {
    const wvpk = ByteVector.fromString("wvpk", StringType.Latin1);
    let offset = streamLength;

    while (offset >= HeaderSize) {
      offset = await file.rfind(wvpk, offset - 4);
      if (offset === -1) return 0;

      await file.seek(offset);
      const data = await file.readBlock(HeaderSize);
      if (data.length < HeaderSize) return 0;

      const blockSize = data.toUInt(4, false);
      const blockIndex = data.toUInt(16, false);
      const blockSamples = data.toUInt(20, false);
      const flags = data.toUInt(24, false);
      const vers = data.toShort(8, false);

      // Validate to avoid spurious "wvpk" matches in binary data
      if (
        vers < MIN_STREAM_VERS ||
        vers > MAX_STREAM_VERS ||
        blockSize & 1 ||
        blockSize < 24 ||
        blockSize >= 1048576 ||
        blockSamples > 131072
      ) {
        continue;
      }

      if (blockSamples && flags & FINAL_BLOCK) {
        return blockIndex + blockSamples;
      }
    }

    return 0;
  }
}
