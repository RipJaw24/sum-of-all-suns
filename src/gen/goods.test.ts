/**
 * goods.test.ts — the trade-goods table and the section-title laundering
 * (§6). The structural guarantee against leaking wiki text: derivation
 * returns IDS INTO OUR TABLE, never anything built from the input string.
 */
import { describe, expect, it } from 'vitest';
import { bioluminescentBay, mercuryDisambiguation, photosynthesis } from './fixtures';
import { GOODS, goodById, goodsForSectionTitle } from './goods';

describe('GOODS table', () => {
  it('has unique ids and positive prices', () => {
    expect(new Set(GOODS.map((g) => g.id)).size).toBe(GOODS.length);
    for (const g of GOODS) {
      expect(g.basePrice).toBeGreaterThan(0);
      expect(g.name.length).toBeGreaterThan(0);
    }
  });

  it('looks up by id', () => {
    expect(goodById(GOODS[0]!.id)).toBe(GOODS[0]);
    expect(goodById('nonsense')).toBeUndefined();
  });
});

describe('goodsForSectionTitle (§6 laundering)', () => {
  it('is deterministic and normalization-insensitive', () => {
    expect(goodsForSectionTitle('History')).toEqual(goodsForSectionTitle('History'));
    expect(goodsForSectionTitle('History')).toEqual(goodsForSectionTitle('  history '));
  });

  it('returns 1–2 distinct ids, all from the table', () => {
    const fixtures = [photosynthesis, bioluminescentBay, mercuryDisambiguation];
    for (const meta of fixtures) {
      for (const section of meta.sections) {
        const ids = goodsForSectionTitle(section.title);
        expect(ids.length).toBeGreaterThanOrEqual(1);
        expect(ids.length).toBeLessThanOrEqual(2);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(goodById(id)).toBeDefined();
      }
    }
  });

  it('different headings can supply different goods (not a constant fn)', () => {
    const seen = new Set(
      ['History', 'Description', 'Habitat', 'Etymology', 'Geography', 'Culture'].map((t) =>
        goodsForSectionTitle(t).join(','),
      ),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});
