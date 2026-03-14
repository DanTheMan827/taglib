import { ByteVector, StringType } from "../byteVector.js";
import type { offset_t } from "../toolkit/types.js";
import { Position } from "../toolkit/types.js";
import { IOStream } from "../toolkit/ioStream.js";

const CAPTURE_PATTERN = ByteVector.fromString("OggS", StringType.Latin1);

/**
 * Represents an OGG page header. Each OGG page begins with a 27-byte fixed
 * header followed by the segment table.
 */
export class OggPageHeader {
  private _valid: boolean = false;
  private _headerType: number = 0;
  private _granulePosition: bigint = 0n;
  private _serialNumber: number = 0;
  private _sequenceNumber: number = 0;
  private _checksum: number = 0;
  private _segmentTable: Uint8Array = new Uint8Array(0);
  private _dataSize: number = 0;
  private _packetSizes: number[] = [];

  get isValid(): boolean {
    return this._valid;
  }

  /** Page is a continuation of a previous packet. */
  get isContinuation(): boolean {
    return (this._headerType & 0x01) !== 0;
  }

  /** First page of the logical bitstream (BOS). */
  get isFirstPage(): boolean {
    return (this._headerType & 0x02) !== 0;
  }

  /** Last page of the logical bitstream (EOS). */
  get isLastPage(): boolean {
    return (this._headerType & 0x04) !== 0;
  }

  get granulePosition(): bigint {
    return this._granulePosition;
  }

  get serialNumber(): number {
    return this._serialNumber;
  }

  get sequenceNumber(): number {
    return this._sequenceNumber;
  }

  /** Size of the page header including the segment table. */
  get headerSize(): number {
    return 27 + this._segmentTable.length;
  }

  /** Total size of the page data (payload). */
  get dataSize(): number {
    return this._dataSize;
  }

  /** Total size of the entire page (header + payload). */
  get totalSize(): number {
    return this.headerSize + this._dataSize;
  }

  get segmentTable(): Uint8Array {
    return this._segmentTable;
  }

  /**
   * Derive packet sizes from the segment table.
   *
   * Each segment value is 0–255. A packet spans consecutive segments;
   * a segment value < 255 terminates the packet. If the last segment
   * value is exactly 255, the packet continues on the next page.
   */
  get packetSizes(): number[] {
    return this._packetSizes;
  }

  /**
   * Parse an OGG page header from the given stream at the specified offset.
   * Returns `null` if the data at offset is not a valid OGG page.
   */
  static parse(stream: IOStream, offset: offset_t): OggPageHeader | null {
    stream.seek(offset, Position.Beginning);
    const header = stream.readBlock(27);
    if (header.length < 27) {
      return null;
    }

    // Verify "OggS" capture pattern
    if (!header.startsWith(CAPTURE_PATTERN)) {
      return null;
    }

    // Version must be 0
    if (header.get(4) !== 0) {
      return null;
    }

    const page = new OggPageHeader();
    page._headerType = header.get(5);
    page._granulePosition = header.toLongLong(6, false);
    page._serialNumber = header.toUInt(14, false);
    page._sequenceNumber = header.toUInt(18, false);
    page._checksum = header.toUInt(22, false);

    const segmentCount = header.get(26);
    if (segmentCount > 0) {
      const segData = stream.readBlock(segmentCount);
      if (segData.length < segmentCount) {
        return null;
      }
      page._segmentTable = new Uint8Array(segData.data);
    }

    // Compute data size and packet sizes from the segment table
    let dataSize = 0;
    const packetSizes: number[] = [];
    let currentPacketSize = 0;

    for (let i = 0; i < page._segmentTable.length; i++) {
      const seg = page._segmentTable[i];
      dataSize += seg;
      currentPacketSize += seg;

      if (seg < 255) {
        // Packet is complete
        packetSizes.push(currentPacketSize);
        currentPacketSize = 0;
      }
    }

    // If the last segment was 255, the packet continues on the next page.
    // We still record its accumulated size so far.
    if (currentPacketSize > 0) {
      packetSizes.push(currentPacketSize);
    }

    page._dataSize = dataSize;
    page._packetSizes = packetSizes;
    page._valid = true;

    return page;
  }
}
