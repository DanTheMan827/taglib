import { describe, it, expect } from 'vitest';
import { OggVorbisFile } from '../src/ogg/vorbis/vorbisFile.js';
import { OggOpusFile } from '../src/ogg/opus/opusFile.js';
import { OggSpeexFile } from '../src/ogg/speex/speexFile.js';
import { ByteVectorStream } from '../src/toolkit/byteVectorStream.js';
import { ReadStyle } from '../src/toolkit/types.js';
import { openTestStream, readTestData } from './testHelper.js';

describe('OGG Vorbis', () => {
  it('should read empty ogg file', () => {
    const stream = openTestStream('empty.ogg');
    const f = new OggVorbisFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    expect(tag).not.toBeNull();
  });

  it('should read test ogg file', () => {
    const stream = openTestStream('test.ogg');
    const f = new OggVorbisFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBeGreaterThan(0);
      expect(props.channels).toBeGreaterThan(0);
    }
  });

  it('should read lowercase fields ogg', () => {
    const stream = openTestStream('lowercase-fields.ogg');
    const f = new OggVorbisFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should read empty_vorbis.oga', () => {
    const stream = openTestStream('empty_vorbis.oga');
    const f = new OggVorbisFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it.skip('should save and re-read', () => {
    const data = readTestData('empty.ogg');
    const stream = new ByteVectorStream(data);
    const f = new OggVorbisFile(stream, true, ReadStyle.Average);
    
    if (f.isValid) {
      const tag = f.tag();
      if (tag) {
        tag.title = 'Ogg Test';
        tag.artist = 'Test Artist';
        f.save();
      }

      stream.seek(0);
      const f2 = new OggVorbisFile(stream, true, ReadStyle.Average);
      const tag2 = f2.tag();
      if (tag2) {
        expect(tag2.title).toBe('Ogg Test');
        expect(tag2.artist).toBe('Test Artist');
      }
    }
  });
});

describe('OGG Opus', () => {
  it('should read opus file', () => {
    const stream = openTestStream('correctness_gain_silent_output.opus');
    const f = new OggOpusFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBe(48000); // Opus always 48kHz
      expect(props.channels).toBeGreaterThan(0);
    }
  });
});

describe('OGG Speex', () => {
  it('should read speex file', () => {
    const stream = openTestStream('empty.spx');
    const f = new OggSpeexFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
  });
});
