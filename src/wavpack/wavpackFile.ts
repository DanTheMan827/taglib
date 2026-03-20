/** @file WavPack file format handler. Supports APE (primary) and ID3v1 (secondary) tags. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { CombinedTag } from "../combinedTag.js";
import { type offset_t, Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ID3v1Tag } from "../mpeg/id3v1/id3v1Tag.js";
import { ApeTag, ApeFooter } from "../ape/apeTag.js";
import { WavPackProperties } from "./wavpackProperties.js";

// =============================================================================
// Enums
// =============================================================================

/** Bitmask of tag types present in or to be applied to a WavPack file. */
export enum WavPackTagTypes {
  /** No tags. */
  NoTags = 0x0000,
  /** ID3v1 tag appended at the end of the file. */
  ID3v1 = 0x0001,
  /** APE tag written immediately before the ID3v1 tag (or at EOF). */
  APE = 0x0004,
  /** All supported tag types. */
  AllTags = 0xffff,
}

// =============================================================================
// WavPackFile
// =============================================================================

/**
 * WavPack file format handler.
 *
 * Supports APE (primary) and ID3v1 (secondary) tags.
 */
export class WavPackFile extends File {
  /** The APE tag read from or to be written to the file, or `null` if absent. */
  private _apeTag: ApeTag | null = null;
  /** The ID3v1 tag read from or to be written to the file, or `null` if absent. */
  private _id3v1Tag: ID3v1Tag | null = null;
  /** Priority-ordered combined view of all tags (APE preferred over ID3v1). */
  private _combinedTag: CombinedTag;
  /** Parsed audio properties, or `null` if not yet read. */
  private _properties: WavPackProperties | null = null;

  /** Byte offset of the APE tag in the file, or `-1` if absent. */
  private _apeLocation: offset_t = -1;
  /** Original byte size of the APE tag on disk (used for in-place replacement). */
  private _apeOriginalSize: number = 0;

  /** Byte offset of the ID3v1 tag in the file, or `-1` if absent. */
  private _id3v1Location: offset_t = -1;

  /**
   * Private constructor — use {@link WavPackFile.open} to create instances.
   * @param stream - The underlying I/O stream for the WavPack file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._combinedTag = new CombinedTag([]);
  }

  /**
   * Open and parse a WavPack file from the given stream.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties. Defaults to `true`.
   * @param readStyle - Level of detail for audio property parsing. Defaults to `ReadStyle.Average`.
   * @returns A fully initialised `WavPackFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<WavPackFile> {
    const f = new WavPackFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid WavPack file.
   * A WavPack file begins with the `"wvpk"` magic bytes.
   * @param stream - The I/O stream to inspect.
   * @returns `true` if the stream starts with the WavPack magic.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const headerData = await stream.readBlock(4);
    if (headerData.length < 4) return false;

    const wvpk = ByteVector.fromString("wvpk", StringType.Latin1);
    return headerData.startsWith(wvpk);
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the combined tag providing unified access to all tag data.
   * @returns The {@link CombinedTag} for this file (APE preferred over ID3v1).
   */
  tag(): Tag {
    return this._combinedTag;
  }

  /**
   * Returns the audio properties parsed from the WavPack block headers.
   * @returns The {@link WavPackProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): WavPackProperties | null {
    return this._properties;
  }

  /**
   * Writes all pending tag changes to the file.
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // -- ID3v1 --
    const id3v1 = this.id3v1Tag();
    if (id3v1 && !id3v1.isEmpty) {
      if (this._id3v1Location >= 0) {
        await this.seek(this._id3v1Location);
      } else {
        await this.seek(0, Position.End);
        this._id3v1Location = (await this.tell());
      }
      await this.writeBlock(id3v1.render());
    } else if (this._id3v1Location >= 0) {
      await this.truncate(this._id3v1Location);
      this._id3v1Location = -1;
    }

    // -- APE --
    const ape = this.apeTag();
    if (ape && !ape.isEmpty) {
      if (this._apeLocation < 0) {
        this._apeLocation =
          this._id3v1Location >= 0 ? this._id3v1Location : (await this.fileLength());
      }
      const data = ape.render();
      await this.insert(data, this._apeLocation, this._apeOriginalSize);

      if (this._id3v1Location >= 0) {
        this._id3v1Location += data.length - this._apeOriginalSize;
      }
      this._apeOriginalSize = data.length;
    } else if (this._apeLocation >= 0) {
      await this.removeBlock(this._apeLocation, this._apeOriginalSize);
      if (this._id3v1Location >= 0) {
        this._id3v1Location -= this._apeOriginalSize;
      }
      this._apeLocation = -1;
      this._apeOriginalSize = 0;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Tag accessors (lazy-create)
  // ---------------------------------------------------------------------------

  /**
   * Get the ID3v1 tag, optionally creating one if absent.
   * @param create - When `true`, a new empty tag is created if none exists.
   * @returns The {@link ID3v1Tag}, or `null` if absent and `create` is `false`.
   */
  id3v1Tag(create?: boolean): ID3v1Tag | null {
    if (!this._id3v1Tag && create) {
      this._id3v1Tag = new ID3v1Tag();
      this.refreshCombinedTag();
    }
    return this._id3v1Tag;
  }

  /**
   * Get the APE tag, optionally creating one if absent.
   * @param create - When `true`, a new empty tag is created if none exists.
   * @returns The {@link ApeTag}, or `null` if absent and `create` is `false`.
   */
  apeTag(create?: boolean): ApeTag | null {
    if (!this._apeTag && create) {
      this._apeTag = new ApeTag();
      this.refreshCombinedTag();
    }
    return this._apeTag;
  }

  // ---------------------------------------------------------------------------
  // Tag management
  // ---------------------------------------------------------------------------

  /**
   * Remove the specified tag types from the in-memory representation.
   * Call `save()` afterwards to persist the changes to disk.
   * @param tags - Bitmask of tag types to remove. Defaults to {@link WavPackTagTypes.AllTags}.
   */
  strip(tags: WavPackTagTypes = WavPackTagTypes.AllTags): void {
    if (tags & WavPackTagTypes.ID3v1) {
      this._id3v1Tag = null;
    }

    if (tags & WavPackTagTypes.APE) {
      this._apeTag = null;
    }

    // Ensure at least an APE tag exists when ID3v1 is removed
    if (!this._id3v1Tag) {
      this.apeTag(true);
    }

    this.refreshCombinedTag();
  }

  /** Whether the file on disk has an ID3v1 tag. */
  get hasID3v1Tag(): boolean {
    return this._id3v1Location >= 0;
  }

  /** Whether the file on disk has an APE tag. */
  get hasAPETag(): boolean {
    return this._apeLocation >= 0;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads all tags and (optionally) audio properties from the file.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // 1. Find ID3v1
    await this.findID3v1();

    // 2. Find APE
    await this.findAPE();

    // If no ID3v1 tag exists, ensure we have an APE tag
    if (this._id3v1Location < 0) {
      this.apeTag(true);
    }

    // Build combined tag (priority: APE > ID3v1)
    this.refreshCombinedTag();

    // 3. Audio properties
    if (readProperties) {
      let streamLength: offset_t;

      if (this._apeLocation >= 0) {
        streamLength = this._apeLocation;
      } else if (this._id3v1Location >= 0) {
        streamLength = this._id3v1Location;
      } else {
        streamLength = (await this.fileLength());
      }

      await this.seek(0);
      this._properties = await WavPackProperties.create(this, streamLength, readStyle);
    }
  }

  /**
   * Searches the end of the file for an ID3v1 tag and, if found,
   * populates {@link _id3v1Location} and {@link _id3v1Tag}.
   */
  private async findID3v1(): Promise<void> {
    if ((await this.fileLength()) < 128) return;

    const tagOffset = (await this.fileLength()) - 128;
    await this.seek(tagOffset);
    const data = await this.readBlock(3);
    if (data.length < 3) return;
    if (!data.startsWith(ID3v1Tag.fileIdentifier())) return;

    this._id3v1Location = tagOffset;
    this._id3v1Tag = await ID3v1Tag.readFrom(this._stream, tagOffset);
  }

  /**
   * Searches for an APE tag footer immediately before the ID3v1 tag (or end of file)
   * and, if found, populates {@link _apeLocation}, {@link _apeOriginalSize}, and {@link _apeTag}.
   */
  private async findAPE(): Promise<void> {
    const searchEnd: offset_t =
      this._id3v1Location >= 0 ? this._id3v1Location : (await this.fileLength());

    if (searchEnd < ApeFooter.SIZE) return;

    const footerOffset = searchEnd - ApeFooter.SIZE;
    await this.seek(footerOffset);
    const footerData = await this.readBlock(ApeFooter.SIZE);
    if (footerData.length < ApeFooter.SIZE) return;

    const magic = ByteVector.fromString("APETAGEX", StringType.Latin1);
    if (!footerData.startsWith(magic)) return;

    const footer = ApeFooter.parse(footerData);
    if (!footer) return;

    this._apeLocation = footerOffset + ApeFooter.SIZE - footer.completeTagSize;
    this._apeOriginalSize = footer.completeTagSize;
    this._apeTag = await ApeTag.readFrom(this._stream, footerOffset);
  }

  /**
   * Rebuilds {@link _combinedTag} from the currently active tag objects,
   * ordered by priority (APE before ID3v1).
   */
  private refreshCombinedTag(): void {
    // Priority: APE > ID3v1
    this._combinedTag.setTags([this._apeTag, this._id3v1Tag]);
  }
}
