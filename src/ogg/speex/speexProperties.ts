/** @file Audio properties for the Ogg Speex format, parsed from the Speex identification header (packet 0). */

import { AudioProperties } from "../../audioProperties.js";
import { ByteVector, StringType } from "../../byteVector.js";
import { ReadStyle } from "../../toolkit/types.js";
import type { OggFile } from "../oggFile.js";

/** The 8-byte Speex identification header magic "Speex   " (with three trailing spaces). */
const SPEEX_HEADER = ByteVector.fromString("Speex   ", StringType.Latin1);

/**
 * Audio properties for Ogg Speex files, parsed from the Speex identification
 * header (packet 0).
 *
 * Speex header layout:
 *   "Speex   "(8) + speexVersion(20) + speexVersionId(4 LE) +
 *   headerSize(4 LE) + rate(4 LE) + mode(4 LE) +
 *   modeBitstreamVersion(4 LE) + nbChannels(4 LE) + bitrate(4 LE) +
 *   frameSize(4 LE) + vbr(4 LE) + framesPerPacket(4 LE)
 */
export class SpeexProperties extends AudioProperties {
  /** Stream duration in milliseconds, computed from first and last granule positions. */
  private _lengthInMs: number = 0;
  /** Average bitrate in kilobits per second, computed from stream data. */
  private _bitrate: number = 0;
  /** Sample rate in Hz as declared in the Speex identification header. */
  private _sampleRate: number = 0;
  /** Number of audio channels as declared in the Speex identification header. */
  private _channels: number = 0;
  /** Nominal bitrate from the Speex header in bits per second; `-1` for VBR, `0` if unset. */
  private _bitrateNominal: number = 0;

  /**
   * Constructs a SpeexProperties instance with the given read style.
   * @param readStyle - Level of detail for property parsing.
   */
  constructor(readStyle: ReadStyle = ReadStyle.Average) {
    super(readStyle);
  }

  /**
   * Asynchronously parse and return audio properties from the given Ogg Speex file.
   * @param file - The {@link OggFile} to read properties from.
   * @param readStyle - Level of detail for property parsing.
   * @returns A populated {@link SpeexProperties} instance.
   */
  static async create(
    file: OggFile,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<SpeexProperties> {
    const props = new SpeexProperties(readStyle);
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

  /** Average bitrate in kilobits per second, computed from audio data size and duration. */
  override get bitrate(): number {
    return this._bitrate;
  }

  /** Sample rate in Hz as declared in the Speex identification header. */
  override get sampleRate(): number {
    return this._sampleRate;
  }

  /** Number of audio channels as declared in the Speex identification header. */
  get channels(): number {
    return this._channels;
  }

  /**
   * Nominal bitrate from the Speex header in bits per second.
   * `-1` indicates variable-bitrate (VBR); `0` indicates not set.
   */
  get bitrateNominal(): number {
    return this._bitrateNominal;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Reads and populates audio properties from the Speex identification header (packet 0).
   * @param file - The {@link OggFile} to read from.
   */
  private async read(file: OggFile): Promise<void> {
    const data = await file.packet(0);

    // Minimum Speex header: 8 + 20 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 = 68 bytes
    if (data.length < 68) {
      return;
    }

    if (!data.startsWith(SPEEX_HEADER)) {
      return;
    }

    // Offsets within the Speex header (all little-endian 32-bit):
    // 28: speexVersionId, 32: headerSize, 36: rate,
    // 40: mode, 44: modeBitstreamVersion, 48: nbChannels,
    // 52: bitrate, 56: frameSize, 60: vbr, 64: framesPerPacket
    this._sampleRate = data.toUInt(36, false);
    this._channels = data.toUInt(48, false);
    // bitrateNominal: from header; -1 = VBR, 0 = not specified.
    this._bitrateNominal = data.toInt(52, false);

    // Compute duration from granule positions.
    // Matches C++: subtracts 2 header packet sizes from file length for bitrate.
    if (this._sampleRate > 0) {
      const first = await file.firstPageHeader();
      const last = await file.lastPageHeader();

      if (first && last) {
        const frameCount = last.granulePosition - first.granulePosition;
        if (frameCount > 0n) {
          const durationMs = Number(frameCount) * 1000.0 / this._sampleRate;
          this._lengthInMs = Math.trunc(durationMs + 0.5);

          // Subtract the 2 Speex header packets from the file size.
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

      // Fall back to header bitrate (positive values only).
      if (this._bitrate === 0 && this._bitrateNominal > 0) {
        this._bitrate = Math.trunc(this._bitrateNominal / 1000.0 + 0.5);
      }
    }
  }
}
