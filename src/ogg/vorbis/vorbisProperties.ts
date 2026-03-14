import { AudioProperties } from "../../audioProperties.js";
import { ByteVector, StringType } from "../../byteVector.js";
import { ReadStyle } from "../../toolkit/types.js";
import type { OggFile } from "../oggFile.js";

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
  private _lengthInMs: number = 0;
  private _bitrate: number = 0;
  private _sampleRate: number = 0;
  private _channels: number = 0;
  private _vorbisVersion: number = 0;
  private _bitrateMaximum: number = 0;
  private _bitrateNominal: number = 0;
  private _bitrateMinimum: number = 0;

  constructor(file: OggFile, readStyle: ReadStyle = ReadStyle.Average) {
    super(readStyle);
    this.read(file);
  }

  // ---------------------------------------------------------------------------
  // AudioProperties interface
  // ---------------------------------------------------------------------------

  get lengthInMilliseconds(): number {
    return this._lengthInMs;
  }

  override get bitrate(): number {
    return this._bitrate;
  }

  override get sampleRate(): number {
    return this._sampleRate;
  }

  get channels(): number {
    return this._channels;
  }

  // ---------------------------------------------------------------------------
  // Vorbis-specific
  // ---------------------------------------------------------------------------

  get vorbisVersion(): number {
    return this._vorbisVersion;
  }

  get bitrateMaximum(): number {
    return this._bitrateMaximum;
  }

  get bitrateNominal(): number {
    return this._bitrateNominal;
  }

  get bitrateMinimum(): number {
    return this._bitrateMinimum;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private read(file: OggFile): void {
    const data = file.packet(0);

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

    // Compute duration from granule positions of first and last pages
    if (this._sampleRate > 0) {
      const first = file.firstPageHeader();
      const last = file.lastPageHeader();

      if (first && last) {
        const totalSamples = last.granulePosition - first.granulePosition;
        if (totalSamples > 0n) {
          const durationMs =
            Number(totalSamples) * 1000.0 / this._sampleRate;
          this._lengthInMs = Math.round(durationMs);

          // Compute average bitrate from stream length
          const streamLength = file.fileLength;
          if (this._lengthInMs > 0) {
            this._bitrate = Math.round(
              (streamLength * 8.0) / durationMs,
            );
          }
        }
      }

      // Fall back to nominal bitrate if we couldn't compute one
      if (this._bitrate === 0 && this._bitrateNominal > 0) {
        this._bitrate = Math.round(this._bitrateNominal / 1000);
      }
    }
  }
}
