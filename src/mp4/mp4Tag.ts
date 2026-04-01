/** @file MP4/M4A tag implementation using iTunes-style ilst atoms. */
import { ByteVector, StringType } from "../byteVector.js";
import { Tag } from "../tag.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { Position } from "../toolkit/types.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import { Variant, type VariantMap } from "../toolkit/variant.js";
import { Mp4Atom, Mp4Atoms } from "./mp4Atoms.js";

// ---------------------------------------------------------------------------
// ID3v1 genre list (subset for gnre atom support)
// ---------------------------------------------------------------------------

const ID3V1_GENRES: string[] = [
  "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge",
  "Hip-Hop", "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B",
  "Rap", "Reggae", "Rock", "Techno", "Industrial", "Alternative", "Ska",
  "Death Metal", "Pranks", "Soundtrack", "Euro-Techno", "Ambient",
  "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion", "Trance", "Classical",
  "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel", "Noise",
  "AlternRock", "Bass", "Soul", "Punk", "Space", "Meditative",
  "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave",
  "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream",
  "Southern Rock", "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap",
  "Pop/Funk", "Jungle", "Native American", "Cabaret", "New Wave",
  "Psychedelic", "Rave", "Showtunes", "Trailer", "Lo-Fi", "Tribal",
  "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll",
  "Hard Rock", "Folk", "Folk-Rock", "National Folk", "Swing", "Fast Fusion",
  "Bebop", "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde",
  "Gothic Rock", "Progressive Rock", "Psychedelic Rock", "Symphonic Rock",
  "Slow Rock", "Big Band", "Chorus", "Easy Listening", "Acoustic", "Humour",
  "Speech", "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony",
  "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam", "Club",
  "Tango", "Samba", "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul",
  "Freestyle", "Duet", "Punk Rock", "Drum Solo", "A capella", "Euro-House",
  "Dance Hall", "Goa", "Drum & Bass", "Club-House", "Hardcore", "Terror",
  "Indie", "BritPop", "Negerpunk", "Polsk Punk", "Beat",
  "Christian Gangsta Rap", "Heavy Metal", "Black Metal", "Crossover",
  "Contemporary Christian", "Christian Rock", "Merengue", "Salsa",
  "Thrash Metal", "Anime", "JPop", "Synthpop", "Abstract", "Art Rock",
  "Baroque", "Bhangra", "Big Beat", "Breakbeat", "Chillout", "Downtempo",
  "Dub", "EBM", "Eclectic", "Electro", "Electroclash", "Emo",
  "Experimental", "Garage", "Global", "IDM", "Illbient", "Industro-Goth",
  "Jam Band", "Krautrock", "Leftfield", "Lounge", "Math Rock", "New Romantic",
  "Nu-Breakz", "Post-Punk", "Post-Rock", "Psytrance", "Shoegaze", "Space Rock",
  "Trop Rock", "World Music", "Neoclassical", "Audiobook", "Audio Theatre",
  "Neue Deutsche Welle", "Podcast", "Indie Rock", "G-Funk", "Dubstep",
  "Garage Rock", "Psybient",
];

// ---------------------------------------------------------------------------
// Cover art
// ---------------------------------------------------------------------------

export enum Mp4CoverArtFormat {
  Unknown = 0,
  GIF = 12,
  JPEG = 13,
  PNG = 14,
  BMP = 27,
}

export class Mp4CoverArt {
  format: Mp4CoverArtFormat;
  data: ByteVector;

  constructor(format: Mp4CoverArtFormat, data: ByteVector) {
    this.format = format;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// Atom data types (used in "data" sub-atoms)
// ---------------------------------------------------------------------------

export enum AtomDataType {
  TypeImplicit = 0,
  TypeUTF8 = 1,
  TypeUTF16 = 2,
  TypeJPEG = 13,
  TypePNG = 14,
  TypeInteger = 21,
  TypeBMP = 27,
  TypeGIF = 12,
  TypeUndefined = 255,
}

// ---------------------------------------------------------------------------
// Item handler types
// ---------------------------------------------------------------------------

const enum ItemHandlerType {
  Unknown,
  FreeForm,
  IntPair,
  IntPairNoTrailing,
  Bool,
  Int,
  TextOrInt,
  UInt,
  LongLong,
  Byte,
  Gnre,
  Covr,
  Text,
  TextImplicit,
}

const NAME_HANDLER_MAP = new Map<string, ItemHandlerType>([
  ["----", ItemHandlerType.FreeForm],
  ["trkn", ItemHandlerType.IntPair],
  ["disk", ItemHandlerType.IntPairNoTrailing],
  ["cpil", ItemHandlerType.Bool],
  ["pgap", ItemHandlerType.Bool],
  ["pcst", ItemHandlerType.Bool],
  ["shwm", ItemHandlerType.Bool],
  ["tmpo", ItemHandlerType.Int],
  ["\u00A9mvi", ItemHandlerType.Int],
  ["\u00A9mvc", ItemHandlerType.Int],
  ["hdvd", ItemHandlerType.Int],
  ["rate", ItemHandlerType.TextOrInt],
  ["tvsn", ItemHandlerType.UInt],
  ["tves", ItemHandlerType.UInt],
  ["cnID", ItemHandlerType.UInt],
  ["sfID", ItemHandlerType.UInt],
  ["atID", ItemHandlerType.UInt],
  ["geID", ItemHandlerType.UInt],
  ["cmID", ItemHandlerType.UInt],
  ["plID", ItemHandlerType.LongLong],
  ["stik", ItemHandlerType.Byte],
  ["rtng", ItemHandlerType.Byte],
  ["akID", ItemHandlerType.Byte],
  ["gnre", ItemHandlerType.Gnre],
  ["covr", ItemHandlerType.Covr],
  ["purl", ItemHandlerType.TextImplicit],
  ["egid", ItemHandlerType.TextImplicit],
]);

function handlerTypeForName(name: string): ItemHandlerType {
  const t = NAME_HANDLER_MAP.get(name);
  if (t !== undefined) return t;
  // Default: 4-char names are text items
  if (name.length === 4) return ItemHandlerType.Text;
  return ItemHandlerType.Unknown;
}

// ---------------------------------------------------------------------------
// Property name ↔ atom name mapping
// ---------------------------------------------------------------------------

const NAME_PROPERTY_PAIRS: [string, string][] = [
  ["\u00A9nam", "TITLE"],
  ["\u00A9ART", "ARTIST"],
  ["\u00A9alb", "ALBUM"],
  ["\u00A9cmt", "COMMENT"],
  ["\u00A9gen", "GENRE"],
  ["\u00A9day", "DATE"],
  ["\u00A9wrt", "COMPOSER"],
  ["\u00A9grp", "GROUPING"],
  ["aART", "ALBUMARTIST"],
  ["trkn", "TRACKNUMBER"],
  ["disk", "DISCNUMBER"],
  ["cpil", "COMPILATION"],
  ["tmpo", "BPM"],
  ["cprt", "COPYRIGHT"],
  ["\u00A9lyr", "LYRICS"],
  ["\u00A9too", "ENCODING"],
  ["\u00A9enc", "ENCODEDBY"],
  ["soal", "ALBUMSORT"],
  ["soaa", "ALBUMARTISTSORT"],
  ["soar", "ARTISTSORT"],
  ["sonm", "TITLESORT"],
  ["soco", "COMPOSERSORT"],
  ["sosn", "SHOWSORT"],
  ["shwm", "SHOWWORKMOVEMENT"],
  ["pgap", "GAPLESSPLAYBACK"],
  ["pcst", "PODCAST"],
  ["catg", "PODCASTCATEGORY"],
  ["desc", "PODCASTDESC"],
  ["egid", "PODCASTID"],
  ["purl", "PODCASTURL"],
  ["tves", "TVEPISODE"],
  ["tven", "TVEPISODEID"],
  ["tvnn", "TVNETWORK"],
  ["tvsn", "TVSEASON"],
  ["tvsh", "TVSHOW"],
  ["\u00A9wrk", "WORK"],
  ["\u00A9mvn", "MOVEMENTNAME"],
  ["\u00A9mvi", "MOVEMENTNUMBER"],
  ["\u00A9mvc", "MOVEMENTCOUNT"],
  ["ownr", "OWNER"],
  ["----:com.apple.iTunes:MusicBrainz Track Id", "MUSICBRAINZ_TRACKID"],
  ["----:com.apple.iTunes:MusicBrainz Artist Id", "MUSICBRAINZ_ARTISTID"],
  ["----:com.apple.iTunes:MusicBrainz Album Id", "MUSICBRAINZ_ALBUMID"],
  ["----:com.apple.iTunes:MusicBrainz Album Artist Id", "MUSICBRAINZ_ALBUMARTISTID"],
  ["----:com.apple.iTunes:MusicBrainz Release Group Id", "MUSICBRAINZ_RELEASEGROUPID"],
  ["----:com.apple.iTunes:MusicBrainz Release Track Id", "MUSICBRAINZ_RELEASETRACKID"],
  ["----:com.apple.iTunes:MusicBrainz Work Id", "MUSICBRAINZ_WORKID"],
  ["----:com.apple.iTunes:MusicBrainz Album Release Country", "RELEASECOUNTRY"],
  ["----:com.apple.iTunes:MusicBrainz Album Status", "RELEASESTATUS"],
  ["----:com.apple.iTunes:MusicBrainz Album Type", "RELEASETYPE"],
  ["----:com.apple.iTunes:ARTISTS", "ARTISTS"],
  ["----:com.apple.iTunes:ORIGINALDATE", "ORIGINALDATE"],
  ["----:com.apple.iTunes:RELEASEDATE", "RELEASEDATE"],
  ["----:com.apple.iTunes:ASIN", "ASIN"],
  ["----:com.apple.iTunes:LABEL", "LABEL"],
  ["----:com.apple.iTunes:LYRICIST", "LYRICIST"],
  ["----:com.apple.iTunes:CONDUCTOR", "CONDUCTOR"],
  ["----:com.apple.iTunes:REMIXER", "REMIXER"],
  ["----:com.apple.iTunes:ENGINEER", "ENGINEER"],
  ["----:com.apple.iTunes:PRODUCER", "PRODUCER"],
  ["----:com.apple.iTunes:DJMIXER", "DJMIXER"],
  ["----:com.apple.iTunes:MIXER", "MIXER"],
  ["----:com.apple.iTunes:SUBTITLE", "SUBTITLE"],
  ["----:com.apple.iTunes:DISCSUBTITLE", "DISCSUBTITLE"],
  ["----:com.apple.iTunes:MOOD", "MOOD"],
  ["----:com.apple.iTunes:ISRC", "ISRC"],
  ["----:com.apple.iTunes:CATALOGNUMBER", "CATALOGNUMBER"],
  ["----:com.apple.iTunes:BARCODE", "BARCODE"],
  ["----:com.apple.iTunes:SCRIPT", "SCRIPT"],
  ["----:com.apple.iTunes:LANGUAGE", "LANGUAGE"],
  ["----:com.apple.iTunes:LICENSE", "LICENSE"],
  ["----:com.apple.iTunes:MEDIA", "MEDIA"],
];

const FREE_FORM_PREFIX = "----:com.apple.iTunes:";

let _propertyKeyForName: Map<string, string> | null = null;
let _nameForPropertyKey: Map<string, string> | null = null;

function getPropertyKeyForName(): Map<string, string> {
  if (!_propertyKeyForName) {
    _propertyKeyForName = new Map(NAME_PROPERTY_PAIRS);
  }
  return _propertyKeyForName;
}

function getNameForPropertyKey(): Map<string, string> {
  if (!_nameForPropertyKey) {
    _nameForPropertyKey = new Map<string, string>();
    for (const [n, k] of NAME_PROPERTY_PAIRS) {
      _nameForPropertyKey.set(k, n);
    }
  }
  return _nameForPropertyKey;
}

function propertyKeyForName(name: string): string {
  let key = getPropertyKeyForName().get(name) ?? "";
  if (!key && name.startsWith(FREE_FORM_PREFIX)) {
    key = name.substring(FREE_FORM_PREFIX.length);
  }
  return key;
}

function nameForPropertyKey(key: string): string {
  let name = getNameForPropertyKey().get(key) ?? "";
  if (!name && key.length > 0 && key[0] >= "A" && key[0] <= "Z") {
    name = FREE_FORM_PREFIX + key;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Mp4Item
// ---------------------------------------------------------------------------

export enum Mp4ItemType {
  Void,
  Bool,
  Int,
  IntPair,
  Byte,
  UInt,
  LongLong,
  StringList,
  ByteVectorList,
  CoverArtList,
}

export class Mp4Item {
  type: Mp4ItemType;
  valid: boolean;
  atomDataType: AtomDataType;

  private _bool = false;
  private _int = 0;
  private _intPair: [number, number] = [0, 0];
  private _byte = 0;
  private _uint = 0;
  private _longlong = 0n;
  private _stringList: string[] = [];
  private _byteVectorList: ByteVector[] = [];
  private _coverArtList: Mp4CoverArt[] = [];

  private constructor() {
    this.type = Mp4ItemType.Void;
    this.valid = false;
    this.atomDataType = AtomDataType.TypeUndefined;
  }

  // -- Accessors --

  toBool(): boolean { return this._bool; }
  toInt(): number { return this._int; }
  toByte(): number { return this._byte; }
  toUInt(): number { return this._uint; }
  toLongLong(): bigint { return this._longlong; }
  toIntPair(): [number, number] { return this._intPair; }
  toStringList(): string[] { return this._stringList; }
  toByteVectorList(): ByteVector[] { return this._byteVectorList; }
  toCoverArtList(): Mp4CoverArt[] { return this._coverArtList; }

  isValid(): boolean { return this.valid; }

  // -- Factory methods --

  static invalid(): Mp4Item { return new Mp4Item(); }

  static fromBool(value: boolean): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.Bool;
    item.valid = true;
    item._bool = value;
    return item;
  }

  static fromInt(value: number): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.Int;
    item.valid = true;
    item._int = value;
    return item;
  }

  static fromIntPair(first: number, second: number): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.IntPair;
    item.valid = true;
    item._intPair = [first, second];
    return item;
  }

  static fromByte(value: number): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.Byte;
    item.valid = true;
    item._byte = value & 0xff;
    return item;
  }

  static fromUInt(value: number): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.UInt;
    item.valid = true;
    item._uint = value >>> 0;
    return item;
  }

  static fromLongLong(value: bigint): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.LongLong;
    item.valid = true;
    item._longlong = value;
    return item;
  }

  static fromStringList(values: string[]): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.StringList;
    item.valid = true;
    item._stringList = values;
    return item;
  }

  static fromByteVectorList(values: ByteVector[]): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.ByteVectorList;
    item.valid = true;
    item._byteVectorList = values;
    return item;
  }

  static fromCoverArtList(values: Mp4CoverArt[]): Mp4Item {
    const item = new Mp4Item();
    item.type = Mp4ItemType.CoverArtList;
    item.valid = true;
    item._coverArtList = values;
    return item;
  }

  // -- Rendering --

  render(itemName: string): ByteVector {
    if (itemName.startsWith("----")) {
      return renderFreeForm(itemName, this);
    }
    const nameBytes = ByteVector.fromString(itemName, StringType.Latin1);
    const handler = handlerTypeForName(itemName);
    switch (handler) {
      case ItemHandlerType.IntPair:
        return renderIntPair(nameBytes, this);
      case ItemHandlerType.IntPairNoTrailing:
        return renderIntPairNoTrailing(nameBytes, this);
      case ItemHandlerType.Bool:
        return renderBool(nameBytes, this);
      case ItemHandlerType.Int:
      case ItemHandlerType.Gnre:
        return renderInt(nameBytes, this);
      case ItemHandlerType.TextOrInt:
        return this._stringList.length > 0
          ? renderText(nameBytes, this)
          : renderInt(nameBytes, this);
      case ItemHandlerType.UInt:
        return renderUInt(nameBytes, this);
      case ItemHandlerType.LongLong:
        return renderLongLong(nameBytes, this);
      case ItemHandlerType.Byte:
        return renderByte(nameBytes, this);
      case ItemHandlerType.Covr:
        return renderCovr(nameBytes, this);
      case ItemHandlerType.TextImplicit:
        return renderText(nameBytes, this, AtomDataType.TypeImplicit);
      case ItemHandlerType.Text:
        return renderText(nameBytes, this);
      default:
        return new ByteVector();
    }
  }
}

// ---------------------------------------------------------------------------
// Atom data parsing helpers
// ---------------------------------------------------------------------------

interface AtomData {
  type: AtomDataType;
  data: ByteVector;
}

function parseData2(
  data: ByteVector,
  expectedFlags: number,
  freeForm: boolean,
): AtomData[] {
  const result: AtomData[] = [];
  let i = 0;
  let pos = 0;
  while (pos < data.length) {
    const length = data.toUInt(pos);
    if (length < 12) return result;

    const name = data.mid(pos + 4, 4).toString(StringType.Latin1);
    const flags = data.toUInt(pos + 8);

    if (freeForm && i < 2) {
      if (i === 0 && name !== "mean") return result;
      if (i === 1 && name !== "name") return result;
      result.push({ type: flags as AtomDataType, data: data.mid(pos + 12, length - 12) });
    } else {
      if (name !== "data") return result;
      if (expectedFlags === -1 || flags === expectedFlags) {
        result.push({ type: flags as AtomDataType, data: data.mid(pos + 16, length - 16) });
      }
    }
    pos += length;
    i++;
  }
  return result;
}

function parseDataVectors(
  data: ByteVector,
  expectedFlags = -1,
  freeForm = false,
): ByteVector[] {
  return parseData2(data, expectedFlags, freeForm).map(d => d.data);
}

// ---------------------------------------------------------------------------
// Item parsing (from raw atom data)
// ---------------------------------------------------------------------------

function parseItem(
  atomName: string,
  data: ByteVector,
): [string, Mp4Item] {
  const handler = handlerTypeForName(atomName);
  switch (handler) {
    case ItemHandlerType.FreeForm:
      return parseFreeForm(atomName, data);
    case ItemHandlerType.IntPair:
    case ItemHandlerType.IntPairNoTrailing:
      return parseIntPair(atomName, data);
    case ItemHandlerType.Bool:
      return parseBool(atomName, data);
    case ItemHandlerType.Int:
      return parseInt_(atomName, data);
    case ItemHandlerType.TextOrInt:
      return parseTextOrInt(atomName, data);
    case ItemHandlerType.UInt:
      return parseUInt(atomName, data);
    case ItemHandlerType.LongLong:
      return parseLongLong(atomName, data);
    case ItemHandlerType.Byte:
      return parseByte(atomName, data);
    case ItemHandlerType.Gnre:
      return parseGnre(data);
    case ItemHandlerType.Covr:
      return parseCovr(atomName, data);
    case ItemHandlerType.TextImplicit:
      return parseText(atomName, data, -1);
    case ItemHandlerType.Text:
      return parseText(atomName, data);
    default:
      return [atomName, Mp4Item.invalid()];
  }
}

function parseInt_(name: string, bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) return [name, Mp4Item.fromInt(data[0].toShort())];
  return [name, Mp4Item.invalid()];
}

function parseTextOrInt(name: string, bytes: ByteVector): [string, Mp4Item] {
  const atomData = parseData2(bytes, -1, false);
  if (atomData.length > 0) {
    const val = atomData[0];
    if (val.type === AtomDataType.TypeUTF8) {
      return [name, Mp4Item.fromStringList([val.data.toString(StringType.UTF8)])];
    }
    return [name, Mp4Item.fromInt(val.data.toShort())];
  }
  return [name, Mp4Item.invalid()];
}

function parseUInt(name: string, bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) return [name, Mp4Item.fromUInt(data[0].toUInt())];
  return [name, Mp4Item.invalid()];
}

function parseLongLong(name: string, bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) return [name, Mp4Item.fromLongLong(data[0].toLongLong())];
  return [name, Mp4Item.invalid()];
}

function parseByte(name: string, bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) return [name, Mp4Item.fromByte(data[0].get(0))];
  return [name, Mp4Item.invalid()];
}

function parseGnre(bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) {
    const idx = data[0].toShort();
    if (idx > 0 && idx - 1 < ID3V1_GENRES.length) {
      return ["\u00A9gen", Mp4Item.fromStringList([ID3V1_GENRES[idx - 1]])];
    }
  }
  return ["\u00A9gen", Mp4Item.invalid()];
}

function parseIntPair(name: string, bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) {
    const a = data[0].toShort(2);
    const b = data[0].toShort(4);
    return [name, Mp4Item.fromIntPair(a, b)];
  }
  return [name, Mp4Item.invalid()];
}

function parseBool(name: string, bytes: ByteVector): [string, Mp4Item] {
  const data = parseDataVectors(bytes);
  if (data.length > 0) {
    const value = !data[0].isEmpty && data[0].get(0) !== 0;
    return [name, Mp4Item.fromBool(value)];
  }
  return [name, Mp4Item.invalid()];
}

function parseText(
  name: string,
  bytes: ByteVector,
  expectedFlags: number = AtomDataType.TypeUTF8,
): [string, Mp4Item] {
  const data = parseDataVectors(bytes, expectedFlags);
  if (data.length > 0) {
    const values = data.map(d => d.toString(StringType.UTF8));
    return [name, Mp4Item.fromStringList(values)];
  }
  return [name, Mp4Item.invalid()];
}

function parseFreeForm(
  _atomName: string,
  bytes: ByteVector,
): [string, Mp4Item] {
  const atomData = parseData2(bytes, -1, true);
  if (atomData.length > 2) {
    const meanData = atomData[0].data.toString(StringType.UTF8);
    const nameData = atomData[1].data.toString(StringType.UTF8);
    const fullName = `----:${meanData}:${nameData}`;
    const type = atomData[2].type;

    if (type === AtomDataType.TypeUTF8) {
      const values: string[] = [];
      for (let i = 2; i < atomData.length; i++) {
        values.push(atomData[i].data.toString(StringType.UTF8));
      }
      const item = Mp4Item.fromStringList(values);
      item.atomDataType = type;
      return [fullName, item];
    }
    const values: ByteVector[] = [];
    for (let i = 2; i < atomData.length; i++) {
      values.push(atomData[i].data);
    }
    const item = Mp4Item.fromByteVectorList(values);
    item.atomDataType = type;
    return [fullName, item];
  }
  return [_atomName, Mp4Item.invalid()];
}

function parseCovr(name: string, data: ByteVector): [string, Mp4Item] {
  const arts: Mp4CoverArt[] = [];
  let pos = 0;
  while (pos < data.length) {
    const length = data.toUInt(pos);
    if (length < 12) break;

    const atomName = data.mid(pos + 4, 4).toString(StringType.Latin1);
    const flags = data.toUInt(pos + 8);
    if (atomName !== "data") break;

    if (
      flags === AtomDataType.TypeJPEG ||
      flags === AtomDataType.TypePNG ||
      flags === AtomDataType.TypeBMP ||
      flags === AtomDataType.TypeGIF ||
      flags === AtomDataType.TypeImplicit
    ) {
      arts.push(new Mp4CoverArt(flags as unknown as Mp4CoverArtFormat, data.mid(pos + 16, length - 16)));
    }
    pos += length;
  }
  return [name, arts.length > 0 ? Mp4Item.fromCoverArtList(arts) : Mp4Item.invalid()];
}

// ---------------------------------------------------------------------------
// Item rendering helpers
// ---------------------------------------------------------------------------

function renderAtom(name: ByteVector | string, data: ByteVector): ByteVector {
  const nameVec =
    typeof name === "string"
      ? ByteVector.fromString(name, StringType.Latin1)
      : name;
  const result = ByteVector.fromUInt(data.length + 8);
  result.append(nameVec);
  result.append(data);
  return result;
}

function renderDataAtom(
  name: ByteVector,
  flags: number,
  dataList: ByteVector[],
): ByteVector {
  const result = new ByteVector();
  for (const d of dataList) {
    const payload = ByteVector.fromUInt(flags);
    payload.append(ByteVector.fromSize(4, 0));
    payload.append(d);
    result.append(renderAtom("data", payload));
  }
  return renderAtom(name, result);
}

function renderBool(name: ByteVector, item: Mp4Item): ByteVector {
  return renderDataAtom(name, AtomDataType.TypeInteger, [
    ByteVector.fromSize(1, item.toBool() ? 1 : 0),
  ]);
}

function renderInt(name: ByteVector, item: Mp4Item): ByteVector {
  return renderDataAtom(name, AtomDataType.TypeInteger, [
    ByteVector.fromShort(item.toInt()),
  ]);
}

function renderUInt(name: ByteVector, item: Mp4Item): ByteVector {
  return renderDataAtom(name, AtomDataType.TypeInteger, [
    ByteVector.fromUInt(item.toUInt()),
  ]);
}

function renderLongLong(name: ByteVector, item: Mp4Item): ByteVector {
  return renderDataAtom(name, AtomDataType.TypeInteger, [
    ByteVector.fromLongLong(item.toLongLong()),
  ]);
}

function renderByte(name: ByteVector, item: Mp4Item): ByteVector {
  return renderDataAtom(name, AtomDataType.TypeInteger, [
    ByteVector.fromSize(1, item.toByte()),
  ]);
}

function renderIntPair(name: ByteVector, item: Mp4Item): ByteVector {
  const [first, second] = item.toIntPair();
  const payload = ByteVector.fromSize(2, 0);
  payload.append(ByteVector.fromShort(first));
  payload.append(ByteVector.fromShort(second));
  payload.append(ByteVector.fromSize(2, 0));
  return renderDataAtom(name, AtomDataType.TypeImplicit, [payload]);
}

function renderIntPairNoTrailing(name: ByteVector, item: Mp4Item): ByteVector {
  const [first, second] = item.toIntPair();
  const payload = ByteVector.fromSize(2, 0);
  payload.append(ByteVector.fromShort(first));
  payload.append(ByteVector.fromShort(second));
  return renderDataAtom(name, AtomDataType.TypeImplicit, [payload]);
}

function renderText(
  name: ByteVector,
  item: Mp4Item,
  flags: number = AtomDataType.TypeUTF8,
): ByteVector {
  const data = item.toStringList().map(s =>
    ByteVector.fromString(s, StringType.UTF8),
  );
  return renderDataAtom(name, flags, data);
}

function renderCovr(name: ByteVector, item: Mp4Item): ByteVector {
  const data = new ByteVector();
  for (const art of item.toCoverArtList()) {
    const payload = ByteVector.fromUInt(art.format as number);
    payload.append(ByteVector.fromSize(4, 0));
    payload.append(art.data);
    data.append(renderAtom("data", payload));
  }
  return renderAtom(name, data);
}

function renderFreeForm(itemName: string, item: Mp4Item): ByteVector {
  const parts = itemName.split(":");
  if (parts.length !== 3) return new ByteVector();

  const data = new ByteVector();
  // mean atom
  const meanPayload = ByteVector.fromUInt(0);
  meanPayload.append(ByteVector.fromString(parts[1], StringType.UTF8));
  data.append(renderAtom("mean", meanPayload));
  // name atom
  const namePayload = ByteVector.fromUInt(0);
  namePayload.append(ByteVector.fromString(parts[2], StringType.UTF8));
  data.append(renderAtom("name", namePayload));

  let type = item.atomDataType;
  if (type === AtomDataType.TypeUndefined) {
    type = item.toStringList().length > 0
      ? AtomDataType.TypeUTF8
      : AtomDataType.TypeImplicit;
  }

  if (type === AtomDataType.TypeUTF8) {
    for (const s of item.toStringList()) {
      const valPayload = ByteVector.fromUInt(type);
      valPayload.append(ByteVector.fromSize(4, 0));
      valPayload.append(ByteVector.fromString(s, StringType.UTF8));
      data.append(renderAtom("data", valPayload));
    }
  } else {
    for (const bv of item.toByteVectorList()) {
      const valPayload = ByteVector.fromUInt(type);
      valPayload.append(ByteVector.fromSize(4, 0));
      valPayload.append(bv);
      data.append(renderAtom("data", valPayload));
    }
  }

  return renderAtom("----", data);
}

// ---------------------------------------------------------------------------
// Property ↔ Item conversion helpers
// ---------------------------------------------------------------------------

function itemToProperty(
  itemName: string,
  item: Mp4Item,
): [string, string[]] {
  const key = propertyKeyForName(itemName);
  if (!key) return ["", []];

  const handler = itemName.startsWith("----")
    ? ItemHandlerType.FreeForm
    : handlerTypeForName(itemName);

  switch (handler) {
    case ItemHandlerType.IntPair:
    case ItemHandlerType.IntPairNoTrailing: {
      const [vn, tn] = item.toIntPair();
      let value = String(vn);
      if (tn) value += "/" + String(tn);
      return [key, [value]];
    }
    case ItemHandlerType.Int:
    case ItemHandlerType.Gnre:
      return [key, [String(item.toInt())]];
    case ItemHandlerType.UInt:
      return [key, [String(item.toUInt())]];
    case ItemHandlerType.LongLong:
      return [key, [String(item.toLongLong())]];
    case ItemHandlerType.Byte:
      return [key, [String(item.toByte())]];
    case ItemHandlerType.Bool:
      return [key, [item.toBool() ? "1" : "0"]];
    case ItemHandlerType.FreeForm:
    case ItemHandlerType.TextOrInt:
    case ItemHandlerType.TextImplicit:
    case ItemHandlerType.Text:
      return [key, item.toStringList()];
    default:
      return ["", []];
  }
}

function itemFromProperty(
  propKey: string,
  values: string[],
): [string, Mp4Item] {
  const name = nameForPropertyKey(propKey);
  if (!name) return ["", Mp4Item.invalid()];
  if (values.length === 0) return [name, Mp4Item.fromStringList(values)];

  const handler = name.startsWith("----")
    ? ItemHandlerType.FreeForm
    : handlerTypeForName(name);

  switch (handler) {
    case ItemHandlerType.IntPair:
    case ItemHandlerType.IntPairNoTrailing: {
      const parts = values[0].split("/");
      const first = parseInt(parts[0], 10) || 0;
      const second = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
      return [name, Mp4Item.fromIntPair(first, second)];
    }
    case ItemHandlerType.Int:
    case ItemHandlerType.Gnre:
      return [name, Mp4Item.fromInt(parseInt(values[0], 10) || 0)];
    case ItemHandlerType.UInt:
      return [name, Mp4Item.fromUInt(parseInt(values[0], 10) || 0)];
    case ItemHandlerType.LongLong:
      return [name, Mp4Item.fromLongLong(BigInt(parseInt(values[0], 10) || 0))];
    case ItemHandlerType.Byte:
      return [name, Mp4Item.fromByte(parseInt(values[0], 10) || 0)];
    case ItemHandlerType.Bool:
      return [name, Mp4Item.fromBool(parseInt(values[0], 10) !== 0)];
    case ItemHandlerType.FreeForm:
    case ItemHandlerType.TextOrInt:
    case ItemHandlerType.TextImplicit:
    case ItemHandlerType.Text:
      return [name, Mp4Item.fromStringList(values)];
    default:
      return [name, Mp4Item.invalid()];
  }
}

// ---------------------------------------------------------------------------
// Mp4Tag
// ---------------------------------------------------------------------------

export class Mp4Tag extends Tag {
  private _stream: IOStream;
  private _atoms: Mp4Atoms;
  private _items: Map<string, Mp4Item> = new Map();

  private constructor(stream: IOStream, atoms: Mp4Atoms) {
    super();
    this._stream = stream;
    this._atoms = atoms;
  }

  static async create(stream: IOStream, atoms: Mp4Atoms): Promise<Mp4Tag> {
    const tag = new Mp4Tag(stream, atoms);
    const ilst = atoms.find("moov", "udta", "meta", "ilst");
    if (ilst) {
      for (const atom of ilst.children) {
        await stream.seek(atom.offset + 8);
        const data = await stream.readBlock(atom.length - 8);
        const [name, item] = parseItem(atom.name, data);
        if (item.isValid() && !tag._items.has(name)) {
          tag._items.set(name, item);
        }
      }
    }
    return tag;
  }

  tag(): Tag {
    return this;
  }

  // -- Tag interface --

  get title(): string {
    return this._items.get("\u00A9nam")?.toStringList().join(", ") ?? "";
  }
  set title(v: string) {
    this.setTextItem("\u00A9nam", v);
  }

  get artist(): string {
    return this._items.get("\u00A9ART")?.toStringList().join(", ") ?? "";
  }
  set artist(v: string) {
    this.setTextItem("\u00A9ART", v);
  }

  get album(): string {
    return this._items.get("\u00A9alb")?.toStringList().join(", ") ?? "";
  }
  set album(v: string) {
    this.setTextItem("\u00A9alb", v);
  }

  get comment(): string {
    return this._items.get("\u00A9cmt")?.toStringList().join(", ") ?? "";
  }
  set comment(v: string) {
    this.setTextItem("\u00A9cmt", v);
  }

  get genre(): string {
    return this._items.get("\u00A9gen")?.toStringList().join(", ") ?? "";
  }
  set genre(v: string) {
    this.setTextItem("\u00A9gen", v);
  }

  get year(): number {
    const dayItem = this._items.get("\u00A9day");
    if (dayItem) {
      return parseInt(dayItem.toStringList().join(""), 10) || 0;
    }
    return 0;
  }
  set year(v: number) {
    if (v === 0) {
      this._items.delete("\u00A9day");
    } else {
      this._items.set("\u00A9day", Mp4Item.fromStringList([String(v)]));
    }
  }

  get track(): number {
    const trk = this._items.get("trkn");
    return trk ? trk.toIntPair()[0] : 0;
  }
  set track(v: number) {
    if (v === 0) {
      this._items.delete("trkn");
    } else {
      this._items.set("trkn", Mp4Item.fromIntPair(v, 0));
    }
  }

  get isEmpty(): boolean {
    return this._items.size === 0;
  }

  // -- MP4-specific --

  get items(): Map<string, Mp4Item> {
    return this._items;
  }

  item(key: string): Mp4Item | undefined {
    return this._items.get(key);
  }

  setItem(key: string, item: Mp4Item): void {
    this._items.set(key, item);
  }

  removeItem(key: string): void {
    this._items.delete(key);
  }

  contains(key: string): boolean {
    return this._items.has(key);
  }

  // -- PropertyMap --

  override properties(): PropertyMap {
    const props = new PropertyMap();
    for (const [k, itm] of this._items) {
      const [key, val] = itemToProperty(k, itm);
      if (key) {
        props.insert(key, val);
      } else {
        props.addUnsupportedData(k);
      }
    }
    return props;
  }

  override removeUnsupportedProperties(props: string[]): void {
    for (const p of props) this._items.delete(p);
  }

  override setProperties(props: PropertyMap): PropertyMap {
    const origProps = this.properties();
    for (const prop of origProps.keys()) {
      if (!props.contains(prop) || (props.get(prop) ?? []).length === 0) {
        const n = nameForPropertyKey(prop);
        if (n) this._items.delete(n);
      }
    }

    const ignoredProps = new PropertyMap();
    for (const [prop, val] of props.entries()) {
      const [name, itm] = itemFromProperty(prop, val);
      if (itm.isValid()) {
        this._items.set(name, itm);
      } else {
        ignoredProps.insert(prop, val);
      }
    }
    return ignoredProps;
  }

  override complexPropertyKeys(): string[] {
    const keys: string[] = [];
    if (this._items.has("covr")) keys.push("PICTURE");
    return keys;
  }

  override complexProperties(key: string): VariantMap[] {
    const result: VariantMap[] = [];
    const upper = key.toUpperCase();

    if (upper === "PICTURE") {
      const covrItem = this._items.get("covr");
      if (!covrItem) return result;
      for (const pic of covrItem.toCoverArtList()) {
        let mimeType = "image/";
        switch (pic.format) {
          case Mp4CoverArtFormat.BMP: mimeType += "bmp"; break;
          case Mp4CoverArtFormat.JPEG: mimeType += "jpeg"; break;
          case Mp4CoverArtFormat.GIF: mimeType += "gif"; break;
          case Mp4CoverArtFormat.PNG: mimeType += "png"; break;
          default: break;
        }
        const property: VariantMap = new Map();
        property.set("data", Variant.fromByteVector(pic.data));
        property.set("mimeType", Variant.fromString(mimeType));
        result.push(property);
      }
    }
    return result;
  }

  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    const upper = key.toUpperCase();

    if (upper === "PICTURE") {
      const pictures: Mp4CoverArt[] = [];
      for (const property of value) {
        const mimeType = property.get("mimeType")?.toString() ?? "";
        let format: Mp4CoverArtFormat;
        if (mimeType === "image/bmp") format = Mp4CoverArtFormat.BMP;
        else if (mimeType === "image/png") format = Mp4CoverArtFormat.PNG;
        else if (mimeType === "image/gif") format = Mp4CoverArtFormat.GIF;
        else if (mimeType === "image/jpeg") format = Mp4CoverArtFormat.JPEG;
        else format = Mp4CoverArtFormat.Unknown;
        pictures.push(
          new Mp4CoverArt(format, property.get("data")?.toByteVector() ?? new ByteVector()),
        );
      }
      this._items.set("covr", Mp4Item.fromCoverArtList(pictures));
      return true;
    }
    return false;
  }

  // -- Rendering / Saving --

  render(): ByteVector {
    const ilstData = new ByteVector();
    // Sort items alphabetically to match C++ TagLib::Map<String, Item> iteration order.
    const sortedItems = [...this._items.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [name, itm] of sortedItems) {
      ilstData.append(itm.render(name));
    }
    return renderAtom("ilst", ilstData);
  }

  async save(): Promise<boolean> {
    let ilstData = new ByteVector();
    // Sort items alphabetically to match C++ TagLib::Map<String, Item> iteration order.
    const sortedItems = [...this._items.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [name, itm] of sortedItems) {
      ilstData.append(itm.render(name));
    }
    ilstData = renderAtom("ilst", ilstData);

    const path = this._atoms.path("moov", "udta", "meta", "ilst");
    if (path.length === 4) {
      await this.saveExisting(ilstData, path);
    } else {
      const hdlrData = ByteVector.fromSize(8, 0);
      hdlrData.append(ByteVector.fromString("mdirappl", StringType.Latin1));
      hdlrData.append(ByteVector.fromSize(9, 0));

      const metaVersionFlags = ByteVector.fromSize(4, 0);
      const metaPayload = new ByteVector();
      metaPayload.append(metaVersionFlags);
      metaPayload.append(renderAtom("hdlr", hdlrData));
      metaPayload.append(ilstData);
      metaPayload.append(padIlst(ilstData));
      const metaData = renderAtom("meta", metaPayload);
      await this.saveNew(metaData);
    }
    return true;
  }

  async strip(): Promise<boolean> {
    this._items.clear();
    const path = this._atoms.path("moov", "udta", "meta", "ilst");
    if (path.length === 4) {
      await this.saveExisting(new ByteVector(), path);
    }
    return true;
  }

  // -- Private helpers --

  private setTextItem(key: string, value: string): void {
    if (value) {
      this._items.set(key, Mp4Item.fromStringList([value]));
    } else {
      this._items.delete(key);
    }
  }

  private async updateParents(path: Mp4Atom[], delta: number, ignore = 0): Promise<void> {
    const end = path.length - ignore;
    for (let i = 0; i < end; i++) {
      const atom = path[i];
      await this._stream.seek(atom.offset);
      const sizeWord = (await this._stream.readBlock(4)).toUInt();
      if (sizeWord === 1) {
        // 64-bit size
        await this._stream.seek(4, Position.Current); // skip name
        const longSize = Number((await this._stream.readBlock(8)).toLongLong());
        await this._stream.seek(atom.offset + 8);
        await this._stream.writeBlock(ByteVector.fromLongLong(BigInt(longSize + delta)));
      } else {
        await this._stream.seek(atom.offset);
        await this._stream.writeBlock(ByteVector.fromUInt(sizeWord + delta));
      }
    }
  }

  private async updateOffsets(delta: number, offset: number): Promise<void> {
    const moov = this._atoms.find("moov");
    if (moov) {
      // Update stco (32-bit chunk offsets)
      for (const atom of moov.findAll("stco", true)) {
        if (atom.offset > offset) atom.addToOffset(delta);
        await this._stream.seek(atom.offset + 12);
        const data = await this._stream.readBlock(atom.length - 12);
        let count = data.toUInt();
        await this._stream.seek(atom.offset + 16);
        let pos = 4;
        while (count-- > 0) {
          let o = data.toUInt(pos);
          if (o > offset) o += delta;
          await this._stream.writeBlock(ByteVector.fromUInt(o));
          pos += 4;
        }
      }
      // Update co64 (64-bit chunk offsets)
      for (const atom of moov.findAll("co64", true)) {
        if (atom.offset > offset) atom.addToOffset(delta);
        await this._stream.seek(atom.offset + 12);
        const data = await this._stream.readBlock(atom.length - 12);
        let count = data.toUInt();
        await this._stream.seek(atom.offset + 16);
        let pos = 4;
        while (count-- > 0) {
          let o = Number(data.toLongLong(pos));
          if (o > offset) o += delta;
          await this._stream.writeBlock(ByteVector.fromLongLong(BigInt(o)));
          pos += 8;
        }
      }
    }

    const moof = this._atoms.find("moof");
    if (moof) {
      for (const atom of moof.findAll("tfhd", true)) {
        if (atom.offset > offset) atom.addToOffset(delta);
        await this._stream.seek(atom.offset + 9);
        const data = await this._stream.readBlock(atom.length - 9);
        const flags = data.toUInt(0, 3);
        if (flags & 1) {
          let o = Number(data.toLongLong(7));
          if (o > offset) o += delta;
          await this._stream.seek(atom.offset + 16);
          await this._stream.writeBlock(ByteVector.fromLongLong(BigInt(o)));
        }
      }
    }
  }

  private async saveNew(data: ByteVector): Promise<void> {
    let path = this._atoms.path("moov", "udta");
    if (path.length !== 2) {
      path = this._atoms.path("moov");
      data = renderAtom("udta", data);
    }

    const offset = path[path.length - 1].offset + 8;
    await this._stream.insert(data, offset, 0);
    await this.updateParents(path, data.length);
    await this.updateOffsets(data.length, offset);

    // Insert newly-created atom into tree
    await this._stream.seek(offset);
    path[path.length - 1].prependChild(await Mp4Atom.parse(this._stream));
  }

  private async saveExisting(data: ByteVector, path: Mp4Atom[]): Promise<void> {
    const ilst = path[path.length - 1];
    let offset = ilst.offset;
    let length = ilst.length;
    const meta = path[path.length - 2];

    const ilstIdx = meta.children.indexOf(ilst);

    // Check for free atom before ilst
    if (ilstIdx > 0) {
      const prev = meta.children[ilstIdx - 1];
      if (prev.name === "free") {
        offset = prev.offset;
        length += prev.length;
      }
    }
    // Check for free atom after ilst
    if (ilstIdx < meta.children.length - 1) {
      const next = meta.children[ilstIdx + 1];
      if (next.name === "free") {
        length += next.length;
      }
    }

    let delta = data.length - length;
    if (!data.isEmpty) {
      if (delta > 0 || (delta < 0 && delta > -8)) {
        data.append(padIlst(data));
        delta = data.length - length;
      } else if (delta < 0) {
        data.append(padIlst(data, -delta - 8));
        delta = 0;
      }

      await this._stream.insert(data, offset, length);

      if (delta) {
        await this.updateParents(path, delta, 1);
        await this.updateOffsets(delta, offset);
      }
    } else {
      // Strip: remove the meta atom
      const udta = path[path.length - 3];
      if (udta && udta.removeChild(meta)) {
        const metaOffset = meta.offset;
        const metaDelta = -meta.length;
        await this._stream.removeBlock(meta.offset, meta.length);
        if (metaDelta) {
          await this.updateParents(path, metaDelta, 2);
          await this.updateOffsets(metaDelta, metaOffset);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Padding helper
// ---------------------------------------------------------------------------

function padIlst(data: ByteVector, length = -1): ByteVector {
  if (length === -1) {
    length = ((data.length + 1023) & ~1023) - data.length;
  }
  const padding = ByteVector.fromSize(length, 1);
  return renderAtom("free", padding);
}
