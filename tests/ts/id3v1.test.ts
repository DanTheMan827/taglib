import { describe, it, expect } from 'vitest';
import { genre, genreIndex, genreList, genreMap } from '../../src/mpeg/id3v1/id3v1Genres.js';

describe('ID3v1', () => {
  it('should look up genre by index', () => {
    expect(genre(50)).toBe('Darkwave');
  });

  it('should look up genre index by name', () => {
    expect(genreIndex('Humour')).toBe(100);
  });

  it('should contain Heavy Metal in genre list', () => {
    expect(genreList()).toContain('Heavy Metal');
  });

  it('should map Hard Rock to index 79', () => {
    expect(genreMap().get('Hard Rock')).toBe(79);
  });

  it('should look up Bebop (renamed genre)', () => {
    expect(genre(85)).toBe('Bebop');
    expect(genreIndex('Bebop')).toBe(85);
  });
});
