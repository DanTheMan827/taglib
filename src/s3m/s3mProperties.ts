/** @file Audio properties for ScreamTracker III (S3M) module files. */

import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for ScreamTracker III (S3M) files.
 *
 * S3M is a tracker module format; it has no defined playback duration in
 * milliseconds. The properties describe module layout rather than a
 * continuous audio stream.
 */
export class S3mProperties extends AudioProperties {
  /** Number of active channels in the module. */
  private _channels: number = 0;
  /** Number of orders (non-skip, non-end entries) in the play sequence. */
  private _lengthInPatterns: number = 0;
  /** Whether the module uses stereo output (master volume byte bit 7). */
  private _stereo: boolean = false;
  /** Total number of samples/instruments declared in the module header. */
  private _sampleCount: number = 0;
  /** Total number of pattern slots in the module header. */
  private _patternCount: number = 0;
  /** Raw flags word from the S3M header. */
  private _flags: number = 0;
  /** Tracker version encoded in the header (e.g. `0x1320` for ST3 v3.20). */
  private _trackerVersion: number = 0;
  /** File format version byte from the header. */
  private _fileFormatVersion: number = 0;
  /** Global volume level (0–64). */
  private _globalVolume: number = 0;
  /** Master output volume (0–127; bit 7 is the stereo flag). */
  private _masterVolume: number = 0;
  /** Initial tempo, expressed as rows per beat. */
  private _tempo: number = 0;
  /** Initial BPM speed (beats per minute). */
  private _bpmSpeed: number = 0;

  /**
   * Constructs a new `S3mProperties` instance.
   * @param readStyle - The level of detail used when parsing audio properties.
   */
  constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  /**
   * Returns the duration of the track in milliseconds.
   * S3M files have no defined playback duration; always returns `0`.
   * @returns `0`.
   */
  get lengthInMilliseconds(): number {
    return 0;
  }

  /**
   * Returns the number of active channels in the module.
   * @returns The channel count.
   */
  get channels(): number {
    return this._channels;
  }

  /**
   * Sets the number of active channels.
   * @param value - The channel count.
   */
  set channels(value: number) {
    this._channels = value;
  }

  /**
   * Returns the number of orders in the play sequence (real pattern length).
   * @returns The order count.
   */
  get lengthInPatterns(): number {
    return this._lengthInPatterns;
  }

  /**
   * Sets the number of orders in the play sequence.
   * @param value - The order count.
   */
  set lengthInPatterns(value: number) {
    this._lengthInPatterns = value;
  }

  /**
   * Returns whether the module uses stereo output.
   * @returns `true` for stereo, `false` for mono.
   */
  get stereo(): boolean {
    return this._stereo;
  }

  /**
   * Sets whether the module uses stereo output.
   * @param value - `true` for stereo, `false` for mono.
   */
  set stereo(value: boolean) {
    this._stereo = value;
  }

  /**
   * Returns the total number of samples/instruments in the module.
   * @returns The sample count.
   */
  get sampleCount(): number {
    return this._sampleCount;
  }

  /**
   * Sets the total number of samples/instruments.
   * @param value - The sample count.
   */
  set sampleCount(value: number) {
    this._sampleCount = value;
  }

  /**
   * Returns the total number of pattern slots in the module header.
   * @returns The pattern count.
   */
  get patternCount(): number {
    return this._patternCount;
  }

  /**
   * Sets the total number of pattern slots.
   * @param value - The pattern count.
   */
  set patternCount(value: number) {
    this._patternCount = value;
  }

  /**
   * Returns the raw flags word from the S3M header.
   * @returns The flags value.
   */
  get flags(): number {
    return this._flags;
  }

  /**
   * Sets the raw flags word.
   * @param value - The flags value.
   */
  set flags(value: number) {
    this._flags = value;
  }

  /**
   * Returns the tracker version encoded in the S3M header.
   * @returns The tracker version word (e.g. `0x1320` for ST3 v3.20).
   */
  get trackerVersion(): number {
    return this._trackerVersion;
  }

  /**
   * Sets the tracker version word.
   * @param value - The tracker version word.
   */
  set trackerVersion(value: number) {
    this._trackerVersion = value;
  }

  /**
   * Returns the file format version byte from the S3M header.
   * @returns The file format version.
   */
  get fileFormatVersion(): number {
    return this._fileFormatVersion;
  }

  /**
   * Sets the file format version byte.
   * @param value - The file format version.
   */
  set fileFormatVersion(value: number) {
    this._fileFormatVersion = value;
  }

  /**
   * Returns the global volume level (0–64).
   * @returns The global volume.
   */
  get globalVolume(): number {
    return this._globalVolume;
  }

  /**
   * Sets the global volume level.
   * @param value - The global volume (0–64).
   */
  set globalVolume(value: number) {
    this._globalVolume = value;
  }

  /**
   * Returns the master output volume (0–127; bit 7 is the stereo flag).
   * @returns The master volume.
   */
  get masterVolume(): number {
    return this._masterVolume;
  }

  /**
   * Sets the master output volume.
   * @param value - The master volume (0–127).
   */
  set masterVolume(value: number) {
    this._masterVolume = value;
  }

  /**
   * Returns the initial tempo, expressed as rows per beat.
   * @returns The tempo value.
   */
  get tempo(): number {
    return this._tempo;
  }

  /**
   * Sets the initial tempo.
   * @param value - The tempo (rows per beat).
   */
  set tempo(value: number) {
    this._tempo = value;
  }

  /**
   * Returns the initial BPM speed (beats per minute).
   * @returns The BPM speed.
   */
  get bpmSpeed(): number {
    return this._bpmSpeed;
  }

  /**
   * Sets the initial BPM speed.
   * @param value - The BPM speed (beats per minute).
   */
  set bpmSpeed(value: number) {
    this._bpmSpeed = value;
  }
}
