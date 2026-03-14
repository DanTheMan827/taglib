import { ByteVector } from "../byteVector.js";
import { File } from "../file.js";
import { IOStream } from "../toolkit/ioStream.js";
import { Position } from "../toolkit/types.js";
import { OggPageHeader } from "./oggPageHeader.js";

/**
 * Abstract base class for OGG-based file formats. Provides packet-level
 * access to the OGG bitstream by iterating pages and reassembling packets.
 */
export abstract class OggFile extends File {
  private _pages: OggPageHeader[] | null = null;
  private _packets: Map<number, ByteVector> = new Map();
  private _dirtyPackets: Map<number, ByteVector> = new Map();

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
  // Save stub
  // ---------------------------------------------------------------------------

  save(): boolean {
    // Base implementation — subclasses should override for full write support.
    return false;
  }

  // ---------------------------------------------------------------------------
  // Internal page/packet reading
  // ---------------------------------------------------------------------------

  private readPages(): void {
    if (this._pages !== null) {
      return;
    }

    this._pages = [];
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
