import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for Impulse Tracker (IT) files.
 */
export class ItProperties extends AudioProperties {
  // Flag constants
  static readonly Stereo = 0x01;
  static readonly MessageAttached = 0x01;

  private _channels: number = 0;
  private _lengthInPatterns: number = 0;
  private _instrumentCount: number = 0;
  private _sampleCount: number = 0;
  private _patternCount: number = 0;
  private _version: number = 0;
  private _compatibleVersion: number = 0;
  private _flags: number = 0;
  private _special: number = 0;
  private _globalVolume: number = 0;
  private _mixVolume: number = 0;
  private _tempo: number = 0;
  private _bpmSpeed: number = 0;
  private _panningSeparation: number = 0;
  private _pitchWheelDepth: number = 0;

  constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  get lengthInMilliseconds(): number {
    return 0;
  }

  get channels(): number {
    return this._channels;
  }

  set channels(value: number) {
    this._channels = value;
  }

  get lengthInPatterns(): number {
    return this._lengthInPatterns;
  }

  set lengthInPatterns(value: number) {
    this._lengthInPatterns = value;
  }

  get stereo(): boolean {
    return (this._flags & ItProperties.Stereo) !== 0;
  }

  get instrumentCount(): number {
    return this._instrumentCount;
  }

  set instrumentCount(value: number) {
    this._instrumentCount = value;
  }

  get sampleCount(): number {
    return this._sampleCount;
  }

  set sampleCount(value: number) {
    this._sampleCount = value;
  }

  get patternCount(): number {
    return this._patternCount;
  }

  set patternCount(value: number) {
    this._patternCount = value;
  }

  get version(): number {
    return this._version;
  }

  set version(value: number) {
    this._version = value;
  }

  get compatibleVersion(): number {
    return this._compatibleVersion;
  }

  set compatibleVersion(value: number) {
    this._compatibleVersion = value;
  }

  get flags(): number {
    return this._flags;
  }

  set flags(value: number) {
    this._flags = value;
  }

  get special(): number {
    return this._special;
  }

  set special(value: number) {
    this._special = value;
  }

  get globalVolume(): number {
    return this._globalVolume;
  }

  set globalVolume(value: number) {
    this._globalVolume = value;
  }

  get mixVolume(): number {
    return this._mixVolume;
  }

  set mixVolume(value: number) {
    this._mixVolume = value;
  }

  get tempo(): number {
    return this._tempo;
  }

  set tempo(value: number) {
    this._tempo = value;
  }

  get bpmSpeed(): number {
    return this._bpmSpeed;
  }

  set bpmSpeed(value: number) {
    this._bpmSpeed = value;
  }

  get panningSeparation(): number {
    return this._panningSeparation;
  }

  set panningSeparation(value: number) {
    this._panningSeparation = value;
  }

  get pitchWheelDepth(): number {
    return this._pitchWheelDepth;
  }

  set pitchWheelDepth(value: number) {
    this._pitchWheelDepth = value;
  }
}
