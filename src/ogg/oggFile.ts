import { ByteVector } from "../byteVector.js";
import { File } from "../file.js";
import { IOStream } from "../toolkit/ioStream.js";
import { Position } from "../toolkit/types.js";
import { OggPageHeader } from "./oggPageHeader.js";

// OGG CRC32 lookup table (polynomial 0x04C11DB7, same as used in libogg)
const OGG_CRC_TABLE = new Uint32Array(256);
(() => {
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
    }
    OGG_CRC_TABLE[i] = r >>> 0;
  }
})();

function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xFF) ^ data[i]]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * Render OGG pages from a list of packets with a given serial number.
 *
 * Produces a complete OGG bitstream (BOS on first page, EOS on last page).
 * Each page is limited to 255 segments (max ~64KB payload, as per spec).
 */
function renderOggPages(
  packets: ByteVector[],
  serialNumber: number,
): ByteVector {
  // Collect all rendered page chunks, then concatenate once at the end
  // to avoid O(n²) from repeated ByteVector.append() calls.
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  let pageSequence = 0;
  // eslint-disable-next-line no-useless-assignment
  let granulePosition = 0n;

  for (let pktIdx = 0; pktIdx < packets.length; pktIdx++) {
    const pkt = packets[pktIdx];
    const pktData = pkt.data;
    const isFirstPacket = pktIdx === 0;
    const isLastPacket = pktIdx === packets.length - 1;

    // Split packet into segments (each max 255 bytes)
    const segments: number[] = [];
    let remaining = pktData.length;
    while (remaining >= 255) {
      segments.push(255);
      remaining -= 255;
    }
    segments.push(remaining); // final segment (0-254, terminates packet)

    // Split segments across pages if needed (max 255 segments per page)
    let segOffset = 0;
    let dataOffset = 0;

    while (segOffset < segments.length) {
      const pageSegCount = Math.min(255, segments.length - segOffset);
      const pageSegments = segments.slice(segOffset, segOffset + pageSegCount);
      const pageDataSize = pageSegments.reduce((a, b) => a + b, 0);

      const isContinuation = segOffset > 0;
      const isPageLastOfPacket = segOffset + pageSegCount >= segments.length;

      let headerType = 0;
      if (isContinuation) headerType |= 0x01;
      if (isFirstPacket && segOffset === 0) headerType |= 0x02; // BOS
      if (isLastPacket && isPageLastOfPacket) headerType |= 0x04; // EOS

      // For header packets (0, 1, 2), granule = 0
      // For audio packets, we don't track real granule, set to 0
      // This is acceptable for metadata-only operations
      granulePosition = (pktIdx <= 2) ? 0n : -1n;
      if (isLastPacket && isPageLastOfPacket) {
        // keep whatever granule we have
      }

      // Build page header (27 bytes + segment table)
      const headerSize = 27 + pageSegCount;
      const header = new Uint8Array(headerSize);
      // "OggS"
      header[0] = 0x4F; header[1] = 0x67; header[2] = 0x67; header[3] = 0x53;
      header[4] = 0; // version
      header[5] = headerType;
      // granule position (64-bit little-endian)
      const gp = BigInt.asUintN(64, granulePosition);
      for (let b = 0; b < 8; b++) {
        header[6 + b] = Number((gp >> BigInt(b * 8)) & 0xFFn);
      }
      // serial number (32-bit little-endian)
      header[14] = serialNumber & 0xFF;
      header[15] = (serialNumber >> 8) & 0xFF;
      header[16] = (serialNumber >> 16) & 0xFF;
      header[17] = (serialNumber >> 24) & 0xFF;
      // page sequence number (32-bit little-endian)
      header[18] = pageSequence & 0xFF;
      header[19] = (pageSequence >> 8) & 0xFF;
      header[20] = (pageSequence >> 16) & 0xFF;
      header[21] = (pageSequence >> 24) & 0xFF;
      // CRC placeholder (bytes 22-25) — filled after
      header[22] = 0; header[23] = 0; header[24] = 0; header[25] = 0;
      // segment count
      header[26] = pageSegCount;
      // segment table
      for (let s = 0; s < pageSegCount; s++) {
        header[27 + s] = pageSegments[s];
      }

      // Page data
      const pageData = pktData.slice(dataOffset, dataOffset + pageDataSize);

      // Compute CRC over header + data with CRC field zeroed
      const fullPage = new Uint8Array(headerSize + pageDataSize);
      fullPage.set(header, 0);
      fullPage.set(pageData, headerSize);
      const crc = oggCrc32(fullPage);
      fullPage[22] = crc & 0xFF;
      fullPage[23] = (crc >> 8) & 0xFF;
      fullPage[24] = (crc >> 16) & 0xFF;
      fullPage[25] = (crc >> 24) & 0xFF;

      chunks.push(fullPage);
      totalSize += fullPage.length;

      pageSequence++;
      segOffset += pageSegCount;
      dataOffset += pageDataSize;
    }
  }

  // Single-pass concatenation of all page chunks
  const output = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new ByteVector(output);
}

/**
 * Abstract base class for OGG-based file formats. Provides packet-level
 * access to the OGG bitstream by iterating pages and reassembling packets.
 */
export abstract class OggFile extends File {
  private _pages: OggPageHeader[] | null = null;
  private _pageOffsets: number[] = [];
  private _packets: Map<number, ByteVector> = new Map();
  private _dirtyPackets: Map<number, ByteVector> = new Map();
  private _serialNumber: number = 0;

  constructor(stream: IOStream) {
    super(stream);
  }

  // ---------------------------------------------------------------------------
  // Packet access
  // ---------------------------------------------------------------------------

  /**
   * Read all OGG pages and return the packet at the given 0-based index.
   * Packets that span multiple pages are concatenated.
   */
  packet(index: number): ByteVector {
    // Return dirty (pending write) packet if available
    const dirty = this._dirtyPackets.get(index);
    if (dirty) {
      return dirty;
    }

    // Return cached packet
    const cached = this._packets.get(index);
    if (cached) {
      return cached;
    }

    // Need to read pages
    this.readPages();

    const result = this._packets.get(index);
    return result ?? new ByteVector();
  }

  /**
   * Set packet data for writing.
   */
  setPacket(index: number, data: ByteVector): void {
    this._dirtyPackets.set(index, data);
  }

  // ---------------------------------------------------------------------------
  // Page access
  // ---------------------------------------------------------------------------

  firstPageHeader(): OggPageHeader | null {
    this.readPages();
    if (this._pages && this._pages.length > 0) {
      return this._pages[0];
    }
    return null;
  }

  lastPageHeader(): OggPageHeader | null {
    this.readPages();
    if (this._pages && this._pages.length > 0) {
      return this._pages[this._pages.length - 1];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  save(): boolean {
    if (this.readOnly) {
      return false;
    }

    // Ensure pages are read
    this.readPages();

    // Build final packet list (merging dirty packets)
    const packetCount = Math.max(
      this._packets.size,
      ...Array.from(this._dirtyPackets.keys()).map(k => k + 1),
    );

    const packets: ByteVector[] = [];
    for (let i = 0; i < packetCount; i++) {
      const dirty = this._dirtyPackets.get(i);
      if (dirty) {
        packets.push(dirty);
      } else {
        packets.push(this._packets.get(i) ?? new ByteVector());
      }
    }

    // Render all pages
    const rendered = renderOggPages(packets, this._serialNumber);

    // Replace entire file content
    this._stream.seek(0, Position.Beginning);
    this._stream.truncate(0);
    this._stream.writeBlock(rendered);

    // Clear caches
    this._dirtyPackets.clear();
    this._pages = null;
    this._packets.clear();
    this._pageOffsets = [];

    return true;
  }

  // ---------------------------------------------------------------------------
  // Internal page/packet reading
  // ---------------------------------------------------------------------------

  private readPages(): void {
    if (this._pages !== null) {
      return;
    }

    this._pages = [];
    this._pageOffsets = [];
    this._packets.clear();

    let offset = 0;
    const fileLen = this.fileLength;
    let packetIndex = 0;
    let currentPacket = new ByteVector();
    let continued = false;

    while (offset < fileLen) {
      const page = OggPageHeader.parse(this._stream, offset);
      if (!page || !page.isValid) {
        break;
      }

      this._pages.push(page);
      this._pageOffsets.push(offset);

      // Capture serial number from first page
      if (this._pages.length === 1) {
        this._serialNumber = page.serialNumber;
      }

      // Read page payload
      this._stream.seek(offset + page.headerSize, Position.Beginning);
      const payload = this._stream.readBlock(page.dataSize);

      // Reassemble packets from segment table
      let payloadOffset = 0;
      const sizes = page.packetSizes;
      const segTable = page.segmentTable;

      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        const chunk = payload.mid(payloadOffset, size);
        payloadOffset += size;

        if (i === 0 && page.isContinuation && continued) {
          // Continuation of previous packet from prior page
          currentPacket.append(chunk);
        } else {
          // New packet (or unexpected continuation — discard previous state)
          currentPacket = ByteVector.fromByteVector(chunk);
        }

        // Determine if this packet segment is complete.
        // It's complete if the segment didn't end on a 255 boundary,
        // i.e., it's not the last entry or the last segment byte is < 255.
        const isLastSizeEntry = i === sizes.length - 1;
        const lastSegByte =
          segTable.length > 0 ? segTable[segTable.length - 1] : 0;
        const packetContinuesOnNextPage =
          isLastSizeEntry && lastSegByte === 255;

        if (packetContinuesOnNextPage) {
          continued = true;
        } else {
          this._packets.set(packetIndex, currentPacket);
          packetIndex++;
          currentPacket = new ByteVector();
          continued = false;
        }
      }

      offset += page.totalSize;
    }

    // If there is leftover data from an incomplete packet, store it
    if (currentPacket.length > 0) {
      this._packets.set(packetIndex, currentPacket);
    }
  }
}
