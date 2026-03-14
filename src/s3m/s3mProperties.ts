import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for ScreamTracker III (S3M) files.
 */
export class S3mProperties extends AudioProperties {
  private _channels: number = 0;
  private _lengthInPatterns: number = 0;
  private _stereo: boolean = false;
  private _sampleCount: number = 0;
  private _patternCount: number = 0;
  private _flags: number = 0;
  private _trackerVersion: number = 0;
  private _fileFormatVersion: number = 0;
  private _globalVolume: number = 0;
  private _masterVolume: number = 0;
  private _tempo: number = 0;
  private _bpmSpeed: number = 0;

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
    return this._stereo;
  }

  set stereo(value: boolean) {
    this._stereo = value;
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

  get flags(): number {
    return this._flags;
  }

  set flags(value: number) {
    this._flags = value;
  }

  get trackerVersion(): number {
    return this._trackerVersion;
  }

  set trackerVersion(value: number) {
    this._trackerVersion = value;
  }

  get fileFormatVersion(): number {
    return this._fileFormatVersion;
  }

  set fileFormatVersion(value: number) {
    this._fileFormatVersion = value;
  }

  get globalVolume(): number {
    return this._globalVolume;
  }

  set globalVolume(value: number) {
    this._globalVolume = value;
  }

  get masterVolume(): number {
    return this._masterVolume;
  }

  set masterVolume(value: number) {
    this._masterVolume = value;
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
}
