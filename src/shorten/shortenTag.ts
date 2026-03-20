/** @file Stub tag implementation for Shorten files. Shorten does not support embedded metadata. */

import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";

/**
 * Stub tag for Shorten (.shn) files.
 *
 * Shorten does not support any metadata tags. All getters return empty
 * strings or zero, and all setters are no-ops. {@link setProperties} returns
 * every supplied property as unsupported.
 */
export class ShortenTag extends Tag {
  /**
   * Returns an empty string; Shorten files have no title field.
   * @returns `""`.
   */
  get title(): string { return ""; }
  /**
   * No-op; Shorten files do not support a title field.
   * @param _value - Ignored.
   */
  set title(_value: string) { /* not supported */ }

  /**
   * Returns an empty string; Shorten files have no artist field.
   * @returns `""`.
   */
  get artist(): string { return ""; }
  /**
   * No-op; Shorten files do not support an artist field.
   * @param _value - Ignored.
   */
  set artist(_value: string) { /* not supported */ }

  /**
   * Returns an empty string; Shorten files have no album field.
   * @returns `""`.
   */
  get album(): string { return ""; }
  /**
   * No-op; Shorten files do not support an album field.
   * @param _value - Ignored.
   */
  set album(_value: string) { /* not supported */ }

  /**
   * Returns an empty string; Shorten files have no comment field.
   * @returns `""`.
   */
  get comment(): string { return ""; }
  /**
   * No-op; Shorten files do not support a comment field.
   * @param _value - Ignored.
   */
  set comment(_value: string) { /* not supported */ }

  /**
   * Returns an empty string; Shorten files have no genre field.
   * @returns `""`.
   */
  get genre(): string { return ""; }
  /**
   * No-op; Shorten files do not support a genre field.
   * @param _value - Ignored.
   */
  set genre(_value: string) { /* not supported */ }

  /**
   * Returns `0`; Shorten files have no year field.
   * @returns `0`.
   */
  get year(): number { return 0; }
  /**
   * No-op; Shorten files do not support a year field.
   * @param _value - Ignored.
   */
  set year(_value: number) { /* not supported */ }

  /**
   * Returns `0`; Shorten files have no track number field.
   * @returns `0`.
   */
  get track(): number { return 0; }
  /**
   * No-op; Shorten files do not support a track number field.
   * @param _value - Ignored.
   */
  set track(_value: number) { /* not supported */ }

  /**
   * Returns an empty {@link PropertyMap}; Shorten carries no properties.
   * @returns An empty `PropertyMap`.
   */
  override properties(): PropertyMap {
    return new PropertyMap();
  }

  /**
   * Returns all supplied properties as unsupported.
   * Shorten does not support any writable properties.
   * @param properties - The properties to attempt to set.
   * @returns A `PropertyMap` containing every entry from `properties` as unsupported.
   */
  override setProperties(properties: PropertyMap): PropertyMap {
    // Shorten does not support any properties; return them all as unsupported
    const unsupported = new PropertyMap();
    for (const [key, values] of properties.entries()) {
      unsupported.replace(key, values);
    }
    return unsupported;
  }
}
