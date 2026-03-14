import { ByteVector, StringType } from '../../byteVector.js';
import { Id3v2Frame, Id3v2FrameHeader } from './id3v2Frame.js';
import { Id3v2Header } from './id3v2Header.js';
import { TextIdentificationFrame, UserTextIdentificationFrame } from './frames/textIdentificationFrame.js';
import { CommentsFrame } from './frames/commentsFrame.js';
import { AttachedPictureFrame } from './frames/attachedPictureFrame.js';
import { UniqueFileIdentifierFrame } from './frames/uniqueFileIdentifierFrame.js';
import { UrlLinkFrame, UserUrlLinkFrame } from './frames/urlLinkFrame.js';
import { PopularimeterFrame } from './frames/popularimeterFrame.js';
import { RelativeVolumeFrame } from './frames/relativeVolumeFrame.js';
import { GeneralEncapsulatedObjectFrame } from './frames/generalEncapsulatedObjectFrame.js';
import { PrivateFrame } from './frames/privateFrame.js';
import { UnsynchronizedLyricsFrame } from './frames/unsynchronizedLyricsFrame.js';
import { ChapterFrame } from './frames/chapterFrame.js';
import { TableOfContentsFrame } from './frames/tableOfContentsFrame.js';
import { EventTimingCodesFrame } from './frames/eventTimingCodesFrame.js';
import { SynchronizedLyricsFrame } from './frames/synchronizedLyricsFrame.js';
import { OwnershipFrame } from './frames/ownershipFrame.js';
import { PodcastFrame } from './frames/podcastFrame.js';
import { UnknownFrame } from './frames/unknownFrame.js';

// ID3v2.2 (3-char) → ID3v2.4 (4-char) frame ID conversion table
const frameConversion2to4 = new Map<string, string>([
  ['BUF', 'RBUF'],
  ['CNT', 'PCNT'],
  ['COM', 'COMM'],
  ['CRA', 'AENC'],
  ['ETC', 'ETCO'],
  ['GEO', 'GEOB'],
  ['IPL', 'TIPL'],
  ['MCI', 'MCDI'],
  ['MLL', 'MLLT'],
  ['POP', 'POPM'],
  ['REV', 'RVRB'],
  ['SLT', 'SYLT'],
  ['STC', 'SYTC'],
  ['TAL', 'TALB'],
  ['TBP', 'TBPM'],
  ['TCM', 'TCOM'],
  ['TCO', 'TCON'],
  ['TCP', 'TCMP'],
  ['TCR', 'TCOP'],
  ['TDY', 'TDLY'],
  ['TEN', 'TENC'],
  ['TFT', 'TFLT'],
  ['TKE', 'TKEY'],
  ['TLA', 'TLAN'],
  ['TLE', 'TLEN'],
  ['TMT', 'TMED'],
  ['TOA', 'TOAL'],
  ['TOF', 'TOFN'],
  ['TOL', 'TOLY'],
  ['TOR', 'TDOR'],
  ['TOT', 'TOAL'],
  ['TP1', 'TPE1'],
  ['TP2', 'TPE2'],
  ['TP3', 'TPE3'],
  ['TP4', 'TPE4'],
  ['TPA', 'TPOS'],
  ['TPB', 'TPUB'],
  ['TRC', 'TSRC'],
  ['TRD', 'TDRC'],
  ['TRK', 'TRCK'],
  ['TS2', 'TSO2'],
  ['TSA', 'TSOA'],
  ['TSC', 'TSOC'],
  ['TSP', 'TSOP'],
  ['TSS', 'TSSE'],
  ['TST', 'TSOT'],
  ['TT1', 'TIT1'],
  ['TT2', 'TIT2'],
  ['TT3', 'TIT3'],
  ['TXT', 'TOLY'],
  ['TXX', 'TXXX'],
  ['TYE', 'TDRC'],
  ['UFI', 'UFID'],
  ['ULT', 'USLT'],
  ['WAF', 'WOAF'],
  ['WAR', 'WOAR'],
  ['WAS', 'WOAS'],
  ['WCM', 'WCOM'],
  ['WCP', 'WCOP'],
  ['WPB', 'WPUB'],
  ['WXX', 'WXXX'],
  // Apple proprietary
  ['PCS', 'PCST'],
  ['TCT', 'TCAT'],
  ['TDR', 'TDRL'],
  ['TDS', 'TDES'],
  ['TID', 'TGID'],
  ['WFD', 'WFED'],
  ['MVN', 'MVNM'],
  ['MVI', 'MVIN'],
  ['GP1', 'GRP1'],
]);

// ID3v2.3 → ID3v2.4 conversion table
const frameConversion3to4 = new Map<string, string>([
  ['TORY', 'TDOR'],
  ['TYER', 'TDRC'],
  ['IPLS', 'TIPL'],
]);

/**
 * Factory that creates appropriate ID3v2 frame types from raw data.
 */
export class Id3v2FrameFactory {
  private static _instance: Id3v2FrameFactory | null = null;

  static get instance(): Id3v2FrameFactory {
    if (!Id3v2FrameFactory._instance) {
      Id3v2FrameFactory._instance = new Id3v2FrameFactory();
    }
    return Id3v2FrameFactory._instance;
  }

  /**
   * Convert a v2.2 (3-byte) frame ID to a v2.4 (4-byte) frame ID.
   */
  static convertFrameId(v2Id: ByteVector): ByteVector {
    const idStr = v2Id.toString(StringType.Latin1);
    const mapped = frameConversion2to4.get(idStr);
    if (mapped) {
      return ByteVector.fromString(mapped, StringType.Latin1);
    }
    return v2Id;
  }

  /**
   * Convert a v2.3 (4-byte) frame ID to a v2.4 (4-byte) frame ID.
   */
  static convertFrameIdV3(v3Id: ByteVector): ByteVector {
    const idStr = v3Id.toString(StringType.Latin1);
    const mapped = frameConversion3to4.get(idStr);
    if (mapped) {
      return ByteVector.fromString(mapped, StringType.Latin1);
    }
    return v3Id;
  }

  /**
   * Create a frame from data at the given offset.
   *
   * @param data - The tag body data (all frame data).
   * @param tagHeader - The ID3v2 tag header.
   * @param offset - Byte offset into `data` where the frame starts (default 0).
   * @returns An object with the parsed frame (or null if padding/invalid) and
   *   the total number of bytes consumed (frame header + frame data).
   */
  createFrame(
    data: ByteVector,
    tagHeader: Id3v2Header,
    offset: number = 0,
  ): { frame: Id3v2Frame | null; size: number } {
    const version = tagHeader.majorVersion;
    const headerSize = version < 3 ? 6 : 10;

    // Not enough data for a frame header
    if (offset + headerSize > data.length) {
      return { frame: null, size: 0 };
    }

    const headerData = data.mid(offset, headerSize);
    const frameHeader = new Id3v2FrameHeader(headerData, version);

    // Check for padding (frame ID is all zeros or invalid)
    const frameIdStr = frameHeader.frameId.toString(StringType.Latin1);
    if (frameIdStr === '\0\0\0\0' || frameIdStr === '\0\0\0' ||
        frameIdStr.trim() === '') {
      return { frame: null, size: 0 };
    }

    // For v2.2, convert frame ID to v2.4
    if (version < 3) {
      const converted = Id3v2FrameFactory.convertFrameId(frameHeader.frameId);
      frameHeader.frameId = converted;
    } else if (version === 3) {
      const converted = Id3v2FrameFactory.convertFrameIdV3(frameHeader.frameId);
      frameHeader.frameId = converted;
    }

    const totalFrameSize = headerSize + frameHeader.frameSize;

    // Not enough data for the frame body
    if (offset + totalFrameSize > data.length) {
      return { frame: null, size: 0 };
    }

    const frameData = data.mid(offset, totalFrameSize);
    const frameId = frameHeader.frameId.toString(StringType.Latin1);

    let frame: Id3v2Frame | null = null;

    try {
      frame = this._createFrameForId(frameId, frameData, frameHeader, version, tagHeader);
    } catch {
      frame = UnknownFrame.fromData(frameData, frameHeader, version);
    }

    return { frame, size: totalFrameSize };
  }

  private _createFrameForId(
    frameId: string,
    frameData: ByteVector,
    frameHeader: Id3v2FrameHeader,
    version: number,
    tagHeader: Id3v2Header,
  ): Id3v2Frame {
    // Apple/non-standard text frames that should be treated as text
    const appleTextFrames = ['WFED', 'MVNM', 'MVIN', 'GRP1'];

    // Text identification frames (T*** except TXXX), plus Apple text frames
    if ((frameId.startsWith('T') && frameId !== 'TXXX') ||
        appleTextFrames.includes(frameId)) {
      return TextIdentificationFrame.fromData(frameData, frameHeader, version);
    }

    // User text identification frame
    if (frameId === 'TXXX') {
      return UserTextIdentificationFrame.fromRawData(frameData, frameHeader, version);
    }

    // Comments frame
    if (frameId === 'COMM') {
      return CommentsFrame.fromData(frameData, frameHeader, version);
    }

    // Attached picture frame
    if (frameId === 'APIC') {
      return AttachedPictureFrame.fromData(frameData, frameHeader, version);
    }

    // Relative volume frame
    if (frameId === 'RVA2') {
      return RelativeVolumeFrame.fromData(frameData, frameHeader, version);
    }

    // Unique file identifier frame
    if (frameId === 'UFID') {
      return UniqueFileIdentifierFrame.fromData(frameData, frameHeader, version);
    }

    // General encapsulated object frame
    if (frameId === 'GEOB') {
      return GeneralEncapsulatedObjectFrame.fromData(frameData, frameHeader, version);
    }

    // URL link frames (W*** except WXXX)
    if (frameId.startsWith('W') && frameId !== 'WXXX') {
      return UrlLinkFrame.fromData(frameData, frameHeader, version);
    }

    // User URL link frame
    if (frameId === 'WXXX') {
      return UserUrlLinkFrame.fromRawData(frameData, frameHeader, version);
    }

    // Unsynchronized lyrics frame
    if (frameId === 'USLT') {
      return UnsynchronizedLyricsFrame.fromData(frameData, frameHeader, version);
    }

    // Synchronized lyrics frame
    if (frameId === 'SYLT') {
      return SynchronizedLyricsFrame.fromData(frameData, frameHeader, version);
    }

    // Event timing codes frame
    if (frameId === 'ETCO') {
      return EventTimingCodesFrame.fromData(frameData, frameHeader, version);
    }

    // Popularimeter frame
    if (frameId === 'POPM') {
      return PopularimeterFrame.fromData(frameData, frameHeader, version);
    }

    // Private frame
    if (frameId === 'PRIV') {
      return PrivateFrame.fromData(frameData, frameHeader, version);
    }

    // Ownership frame
    if (frameId === 'OWNE') {
      return OwnershipFrame.fromData(frameData, frameHeader, version);
    }

    // Chapter frame
    if (frameId === 'CHAP') {
      return ChapterFrame.fromData(frameData, frameHeader, version);
    }

    // Table of contents frame
    if (frameId === 'CTOC') {
      return TableOfContentsFrame.fromData(frameData, frameHeader, version);
    }

    // Podcast frame
    if (frameId === 'PCST') {
      return PodcastFrame.fromData(frameData, frameHeader, version);
    }

    // Unknown frame (fallback)
    return UnknownFrame.fromData(frameData, frameHeader, version);
  }
}
