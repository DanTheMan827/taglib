/** @file Extended Module (XM) tracker file format handler. Reads and writes title, tracker name, instrument names, and sample names. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ModTag } from "../mod/modTag.js";
import { XmProperties } from "./xmProperties.js";

/**
 * Reads a Latin-1 string from `data`, replacing `0xFF` bytes with spaces and
 * truncating at the first NUL character.
 * @param data - The source `ByteVector` to read from.
 * @param maxLen - Maximum number of bytes to consider.
 * @returns The decoded and sanitised string.
 */
function readString(data: ByteVector, maxLen: number): string {
  let raw = data.mid(0, maxLen).toString(StringType.Latin1);
  raw = raw.replace(/\xff/g, " ");
  const nul = raw.indexOf("\0");
  return nul >= 0 ? raw.substring(0, nul) : raw;
}

/**
 * Extended Module (XM) file format handler.
 *
 * The 17-byte magic "Extended Module: " appears at offset 0. The module title
 * occupies bytes 17–36, and the tracker name bytes 38–57. Instrument and
 * sample names are collected and stored as a newline-delimited tag comment.
 */
export class XmFile extends File {
  /** The tag holding the module title, comment (instrument/sample names), and tracker name. */
  private _tag: ModTag;
  /** Parsed audio properties, or `null` if not yet read or not requested. */
  private _properties: XmProperties | null = null;

  /**
   * Private constructor — use {@link XmFile.open} to create instances.
   * @param stream - The underlying I/O stream for this XM file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new ModTag();
  }

  /**
   * Opens and parses an XM file from the given stream.
   * @param stream - Readable (and optionally writable) I/O stream.
   * @param readProperties - When `true` (default), parse audio properties.
   * @param readStyle - Controls parsing accuracy vs. speed trade-off.
   * @returns A fully initialised `XmFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<XmFile> {
    const f = new XmFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid XM file.
   * Reads the 17-byte magic "Extended Module: " at offset 0.
   * @param stream - The I/O stream to test.
   * @returns `true` if the stream appears to be a valid XM file.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const header = await stream.readBlock(17);
    if (header.length < 17) return false;
    const magic = header.toString(StringType.Latin1);
    return magic === "Extended Module: ";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the tag for this XM file.
   * @returns The {@link ModTag} containing title, comment, and tracker name.
   */
  tag(): Tag {
    return this._tag;
  }

  /**
   * Returns the audio properties parsed from the XM header.
   * @returns The {@link XmProperties}, or `null` if `readProperties` was `false` on open.
   */
  audioProperties(): XmProperties | null {
    return this._properties;
  }

  /**
   * Writes pending tag changes (title, tracker name, instrument names, and
   * sample names) back to the file.
   * @returns `true` on success, `false` if the file is read-only.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // Write title
    await this.seek(17);
    await this.writeBlock(padString(this._tag.title, 20));

    // Write tracker name
    await this.seek(38);
    await this.writeBlock(padString(this._tag.trackerName, 20));

    // Read header size to navigate patterns and instruments
    await this.seek(60);
    const headerSizeData = await this.readBlock(4);
    if (headerSizeData.length < 4) return false;
    const headerSize = headerSizeData.toUInt(0, false); // little-endian

    await this.seek(70);
    const patternCountData = await this.readBlock(2);
    const instrumentCountData = await this.readBlock(2);
    if (patternCountData.length < 2 || instrumentCountData.length < 2) return false;
    const patternCount = patternCountData.toUShort(0, false);
    const instrumentCount = instrumentCountData.toUShort(0, false);

    let pos = 60 + headerSize;

    // Skip patterns
    for (let i = 0; i < patternCount; i++) {
      await this.seek(pos);
      const phlData = await this.readBlock(4);
      if (phlData.length < 4) return false;
      const patternHeaderLength = phlData.toUInt(0, false);
      if (patternHeaderLength < 4) return false;

      await this.seek(pos + 7);
      const dsData = await this.readBlock(2);
      if (dsData.length < 2) return false;
      const dataSize = dsData.toUShort(0, false);

      pos += patternHeaderLength + dataSize;
    }

    const lines = this._tag.comment.split("\n");
    let sampleNameIndex = instrumentCount;

    for (let i = 0; i < instrumentCount; i++) {
      await this.seek(pos);
      const ihsData = await this.readBlock(4);
      if (ihsData.length < 4) return false;
      const instrumentHeaderSize = ihsData.toUInt(0, false);
      if (instrumentHeaderSize < 4) return false;

      // Write instrument name
      await this.seek(pos + 4);
      const nameLen = Math.min(22, instrumentHeaderSize - 4);
      if (i < lines.length) {
        await this.writeBlock(padString(lines[i], nameLen));
      } else {
        await this.writeBlock(padString("", nameLen));
      }

      let sampleCount = 0;
      if (instrumentHeaderSize >= 29) {
        await this.seek(pos + 27);
        const scData = await this.readBlock(2);
        if (scData.length < 2) return false;
        sampleCount = scData.toUShort(0, false);
      }

      let sampleHeaderSize = 0;
      if (sampleCount > 0) {
        await this.seek(pos + 29);
        if (instrumentHeaderSize < 33) return false;
        const shsData = await this.readBlock(4);
        if (shsData.length < 4) return false;
        sampleHeaderSize = shsData.toUInt(0, false);
      }

      pos += instrumentHeaderSize;

      for (let j = 0; j < sampleCount; j++) {
        if (sampleHeaderSize > 4) {
          await this.seek(pos);
          const slData = await this.readBlock(4);
          if (slData.length < 4) return false;

          if (sampleHeaderSize > 18) {
            await this.seek(pos + 18);
            const sz = Math.min(sampleHeaderSize - 18, 22);
            if (sampleNameIndex < lines.length) {
              await this.writeBlock(padString(lines[sampleNameIndex++], sz));
            } else {
              await this.writeBlock(padString("", sz));
              sampleNameIndex++;
            }
          }
        }
        pos += sampleHeaderSize;
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads metadata and (optionally) audio properties from the XM stream.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    await this.seek(0);
    const magicData = await this.readBlock(17);
    if (magicData.length < 17) { this._valid = false; return; }

    const magic = magicData.toString(StringType.Latin1);
    // Stripped XM files may have all zeros
    const isStripped = magicData.toString(StringType.Latin1) === "\0".repeat(17);
    if (magic !== "Extended Module: " && !isStripped) {
      this._valid = false; return;
    }

    // Title (20 bytes)
    const titleData = await this.readBlock(20);
    if (titleData.length < 20) { this._valid = false; return; }
    this._tag.title = readString(titleData, 20);

    // Escape byte (0x1A normally, 0x00 for stripped)
    const escapeData = await this.readBlock(1);
    if (escapeData.length < 1) { this._valid = false; return; }
    const escape = escapeData.get(0);
    if (escape !== 0x1a && escape !== 0x00) { this._valid = false; return; }

    // Tracker name (20 bytes)
    const trackerNameData = await this.readBlock(20);
    if (trackerNameData.length < 20) { this._valid = false; return; }
    this._tag.trackerName = readString(trackerNameData, 20);

    // Version (2 bytes LE)
    const versionData = await this.readBlock(2);
    if (versionData.length < 2) { this._valid = false; return; }
    const version = versionData.toUShort(0, false);

    // Header size (4 bytes LE)
    const headerSizeData = await this.readBlock(4);
    if (headerSizeData.length < 4) { this._valid = false; return; }
    const headerSize = headerSizeData.toUInt(0, false);
    if (headerSize < 4) { this._valid = false; return; }

    // Read structured header fields (up to headerSize - 4 bytes)
    const remainingSize = headerSize - 4;
    const headerFieldsData = await this.readBlock(Math.min(remainingSize, 16));
    if (headerFieldsData.length < Math.min(remainingSize, 16)) {
      this._valid = false; return;
    }

    let lengthInPatterns = 0;
    let restartPosition = 0;
    let channels = 0;
    let patternCount = 0;
    let instrumentCount = 0;
    let flags = 0;
    let tempo = 0;
    let bpmSpeed = 0;

    let offset = 0;
    if (offset + 2 <= headerFieldsData.length) {
      lengthInPatterns = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      restartPosition = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      channels = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      patternCount = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      instrumentCount = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      flags = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      tempo = headerFieldsData.toUShort(offset, false); offset += 2;
    }
    if (offset + 2 <= headerFieldsData.length) {
      bpmSpeed = headerFieldsData.toUShort(offset, false);
    }

    // Seek past the full header
    await this.seek(60 + headerSize);

    // Read patterns
    for (let i = 0; i < patternCount; i++) {
      const phlData = await this.readBlock(4);
      if (phlData.length < 4) { this._valid = false; return; }
      const patternHeaderLength = phlData.toUInt(0, false);
      if (patternHeaderLength < 4) { this._valid = false; return; }

      // Read packing type (1), row count (2), data size (2) - max 5 bytes
      const toRead = Math.min(patternHeaderLength - 4, 5);
      const patData = await this.readBlock(toRead);
      if (patData.length < toRead) { this._valid = false; return; }

      let dataSize = 0;
      if (patData.length >= 5) {
        dataSize = patData.toUShort(3, false);
      }

      // Skip remaining header + data
      const skipAmount = (patternHeaderLength - 4 - patData.length) + dataSize;
      if (skipAmount > 0) {
        await this.seek(skipAmount, Position.Current);
      }
    }

    // Read instruments and samples
    const instrumentNames: string[] = [];
    const sampleNames: string[] = [];
    let sumSampleCount = 0;

    for (let i = 0; i < instrumentCount; i++) {
      const ihsData = await this.readBlock(4);
      if (ihsData.length < 4) { this._valid = false; return; }
      const instrumentHeaderSize = ihsData.toUInt(0, false);
      if (instrumentHeaderSize < 4) { this._valid = false; return; }

      // Read instrument name (22 bytes), instrument type (1), sample count (2)
      const toRead = Math.min(instrumentHeaderSize - 4, 25);
      const instrData = await this.readBlock(toRead);
      if (instrData.length < toRead) { this._valid = false; return; }

      const instrumentName = readString(instrData, Math.min(22, instrData.length));

      let sampleCount = 0;
      if (instrData.length >= 25) {
        sampleCount = instrData.toUShort(23, false);
      }

      const inCnt = 4 + instrData.length;
      let dataOffset = 0;

      if (sampleCount > 0) {
        sumSampleCount += sampleCount;
        // Read sample header size
        if (instrumentHeaderSize < inCnt + 4) { this._valid = false; return; }
        const shsData = await this.readBlock(4);
        if (shsData.length < 4) { this._valid = false; return; }
        const sampleHeaderSize = shsData.toUInt(0, false);

        // Skip rest of instrument header
        const remaining = instrumentHeaderSize - inCnt - 4;
        if (remaining > 0) {
          await this.seek(remaining, Position.Current);
        }

        for (let j = 0; j < sampleCount; j++) {
          const smpToRead = Math.min(sampleHeaderSize, 40);
          const smpData = await this.readBlock(smpToRead);
          if (smpData.length < smpToRead) { this._valid = false; return; }

          let sampleLength = 0;
          if (smpData.length >= 4) {
            sampleLength = smpData.toUInt(0, false);
          }

          let sampleName = "";
          if (smpData.length >= 40) {
            sampleName = readString(smpData.mid(18, 22), 22);
          }

          // Skip rest of sample header
          const smpRemaining = sampleHeaderSize - smpData.length;
          if (smpRemaining > 0) {
            await this.seek(smpRemaining, Position.Current);
          }

          dataOffset += sampleLength;
          sampleNames.push(sampleName);
        }
      } else {
        dataOffset = instrumentHeaderSize - inCnt;
      }

      instrumentNames.push(instrumentName);
      if (dataOffset > 0) {
        await this.seek(dataOffset, Position.Current);
      }
    }

    // Build comment
    let comment = instrumentNames.join("\n");
    if (sampleNames.length > 0) {
      comment += "\n" + sampleNames.join("\n");
    }
    this._tag.comment = comment;

    if (readProperties) {
      const props = new XmProperties(readStyle);
      props.channels = channels;
      props.lengthInPatterns = lengthInPatterns;
      props.version = version;
      props.restartPosition = restartPosition;
      props.patternCount = patternCount;
      props.instrumentCount = instrumentCount;
      props.sampleCount = sumSampleCount;
      props.flags = flags;
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
