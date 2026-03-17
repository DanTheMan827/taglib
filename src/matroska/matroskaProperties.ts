/** @file Audio properties for Matroska/WebM files. */
import { AudioProperties } from "../audioProperties.js";
import { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for Matroska files (MKV, MKA, WebM).
 */
export class MatroskaProperties extends AudioProperties {
  /** Playback duration in milliseconds. */
  private _lengthMs: number = 0;
  /** Bitrate in kbit/s, or -1 if not yet computed. */
  private _bitrate: number = -1;
  /** Sample rate in Hz. */
  private _sampleRate: number = 0;
  /** Number of audio channels. */
  private _channels: number = 0;
  /** Bits per sample (bit depth), or 0 if unspecified. */
  private _bitsPerSample: number = 0;
  /** Codec identifier string (e.g. `"A_AAC"`, `"A_FLAC"`). */
  private _codecName: string = "";
  /** EBML DocType string (e.g. `"matroska"`, `"webm"`). */
  private _docType: string = "";
  /** EBML DocTypeVersion number. */
  private _docTypeVersion: number = 0;
  /** Segment title from the Info element. */
  private _title: string = "";
  /** Total file length in bytes, used for bitrate estimation. */
  private _fileLength: number = 0;

  /**
   * Construct audio properties with the given read style.
   * @param readStyle - Detail level for audio property parsing.
   */
  constructor(readStyle: ReadStyle = ReadStyle.Average) {
    super(readStyle);
  }

  /** Playback duration in milliseconds. */
  get lengthInMilliseconds(): number {
    return this._lengthMs;
  }

  /** Bitrate in kbit/s, computed lazily from file length and duration. */
  override get bitrate(): number {
    if (this._bitrate === -1) {
      this._bitrate = this._lengthMs !== 0
        ? Math.round(this._fileLength * 8 / this._lengthMs)
        : 0;
    }
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

  /** Bits per sample (bit depth), or 0 if unspecified. */
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }

  /** Codec identifier string (e.g. `"A_AAC"`, `"A_FLAC"`). */
  get codecName(): string {
    return this._codecName;
  }

  /** EBML DocType string (e.g. `"matroska"`, `"webm"`). */
  get docType(): string {
    return this._docType;
  }

  /** EBML DocTypeVersion number. */
  get docTypeVersion(): number {
    return this._docTypeVersion;
  }

  /** Segment title from the Info element. */
  get title(): string {
    return this._title;
  }

  // Setters used during parsing
  /** @param ms - Playback duration in milliseconds. */
  setLengthInMilliseconds(ms: number): void { this._lengthMs = ms; }
  /** @param rate - Sample rate in Hz. */
  setSampleRate(rate: number): void { this._sampleRate = rate; }
  /** @param ch - Number of audio channels. */
  setChannels(ch: number): void { this._channels = ch; }
  /** @param bits - Bits per sample (bit depth). */
  setBitsPerSample(bits: number): void { this._bitsPerSample = bits; }
  /** @param name - Codec identifier string. */
  setCodecName(name: string): void { this._codecName = name; }
  /** @param type - EBML DocType string. */
  setDocType(type: string): void { this._docType = type; }
  /** @param version - EBML DocTypeVersion number. */
  setDocTypeVersion(version: number): void { this._docTypeVersion = version; }
  /** @param title - Segment title. */
  setTitle(title: string): void { this._title = title; }
  /** @param length - Total file length in bytes. */
  setFileLength(length: number): void { this._fileLength = length; }
}
