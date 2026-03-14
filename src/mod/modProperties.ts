import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for ProTracker MOD files.
 */
export class ModProperties extends AudioProperties {
  private _channels: number = 0;
  private _instrumentCount: number = 0;
  private _lengthInPatterns: number = 0;

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

  get instrumentCount(): number {
    return this._instrumentCount;
  }

  set instrumentCount(value: number) {
    this._instrumentCount = value;
  }

  get lengthInPatterns(): number {
    return this._lengthInPatterns;
  }

  set lengthInPatterns(value: number) {
    this._lengthInPatterns = value;
  }
}
