/** @file ID3v2 tag implementation supporting read, write, and PropertyMap access for all standard frame types. */
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
 * Maps four-character frame IDs (e.g. `"TIT2"`) to TagLib property names (e.g. `"TITLE"`).
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

/**
 * Reverse mapping built from {@link frameIdToProperty}: property name → frame ID.
 * Only the first frame ID encountered for each property is stored (giving v2.4 IDs priority).
 */
const propertyToFrameId = new Map<string, string>();
for (const [fid, prop] of frameIdToProperty) {
  if (!propertyToFrameId.has(prop)) {
    propertyToFrameId.set(prop, fid);
  }
}

/**
 * Parse ID3v1-style genre references from a TCON field value.
 * Handles formats like "(17)", "17", "(17)Rock", "(17)(18)", etc.
 *
 * @param genreStr - The raw TCON frame value string.
 * @returns A human-readable genre string, with multiple genres joined by `" / "`.
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
  /** The tag header (version, flags, size). */
  private _header: Id3v2Header;
  /** The optional extended header, present when the corresponding header flag is set. */
  private _extendedHeader: Id3v2ExtendedHeader | null = null;
  /** The optional footer (v2.4 only), present when the footer-present header flag is set. */
  private _footer: Id3v2Footer | null = null;
  /** Ordered list of all frames contained in this tag. */
  private _frames: Id3v2Frame[] = [];

  /** Creates a new, empty ID3v2 tag with a default version-4 header. */
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
   * Asynchronously read an ID3v2 tag from a stream at the given offset.
   * Returns a `Promise<Id3v2Tag>`.
   */
  static async readFrom(
    stream: IOStream,
    offset: offset_t,
    factory?: Id3v2FrameFactory,
  ): Promise<Id3v2Tag> {
    const tag = new Id3v2Tag();
    const frameFactory = factory ?? Id3v2FrameFactory.instance;

    // Read and parse the header
    await stream.seek(offset);
    const headerData = await stream.readBlock(Id3v2Header.size);
    const header = Id3v2Header.parse(headerData);
    if (!header) {
      return tag;
    }
    tag._header = header;

    const version = header.majorVersion;

    // Read all tag data (after the header, before any footer)
    const tagData = await stream.readBlock(header.tagSize);

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

  /** Gets the track title from the TIT2 frame. */
  get title(): string {
    return this._getTextFrameValue("TIT2");
  }

  /**
   * Sets the track title in the TIT2 frame.
   * @param value - The title string; pass an empty string to remove the frame.
   */
  set title(value: string) {
    this._setTextFrameValue("TIT2", value);
  }

  /** Gets the lead artist/performer from the TPE1 frame. */
  get artist(): string {
    return this._getTextFrameValue("TPE1");
  }

  /**
   * Sets the lead artist/performer in the TPE1 frame.
   * @param value - The artist string; pass an empty string to remove the frame.
   */
  set artist(value: string) {
    this._setTextFrameValue("TPE1", value);
  }

  /** Gets the album name from the TALB frame. */
  get album(): string {
    return this._getTextFrameValue("TALB");
  }

  /**
   * Sets the album name in the TALB frame.
   * @param value - The album string; pass an empty string to remove the frame.
   */
  set album(value: string) {
    this._setTextFrameValue("TALB", value);
  }

  /** Gets the comment text from the first available COMM frame. */
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

  /**
   * Sets the comment in a COMM frame, creating one if none exists.
   * @param value - The comment string; pass an empty string to remove all COMM frames.
   */
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

  /** Gets the genre, resolving any ID3v1 numeric references in the TCON frame. */
  get genre(): string {
    const raw = this._getTextFrameValue("TCON");
    return parseGenreString(raw);
  }

  /**
   * Sets the genre in the TCON frame.
   * @param value - The genre string; pass an empty string to remove the frame.
   */
  set genre(value: string) {
    this._setTextFrameValue("TCON", value);
  }

  /** Gets the recording year from the TDRC (or legacy TYER) frame as an integer. */
  get year(): number {
    const dateStr = this._getTextFrameValue("TDRC") || this._getTextFrameValue("TYER");
    if (!dateStr) return 0;
    const parsed = parseInt(dateStr.substring(0, 4), 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Sets the recording year in the TDRC frame.
   * @param value - The year as an integer; pass `0` to remove the frame.
   */
  set year(value: number) {
    if (value === 0) {
      this.removeFrames("TDRC");
      this.removeFrames("TYER");
      return;
    }
    this._setTextFrameValue("TDRC", String(value));
  }

  /** Gets the track number from the TRCK frame; supports "N/Total" format. */
  get track(): number {
    const trackStr = this._getTextFrameValue("TRCK");
    if (!trackStr) return 0;
    // May contain "3/12" format
    const slashIndex = trackStr.indexOf("/");
    const numStr = slashIndex >= 0 ? trackStr.substring(0, slashIndex) : trackStr;
    const parsed = parseInt(numStr, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Sets the track number in the TRCK frame.
   * @param value - The track number; pass `0` to remove the frame.
   */
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

  /** Gets the tag header. */
  get header(): Id3v2Header {
    return this._header;
  }

  /** Gets the optional extended header, or `null` if none is present. */
  get extendedHeader(): Id3v2ExtendedHeader | null {
    return this._extendedHeader;
  }

  /** Gets the optional footer (v2.4 only), or `null` if none is present. */
  get footer(): Id3v2Footer | null {
    return this._footer;
  }

  // ---------------------------------------------------------------------------
  // Frame access
  // ---------------------------------------------------------------------------

  /** Gets a shallow copy of the ordered list of all frames in this tag. */
  get frameList(): Id3v2Frame[] {
    return [...this._frames];
  }

  /**
   * Returns all frames matching the given frame ID.
   * @param frameId - A four-character frame ID string or `ByteVector`.
   * @returns An array of matching frames (may be empty).
   */
  frameListByFrameId(frameId: ByteVector | string): Id3v2Frame[] {
    const id = typeof frameId === "string"
      ? ByteVector.fromString(frameId, StringType.Latin1)
      : frameId;
    return this._frames.filter(
      f => f.header.frameId.equals(id),
    );
  }

  /**
   * Appends a frame to the end of the frame list.
   * @param frame - The frame to add.
   */
  addFrame(frame: Id3v2Frame): void {
    this._frames.push(frame);
  }

  /**
   * Removes a specific frame instance from the frame list.
   * @param frame - The frame to remove (matched by reference).
   */
  removeFrame(frame: Id3v2Frame): void {
    const idx = this._frames.indexOf(frame);
    if (idx >= 0) {
      this._frames.splice(idx, 1);
    }
  }

  /**
   * Removes all frames that match the given frame ID.
   * @param frameId - A four-character frame ID string or `ByteVector`.
   */
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

  /**
   * Render the complete ID3v2 tag (header + all frames + padding + optional footer) to a `ByteVector`.
   *
   * Padding strategy matches C++ TagLib:
   * - Minimum padding is always 1024 bytes.
   * - When an existing tag is being re-written and its frames still fit within
   *   the original allocated space, the original padding is preserved — but
   *   capped at `max(1024, fileSize / 100)` to avoid unbounded growth.
   *   Since we don't have file-size context here the cap is fixed at 1024.
   * - When the new frames exceed the original allocated space (or when there
   *   is no original tag), exactly 1024 bytes of padding are appended.
   *
   * @param version - The ID3v2 major version to render as; defaults to the tag's current version.
   * @param fileSize - Optional file size used for the 1% padding threshold (default: 0).
   * @returns The serialised tag bytes.
   */
  render(version?: number, fileSize: number = 0): ByteVector {
    const ver = version ?? this._header.majorVersion;
    const MIN_PADDING = 1024;
    const MAX_PADDING = 1024 * 1024;

    // Render all frames in alphabetical frame-ID order, matching C++ TagLib which
    // uses Map<ByteVector, FrameList> (std::map, lexicographic key order).
    const renderedFrames = new ByteVector();
    const sortedFrames = [...this._frames].sort((a, b) => {
      const idA = a.header.frameId.toString(StringType.Latin1);
      const idB = b.header.frameId.toString(StringType.Latin1);
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    });
    for (const frame of sortedFrames) {
      try {
        renderedFrames.append(frame.render(ver));
      } catch {
        // Skip frames that fail to render
      }
    }

    // Compute padding matching C++ TagLib id3v2tag.cpp:
    //   long paddingSize = originalSize - framesSize;
    //   if (paddingSize <= 0) paddingSize = MinPaddingSize;
    //   else { cap at max(1%, 1024) }
    const originalSize = this._header.tagSize; // 0 for new (never-read) tags
    let paddingSize = originalSize - renderedFrames.length;
    if (paddingSize <= 0) {
      paddingSize = MIN_PADDING;
    } else {
      const threshold = Math.min(
        Math.max(fileSize > 0 ? Math.trunc(fileSize / 100) : 0, MIN_PADDING),
        MAX_PADDING,
      );
      if (paddingSize > threshold) {
        paddingSize = MIN_PADDING;
      }
    }

    // Build header with size = frames + padding
    const header = new Id3v2Header();
    header.majorVersion = ver;
    header.tagSize = renderedFrames.length + paddingSize;

    const result = new ByteVector();
    result.append(header.render());
    result.append(renderedFrames);
    result.resize(result.length + paddingSize, 0);

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

  /**
   * Returns a `PropertyMap` built from all frames in the tag.
   * Text frames are mapped using {@link frameIdToProperty}; TXXX/COMM/USLT/WXXX/UFID
   * frames receive special handling.
   *
   * @returns The populated property map.
   */
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

  /**
   * Replaces the tag's frames with those derived from the given `PropertyMap`.
   * Unknown properties are written as TXXX frames.
   *
   * @param properties - The property map to apply.
   * @returns A `PropertyMap` containing properties that could not be stored.
   */
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

  /**
   * Returns the list of complex-property keys supported by this tag.
   * Currently only `"PICTURE"` is supported.
   *
   * @returns An array of complex-property key strings.
   */
  override complexPropertyKeys(): string[] {
    const keys: string[] = [];
    const hasPicture = this._frames.some(
      f => f.header.frameId.toString(StringType.Latin1) === "APIC",
    );
    if (hasPicture) keys.push("PICTURE");
    return keys;
  }

  /**
   * Returns the complex properties for the given key.
   * For `"PICTURE"`, returns one map per APIC frame with `data`, `mimeType`,
   * `description`, and `pictureType` entries.
   *
   * @param key - The complex-property key (case-insensitive).
   * @returns An array of variant maps representing the complex property values.
   */
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

  /**
   * Replaces complex properties for the given key.
   * For `"PICTURE"`, all existing APIC frames are removed and replaced with
   * frames built from the provided variant maps.
   *
   * @param key - The complex-property key (case-insensitive).
   * @param value - An array of variant maps, each describing one property value.
   * @returns `true` if the key was handled; `false` otherwise.
   */
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

  /**
   * Retrieves the text value of the first matching text-identification frame.
   *
   * @param frameId - The four-character frame ID string.
   * @returns The frame text, or an empty string if not found.
   */
  private _getTextFrameValue(frameId: string): string {
    const frames = this.frameListByFrameId(frameId);
    for (const f of frames) {
      if (f instanceof TextIdentificationFrame) {
        return f.text || "";
      }
    }
    return "";
  }

  /**
   * Sets the text value of the first matching text-identification frame, creating
   * a new frame if none exists, or removing all frames when `value` is empty.
   *
   * @param frameId - The four-character frame ID string.
   * @param value - The new text value; pass an empty string to remove the frame.
   */
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
