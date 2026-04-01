/** @file ASF / WMA file implementation including internal object parsing hierarchy. */

import { ByteVector, StringType } from "../byteVector.js";
import { File } from "../file.js";
import { Position, ReadStyle } from "../toolkit/types.js";
import type { IOStream } from "../toolkit/ioStream.js";
import { PropertyMap } from "../toolkit/propertyMap.js";
import type { VariantMap } from "../toolkit/variant.js";
import { AsfTag } from "./asfTag.js";
import { AsfProperties } from "./asfProperties.js";
import { AsfAttribute } from "./asfAttribute.js";
import {
  headerGuid,
  filePropertiesGuid,
  streamPropertiesGuid,
  contentDescriptionGuid,
  extendedContentDescriptionGuid,
  headerExtensionGuid,
  metadataGuid,
  metadataLibraryGuid,
  codecListGuid,
  contentEncryptionGuid,
  extendedContentEncryptionGuid,
  advancedContentEncryptionGuid,
  readWORD,
  readDWORD,
  readQWORD,
  readString,
  renderString,
} from "./asfUtils.js";

// ---------------------------------------------------------------------------
// Internal object hierarchy for ASF parsing / saving
// ---------------------------------------------------------------------------

/**
 * Common interface shared by all ASF object types that appear inside the
 * Header Object.  Each object knows how to parse itself from a file stream
 * and render itself back to bytes.
 */
interface BaseObject {
  guid(): ByteVector;
  parse(file: AsfFile, size: bigint): Promise<void>;
  render(file: AsfFile): ByteVector;
  data: ByteVector;
}

/**
 * Render `obj`'s GUID, 64-bit size, and payload into a single `ByteVector`.
 *
 * @param obj - The object to render.
 * @returns Serialized header-object bytes (24-byte prefix + data).
 */
function baseRender(obj: BaseObject): ByteVector {
  const result = ByteVector.fromByteVector(obj.guid());
  result.append(ByteVector.fromLongLong(BigInt(obj.data.length + 24), false));
  result.append(obj.data);
  return result;
}

/**
 * Read the raw payload of an ASF object (everything after its 24-byte prefix)
 * into `obj.data`.
 *
 * @param obj - The object whose `data` field will be populated.
 * @param file - The file being parsed (positioned just after the 24-byte prefix).
 * @param size - Total size of the object including the 24-byte prefix.
 */
async function baseParse(obj: BaseObject, file: AsfFile, size: bigint): Promise<void> {
  obj.data = new ByteVector();
  const s = Number(size);
  if (s > 24 && s <= (await file.fileLength())) {
    obj.data = await file.readBlock(s - 24);
  }
}

/** Stores an unrecognised ASF object opaquely so it can be round-tripped. */
class UnknownObject implements BaseObject {
  data = new ByteVector();
  private _guid: ByteVector;
  constructor(guid: ByteVector) { this._guid = guid; }
  guid(): ByteVector { return this._guid; }
  async parse(file: AsfFile, size: bigint): Promise<void> { await baseParse(this, file, size); }
  render(): ByteVector { return baseRender(this); }
}

/** Parses the File Properties Object to extract stream duration and preroll. */
class FilePropertiesObject implements BaseObject {
  data = new ByteVector();
  guid(): ByteVector { return filePropertiesGuid; }
  async parse(file: AsfFile, size: bigint): Promise<void> {
    await baseParse(this, file, size);
    if (this.data.length < 64) return;
    const duration = this.data.toLongLong(40, false);
    const preroll = this.data.toLongLong(56, false);
    file._properties!.setLengthInMilliseconds(
      Math.trunc(Number(duration) / 10000.0 - Number(preroll) + 0.5),
    );
  }
  render(): ByteVector { return baseRender(this); }
}

/** Parses the Stream Properties Object to extract codec and audio format details. */
class StreamPropertiesObject implements BaseObject {
  data = new ByteVector();
  guid(): ByteVector { return streamPropertiesGuid; }
  async parse(file: AsfFile, size: bigint): Promise<void> {
    await baseParse(this, file, size);
    if (this.data.length < 70) return;
    file._properties!.setCodec(this.data.toUShort(54, false));
    file._properties!.setChannels(this.data.toUShort(56, false));
    file._properties!.setSampleRate(this.data.toUInt(58, false));
    file._properties!.setBitrate(Math.trunc(this.data.toUInt(62, false) * 8.0 / 1000.0 + 0.5));
    file._properties!.setBitsPerSample(this.data.toUShort(68, false));
  }
  render(): ByteVector { return baseRender(this); }
}

/**
 * Parses/renders the Content Description Object (title, artist, copyright,
 * comment, rating).
 */
class ContentDescriptionObject implements BaseObject {
  data = new ByteVector();
  guid(): ByteVector { return contentDescriptionGuid; }
  async parse(file: AsfFile): Promise<void> {
    const titleLength = (await readWORD(file)).value;
    const artistLength = (await readWORD(file)).value;
    const copyrightLength = (await readWORD(file)).value;
    const commentLength = (await readWORD(file)).value;
    const ratingLength = (await readWORD(file)).value;
    file._tag!.title = await readString(file, titleLength);
    file._tag!.artist = await readString(file, artistLength);
    file._tag!.copyright = await readString(file, copyrightLength);
    file._tag!.comment = await readString(file, commentLength);
    file._tag!.rating = await readString(file, ratingLength);
  }
  render(file: AsfFile): ByteVector {
    const v1 = renderString(file._tag!.title);
    const v2 = renderString(file._tag!.artist);
    const v3 = renderString(file._tag!.copyright);
    const v4 = renderString(file._tag!.comment);
    const v5 = renderString(file._tag!.rating);
    this.data = new ByteVector();
    this.data.append(ByteVector.fromUShort(v1.length, false));
    this.data.append(ByteVector.fromUShort(v2.length, false));
    this.data.append(ByteVector.fromUShort(v3.length, false));
    this.data.append(ByteVector.fromUShort(v4.length, false));
    this.data.append(ByteVector.fromUShort(v5.length, false));
    this.data.append(v1);
    this.data.append(v2);
    this.data.append(v3);
    this.data.append(v4);
    this.data.append(v5);
    return baseRender(this);
  }
}

/** Parses/renders the Extended Content Description Object (arbitrary attribute list). */
class ExtendedContentDescriptionObject implements BaseObject {
  data = new ByteVector();
  attributeData: ByteVector[] = [];
  guid(): ByteVector { return extendedContentDescriptionGuid; }
  async parse(file: AsfFile): Promise<void> {
    let count = (await readWORD(file)).value;
    while (count-- > 0) {
      const attribute = new AsfAttribute();
      const name = await attribute.parse(file);
      file._tag!.addAttribute(name, attribute);
    }
  }
  render(): ByteVector {
    this.data = new ByteVector();
    this.data.append(ByteVector.fromUShort(this.attributeData.length, false));
    for (const ad of this.attributeData) this.data.append(ad);
    return baseRender(this);
  }
}

/** Parses/renders the Metadata Object (stream-specific attributes, no language index). */
class MetadataObject implements BaseObject {
  data = new ByteVector();
  attributeData: ByteVector[] = [];
  guid(): ByteVector { return metadataGuid; }
  async parse(file: AsfFile): Promise<void> {
    let count = (await readWORD(file)).value;
    while (count-- > 0) {
      const attribute = new AsfAttribute();
      const name = await attribute.parse(file, 1);
      file._tag!.addAttribute(name, attribute);
    }
  }
  render(): ByteVector {
    this.data = new ByteVector();
    this.data.append(ByteVector.fromUShort(this.attributeData.length, false));
    for (const ad of this.attributeData) this.data.append(ad);
    return baseRender(this);
  }
}

/**
 * Parses/renders the Metadata Library Object (stream- and language-specific
 * attributes, supports large values > 64 KB).
 */
class MetadataLibraryObject implements BaseObject {
  data = new ByteVector();
  attributeData: ByteVector[] = [];
  guid(): ByteVector { return metadataLibraryGuid; }
  async parse(file: AsfFile): Promise<void> {
    let count = (await readWORD(file)).value;
    while (count-- > 0) {
      const attribute = new AsfAttribute();
      const name = await attribute.parse(file, 2);
      file._tag!.addAttribute(name, attribute);
    }
  }
  render(): ByteVector {
    this.data = new ByteVector();
    this.data.append(ByteVector.fromUShort(this.attributeData.length, false));
    for (const ad of this.attributeData) this.data.append(ad);
    return baseRender(this);
  }
}

/**
 * Parses/renders the Header Extension Object, which acts as a nested container
 * for the Metadata and Metadata Library objects.
 */
class HeaderExtensionObject implements BaseObject {
  data = new ByteVector();
  objects: BaseObject[] = [];
  guid(): ByteVector { return headerExtensionGuid; }
  async parse(file: AsfFile): Promise<void> {
    await file.seek(18, Position.Current);
    const dataSize = (await readDWORD(file)).value;
    let dataPos = 0;
    while (dataPos < dataSize) {
      const uid = await file.readBlock(16);
      if (uid.length !== 16) {
        file.setFileInvalid();
        break;
      }
      const sizeResult = await readQWORD(file);
      if (!sizeResult.ok || sizeResult.value < 0n || sizeResult.value > BigInt(dataSize - dataPos)) {
        file.setFileInvalid();
        break;
      }
      let obj: BaseObject;
      if (uid.equals(metadataGuid)) {
        const mo = new MetadataObject();
        file._metadataObject = mo;
        obj = mo;
      } else if (uid.equals(metadataLibraryGuid)) {
        const mlo = new MetadataLibraryObject();
        file._metadataLibraryObject = mlo;
        obj = mlo;
      } else {
        obj = new UnknownObject(uid);
      }
      await obj.parse(file, sizeResult.value);
      this.objects.push(obj);
      dataPos += Number(sizeResult.value);
    }
  }
  render(file: AsfFile): ByteVector {
    this.data = new ByteVector();
    for (const obj of this.objects) {
      this.data.append(obj.render(file));
    }
    // Header extension prefix: reserved GUID (16 bytes) + reserved field (2 bytes) + data size (4 bytes)
    const prefix = ByteVector.fromByteArray(new Uint8Array([
      0x11, 0xD2, 0xD3, 0xAB, 0xBA, 0xA9, 0xCF, 0x11,
      0x8E, 0xE6, 0x00, 0xC0, 0x0C, 0x20, 0x53, 0x65,
      0x06, 0x00,
    ]));
    const dataSizeBytes = ByteVector.fromUInt(this.data.length, false);
    const fullData = ByteVector.fromByteVector(prefix);
    fullData.append(dataSizeBytes);
    fullData.append(this.data);
    this.data = fullData;
    return baseRender(this);
  }
}

/** Parses the Codec List Object to extract the human-readable codec name and description. */
class CodecListObject implements BaseObject {
  data = new ByteVector();
  guid(): ByteVector { return codecListGuid; }
  async parse(file: AsfFile, size: bigint): Promise<void> {
    await baseParse(this, file, size);
    if (this.data.length <= 20) return;

    let pos = 16;
    const count = this.data.toUInt(pos, false);
    pos += 4;

    for (let i = 0; i < count; i++) {
      if (pos >= this.data.length) break;

      const type = this.data.toUShort(pos, false);
      pos += 2;

      const nameLength = this.data.toUShort(pos, false);
      pos += 2;
      const namePos = pos;
      pos += nameLength * 2;

      const descLength = this.data.toUShort(pos, false);
      pos += 2;
      const descPos = pos;
      pos += descLength * 2;

      const infoLength = this.data.toUShort(pos, false);
      pos += 2 + infoLength * 2;

      // 0x0002 = Audio codec type
      if (type === 0x0002) {
        const name = this.data.mid(namePos, nameLength * 2).toString(StringType.UTF16LE).replace(/\0+$/, "").trim();
        file._properties!.setCodecName(name);

        const desc = this.data.mid(descPos, descLength * 2).toString(StringType.UTF16LE).replace(/\0+$/, "").trim();
        file._properties!.setCodecDescription(desc);
        break;
      }
    }
  }
  render(): ByteVector { return baseRender(this); }
}

// ---------------------------------------------------------------------------
// AsfFile
// ---------------------------------------------------------------------------

/**
 * Reads and writes ASF (Advanced Systems Format) files, including WMA and WMV.
 *
 * The file is parsed on construction; call {@link save} to write metadata
 * changes back to the stream.
 */
export class AsfFile extends File {
  /** @internal */ _tag: AsfTag | null = null;
  /** @internal */ _properties: AsfProperties | null = null;
  /** @internal Total size of the ASF Header Object in bytes. */
  /** @internal */ _headerSize = 0n;

  /** List of all top-level header sub-objects in parse order. */
  private _objects: BaseObject[] = [];
  /** Parsed Content Description Object, or `null` if absent. */
  private _contentDescriptionObject: ContentDescriptionObject | null = null;
  /** Parsed Extended Content Description Object, or `null` if absent. */
  private _extendedContentDescriptionObject: ExtendedContentDescriptionObject | null = null;
  /** Parsed Header Extension Object, or `null` if absent. */
  private _headerExtensionObject: HeaderExtensionObject | null = null;
  /** @internal */ _metadataObject: MetadataObject | null = null;
  /** @internal */ _metadataLibraryObject: MetadataLibraryObject | null = null;

  /** @internal - used by inner parser objects to invalidate */
  setFileInvalid(): void { this._valid = false; }

  /**
   * @param stream - The stream backing this file.
   */
  private constructor(stream: IOStream) {
    super(stream);
  }

  /**
   * Open and parse an ASF file from `stream`.
   *
   * @param stream - Readable (and optionally writable) stream.
   * @param _readProperties - Whether to read audio properties (currently always read).
   * @param _readStyle - Level of detail for audio properties parsing.
   * @returns A resolved promise containing the populated {@link AsfFile}.
   */
  static async open(
    stream: IOStream,
    _readProperties = true,
    _readStyle: ReadStyle = ReadStyle.Average,
  ): Promise<AsfFile> {
    const file = new AsfFile(stream);
    if (file.isOpen) {
      await file.read();
    }
    return file;
  }

  // -- File interface --

  /** Returns the ASF tag, or `null` if the file has not been parsed yet. */
  tag(): AsfTag | null { return this._tag; }
  /** Returns the audio properties, or `null` if the file has not been parsed yet. */
  audioProperties(): AsfProperties | null { return this._properties; }

  async save(): Promise<boolean> {
    if (this.readOnly) return false;
    if (!this.isValid) return false;
    if (!this._tag) return false;

    // Ensure all necessary objects exist
    if (!this._contentDescriptionObject) {
      this._contentDescriptionObject = new ContentDescriptionObject();
      this._objects.push(this._contentDescriptionObject);
    }
    if (!this._extendedContentDescriptionObject) {
      this._extendedContentDescriptionObject = new ExtendedContentDescriptionObject();
      this._objects.push(this._extendedContentDescriptionObject);
    }
    if (!this._headerExtensionObject) {
      this._headerExtensionObject = new HeaderExtensionObject();
      this._objects.push(this._headerExtensionObject);
    }
    if (!this._metadataObject) {
      this._metadataObject = new MetadataObject();
      this._headerExtensionObject.objects.push(this._metadataObject);
    }
    if (!this._metadataLibraryObject) {
      this._metadataLibraryObject = new MetadataLibraryObject();
      this._headerExtensionObject.objects.push(this._metadataLibraryObject);
    }

    // Distribute attributes across the appropriate objects.
    // Sort alphabetically to match C++ TagLib::Map<String, AttributeList> iteration order.
    this._extendedContentDescriptionObject.attributeData = [];
    this._metadataObject.attributeData = [];
    this._metadataLibraryObject.attributeData = [];

    const sortedAttrs = [...this._tag.attributeListMap.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [name, attributes] of sortedAttrs) {
      let inExtended = false;
      let inMetadata = false;

      for (const attribute of attributes) {
        const largeValue = attribute.dataSize > 65535;
        const isGuid = attribute.type === 6; // GuidType

        if (!inExtended && !isGuid && !largeValue && attribute.language === 0 && attribute.stream === 0) {
          this._extendedContentDescriptionObject.attributeData.push(attribute.render(name));
          inExtended = true;
        } else if (!inMetadata && !isGuid && !largeValue && attribute.language === 0 && attribute.stream !== 0) {
          this._metadataObject.attributeData.push(attribute.render(name, 1));
          inMetadata = true;
        } else {
          this._metadataLibraryObject.attributeData.push(attribute.render(name, 2));
        }
      }
    }

    // Render all objects
    const data = new ByteVector();
    for (const obj of this._objects) {
      data.append(obj.render(this));
    }

    // Write header
    await this.seek(16);
    await this.writeBlock(ByteVector.fromLongLong(BigInt(data.length + 30), false));
    await this.writeBlock(ByteVector.fromUInt(this._objects.length, false));
    await this.writeBlock(ByteVector.fromByteArray(new Uint8Array([0x01, 0x02])));

    await this.insert(data, 30, Number(this._headerSize) - 30);
    this._headerSize = BigInt(data.length + 30);

    return true;
  }

  // -- Static --

  /**
   * Quickly determine whether `stream` starts with the ASF Header GUID.
   *
   * @param stream - The stream to probe (will be seeked to position 0).
   * @returns `true` if the stream begins with the ASF Header Object GUID.
   */
  static async isSupported(stream: IOStream): Promise<boolean> {
    await stream.seek(0);
    const id = await stream.readBlock(16);
    return id.equals(headerGuid);
  }

  // -- PropertyMap delegation --

  /** @inheritdoc */
  override properties(): PropertyMap { return this._tag?.properties() ?? new PropertyMap(); }
  /** @inheritdoc */
  override setProperties(properties: PropertyMap): PropertyMap { return this._tag?.setProperties(properties) ?? properties; }
  /** @inheritdoc */
  override removeUnsupportedProperties(properties: string[]): void { this._tag?.removeUnsupportedProperties(properties); }
  /** @inheritdoc */
  override complexPropertyKeys(): string[] { return this._tag?.complexPropertyKeys() ?? []; }
  /** @inheritdoc */
  override complexProperties(key: string): VariantMap[] { return this._tag?.complexProperties(key) ?? []; }
  /** @inheritdoc */
  override setComplexProperties(key: string, value: VariantMap[]): boolean { return this._tag?.setComplexProperties(key, value) ?? false; }

  // -- Internal --

  /** Parse the ASF Header Object and populate tag / properties. */
  private async read(): Promise<void> {
    if (!this.isValid) return;

    if (!(await this.readBlock(16)).equals(headerGuid)) {
      this._valid = false;
      return;
    }

    this._tag = new AsfTag();
    this._properties = new AsfProperties();

    const headerSizeResult = await readQWORD(this);
    if (!headerSizeResult.ok) {
      this._valid = false;
      return;
    }
    this._headerSize = headerSizeResult.value;

    const numObjectsResult = await readDWORD(this);
    if (!numObjectsResult.ok) {
      this._valid = false;
      return;
    }
    const numObjects = numObjectsResult.value;
    await this.seek(2, Position.Current);

    let filePropertiesFound = false;
    let streamPropertiesFound = false;

    for (let i = 0; i < numObjects; i++) {
      const guid = await this.readBlock(16);
      if (guid.length !== 16) {
        this._valid = false;
        break;
      }
      const sizeResult = await readQWORD(this);
      if (!sizeResult.ok) {
        this._valid = false;
        break;
      }
      const size = sizeResult.value;

      let obj: BaseObject;
      if (guid.equals(filePropertiesGuid)) {
        filePropertiesFound = true;
        obj = new FilePropertiesObject();
      } else if (guid.equals(streamPropertiesGuid)) {
        streamPropertiesFound = true;
        obj = new StreamPropertiesObject();
      } else if (guid.equals(contentDescriptionGuid)) {
        this._contentDescriptionObject = new ContentDescriptionObject();
        obj = this._contentDescriptionObject;
      } else if (guid.equals(extendedContentDescriptionGuid)) {
        this._extendedContentDescriptionObject = new ExtendedContentDescriptionObject();
        obj = this._extendedContentDescriptionObject;
      } else if (guid.equals(headerExtensionGuid)) {
        this._headerExtensionObject = new HeaderExtensionObject();
        obj = this._headerExtensionObject;
      } else if (guid.equals(codecListGuid)) {
        obj = new CodecListObject();
      } else {
        if (guid.equals(contentEncryptionGuid) ||
            guid.equals(extendedContentEncryptionGuid) ||
            guid.equals(advancedContentEncryptionGuid)) {
          this._properties.setEncrypted(true);
        }
        obj = new UnknownObject(guid);
      }

      await obj.parse(this, size);
      this._objects.push(obj);
    }

    if (!filePropertiesFound || !streamPropertiesFound) {
      this._valid = false;
    }
  }
}
