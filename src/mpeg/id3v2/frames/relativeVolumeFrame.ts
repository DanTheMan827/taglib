/** @file ID3v2 relative volume adjustment frame (RVA2). Stores per-channel volume adjustment and peak volume data. */
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

/** Peak volume data for a single channel. */
export interface PeakVolume {
  /** Number of bits used to represent the peak volume value. */
  bitsRepresentingPeak: number;
  /** Raw bytes encoding the peak volume value. */
  peakVolume: ByteVector;
}

/** Internal per-channel data stored in the RVA2 frame. */
interface ChannelData {
  /** Raw signed 16-bit volume adjustment in 1/512 dB units. */
  volumeAdjustment: number;
  /** Peak volume information for this channel. */
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
  /** Identification string that distinguishes this RVA2 frame from others in the same tag. */
  private _identification: string = "";
  /** Map from channel type to its volume and peak data. */
  private _channelMap: Map<ChannelType, ChannelData> = new Map();

  /** Creates a new, empty RVA2 frame. */
  constructor() {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("RVA2", StringType.Latin1),
    );
    super(header);
  }

  // -- Accessors --------------------------------------------------------------

  /**
   * Gets the identification string that distinguishes this frame from other RVA2 frames.
   * @returns The identification string.
   */
  get identification(): string {
    return this._identification;
  }

  /**
   * Sets the identification string.
   * @param value - The new identification string.
   */
  set identification(value: string) {
    this._identification = value;
  }

  /**
   * Returns an array of all channel types present in this frame.
   * @returns Array of {@link ChannelType} values stored in this frame.
   */
  get channels(): ChannelType[] {
    return Array.from(this._channelMap.keys());
  }

  /**
   * Get volume adjustment index (signed, 1/512 dB units).
   * @param channel - The channel to query. Defaults to {@link ChannelType.MasterVolume}.
   * @returns The raw signed 16-bit volume adjustment index.
   */
  volumeAdjustmentIndex(channel: ChannelType = ChannelType.MasterVolume): number {
    return this._getOrCreate(channel).volumeAdjustment;
  }

  /**
   * Sets the raw volume adjustment index (signed 16-bit, 1/512 dB units).
   * @param index - The signed integer index to set; clamped to [-32768, 32767].
   * @param channel - The channel to update. Defaults to {@link ChannelType.MasterVolume}.
   */
  setVolumeAdjustmentIndex(
    index: number,
    channel: ChannelType = ChannelType.MasterVolume,
  ): void {
    this._getOrCreate(channel).volumeAdjustment = Math.max(-32768, Math.min(32767, index | 0));
  }

  /**
   * Get volume adjustment as a floating point dB value.
   * @param channel - The channel to query. Defaults to {@link ChannelType.MasterVolume}.
   * @returns The volume adjustment in decibels.
   */
  volumeAdjustment(channel: ChannelType = ChannelType.MasterVolume): number {
    return this.volumeAdjustmentIndex(channel) / 512;
  }

  /**
   * Sets the volume adjustment as a floating-point dB value.
   * @param adjustment - The volume adjustment in decibels.
   * @param channel - The channel to update. Defaults to {@link ChannelType.MasterVolume}.
   */
  setVolumeAdjustment(
    adjustment: number,
    channel: ChannelType = ChannelType.MasterVolume,
  ): void {
    this.setVolumeAdjustmentIndex(Math.round(adjustment * 512), channel);
  }

  /**
   * Returns the peak volume data for the specified channel.
   * @param channel - The channel to query. Defaults to {@link ChannelType.MasterVolume}.
   * @returns The {@link PeakVolume} for the given channel.
   */
  peakVolume(channel: ChannelType = ChannelType.MasterVolume): PeakVolume {
    return this._getOrCreate(channel).peak;
  }

  /**
   * Sets the peak volume data for the specified channel.
   * @param peak - The peak volume data to store.
   * @param channel - The channel to update. Defaults to {@link ChannelType.MasterVolume}.
   */
  setPeakVolume(
    peak: PeakVolume,
    channel: ChannelType = ChannelType.MasterVolume,
  ): void {
    this._getOrCreate(channel).peak = peak;
  }

  /**
   * Returns the identification string.
   * @returns The identification string of this frame.
   */
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

  /**
   * Parses the frame payload into identification and per-channel data.
   * @param data - The raw field bytes of the frame.
   * @param _version - The ID3v2 version (unused).
   */
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

  /**
   * Serializes the frame data into bytes.
   * @param _version - The ID3v2 version (unused).
   * @returns A {@link ByteVector} containing the encoded frame fields.
   */
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

  /**
   * Gets or creates a ChannelData entry for the given channel type.
   * @param channel - The channel type to look up or create.
   * @returns The existing or newly created {@link ChannelData} for the channel.
   */
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
