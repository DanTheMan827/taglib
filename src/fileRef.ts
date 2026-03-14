import { File } from './file.js';
import { Tag } from './tag.js';
import { AudioProperties } from './audioProperties.js';
import { IOStream } from './toolkit/ioStream.js';
import { ByteVectorStream } from './toolkit/byteVectorStream.js';
import { ByteVector } from './byteVector.js';
import { PropertyMap } from './toolkit/propertyMap.js';
import { ReadStyle } from './toolkit/types.js';
import type { VariantMap } from './toolkit/variant.js';
import { detectByExtension, detectByContent, detectOggSubFormat, defaultFileExtensions } from './formatDetection.js';

export class FileRef {
  private _file: File | null = null;

  private constructor(file: File | null) {
    this._file = file;
  }

  static async open(stream: IOStream, readProperties: boolean = true, readStyle: ReadStyle = ReadStyle.Average): Promise<FileRef> {
    const file = await FileRef.createFile(stream, readProperties, readStyle);
    return new FileRef(file);
  }

  static async fromByteArray(data: Uint8Array, filename: string = '', readProperties: boolean = true, readStyle: ReadStyle = ReadStyle.Average): Promise<FileRef> {
    const bv = ByteVector.fromByteArray(data);
    const stream = filename ? new NamedByteVectorStream(bv, filename) : new ByteVectorStream(bv);
    const file = await FileRef.createFile(stream, readProperties, readStyle);
    return new FileRef(file);
  }

  static async fromBlob(blob: Blob, filename?: string, readProperties?: boolean, readStyle?: ReadStyle): Promise<FileRef> {
    const buffer = await blob.arrayBuffer();
    const data = new Uint8Array(buffer);
    const name = filename ?? (blob instanceof File ? blob.name : '');
    return FileRef.fromByteArray(data, name, readProperties, readStyle);
  }

  tag(): Tag | null { return this._file?.tag() ?? null; }
  audioProperties(): AudioProperties | null { return this._file?.audioProperties() ?? null; }
  file(): File | null { return this._file; }
  get isNull(): boolean { return !this._file; }
  get isValid(): boolean { return this._file?.isValid ?? false; }

  save(): boolean { return this._file?.save() ?? false; }

  properties(): PropertyMap { return this._file?.properties() ?? new PropertyMap(); }
  setProperties(props: PropertyMap): PropertyMap { return this._file?.setProperties(props) ?? new PropertyMap(); }
  removeUnsupportedProperties(props: string[]): void { this._file?.removeUnsupportedProperties(props); }
  complexPropertyKeys(): string[] { return this._file?.complexPropertyKeys() ?? []; }
  complexProperties(key: string): VariantMap[] { return this._file?.complexProperties(key) ?? []; }
  setComplexProperties(key: string, value: VariantMap[]): boolean { return this._file?.setComplexProperties(key, value) ?? false; }

  static defaultFileExtensions(): string[] { return defaultFileExtensions(); }

  private static async createFile(stream: IOStream, readProperties: boolean, readStyle: ReadStyle): Promise<File | null> {
    let format = detectByExtension(stream.name());

    // For generic 'ogg' extension, detect sub-format from content
    if (format === 'ogg') {
      format = detectOggSubFormat(stream);
    }

    if (!format) {
      format = detectByContent(stream);
    }

    if (!format) return null;

    return FileRef.instantiateFormat(format, stream, readProperties, readStyle);
  }

  private static async instantiateFormat(format: string, stream: IOStream, readProperties: boolean, readStyle: ReadStyle): Promise<File | null> {
    try {
      switch (format) {
        case 'mpeg': {
          const { MpegFile } = await import('./mpeg/mpegFile.js');
          return new MpegFile(stream, readProperties, readStyle);
        }
        case 'flac': {
          const { FlacFile } = await import('./flac/flacFile.js');
          return new FlacFile(stream, readProperties, readStyle);
        }
        case 'mp4': {
          const { Mp4File } = await import('./mp4/mp4File.js');
          return new Mp4File(stream, readProperties, readStyle);
        }
        case 'ogg-vorbis': {
          const { OggVorbisFile } = await import('./ogg/vorbis/vorbisFile.js');
          return new OggVorbisFile(stream, readProperties, readStyle);
        }
        case 'ogg-opus': {
          const { OggOpusFile } = await import('./ogg/opus/opusFile.js');
          return new OggOpusFile(stream, readProperties, readStyle);
        }
        case 'ogg-speex': {
          const { OggSpeexFile } = await import('./ogg/speex/speexFile.js');
          return new OggSpeexFile(stream, readProperties, readStyle);
        }
        case 'ogg-flac': {
          const { OggFlacFile } = await import('./ogg/flac/oggFlacFile.js');
          return new OggFlacFile(stream, readProperties, readStyle);
        }
        case 'wav': {
          const { WavFile } = await import('./riff/wav/wavFile.js');
          return new WavFile(stream, readProperties, readStyle);
        }
        case 'aiff': {
          const { AiffFile } = await import('./riff/aiff/aiffFile.js');
          return new AiffFile(stream, readProperties, readStyle);
        }
        case 'mpc': {
          const { MpcFile } = await import('./mpc/mpcFile.js');
          return new MpcFile(stream, readProperties, readStyle);
        }
        case 'wavpack': {
          const { WavPackFile } = await import('./wavpack/wavpackFile.js');
          return new WavPackFile(stream, readProperties, readStyle);
        }
        case 'ape-file': {
          const { ApeFile } = await import('./ape/apeFile.js');
          return new ApeFile(stream, readProperties, readStyle);
        }
        case 'trueaudio': {
          const { TrueAudioFile } = await import('./trueaudio/trueAudioFile.js');
          return new TrueAudioFile(stream, readProperties, readStyle);
        }
        case 'dsf': {
          const { DsfFile } = await import('./dsf/dsfFile.js');
          return new DsfFile(stream, readProperties, readStyle);
        }
        case 'dsdiff': {
          const { DsdiffFile } = await import('./dsdiff/dsdiffFile.js');
          return new DsdiffFile(stream, readProperties, readStyle);
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}

/** Helper: ByteVectorStream with a custom name for extension-based detection */
class NamedByteVectorStream extends ByteVectorStream {
  private _name: string;
  constructor(data: ByteVector, name: string) {
    super(data);
    this._name = name;
  }
  override name(): string {
    return this._name;
  }
}
