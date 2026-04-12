/** @packageDocumentation Shorten (.shn) lossless audio file format handler. Read-only; decodes audio properties from the embedded verbatim header. */

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

/** Minimum Shorten format version supported by this parser. */
const MIN_SUPPORTED_VERSION = 1;
/** Maximum Shorten format version supported by this parser. */
const MAX_SUPPORTED_VERSION = 3;

/** Rice-Golomb code size used for channel count fields. */
const CHANNEL_COUNT_CODE_SIZE = 0;
/** Rice-Golomb code size used for function code fields. */
const FUNCTION_CODE_SIZE = 2;
/** Rice-Golomb code size used for verbatim chunk size fields. */
const VERBATIM_CHUNK_SIZE_CODE_SIZE = 5;
/** Rice-Golomb code size used for verbatim byte fields. */
const VERBATIM_BYTE_CODE_SIZE = 8;
/** Rice-Golomb code size used for uint32 fields. */
const UINT32_CODE_SIZE = 2;
/** Rice-Golomb code size used for skip-bytes count fields. */
const SKIP_BYTES_CODE_SIZE = 1;
/** Rice-Golomb code size used for LPC order fields. */
const LPCQ_CODE_SIZE = 2;
/** Rice-Golomb code size used for extra (skip) byte fields. */
const EXTRA_BYTE_CODE_SIZE = 7;
/** Rice-Golomb code size used for file type fields. */
const FILE_TYPE_CODE_SIZE = 4;

/** Shorten function code value that indicates a verbatim (raw header) block. */
const FUNCTION_VERBATIM = 9;
/** Minimum verbatim header size required to contain a WAVE/AIFF canonical header. */
const CANONICAL_HEADER_SIZE = 44;
/** Maximum allowed verbatim chunk size. */
const VERBATIM_CHUNK_MAX_SIZE = 256;
/** Maximum channel count accepted when parsing Shorten streams. */
const MAX_CHANNEL_COUNT = 8;
/** Default audio block size used for entropy coding. */
const DEFAULT_BLOCK_SIZE = 256;
/** Maximum legal audio block size in a Shorten stream. */
const MAX_BLOCK_SIZE = 65535;
/** WAVE PCM format tag value (`0x0001`). */
const WAVE_FORMAT_PCM_TAG = 0x0001;

// =============================================================================
// Variable-Length Input (Golomb-Rice coding)
// =============================================================================

/**
 * Streaming bit-level reader that decodes Rice-Golomb variable-length codes
 * from a {@link File} stream.
 *
 * Maintains an internal 32-bit bit buffer and refills it from the file as
 * needed. Used exclusively by {@link ShortenFile} during header parsing.
 */
class VariableLengthInput {
  /** The underlying file to read raw bytes from. */
  private file: File;
  /** Byte buffer holding a recently read block from the file. */
  private buffer: ByteVector = ByteVector.fromByteArray(new Uint8Array(0));
  /** Current read position within {@link buffer}. */
  private bufferPosition: number = 0;
  /** Current 32-bit bit-buffer holding up to 32 bits of data. */
  private bitBuffer: number = 0;
  /** Number of valid bits remaining in {@link bitBuffer}. */
  private bitsAvailable: number = 0;

  /**
   * Constructs a `VariableLengthInput` reader backed by the given file.
   * @param file - The file to read encoded data from.
   */
  constructor(file: File) {
    this.file = file;
  }

  /**
   * Decodes a single Rice-Golomb code of order `k` from the bit stream.
   *
   * The unary prefix gives the quotient and the subsequent `k` bits give
   * the remainder. The decoded value is `quotient * 2^k + remainder`.
   * @param k - The Rice parameter (number of remainder bits).
   * @returns An object with `value` (the decoded integer) and `ok` (`false` on EOF).
   */
  async getRiceGolombCode(k: number): Promise<{ value: number; ok: boolean }> {
    // k must be in [0, 31]: values outside this range would cause a shift by 32
    // (UB for int32_t in C++) or negative shifts, and are invalid for this format.
    if (k < 0 || k > 31) {
      return { value: 0, ok: false };
    }

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

    if (this.bitsAvailable === 0 && !await this.refillBitBuffer()) {
      return { value: 0, ok: false };
    }

    let result = 0;
    while (true) {
      this.bitsAvailable--;
      if (this.bitBuffer & (1 << this.bitsAvailable)) break;
      result++;
      if (this.bitsAvailable === 0 && !await this.refillBitBuffer()) {
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
        if (!await this.refillBitBuffer()) {
          return { value: 0, ok: false };
        }
      }
    }

    return { value: result, ok: true };
  }

  /**
   * Decodes an unsigned integer from the stream using an adaptive Rice code.
   *
   * For version > 0 the Rice parameter `k` is itself read from the stream
   * using a fixed {@link UINT32_CODE_SIZE}-bit code; for version 0 the
   * caller-supplied `k` is used directly.
   * @param version - The Shorten file version (controls whether `k` is adaptive).
   * @param k - Initial Rice parameter (used directly when `version` is `0`).
   * @returns An object with `value` (the decoded unsigned integer) and `ok`.
   */
  async getUInt(version: number, k: number): Promise<{ value: number; ok: boolean }> {
    if (version > 0) {
      const kResult = await this.getRiceGolombCode(UINT32_CODE_SIZE);
      if (!kResult.ok) return { value: 0, ok: false };
      k = kResult.value;
    }
    const result = await this.getRiceGolombCode(k);
    if (!result.ok) return { value: 0, ok: false };
    return { value: result.value >>> 0, ok: true };
  }

  /**
   * Reads the next 32-bit word from the file into the internal bit buffer.
   * @returns `true` if the buffer was successfully refilled, `false` on EOF.
   */
  private async refillBitBuffer(): Promise<boolean> {
    if (this.buffer.length - this.bufferPosition < 4) {
      const block = await this.file.readBlock(512);
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
 * Read-only format. The file starts with the four-byte magic "ajkg", followed
 * by a version byte and variable-length coded audio parameters. The actual
 * audio metadata (sample rate, bits per sample) comes from an embedded WAVE
 * or AIFF header inside the first verbatim section.
 */
export class ShortenFile extends File {
  /** The stub tag (Shorten files carry no metadata). */
  private _tag: ShortenTag;
  /** Parsed audio properties, or `null` if not yet read. */
  private _properties: ShortenProperties | null = null;

  /**
   * Private constructor — use {@link ShortenFile.open} to create instances.
   * @param stream - The underlying I/O stream for this Shorten file.
   */
  private constructor(stream: IOStream) {
    super(stream);
    this._tag = new ShortenTag();
  }

  /**
   * Opens and parses a Shorten file from the given stream.
   * @param stream - Readable I/O stream for the `.shn` file.
   * @param readProperties - When `true` (default), parse audio properties.
   * @param readStyle - Controls parsing accuracy vs. speed trade-off.
   * @returns A fully initialised `ShortenFile` instance.
   */
  static async open(
    stream: IOStream,
    readProperties: boolean = true,
    readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<ShortenFile> {
    const f = new ShortenFile(stream);
    if (f.isOpen) {
      await f.read(readProperties, readStyle);
    }
    return f;
  }

  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Quick-check whether `stream` looks like a valid Shorten file.
   * Verifies the four-byte "ajkg" magic at offset 0.
   * @param stream - The I/O stream to test.
   * @returns `true` if the stream appears to be a valid Shorten file.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const magic = await stream.readBlock(4);
    if (magic.length < 4) return false;
    return magic.toString(StringType.Latin1) === "ajkg";
  }

  // ---------------------------------------------------------------------------
  // File interface
  // ---------------------------------------------------------------------------

  /**
   * Returns the tag for this Shorten file.
   * Shorten files carry no metadata; the returned tag is always empty.
   * @returns The stub {@link ShortenTag}.
   */
  tag(): Tag {
    return this._tag;
  }

  /**
   * Returns the audio properties parsed from the Shorten stream.
   * @returns The {@link ShortenProperties}, or `null` if parsing failed or was skipped.
   */
  audioProperties(): ShortenProperties | null {
    return this._properties;
  }

  /**
   * Shorten files are read-only; this method always returns `false`.
   * @returns `false`.
   */
  async save(): Promise<boolean> {
    // Shorten files are read-only
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private – reading
  // ---------------------------------------------------------------------------

  /**
   * Reads and decodes audio properties from the Shorten stream header.
   * @param _readProperties - Ignored; properties are always parsed when the file is valid.
   * @param readStyle - Level of detail for audio property parsing.
   */
  private async read(_readProperties: boolean, readStyle: ReadStyle): Promise<void> {
    await this.seek(0);
    const magic = await this.readBlock(4);
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
    const versionData = await this.readBlock(1);
    if (versionData.length < 1) { this._valid = false; return; }
    const version = versionData.get(0);
    if (version < MIN_SUPPORTED_VERSION || version > MAX_SUPPORTED_VERSION) {
      this._valid = false; return;
    }
    props.version = version;

    const input = new VariableLengthInput(this);

    // File type
    const ftResult = await input.getUInt(version, FILE_TYPE_CODE_SIZE);
    if (!ftResult.ok) { this._valid = false; return; }
    props.fileType = ftResult.value;

    // Channel count
    const ccResult = await input.getUInt(version, CHANNEL_COUNT_CODE_SIZE);
    if (!ccResult.ok || ccResult.value === 0 || ccResult.value > MAX_CHANNEL_COUNT) {
      this._valid = false; return;
    }
    props.channelCount = ccResult.value;

    // Block size and other params for version > 0
    if (version > 0) {
      const bsResult = await input.getUInt(version, Math.floor(Math.log2(DEFAULT_BLOCK_SIZE)));
      if (!bsResult.ok || bsResult.value === 0 || bsResult.value > MAX_BLOCK_SIZE) {
        this._valid = false; return;
      }

      const maxnlpcResult = await input.getUInt(version, LPCQ_CODE_SIZE);
      if (!maxnlpcResult.ok) { this._valid = false; return; }

      const nmeanResult = await input.getUInt(version, 0);
      if (!nmeanResult.ok) { this._valid = false; return; }

      const skipCountResult = await input.getUInt(version, SKIP_BYTES_CODE_SIZE);
      if (!skipCountResult.ok) { this._valid = false; return; }

      for (let i = 0; i < skipCountResult.value; i++) {
        const dummyResult = await input.getUInt(version, EXTRA_BYTE_CODE_SIZE);
        if (!dummyResult.ok) { this._valid = false; return; }
      }
    }

    // Read verbatim section
    const funcResult = await input.getRiceGolombCode(FUNCTION_CODE_SIZE);
    if (!funcResult.ok || funcResult.value !== FUNCTION_VERBATIM) {
      this._valid = false; return;
    }

    const headerSizeResult = await input.getRiceGolombCode(VERBATIM_CHUNK_SIZE_CODE_SIZE);
    if (!headerSizeResult.ok ||
        headerSizeResult.value < CANONICAL_HEADER_SIZE ||
        headerSizeResult.value > VERBATIM_CHUNK_MAX_SIZE) {
      this._valid = false; return;
    }

    const headerSize = headerSizeResult.value;
    const headerArr = new Uint8Array(headerSize);
    for (let i = 0; i < headerSize; i++) {
      const byteResult = await input.getRiceGolombCode(VERBATIM_BYTE_CODE_SIZE);
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

  /**
   * Parses a RIFF/WAVE header embedded in the Shorten verbatim section.
   * Extracts sample rate, bits per sample, and (if available) sample frame count.
   * @param header - The verbatim header bytes as a `ByteVector`.
   * @param props - The property values object to populate.
   */
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

  /**
   * Parses an AIFF/AIFC header embedded in the Shorten verbatim section.
   * Extracts sample rate, bits per sample, and sample frame count from the COMM chunk.
   * @param header - The verbatim header bytes as a `ByteVector`.
   * @param props - The property values object to populate.
   */
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
