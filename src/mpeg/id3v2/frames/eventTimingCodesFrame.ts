/** @file ID3v2 event timing codes frame (ETCO). Stores timestamped event markers within the audio stream. */
import { ByteVector, StringType } from "../../../byteVector.js";
import { Id3v2Frame, Id3v2FrameHeader } from "../id3v2Frame.js";

/** Synched event types for the ETCO frame. */
export enum EventType {
  Padding = 0x00,
  EndOfInitialSilence = 0x01,
  IntroStart = 0x02,
  MainPartStart = 0x03,
  OutroStart = 0x04,
  OutroEnd = 0x05,
  VerseStart = 0x06,
  RefrainStart = 0x07,
  InterludeStart = 0x08,
  ThemeStart = 0x09,
  VariationStart = 0x0a,
  KeyChange = 0x0b,
  TimeChange = 0x0c,
  MomentaryUnwantedNoise = 0x0d,
  SustainedNoise = 0x0e,
  SustainedNoiseEnd = 0x0f,
  IntroEnd = 0x10,
  MainPartEnd = 0x11,
  VerseEnd = 0x12,
  RefrainEnd = 0x13,
  ThemeEnd = 0x14,
  Profanity = 0x15,
  ProfanityEnd = 0x16,
  NotPredefinedSynch0 = 0xe0,
  NotPredefinedSynch1 = 0xe1,
  NotPredefinedSynch2 = 0xe2,
  NotPredefinedSynch3 = 0xe3,
  NotPredefinedSynch4 = 0xe4,
  NotPredefinedSynch5 = 0xe5,
  NotPredefinedSynch6 = 0xe6,
  NotPredefinedSynch7 = 0xe7,
  NotPredefinedSynch8 = 0xe8,
  NotPredefinedSynch9 = 0xe9,
  NotPredefinedSynchA = 0xea,
  NotPredefinedSynchB = 0xeb,
  NotPredefinedSynchC = 0xec,
  NotPredefinedSynchD = 0xed,
  NotPredefinedSynchE = 0xee,
  NotPredefinedSynchF = 0xef,
  AudioEnd = 0xfd,
  AudioFileEnds = 0xfe,
}

/** A single timed event entry in an ETCO frame. */
export interface SynchedEvent {
  /** Timestamp of the event, in units defined by the frame's timestamp format. */
  time: number;
  /** The type of event occurring at this timestamp. */
  type: EventType;
}

/**
 * Event timing codes frame (ETCO).
 *
 * Structure: timestampFormat(1) + repeated (eventType(1) + timestamp(4 big-endian)).
 */
export class EventTimingCodesFrame extends Id3v2Frame {
  /** Timestamp format byte: 1 = MPEG frames, 2 = milliseconds. */
  private _timestampFormat: number = 2; // default: milliseconds
  /** Ordered list of synched events stored in this frame. */
  private _synchedEvents: SynchedEvent[] = [];

  /** Creates a new, empty ETCO frame with the timestamp format defaulting to milliseconds. */
  constructor() {
    const header = new Id3v2FrameHeader(
      ByteVector.fromString("ETCO", StringType.Latin1),
    );
    super(header);
  }

  // -- Accessors --------------------------------------------------------------

  /** 1 = MPEG frames, 2 = milliseconds. */
  get timestampFormat(): number {
    return this._timestampFormat;
  }

  /** Sets the timestamp format. Use 1 for MPEG frames or 2 for milliseconds. */
  set timestampFormat(v: number) {
    this._timestampFormat = v;
  }

  /** Gets the ordered list of synched events stored in this frame. */
  get synchedEvents(): SynchedEvent[] {
    return this._synchedEvents;
  }

  /** Sets the list of timed events for this frame. */
  set synchedEvents(events: SynchedEvent[]) {
    this._synchedEvents = events;
  }

  /**
   * Returns a human-readable summary of the frame.
   * @returns A string reporting the number of events stored in this frame.
   */
  toString(): string {
    return `ETCO: ${this._synchedEvents.length} events`;
  }

  // -- Static -----------------------------------------------------------------

  /** @internal Create from raw frame data. */
  static fromData(
    data: ByteVector,
    header: Id3v2FrameHeader,
    version: number,
  ): EventTimingCodesFrame {
    const frame = new EventTimingCodesFrame();
    frame._header = header;
    frame.parseFields(Id3v2Frame.fieldData(data, header, version), version);
    return frame;
  }

  // -- Protected --------------------------------------------------------------

  /**
   * Parses the binary payload of the ETCO frame.
   * @param data - Raw field bytes beginning with the timestamp format byte.
   * @param _version - ID3v2 version (unused; parsing is version-independent).
   */
  protected parseFields(data: ByteVector, _version: number): void {
    if (data.length < 1) return;

    this._timestampFormat = data.get(0);
    this._synchedEvents = [];

    let offset = 1;
    while (offset + 5 <= data.length) {
      const type = data.get(offset) as EventType;
      const time = data.mid(offset + 1, 4).toUInt();
      this._synchedEvents.push({ type, time });
      offset += 5;
    }
  }

  /**
   * Serialises the frame fields into a binary payload.
   * @param _version - ID3v2 version (unused; rendering is version-independent).
   * @returns A `ByteVector` containing the timestamp format byte followed by each event's type and 4-byte big-endian timestamp.
   */
  protected renderFields(_version: number): ByteVector {
    const v = new ByteVector();
    v.append(this._timestampFormat);

    for (const event of this._synchedEvents) {
      v.append(event.type & 0xff);
      v.append(ByteVector.fromUInt(event.time));
    }

    return v;
  }
}
