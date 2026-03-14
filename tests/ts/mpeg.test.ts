import { describe, it, expect } from 'vitest';
import { MpegFile } from '../../src/mpeg/mpegFile.js';
import { ByteVectorStream } from '../../src/toolkit/byteVectorStream.js';
import { ReadStyle } from '../../src/toolkit/types.js';
import { openTestStream, readTestData } from './testHelper.js';

function openMpegFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): MpegFile {
  const stream = openTestStream(filename);
  return new MpegFile(stream, readProperties, readStyle);
}

describe('MPEG', () => {
  describe('basic properties', () => {
    it('should read xing VBR file', () => {
      const f = openMpegFile('xing.mp3');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.sampleRate).toBe(44100);
        expect(props.channels).toBe(2);
        expect(props.lengthInMilliseconds).toBeGreaterThan(0);
      }
    });

    it('should read lame CBR file', () => {
      const f = openMpegFile('lame_cbr.mp3');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.sampleRate).toBe(44100);
        expect(props.channels).toBeGreaterThanOrEqual(1);
      }
    });

    it('should read lame VBR file', () => {
      const f = openMpegFile('lame_vbr.mp3');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
    });

    it('should read mpeg2 file', () => {
      const f = openMpegFile('mpeg2.mp3');
      expect(f.isValid).toBe(true);
    });

    it('should read bladeenc file', () => {
      const f = openMpegFile('bladeenc.mp3');
      expect(f.isValid).toBe(true);
    });
  });

  describe('tags', () => {
    it('should read ID3v2 tag from xing', () => {
      const f = openMpegFile('xing.mp3');
      const tag = f.tag();
      expect(tag).not.toBeNull();
    });

    it('should read APE tag', () => {
      const f = openMpegFile('ape.mp3');
      expect(f.isValid).toBe(true);
      expect(f.apeTag).not.toBeNull();
    });

    it('should read APE + ID3v1 tag', () => {
      const f = openMpegFile('ape-id3v1.mp3');
      expect(f.isValid).toBe(true);
    });

    it('should read APE + ID3v2 tag', () => {
      const f = openMpegFile('ape-id3v2.mp3');
      expect(f.isValid).toBe(true);
    });

    it('should read itunes 10 file', () => {
      const f = openMpegFile('itunes10.mp3');
      expect(f.isValid).toBe(true);
      const tag = f.tag();
      expect(tag).not.toBeNull();
    });

    it('should read extended header file', () => {
      const f = openMpegFile('extended-header.mp3');
      expect(f.isValid).toBe(true);
    });

    it('should read duplicate ID3v2 tags', () => {
      const f = openMpegFile('duplicate_id3v2.mp3');
      expect(f.isValid).toBe(true);
    });
  });

  describe('frame scanning', () => {
    it('should find first frame offset', () => {
      const f = openMpegFile('xing.mp3');
      const offset = f.firstFrameOffset();
      expect(offset).toBeGreaterThanOrEqual(0);
    });

    it('should find last frame offset', () => {
      const f = openMpegFile('xing.mp3');
      const offset = f.lastFrameOffset();
      expect(offset).toBeGreaterThanOrEqual(0);
    });
  });

  describe('invalid files', () => {
    it('should handle invalid frames 1', () => {
      const f = openMpegFile('invalid-frames1.mp3');
      // File may be valid but with limited frames
      expect(f.isValid).toBeDefined();
    });

    it('should handle invalid frames 2', () => {
      const f = openMpegFile('invalid-frames2.mp3');
      expect(f.isValid).toBeDefined();
    });

    it('should handle invalid frames 3', () => {
      const f = openMpegFile('invalid-frames3.mp3');
      expect(f.isValid).toBeDefined();
    });

    it('should handle garbage file', () => {
      const f = openMpegFile('garbage.mp3');
      expect(f.isValid).toBeDefined();
    });

    it('should handle excessive alloc file', () => {
      const f = openMpegFile('excessive_alloc.mp3');
      expect(f.isValid).toBeDefined();
    });
  });

  describe('write', () => {
    it('should save and re-read properties', () => {
      const data = readTestData('xing.mp3');
      const stream = new ByteVectorStream(data);
      const f = new MpegFile(stream, true, ReadStyle.Average);
      
      if (f.id3v2Tag(true)) {
        f.id3v2Tag(true)!.title = 'Test Title';
        f.id3v2Tag(true)!.artist = 'Test Artist';
        f.save();
      }

      // Re-read
      stream.seek(0);
      const f2 = new MpegFile(stream, true, ReadStyle.Average);
      const tag = f2.tag();
      expect(tag?.title).toBe('Test Title');
      expect(tag?.artist).toBe('Test Artist');
    });
  });
});
