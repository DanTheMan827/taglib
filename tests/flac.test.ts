import { describe, it, expect } from 'vitest';
import { FlacFile } from '../src/flac/flacFile.js';
import { ByteVectorStream } from '../src/toolkit/byteVectorStream.js';
import { ReadStyle } from '../src/toolkit/types.js';
import { openTestStream, readTestData } from './testHelper.js';

function openFlacFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): FlacFile {
  const stream = openTestStream(filename);
  return new FlacFile(stream, readProperties, readStyle);
}

describe('FLAC', () => {
  it('should read silence file', () => {
    const f = openFlacFile('silence-44-s.flac');
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBe(44100);
      expect(props.channels).toBe(2);
      expect(props.bitsPerSample).toBe(16);
      expect(props.lengthInMilliseconds).toBeGreaterThan(0);
    }
  });

  it('should read sinewave file', () => {
    const f = openFlacFile('sinewave.flac');
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
  });

  it('should read no-tags file', () => {
    const f = openFlacFile('no-tags.flac');
    expect(f.isValid).toBe(true);
  });

  it('should read empty-seektable file', () => {
    const f = openFlacFile('empty-seektable.flac');
    expect(f.isValid).toBe(true);
  });

  it('should read zero-sized-padding file', () => {
    const f = openFlacFile('zero-sized-padding.flac');
    expect(f.isValid).toBe(true);
  });

  it('should read multiple-vc file', () => {
    const f = openFlacFile('multiple-vc.flac');
    expect(f.isValid).toBe(true);
  });

  it('should read Xiph Comment', () => {
    const f = openFlacFile('silence-44-s.flac');
    expect(f.xiphComment).not.toBeNull();
  });

  it('should access pictures', () => {
    const f = openFlacFile('silence-44-s.flac');
    // Silence file may or may not have pictures, but API should work
    const pics = f.pictureList;
    expect(Array.isArray(pics)).toBe(true);
  });

  it('should save and re-read', () => {
    const data = readTestData('silence-44-s.flac');
    const stream = new ByteVectorStream(data);
    const f = new FlacFile(stream, true, ReadStyle.Average);
    
    if (f.isValid && f.xiphComment) {
      f.xiphComment.title = 'FLAC Test';
      f.xiphComment.artist = 'Test Artist';
      f.save();
    }

    // Re-read
    stream.seek(0);
    const f2 = new FlacFile(stream, true, ReadStyle.Average);
    if (f2.isValid && f2.xiphComment) {
      expect(f2.xiphComment.title).toBe('FLAC Test');
      expect(f2.xiphComment.artist).toBe('Test Artist');
    }
  });
});
