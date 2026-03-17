/** @file Audio properties implementation for the Monkey's Audio (APE) format. */

import { AudioProperties } from "../audioProperties.js";
import { ByteVector, StringType } from "../byteVector.js";
import type { offset_t, ReadStyle } from "../toolkit/types.js";
import { Position } from "../toolkit/types.js";
import type { File } from "../file.js";

// =============================================================================
// ApeProperties
// =============================================================================

/**
 * Audio properties for Monkey's Audio (APE) streams.
 *
 * Supports both current (v3980+) and legacy header formats.  Current
 * versions use a 44-byte descriptor followed by a 24-byte header; older
 * versions use a 26-byte header with embedded WAV format info.
 */
export class ApeProperties extends AudioProperties {
  /** APE format version (e.g. 3990, 3980, 3800). */
  private _version: number = 0;
  /** Duration of the stream in milliseconds. */
  private _lengthInMs: number = 0;
  /** Average bitrate in kb/s. */
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
   * @param readStyle - Level of detail to use when reading properties.
   */
  private constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  /**
   * Asynchronously create and populate an {@link ApeProperties} instance by
   * reading from `file`.
   *
   * @param file - The file to read from (positioned at or near the APE header).
   * @param streamLength - Byte length of the audio stream, used to compute bitrate.
   * @param readStyle - Level of detail to use when reading properties.
   * @returns A resolved promise containing the populated properties object.
   */
  static async create(file: File, streamLength: offset_t, readStyle: ReadStyle): Promise<ApeProperties> {
    const p = new ApeProperties(readStyle);
    await p.read(file, streamLength);
    return p;
  }

  // ---------------------------------------------------------------------------
  // AudioProperties interface
  // ---------------------------------------------------------------------------

  /** Duration of the audio stream in milliseconds. */
  get lengthInMilliseconds(): number {
    return this._lengthInMs;
  }

  /** Average bitrate of the stream in kb/s. */
  override get bitrate(): number {
    return this._bitrate;
  }

  /** Sample rate of the stream in Hz. */
  override get sampleRate(): number {
    return this._sampleRate;
  }

  /** Number of audio channels. */
  get channels(): number {
    return this._channels;
  }

  // ---------------------------------------------------------------------------
  // APE-specific
  // ---------------------------------------------------------------------------

  /** APE format version number (e.g. 3990 for v3.99). */
  get version(): number {
    return this._version;
  }

  /** Bits per sample (bit depth) of the audio stream. */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /** Total number of PCM sample frames in the stream. */
  get sampleFrames(): number {
    return this._sampleFrames;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Locate the APE descriptor/header in `file` and populate all fields.
   *
   * @param file - Open file handle to read from.
   * @param streamLength - Length of the raw audio stream in bytes.
   */
  private async read(file: File, streamLength: offset_t): Promise<void> {
    let offset = await file.tell();
    let vers = this.headerVersion(await file.readBlock(6));

    // If the descriptor isn't at the current position, search for it
    if (vers < 0) {
      const mac = ByteVector.fromString("MAC ", StringType.Latin1);
      offset = await file.find(mac, offset);
      if (offset < 0) return;
      await file.seek(offset);
      vers = this.headerVersion(await file.readBlock(6));
    }

    if (vers < 0) return;

    this._version = vers;

    if (this._version >= 3980) {
      await this.analyzeCurrent(file);
    } else {
      await this.analyzeOld(file);
    }

    if (this._sampleFrames > 0 && this._sampleRate > 0) {
      const length = (this._sampleFrames * 1000.0) / this._sampleRate;
      this._lengthInMs = Math.round(length);
      this._bitrate = Math.round((streamLength * 8.0) / length);
    }
  }

  /**
   * Extract the APE version number from a 6-byte header block.
   *
   * @param header - Six bytes starting with the "MAC " identifier.
   * @returns The 16-bit version field, or `-1` if the block is not a valid APE header.
   */
  private headerVersion(header: ByteVector): number {
    if (header.length < 6) return -1;
    const mac = ByteVector.fromString("MAC ", StringType.Latin1);
    if (!header.startsWith(mac)) return -1;
    return header.toUShort(4, false);
  }

  /**
   * Parse the current (v3980+) format: 44-byte descriptor + 24-byte header.
   */
  private async analyzeCurrent(file: File): Promise<void> {
    // Skip 2 bytes (padding after version in 6-byte read)
    await file.seek(2, Position.Current);

    const descriptor = await file.readBlock(44);
    if (descriptor.length < 44) return;

    // The descriptor tells us how many bytes the descriptor block occupies.
    // If it's larger than the 52 bytes we've already consumed (6 + 2 + 44),
    // skip ahead.
    const descriptorBytes = descriptor.toUInt(0, false);
    if (descriptorBytes > 52) {
      await file.seek(descriptorBytes - 52, Position.Current);
    }

    const header = await file.readBlock(24);
    if (header.length < 24) return;

    this._channels = header.toShort(18, false);
    this._sampleRate = header.toUInt(20, false);
    this._bitsPerSample = header.toShort(16, false);

    const totalFrames = header.toUInt(12, false);
    if (totalFrames === 0) return;

    const blocksPerFrame = header.toUInt(4, false);
    const finalFrameBlocks = header.toUInt(8, false);
    this._sampleFrames = (totalFrames - 1) * blocksPerFrame + finalFrameBlocks;
  }

  /**
   * Parse older (pre-3980) format: 26-byte header + WAV fmt chunk.
   */
  private async analyzeOld(file: File): Promise<void> {
    const header = await file.readBlock(26);
    if (header.length < 26) return;

    const totalFrames = header.toUInt(18, false);
    if (totalFrames === 0) return;

    const compressionLevel = header.toShort(0, false);
    let blocksPerFrame: number;
    if (this._version >= 3950) {
      blocksPerFrame = 73728 * 4;
    } else if (
      this._version >= 3900 ||
      (this._version >= 3800 && compressionLevel === 4000)
    ) {
      blocksPerFrame = 73728;
    } else {
      blocksPerFrame = 9216;
    }

    this._channels = header.toShort(4, false);
    this._sampleRate = header.toUInt(6, false);

    const finalFrameBlocks = header.toUInt(22, false);
    this._sampleFrames = (totalFrames - 1) * blocksPerFrame + finalFrameBlocks;

    // Read bit depth from the RIFF-fmt chunk (16 bytes after header, then 28-byte fmt)
    await file.seek(16, Position.Current);
    const fmt = await file.readBlock(28);
    if (fmt.length < 28) return;

    const waveFmt = ByteVector.fromString("WAVEfmt ", StringType.Latin1);
    if (!fmt.startsWith(waveFmt)) return;

    this._bitsPerSample = fmt.toShort(26, false);
  }
}
