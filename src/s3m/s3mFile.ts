import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ModTag } from "../mod/modTag.js";
import { S3mProperties } from "./s3mProperties.js";

/**
 * Helper: read a Latin1 string, trimming at the first NUL.
 */
function readString(data: ByteVector, maxLen: number): string {
  const raw = data.mid(0, maxLen).toString(StringType.Latin1);
  const nul = raw.indexOf("\0");
  return nul >= 0 ? raw.substring(0, nul) : raw;
}

/**
 * ScreamTracker III (S3M) file format handler.
 *
 * Title at offset 0 (28 bytes). Magic "SCRM" at offset 44.
 * Sample names form the comment.
 */
export class S3mFile extends File {
  private _tag: ModTag;
  private _properties: S3mProperties | null = null;

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
    if (stream.length() < 48) return false;
    stream.seek(44);
    const magic = stream.readBlock(4);
    if (magic.length < 4) return false;
    return magic.toString(StringType.Latin1) === "SCRM";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._tag;
  }

  audioProperties(): S3mProperties | null {
    return this._properties;
  }

  save(): boolean {
    if (this.readOnly) return false;

    // Write title
    this.seek(0);
    this.writeBlock(padString(this._tag.title, 27));
    this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0]))); // NUL terminator

    // Read layout info to write sample names
    this.seek(32);
    const lengthData = this.readBlock(2);
    const sampleCountData = this.readBlock(2);
    if (lengthData.length < 2 || sampleCountData.length < 2) return false;
    const length = lengthData.toUShort(0, false);  // little-endian
    const sampleCount = sampleCountData.toUShort(0, false);

    // Skip to channel settings at offset 64, read them
    this.seek(64);
    let channels = 0;
    for (let i = 0; i < 32; i++) {
      const b = this.readBlock(1);
      if (b.length < 1) return false;
      if (b.get(0) !== 0xff) channels++;
    }

    this.seek(channels, Position.Current);

    const lines = this._tag.comment.split("\n");

    for (let i = 0; i < sampleCount; i++) {
      this.seek(96 + length + (i << 1));
      const offsetData = this.readBlock(2);
      if (offsetData.length < 2) return false;
      const instrumentOffset = offsetData.toUShort(0, false);
      this.seek((instrumentOffset << 4) + 48);

      const name = i < lines.length ? lines[i] : "";
      this.writeBlock(padString(name, 27));
      this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0])));
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(readProperties: boolean, readStyle: ReadStyle): void {
    // Title at offset 0, 28 bytes
    this.seek(0);
    const titleData = this.readBlock(28);
    if (titleData.length < 28) { this._valid = false; return; }
    this._tag.title = readString(titleData, 28);

    // Byte 28: mark (0x1A), byte 29: type (0x10)
    const markData = this.readBlock(1);
    const typeData = this.readBlock(1);
    if (markData.length < 1 || typeData.length < 1) { this._valid = false; return; }
    const mark = markData.get(0);
    const type = typeData.get(0);
    if (mark !== 0x1a || type !== 0x10) { this._valid = false; return; }

    // Seek to offset 32
    this.seek(32);
    const lengthData = this.readBlock(2);
    const sampleCountData = this.readBlock(2);
    if (lengthData.length < 2 || sampleCountData.length < 2) { this._valid = false; return; }
    const length = lengthData.toUShort(0, false);
    const sampleCount = sampleCountData.toUShort(0, false);

    const patternCountData = this.readBlock(2);
    const flagsData = this.readBlock(2);
    const trackerVersionData = this.readBlock(2);
    const fileFormatVersionData = this.readBlock(2);

    if (patternCountData.length < 2 || flagsData.length < 2 ||
        trackerVersionData.length < 2 || fileFormatVersionData.length < 2) {
      this._valid = false; return;
    }
    const patternCount = patternCountData.toUShort(0, false);
    const flags = flagsData.toUShort(0, false);
    const trackerVersion = trackerVersionData.toUShort(0, false);
    const fileFormatVersion = fileFormatVersionData.toUShort(0, false);

    // Verify "SCRM" magic
    const magic = this.readBlock(4);
    if (magic.length < 4 || magic.toString(StringType.Latin1) !== "SCRM") {
      this._valid = false; return;
    }

    const globalVolumeData = this.readBlock(1);
    const bpmSpeedData = this.readBlock(1);
    const tempoData = this.readBlock(1);
    const masterVolumeData = this.readBlock(1);
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
    this.seek(12, Position.Current);

    // Channel settings
    let channels = 0;
    for (let i = 0; i < 32; i++) {
      const b = this.readBlock(1);
      if (b.length < 1) { this._valid = false; return; }
      if (b.get(0) !== 0xff) channels++;
    }

    // Read order list and compute real length
    this.seek(96);
    let realLength = 0;
    for (let i = 0; i < length; i++) {
      const b = this.readBlock(1);
      if (b.length < 1) { this._valid = false; return; }
      const order = b.get(0);
      if (order === 255) break;
      if (order !== 254) realLength++;
    }

    // Read sample/instrument names
    const commentLines: string[] = [];
    for (let i = 0; i < sampleCount; i++) {
      this.seek(96 + length + (i << 1));
      const sampleHeaderOffsetData = this.readBlock(2);
      if (sampleHeaderOffsetData.length < 2) { this._valid = false; return; }
      const sampleHeaderOffset = sampleHeaderOffsetData.toUShort(0, false);

      this.seek(sampleHeaderOffset << 4);

      // Skip sample type (1), DOS filename (13), sample data offset (2),
      // sample length (4), repeat start (4), repeat stop (4), volume (1)
      const skipData = this.readBlock(1 + 13 + 2 + 4 + 4 + 4 + 1);
      if (skipData.length < 29) { this._valid = false; return; }

      // Skip 1 byte
      this.seek(1, Position.Current);

      // Skip packing (1), sampleFlags (1), base frequency (4)
      this.seek(6, Position.Current);

      // Skip 12 bytes
      this.seek(12, Position.Current);

      // Read sample name (28 bytes)
      const sampleNameData = this.readBlock(28);
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

function padString(s: string, len: number): ByteVector {
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = i < s.length ? s.charCodeAt(i) & 0xff : 0;
  }
  return ByteVector.fromByteArray(arr);
}
