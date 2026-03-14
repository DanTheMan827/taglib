import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";

/**
 * Stub tag for Shorten files. Shorten does not support metadata tags.
 */
export class ShortenTag extends Tag {
  get title(): string { return ""; }
  set title(_value: string) { /* not supported */ }

  get artist(): string { return ""; }
  set artist(_value: string) { /* not supported */ }

  get album(): string { return ""; }
  set album(_value: string) { /* not supported */ }

  get comment(): string { return ""; }
  set comment(_value: string) { /* not supported */ }

  get genre(): string { return ""; }
  set genre(_value: string) { /* not supported */ }

  get year(): number { return 0; }
  set year(_value: number) { /* not supported */ }

  get track(): number { return 0; }
  set track(_value: number) { /* not supported */ }

  override properties(): PropertyMap {
    return new PropertyMap();
  }

  override setProperties(properties: PropertyMap): PropertyMap {
    // Shorten does not support any properties; return them all as unsupported
    const unsupported = new PropertyMap();
    for (const [key, values] of properties.entries()) {
      unsupported.replace(key, values);
    }
    return unsupported;
  }
}
