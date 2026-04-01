/** @file Abstract base class for OGG container file formats. Handles page-level I/O and logical packet reassembly. */

import { ByteVector } from "../byteVector.js";
import { File } from "../file.js";
import { IOStream } from "../toolkit/ioStream.js";
import { Position } from "../toolkit/types.js";
import { OggPageHeader } from "./oggPageHeader.js";

/** OGG CRC-32 lookup table pre-computed with polynomial 0x04C11DB7 (same as libogg). */
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

/**
 * Compute the OGG CRC-32 checksum over a raw byte array.
 * @param data - The input bytes.
 * @returns The 32-bit CRC checksum.
 */
function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) & 0xFF) ^ data[i]]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * Render OGG pages from a list of header packets.
 *
 * Produces pages with granule position = 0 (correct for header packets).
 * BOS flag is set on the first page. EOS is NOT set (audio pages follow).
 * Returns the rendered bytes and the number of pages generated.
 *
 * Matches C++ TagLib `Ogg::Page::paginate` with `SplitSize = 32 * 255 = 8160`
 * bytes per page.  Intermediate pages carry exactly 32 lacing values of 255;
 * no terminating lacing byte is written until the final page of each packet.
 */
function renderHeaderPages(
  packets: ByteVector[],
  serialNumber: number,
): { data: Uint8Array; pageCount: number } {
  /** Maximum bytes of packet data placed in a single OGG page (C++ SplitSize). */
  const SPLIT_SIZE = 32 * 255; // 8160

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  let pageSequence = 0;

  for (let pktIdx = 0; pktIdx < packets.length; pktIdx++) {
    const pkt = packets[pktIdx];
    const pktData = pkt.data;
    const isFirstPacket = pktIdx === 0;

    let pos = 0;
    let isFirstPageOfPacket = true;

    do {
      const chunkSize = Math.min(SPLIT_SIZE, pktData.length - pos);
      const isLastChunk = pos + chunkSize >= pktData.length;

      // Build lacing values for this chunk, matching C++ PageHeader::lacingValues():
      //   • full segments: (chunkSize / 255) lacing values of 0xFF
      //   • terminal value: (chunkSize % 255) appended only on the LAST chunk of the packet
      const lacingValues: number[] = [];
      const fullSegs = Math.trunc(chunkSize / 255);
      for (let s = 0; s < fullSegs; s++) {
        lacingValues.push(255);
      }
      if (isLastChunk) {
        // Terminal lacing value marks the end of the packet.
        lacingValues.push(chunkSize % 255);
      }
      // (Intermediate pages carry no terminal lacing value even when chunkSize % 255 == 0)

      const pageSegCount = lacingValues.length;
      const isContinuation = !isFirstPageOfPacket;

      let headerType = 0;
      if (isContinuation) headerType |= 0x01;
      if (isFirstPacket && !isContinuation) headerType |= 0x02; // BOS on first page of first packet

      const headerSize = 27 + pageSegCount;
      const header = new Uint8Array(headerSize);
      header[0] = 0x4F; header[1] = 0x67; header[2] = 0x67; header[3] = 0x53;
      header[4] = 0;
      header[5] = headerType;
      // Granule position = 0 for all header pages
      for (let b = 0; b < 8; b++) header[6 + b] = 0;
      header[14] = serialNumber & 0xFF;
      header[15] = (serialNumber >> 8) & 0xFF;
      header[16] = (serialNumber >> 16) & 0xFF;
      header[17] = (serialNumber >> 24) & 0xFF;
      header[18] = pageSequence & 0xFF;
      header[19] = (pageSequence >> 8) & 0xFF;
      header[20] = (pageSequence >> 16) & 0xFF;
      header[21] = (pageSequence >> 24) & 0xFF;
      header[22] = 0; header[23] = 0; header[24] = 0; header[25] = 0;
      header[26] = pageSegCount;
      for (let s = 0; s < pageSegCount; s++) {
        header[27 + s] = lacingValues[s];
      }

      const pageData = pktData.slice(pos, pos + chunkSize);

      const fullPage = new Uint8Array(headerSize + chunkSize);
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
      pos += chunkSize;
      isFirstPageOfPacket = false;
    } while (pos < pktData.length);
  }

  const output = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return { data: output, pageCount: pageSequence };
}

/**
 * Update the page sequence number in a raw OGG page and recompute CRC.
 */
function adjustPageSequence(pageData: Uint8Array, newSeqNum: number): Uint8Array {
  const copy = new Uint8Array(pageData);
  copy[18] = newSeqNum & 0xFF;
  copy[19] = (newSeqNum >> 8) & 0xFF;
  copy[20] = (newSeqNum >> 16) & 0xFF;
  copy[21] = (newSeqNum >> 24) & 0xFF;
  // Zero CRC before recomputing
  copy[22] = 0; copy[23] = 0; copy[24] = 0; copy[25] = 0;
  const crc = oggCrc32(copy);
  copy[22] = crc & 0xFF;
  copy[23] = (crc >> 8) & 0xFF;
  copy[24] = (crc >> 16) & 0xFF;
  copy[25] = (crc >> 24) & 0xFF;
  return copy;
}

/**
 * Abstract base class for OGG-based file formats. Provides packet-level
 * access to the OGG bitstream by iterating pages and reassembling packets.
 *
 * On save, only header pages are re-rendered from packets. Audio pages are
 * preserved verbatim (with updated page sequence numbers) so that granule
 * positions, page boundaries, and audio data remain intact — producing
 * output that is fully seekable and playable.
 */
export abstract class OggFile extends File {
  /** Parsed page headers, or `null` if pages have not yet been read from the stream. */
  private _pages: OggPageHeader[] | null = null;
  /** Byte offset of each page within the stream, in page order. */
  private _pageOffsets: number[] = [];
  /** Raw bytes of each page, used for verbatim copying of audio pages during save. */
  private _pageRawData: Uint8Array[] = [];
  /** Index of the first logical packet that begins on each page. */
  private _pageFirstPktIdx: number[] = [];
  /** Reassembled logical packets keyed by their zero-based packet index. */
  private _packets: Map<number, ByteVector> = new Map();
  /** Packets that have been modified in memory and not yet flushed to disk. */
  private _dirtyPackets: Map<number, ByteVector> = new Map();
  /** OGG serial number of the first (and only) logical bitstream encountered. */
  private _serialNumber: number = 0;

  /**
   * Constructs an OggFile backed by the given stream.
   * @param stream - The I/O stream to read from and write to.
   */
  constructor(stream: IOStream) {
    super(stream);
  }

  /**
   * Number of header packets for this OGG format.
   * Header packets are re-rendered on save; audio pages after them are
   * copied verbatim. Override in subclasses:
   * - Vorbis: 3 (identification, comment, setup)
   * - Opus/Speex/OGG FLAC: 2 (identification, comment)
   */
  protected get numHeaderPackets(): number {
    return 3;
  }

  // ---------------------------------------------------------------------------
  // Packet access
  // ---------------------------------------------------------------------------

  /**
   * Retrieve a logical packet by its zero-based index.
   * Returns the dirty (in-memory) version if one exists, otherwise reads and reassembles from disk.
   * @param index - Zero-based packet index.
   * @returns The packet data as a {@link ByteVector}.
   */
  async packet(index: number): Promise<ByteVector> {
    const dirty = this._dirtyPackets.get(index);
    if (dirty) return dirty;

    const cached = this._packets.get(index);
    if (cached) return cached;

    await this.readPages();
    return this._packets.get(index) ?? new ByteVector();
  }

  /**
   * Mark a packet as dirty with new content to be written on the next save.
   * @param index - Zero-based packet index.
   * @param data - New packet data to store and use when saving.
   */
  setPacket(index: number, data: ByteVector): void {
    this._dirtyPackets.set(index, data);
  }

  /**
   * Returns the header of the first OGG page in the stream.
   * @returns The first {@link OggPageHeader}, or `null` if the stream is empty or invalid.
   */
  async firstPageHeader(): Promise<OggPageHeader | null> {
    await this.readPages();
    return this._pages?.[0] ?? null;
  }

  /**
   * Returns the header of the last OGG page in the stream.
   * Used for computing total granule count and thus stream duration.
   * @returns The last {@link OggPageHeader}, or `null` if the stream is empty or invalid.
   */
  async lastPageHeader(): Promise<OggPageHeader | null> {
    await this.readPages();
    if (this._pages && this._pages.length > 0) {
      return this._pages[this._pages.length - 1];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Save — preserves audio pages, only re-renders header pages
  // ---------------------------------------------------------------------------

  /**
   * Persist all pending packet changes to the underlying stream.
   *
   * Header packets are re-rendered from in-memory (possibly dirty) copies.
   * Audio pages are copied verbatim from the original stream with adjusted
   * sequence numbers, preserving granule positions and audio data.
   * @returns `true` on success, `false` if the file is read-only or has no pages.
   */
  async save(): Promise<boolean> {
    if (this.readOnly) return false;

    await this.readPages();
    if (!this._pages || this._pages.length === 0) return false;

    const headerPktCount = this.numHeaderPackets;

    // Find the first "audio page" — the first original page whose first
    // packet index >= headerPktCount (i.e., it contains only audio data).
    let firstAudioPage = this._pages.length;
    for (let p = 0; p < this._pages.length; p++) {
      if (this._pageFirstPktIdx[p] >= headerPktCount) {
        firstAudioPage = p;
        break;
      }
    }

    // Collect header packets (using dirty versions where available)
    const headerPackets: ByteVector[] = [];
    for (let i = 0; i < headerPktCount; i++) {
      headerPackets.push(
        this._dirtyPackets.get(i) ?? this._packets.get(i) ?? new ByteVector(),
      );
    }

    // Render header pages (granule=0, BOS on first, no EOS)
    const header = renderHeaderPages(headerPackets, this._serialNumber);

    // Collect output chunks: header pages + adjusted audio pages
    const chunks: Uint8Array[] = [header.data];
    let totalSize = header.data.length;

    // Copy audio pages from original file, adjusting page sequence numbers
    for (let p = firstAudioPage; p < this._pages.length; p++) {
      const raw = this._pageRawData[p];
      const newSeqNum = header.pageCount + (p - firstAudioPage);
      const adjusted = adjustPageSequence(raw, newSeqNum);
      chunks.push(adjusted);
      totalSize += adjusted.length;
    }

    // Single-pass concatenation and write
    const output = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }

    await this._stream.seek(0, Position.Beginning);
    await this._stream.truncate(0);
    await this._stream.writeBlock(new ByteVector(output));

    // Clear caches
    this._dirtyPackets.clear();
    this._pages = null;
    this._packets.clear();
    this._pageOffsets = [];
    this._pageRawData = [];
    this._pageFirstPktIdx = [];

    return true;
  }

  // ---------------------------------------------------------------------------
  // Internal page/packet reading
  // ---------------------------------------------------------------------------

  /**
   * Parse all OGG pages from the stream and reassemble logical packets.
   * Results are cached; subsequent calls are no-ops until the cache is cleared (e.g., after save).
   */
  private async readPages(): Promise<void> {
    if (this._pages !== null) return;

    this._pages = [];
    this._pageOffsets = [];
    this._pageRawData = [];
    this._pageFirstPktIdx = [];
    this._packets.clear();

    let offset = 0;
    const fileLen = await this.fileLength();
    let packetIndex = 0;
    let currentPacket = new ByteVector();
    let continued = false;

    while (offset < fileLen) {
      const page = await OggPageHeader.parse(this._stream, offset);
      if (!page || !page.isValid) break;

      this._pages.push(page);
      this._pageOffsets.push(offset);

      // Record the packet index at the start of this page
      this._pageFirstPktIdx.push(packetIndex);

      // Read raw page bytes for later verbatim copying
      await this._stream.seek(offset, Position.Beginning);
      const rawBv = await this._stream.readBlock(page.totalSize);
      this._pageRawData.push(new Uint8Array(rawBv.data));

      if (this._pages.length === 1) {
        this._serialNumber = page.serialNumber;
      }

      // Read page payload for packet reassembly
      await this._stream.seek(offset + page.headerSize, Position.Beginning);
      const payload = await this._stream.readBlock(page.dataSize);

      // Reassemble packets from segment table
      let payloadOffset = 0;
      const sizes = page.packetSizes;
      const segTable = page.segmentTable;

      for (let i = 0; i < sizes.length; i++) {
        const size = sizes[i];
        const chunk = payload.mid(payloadOffset, size);
        payloadOffset += size;

        if (i === 0 && page.isContinuation && continued) {
          currentPacket.append(chunk);
        } else {
          currentPacket = ByteVector.fromByteVector(chunk);
        }

        // Check if this packet is complete (last segment byte < 255)
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

    if (currentPacket.length > 0) {
      this._packets.set(packetIndex, currentPacket);
    }
  }
}
