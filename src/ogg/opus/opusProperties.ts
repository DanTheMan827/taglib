import { AudioProperties } from "../../audioProperties.js";
import { ByteVector, StringType } from "../../byteVector.js";
import { ReadStyle } from "../../toolkit/types.js";
import type { OggFile } from "../oggFile.js";

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
  private _lengthInMs: number = 0;
  private _bitrate: number = 0;
  private _channels: number = 0;
  private _opusVersion: number = 0;
  private _inputSampleRate: number = 0;

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

  /** Opus always decodes at 48000 Hz. */
  override get sampleRate(): number {
    return 48000;
  }

  get channels(): number {
    return this._channels;
  }

  // ---------------------------------------------------------------------------
  // Opus-specific
  // ---------------------------------------------------------------------------

  get opusVersion(): number {
    return this._opusVersion;
  }

  /** Original sample rate of the input audio before Opus encoding. */
  get inputSampleRate(): number {
    return this._inputSampleRate;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private read(file: OggFile): void {
    const data = file.packet(0);

    // Minimum OpusHead is 19 bytes
    if (data.length < 19) {
      return;
    }

    if (!data.startsWith(OPUS_HEAD)) {
      return;
    }

    this._opusVersion = data.get(8);
    this._channels = data.get(9);
    // preSkip at offset 10 (2 bytes LE) — used for duration calculation
    this._inputSampleRate = data.toUInt(12, false);

    // Compute duration from granule positions (Opus uses 48 kHz granule clock)
    const first = file.firstPageHeader();
    const last = file.lastPageHeader();

    if (first && last) {
      const totalSamples = last.granulePosition - first.granulePosition;
      if (totalSamples > 0n) {
        const durationMs = Number(totalSamples) * 1000.0 / 48000;
        this._lengthInMs = Math.round(durationMs);

        const streamLength = file.fileLength;
        if (this._lengthInMs > 0) {
          this._bitrate = Math.round(
            (streamLength * 8.0) / durationMs,
          );
        }
      }
    }
  }
}
