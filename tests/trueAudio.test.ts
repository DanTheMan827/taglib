import { describe, it, expect } from 'vitest';
import { TrueAudioFile, TrueAudioTagTypes } from '../src/trueaudio/trueAudioFile.js';
import { ByteVectorStream } from '../src/toolkit/byteVectorStream.js';
import { ReadStyle } from '../src/toolkit/types.js';
import { openTestStream, readTestData } from './testHelper.js';

function openTrueAudioFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): TrueAudioFile {
  const stream = openTestStream(filename);
  return new TrueAudioFile(stream, readProperties, readStyle);
}

describe('TrueAudio', () => {
  it('testReadPropertiesWithoutID3v2', () => {
    const f = openTrueAudioFile('empty.tta');
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3685);
      expect(props.bitrate).toBe(173);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(162496);
      expect(props.ttaVersion).toBe(1);
    }
  });

  it('testReadPropertiesWithTags', () => {
    const f = openTrueAudioFile('tagged.tta');
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.lengthInMilliseconds).toBe(3685);
      expect(props.bitrate).toBe(173);
      expect(props.channels).toBe(2);
      expect(props.sampleRate).toBe(44100);
      expect(props.bitsPerSample).toBe(16);
      expect(props.sampleFrames).toBe(162496);
      expect(props.ttaVersion).toBe(1);
    }
  });

  it('testStripAndProperties', () => {
    const data = readTestData('empty.tta');
    const stream = new ByteVectorStream(data);
    const f = new TrueAudioFile(stream, true, ReadStyle.Average);

    f.id3v2Tag(true)!.title = 'ID3v2';
    f.id3v1Tag(true)!.title = 'ID3v1';
    f.save();

    stream.seek(0);
    const f2 = new TrueAudioFile(stream, true, ReadStyle.Average);
    expect(f2.hasID3v1Tag).toBe(true);
    expect(f2.hasID3v2Tag).toBe(true);
    expect(f2.tag().title).toBe('ID3v2');

    f2.strip(TrueAudioTagTypes.ID3v2);
    f2.save();

    stream.seek(0);
    const f3 = new TrueAudioFile(stream, true, ReadStyle.Average);
    expect(f3.tag().title).toBe('ID3v1');

    f3.strip(TrueAudioTagTypes.ID3v1);
    f3.save();

    stream.seek(0);
    const f4 = new TrueAudioFile(stream, true, ReadStyle.Average);
    expect(f4.tag().title).toBe('');
  });

  it('testRepeatedSave', () => {
    const data = readTestData('empty.tta');
    const stream = new ByteVectorStream(data);
    const f = new TrueAudioFile(stream, true, ReadStyle.Average);

    expect(f.hasID3v2Tag).toBe(false);
    expect(f.hasID3v1Tag).toBe(false);

    f.id3v2Tag(true)!.title = '01234 56789 ABCDE FGHIJ';
    f.save();

    f.id3v2Tag()!.title = '0';
    f.save();

    f.id3v1Tag(true)!.title = '01234 56789 ABCDE FGHIJ';
    f.id3v2Tag()!.title = '01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789';
    f.save();

    stream.seek(0);
    const f2 = new TrueAudioFile(stream, true, ReadStyle.Average);
    expect(f2.hasID3v2Tag).toBe(true);
    expect(f2.hasID3v1Tag).toBe(true);
  });
});
