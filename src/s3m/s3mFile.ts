/** @file ScreamTracker III (S3M) file format handler. Reads the module title and instrument names; supports writing both back. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ModTag } from "../mod/modTag.js";
import { S3mProperties } from "./s3mProperties.js";

/**
 * Reads a NUL-terminated Latin-1 string from the start of `data`, up to `maxLen` bytes.
 * @param data - The source `ByteVector` to read from.
 * @param maxLen - Maximum number of bytes to consider.
 * @returns The decoded string, truncated at the first NUL character.
 */
function readString(data: ByteVector, maxLen: number): string {
  const raw = data.mid(0, maxLen).toString(StringType.Latin1);
  const nul = raw.indexOf("\0");
  return nul >= 0 ? raw.substring(0, nul) : raw;
}

/**
 * ScreamTracker III (S3M) file format handler.
 *
 * The module title occupies the first 28 bytes at offset 0. The four-byte
 * magic "SCRM" appears at offset 44. Sample/instrument names are read and
 * stored as a newline-delimited tag comment.
 */
export class S3mFile extends File {
  /** The tag holding the module title, comment (sample names), and tracker name. */
  private _tag: ModTag;
  /** Parsed audio properties, or `null` if not yet read or not requested. */
  private _properties: S3mProperties | null = null;

  /**
   * Private constructor — use {@link S3mFile.open} to create instances.
   * @param stream - The underlying I/O stream for this S3M file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new ModTag();
  }

  /**
   * Opens and parses an S3M file from the given stream.
   * @param stream - Readable (and optionally writable) I/O stream.
   * @param readProperties - When `true` (default), parse audio properties.
   * @param readStyle - Controls parsing accuracy vs. speed trade-off.
   * @returns A fully initialised `S3mFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<S3mFile> {
    const f = new S3mFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid S3M file.
   * Seeks to offset 44 and verifies the four-byte "SCRM" magic signature.
   * @param stream - The I/O stream to test.
   * @returns `true` if the stream appears to be a valid S3M file.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    if (await stream.length() < 48) return false;
    await stream.seek(44);
    const magic = await stream.readBlock(4);
    if (magic.length < 4) return false;
    return magic.toString(StringType.Latin1) === "SCRM";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the tag for this S3M file.
   * @returns The {@link ModTag} containing title and comment fields.
   */
  tag(): Tag {
    return this._tag;
  }

  /**
   * Returns the audio properties parsed from the S3M header.
   * @returns The {@link S3mProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): S3mProperties | null {
    return this._properties;
  }

  /**
   * Writes pending tag changes (title and sample/instrument names) back to the file.
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // Write title
    await this.seek(0);
    await this.writeBlock(padString(this._tag.title, 27));
    await this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0]))); // NUL terminator

    // Read layout info to write sample names
    await this.seek(32);
    const lengthData = await this.readBlock(2);
    const sampleCountData = await this.readBlock(2);
    if (lengthData.length < 2 || sampleCountData.length < 2) return false;
    const length = lengthData.toUShort(0, false);  // little-endian
    const sampleCount = sampleCountData.toUShort(0, false);

    // Skip to channel settings at offset 64, read them
    await this.seek(64);
    let channels = 0;
    for (let i = 0; i < 32; i++) {
      const b = await this.readBlock(1);
      if (b.length < 1) return false;
      if (b.get(0) !== 0xff) channels++;
    }

    await this.seek(channels, Position.Current);

    const lines = this._tag.comment.split("\n");

    for (let i = 0; i < sampleCount; i++) {
      await this.seek(96 + length + (i << 1));
      const offsetData = await this.readBlock(2);
      if (offsetData.length < 2) return false;
      const instrumentOffset = offsetData.toUShort(0, false);
      await this.seek((instrumentOffset << 4) + 48);

      const name = i < lines.length ? lines[i] : "";
      await this.writeBlock(padString(name, 27));
      await this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads metadata and (optionally) audio properties from the S3M stream.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    // Title at offset 0, 28 bytes
    await this.seek(0);
    const titleData = await this.readBlock(28);
    if (titleData.length < 28) { this._valid = false; return; }
    this._tag.title = readString(titleData, 28);

    // Byte 28: mark (0x1A), byte 29: type (0x10)
    const markData = await this.readBlock(1);
    const typeData = await this.readBlock(1);
    if (markData.length < 1 || typeData.length < 1) { this._valid = false; return; }
    const mark = markData.get(0);
    const type = typeData.get(0);
    if (mark !== 0x1a || type !== 0x10) { this._valid = false; return; }

    // Seek to offset 32
    await this.seek(32);
    const lengthData = await this.readBlock(2);
    const sampleCountData = await this.readBlock(2);
    if (lengthData.length < 2 || sampleCountData.length < 2) { this._valid = false; return; }
    const length = lengthData.toUShort(0, false);
    const sampleCount = sampleCountData.toUShort(0, false);

    const patternCountData = await this.readBlock(2);
    const flagsData = await this.readBlock(2);
    const trackerVersionData = await this.readBlock(2);
    const fileFormatVersionData = await this.readBlock(2);

    if (patternCountData.length < 2 || flagsData.length < 2 ||
        trackerVersionData.length < 2 || fileFormatVersionData.length < 2) {
      this._valid = false; return;
    }
    const patternCount = patternCountData.toUShort(0, false);
    const flags = flagsData.toUShort(0, false);
    const trackerVersion = trackerVersionData.toUShort(0, false);
    const fileFormatVersion = fileFormatVersionData.toUShort(0, false);

    // Verify "SCRM" magic
    const magic = await this.readBlock(4);
    if (magic.length < 4 || magic.toString(StringType.Latin1) !== "SCRM") {
      this._valid = false; return;
    }

    const globalVolumeData = await this.readBlock(1);
    const bpmSpeedData = await this.readBlock(1);
    const tempoData = await this.readBlock(1);
    const masterVolumeData = await this.readBlock(1);
    if (globalVolumeData.length < 1 || bpmSpeedData.length < 1 ||
        tempoData.length < 1 || masterVolumeData.length < 1) {
      this._valid = false; return;
    }

    const globalVolume = globalVolumeData.get(0);
    const bpmSpeed = bpmSpeedData.get(0);
    const tempo = tempoData.get(0);
    const masterVolumeByte = masterVolumeData.get(0);
    const masterVolume = masterVolumeByte & 0x7f;
    const stereo = (masterVolumeByte & 0x80) !== 0;

    // Skip 12 bytes
    await this.seek(12, Position.Current);

    // Channel settings
    let channels = 0;
    for (let i = 0; i < 32; i++) {
      const b = await this.readBlock(1);
      if (b.length < 1) { this._valid = false; return; }
      if (b.get(0) !== 0xff) channels++;
    }

    // Read order list and compute real length
    await this.seek(96);
    let realLength = 0;
    for (let i = 0; i < length; i++) {
      const b = await this.readBlock(1);
      if (b.length < 1) { this._valid = false; return; }
      const order = b.get(0);
      if (order === 255) break;
      if (order !== 254) realLength++;
    }

    // Read sample/instrument names
    const commentLines: string[] = [];
    for (let i = 0; i < sampleCount; i++) {
      await this.seek(96 + length + (i << 1));
      const sampleHeaderOffsetData = await this.readBlock(2);
      if (sampleHeaderOffsetData.length < 2) { this._valid = false; return; }
      const sampleHeaderOffset = sampleHeaderOffsetData.toUShort(0, false);

      await this.seek(sampleHeaderOffset << 4);

      // Skip sample type (1), DOS filename (13), sample data offset (2),
      // sample length (4), repeat start (4), repeat stop (4), volume (1)
      const skipData = await this.readBlock(1 + 13 + 2 + 4 + 4 + 4 + 1);
      if (skipData.length < 29) { this._valid = false; return; }

      // Skip 1 byte
      await this.seek(1, Position.Current);

      // Skip packing (1), sampleFlags (1), base frequency (4)
      await this.seek(6, Position.Current);

      // Skip 12 bytes
      await this.seek(12, Position.Current);

      // Read sample name (28 bytes)
      const sampleNameData = await this.readBlock(28);
      if (sampleNameData.length < 28) { this._valid = false; return; }
      commentLines.push(readString(sampleNameData, 28));
    }

    this._tag.comment = commentLines.join("\n");
    this._tag.trackerName = "ScreamTracker III";

    if (readProperties) {
      const props = new S3mProperties(readStyle);
      props.channels = channels;
      props.lengthInPatterns = realLength;
      props.stereo = stereo;
      props.sampleCount = sampleCount;
      props.patternCount = patternCount;
      props.flags = flags;
      props.trackerVersion = trackerVersion;
      props.fileFormatVersion = fileFormatVersion;
      props.globalVolume = globalVolume;
      props.masterVolume = masterVolume;
      props.tempo = tempo;
      props.bpmSpeed = bpmSpeed;
      this._properties = props;
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Encodes a string into a fixed-length Latin-1 `ByteVector`, padding with NUL bytes.
 * @param s - The source string to encode.
 * @param len - The exact byte length of the output vector.
 * @returns A `ByteVector` of exactly `len` bytes.
 */
function padString(s: string, len: number): ByteVector {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = i < s.length ? s.charCodeAt(i) & 0xff : 0;
  }
  return ByteVector.fromByteArray(arr);
}
