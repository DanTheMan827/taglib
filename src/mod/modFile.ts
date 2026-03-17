/** @file ProTracker MOD file format handler. */
import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ModTag } from "./modTag.js";
import { ModProperties } from "./modProperties.js";

/**
 * Helper: read a Latin1 string from a ByteVector, trimming at the first NUL.
 */
function readString(data: ByteVector, maxLen: number): string {
  const raw = data.mid(0, maxLen).toString(StringType.Latin1);
  const nul = raw.indexOf("\0");
  return nul >= 0 ? raw.substring(0, nul) : raw;
}

/**
 * ProTracker MOD file format handler.
 *
 * Title is at offset 0 (20 bytes). A 4-byte tag at offset 1080 identifies
 * the MOD variant and determines the number of channels and instruments.
 * Instrument names (22 bytes each, starting at offset 20) form the comment.
 */
export class ModFile extends File {
  /** Parsed tag holding title and instrument names as a comment. */
  private _tag: ModTag;
  /** Parsed audio properties, or `null` if not yet read. */
  private _properties: ModProperties | null = null;
  /** Number of instruments in the file (15 for NoiseTracker, 31 otherwise). */
  private _instrumentCount: number = 31;

  /**
   * Private constructor — use {@link ModFile.open} instead.
   * @param stream - The underlying I/O stream.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new ModTag();
  }

  /**
   * Open and parse a ProTracker MOD file.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Detail level for audio property parsing.
   * @returns A fully initialized {@link ModFile} instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<ModFile> {
    const f = new ModFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Check whether a stream contains a known ProTracker MOD file.
   * @param stream - The stream to inspect.
   * @returns `true` if the 4-byte MOD ID at offset 1080 is a known identifier.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    if (await stream.length() < 1084) return false;
    await stream.seek(1080);
    const tag = await stream.readBlock(4);
    if (tag.length < 4) return false;
    const id = tag.toString(StringType.Latin1);
    return isKnownModId(id);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /** Returns the tag for this file. */
  tag(): Tag {
    return this._tag;
  }

  /** Returns the audio properties, or `null` if not parsed. */
  audioProperties(): ModProperties | null {
    return this._properties;
  }

  /**
   * Write the current tag data back to the file.
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // Write title
    await this.seek(0);
    await this.writeBlock(padString(this._tag.title, 20));

    // Write instrument names from comment
    const lines = this._tag.comment.split("\n");
    const instrumentCount = this._instrumentCount;

    for (let i = 0; i < instrumentCount; i++) {
      const name = i < lines.length ? lines[i] : "";
      await this.writeBlock(padString(name, 22));
      // Skip the 8 bytes of sample params
      await this.seek(8, Position.Current);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Parse the MOD file header, ID tag, and instrument names.
   * @param readProperties - Whether to populate audio properties.
   * @param readStyle - Detail level for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    if ((await this.fileLength()) < 1084) {
      this._valid = false;
      return;
    }

    // Read mod ID tag at offset 1080
    await this.seek(1080);
    const modIdData = await this.readBlock(4);
    if (modIdData.length < 4) {
      this._valid = false;
      return;
    }

    const modId = modIdData.toString(StringType.Latin1);

    // eslint-disable-next-line no-useless-assignment
    let _channels = 4;
    let instruments = 31;

    if (modId === "M.K." || modId === "M!K!" || modId === "M&K!" || modId === "N.T.") {
      this._tag.trackerName = "ProTracker";
      _channels = 4;
    } else if (modId.startsWith("FLT") || modId.startsWith("TDZ")) {
      this._tag.trackerName = "StarTrekker";
      const digit = modId.charCodeAt(3);
      if (digit < 0x30 || digit > 0x39) { this._valid = false; return; }
      _channels = digit - 0x30;
    } else if (modId.endsWith("CHN")) {
      this._tag.trackerName = "StarTrekker";
      const digit = modId.charCodeAt(0);
      if (digit < 0x30 || digit > 0x39) { this._valid = false; return; }
      _channels = digit - 0x30;
    } else if (modId === "CD81" || modId === "OKTA") {
      this._tag.trackerName = "Atari Oktalyzer";
      _channels = 8;
    } else if (modId.endsWith("CH") || modId.endsWith("CN")) {
      this._tag.trackerName = "TakeTracker";
      const d0 = modId.charCodeAt(0);
      const d1 = modId.charCodeAt(1);
      if (d0 < 0x30 || d0 > 0x39 || d1 < 0x30 || d1 > 0x39) {
        this._valid = false; return;
      }
      _channels = (d0 - 0x30) * 10 + (d1 - 0x30);
    } else {
      this._tag.trackerName = "NoiseTracker";
      _channels = 4;
      instruments = 15;
    }

    // Read title
    await this.seek(0);
    const titleData = await this.readBlock(20);
    this._tag.title = readString(titleData, 20);

    // Store instrument count so save() works regardless of readProperties
    this._instrumentCount = instruments;

    // Read instrument names
    let pos = 20;
    const commentLines: string[] = [];
    for (let i = 0; i < instruments; i++) {
      await this.seek(pos);
      const nameData = await this.readBlock(22);
      commentLines.push(readString(nameData, 22));
      // Each instrument record is 30 bytes: 22 name + 8 params
      pos += 30;
    }

    // Read length in patterns (1 byte after instrument data)
    await this.seek(pos);
    const lipData = await this.readBlock(1);
    const lengthInPatterns = lipData.length > 0 ? lipData.get(0) : 0;

    this._tag.comment = commentLines.join("\n");

    if (readProperties) {
      const props = new ModProperties(readStyle);
      props.channels = _channels;
      props.instrumentCount = instruments;
      props.lengthInPatterns = lengthInPatterns;
      this._properties = props;
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Determine whether a 4-byte MOD identifier is a known ProTracker variant.
 * @param id - The 4-character string read from offset 1080.
 * @returns `true` if the ID is recognised.
 */
function isKnownModId(id: string): boolean {
  if (id === "M.K." || id === "M!K!" || id === "M&K!" || id === "N.T.") return true;
  if (id === "CD81" || id === "OKTA") return true;
  if (id.startsWith("FLT") || id.startsWith("TDZ")) {
    const d = id.charCodeAt(3);
    return d >= 0x30 && d <= 0x39;
  }
  if (id.endsWith("CHN")) {
    const d = id.charCodeAt(0);
    return d >= 0x30 && d <= 0x39;
  }
  if (id.endsWith("CH") || id.endsWith("CN")) {
    const d0 = id.charCodeAt(0);
    const d1 = id.charCodeAt(1);
    return d0 >= 0x30 && d0 <= 0x39 && d1 >= 0x30 && d1 <= 0x39;
  }
  return false;
}

/**
 * Encode a string as Latin1 bytes, zero-padded or truncated to `len` bytes.
 * @param s - The string to encode.
 * @param len - The exact byte length of the returned vector.
 * @returns A `ByteVector` of exactly `len` bytes.
 */
function padString(s: string, len: number): ByteVector {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = i < s.length ? s.charCodeAt(i) & 0xff : 0;
  }
  return ByteVector.fromByteArray(arr);
}
