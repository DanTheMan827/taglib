import { describe, it, expect } from 'vitest';
import { PropertyMap } from '../src/toolkit/propertyMap.js';

describe('PropertyMap', () => {
  it('should store and retrieve values', () => {
    const pm = new PropertyMap();
    pm.insert('TITLE', ['Hello']);
    expect(pm.contains('TITLE')).toBe(true);
    expect(pm.get('TITLE')).toEqual(['Hello']);
  });

  it('should be case-insensitive', () => {
    const pm = new PropertyMap();
    pm.insert('title', ['Hello']);
    expect(pm.contains('TITLE')).toBe(true);
    expect(pm.get('Title')).toEqual(['Hello']);
  });

  it('should replace values', () => {
    const pm = new PropertyMap();
    pm.insert('TITLE', ['First']);
    pm.replace('TITLE', ['Second']);
    expect(pm.get('TITLE')).toEqual(['Second']);
  });

  it('should erase values', () => {
    const pm = new PropertyMap();
    pm.insert('TITLE', ['Hello']);
    expect(pm.erase('TITLE')).toBe(true);
    expect(pm.contains('TITLE')).toBe(false);
  });

  it('should merge property maps', () => {
    const pm1 = new PropertyMap();
    pm1.insert('TITLE', ['First']);
    const pm2 = new PropertyMap();
    pm2.insert('TITLE', ['Second']);
    pm2.insert('ARTIST', ['Art']);
    pm1.merge(pm2);
    expect(pm1.get('TITLE')).toEqual(['First', 'Second']);
    expect(pm1.get('ARTIST')).toEqual(['Art']);
  });

  it('should track size', () => {
    const pm = new PropertyMap();
    expect(pm.size).toBe(0);
    pm.insert('TITLE', ['Hello']);
    expect(pm.size).toBe(1);
    pm.insert('ARTIST', ['World']);
    expect(pm.size).toBe(2);
  });

  it('should remove empty entries', () => {
    const pm = new PropertyMap();
    pm.insert('TITLE', []);
    pm.insert('ARTIST', ['Art']);
    pm.removeEmpty();
    expect(pm.contains('TITLE')).toBe(false);
    expect(pm.contains('ARTIST')).toBe(true);
  });

  it('should track unsupported data', () => {
    const pm = new PropertyMap();
    pm.addUnsupportedData('TXXX:CUSTOM');
    expect(pm.unsupportedData()).toContain('TXXX:CUSTOM');
  });

  it('should iterate entries', () => {
    const pm = new PropertyMap();
    pm.insert('TITLE', ['Hello']);
    pm.insert('ARTIST', ['World']);
    const entries = [...pm.entries()];
    expect(entries.length).toBe(2);
  });
});
