import { describe, it, expect } from 'vitest';
import { WavFile } from '../../src/riff/wav/wavFile.js';
import { AiffFile } from '../../src/riff/aiff/aiffFile.js';
import { ByteVectorStream } from '../../src/toolkit/byteVectorStream.js';
import { ReadStyle } from '../../src/toolkit/types.js';
import { openTestStream, readTestData } from './testHelper.js';

describe('WAV', () => {
  it('should read empty wav file', () => {
    const stream = openTestStream('empty.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBeGreaterThan(0);
      expect(props.channels).toBeGreaterThan(0);
      expect(props.bitsPerSample).toBeGreaterThan(0);
    }
  });

  it('should read alaw wav file', () => {
    const stream = openTestStream('alaw.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should read float64 wav file', () => {
    const stream = openTestStream('float64.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    if (props) {
      expect(props.bitsPerSample).toBe(64);
    }
  });

  it('should read uint8we wav file', () => {
    const stream = openTestStream('uint8we.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should read pcm_with_fact_chunk wav file', () => {
    const stream = openTestStream('pcm_with_fact_chunk.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should read duplicate tags wav file', () => {
    const stream = openTestStream('duplicate_tags.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should handle invalid chunk wav file', () => {
    const stream = openTestStream('invalid-chunk.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
  });

  it('should handle segfault wav', () => {
    const stream = openTestStream('segfault.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
  });

  it('should handle zero-size-chunk wav', () => {
    const stream = openTestStream('zero-size-chunk.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
  });

  it('should handle infloop wav', () => {
    const stream = openTestStream('infloop.wav');
    const f = new WavFile(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
  });

  it('should save and re-read', () => {
    const data = readTestData('empty.wav');
    const stream = new ByteVectorStream(data);
    const f = new WavFile(stream, true, ReadStyle.Average);
    
    if (f.isValid && f.id3v2Tag) {
      f.id3v2Tag.title = 'WAV Test';
      f.save();
    }

    stream.seek(0);
    const f2 = new WavFile(stream, true, ReadStyle.Average);
    if (f2.isValid && f2.id3v2Tag) {
      expect(f2.id3v2Tag.title).toBe('WAV Test');
    }
  });
});

describe('AIFF', () => {
  it('should read empty aiff file', () => {
    const stream = openTestStream('empty.aiff');
    const f = new AiffFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBeGreaterThan(0);
      expect(props.channels).toBeGreaterThan(0);
    }
  });

  it('should read noise aif file', () => {
    const stream = openTestStream('noise.aif');
    const f = new AiffFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should read noise_odd aif file', () => {
    const stream = openTestStream('noise_odd.aif');
    const f = new AiffFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should read duplicate_id3v2 aiff file', () => {
    const stream = openTestStream('duplicate_id3v2.aiff');
    const f = new AiffFile(stream, true, ReadStyle.Average);
    expect(f.isValid).toBe(true);
  });

  it('should handle segfault aif', () => {
    const stream = openTestStream('segfault.aif');
    const f = new AiffFile(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
  });

  it('should handle excessive alloc aif', () => {
    const stream = openTestStream('excessive_alloc.aif');
    const f = new AiffFile(stream, true, ReadStyle.Average);
    expect(f).toBeDefined();
  });
});
