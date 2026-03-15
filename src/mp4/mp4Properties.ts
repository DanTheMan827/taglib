import { AudioProperties } from "../audioProperties.js";
import { ByteVector, StringType } from "../byteVector.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ReadStyle } from "../toolkit/types.js";
import type { Mp4Atom, Mp4Atoms } from "./mp4Atoms.js";

// ---------------------------------------------------------------------------
// Codec enum
// ---------------------------------------------------------------------------

export enum Mp4Codec {
  Unknown = 0,
  AAC = 1,
  ALAC = 2,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sum total payload length (excluding atom headers) of all "mdat" atoms in the tree. */
function calculateMdatLength(atoms: Mp4Atom[]): number {
  let total = 0;
  for (const atom of atoms) {
    if (atom.length === 0) return 0;
    if (atom.name === "mdat") {
      const payload = atom.length - atom.headerSize;
      if (payload > 0) total += payload;
    }
    total += calculateMdatLength(atom.children);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Mp4Properties
// ---------------------------------------------------------------------------

export class Mp4Properties extends AudioProperties {
  private _lengthMs = 0;
  private _bitrate = 0;
  private _sampleRate = 0;
  private _channels = 0;
  private _bitsPerSample = 0;
  private _encrypted = false;
  private _codec: Mp4Codec = Mp4Codec.Unknown;

  constructor(
    stream: IOStream,
    atoms: Mp4Atoms,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(readStyle);
    this.read(stream, atoms);
  }

  // -- Public getters --

  get lengthInMilliseconds(): number {
    return this._lengthMs;
  }
  override get bitrate(): number {
    return this._bitrate;
  }
  override get sampleRate(): number {
    return this._sampleRate;
  }
  get channels(): number {
    return this._channels;
  }
  get bitsPerSample(): number {
    return this._bitsPerSample;
  }
  get isEncrypted(): boolean {
    return this._encrypted;
  }
  get codec(): Mp4Codec {
    return this._codec;
  }

  // -- Private parsing --

  private read(stream: IOStream, atoms: Mp4Atoms): void {
    const moov = atoms.find("moov");
    if (!moov) return;

    // Find the first audio track (handler type "soun")
    let trak: Mp4Atom | null = null;
    let data: ByteVector;

    const trakList = moov.findAll("trak");
    for (const track of trakList) {
      const hdlr = track.find("mdia", "hdlr");
      if (!hdlr) continue;
      trak = track;
      stream.seek(hdlr.offset);
      data = stream.readBlock(hdlr.length);
      if (data.containsAt(ByteVector.fromString("soun", StringType.Latin1), 16)) {
        break;
      }
      trak = null;
    }
    if (!trak) return;

    // Read duration from mdhd
    const mdhd = trak.find("mdia", "mdhd");
    if (!mdhd) return;

    stream.seek(mdhd.offset);
    data = stream.readBlock(mdhd.length);

    const version = data.get(8);
    let unit: number;
    let length: number;
    if (version === 1) {
      if (data.length < 36 + 8) return;
      unit = data.toUInt(28);
      length = Number(data.toLongLong(32));
    } else {
      if (data.length < 24 + 8) return;
      unit = data.toUInt(20);
      length = data.toUInt(24);
    }

    if (length === 0) {
      // Fallback: try movie header (mvhd)
      const mvhd = moov.find("mvhd");
      if (mvhd) {
        stream.seek(mvhd.offset);
        data = stream.readBlock(mvhd.length);
        if (data.length >= 24 + 4) {
          unit = data.toUInt(20);
          length = data.toUInt(24);
        }
      }
    }

    if (unit > 0 && length > 0) {
      this._lengthMs = Math.round((length * 1000) / unit);
    }

    // Read codec from stsd
    const stsd = trak.find("mdia", "minf", "stbl", "stsd");
    if (!stsd) return;

    stream.seek(stsd.offset);
    data = stream.readBlock(stsd.length);

    if (data.containsAt(ByteVector.fromString("mp4a", StringType.Latin1), 20)) {
      this._codec = Mp4Codec.AAC;
      this._channels = data.toShort(40);
      this._bitsPerSample = data.toShort(42);
      this._sampleRate = data.toUInt(46);

      // Parse esds for bitrate
      if (
        data.containsAt(ByteVector.fromString("esds", StringType.Latin1), 56) &&
        data.get(64) === 0x03
      ) {
        let pos = 65;
        if (
          data.length > pos + 3 &&
          data.get(pos) === 0x80 &&
          data.get(pos + 1) === 0x80 &&
          data.get(pos + 2) === 0x80
        ) {
          pos += 3;
        }
        pos += 4;
        if (data.length > pos && data.get(pos) === 0x04) {
          pos += 1;
          if (
            data.length > pos + 3 &&
            data.get(pos) === 0x80 &&
            data.get(pos + 1) === 0x80 &&
            data.get(pos + 2) === 0x80
          ) {
            pos += 3;
          }
          pos += 10;
          if (data.length >= pos + 4) {
            const bitrateValue = data.toUInt(pos);
            if (bitrateValue !== 0 || this._lengthMs <= 0) {
              this._bitrate = Math.round((bitrateValue + 500) / 1000);
            } else {
              this._bitrate = Math.round(
                (calculateMdatLength(atoms.atoms) * 8) / this._lengthMs,
              );
            }
          }
        }
      }
    } else if (data.containsAt(ByteVector.fromString("alac", StringType.Latin1), 20)) {
      if (
        stsd.length === 88 &&
        data.containsAt(ByteVector.fromString("alac", StringType.Latin1), 56)
      ) {
        this._codec = Mp4Codec.ALAC;
        this._bitsPerSample = data.get(69);
        this._channels = data.get(73);
        this._bitrate = Math.round(data.toUInt(80) / 1000);
        this._sampleRate = data.toUInt(84);

        if (this._bitrate === 0 && this._lengthMs > 0) {
          this._bitrate = Math.round(
            (calculateMdatLength(atoms.atoms) * 8) / this._lengthMs,
          );
        }
      }
    }

    // Check encryption
    if (stsd.find("drms")) {
      this._encrypted = true;
    }
  }
}
