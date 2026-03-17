/** @file ASF tag implementation with PropertyMap and complex property (picture) support. */

import { Tag } from "../tag.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import { Variant } from "../toolkit/variant.js";
import type { VariantMap } from "../toolkit/variant.js";
import { AsfAttribute, AsfAttributeType } from "./asfAttribute.js";
import { AsfPicture, pictureTypeToString, pictureTypeFromString } from "./asfPicture.js";

// ---------------------------------------------------------------------------
// Key translation table: ASF attribute name → standard property key
// ---------------------------------------------------------------------------

/**
 * Bidirectional mapping between ASF `WM/*` / `MusicBrainz/*` attribute names
 * and the standard property key strings used by {@link PropertyMap}.
 */
const keyTranslation: [string, string][] = [
  ["WM/AlbumTitle", "ALBUM"],
  ["WM/AlbumArtist", "ALBUMARTIST"],
  ["WM/AuthorURL", "ARTISTWEBPAGE"],
  ["WM/Composer", "COMPOSER"],
  ["WM/Writer", "LYRICIST"],
  ["WM/Conductor", "CONDUCTOR"],
  ["WM/ModifiedBy", "REMIXER"],
  ["WM/Year", "DATE"],
  ["WM/OriginalAlbumTitle", "ORIGINALALBUM"],
  ["WM/OriginalArtist", "ORIGINALARTIST"],
  ["WM/OriginalFilename", "ORIGINALFILENAME"],
  ["WM/OriginalLyricist", "ORIGINALLYRICIST"],
  ["WM/OriginalReleaseYear", "ORIGINALDATE"],
  ["WM/Producer", "PRODUCER"],
  ["WM/ContentGroupDescription", "WORK"],
  ["WM/SubTitle", "SUBTITLE"],
  ["WM/SetSubTitle", "DISCSUBTITLE"],
  ["WM/TrackNumber", "TRACKNUMBER"],
  ["WM/PartOfSet", "DISCNUMBER"],
  ["WM/Genre", "GENRE"],
  ["WM/BeatsPerMinute", "BPM"],
  ["WM/Mood", "MOOD"],
  ["WM/InitialKey", "INITIALKEY"],
  ["WM/ISRC", "ISRC"],
  ["WM/Lyrics", "LYRICS"],
  ["WM/Media", "MEDIA"],
  ["WM/Publisher", "LABEL"],
  ["WM/CatalogNo", "CATALOGNUMBER"],
  ["WM/Barcode", "BARCODE"],
  ["WM/EncodedBy", "ENCODEDBY"],
  ["WM/EncodingSettings", "ENCODING"],
  ["WM/EncodingTime", "ENCODINGTIME"],
  ["WM/AudioFileURL", "FILEWEBPAGE"],
  ["WM/AlbumSortOrder", "ALBUMSORT"],
  ["WM/AlbumArtistSortOrder", "ALBUMARTISTSORT"],
  ["WM/ArtistSortOrder", "ARTISTSORT"],
  ["WM/TitleSortOrder", "TITLESORT"],
  ["WM/Script", "SCRIPT"],
  ["WM/Language", "LANGUAGE"],
  ["WM/ARTISTS", "ARTISTS"],
  ["ASIN", "ASIN"],
  ["MusicBrainz/Track Id", "MUSICBRAINZ_TRACKID"],
  ["MusicBrainz/Artist Id", "MUSICBRAINZ_ARTISTID"],
  ["MusicBrainz/Album Id", "MUSICBRAINZ_ALBUMID"],
  ["MusicBrainz/Album Artist Id", "MUSICBRAINZ_ALBUMARTISTID"],
  ["MusicBrainz/Album Release Country", "RELEASECOUNTRY"],
  ["MusicBrainz/Album Status", "RELEASESTATUS"],
  ["MusicBrainz/Album Type", "RELEASETYPE"],
  ["MusicBrainz/Release Group Id", "MUSICBRAINZ_RELEASEGROUPID"],
  ["MusicBrainz/Release Track Id", "MUSICBRAINZ_RELEASETRACKID"],
  ["MusicBrainz/Work Id", "MUSICBRAINZ_WORKID"],
  ["MusicIP/PUID", "MUSICIP_PUID"],
  ["Acoustid/Id", "ACOUSTID_ID"],
  ["Acoustid/Fingerprint", "ACOUSTID_FINGERPRINT"],
];

/**
 * Look up the standard property key for a given ASF attribute name.
 *
 * @param key - An ASF attribute name (e.g. `"WM/AlbumTitle"`).
 * @returns The corresponding property key, or `null` when not mapped.
 */
function translateKey(key: string): string | null {
  for (const [k, t] of keyTranslation) {
    if (key === k) return t;
  }
  return null;
}

/** Lazily initialised reverse lookup (property key → ASF attribute name). */
let reverseKeyMap: Map<string, string> | null = null;
/**
 * Return (and cache) the reverse mapping from standard property key to ASF
 * attribute name.
 */
function getReverseKeyMap(): Map<string, string> {
  if (!reverseKeyMap) {
    reverseKeyMap = new Map();
    for (const [k, t] of keyTranslation) {
      reverseKeyMap.set(t, k);
    }
  }
  return reverseKeyMap;
}

// ---------------------------------------------------------------------------
// AsfTag
// ---------------------------------------------------------------------------

/**
 * Represents the collection of metadata stored in an ASF file.
 *
 * Simple fields (title, artist, copyright, comment, rating) are stored
 * directly.  All other attributes are held in an attribute-list map keyed
 * by the ASF attribute name.
 */
export class AsfTag extends Tag {
  /** Track title from the Content Description Object. */
  private _title = "";
  /** Lead artist from the Content Description Object. */
  private _artist = "";
  /** Copyright notice from the Content Description Object. */
  private _copyright = "";
  /** User comment from the Content Description Object. */
  private _comment = "";
  /** Content rating from the Content Description Object. */
  private _rating = "";
  /** All other attributes keyed by ASF attribute name. */
  private _attributeListMap: Map<string, AsfAttribute[]> = new Map();

  // -- Tag interface --

  /** Track title (Content Description Object). */
  get title(): string { return this._title; }
  /** @param value - New title. */
  set title(value: string) { this._title = value; }

  /** Lead artist (Content Description Object). */
  get artist(): string { return this._artist; }
  /** @param value - New artist. */
  set artist(value: string) { this._artist = value; }

  /**
   * Album title, read from the `WM/AlbumTitle` attribute.
   * Returns `""` when not present.
   */
  get album(): string {
    const attrs = this._attributeListMap.get("WM/AlbumTitle");
    if (attrs && attrs.length > 0) {
      return Tag.joinTagValues(attrs.map(a => a.toString()));
    }
    return "";
  }
  /** @param value - New album title; sets the `WM/AlbumTitle` attribute. */
  set album(value: string) { this.setAttribute("WM/AlbumTitle", AsfAttribute.fromString(value)); }

  /** User comment (Content Description Object). */
  get comment(): string { return this._comment; }
  /** @param value - New comment. */
  set comment(value: string) { this._comment = value; }

  /**
   * Genre, read from the `WM/Genre` attribute.
   * Returns `""` when not present.
   */
  get genre(): string {
    const attrs = this._attributeListMap.get("WM/Genre");
    if (attrs && attrs.length > 0) {
      return Tag.joinTagValues(attrs.map(a => a.toString()));
    }
    return "";
  }
  /** @param value - New genre; sets the `WM/Genre` attribute. */
  set genre(value: string) { this.setAttribute("WM/Genre", AsfAttribute.fromString(value)); }

  /**
   * Release year, read from the `WM/Year` attribute.
   * Returns `0` when not present.
   */
  get year(): number {
    const attrs = this._attributeListMap.get("WM/Year");
    if (attrs && attrs.length > 0) {
      return parseInt(attrs[0].toString(), 10) || 0;
    }
    return 0;
  }
  /** @param value - New year; sets the `WM/Year` attribute. */
  set year(value: number) { this.setAttribute("WM/Year", AsfAttribute.fromString(String(value))); }

  /**
   * Track number, read from `WM/TrackNumber` (falling back to `WM/Track`).
   * Returns `0` when not present.
   */
  get track(): number {
    const attrs = this._attributeListMap.get("WM/TrackNumber");
    if (attrs && attrs.length > 0) {
      const attr = attrs[0];
      if (attr.type === AsfAttributeType.DWordType) return attr.toUInt();
      return parseInt(attr.toString(), 10) || 0;
    }
    const trackAttrs = this._attributeListMap.get("WM/Track");
    if (trackAttrs && trackAttrs.length > 0) return trackAttrs[0].toUInt();
    return 0;
  }
  /** @param value - New track number; sets the `WM/TrackNumber` attribute. */
  set track(value: number) { this.setAttribute("WM/TrackNumber", AsfAttribute.fromString(String(value))); }

  // -- ASF-specific --

  /** Copyright notice (Content Description Object). */
  get copyright(): string { return this._copyright; }
  /** @param value - New copyright string. */
  set copyright(value: string) { this._copyright = value; }

  /** Content rating (Content Description Object). */
  get rating(): string { return this._rating; }
  /** @param value - New rating string. */
  set rating(value: string) { this._rating = value; }

  /** The full map of all ASF attributes, keyed by attribute name. */
  get attributeListMap(): Map<string, AsfAttribute[]> { return this._attributeListMap; }

  /**
   * Return `true` if `key` has at least one attribute in the map.
   * @param key - ASF attribute name.
   */
  contains(key: string): boolean {
    return this._attributeListMap.has(key);
  }

  /**
   * Remove all attributes stored under `key`.
   * @param key - ASF attribute name.
   */
  removeItem(key: string): void {
    this._attributeListMap.delete(key);
  }

  /**
   * Return the list of attributes stored under `name`, or `[]` when absent.
   * @param name - ASF attribute name.
   */
  attribute(name: string): AsfAttribute[] {
    return this._attributeListMap.get(name) ?? [];
  }

  /**
   * Replace all attributes for `name` with a single `attribute`.
   * @param name - ASF attribute name.
   * @param attribute - The attribute to store.
   */
  setAttribute(name: string, attribute: AsfAttribute): void {
    this._attributeListMap.set(name, [attribute]);
  }

  /**
   * Replace all attributes for `name` with the given list.
   * @param name - ASF attribute name.
   * @param values - The attribute list to store.
   */
  setAttributeList(name: string, values: AsfAttribute[]): void {
    this._attributeListMap.set(name, values);
  }

  /**
   * Append `attribute` to the list stored under `name`, creating the entry if
   * it doesn't exist.
   *
   * @param name - ASF attribute name.
   * @param attribute - The attribute to append.
   */
  addAttribute(name: string, attribute: AsfAttribute): void {
    const existing = this._attributeListMap.get(name);
    if (existing) {
      existing.push(attribute);
    } else {
      this._attributeListMap.set(name, [attribute]);
    }
  }

  override get isEmpty(): boolean {
    return (
      super.isEmpty &&
      this._copyright === "" &&
      this._rating === "" &&
      this._attributeListMap.size === 0
    );
  }

  // -- PropertyMap --

  override properties(): PropertyMap {
    const props = new PropertyMap();

    if (this._title !== "") props.replace("TITLE", [this._title]);
    if (this._artist !== "") props.replace("ARTIST", [this._artist]);
    if (this._copyright !== "") props.replace("COPYRIGHT", [this._copyright]);
    if (this._comment !== "") props.replace("COMMENT", [this._comment]);

    for (const [k, attributes] of this._attributeListMap) {
      const key = translateKey(k);
      if (key) {
        for (const attr of attributes) {
          if (key === "TRACKNUMBER") {
            if (attr.type === AsfAttributeType.DWordType) {
              props.insert(key, [String(attr.toUInt())]);
            } else {
              props.insert(key, [attr.toString()]);
            }
          } else {
            props.insert(key, [attr.toString()]);
          }
        }
      } else {
        props.addUnsupportedData(k);
      }
    }
    return props;
  }

  override removeUnsupportedProperties(properties: string[]): void {
    for (const prop of properties) {
      this._attributeListMap.delete(prop);
    }
  }

  override setProperties(props: PropertyMap): PropertyMap {
    const reverse = getReverseKeyMap();
    const origProps = this.properties();

    // Remove properties that are no longer present
    for (const [prop] of origProps.entries()) {
      if (!props.contains(prop) || (props.get(prop)?.length ?? 0) === 0) {
        if (prop === "TITLE") this._title = "";
        else if (prop === "ARTIST") this._artist = "";
        else if (prop === "COMMENT") this._comment = "";
        else if (prop === "COPYRIGHT") this._copyright = "";
        else {
          const asfKey = reverse.get(prop);
          if (asfKey) this._attributeListMap.delete(asfKey);
        }
      }
    }

    const ignoredProps = new PropertyMap();
    for (const [prop, attributes] of props.entries()) {
      if (reverse.has(prop)) {
        const name = reverse.get(prop)!;
        this.removeItem(name);
        for (const attr of attributes) {
          this.addAttribute(name, AsfAttribute.fromString(attr));
        }
      } else if (prop === "TITLE") {
        this._title = attributes.join(" / ");
      } else if (prop === "ARTIST") {
        this._artist = attributes.join(" / ");
      } else if (prop === "COMMENT") {
        this._comment = attributes.join(" / ");
      } else if (prop === "COPYRIGHT") {
        this._copyright = attributes.join(" / ");
      } else {
        ignoredProps.replace(prop, attributes);
      }
    }

    return ignoredProps;
  }

  // -- Complex properties (pictures) --

  override complexPropertyKeys(): string[] {
    const keys: string[] = [];
    if (this._attributeListMap.has("WM/Picture")) {
      keys.push("PICTURE");
    }
    return keys;
  }

  override complexProperties(key: string): VariantMap[] {
    const result: VariantMap[] = [];
    if (key.toUpperCase() === "PICTURE") {
      const pictures = this._attributeListMap.get("WM/Picture") ?? [];
      for (const attr of pictures) {
        const picture = attr.toPicture();
        if (!picture.isValid) continue;
        const property: VariantMap = new Map();
        property.set("data", Variant.fromByteVector(picture.picture));
        property.set("mimeType", Variant.fromString(picture.mimeType));
        property.set("description", Variant.fromString(picture.description));
        property.set("pictureType", Variant.fromString(pictureTypeToString(picture.type)));
        result.push(property);
      }
    }
    return result;
  }

  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    if (key.toUpperCase() === "PICTURE") {
      this.removeItem("WM/Picture");
      for (const property of value) {
        const picture = AsfPicture.create();
        picture.picture = property.get("data")?.toByteVector() ?? picture.picture;
        picture.mimeType = property.get("mimeType")?.toString() ?? "";
        picture.description = property.get("description")?.toString() ?? "";
        picture.type = pictureTypeFromString(property.get("pictureType")?.toString() ?? "");
        this.addAttribute("WM/Picture", AsfAttribute.fromPicture(picture));
      }
      return true;
    }
    return false;
  }
}
