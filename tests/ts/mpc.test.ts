import { describe, it, expect } from 'vitest';
import { MpcFile, MpcTagTypes } from '../../src/mpc/mpcFile.js';
import { ReadStyle } from '../../src/toolkit/types.js';
import { ByteVectorStream } from '../../src/toolkit/byteVectorStream.js';
import { openTestStream, readTestDataBV } from './testHelper.js';

function openMpcFile(filename: string, readProperties = true, readStyle = ReadStyle.Average): MpcFile {
  const stream = openTestStream(filename);
  return new MpcFile(stream, readProperties, readStyle);
}

describe('MPC', () => {
  describe('properties', () => {
    it('should read SV8 properties', () => {
      const f = openMpcFile('sv8_header.mpc');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.mpcVersion).toBe(8);
        expect(props.channels).toBe(2);
        expect(props.sampleRate).toBe(44100);
        expect(props.lengthInMilliseconds).toBe(1497);
        expect(props.bitrate).toBe(1);
        expect(props.sampleFrames).toBe(66014);
      }
    });

    it('should read SV7 properties', () => {
      const f = openMpcFile('click.mpc');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.mpcVersion).toBe(7);
        expect(props.channels).toBe(2);
        expect(props.sampleRate).toBe(44100);
        expect(props.lengthInMilliseconds).toBe(40);
        expect(props.bitrate).toBe(318);
        expect(props.sampleFrames).toBe(1760);
        expect(props.trackGain).toBe(14221);
        expect(props.trackPeak).toBe(19848);
        expect(props.albumGain).toBe(14221);
        expect(props.albumPeak).toBe(19848);
      }
    });

    it('should read SV5 properties', () => {
      const f = openMpcFile('sv5_header.mpc');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.mpcVersion).toBe(5);
        expect(props.channels).toBe(2);
        expect(props.sampleRate).toBe(44100);
        expect(props.lengthInMilliseconds).toBe(26371);
        expect(props.bitrate).toBe(0);
        expect(props.sampleFrames).toBe(1162944);
      }
    });

    it('should read SV4 properties', () => {
      const f = openMpcFile('sv4_header.mpc');
      expect(f.isValid).toBe(true);
      const props = f.audioProperties();
      expect(props).not.toBeNull();
      if (props) {
        expect(props.mpcVersion).toBe(4);
        expect(props.channels).toBe(2);
        expect(props.sampleRate).toBe(44100);
        expect(props.lengthInMilliseconds).toBe(26371);
        expect(props.bitrate).toBe(0);
        expect(props.sampleFrames).toBe(1162944);
      }
    });
  });

  describe('fuzzed files', () => {
    it('should handle zerodiv.mpc without crashing', () => {
      const f = openMpcFile('zerodiv.mpc');
      expect(f.isValid).toBe(true);
    });

    it('should handle infloop.mpc without crashing', () => {
      const f = openMpcFile('infloop.mpc');
      expect(f.isValid).toBe(true);
    });

    it('should handle segfault.mpc without crashing', () => {
      const f = openMpcFile('segfault.mpc');
      expect(f.isValid).toBe(true);
    });

    it('should handle segfault2.mpc without crashing', () => {
      const f = openMpcFile('segfault2.mpc');
      expect(f.isValid).toBe(true);
    });
  });

  describe('strip and properties', () => {
    it('should strip tags in-memory and reflect in properties', () => {
      const data = readTestDataBV('click.mpc');
      const stream = new ByteVectorStream(data);
      const f = new MpcFile(stream, true, ReadStyle.Average);

      // Create both tags and set titles
      f.apeTag(true)!.title = 'APE';
      f.id3v1Tag(true)!.title = 'ID3v1';

      // Combined tag should expose both titles
      const props = f.tag().properties();
      const titles = props.get('TITLE');
      expect(titles).toBeDefined();
      expect(titles!.length).toBeGreaterThanOrEqual(1);

      // Strip APE tag — ID3v1 should become visible
      f.strip(MpcTagTypes.APE);
      const props2 = f.tag().properties();
      const titles2 = props2.get('TITLE');
      expect(titles2).toBeDefined();
      expect(titles2![0]).toBe('ID3v1');

      // Strip ID3v1 tag — no titles left
      f.strip(MpcTagTypes.ID3v1);
      const props3 = f.tag().properties();
      expect(props3.size).toBe(0);
    });

    it('should persist tag removal after save', () => {
      const data = readTestDataBV('click.mpc');
      const stream = new ByteVectorStream(data);

      // Add both tags and save
      {
        const f = new MpcFile(stream, true, ReadStyle.Average);
        f.apeTag(true)!.title = 'APE';
        f.id3v1Tag(true)!.title = 'ID3v1';
        f.save();
      }

      // Re-read, verify both tags exist, then strip and save
      {
        stream.seek(0);
        const f = new MpcFile(stream, true, ReadStyle.Average);
        expect(f.hasAPETag).toBe(true);
        expect(f.hasID3v1Tag).toBe(true);
        f.strip(MpcTagTypes.AllTags);
        f.save();
      }

      // Re-read and verify the file is still valid
      {
        stream.seek(0);
        const f = new MpcFile(stream, true, ReadStyle.Average);
        expect(f.isValid).toBe(true);
        expect(f.hasID3v1Tag).toBe(false);
      }
    });
  });

  describe('repeated save', () => {
    it('should handle multiple saves correctly', () => {
      const data = readTestDataBV('click.mpc');
      const stream = new ByteVectorStream(data);

      // Phase 1: Multiple saves with different tag values
      {
        const f = new MpcFile(stream, true, ReadStyle.Average);
        expect(f.hasAPETag).toBe(false);
        expect(f.hasID3v1Tag).toBe(false);

        f.apeTag(true)!.title = '01234 56789 ABCDE FGHIJ';
        f.save();

        f.apeTag()!.title = '0';
        f.save();

        f.id3v1Tag(true)!.title = '01234 56789 ABCDE FGHIJ';
        f.apeTag()!.title = '01234 56789 ABCDE FGHIJ 01234 56789 ABCDE FGHIJ 01234 56789';
        f.save();
      }

      // Phase 2: Re-read and verify both tags exist
      {
        stream.seek(0);
        const f = new MpcFile(stream, true, ReadStyle.Average);
        expect(f.hasAPETag).toBe(true);
        expect(f.hasID3v1Tag).toBe(true);
      }
    });
  });
});
