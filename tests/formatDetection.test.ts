import { describe, it, expect } from 'vitest';
import { detectByExtension, detectByContent, defaultFileExtensions } from '../src/formatDetection.js';
import { openTestStream } from './testHelper.js';

describe('Format Detection', () => {
  describe('detectByExtension', () => {
    it('should detect MPEG', () => {
      expect(detectByExtension('song.mp3')).toBe('mpeg');
      expect(detectByExtension('song.MP3')).toBe('mpeg');
      expect(detectByExtension('song.mp2')).toBe('mpeg');
      expect(detectByExtension('song.aac')).toBe('mpeg');
    });

    it('should detect FLAC', () => {
      expect(detectByExtension('song.flac')).toBe('flac');
      expect(detectByExtension('song.FLAC')).toBe('flac');
    });

    it('should detect MP4', () => {
      expect(detectByExtension('song.m4a')).toBe('mp4');
      expect(detectByExtension('song.m4b')).toBe('mp4');
      expect(detectByExtension('song.m4p')).toBe('mp4');
      expect(detectByExtension('song.mp4')).toBe('mp4');
      expect(detectByExtension('video.m4v')).toBe('mp4');
    });

    it('should detect OGG', () => {
      expect(detectByExtension('song.ogg')).toBe('ogg');
      expect(detectByExtension('song.oga')).toBe('ogg');
    });

    it('should detect Opus', () => {
      expect(detectByExtension('song.opus')).toBe('ogg-opus');
    });

    it('should detect Speex', () => {
      expect(detectByExtension('song.spx')).toBe('ogg-speex');
    });

    it('should detect WAV', () => {
      expect(detectByExtension('song.wav')).toBe('wav');
    });

    it('should detect AIFF', () => {
      expect(detectByExtension('song.aiff')).toBe('aiff');
      expect(detectByExtension('song.aif')).toBe('aiff');
      expect(detectByExtension('song.aifc')).toBe('aiff');
    });

    it('should return null for unknown', () => {
      expect(detectByExtension('file.txt')).toBeNull();
      expect(detectByExtension('file.pdf')).toBeNull();
    });
  });

  describe('detectByContent', () => {
    it('should detect FLAC by content', () => {
      const stream = openTestStream('silence-44-s.flac');
      expect(detectByContent(stream)).toBe('flac');
    });

    it('should detect OGG Vorbis by content', () => {
      const stream = openTestStream('empty.ogg');
      expect(detectByContent(stream)).toBe('ogg-vorbis');
    });

    it('should detect Opus by content', () => {
      const stream = openTestStream('correctness_gain_silent_output.opus');
      expect(detectByContent(stream)).toBe('ogg-opus');
    });

    it('should detect Speex by content', () => {
      const stream = openTestStream('empty.spx');
      expect(detectByContent(stream)).toBe('ogg-speex');
    });

    it('should detect MP4 by content', () => {
      const stream = openTestStream('has-tags.m4a');
      expect(detectByContent(stream)).toBe('mp4');
    });

    it('should detect WAV by content', () => {
      const stream = openTestStream('empty.wav');
      expect(detectByContent(stream)).toBe('wav');
    });

    it('should detect AIFF by content', () => {
      const stream = openTestStream('empty.aiff');
      expect(detectByContent(stream)).toBe('aiff');
    });

    it('should detect MPEG by content (with ID3v2)', () => {
      const stream = openTestStream('xing.mp3');
      expect(detectByContent(stream)).toBe('mpeg');
    });
  });

  describe('defaultFileExtensions', () => {
    it('should return supported extensions', () => {
      const exts = defaultFileExtensions();
      expect(exts).toContain('mp3');
      expect(exts).toContain('flac');
      expect(exts).toContain('m4a');
      expect(exts).toContain('ogg');
      expect(exts).toContain('wav');
      expect(exts).toContain('aiff');
    });
  });
});
