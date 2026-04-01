/** @file Audio properties for the Ogg Vorbis format, parsed from the identification header (packet 0). */

import { AudioProperties } from "../../audioProperties.js";
import { ByteVector, StringType } from "../../byteVector.js";
import { ReadStyle } from "../../toolkit/types.js";
import type { OggFile } from "../oggFile.js";

/** The 6-byte Vorbis bitstream identifier "vorbis" (without the leading packet-type byte). */
const VORBIS_ID = ByteVector.fromString("vorbis", StringType.Latin1);

/**
 * Audio properties for Ogg Vorbis files, parsed from the identification
 * header (packet 0).
 *
 * Identification header layout:
 *   packetType(1) + "vorbis"(6) + vorbisVersion(4 LE) + channels(1) +
 *   sampleRate(4 LE) + bitrateMax(4 LE signed) + bitrateNom(4 LE signed) +
 *   bitrateMin(4 LE signed) + blockSizes(1) + framingFlag(1)
 */
export class VorbisProperties extends AudioProperties {
  /** Stream duration in milliseconds, computed from first and last granule positions. */
  private _lengthInMs: number = 0;
  /** Average bitrate in kilobits per second. */
  private _bitrate: number = 0;
  /** Sample rate in Hz as declared in the identification header. */
  private _sampleRate: number = 0;
  /** Number of audio channels as declared in the identification header. */
  private _channels: number = 0;
  /** Vorbis codec version; `0` for all Vorbis I streams. */
  private _vorbisVersion: number = 0;
  /** Maximum bitrate in bits per second declared in the identification header; `0` if not set. */
  private _bitrateMaximum: number = 0;
  /** Nominal bitrate in bits per second declared in the identification header; `0` if not set. */
  private _bitrateNominal: number = 0;
  /** Minimum bitrate in bits per second declared in the identification header; `0` if not set. */
  private _bitrateMinimum: number = 0;

  /**
   * Constructs a VorbisProperties instance with the given read style.
   * @param readStyle - Level of detail for property parsing.
   */
  constructor(readStyle: ReadStyle = ReadStyle.Average) {
    super(readStyle);
  }

  /**
   * Asynchronously parse and return audio properties from the given Ogg Vorbis file.
   * @param file - The {@link OggFile} to read properties from.
   * @param readStyle - Level of detail for property parsing.
   * @returns A populated {@link VorbisProperties} instance.
   */
  static async create(
    file: OggFile,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<VorbisProperties> {
    const props = new VorbisProperties(readStyle);
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

  /** Average bitrate in kilobits per second, or the nominal bitrate as a fallback. */
  override get bitrate(): number {
    return this._bitrate;
  }

  /** Sample rate in Hz as declared in the Vorbis identification header. */
  override get sampleRate(): number {
    return this._sampleRate;
  }

  /** Number of audio channels as declared in the Vorbis identification header. */
  get channels(): number {
    return this._channels;
  }

  // ---------------------------------------------------------------------------
  // Vorbis-specific
  // ---------------------------------------------------------------------------

  /** Vorbis codec version; `0` for all current Vorbis I streams. */
  get vorbisVersion(): number {
    return this._vorbisVersion;
  }

  /** Maximum bitrate in bits per second declared in the identification header; `0` if not set. */
  get bitrateMaximum(): number {
    return this._bitrateMaximum;
  }

  /** Nominal bitrate in bits per second declared in the identification header; `0` if not set. */
  get bitrateNominal(): number {
    return this._bitrateNominal;
  }

  /** Minimum bitrate in bits per second declared in the identification header; `0` if not set. */
  get bitrateMinimum(): number {
    return this._bitrateMinimum;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Reads and populates audio properties from the Vorbis identification header (packet 0).
   * @param file - The {@link OggFile} to read from.
   */
  private async read(file: OggFile): Promise<void> {
    const data = await file.packet(0);

    // Minimum identification header is 30 bytes
    if (data.length < 30) {
      return;
    }

    // Byte 0: packet type must be 0x01
    if (data.get(0) !== 0x01) {
      return;
    }

    // Bytes 1–6: "vorbis"
    if (!data.containsAt(VORBIS_ID, 1)) {
      return;
    }

    this._vorbisVersion = data.toUInt(7, false);
    this._channels = data.get(11);
    this._sampleRate = data.toUInt(12, false);
    this._bitrateMaximum = data.toInt(16, false);
    this._bitrateNominal = data.toInt(20, false);
    this._bitrateMinimum = data.toInt(24, false);

    // Compute duration from granule positions of first and last pages.
    // Matches C++: subtracts 3 initial header packet sizes from file length for bitrate.
    if (this._sampleRate > 0) {
      const first = await file.firstPageHeader();
      const last = await file.lastPageHeader();

      if (first && last) {
        const frameCount = last.granulePosition - first.granulePosition;
        if (frameCount > 0n) {
          const durationMs = Number(frameCount) * 1000.0 / this._sampleRate;
          this._lengthInMs = Math.trunc(durationMs + 0.5);

          // Subtract the 3 Vorbis header packets (identification, comment, setup)
          // from the file size before computing bitrate, matching C++ behaviour.
          let fileLengthWithoutOverhead = await file.fileLength();
          for (let i = 0; i < 3; i++) {
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

      // Fall back to nominal bitrate if we couldn't compute one.
      if (this._bitrate === 0 && this._bitrateNominal > 0) {
        this._bitrate = Math.trunc(this._bitrateNominal / 1000.0 + 0.5);
      }
    }
  }
}
