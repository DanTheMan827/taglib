import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for Extended Module (XM) files.
 */
export class XmProperties extends AudioProperties {
  private _channels: number = 0;
  private _lengthInPatterns: number = 0;
  private _version: number = 0;
  private _restartPosition: number = 0;
  private _patternCount: number = 0;
  private _instrumentCount: number = 0;
  private _sampleCount: number = 0;
  private _flags: number = 0;
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

  get version(): number {
    return this._version;
  }

  set version(value: number) {
    this._version = value;
  }

  get restartPosition(): number {
    return this._restartPosition;
  }

  set restartPosition(value: number) {
    this._restartPosition = value;
  }

  get patternCount(): number {
    return this._patternCount;
  }

  set patternCount(value: number) {
    this._patternCount = value;
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

  get flags(): number {
    return this._flags;
  }

  set flags(value: number) {
    this._flags = value;
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
