import { ByteVector, StringType } from "../../byteVector.js";
import { Tag } from "../../tag.js";
import { PropertyMap } from "../../toolkit/propertyMap.js";
import type { VariantMap } from "../../toolkit/variant.js";
import { Variant } from "../../toolkit/variant.js";
import type { offset_t } from "../../toolkit/types.js";
import type { IOStream } from "../../toolkit/ioStream.js";
import { Id3v2Header } from "./id3v2Header.js";
import { Id3v2ExtendedHeader } from "./id3v2ExtendedHeader.js";
import { Id3v2Footer } from "./id3v2Footer.js";
import type { Id3v2Frame } from "./id3v2Frame.js";
import { Id3v2FrameFactory } from "./id3v2FrameFactory.js";
import { SynchData } from "./id3v2SynchData.js";
import { TextIdentificationFrame, UserTextIdentificationFrame } from "./frames/textIdentificationFrame.js";
import { CommentsFrame } from "./frames/commentsFrame.js";
import { AttachedPictureFrame, PictureType } from "./frames/attachedPictureFrame.js";
import { UniqueFileIdentifierFrame } from "./frames/uniqueFileIdentifierFrame.js";
import { UnsynchronizedLyricsFrame } from "./frames/unsynchronizedLyricsFrame.js";
import { UserUrlLinkFrame } from "./frames/urlLinkFrame.js";
import { genre as id3v1Genre } from "../id3v1/id3v1Genres.js";

/**
 * Standard frame ID → property name mapping for ID3v2.
 */
const frameIdToProperty = new Map<string, string>([
  ["TIT1", "CONTENTGROUP"],
  ["TIT2", "TITLE"],
  ["TIT3", "SUBTITLE"],
  ["TPE1", "ARTIST"],
  ["TPE2", "ALBUMARTIST"],
  ["TPE3", "CONDUCTOR"],
  ["TPE4", "REMIXER"],
  ["TALB", "ALBUM"],
  ["TCOM", "COMPOSER"],
  ["TEXT", "LYRICIST"],
  ["TRCK", "TRACKNUMBER"],
  ["TPOS", "DISCNUMBER"],
  ["TDRC", "DATE"],
  ["TDOR", "ORIGINALDATE"],
  ["TYER", "DATE"],
  ["TCON", "GENRE"],
  ["TSRC", "ISRC"],
  ["TBPM", "BPM"],
  ["TCOP", "COPYRIGHT"],
  ["TENC", "ENCODEDBY"],
  ["TMOO", "MOOD"],
  ["TMED", "MEDIA"],
  ["TPUB", "LABEL"],
  ["TCMP", "COMPILATION"],
  ["TSOA", "ALBUMSORT"],
  ["TSOT", "TITLESORT"],
  ["TSOP", "ARTISTSORT"],
  ["TLAN", "LANGUAGE"],
  ["WCOP", "COPYRIGHTURL"],
  ["WOAF", "URL"],
  ["WOAR", "ARTISTWEBPAGE"],
  ["TSSE", "ENCODING"],
  ["TKEY", "INITIALKEY"],
  ["TOAL", "ORIGINALALBUM"],
  ["TOLY", "ORIGINALLYRICIST"],
  ["TOFN", "ORIGINALFILENAME"],
  ["TDLY", "PLAYLISTDELAY"],
  ["TFLT", "FILETYPE"],
  ["TLEN", "LENGTH"],
  ["TSO2", "ALBUMARTISTSORT"],
  ["TSOC", "COMPOSERSORT"],
  ["TCAT", "PODCASTCATEGORY"],
  ["TDES", "PODCASTDESC"],
  ["TGID", "PODCASTID"],
  ["TDRL", "RELEASEDATE"],
  ["WFED", "PODCASTURL"],
  ["MVNM", "MOVEMENTNAME"],
  ["MVIN", "MOVEMENTNUMBER"],
  ["GRP1", "GROUPING"],
  ["TIPL", "INVOLVEDPEOPLE"],
]);

// Reverse mapping: property name → frame ID
const propertyToFrameId = new Map<string, string>();
for (const [fid, prop] of frameIdToProperty) {
  if (!propertyToFrameId.has(prop)) {
    propertyToFrameId.set(prop, fid);
  }
}

/**
 * Parse ID3v1-style genre references from a TCON field value.
 * Handles formats like "(17)", "17", "(17)Rock", "(17)(18)", etc.
 */
function parseGenreString(genreStr: string): string {
  if (!genreStr) return "";

  const results: string[] = [];
  let remaining = genreStr;

  // Match parenthesized numbers like (17) and bare numbers
  const parenRegex = /^\((\d+)\)/;
  const bareNumberRegex = /^(\d+)$/;

  while (remaining.length > 0) {
    const parenMatch = remaining.match(parenRegex);
    if (parenMatch) {
      const index = parseInt(parenMatch[1], 10);
      const genreName = id3v1Genre(index);
      if (genreName) {
        results.push(genreName);
      }
      remaining = remaining.substring(parenMatch[0].length);
      continue;
    }

    // If what remains is a bare number, try to look it up
    const bareMatch = remaining.match(bareNumberRegex);
    if (bareMatch) {
      const index = parseInt(bareMatch[1], 10);
      const genreName = id3v1Genre(index);
      if (genreName) {
        results.push(genreName);
      } else {
        results.push(remaining);
      }
      break;
    }

    // Find the next paren group or take the rest as-is
    const nextParen = remaining.indexOf("(");
    if (nextParen > 0) {
      results.push(remaining.substring(0, nextParen));
      remaining = remaining.substring(nextParen);
    } else {
      results.push(remaining);
      break;
    }
  }

  return results.join(" / ");
}

/**
 * ID3v2 tag implementation.
 */
export class Id3v2Tag extends Tag {
  private _header: Id3v2Header;
  private _extendedHeader: Id3v2ExtendedHeader | null = null;
  private _footer: Id3v2Footer | null = null;
  private _frames: Id3v2Frame[] = [];

  constructor() {
    super();
    this._header = new Id3v2Header();
  }

  /**
   * An ID3v2 tag is empty only when it contains no frames at all.
   * This ensures tags that contain only non-text frames (e.g. APIC pictures)
   * are not incorrectly stripped during save.
   */
  override get isEmpty(): boolean {
    return this._frames.length === 0;
  }

  /**
   * Read an ID3v2 tag from a stream at the given offset.
   */
  static readFrom(
    stream: IOStream,
    offset: offset_t,
    factory?: Id3v2FrameFactory,
  ): Id3v2Tag {
    const tag = new Id3v2Tag();
    const frameFactory = factory ?? Id3v2FrameFactory.instance;

    // Read and parse the header
    stream.seek(offset);
    const headerData = stream.readBlock(Id3v2Header.size);
    const header = Id3v2Header.parse(headerData);
    if (!header) {
      return tag;
    }
    tag._header = header;

    const version = header.majorVersion;

    // Read all tag data (after the header, before any footer)
    const tagData = stream.readBlock(header.tagSize);

    // If the tag uses unsynchronisation (v2.3 whole-tag unsync), decode it
    let frameData: ByteVector;
    if (header.unsynchronisation && version < 4) {
      frameData = SynchData.decode(tagData);
    } else {
      frameData = tagData;
    }

    let pos = 0;

    // Parse extended header if present
    if (header.extendedHeader) {
      tag._extendedHeader = new Id3v2ExtendedHeader();
      tag._extendedHeader.parse(frameData, version);
      pos += tag._extendedHeader.size;
    }

    // Parse frames
    const headerSize = version < 3 ? 6 : 10;

    while (pos + headerSize <= frameData.length) {
      // Check for padding (all zeros)
      let isPadding = true;
      for (let i = 0; i < headerSize && pos + i < frameData.length; i++) {
        if (frameData.get(pos + i) !== 0) {
          isPadding = false;
          break;
        }
      }
      if (isPadding) break;

      const result = frameFactory.createFrame(frameData, header, pos);
      if (!result.frame || result.size === 0) {
        break;
      }

      tag._frames.push(result.frame);
      pos += result.size;
    }

    return tag;
  }

  // ---------------------------------------------------------------------------
  // Tag interface
  // ---------------------------------------------------------------------------

  get title(): string {
    return this._getTextFrameValue("TIT2");
  }

  set title(value: string) {
    this._setTextFrameValue("TIT2", value);
  }

  get artist(): string {
    return this._getTextFrameValue("TPE1");
  }

  set artist(value: string) {
    this._setTextFrameValue("TPE1", value);
  }

  get album(): string {
    return this._getTextFrameValue("TALB");
  }

  set album(value: string) {
    this._setTextFrameValue("TALB", value);
  }

  get comment(): string {
    const frames = this.frameListByFrameId("COMM");
    for (const f of frames) {
      if (f instanceof CommentsFrame) {
        const text = f.text;
        if (text) return text;
      }
    }
    return "";
  }

  set comment(value: string) {
    if (!value) {
      this.removeFrames("COMM");
      return;
    }
    let existing: CommentsFrame | null = null;
    for (const f of this.frameListByFrameId("COMM")) {
      if (f instanceof CommentsFrame) {
        existing = f;
        break;
      }
    }
    if (existing) {
      existing.text = value;
    } else {
      const frame = new CommentsFrame();
      frame.text = value;
      this.addFrame(frame);
    }
  }

  get genre(): string {
    const raw = this._getTextFrameValue("TCON");
    return parseGenreString(raw);
  }

  set genre(value: string) {
    this._setTextFrameValue("TCON", value);
  }

  get year(): number {
    const dateStr = this._getTextFrameValue("TDRC") || this._getTextFrameValue("TYER");
    if (!dateStr) return 0;
    const parsed = parseInt(dateStr.substring(0, 4), 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  set year(value: number) {
    if (value === 0) {
      this.removeFrames("TDRC");
      this.removeFrames("TYER");
      return;
    }
    this._setTextFrameValue("TDRC", String(value));
  }

  get track(): number {
    const trackStr = this._getTextFrameValue("TRCK");
    if (!trackStr) return 0;
    // May contain "3/12" format
    const slashIndex = trackStr.indexOf("/");
    const numStr = slashIndex >= 0 ? trackStr.substring(0, slashIndex) : trackStr;
    const parsed = parseInt(numStr, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  set track(value: number) {
    if (value === 0) {
      this.removeFrames("TRCK");
      return;
    }
    this._setTextFrameValue("TRCK", String(value));
  }

  // ---------------------------------------------------------------------------
  // ID3v2-specific accessors
  // ---------------------------------------------------------------------------

  get header(): Id3v2Header {
    return this._header;
  }

  get extendedHeader(): Id3v2ExtendedHeader | null {
    return this._extendedHeader;
  }

  get footer(): Id3v2Footer | null {
    return this._footer;
  }

  // ---------------------------------------------------------------------------
  // Frame access
  // ---------------------------------------------------------------------------

  get frameList(): Id3v2Frame[] {
    return [...this._frames];
  }

  frameListByFrameId(frameId: ByteVector | string): Id3v2Frame[] {
    const id = typeof frameId === "string"
      ? ByteVector.fromString(frameId, StringType.Latin1)
      : frameId;
    return this._frames.filter(
      f => f.header.frameId.equals(id),
    );
  }

  addFrame(frame: Id3v2Frame): void {
    this._frames.push(frame);
  }

  removeFrame(frame: Id3v2Frame): void {
    const idx = this._frames.indexOf(frame);
    if (idx >= 0) {
      this._frames.splice(idx, 1);
    }
  }

  removeFrames(frameId: ByteVector | string): void {
    const id = typeof frameId === "string"
      ? ByteVector.fromString(frameId, StringType.Latin1)
      : frameId;
    this._frames = this._frames.filter(
      f => !f.header.frameId.equals(id),
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(version?: number): ByteVector {
    const ver = version ?? this._header.majorVersion;

    // Render all frames
    const renderedFrames = new ByteVector();
    for (const frame of this._frames) {
      try {
        renderedFrames.append(frame.render(ver));
      } catch {
        // Skip frames that fail to render
      }
    }

    // Build header
    const header = new Id3v2Header();
    header.majorVersion = ver;
    header.tagSize = renderedFrames.length;

    const result = new ByteVector();
    result.append(header.render());
    result.append(renderedFrames);

    // Append footer for v2.4 with footer flag
    if (ver === 4 && this._header.footerPresent) {
      const footer = new Id3v2Footer();
      result.append(footer.render(header));
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // PropertyMap
  // ---------------------------------------------------------------------------

  override properties(): PropertyMap {
    const map = new PropertyMap();

    for (const frame of this._frames) {
      const frameId = frame.header.frameId.toString(StringType.Latin1);
      const propName = frameIdToProperty.get(frameId);

      if (frameId === "TXXX" && frame instanceof UserTextIdentificationFrame) {
        const desc = frame.description;
        if (desc) {
          const values = frame.text ? [frame.text] : [];
          if (values.length > 0) {
            map.replace(desc.toUpperCase(), values);
          }
        }
        continue;
      }

      if (frameId === "UFID" && frame instanceof UniqueFileIdentifierFrame) {
        if (frame.owner === "http://musicbrainz.org") {
          const id = frame.identifier;
          if (id && id.length > 0) {
            map.replace("MUSICBRAINZ_TRACKID", [id.toString(StringType.Latin1)]);
          }
        }
        continue;
      }

      if (frameId === "COMM" && frame instanceof CommentsFrame) {
        const text = frame.text;
        if (text) {
          const existing = map.get("COMMENT");
          if (existing) {
            existing.push(text);
          } else {
            map.replace("COMMENT", [text]);
          }
        }
        continue;
      }

      if (frameId === "USLT" && frame instanceof UnsynchronizedLyricsFrame) {
        const text = frame.text;
        if (text) {
          map.replace("LYRICS", [text]);
        }
        continue;
      }

      if (frameId === "WXXX" && frame instanceof UserUrlLinkFrame) {
        const desc = frame.description;
        const url = frame.url;
        if (desc && url) {
          map.replace(desc.toUpperCase(), [url]);
        }
        continue;
      }

      if (propName && frame instanceof TextIdentificationFrame) {
        const text = frame.text;
        if (text) {
          if (frameId === "TCON") {
            // Parse genre references
            const parsed = parseGenreString(text);
            if (parsed) {
              map.replace(propName, [parsed]);
            }
          } else {
            map.replace(propName, [text]);
          }
        }
        continue;
      }

      if (!propName) {
        map.addUnsupportedData(frameId);
      }
    }

    return map;
  }

  override setProperties(properties: PropertyMap): PropertyMap {
    const unsupported = new PropertyMap();

    // Remove frames for properties we're going to set
    for (const [key] of properties.entries()) {
      const frameId = propertyToFrameId.get(key);
      if (frameId) {
        this.removeFrames(frameId);
      } else if (key === "COMMENT") {
        this.removeFrames("COMM");
      } else if (key === "LYRICS") {
        this.removeFrames("USLT");
      } else if (key === "MUSICBRAINZ_TRACKID") {
        this.removeFrames("UFID");
      }
    }

    for (const [key, values] of properties.entries()) {
      if (values.length === 0) continue;

      const frameId = propertyToFrameId.get(key);

      if (frameId) {
        const frame = new TextIdentificationFrame(
          ByteVector.fromString(frameId, StringType.Latin1),
        );
        frame.text = values[0];
        this.addFrame(frame);
        continue;
      }

      if (key === "COMMENT") {
        for (const val of values) {
          const frame = new CommentsFrame();
          frame.text = val;
          this.addFrame(frame);
        }
        continue;
      }

      if (key === "LYRICS") {
        const frame = new UnsynchronizedLyricsFrame();
        frame.text = values[0];
        this.addFrame(frame);
        continue;
      }

      if (key === "MUSICBRAINZ_TRACKID") {
        const frame = new UniqueFileIdentifierFrame(
          "http://musicbrainz.org",
          ByteVector.fromString(values[0], StringType.Latin1),
        );
        this.addFrame(frame);
        continue;
      }

      // Try as TXXX
      const txxx = new UserTextIdentificationFrame();
      txxx.description = key;
      txxx.text = values[0];
      this.addFrame(txxx);
    }

    return unsupported;
  }

  override complexPropertyKeys(): string[] {
    const keys: string[] = [];
    const hasPicture = this._frames.some(
      f => f.header.frameId.toString(StringType.Latin1) === "APIC",
    );
    if (hasPicture) keys.push("PICTURE");
    return keys;
  }

  override complexProperties(key: string): VariantMap[] {
    if (key.toUpperCase() === "PICTURE") {
      const result: VariantMap[] = [];
      for (const f of this.frameListByFrameId("APIC")) {
        if (f instanceof AttachedPictureFrame) {
          const m = new Map<string, Variant>();
          m.set("data", Variant.fromByteVector(f.picture));
          m.set("mimeType", Variant.fromString(f.mimeType));
          m.set("description", Variant.fromString(f.description));
          m.set("pictureType", Variant.fromString(String(f.pictureType)));
          result.push(m);
        }
      }
      return result;
    }
    return [];
  }

  override setComplexProperties(key: string, value: VariantMap[]): boolean {
    if (key.toUpperCase() === "PICTURE") {
      this.removeFrames("APIC");
      for (const m of value) {
        const frame = new AttachedPictureFrame();
        const data = m.get("data");
        if (data) frame.picture = data.toByteVector();
        const mimeType = m.get("mimeType");
        if (mimeType) frame.mimeType = mimeType.toString();
        const desc = m.get("description");
        if (desc) frame.description = desc.toString();
        const picType = m.get("pictureType");
        if (picType) {
          const typeNum = parseInt(picType.toString(), 10);
          if (!isNaN(typeNum)) frame.pictureType = typeNum as PictureType;
        }
        this.addFrame(frame);
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _getTextFrameValue(frameId: string): string {
    const frames = this.frameListByFrameId(frameId);
    for (const f of frames) {
      if (f instanceof TextIdentificationFrame) {
        return f.text || "";
      }
    }
    return "";
  }

  private _setTextFrameValue(frameId: string, value: string): void {
    if (!value) {
      this.removeFrames(frameId);
      return;
    }

    const frames = this.frameListByFrameId(frameId);
    for (const f of frames) {
      if (f instanceof TextIdentificationFrame) {
        f.text = value;
        return;
      }
    }

    const frame = new TextIdentificationFrame(
      ByteVector.fromString(frameId, StringType.Latin1),
    );
    frame.text = value;
    this.addFrame(frame);
  }
}
