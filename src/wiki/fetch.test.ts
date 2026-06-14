import { describe, expect, it } from 'vitest';
import { extractLinkOrder, isJunkLink, protectionLevel } from './fetch';

describe('isJunkLink (§4.1 filter)', () => {
  it('drops dates, decades, lists, and identifiers', () => {
    for (const junk of [
      '1905',
      '44',
      '1990s',
      'March',
      'March 14',
      '14 March',
      'List of sovereign states',
      'ISBN',
      'Doi (identifier)',
      'Wayback Machine',
    ]) {
      expect(isJunkLink(junk), junk).toBe(true);
    }
  });

  it('keeps real article titles', () => {
    for (const ok of [
      'Photosynthesis',
      'Byzantine Empire',
      'March of the Penguins', // starts with a month name but is an article
      'Doise', // not the DOI identifier page
      '2001: A Space Odyssey (film)',
    ]) {
      expect(isJunkLink(ok), ok).toBe(false);
    }
  });
});

describe('extractLinkOrder (§4.1 in-article ranking)', () => {
  it('returns first-appearance order, handling pipes, anchors, and duplicates', () => {
    const wikitext = `
      '''Stars''' emit [[light]] and [[Heat|heat]].
      See [[Stellar evolution#Main sequence|their lifecycle]].
      [[light]] again should not repeat.
      {{Infobox star | field = [[plasma physics]] }}
    `;
    expect(extractLinkOrder(wikitext)).toEqual([
      'Light',
      'Heat',
      'Stellar evolution',
      'Plasma physics',
    ]);
  });

  it('skips non-mainspace targets and underscored titles normalize', () => {
    const wikitext =
      '[[File:Sun.jpg|thumb|the sun]] [[Category:Stars]] [[main_sequence]] [[wikt:star]]';
    expect(extractLinkOrder(wikitext)).toEqual(['Main sequence']);
  });
});

describe('protectionLevel (§17.1 → §13 contested/militarised)', () => {
  it('reads the edit restriction, folding extendedconfirmed into autoconfirmed', () => {
    expect(protectionLevel(undefined)).toBe('none');
    expect(protectionLevel([])).toBe('none');
    expect(protectionLevel([{ type: 'move', level: 'sysop' }])).toBe('none'); // move ≠ edit
    expect(protectionLevel([{ type: 'edit', level: 'autoconfirmed' }])).toBe('autoconfirmed');
    expect(protectionLevel([{ type: 'edit', level: 'extendedconfirmed' }])).toBe('autoconfirmed');
    expect(protectionLevel([{ type: 'edit', level: 'sysop' }])).toBe('sysop');
    expect(
      protectionLevel([
        { type: 'edit', level: 'sysop' },
        { type: 'move', level: 'autoconfirmed' },
      ]),
    ).toBe('sysop');
  });
});
