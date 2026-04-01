/** @file Audio properties for the Ogg Opus format, parsed from the OpusHead identification header (packet 0). */

import { AudioProperties } from "../../audioProperties.js";
import { ByteVector, StringType } from "../../byteVector.js";
import { ReadStyle } from "../../toolkit/types.js";
import type { OggFile } from "../oggFile.js";

/** The 8-byte Opus identification header magic "OpusHead". */
const OPUS_HEAD = ByteVector.fromString("OpusHead", StringType.Latin1);

/**
 * Audio properties for Ogg Opus files, parsed from the OpusHead identification
 * header (packet 0).
 *
 * OpusHead layout:
 *   "OpusHead"(8) + version(1) + channels(1) + preSkip(2 LE) +
 *   inputSampleRate(4 LE) + outputGain(2 LE signed) +
 *   channelMappingFamily(1)
 */
export class OpusProperties extends AudioProperties {
  /** Stream duration in milliseconds, computed from first and last granule positions. */
  private _lengthInMs: number = 0;
  /** Average bitrate in kilobits per second, computed from stream length and duration. */
  private _bitrate: number = 0;
  /** Number of audio channels as declared in the OpusHead header. */
  private _channels: number = 0;
  /** Opus encoder version byte from the OpusHead header. */
  private _opusVersion: number = 0;
  /** Original input sample rate before Opus encoding, in Hz. */
  private _inputSampleRate: number = 0;
  /** Output gain in signed Q7.8 fixed-point format (divide by 256.0 to get dB). */
  private _outputGain: number = 0;

  /**
   * Constructs an OpusProperties instance with the given read style.
   * @param readStyle - Level of detail for property parsing.
   */
  constructor(readStyle: ReadStyle = ReadStyle.Average) {
    super(readStyle);
  }

  /**
   * Asynchronously parse and return audio properties from the given Ogg Opus file.
   * @param file - The {@link OggFile} to read properties from.
   * @param readStyle - Level of detail for property parsing.
   * @returns A populated {@link OpusProperties} instance.
   */
  static async create(
    file: OggFile,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<OpusProperties> {
    const props = new OpusProperties(readStyle);
    await props.read(file);
    return props;
  }

  // ---------------------------------------------------------------------------
  // AudioProperties interface
  // ---------------------------------------------------------------------------

  /** Stream duration in milliseconds, computed from first and last granule positions. */
  get lengthInMilliseconds(): number {
    return this._lengthInMs;
  }

  /** Average bitrate in kilobits per second, computed from stream length and duration. */
  override get bitrate(): number {
    return this._bitrate;
  }

  /** Opus always decodes at 48000 Hz regardless of the original input sample rate. */
  override get sampleRate(): number {
    return 48000;
  }

  /** Number of audio channels as declared in the OpusHead header. */
  get channels(): number {
    return this._channels;
  }

  // ---------------------------------------------------------------------------
  // Opus-specific
  // ---------------------------------------------------------------------------

  /** Opus encoder version byte from the OpusHead header (major version in bits 4–7). */
  get opusVersion(): number {
    return this._opusVersion;
  }

  /** Original sample rate of the input audio before Opus encoding, in Hz. */
  get inputSampleRate(): number {
    return this._inputSampleRate;
  }

  /**
   * Output gain in signed Q7.8 fixed-point format.
   * Divide by 256.0 to convert to dB.
   */
  get outputGain(): number {
    return this._outputGain;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Reads and populates audio properties from the OpusHead identification header (packet 0).
   * @param file - The {@link OggFile} to read from.
   */
  private async read(file: OggFile): Promise<void> {
    const data = await file.packet(0);

    // Minimum OpusHead is 19 bytes
    if (data.length < 19) {
      return;
    }

    if (!data.startsWith(OPUS_HEAD)) {
      return;
    }

    this._opusVersion = data.get(8);
    this._channels = data.get(9);
    const preSkip = data.toUShort(10, false);
    this._inputSampleRate = data.toUInt(12, false);
    this._outputGain = data.toShort(16, false);

    // Compute duration from granule positions (Opus uses 48 kHz granule clock).
    // Matches C++: subtracts preSkip and 2 mandatory header packet sizes.
    const first = await file.firstPageHeader();
    const last = await file.lastPageHeader();

    if (first && last) {
      const start = first.granulePosition;
      const end = last.granulePosition;

      if (start >= 0n && end >= 0n) {
        const frameCount = end - start - BigInt(preSkip);
        if (frameCount > 0n) {
          const durationMs = Number(frameCount) * 1000.0 / 48000.0;
          this._lengthInMs = Math.trunc(durationMs + 0.5);

          // Subtract the 2 mandatory Opus header packets from file length.
          let fileLengthWithoutOverhead = await file.fileLength();
          for (let i = 0; i < 2; i++) {
            const pkt = await file.packet(i);
            fileLengthWithoutOverhead -= pkt.length;
          }

          if (this._lengthInMs > 0) {
            this._bitrate = Math.trunc(
              (fileLengthWithoutOverhead * 8.0) / durationMs + 0.5,
            );
          }
        }
      }
    }
  }
}
