import { describe, it, expect } from 'vitest';
import { XiphComment } from '../../src/ogg/xiphComment.js';

describe('XiphComment', () => {
  it('should return 0 for year with no fields', () => {
    const cmt = new XiphComment();
    expect(cmt.year).toBe(0);
  });

  it('should read year from YEAR field', () => {
    const cmt = new XiphComment();
    cmt.addField('YEAR', '2009');
    expect(cmt.year).toBe(2009);
  });

  it('should prefer DATE over YEAR', () => {
    const cmt = new XiphComment();
    cmt.addField('YEAR', '2009');
    cmt.addField('DATE', '2008');
    expect(cmt.year).toBe(2008);
  });

  it('should set year to DATE and clear YEAR', () => {
    const cmt = new XiphComment();
    cmt.addField('YEAR', '2009');
    cmt.addField('DATE', '2008');
    cmt.year = 1995;
    const map = cmt.fieldListMap();
    expect(map.get('YEAR') ?? []).toEqual([]);
    expect(map.get('DATE')?.[0]).toBe('1995');
  });

  it('should return 0 for track with no fields', () => {
    const cmt = new XiphComment();
    expect(cmt.track).toBe(0);
  });

  it('should read track from TRACKNUMBER', () => {
    const cmt = new XiphComment();
    cmt.addField('TRACKNUMBER', '8');
    expect(cmt.track).toBe(8);
  });

  it('should set track to TRACKNUMBER', () => {
    const cmt = new XiphComment();
    cmt.addField('TRACKNUMBER', '8');
    cmt.track = 3;
    expect(cmt.fieldListMap().get('TRACKNUMBER')?.[0]).toBe('3');
  });

  it('should clear comment', () => {
    const cmt = new XiphComment();
    cmt.addField('DESCRIPTION', 'A comment');
    expect(cmt.comment).toBe('A comment');
    cmt.comment = '';
    expect(cmt.comment).toBe('');
  });

  it('should remove field', () => {
    const cmt = new XiphComment();
    cmt.addField('TITLE', 'Test');
    cmt.addField('ARTIST', 'Art');
    cmt.removeField('TITLE');
    expect(cmt.fieldListMap().has('TITLE')).toBe(false);
    expect(cmt.fieldListMap().get('ARTIST')?.[0]).toBe('Art');
  });

  it('should add and replace fields', () => {
    const cmt = new XiphComment();
    cmt.addField('ARTIST', 'First', true);
    expect(cmt.fieldListMap().get('ARTIST')).toEqual(['First']);
    cmt.addField('ARTIST', 'Second', false);
    expect(cmt.fieldListMap().get('ARTIST')).toEqual(['First', 'Second']);
    cmt.addField('ARTIST', 'Third', true);
    expect(cmt.fieldListMap().get('ARTIST')).toEqual(['Third']);
  });

  it('should handle field count', () => {
    const cmt = new XiphComment();
    expect(cmt.fieldCount).toBe(0);
    cmt.addField('TITLE', 'Test');
    expect(cmt.fieldCount).toBe(1);
    cmt.addField('ARTIST', 'Art');
    expect(cmt.fieldCount).toBe(2);
    cmt.addField('ARTIST', 'Art2', false);
    expect(cmt.fieldCount).toBe(3);
  });

  it('should render and re-parse', () => {
    const cmt = new XiphComment();
    cmt.vendorId = 'TestVendor';
    cmt.addField('TITLE', 'Hello');
    cmt.addField('ARTIST', 'World');
    
    const rendered = cmt.render(false);
    const parsed = XiphComment.readFrom(rendered);
    
    expect(parsed.vendorId).toBe('TestVendor');
    expect(parsed.title).toBe('Hello');
    expect(parsed.artist).toBe('World');
  });

  it('should render with framing bit', () => {
    const cmt = new XiphComment();
    cmt.vendorId = 'Test';
    cmt.addField('TITLE', 'Hello');
    
    const rendered = cmt.render(true);
    // Last byte should be framing bit (0x01)
    expect(rendered.get(rendered.length - 1)).toBe(0x01);
  });

  it('should handle properties', () => {
    const cmt = new XiphComment();
    cmt.addField('TITLE', 'Test Title');
    cmt.addField('ARTIST', 'Test Artist');
    
    const props = cmt.properties();
    expect(props.get('TITLE')).toEqual(['Test Title']);
    expect(props.get('ARTIST')).toEqual(['Test Artist']);
  });
});
