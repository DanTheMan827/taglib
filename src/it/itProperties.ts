/** @file Audio properties for Impulse Tracker (IT) files. */
import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for Impulse Tracker (IT) files.
 */
export class ItProperties extends AudioProperties {
  // Flag constants
  /** Bit mask for the Stereo flag in the IT file header flags field. */
  static readonly Stereo = 0x01;
  /** Bit mask indicating that a message is attached (in the special field). */
  static readonly MessageAttached = 0x01;

  /** Number of active channels. */
  private _channels: number = 0;
  /** Number of non-skip, non-end orders (pattern sequence length). */
  private _lengthInPatterns: number = 0;
  /** Number of instruments in the file. */
  private _instrumentCount: number = 0;
  /** Number of samples in the file. */
  private _sampleCount: number = 0;
  /** Number of patterns in the file. */
  private _patternCount: number = 0;
  /** Tracker version that created the file. */
  private _version: number = 0;
  /** Minimum compatible tracker version required to play the file. */
  private _compatibleVersion: number = 0;
  /** Header flags bitfield. */
  private _flags: number = 0;
  /** Special flags bitfield (e.g. message attached). */
  private _special: number = 0;
  /** Global volume (0–128). */
  private _globalVolume: number = 0;
  /** Mix volume (0–128). */
  private _mixVolume: number = 0;
  /** Initial tempo in BPM. */
  private _tempo: number = 0;
  /** Initial speed (ticks per row). */
  private _bpmSpeed: number = 0;
  /** Panning separation (0–128). */
  private _panningSeparation: number = 0;
  /** Pitch wheel depth in semitones. */
  private _pitchWheelDepth: number = 0;

  /**
   * Construct audio properties with the given read style.
   * @param readStyle - Detail level for audio property parsing.
   */
  constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  /** Always 0; IT files do not provide a time-based duration. */
  get lengthInMilliseconds(): number {
    return 0;
  }

  /** Number of active audio channels. */
  get channels(): number {
    return this._channels;
  }

  /** @param value - Number of active audio channels. */
  set channels(value: number) {
    this._channels = value;
  }

  /** Pattern sequence length (number of active orders). */
  get lengthInPatterns(): number {
    return this._lengthInPatterns;
  }

  /** @param value - Pattern sequence length. */
  set lengthInPatterns(value: number) {
    this._lengthInPatterns = value;
  }

  /** `true` if the Stereo flag is set in the header flags field. */
  get stereo(): boolean {
    return (this._flags & ItProperties.Stereo) !== 0;
  }

  /** Number of instruments in the file. */
  get instrumentCount(): number {
    return this._instrumentCount;
  }

  /** @param value - Number of instruments. */
  set instrumentCount(value: number) {
    this._instrumentCount = value;
  }

  /** Number of samples in the file. */
  get sampleCount(): number {
    return this._sampleCount;
  }

  /** @param value - Number of samples. */
  set sampleCount(value: number) {
    this._sampleCount = value;
  }

  /** Number of patterns in the file. */
  get patternCount(): number {
    return this._patternCount;
  }

  /** @param value - Number of patterns. */
  set patternCount(value: number) {
    this._patternCount = value;
  }

  /** Tracker version that created the file. */
  get version(): number {
    return this._version;
  }

  /** @param value - Tracker version. */
  set version(value: number) {
    this._version = value;
  }

  /** Minimum compatible tracker version required to play the file. */
  get compatibleVersion(): number {
    return this._compatibleVersion;
  }

  /** @param value - Compatible tracker version. */
  set compatibleVersion(value: number) {
    this._compatibleVersion = value;
  }

  /** Header flags bitfield. */
  get flags(): number {
    return this._flags;
  }

  /** @param value - Header flags bitfield. */
  set flags(value: number) {
    this._flags = value;
  }

  /** Special flags bitfield (e.g. message attached). */
  get special(): number {
    return this._special;
  }

  /** @param value - Special flags bitfield. */
  set special(value: number) {
    this._special = value;
  }

  /** Global volume (0–128). */
  get globalVolume(): number {
    return this._globalVolume;
  }

  /** @param value - Global volume (0–128). */
  set globalVolume(value: number) {
    this._globalVolume = value;
  }

  /** Mix volume (0–128). */
  get mixVolume(): number {
    return this._mixVolume;
  }

  /** @param value - Mix volume (0–128). */
  set mixVolume(value: number) {
    this._mixVolume = value;
  }

  /** Initial tempo in BPM. */
  get tempo(): number {
    return this._tempo;
  }

  /** @param value - Initial tempo in BPM. */
  set tempo(value: number) {
    this._tempo = value;
  }

  /** Initial speed (ticks per row). */
  get bpmSpeed(): number {
    return this._bpmSpeed;
  }

  /** @param value - Initial speed (ticks per row). */
  set bpmSpeed(value: number) {
    this._bpmSpeed = value;
  }

  /** Panning separation (0–128). */
  get panningSeparation(): number {
    return this._panningSeparation;
  }

  /** @param value - Panning separation (0–128). */
  set panningSeparation(value: number) {
    this._panningSeparation = value;
  }

  /** Pitch wheel depth in semitones. */
  get pitchWheelDepth(): number {
    return this._pitchWheelDepth;
  }

  /** @param value - Pitch wheel depth in semitones. */
  set pitchWheelDepth(value: number) {
    this._pitchWheelDepth = value;
  }
}
