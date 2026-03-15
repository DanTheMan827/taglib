import { ByteVector, StringType } from "../../../byteVector.js";
import { Id3v2Frame, Id3v2FrameHeader } from "../id3v2Frame.js";

/** Channel types for the RVA2 frame. */
export enum ChannelType {
  Other = 0x00,
  MasterVolume = 0x01,
  FrontRight = 0x02,
  FrontLeft = 0x03,
  BackRight = 0x04,
  BackLeft = 0x05,
  FrontCentre = 0x06,
  BackCentre = 0x07,
  Subwoofer = 0x08,
}

export interface PeakVolume {
  bitsRepresentingPeak: number;
  peakVolume: ByteVector;
}

interface ChannelData {
  volumeAdjustment: number; // raw signed 16-bit fixed point (1/512 dB)
  peak: PeakVolume;
}

/**
 * Relative volume adjustment frame (RVA2).
 *
 * Structure: identification(null-terminated Latin1) + per-channel data blocks.
 * Each channel block: channelType(1) + volumeAdjustment(2, signed big-endian)
 *                     + bitsRepresentingPeak(1) + peakVolume(variable).
 */
export class RelativeVolumeFrame extends Id3v2Frame {
  private _identification: string = "";
  private _channelMap: Map<ChannelType, ChannelData> = new Map();

  constructor() {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("RVA2", StringType.Latin1),
    );
    super(header);
  }

  // -- Accessors --------------------------------------------------------------

  get identification(): string {
    return this._identification;
  }

  set identification(value: string) {
    this._identification = value;
  }

  get channels(): ChannelType[] {
    return Array.from(this._channelMap.keys());
  }

  /** Get volume adjustment index (signed, 1/512 dB units). */
  volumeAdjustmentIndex(channel: ChannelType = ChannelType.MasterVolume): number {
    return this._getOrCreate(channel).volumeAdjustment;
  }

  setVolumeAdjustmentIndex(
    index: number,
    channel: ChannelType = ChannelType.MasterVolume,
  ): void {
    this._getOrCreate(channel).volumeAdjustment = Math.max(-32768, Math.min(32767, index | 0));
  }

  /** Get volume adjustment as a floating point dB value. */
  volumeAdjustment(channel: ChannelType = ChannelType.MasterVolume): number {
    return this.volumeAdjustmentIndex(channel) / 512;
  }

  setVolumeAdjustment(
    adjustment: number,
    channel: ChannelType = ChannelType.MasterVolume,
  ): void {
    this.setVolumeAdjustmentIndex(Math.round(adjustment * 512), channel);
  }

  peakVolume(channel: ChannelType = ChannelType.MasterVolume): PeakVolume {
    return this._getOrCreate(channel).peak;
  }

  setPeakVolume(
    peak: PeakVolume,
    channel: ChannelType = ChannelType.MasterVolume,
  ): void {
    this._getOrCreate(channel).peak = peak;
  }

  toString(): string {
    return this._identification;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): RelativeVolumeFrame {
    const frame = new RelativeVolumeFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  protected parseFields(data: ByteVector, _version: number): void {
    // Identification is null-terminated Latin1
    let nullIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (data.get(i) === 0) {
        nullIdx = i;
        break;
      }
    }

    if (nullIdx < 0) {
      this._identification = data.toString(StringType.Latin1);
      return;
    }

    this._identification = data.mid(0, nullIdx).toString(StringType.Latin1);
    let offset = nullIdx + 1;

    // Parse channel blocks
    while (offset + 4 <= data.length) {
      const channelType = data.get(offset) as ChannelType;
      offset += 1;

      // Volume adjustment: signed 16-bit big-endian
      const adj = data.mid(offset, 2).toShort();
      offset += 2;

      // Peak volume
      const bitsRepresentingPeak = data.get(offset);
      offset += 1;

      const peakBytes = Math.ceil(bitsRepresentingPeak / 8);
      let peakData: ByteVector;
      if (peakBytes > 0 && offset + peakBytes <= data.length) {
        peakData = data.mid(offset, peakBytes);
        offset += peakBytes;
      } else {
        peakData = new ByteVector();
      }

      this._channelMap.set(channelType, {
        volumeAdjustment: adj,
        peak: { bitsRepresentingPeak, peakVolume: peakData },
      });
    }
  }

  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(ByteVector.fromString(this._identification, StringType.Latin1));
    v.append(0); // null terminator

    for (const [channelType, cd] of this._channelMap) {
      v.append(channelType);
      v.append(ByteVector.fromShort(cd.volumeAdjustment));
      v.append(cd.peak.bitsRepresentingPeak);
      v.append(cd.peak.peakVolume);
    }

    return v;
  }

  // -- Private ----------------------------------------------------------------

  private _getOrCreate(channel: ChannelType): ChannelData {
    let cd = this._channelMap.get(channel);
    if (!cd) {
      cd = {
        volumeAdjustment: 0,
        peak: { bitsRepresentingPeak: 0, peakVolume: new ByteVector() },
      };
      this._channelMap.set(channel, cd);
    }
    return cd;
  }
}
