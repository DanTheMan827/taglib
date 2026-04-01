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
 * Implements C++ TagLib `Ogg::Page::paginate` behaviour:
 *   - Packet 0 (identification) always gets its own BOS page.
 *   - Remaining packets (1..N-1) are paginated together as a group
 *     using the `SinglePagePerGroup` / `Repaginate` heuristic:
 *     • If the combined segment-table count ≤ 255, all remaining packets
 *       are written into ONE page with interleaved lacing values.
 *     • Otherwise each packet is split independently at
 *       `SplitSize = 32 × 255 = 8 160` bytes per page (Repaginate).
 *
 * Returns the rendered bytes and the number of pages generated.
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

  /**
   * Build one OGG page from an already-computed lacing array and the
   * corresponding data buffer.
   */
  function emitPage(
    headerType: number,
    lacingValues: number[],
    pageData: Uint8Array,
  ): void {
    const pageSegCount = lacingValues.length;
    const headerSize = 27 + pageSegCount;
    const fullPage = new Uint8Array(headerSize + pageData.length);
    fullPage[0] = 0x4F; fullPage[1] = 0x67; fullPage[2] = 0x67; fullPage[3] = 0x53;
    fullPage[4] = 0;
    fullPage[5] = headerType;
    // Granule position = 0 for all header pages
    fullPage[14] = serialNumber & 0xFF;
    fullPage[15] = (serialNumber >> 8) & 0xFF;
    fullPage[16] = (serialNumber >> 16) & 0xFF;
    fullPage[17] = (serialNumber >> 24) & 0xFF;
    fullPage[18] = pageSequence & 0xFF;
    fullPage[19] = (pageSequence >> 8) & 0xFF;
    fullPage[20] = (pageSequence >> 16) & 0xFF;
    fullPage[21] = (pageSequence >> 24) & 0xFF;
    fullPage[26] = pageSegCount;
    for (let s = 0; s < pageSegCount; s++) fullPage[27 + s] = lacingValues[s];
    fullPage.set(pageData, headerSize);
    const crc = oggCrc32(fullPage);
    fullPage[22] = crc & 0xFF;
    fullPage[23] = (crc >> 8) & 0xFF;
    fullPage[24] = (crc >> 16) & 0xFF;
    fullPage[25] = (crc >> 24) & 0xFF;
    chunks.push(fullPage);
    totalSize += fullPage.length;
    pageSequence++;
  }

  // --- Packet 0: BOS page (always alone) ---
  if (packets.length > 0) {
    const pkt0 = packets[0].data;
    const lacing: number[] = [];
    const full0 = Math.trunc(pkt0.length / 255);
    for (let s = 0; s < full0; s++) lacing.push(255);
    lacing.push(pkt0.length % 255);
    emitPage(0x02 /* BOS */, lacing, pkt0);
  }

  // --- Packets 1..N-1: C++ Page::paginate heuristic ---
  const remaining = packets.slice(1);
  if (remaining.length === 0) {
    const output = new Uint8Array(totalSize);
    let off = 0;
    for (const c of chunks) { output.set(c, off); off += c.length; }
    return { data: output, pageCount: pageSequence };
  }

  // Calculate total segment-table size for all remaining packets
  // (C++ formula: accumulate(pkt.size()/255 + 1))
  let tableSize = 0;
  for (const pkt of remaining) {
    tableSize += Math.trunc(pkt.data.length / 255) + 1;
  }

  if (tableSize <= 255) {
    // SinglePagePerGroup: all remaining packets in ONE page.
    // Lacing follows C++ PageHeader::lacingValues():
    //   for each packet: (size/255)×0xFF then (size%255) as terminal.
    const lacingValues: number[] = [];
    const pageData: number[] = [];
    for (const pkt of remaining) {
      const data = pkt.data;
      const full = Math.trunc(data.length / 255);
      for (let s = 0; s < full; s++) lacingValues.push(255);
      lacingValues.push(data.length % 255);
      pageData.push(...data);
    }
    emitPage(0x00, lacingValues, new Uint8Array(pageData));
  } else {
    // Repaginate: process each packet independently, split at SplitSize.
    for (const pkt of remaining) {
      const pktData = pkt.data;
      let pos = 0;
      let isFirstPageOfPacket = true;

      do {
        const chunkSize = Math.min(SPLIT_SIZE, pktData.length - pos);
        const isLastChunk = pos + chunkSize >= pktData.length;

        const lacingValues: number[] = [];
        const fullSegs = Math.trunc(chunkSize / 255);
        for (let s = 0; s < fullSegs; s++) lacingValues.push(255);
        if (isLastChunk) lacingValues.push(chunkSize % 255);

        const isContinuation = !isFirstPageOfPacket;
        emitPage(isContinuation ? 0x01 : 0x00, lacingValues, pktData.slice(pos, pos + chunkSize));

        pos += chunkSize;
        isFirstPageOfPacket = false;
      } while (pos < pktData.length);
    }
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
