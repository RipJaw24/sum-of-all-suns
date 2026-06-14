/**
 * habitation.test.ts — §14 life & habitation: the sterile→teeming tier and the
 * P31/category biome class. Pure-layer coverage; the golden suite pins the
 * fields onto SystemSpec.
 */
import { describe, expect, it } from 'vitest';
import type { ArticleMetadata } from '../types';
import { biomeFor, habitationFor } from './habitation';

function meta(over: Partial<ArticleMetadata>): ArticleMetadata {
  return {
    schemaVersion: 2,
    title: 'Test',
    byteLength: 20_000,
    sections: [],
    links: [],
    categories: [],
    hasInfobox: false,
    referenceCount: 0,
    pageviews60d: 0,
    isDisambiguation: false,
    snapshotAt: '2026-06-14T00:00:00.000Z',
    ...over,
  };
}

describe('biomeFor (§14 ontological class)', () => {
  it('P31 is the primary lever (overrides categories)', () => {
    // taxon -> verdant even though the categories scream industrial.
    expect(biomeFor(meta({ instanceOf: ['Q16521'], categories: ['Chemical elements'] }))).toBe(
      'verdant',
    );
    expect(biomeFor(meta({ instanceOf: ['Q11173'] }))).toBe('industrial'); // chemical compound
    expect(biomeFor(meta({ instanceOf: ['Q5'] }))).toBe('civic'); // human
    expect(biomeFor(meta({ instanceOf: ['Q523'] }))).toBe('barren'); // star
  });

  it('falls back to category keywords when no P31 (or P31 unmapped)', () => {
    expect(biomeFor(meta({ categories: ['Aquatic plants', 'Photosynthesis'] }))).toBe('verdant');
    expect(biomeFor(meta({ categories: ['Chemical elements', 'Metals'] }))).toBe('industrial');
    expect(biomeFor(meta({ categories: ['History of France', 'Politics'] }))).toBe('civic');
    expect(biomeFor(meta({ categories: ['Mathematical logic', 'Algorithms'] }))).toBe('machine');
    // Unmapped Q-id falls through to categories rather than guessing.
    expect(biomeFor(meta({ instanceOf: ['Q999999999'], categories: ['Forests'] }))).toBe('verdant');
  });

  it('no usable signal -> barren', () => {
    expect(biomeFor(meta({ categories: [] }))).toBe('barren');
    expect(biomeFor(meta({ categories: ['Articles with short description'] }))).toBe('barren');
  });
});

describe('habitationFor (§14 sterile→teeming tier)', () => {
  it('empty backwater is sterile; busy multilingual capital is teeming', () => {
    expect(habitationFor(meta({}), 0)).toBe('sterile');
    expect(
      habitationFor(
        meta({ languageCount: 300, hasInfobox: true, sections: Array(12).fill({ title: 's', byteLength: 100, imageCount: 0 }) }),
        1,
      ),
    ).toBe('teeming');
  });

  it('tier rises monotonically with traffic', () => {
    const order = ['sterile', 'frontier', 'settled', 'teeming'];
    const m = meta({ languageCount: 20 });
    const tiers = [0, 0.3, 0.6, 1].map((tr) => order.indexOf(habitationFor(m, tr)));
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1]!);
    }
  });

  it('is deterministic and independent of biome (orthogonal axes)', () => {
    const m = meta({ languageCount: 50, categories: ['Mathematics'] });
    expect(habitationFor(m, 0.5)).toBe(habitationFor(m, 0.5));
    // A 'machine' biome can still be a busy (settled+) place.
    expect(['settled', 'teeming']).toContain(habitationFor(meta({ languageCount: 120 }), 0.7));
  });
});
