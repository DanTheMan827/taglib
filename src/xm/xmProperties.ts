/** @file Audio properties for Extended Module (XM) tracker files. */

import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for Extended Module (XM) files.
 *
 * XM is a tracker module format; it has no defined playback duration in
 * milliseconds. The properties describe the module structure (channels,
 * patterns, instruments, and tempo settings).
 */
export class XmProperties extends AudioProperties {
  /** Number of channels used by the module. */
  private _channels: number = 0;
  /** Number of entries in the pattern order table (song length in patterns). */
  private _lengthInPatterns: number = 0;
  /** XM format version number (e.g. `0x0104`). */
  private _version: number = 0;
  /** Pattern order table index to restart at when the song loops. */
  private _restartPosition: number = 0;
  /** Total number of patterns stored in the file. */
  private _patternCount: number = 0;
  /** Total number of instruments declared in the file. */
  private _instrumentCount: number = 0;
  /** Total number of samples across all instruments. */
  private _sampleCount: number = 0;
  /** Raw flags word from the XM header (bit 0: linear frequency table). */
  private _flags: number = 0;
  /** Default tempo (ticks per row). */
  private _tempo: number = 0;
  /** Default BPM speed (beats per minute). */
  private _bpmSpeed: number = 0;

  /**
   * Constructs a new `XmProperties` instance.
   * @param readStyle - The level of detail used when parsing audio properties.
   */
  constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  /**
   * Returns the duration of the track in milliseconds.
   * XM files have no defined playback duration; always returns `0`.
   * @returns `0`.
   */
  get lengthInMilliseconds(): number {
    return 0;
  }

  /**
   * Returns the number of channels used by the module.
   * @returns The channel count.
   */
  get channels(): number {
    return this._channels;
  }

  /**
   * Sets the number of channels.
   * @param value - The channel count.
   */
  set channels(value: number) {
    this._channels = value;
  }

  /**
   * Returns the number of entries in the pattern order table.
   * @returns The song length in patterns.
   */
  get lengthInPatterns(): number {
    return this._lengthInPatterns;
  }

  /**
   * Sets the number of entries in the pattern order table.
   * @param value - The song length in patterns.
   */
  set lengthInPatterns(value: number) {
    this._lengthInPatterns = value;
  }

  /**
   * Returns the XM format version number (e.g. `0x0104` for v1.04).
   * @returns The version word.
   */
  get version(): number {
    return this._version;
  }

  /**
   * Sets the XM format version number.
   * @param value - The version word.
   */
  set version(value: number) {
    this._version = value;
  }

  /**
   * Returns the pattern order table index at which the song restarts when looping.
   * @returns The restart position.
   */
  get restartPosition(): number {
    return this._restartPosition;
  }

  /**
   * Sets the restart position.
   * @param value - The pattern order table index to restart at.
   */
  set restartPosition(value: number) {
    this._restartPosition = value;
  }

  /**
   * Returns the total number of patterns stored in the file.
   * @returns The pattern count.
   */
  get patternCount(): number {
    return this._patternCount;
  }

  /**
   * Sets the total number of patterns.
   * @param value - The pattern count.
   */
  set patternCount(value: number) {
    this._patternCount = value;
  }

  /**
   * Returns the total number of instruments declared in the file.
   * @returns The instrument count.
   */
  get instrumentCount(): number {
    return this._instrumentCount;
  }

  /**
   * Sets the total number of instruments.
   * @param value - The instrument count.
   */
  set instrumentCount(value: number) {
    this._instrumentCount = value;
  }

  /**
   * Returns the total number of samples across all instruments.
   * @returns The sample count.
   */
  get sampleCount(): number {
    return this._sampleCount;
  }

  /**
   * Sets the total number of samples.
   * @param value - The sample count.
   */
  set sampleCount(value: number) {
    this._sampleCount = value;
  }

  /**
   * Returns the raw flags word from the XM header.
   * Bit 0 selects between linear and Amiga frequency tables.
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
   * Returns the default tempo in ticks per row.
   * @returns The tempo value.
   */
  get tempo(): number {
    return this._tempo;
  }

  /**
   * Sets the default tempo.
   * @param value - The tempo (ticks per row).
   */
  set tempo(value: number) {
    this._tempo = value;
  }

  /**
   * Returns the default BPM speed (beats per minute).
   * @returns The BPM speed.
   */
  get bpmSpeed(): number {
    return this._bpmSpeed;
  }

  /**
   * Sets the default BPM speed.
   * @param value - The BPM speed (beats per minute).
   */
  set bpmSpeed(value: number) {
    this._bpmSpeed = value;
  }
}
