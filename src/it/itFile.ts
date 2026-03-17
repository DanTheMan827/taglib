/** @file Impulse Tracker (IT) file format handler. */
import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ModTag } from "../mod/modTag.js";
import { ItProperties } from "./itProperties.js";

/**
 * Helper: read a Latin1 string, trimming at the first NUL.
 */
function readString(data: ByteVector, maxLen: number): string {
  const raw = data.mid(0, maxLen).toString(StringType.Latin1);
  const nul = raw.indexOf("\0");
  return nul >= 0 ? raw.substring(0, nul) : raw;
}

/**
 * Impulse Tracker (IT) file format handler.
 *
 * Magic "IMPM" at offset 0. Title at offset 4 (26 bytes).
 * Instrument and sample names form the comment, plus an optional message.
 */
export class ItFile extends File {
  /** Parsed tag holding title, comment, and tracker name. */
  private _tag: ModTag;
  /** Parsed audio properties, or null if not yet read. */
  private _properties: ItProperties | null = null;

  /**
   * Private constructor — use {@link ItFile.open} instead.
   * @param stream - The underlying I/O stream.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new ModTag();
  }

  /**
   * Open and parse an Impulse Tracker file.
   * @param stream - The I/O stream to read from.
   * @param readProperties - Whether to parse audio properties.
   * @param readStyle - Detail level for audio property parsing.
   * @returns A fully initialized {@link ItFile} instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<ItFile> {
    const f = new ItFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Check whether a stream contains an Impulse Tracker file.
   * @param stream - The stream to inspect.
   * @returns `true` if the stream begins with the "IMPM" magic bytes.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const magic = await stream.readBlock(4);
    if (magic.length < 4) return false;
    return magic.toString(StringType.Latin1) === "IMPM";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /** Returns the tag for this file. */
  tag(): Tag {
    return this._tag;
  }

  /** Returns the audio properties, or `null` if not parsed. */
  audioProperties(): ItProperties | null {
    return this._properties;
  }

  /**
   * Write the current tag data back to the file.
   * @returns `true` on success, `false` if the file is read-only or data is invalid.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    // Write title
    await this.seek(4);
    await this.writeBlock(padString(this._tag.title, 25));
    await this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));

    // Skip 2 bytes (pattern highlight)
    await this.seek(2, Position.Current);

    // Read length, instrumentCount, sampleCount
    const lengthData = await this.readBlock(2);
    const instrumentCountData = await this.readBlock(2);
    const sampleCountData = await this.readBlock(2);
    if (lengthData.length < 2 || instrumentCountData.length < 2 || sampleCountData.length < 2) {
      return false;
    }
    const length = lengthData.toUShort(0, false);
    const instrumentCount = instrumentCountData.toUShort(0, false);
    const sampleCount = sampleCountData.toUShort(0, false);

    // Skip to end of fixed header + order list to reach instrument/sample offsets
    // Fixed header = 192 bytes, order list = length bytes
    await this.seek(15, Position.Current);

    const lines = this._tag.comment.split("\n");

    // Write instrument names
    for (let i = 0; i < instrumentCount; i++) {
      await this.seek(192 + length + (i << 2));
      const offsetData = await this.readBlock(4);
      if (offsetData.length < 4) return false;
      const instrumentOffset = offsetData.toUInt(0, false);

      await this.seek(instrumentOffset + 32);
      const name = i < lines.length ? lines[i] : "";
      await this.writeBlock(padString(name, 25));
      await this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));
    }

    // Write sample names
    for (let i = 0; i < sampleCount; i++) {
      await this.seek(192 + length + (instrumentCount << 2) + (i << 2));
      const offsetData = await this.readBlock(4);
      if (offsetData.length < 4) return false;
      const sampleOffset = offsetData.toUInt(0, false);

      await this.seek(sampleOffset + 20);
      const lineIndex = i + instrumentCount;
      const name = lineIndex < lines.length ? lines[lineIndex] : "";
      await this.writeBlock(padString(name, 25));
      await this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));
    }

    // Write message (remaining lines after instruments + samples)
    const messageLines: string[] = [];
    for (let i = instrumentCount + sampleCount; i < lines.length; i++) {
      messageLines.push(lines[i]);
    }

    let message = messageLines.join("\r");
    if (message.length > 7999) {
      message = message.substring(0, 7999);
    }
    const messageBytes = ByteVector.fromString(message + "\0", StringType.Latin1);

    // Read special flags at offset 46
    await this.seek(46);
    const specialData = await this.readBlock(2);
    if (specialData.length < 2) return false;
    const special = specialData.toUShort(0, false);

    const fileSize = (await this.fileLength());

    if (special & ItProperties.MessageAttached) {
      await this.seek(54);
      const mlData = await this.readBlock(2);
      const moData = await this.readBlock(4);
      if (mlData.length < 2 || moData.length < 4) return false;
      const messageLength = mlData.toUShort(0, false);
      const messageOffset = moData.toUInt(0, false);

      if (messageLength === 0 || messageOffset + messageLength >= fileSize) {
        // Append new message
        const newOffset = messageLength === 0 ? fileSize : messageOffset;
        await this.seek(54);
        await this.writeBlock(writeU16L(messageBytes.length));
        await this.writeBlock(writeU32L(newOffset));
        await this.seek(newOffset);
        await this.writeBlock(messageBytes);
        await this.truncate(newOffset + messageBytes.length);
      } else {
        // Overwrite existing message, padded to original size
        const padded = padToLength(messageBytes, messageLength);
        await this.seek(messageOffset);
        await this.writeBlock(padded);
      }
    } else {
      // Set message attached flag and append
      await this.seek(46);
      await this.writeBlock(writeU16L(special | 0x01));
      await this.seek(54);
      await this.writeBlock(writeU16L(messageBytes.length));
      await this.writeBlock(writeU32L(fileSize));
      await this.seek(fileSize);
      await this.writeBlock(messageBytes);
      await this.truncate(fileSize + messageBytes.length);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Parse the IT file header, instrument/sample names, and optional message.
   * @param readProperties - Whether to populate audio properties.
   * @param readStyle - Detail level for audio property parsing.
   */
  private async read(readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    await this.seek(0);
    const magicData = await this.readBlock(4);
    if (magicData.length < 4 || magicData.toString(StringType.Latin1) !== "IMPM") {
      this._valid = false; return;
    }

    // Title (26 bytes)
    const titleData = await this.readBlock(26);
    if (titleData.length < 26) { this._valid = false; return; }
    this._tag.title = readString(titleData, 26);

    // Skip 2 bytes (pattern highlight)
    await this.seek(2, Position.Current);

    // Read header fields
    const lengthData = await this.readBlock(2);
    const instrumentCountData = await this.readBlock(2);
    const sampleCountData = await this.readBlock(2);
    if (lengthData.length < 2 || instrumentCountData.length < 2 || sampleCountData.length < 2) {
      this._valid = false; return;
    }
    const length = lengthData.toUShort(0, false);
    const instrumentCount = instrumentCountData.toUShort(0, false);
    const sampleCount = sampleCountData.toUShort(0, false);

    const patternCountData = await this.readBlock(2);
    const versionData = await this.readBlock(2);
    const compatibleVersionData = await this.readBlock(2);
    const flagsData = await this.readBlock(2);
    const specialData = await this.readBlock(2);

    if (patternCountData.length < 2 || versionData.length < 2 ||
        compatibleVersionData.length < 2 || flagsData.length < 2 ||
        specialData.length < 2) {
      this._valid = false; return;
    }

    const patternCount = patternCountData.toUShort(0, false);
    const version = versionData.toUShort(0, false);
    const compatibleVersion = compatibleVersionData.toUShort(0, false);
    const flags = flagsData.toUShort(0, false);
    const special = specialData.toUShort(0, false);

    const globalVolumeData = await this.readBlock(1);
    const mixVolumeData = await this.readBlock(1);
    const bpmSpeedData = await this.readBlock(1);
    const tempoData = await this.readBlock(1);
    const panningSeparationData = await this.readBlock(1);
    const pitchWheelDepthData = await this.readBlock(1);

    if (globalVolumeData.length < 1 || mixVolumeData.length < 1 ||
        bpmSpeedData.length < 1 || tempoData.length < 1 ||
        panningSeparationData.length < 1 || pitchWheelDepthData.length < 1) {
      this._valid = false; return;
    }

    const globalVolume = globalVolumeData.get(0);
    const mixVolume = mixVolumeData.get(0);
    const bpmSpeed = bpmSpeedData.get(0);
    const tempo = tempoData.get(0);
    const panningSeparation = panningSeparationData.get(0);
    const pitchWheelDepth = pitchWheelDepthData.get(0);

    // Read message if attached
    let message = "";
    if (special & ItProperties.MessageAttached) {
      const messageLengthData = await this.readBlock(2);
      const messageOffsetData = await this.readBlock(4);
      if (messageLengthData.length >= 2 && messageOffsetData.length >= 4) {
        const messageLength = messageLengthData.toUShort(0, false);
        const messageOffset = messageOffsetData.toUInt(0, false);
        await this.seek(messageOffset);
        const messageBytes = await this.readBlock(messageLength);
        if (messageBytes.length === messageLength) {
          let raw = messageBytes.toString(StringType.Latin1);
          const nul = raw.indexOf("\0");
          if (nul >= 0) raw = raw.substring(0, nul);
          message = raw.replace(/\r/g, "\n");
        }
      }
    }

    // Seek to panning/volume tables at offset 64
    await this.seek(64);
    const pannings = await this.readBlock(64);
    const volumes = await this.readBlock(64);
    if (pannings.length < 64 || volumes.length < 64) { this._valid = false; return; }

    let channels = 0;
    for (let i = 0; i < 64; i++) {
      if (pannings.get(i) < 128 && volumes.get(i) > 0) {
        channels++;
      }
    }

    // Read order list and compute real length
    let realLength = 0;
    for (let i = 0; i < length; i++) {
      const b = await this.readBlock(1);
      if (b.length < 1) { this._valid = false; return; }
      const order = b.get(0);
      if (order === 255) break;
      if (order !== 254) realLength++;
    }

    // Read instrument names
    const commentLines: string[] = [];

    for (let i = 0; i < instrumentCount; i++) {
      await this.seek(192 + length + (i << 2));
      const offsetData = await this.readBlock(4);
      if (offsetData.length < 4) { this._valid = false; return; }
      const instrumentOffset = offsetData.toUInt(0, false);

      await this.seek(instrumentOffset);
      const instrMagic = await this.readBlock(4);
      if (instrMagic.length < 4 || instrMagic.toString(StringType.Latin1) !== "IMPI") {
        this._valid = false; return;
      }

      // Skip DOS filename (13 bytes)
      await this.seek(13, Position.Current);
      // Skip 15 bytes
      await this.seek(15, Position.Current);

      const instrumentNameData = await this.readBlock(26);
      if (instrumentNameData.length < 26) { this._valid = false; return; }
      commentLines.push(readString(instrumentNameData, 26));
    }

    // Read sample names
    for (let i = 0; i < sampleCount; i++) {
      await this.seek(192 + length + (instrumentCount << 2) + (i << 2));
      const offsetData = await this.readBlock(4);
      if (offsetData.length < 4) { this._valid = false; return; }
      const sampleOffset = offsetData.toUInt(0, false);

      await this.seek(sampleOffset);
      const sampleMagic = await this.readBlock(4);
      if (sampleMagic.length < 4 || sampleMagic.toString(StringType.Latin1) !== "IMPS") {
        this._valid = false; return;
      }

      // Skip DOS filename (13), globalVolume (1), sampleFlags (1), sampleVolume (1)
      await this.seek(16, Position.Current);

      const sampleNameData = await this.readBlock(26);
      if (sampleNameData.length < 26) { this._valid = false; return; }
      commentLines.push(readString(sampleNameData, 26));
    }

    if (message !== "") {
      commentLines.push(message);
    }

    this._tag.comment = commentLines.join("\n");
    this._tag.trackerName = "Impulse Tracker";

    if (readProperties) {
      const props = new ItProperties(readStyle);
      props.channels = channels;
      props.lengthInPatterns = realLength;
      props.instrumentCount = instrumentCount;
      props.sampleCount = sampleCount;
      props.patternCount = patternCount;
      props.version = version;
      props.compatibleVersion = compatibleVersion;
      props.flags = flags;
      props.special = special;
      props.globalVolume = globalVolume;
      props.mixVolume = mixVolume;
      props.bpmSpeed = bpmSpeed;
      props.tempo = tempo;
      props.panningSeparation = panningSeparation;
      props.pitchWheelDepth = pitchWheelDepth;
      this._properties = props;
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

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

/**
 * Encode a 16-bit unsigned integer in little-endian byte order.
 * @param value - The value to encode.
 * @returns A 2-byte `ByteVector`.
 */
function writeU16L(value: number): ByteVector {
  const arr = new Uint8Array(2);
  arr[0] = value & 0xff;
  arr[1] = (value >>> 8) & 0xff;
  return ByteVector.fromByteArray(arr);
}

/**
 * Encode a 32-bit unsigned integer in little-endian byte order.
 * @param value - The value to encode.
 * @returns A 4-byte `ByteVector`.
 */
function writeU32L(value: number): ByteVector {
  const arr = new Uint8Array(4);
  arr[0] = value & 0xff;
  arr[1] = (value >>> 8) & 0xff;
  arr[2] = (value >>> 16) & 0xff;
  arr[3] = (value >>> 24) & 0xff;
  return ByteVector.fromByteArray(arr);
}

/**
 * Pad or truncate `data` to exactly `targetLen` bytes.
 * If shorter, the remaining bytes are zero-filled.
 * @param data - The source data.
 * @param targetLen - The desired byte length.
 * @returns A `ByteVector` of exactly `targetLen` bytes.
 */
function padToLength(data: ByteVector, targetLen: number): ByteVector {
  if (data.length >= targetLen) return data.mid(0, targetLen);
  const arr = new Uint8Array(targetLen);
  arr.set(data.data.subarray(0, data.length));
  return ByteVector.fromByteArray(arr);
}
