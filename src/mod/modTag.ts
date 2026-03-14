import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";

/**
 * Tag implementation for tracker module formats (MOD, S3M, XM, IT).
 *
 * Only title, comment, and trackerName are supported. Comment is typically
 * built from instrument/sample names joined by newlines.
 */
export class ModTag extends Tag {
  private _title: string = "";
  private _comment: string = "";
  private _trackerName: string = "";

  get title(): string {
    return this._title;
  }

  set title(value: string) {
    this._title = value;
  }

  get artist(): string {
    return "";
  }

  set artist(_value: string) {
    // Not supported
  }

  get album(): string {
    return "";
  }

  set album(_value: string) {
    // Not supported
  }

  get comment(): string {
    return this._comment;
  }

  set comment(value: string) {
    this._comment = value;
  }

  get genre(): string {
    return "";
  }

  set genre(_value: string) {
    // Not supported
  }

  get year(): number {
    return 0;
  }

  set year(_value: number) {
    // Not supported
  }

  get track(): number {
    return 0;
  }

  set track(_value: number) {
    // Not supported
  }

  get trackerName(): string {
    return this._trackerName;
  }

  set trackerName(value: string) {
    this._trackerName = value;
  }

  override properties(): PropertyMap {
    const map = new PropertyMap();
    if (this._title !== "") map.replace("TITLE", [this._title]);
    if (this._comment !== "") map.replace("COMMENT", [this._comment]);
    if (this._trackerName !== "") map.replace("TRACKERNAME", [this._trackerName]);
    return map;
  }

  override setProperties(properties: PropertyMap): PropertyMap {
    const unsupported = new PropertyMap();

    for (const [key, values] of properties.entries()) {
      const value = values.length > 0 ? values[0] : "";
      switch (key) {
        case "TITLE":
          this._title = value;
          break;
        case "COMMENT":
          this._comment = value;
          break;
        case "TRACKERNAME":
          this._trackerName = value;
          break;
        default:
          unsupported.replace(key, values);
          break;
      }
    }

    return unsupported;
  }
}
