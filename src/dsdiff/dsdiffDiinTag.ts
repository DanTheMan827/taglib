/** @file DIIN (DSD Interchange Information) tag implementation for DSDIFF files. */
import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";

// =============================================================================
// DsdiffDiinTag
// =============================================================================

/**
 * DIIN (DSD Interchange Information) tag for DSDIFF files.
 *
 * This is a very limited tag format that only supports title and artist.
 * All other fields are ignored.
 */
export class DsdiffDiinTag extends Tag {
  /** The track title stored in the DIIN chunk. */
  private _title: string = "";
  /** The artist name stored in the DIIN chunk. */
  private _artist: string = "";

  // ---------------------------------------------------------------------------
  // Tag interface
  // ---------------------------------------------------------------------------

  /** Track title. Stored and retrieved from the DIIN "DITI" sub-chunk. */
  get title(): string {
    return this._title;
  }
  /** @param value New track title. */
  set title(value: string) {
    this._title = value;
  }

  /** Artist name. Stored and retrieved from the DIIN "DIAR" sub-chunk. */
  get artist(): string {
    return this._artist;
  }
  /** @param value New artist name. */
  set artist(value: string) {
    this._artist = value;
  }

  /** Not supported by the DIIN format; always returns an empty string. */
  get album(): string {
    return "";
  }
  /** Not supported by the DIIN format; value is silently ignored. */
  set album(_value: string) {
    // Unsupported by DIIN format
  }

  /** Not supported by the DIIN format; always returns an empty string. */
  get comment(): string {
    return "";
  }
  /** Not supported by the DIIN format; value is silently ignored. */
  set comment(_value: string) {
    // Unsupported by DIIN format
  }

  /** Not supported by the DIIN format; always returns an empty string. */
  get genre(): string {
    return "";
  }
  /** Not supported by the DIIN format; value is silently ignored. */
  set genre(_value: string) {
    // Unsupported by DIIN format
  }

  /** Not supported by the DIIN format; always returns 0. */
  get year(): number {
    return 0;
  }
  /** Not supported by the DIIN format; value is silently ignored. */
  set year(_value: number) {
    // Unsupported by DIIN format
  }

  /** Not supported by the DIIN format; always returns 0. */
  get track(): number {
    return 0;
  }
  /** Not supported by the DIIN format; value is silently ignored. */
  set track(_value: number) {
    // Unsupported by DIIN format
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

  /**
   * Returns a {@link PropertyMap} containing only the supported fields
   * (TITLE and ARTIST) with their current values.
   * @returns A property map with at most two entries.
   */
  override properties(): PropertyMap {
    const map = new PropertyMap();
    if (this._title !== "") map.replace("TITLE", [this._title]);
    if (this._artist !== "") map.replace("ARTIST", [this._artist]);
    return map;
  }

  /**
   * Applies the given property map to this tag.
   *
   * Only TITLE and ARTIST keys are consumed; all other keys are returned in
   * the unsupported map.  Fields absent from `properties` are cleared.
   * @param properties The incoming property map to apply.
   * @returns A {@link PropertyMap} containing all keys that could not be set.
   */
  override setProperties(properties: PropertyMap): PropertyMap {
    const unsupported = new PropertyMap();

    for (const [key, values] of properties.entries()) {
      const value = values.length > 0 ? values[0] : "";
      switch (key) {
        case "TITLE":
          this._title = value;
          break;
        case "ARTIST":
          this._artist = value;
          break;
        default:
          unsupported.replace(key, values);
          break;
      }
    }

    // Clear fields not present in the incoming properties
    if (!properties.contains("TITLE")) this._title = "";
    if (!properties.contains("ARTIST")) this._artist = "";

    return unsupported;
  }
}
