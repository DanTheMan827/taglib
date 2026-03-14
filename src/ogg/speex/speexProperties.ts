import { AudioProperties } from "../../audioProperties.js";
import { ByteVector, StringType } from "../../byteVector.js";
import { ReadStyle } from "../../toolkit/types.js";
import type { OggFile } from "../oggFile.js";

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
  private _lengthInMs: number = 0;
  private _bitrate: number = 0;
  private _sampleRate: number = 0;
  private _channels: number = 0;

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
  // Private
  // ---------------------------------------------------------------------------

  private read(file: OggFile): void {
    const data = file.packet(0);

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
    const headerBitrate = data.toInt(52, false);

    // Compute duration from granule positions
    if (this._sampleRate > 0) {
      const first = file.firstPageHeader();
      const last = file.lastPageHeader();

      if (first && last) {
        const totalSamples = last.granulePosition - first.granulePosition;
        if (totalSamples > 0n) {
          const durationMs =
            Number(totalSamples) * 1000.0 / this._sampleRate;
          this._lengthInMs = Math.round(durationMs);

          const streamLength = file.fileLength;
          if (this._lengthInMs > 0) {
            this._bitrate = Math.round(
              (streamLength * 8.0) / durationMs,
            );
          }
        }
      }

      // Fall back to header bitrate
      if (this._bitrate === 0 && headerBitrate > 0) {
        this._bitrate = Math.round(headerBitrate / 1000);
      }
    }
  }
}
