import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Tag } from "../tag.js";
import { ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { ShortenTag } from "./shortenTag.js";
import { ShortenProperties, type ShortenPropertyValues } from "./shortenProperties.js";

// =============================================================================
// Constants
// =============================================================================

const MIN_SUPPORTED_VERSION = 1;
const MAX_SUPPORTED_VERSION = 3;

const CHANNEL_COUNT_CODE_SIZE = 0;
const FUNCTION_CODE_SIZE = 2;
const VERBATIM_CHUNK_SIZE_CODE_SIZE = 5;
const VERBATIM_BYTE_CODE_SIZE = 8;
const UINT32_CODE_SIZE = 2;
const SKIP_BYTES_CODE_SIZE = 1;
const LPCQ_CODE_SIZE = 2;
const EXTRA_BYTE_CODE_SIZE = 7;
const FILE_TYPE_CODE_SIZE = 4;

const FUNCTION_VERBATIM = 9;
const CANONICAL_HEADER_SIZE = 44;
const VERBATIM_CHUNK_MAX_SIZE = 256;
const MAX_CHANNEL_COUNT = 8;
const DEFAULT_BLOCK_SIZE = 256;
const MAX_BLOCK_SIZE = 65535;
const WAVE_FORMAT_PCM_TAG = 0x0001;

// =============================================================================
// Variable-Length Input (Golomb-Rice coding)
// =============================================================================

class VariableLengthInput {
  private file: File;
  private buffer: ByteVector = ByteVector.fromByteArray(new Uint8Array(0));
  private bufferPosition: number = 0;
  private bitBuffer: number = 0;
  private bitsAvailable: number = 0;

  constructor(file: File) {
    this.file = file;
  }

  getRiceGolombCode(k: number): { value: number; ok: boolean } {
    const MASK_TABLE = [
      0x0,
      0x1,        0x3,        0x7,        0xf,
      0x1f,       0x3f,       0x7f,       0xff,
      0x1ff,      0x3ff,      0x7ff,      0xfff,
      0x1fff,     0x3fff,     0x7fff,     0xffff,
      0x1ffff,    0x3ffff,    0x7ffff,    0xfffff,
      0x1fffff,   0x3fffff,   0x7fffff,   0xffffff,
      0x1ffffff,  0x3ffffff,  0x7ffffff,  0xfffffff,
      0x1fffffff, 0x3fffffff, 0x7fffffff, 0xffffffff,
    ];

    if (this.bitsAvailable === 0 && !this.refillBitBuffer()) {
      return { value: 0, ok: false };
    }

    let result = 0;
    while (true) {
      this.bitsAvailable--;
      if (this.bitBuffer & (1 << this.bitsAvailable)) break;
      result++;
      if (this.bitsAvailable === 0 && !this.refillBitBuffer()) {
        return { value: 0, ok: false };
      }
    }

    let remaining = k;
    while (remaining !== 0) {
      if (this.bitsAvailable >= remaining) {
        result = ((result << remaining) >>> 0) |
          ((this.bitBuffer >>> (this.bitsAvailable - remaining)) & MASK_TABLE[remaining]);
        this.bitsAvailable -= remaining;
        remaining = 0;
      } else {
        result = ((result << this.bitsAvailable) >>> 0) |
          (this.bitBuffer & MASK_TABLE[this.bitsAvailable]);
        remaining -= this.bitsAvailable;
        if (!this.refillBitBuffer()) {
          return { value: 0, ok: false };
        }
      }
    }

    return { value: result, ok: true };
  }

  getUInt(version: number, k: number): { value: number; ok: boolean } {
    if (version > 0) {
      const kResult = this.getRiceGolombCode(UINT32_CODE_SIZE);
      if (!kResult.ok) return { value: 0, ok: false };
      k = kResult.value;
    }
    const result = this.getRiceGolombCode(k);
    if (!result.ok) return { value: 0, ok: false };
    return { value: result.value >>> 0, ok: true };
  }

  private refillBitBuffer(): boolean {
    if (this.buffer.length - this.bufferPosition < 4) {
      const block = this.file.readBlock(512);
      if (block.length < 4) return false;
      this.buffer = block;
      this.bufferPosition = 0;
    }

    this.bitBuffer = this.buffer.toUInt(this.bufferPosition, true);
    this.bufferPosition += 4;
    this.bitsAvailable = 32;
    return true;
  }
}

// =============================================================================
// ShortenFile
// =============================================================================

/**
 * Shorten (.shn) file format handler.
 *
 * Read-only format. The file starts with magic "ajkg", followed by a version
 * byte and variable-length coded audio parameters. The actual audio metadata
 * (sample rate, bits per sample) comes from an embedded WAVE or AIFF header
 * in a verbatim section.
 */
export class ShortenFile extends File {
  private _tag: ShortenTag;
  private _properties: ShortenProperties | null = null;

  constructor(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ) {
    super(stream);
    this._tag = new ShortenTag();
    if (this.isOpen) {
      this.read(readProperties, readStyle);
    }
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  static isSupported(stream: IOStream): boolean {
    stream.seek(0);
    const magic = stream.readBlock(4);
    if (magic.length < 4) return false;
    return magic.toString(StringType.Latin1) === "ajkg";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  tag(): Tag {
    return this._tag;
  }

  audioProperties(): ShortenProperties | null {
    return this._properties;
  }

  save(): boolean {
    // Shorten files are read-only
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  private read(_readProperties: boolean, readStyle: ReadStyle): void {
    this.seek(0);
    const magic = this.readBlock(4);
    if (magic.length < 4 || magic.toString(StringType.Latin1) !== "ajkg") {
      this._valid = false;
      return;
    }

    const props: ShortenPropertyValues = {
      version: 0,
      fileType: 0,
      channelCount: 0,
      sampleRate: 0,
      bitsPerSample: 0,
      sampleFrames: 0,
    };

    // Version byte
    const versionData = this.readBlock(1);
    if (versionData.length < 1) { this._valid = false; return; }
    const version = versionData.get(0);
    if (version < MIN_SUPPORTED_VERSION || version > MAX_SUPPORTED_VERSION) {
      this._valid = false; return;
    }
    props.version = version;

    const input = new VariableLengthInput(this);

    // File type
    const ftResult = input.getUInt(version, FILE_TYPE_CODE_SIZE);
    if (!ftResult.ok) { this._valid = false; return; }
    props.fileType = ftResult.value;

    // Channel count
    const ccResult = input.getUInt(version, CHANNEL_COUNT_CODE_SIZE);
    if (!ccResult.ok || ccResult.value === 0 || ccResult.value > MAX_CHANNEL_COUNT) {
      this._valid = false; return;
    }
    props.channelCount = ccResult.value;

    // Block size and other params for version > 0
    if (version > 0) {
      const bsResult = input.getUInt(version, Math.floor(Math.log2(DEFAULT_BLOCK_SIZE)));
      if (!bsResult.ok || bsResult.value === 0 || bsResult.value > MAX_BLOCK_SIZE) {
        this._valid = false; return;
      }

      const maxnlpcResult = input.getUInt(version, LPCQ_CODE_SIZE);
      if (!maxnlpcResult.ok) { this._valid = false; return; }

      const nmeanResult = input.getUInt(version, 0);
      if (!nmeanResult.ok) { this._valid = false; return; }

      const skipCountResult = input.getUInt(version, SKIP_BYTES_CODE_SIZE);
      if (!skipCountResult.ok) { this._valid = false; return; }

      for (let i = 0; i < skipCountResult.value; i++) {
        const dummyResult = input.getUInt(version, EXTRA_BYTE_CODE_SIZE);
        if (!dummyResult.ok) { this._valid = false; return; }
      }
    }

    // Read verbatim section
    const funcResult = input.getRiceGolombCode(FUNCTION_CODE_SIZE);
    if (!funcResult.ok || funcResult.value !== FUNCTION_VERBATIM) {
      this._valid = false; return;
    }

    const headerSizeResult = input.getRiceGolombCode(VERBATIM_CHUNK_SIZE_CODE_SIZE);
    if (!headerSizeResult.ok ||
        headerSizeResult.value < CANONICAL_HEADER_SIZE ||
        headerSizeResult.value > VERBATIM_CHUNK_MAX_SIZE) {
      this._valid = false; return;
    }

    const headerSize = headerSizeResult.value;
    const headerArr = new Uint8Array(headerSize);
    for (let i = 0; i < headerSize; i++) {
      const byteResult = input.getRiceGolombCode(VERBATIM_BYTE_CODE_SIZE);
      if (!byteResult.ok) { this._valid = false; return; }
      headerArr[i] = byteResult.value & 0xff;
    }

    const header = ByteVector.fromByteArray(headerArr);

    // Parse embedded WAVE or AIFF header
    const chunkID = header.toUInt(0, true);

    if (chunkID === 0x52494646) {
      // "RIFF" - WAVE format
      this.parseWaveHeader(header, props);
    } else if (chunkID === 0x464f524d) {
      // "FORM" - AIFF format
      this.parseAiffHeader(header, props);
    } else {
      this._valid = false; return;
    }

    if (this._valid !== false) {
      this._tag = new ShortenTag();
      this._properties = new ShortenProperties(props, readStyle);
    }
  }

  private parseWaveHeader(header: ByteVector, props: ShortenPropertyValues): void {
    let offset = 8; // Skip RIFF + size

    const formType = header.toUInt(offset, true);
    offset += 4;
    if (formType !== 0x57415645) { // "WAVE"
      this._valid = false; return;
    }

    let sawFormat = false;
    let dataChunkSize = 0;
    let blockAlign = 0;

    while (offset + 8 <= header.length) {
      const ckId = header.toUInt(offset, true);
      offset += 4;
      const ckSize = header.toUInt(offset, false); // little-endian
      offset += 4;

      if (ckId === 0x666d7420) { // "fmt "
        if (ckSize < 16) { this._valid = false; return; }

        const formatTag = header.toUShort(offset, false);
        if (formatTag !== WAVE_FORMAT_PCM_TAG) { this._valid = false; return; }

        const fmtChannels = header.toUShort(offset + 2, false);
        // Allow mismatch but prefer Shorten's channel count
        if (props.channelCount !== fmtChannels) {
          // Mismatch warning, use Shorten's value
        }

        props.sampleRate = header.toUInt(offset + 4, false);
        // Skip average bytes per second (4 bytes)
        blockAlign = header.toUShort(offset + 12, false);
        props.bitsPerSample = header.toUShort(offset + 14, false);

        sawFormat = true;
        offset += ckSize;
      } else if (ckId === 0x64617461) { // "data"
        dataChunkSize = ckSize;
        offset += ckSize;
      } else {
        offset += ckSize;
      }
    }

    if (!sawFormat) { this._valid = false; return; }

    if (dataChunkSize && blockAlign) {
      props.sampleFrames = Math.floor(dataChunkSize / blockAlign);
    }
  }

  private parseAiffHeader(header: ByteVector, props: ShortenPropertyValues): void {
    let offset = 8; // Skip FORM + size

    const formType = header.toUInt(offset, true);
    offset += 4;
    if (formType !== 0x41494646 && formType !== 0x41494643) { // "AIFF" or "AIFC"
      this._valid = false; return;
    }

    let sawCommon = false;

    while (offset + 8 <= header.length) {
      const ckId = header.toUInt(offset, true);
      offset += 4;
      let ckSize = header.toUInt(offset, true); // big-endian
      offset += 4;

      // AIFF chunks must have even length
      ckSize += (ckSize & 1);

      if (ckId === 0x434f4d4d) { // "COMM"
        if (ckSize < 18) { this._valid = false; return; }

        // Skip channels from COMM, use Shorten's
        offset += 2;

        props.sampleFrames = header.toUInt(offset, true);
        offset += 4;

        props.bitsPerSample = header.toUShort(offset, true);
        offset += 2;

        // Sample rate: IEEE 754 80-bit extended float
        const exp = (header.toUShort(offset, true) - 16383 - 63) | 0;
        offset += 2;

        if (exp < -63 || exp > 63) { this._valid = false; return; }

        const frac = header.toULongLong(offset, true);
        offset += 8;

        if (exp >= 0) {
          props.sampleRate = Number(frac << BigInt(exp));
        } else {
          props.sampleRate = Number(
            (frac + (BigInt(1) << BigInt(-exp - 1))) >> BigInt(-exp),
          );
        }

        sawCommon = true;
      } else {
        offset += ckSize;
      }
    }

    if (!sawCommon) { this._valid = false; return; }
  }
}
