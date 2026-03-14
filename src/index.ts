// Core
export { ByteVector, StringType } from './byteVector.js';
export { Tag } from './tag.js';
export { AudioProperties } from './audioProperties.js';
export { File } from './file.js';
export { CombinedTag } from './combinedTag.js';
export { FileRef } from './fileRef.js';

// Simple API
export { readTags, writeTags } from './simpleApi.js';
export type { Tags, TagsToWrite, AudioPropertiesInfo, AudioInput } from './simpleApi.js';

// Toolkit
export { IOStream } from './toolkit/ioStream.js';
export { ByteVectorStream } from './toolkit/byteVectorStream.js';
export { PropertyMap } from './toolkit/propertyMap.js';
export { Variant, VariantType } from './toolkit/variant.js';
export type { VariantMap, VariantList } from './toolkit/variant.js';
export { VersionNumber, runtimeVersion } from './toolkit/versionNumber.js';
export { Position, ReadStyle, StripTags, DuplicateTags } from './toolkit/types.js';
export type { offset_t } from './toolkit/types.js';

// Format detection
export { detectByExtension, detectByContent, defaultFileExtensions } from './formatDetection.js';

// ID3v1
export { ID3v1Tag } from './mpeg/id3v1/id3v1Tag.js';
export { genre as id3v1Genre, genreIndex as id3v1GenreIndex, genreList as id3v1GenreList } from './mpeg/id3v1/id3v1Genres.js';

// ID3v2
export { Id3v2Tag } from './mpeg/id3v2/id3v2Tag.js';
export { Id3v2Header } from './mpeg/id3v2/id3v2Header.js';
export { Id3v2Frame, Id3v2FrameHeader } from './mpeg/id3v2/id3v2Frame.js';
export { Id3v2FrameFactory } from './mpeg/id3v2/id3v2FrameFactory.js';
export { SynchData } from './mpeg/id3v2/id3v2SynchData.js';

// APE
export { ApeTag, ApeItem, ApeFooter, ApeItemType } from './ape/apeTag.js';

// Xiph
export { XiphComment } from './ogg/xiphComment.js';

// FLAC
export { FlacPicture } from './flac/flacPicture.js';

// RIFF
export { RiffInfoTag } from './riff/infoTag.js';

// MPEG
export { MpegFile, MpegTagTypes } from './mpeg/mpegFile.js';
export { MpegHeader, MpegVersion, ChannelMode } from './mpeg/mpegHeader.js';
export { MpegProperties } from './mpeg/mpegProperties.js';
export { XingHeader, XingHeaderType } from './mpeg/xingHeader.js';

// FLAC
export { FlacFile } from './flac/flacFile.js';
export { FlacProperties } from './flac/flacProperties.js';

// MP4
export { Mp4File } from './mp4/mp4File.js';
export { Mp4Tag, Mp4Item, Mp4CoverArt, Mp4CoverArtFormat, Mp4ItemType } from './mp4/mp4Tag.js';
export { Mp4Properties } from './mp4/mp4Properties.js';
export { Mp4Atoms, Mp4Atom } from './mp4/mp4Atoms.js';

// OGG
export { OggVorbisFile } from './ogg/vorbis/vorbisFile.js';
export { VorbisProperties } from './ogg/vorbis/vorbisProperties.js';
export { OggOpusFile } from './ogg/opus/opusFile.js';
export { OpusProperties } from './ogg/opus/opusProperties.js';
export { OggSpeexFile } from './ogg/speex/speexFile.js';
export { SpeexProperties } from './ogg/speex/speexProperties.js';
export { OggFlacFile } from './ogg/flac/oggFlacFile.js';
export { OggFile } from './ogg/oggFile.js';
export { OggPageHeader } from './ogg/oggPageHeader.js';

// RIFF
export { WavFile } from './riff/wav/wavFile.js';
export { WavProperties } from './riff/wav/wavProperties.js';
export { AiffFile } from './riff/aiff/aiffFile.js';
export { AiffProperties } from './riff/aiff/aiffProperties.js';

// MPC
export { MpcFile } from './mpc/mpcFile.js';
export { MpcProperties } from './mpc/mpcProperties.js';

// WavPack
export { WavPackFile } from './wavpack/wavpackFile.js';
export { WavPackProperties } from './wavpack/wavpackProperties.js';

// APE (file format)
export { ApeFile } from './ape/apeFile.js';
export { ApeProperties } from './ape/apeProperties.js';

// TrueAudio
export { TrueAudioFile } from './trueaudio/trueAudioFile.js';
export { TrueAudioProperties } from './trueaudio/trueAudioProperties.js';

// DSF
export { DsfFile } from './dsf/dsfFile.js';
export { DsfProperties } from './dsf/dsfProperties.js';

// DSDIFF
export { DsdiffFile } from './dsdiff/dsdiffFile.js';
export { DsdiffProperties } from './dsdiff/dsdiffProperties.js';
export { DsdiffDiinTag } from './dsdiff/dsdiffDiinTag.js';

// MOD (tracker formats shared tag)
export { ModTag } from './mod/modTag.js';
export { ModFile } from './mod/modFile.js';
export { ModProperties } from './mod/modProperties.js';

// S3M
export { S3mFile } from './s3m/s3mFile.js';
export { S3mProperties } from './s3m/s3mProperties.js';

// XM
export { XmFile } from './xm/xmFile.js';
export { XmProperties } from './xm/xmProperties.js';

// IT
export { ItFile } from './it/itFile.js';
export { ItProperties } from './it/itProperties.js';

// Shorten
export { ShortenFile } from './shorten/shortenFile.js';
export { ShortenProperties } from './shorten/shortenProperties.js';
export { ShortenTag } from './shorten/shortenTag.js';
