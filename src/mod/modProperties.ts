/** @file Audio properties for ProTracker MOD files. */
import { AudioProperties } from "../audioProperties.js";
import type { ReadStyle } from "../toolkit/types.js";

/**
 * Audio properties for ProTracker MOD files.
 */
export class ModProperties extends AudioProperties {
  /** Number of audio channels. */
  private _channels: number = 0;
  /** Number of instruments in the module. */
  private _instrumentCount: number = 0;
  /** Length of the song in patterns (order list entries). */
  private _lengthInPatterns: number = 0;

  /**
   * Construct audio properties with the given read style.
   * @param readStyle - Detail level for audio property parsing.
   */
  constructor(readStyle: ReadStyle) {
    super(readStyle);
  }

  /** Always 0; MOD files do not provide a time-based duration. */
  get lengthInMilliseconds(): number {
    return 0;
  }

  /** Number of audio channels. */
  get channels(): number {
    return this._channels;
  }

  /** @param value - Number of audio channels. */
  set channels(value: number) {
    this._channels = value;
  }

  /** Number of instruments in the module. */
  get instrumentCount(): number {
    return this._instrumentCount;
  }

  /** @param value - Number of instruments. */
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
