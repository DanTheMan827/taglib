import { describe, it, expect } from 'vitest';
import { Mp4File } from '../src/mp4/mp4File.js';
import { ByteVectorStream } from '../src/toolkit/byteVectorStream.js';
import { ReadStyle } from '../src/toolkit/types.js';
import { openTestStream, readTestData } from './testHelper.js';

function openMp4File(filename: string, readProperties = true, readStyle = ReadStyle.Average): Mp4File {
  const stream = openTestStream(filename);
  return new Mp4File(stream, readProperties, readStyle);
}

describe('MP4', () => {
  it('should read has-tags file', () => {
    const f = openMp4File('has-tags.m4a');
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    expect(tag).not.toBeNull();
  });

  it('should read audio properties', () => {
    const f = openMp4File('has-tags.m4a');
    const props = f.audioProperties();
    expect(props).not.toBeNull();
    if (props) {
      expect(props.sampleRate).toBeGreaterThan(0);
      expect(props.channels).toBeGreaterThan(0);
      expect(props.lengthInMilliseconds).toBeGreaterThan(0);
    }
  });

  it('should read no-tags file', () => {
    const f = openMp4File('no-tags.m4a');
    expect(f.isValid).toBe(true);
  });

  it('should read gnre (genre ID) file', () => {
    const f = openMp4File('gnre.m4a');
    expect(f.isValid).toBe(true);
    const tag = f.tag();
    if (tag) {
      // gnre atom stores genre as ID3v1 genre index
      expect(tag.genre).toBeDefined();
    }
  });

  it('should read empty ALAC file', () => {
    const f = openMp4File('empty_alac.m4a');
    expect(f.isValid).toBe(true);
    const props = f.audioProperties();
    if (props) {
      expect(props.codec).toBeDefined();
    }
  });

  it('should read covr-junk file', () => {
    const f = openMp4File('covr-junk.m4a');
    expect(f.isValid).toBe(true);
  });

  it('should read ilst-is-last file', () => {
    const f = openMp4File('ilst-is-last.m4a');
    expect(f.isValid).toBe(true);
  });

  it('should handle non-full-meta file', () => {
    const f = openMp4File('non-full-meta.m4a');
    // Should not crash
    expect(f).toBeDefined();
  });

  it('should handle nonprintable atom type', () => {
    const f = openMp4File('nonprintable-atom-type.m4a');
    expect(f).toBeDefined();
  });

  it('should handle blank video file', () => {
    const f = openMp4File('blank_video.m4v');
    expect(f).toBeDefined();
  });

  it('should handle zero-length-mdat', () => {
    const f = openMp4File('zero-length-mdat.m4a');
    expect(f).toBeDefined();
  });

  it('should handle infloop file', () => {
    const f = openMp4File('infloop.m4a');
    expect(f).toBeDefined();
  });

  it('should save and re-read tag', () => {
    const data = readTestData('has-tags.m4a');
    const stream = new ByteVectorStream(data);
    const f = new Mp4File(stream, true, ReadStyle.Average);
    
    if (f.isValid) {
      const tag = f.tag();
      if (tag) {
        tag.title = 'MP4 Test';
        tag.artist = 'Test Artist';
        f.save();
      }

      stream.seek(0);
      const f2 = new Mp4File(stream, true, ReadStyle.Average);
      const tag2 = f2.tag();
      if (tag2) {
        expect(tag2.title).toBe('MP4 Test');
        expect(tag2.artist).toBe('Test Artist');
      }
    }
  });
});
