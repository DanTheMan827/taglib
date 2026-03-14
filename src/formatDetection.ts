import { ByteVector, StringType } from './byteVector.js';
import { IOStream } from './toolkit/ioStream.js';
import { Position } from './toolkit/types.js';

export function detectByExtension(name: string): string | null {
  const ext = name.split('.').pop()?.toUpperCase() ?? '';
  switch (ext) {
    case 'MP3': case 'MP2': case 'AAC': return 'mpeg';
    case 'OGG': case 'OGA': return 'ogg';  // need content check to determine sub-format
    case 'OPUS': return 'ogg-opus';
    case 'SPX': return 'ogg-speex';
    case 'FLAC': return 'flac';
    case 'M4A': case 'M4B': case 'M4P': case 'M4R': case 'M4V': case 'MP4': case '3G2': case 'AAX': return 'mp4';
    case 'WMA': case 'ASF': return 'asf';
    case 'AIF': case 'AIFF': case 'AFC': case 'AIFC': return 'aiff';
    case 'WAV': return 'wav';
    case 'MPC': return 'mpc';
    case 'WV': return 'wavpack';
    case 'APE': return 'ape-file';
    case 'TTA': return 'trueaudio';
    case 'DSF': return 'dsf';
    case 'DFF': case 'DSDIFF': return 'dsdiff';
    case 'MOD': return 'mod';
    case 'S3M': return 's3m';
    case 'IT': return 'it';
    case 'XM': return 'xm';
    case 'SHN': return 'shorten';
    case 'MKA': case 'MKV': case 'WEBM': return 'matroska';
    default: return null;
  }
}

export function detectByContent(stream: IOStream): string | null {
  stream.seek(0, Position.Beginning);
  const header = stream.readBlock(36);

  if (header.length < 4) return null;

  // FLAC: "fLaC"
  if (header.containsAt(ByteVector.fromString('fLaC', StringType.Latin1), 0)) return 'flac';

  // OGG: "OggS" - need to check sub-format
  if (header.containsAt(ByteVector.fromString('OggS', StringType.Latin1), 0)) {
    stream.seek(0, Position.Beginning);
    const buf = stream.readBlock(128);
    const opusId = ByteVector.fromString('OpusHead', StringType.Latin1);
    const speexId = ByteVector.fromString('Speex   ', StringType.Latin1);
    const flacId = ByteVector.fromByteArray(new Uint8Array([0x7F, 0x46, 0x4C, 0x41, 0x43])); // \x7FFLAC
    const vorbisId = ByteVector.fromByteArray(new Uint8Array([0x01, 0x76, 0x6F, 0x72, 0x62, 0x69, 0x73])); // \x01vorbis

    if (buf.find(opusId) >= 0) return 'ogg-opus';
    if (buf.find(speexId) >= 0) return 'ogg-speex';
    if (buf.find(flacId) >= 0) return 'ogg-flac';
    if (buf.find(vorbisId) >= 0) return 'ogg-vorbis';
    return 'ogg-vorbis'; // default
  }

  // MP4: "ftyp" at offset 4
  if (header.length >= 8 && header.mid(4, 4).toString(StringType.Latin1) === 'ftyp') return 'mp4';

  // RIFF/WAV: "RIFF....WAVE"
  if (header.length >= 12 && header.mid(0, 4).toString(StringType.Latin1) === 'RIFF' && header.mid(8, 4).toString(StringType.Latin1) === 'WAVE') return 'wav';

  // AIFF: "FORM....AIFF" or "FORM....AIFC"
  if (header.length >= 12 && header.mid(0, 4).toString(StringType.Latin1) === 'FORM') {
    const fmt = header.mid(8, 4).toString(StringType.Latin1);
    if (fmt === 'AIFF' || fmt === 'AIFC') return 'aiff';
  }

  // MPC: "MPCK" (SV8) or "MP+" (SV7)
  if (header.containsAt(ByteVector.fromString('MPCK', StringType.Latin1), 0) ||
      header.containsAt(ByteVector.fromString('MP+', StringType.Latin1), 0)) return 'mpc';

  // WavPack: "wvpk"
  if (header.containsAt(ByteVector.fromString('wvpk', StringType.Latin1), 0)) return 'wavpack';

  // APE (Monkey's Audio): "MAC "
  if (header.containsAt(ByteVector.fromString('MAC ', StringType.Latin1), 0)) return 'ape-file';

  // TrueAudio: "TTA"
  if (header.length >= 4 && header.mid(0, 3).toString(StringType.Latin1) === 'TTA') return 'trueaudio';

  // DSF: "DSD "
  if (header.containsAt(ByteVector.fromString('DSD ', StringType.Latin1), 0)) return 'dsf';

  // DSDIFF: "FRM8" at 0 and "DSD " at 12
  if (header.length >= 16 &&
      header.containsAt(ByteVector.fromString('FRM8', StringType.Latin1), 0) &&
      header.containsAt(ByteVector.fromString('DSD ', StringType.Latin1), 12)) return 'dsdiff';

  // ID3v2 followed by unknown - could be MPEG, TrueAudio, or others
  if (header.length >= 3 && header.mid(0, 3).toString(StringType.Latin1) === 'ID3') {
    // Try to peek past the ID3v2 header to identify the actual format
    if (header.length >= 10) {
      const id3Size = ((header.get(6) & 0x7f) << 21) | ((header.get(7) & 0x7f) << 14) |
                      ((header.get(8) & 0x7f) << 7) | (header.get(9) & 0x7f);
      const id3TotalSize = 10 + id3Size;
      stream.seek(id3TotalSize, Position.Beginning);
      const afterId3 = stream.readBlock(4);
      if (afterId3.length >= 3 && afterId3.mid(0, 3).toString(StringType.Latin1) === 'TTA') return 'trueaudio';
      if (afterId3.length >= 4 && afterId3.mid(0, 4).toString(StringType.Latin1) === 'MAC ') return 'ape-file';
    }
    return 'mpeg'; // default for ID3v2 prefix
  }

  // MPEG frame sync (MUST BE LAST - can false-positive on other formats)
  if (header.length >= 2 && header.get(0) === 0xFF && (header.get(1) & 0xE0) === 0xE0) return 'mpeg';

  return null;
}

/** OGG sub-format detection for extension-based "ogg" */
export function detectOggSubFormat(stream: IOStream): string {
  stream.seek(0, Position.Beginning);
  const buf = stream.readBlock(128);
  const opusId = ByteVector.fromString('OpusHead', StringType.Latin1);
  const speexId = ByteVector.fromString('Speex   ', StringType.Latin1);
  const flacId = ByteVector.fromByteArray(new Uint8Array([0x7F, 0x46, 0x4C, 0x41, 0x43]));

  if (buf.find(opusId) >= 0) return 'ogg-opus';
  if (buf.find(speexId) >= 0) return 'ogg-speex';
  if (buf.find(flacId) >= 0) return 'ogg-flac';
  return 'ogg-vorbis';
}

export function defaultFileExtensions(): string[] {
  return [
    'mp3', 'mp2', 'aac', 'ogg', 'oga', 'opus', 'spx', 'flac',
    'm4a', 'm4b', 'm4p', 'm4r', 'm4v', 'mp4', '3g2', 'aax',
    'wma', 'asf', 'aif', 'aiff', 'afc', 'aifc', 'wav',
    'mpc', 'wv', 'ape', 'tta', 'dsf', 'dff', 'dsdiff',
    'mod', 's3m', 'it', 'xm', 'shn', 'mka', 'mkv', 'webm',
  ];
}
