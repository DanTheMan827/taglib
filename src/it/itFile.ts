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
  private _tag: ModTag;
  private _properties: ItProperties | null = null;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    this._tag = new ModTag();
    if (this.isOpen) {
      this.read(readProperties, readStyle);
    }
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  static isSupported(stream: IOStream): boolean {
    stream.seek(0);
    const magic = stream.readBlock(4);
    if (magic.length < 4) return false;
    return magic.toString(StringType.Latin1) === "IMPM";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._tag;
  }

  audioProperties(): ItProperties | null {
    return this._properties;
  }

  save(): boolean {
    if (this.readOnly) return false;

    // Write title
    this.seek(4);
    this.writeBlock(padString(this._tag.title, 25));
    this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));

    // Skip 2 bytes (pattern highlight)
    this.seek(2, Position.Current);

    // Read length, instrumentCount, sampleCount
    const lengthData = this.readBlock(2);
    const instrumentCountData = this.readBlock(2);
    const sampleCountData = this.readBlock(2);
    if (lengthData.length < 2 || instrumentCountData.length < 2 || sampleCountData.length < 2) {
      return false;
    }
    const length = lengthData.toUShort(0, false);
    const instrumentCount = instrumentCountData.toUShort(0, false);
    const sampleCount = sampleCountData.toUShort(0, false);

    // Skip to end of fixed header + order list to reach instrument/sample offsets
    // Fixed header = 192 bytes, order list = length bytes
    this.seek(15, Position.Current);

    const lines = this._tag.comment.split("\n");

    // Write instrument names
    for (let i = 0; i < instrumentCount; i++) {
      this.seek(192 + length + (i << 2));
      const offsetData = this.readBlock(4);
      if (offsetData.length < 4) return false;
      const instrumentOffset = offsetData.toUInt(0, false);

      this.seek(instrumentOffset + 32);
      const name = i < lines.length ? lines[i] : "";
      this.writeBlock(padString(name, 25));
      this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));
    }

    // Write sample names
    for (let i = 0; i < sampleCount; i++) {
      this.seek(192 + length + (instrumentCount << 2) + (i << 2));
      const offsetData = this.readBlock(4);
      if (offsetData.length < 4) return false;
      const sampleOffset = offsetData.toUInt(0, false);

      this.seek(sampleOffset + 20);
      const lineIndex = i + instrumentCount;
      const name = lineIndex < lines.length ? lines[lineIndex] : "";
      this.writeBlock(padString(name, 25));
      this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));
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
    this.seek(46);
    const specialData = this.readBlock(2);
    if (specialData.length < 2) return false;
    let special = specialData.toUShort(0, false);

    const fileSize = this.fileLength;

    if (special & ItProperties.MessageAttached) {
      this.seek(54);
      const mlData = this.readBlock(2);
      const moData = this.readBlock(4);
      if (mlData.length < 2 || moData.length < 4) return false;
      const messageLength = mlData.toUShort(0, false);
      const messageOffset = moData.toUInt(0, false);

      if (messageLength === 0 || messageOffset + messageLength >= fileSize) {
        // Append new message
        const newOffset = messageLength === 0 ? fileSize : messageOffset;
        this.seek(54);
        this.writeBlock(writeU16L(messageBytes.length));
        this.writeBlock(writeU32L(newOffset));
        this.seek(newOffset);
        this.writeBlock(messageBytes);
        this.truncate(newOffset + messageBytes.length);
      } else {
        // Overwrite existing message, padded to original size
        const padded = padToLength(messageBytes, messageLength);
        this.seek(messageOffset);
        this.writeBlock(padded);
      }
    } else {
      // Set message attached flag and append
      this.seek(46);
      this.writeBlock(writeU16L(special | 0x01));
      this.seek(54);
      this.writeBlock(writeU16L(messageBytes.length));
      this.writeBlock(writeU32L(fileSize));
      this.seek(fileSize);
      this.writeBlock(messageBytes);
      this.truncate(fileSize + messageBytes.length);
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    this.seek(0);
    const magicData = this.readBlock(4);
    if (magicData.length < 4 || magicData.toString(StringType.Latin1) !== "IMPM") {
      this._valid = false; return;
    }

    // Title (26 bytes)
    const titleData = this.readBlock(26);
    if (titleData.length < 26) { this._valid = false; return; }
    this._tag.title = readString(titleData, 26);

    // Skip 2 bytes (pattern highlight)
    this.seek(2, Position.Current);

    // Read header fields
    const lengthData = this.readBlock(2);
    const instrumentCountData = this.readBlock(2);
    const sampleCountData = this.readBlock(2);
    if (lengthData.length < 2 || instrumentCountData.length < 2 || sampleCountData.length < 2) {
      this._valid = false; return;
    }
    const length = lengthData.toUShort(0, false);
    const instrumentCount = instrumentCountData.toUShort(0, false);
    const sampleCount = sampleCountData.toUShort(0, false);

    const patternCountData = this.readBlock(2);
    const versionData = this.readBlock(2);
    const compatibleVersionData = this.readBlock(2);
    const flagsData = this.readBlock(2);
    const specialData = this.readBlock(2);

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

    const globalVolumeData = this.readBlock(1);
    const mixVolumeData = this.readBlock(1);
    const bpmSpeedData = this.readBlock(1);
    const tempoData = this.readBlock(1);
    const panningSeparationData = this.readBlock(1);
    const pitchWheelDepthData = this.readBlock(1);

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
      const messageLengthData = this.readBlock(2);
      const messageOffsetData = this.readBlock(4);
      if (messageLengthData.length >= 2 && messageOffsetData.length >= 4) {
        const messageLength = messageLengthData.toUShort(0, false);
        const messageOffset = messageOffsetData.toUInt(0, false);
        this.seek(messageOffset);
        const messageBytes = this.readBlock(messageLength);
        if (messageBytes.length === messageLength) {
          let raw = messageBytes.toString(StringType.Latin1);
          const nul = raw.indexOf("\0");
          if (nul >= 0) raw = raw.substring(0, nul);
          message = raw.replace(/\r/g, "\n");
        }
      }
    }

    // Seek to panning/volume tables at offset 64
    this.seek(64);
    const pannings = this.readBlock(64);
    const volumes = this.readBlock(64);
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
      const b = this.readBlock(1);
      if (b.length < 1) { this._valid = false; return; }
      const order = b.get(0);
      if (order === 255) break;
      if (order !== 254) realLength++;
    }

    // Read instrument names
    const commentLines: string[] = [];

    for (let i = 0; i < instrumentCount; i++) {
      this.seek(192 + length + (i << 2));
      const offsetData = this.readBlock(4);
      if (offsetData.length < 4) { this._valid = false; return; }
      const instrumentOffset = offsetData.toUInt(0, false);

      this.seek(instrumentOffset);
      const instrMagic = this.readBlock(4);
      if (instrMagic.length < 4 || instrMagic.toString(StringType.Latin1) !== "IMPI") {
        this._valid = false; return;
      }

      // Skip DOS filename (13 bytes)
      this.seek(13, Position.Current);
      // Skip 15 bytes
      this.seek(15, Position.Current);

      const instrumentNameData = this.readBlock(26);
      if (instrumentNameData.length < 26) { this._valid = false; return; }
      commentLines.push(readString(instrumentNameData, 26));
    }

    // Read sample names
    for (let i = 0; i < sampleCount; i++) {
      this.seek(192 + length + (instrumentCount << 2) + (i << 2));
      const offsetData = this.readBlock(4);
      if (offsetData.length < 4) { this._valid = false; return; }
      const sampleOffset = offsetData.toUInt(0, false);

      this.seek(sampleOffset);
      const sampleMagic = this.readBlock(4);
      if (sampleMagic.length < 4 || sampleMagic.toString(StringType.Latin1) !== "IMPS") {
        this._valid = false; return;
      }

      // Skip DOS filename (13), globalVolume (1), sampleFlags (1), sampleVolume (1)
      this.seek(16, Position.Current);

      const sampleNameData = this.readBlock(26);
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

function padString(s: string, len: number): ByteVector {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = i < s.length ? s.charCodeAt(i) & 0xff : 0;
  }
  return ByteVector.fromByteArray(arr);
}

function writeU16L(value: number): ByteVector {
  const arr = new Uint8Array(2);
  arr[0] = value & 0xff;
  arr[1] = (value >>> 8) & 0xff;
  return ByteVector.fromByteArray(arr);
}

function writeU32L(value: number): ByteVector {
  const arr = new Uint8Array(4);
  arr[0] = value & 0xff;
  arr[1] = (value >>> 8) & 0xff;
  arr[2] = (value >>> 16) & 0xff;
  arr[3] = (value >>> 24) & 0xff;
  return ByteVector.fromByteArray(arr);
}

function padToLength(data: ByteVector, targetLen: number): ByteVector {
  if (data.length >= targetLen) return data.mid(0, targetLen);
  const arr = new Uint8Array(targetLen);
  arr.set(data.data.subarray(0, data.length));
  return ByteVector.fromByteArray(arr);
}
