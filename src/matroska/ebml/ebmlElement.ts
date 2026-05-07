/** @packageDocumentation EBML element parsing and writing utilities for Matroska files. */
import { ByteVector, StringType } from "../../byteVector.js";
import { IOStream } from "../../toolkit/ioStream.js";
import { Position } from "../../toolkit/types.js";

/**
 * EBML Element IDs used in Matroska files.
 */
export enum EbmlId {
  EBMLHeader = 0x1A45DFA3,
  DocType = 0x4282,
  DocTypeVersion = 0x4287,
  VoidElement = 0xEC,
  Segment = 0x18538067,
  SeekHead = 0x114D9B74,
  Seek = 0x4DBB,
  SeekID = 0x53AB,
  SeekPosition = 0x53AC,
  Info = 0x1549A966,
  TimestampScale = 0x2AD7B1,
  Duration = 0x4489,
  Title = 0x7BA9,
  Tracks = 0x1654AE6B,
  TrackEntry = 0xAE,
  TrackType = 0x83,
  CodecID = 0x86,
  Audio = 0xE1,
  SamplingFrequency = 0xB5,
  Channels = 0x9F,
  BitDepth = 0x6264,
  Tags = 0x1254C367,
  Tag = 0x7373,
  Targets = 0x63C0,
  TargetTypeValue = 0x68CA,
  TagTrackUID = 0x63C5,
  TagEditionUID = 0x63C9,
  TagChapterUID = 0x63C4,
  TagAttachmentUID = 0x63C6,
  SimpleTag = 0x67C8,
  TagName = 0x45A3,
  TagString = 0x4487,
  TagLanguage = 0x447A,
  TagBinary = 0x4485,
  TagLanguageDefault = 0x4484,
  Attachments = 0x1941A469,
  AttachedFile = 0x61A7,
  AttachedFileDescription = 0x467E,
  AttachedFileName = 0x466E,
  AttachedFileMediaType = 0x4660,
  AttachedFileData = 0x465C,
  AttachedFileUID = 0x46AE,
  Cluster = 0x1F43B675,
  Cues = 0x1C53BB6B,
  Chapters = 0x1043A770,
  EditionEntry = 0x45B9,
  EditionUID = 0x45BC,
  EditionFlagDefault = 0x45DB,
  EditionFlagOrdered = 0x45DD,
  ChapterAtom = 0xB6,
  ChapterUID = 0x73C4,
  ChapterTimeStart = 0x91,
  ChapterTimeEnd = 0x92,
  ChapterFlagHidden = 0x98,
  ChapterDisplay = 0x80,
  ChapString = 0x85,
  ChapLanguage = 0x437C,
};

/**
 * Returns the byte length of an EBML element ID.
 */
export function idSize(id: number): number {
  if (id <= 0xFF) return 1;
  if (id <= 0xFFFF) return 2;
  if (id <= 0xFFFFFF) return 3;
  return 4;
}

/**
 * Determine the VINT size length from the first byte.
 * The number of leading zeros in the first byte indicates extra bytes.
 * maxSizeLength limits how many bytes are allowed (4 for IDs, 8 for sizes).
 */
export function vintSizeLength(firstByte: number, maxSizeLength: number): number {
  if (!firstByte) return 0;
  let mask = 0x80;
  let numBytes = 1;
  while (!(mask & firstByte)) {
    numBytes++;
    mask >>= 1;
  }
  if (numBytes > maxSizeLength) return 0;
  return numBytes;
}

/**
 * Read an element ID from a stream. Returns [id, bytesRead] or [0, 0] on failure.
 */
export async function readElementId(stream: IOStream): Promise<[number, number]> {
  const firstByteVec = await stream.readBlock(1);
  if (firstByteVec.length !== 1) return [0, 0];

  const firstByte = firstByteVec.get(0);
  const numBytes = vintSizeLength(firstByte, 4);
  if (!numBytes) return [0, 0];

  if (numBytes === 1) {
    return [firstByte, 1];
  }

  const rest = await stream.readBlock(numBytes - 1);
  if (rest.length !== numBytes - 1) return [0, 0];

  // Build the ID as a big-endian unsigned integer
  let id = firstByte;
  for (let i = 0; i < rest.length; i++) {
    id = id * 256 + rest.get(i);
  }
  return [id, numBytes];
}

/**
 * Read a VINT (variable-length integer) from a stream.
 * Returns [sizeLength, value] or [0, 0] on failure.
 * The VINT marker bit is masked off to get the actual data value.
 */
export async function readVint(stream: IOStream): Promise<[number, number]> {
  const firstByteVec = await stream.readBlock(1);
  if (firstByteVec.length !== 1) return [0, 0];

  const firstByte = firstByteVec.get(0);
  const numBytes = vintSizeLength(firstByte, 8);
  if (!numBytes) return [0, 0];

  // Mask off the VINT marker bit
  const mask = (1 << (8 - numBytes)) - 1;
  let value = firstByte & mask;

  if (numBytes > 1) {
    const rest = await stream.readBlock(numBytes - 1);
    if (rest.length !== numBytes - 1) return [0, 0];
    for (let i = 0; i < rest.length; i++) {
      value = value * 256 + rest.get(i);
    }
  }

  return [numBytes, value];
}

/** An EBML element header parsed from a stream. */
export interface EbmlElement {
  id: number;
  dataSize: number;
  /** Total header size (id bytes + size bytes). */
  headSize: number;
  /** Offset where the element header starts in the stream. */
  offset: number;
}

/**
 * Read the next EBML element header from the stream.
 * Returns null on failure.
 */
export async function readElement(stream: IOStream): Promise<EbmlElement | null> {
  const offset = await stream.tell();
  const [id, idLen] = await readElementId(stream);
  if (!id) return null;

  const [sizeLen, dataSize] = await readVint(stream);
  if (!sizeLen) return null;

  return {
    id,
    dataSize,
    headSize: idLen + sizeLen,
    offset,
  };
}

/**
 * Skip an element's data in the stream.
 */
export async function skipElement(stream: IOStream, element: EbmlElement): Promise<void> {
  await stream.seek(element.offset + element.headSize + element.dataSize, Position.Beginning);
}

/**
 * Find a specific element by ID within a range. Skips unmatched elements.
 */
export async function findElement(stream: IOStream, targetId: number, maxOffset: number): Promise<EbmlElement | null> {
  while ((await stream.tell()) < maxOffset) {
    const element = await readElement(stream);
    if (!element) return null;
    if (element.id === targetId) return element;
    await skipElement(stream, element);
  }
  return null;
}

/**
 * Read all child elements within a master element's data range.
 */
export async function readChildElements(stream: IOStream, parentDataOffset: number, parentDataSize: number): Promise<EbmlElement[]> {
  const endOffset = parentDataOffset + parentDataSize;
  const children: EbmlElement[] = [];
  await stream.seek(parentDataOffset, Position.Beginning);
  while ((await stream.tell()) < endOffset) {
    const element = await readElement(stream);
    if (!element) break;
    children.push(element);
    await skipElement(stream, element);
  }
  return children;
}

/**
 * Read the raw data of an element from the stream.
 */
export async function readElementData(stream: IOStream, element: EbmlElement): Promise<ByteVector> {
  await stream.seek(element.offset + element.headSize, Position.Beginning);
  return await stream.readBlock(element.dataSize);
}

/**
 * Read an unsigned integer element value (1-8 bytes, big-endian).
 */
export async function readUintValue(stream: IOStream, element: EbmlElement): Promise<number> {
  const data = await readElementData(stream, element);
  if (data.length === 0) return 0;
  let value = 0;
  for (let i = 0; i < data.length; i++) {
    value = value * 256 + data.get(i);
  }
  return value;
}

/**
 * Read a float element value (4 or 8 bytes, big-endian IEEE 754).
 */
export async function readFloatValue(stream: IOStream, element: EbmlElement): Promise<number> {
  const data = await readElementData(stream, element);
  if (data.length === 4) {
    return data.toFloat32BE(0);
  }
  if (data.length === 8) {
    return data.toFloat64BE(0);
  }
  return 0;
}

/**
 * Read a UTF-8 string element value.
 */
export async function readStringValue(stream: IOStream, element: EbmlElement): Promise<string> {
  const data = await readElementData(stream, element);
  if (data.length === 0) return "";
  // Trim trailing null bytes
  let len = data.length;
  while (len > 0 && data.get(len - 1) === 0) len--;
  return data.mid(0, len).toString(StringType.UTF8);
}

// ---------------------------------------------------------------------------
// EBML Writing Utilities
// ---------------------------------------------------------------------------

/**
 * Concatenate multiple ByteVectors into one.
 */
export function combineByteVectors(parts: ByteVector[]): ByteVector {
  let totalLength = 0;
  for (const part of parts) totalLength += part.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part.data, offset);
    offset += part.length;
  }
  return new ByteVector(result);
}

/**
 * Encode an EBML element ID as bytes (big-endian, already contains marker bits).
 */
export function encodeId(id: number): ByteVector {
  const size = idSize(id);
  const bytes = new Uint8Array(size);
  let v = id;
  for (let i = size - 1; i >= 0; i--) {
    bytes[i] = v & 0xFF;
    v >>>= 8;
  }
  return new ByteVector(bytes);
}

/**
 * Encode a VINT (variable-length integer) for EBML element sizes.
 * The minimum size is used unless minBytes is specified.
 */
export function encodeVint(value: number, minBytes: number = 0): ByteVector {
  // Determine the number of bytes needed
  let numBytes: number;
  if (value < 0x7E && minBytes <= 1) numBytes = 1;         // 2^7 - 2
  else if (value < 0x3FFE && minBytes <= 2) numBytes = 2;  // 2^14 - 2
  else if (value < 0x1FFFFE && minBytes <= 3) numBytes = 3;// 2^21 - 2
  else if (value < 0x0FFFFFFE && minBytes <= 4) numBytes = 4; // 2^28 - 2
  else numBytes = Math.max(minBytes, 5);

  // Clamp to reasonable range
  if (numBytes > 8) numBytes = 8;

  // The marker bit is placed in the most-significant bit position for numBytes
  const markerBit = 1 << (8 - numBytes); // e.g., 0x80 for 1, 0x40 for 2, etc.
  const bytes = new Uint8Array(numBytes);
  let v = value;
  for (let i = numBytes - 1; i >= 0; i--) {
    bytes[i] = v & 0xFF;
    v >>>= 8;
  }
  // Set marker bit in first byte
  bytes[0] |= markerBit;
  return new ByteVector(bytes);
}

/**
 * Render an EBML element: id bytes + vint(size) + data bytes.
 */
export function renderEbmlElement(id: number, data: ByteVector): ByteVector {
  return combineByteVectors([
    encodeId(id),
    encodeVint(data.length),
    data,
  ]);
}

/**
 * Render a UTF-8 string EBML element.
 */
export function renderStringElement(id: number, value: string): ByteVector {
  const data = ByteVector.fromString(value, StringType.UTF8);
  return renderEbmlElement(id, data);
}

/**
 * Render an unsigned integer EBML element (big-endian, minimal byte count).
 */
export function renderUintElement(id: number, value: number): ByteVector {
  if (value === 0) {
    return renderEbmlElement(id, new ByteVector(new Uint8Array([0])));
  }
  let numBytes = 1;
  let v = value;
  // Use Math.floor(v / 256) instead of v >>>= 8 to avoid 32-bit truncation
  // for values larger than 2^32 (e.g. Matroska chapter times in nanoseconds).
  while (v > 0xFF) { numBytes++; v = Math.floor(v / 256); }
  const bytes = new Uint8Array(numBytes);
  v = value;
  for (let i = numBytes - 1; i >= 0; i--) {
    bytes[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return renderEbmlElement(id, new ByteVector(bytes));
}

/**
 * Render a Void EBML element of the given total byte size (including id+size header).
 * Minimum size is 2 bytes (1 byte id + 1 byte vint(0)).
 */
export function renderVoidElement(totalSize: number): ByteVector {
  // Void id = 0xEC (1 byte), then vint(dataSize)
  // We need: 1 (id) + vint_size(dataSize) + dataSize = totalSize
  if (totalSize < 2) return new ByteVector(new Uint8Array(totalSize));
  let dataSize = totalSize - 2; // 1 byte id + 1 byte vint
  if (dataSize >= 0x7E) {
    dataSize = totalSize - 3; // 1 byte id + 2 byte vint
  }
  if (dataSize >= 0x3FFE) {
    dataSize = totalSize - 4;
  }
  const vint = encodeVint(dataSize);
  const header = combineByteVectors([encodeId(EbmlId.VoidElement), vint]);
  const padding = new ByteVector(new Uint8Array(dataSize));
  return combineByteVectors([header, padding]);
}
