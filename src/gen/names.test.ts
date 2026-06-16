/**
 * names.test.ts — Pins name-generator output (part of the world: names are
 * shared across players) and enforces the secret-keeping rule.
 */
import { describe, expect, it } from 'vitest';
import { Rng, hash128 } from '../rng';
import { bodyName, moonName, stationName, systemName } from './names';

describe('systemName', () => {
  it('is deterministic and normalization-insensitive', () => {
    expect(systemName('Photosynthesis')).toBe(systemName('photosynthesis'));
    expect(systemName('Byzantine_Empire')).toBe(systemName('Byzantine Empire'));
  });

  it('GOLDEN — pinned names (changing these renames the shared galaxy)', () => {
    const names = [
      'Photosynthesis',
      'Byzantine Empire',
      'Fermentation',
      'Red dwarf',
    ].map((t) => `${t} => ${systemName(t)}`);
    expect(names).toMatchInlineSnapshot(`
      [
        "Photosynthesis => Moash Nizith",
        "Byzantine Empire => Velysel Reach",
        "Fermentation => Maukraen",
        "Red dwarf => Kaezoul Siam",
      ]
    `);
  });

  it('never leaks the source title (secret-keeping)', () => {
    const titles = [
      'Photosynthesis',
      'Byzantine Empire',
      'Fermentation',
      'Sun',
      'Gold',
      'Water',
    ];
    for (const t of titles) {
      const name = systemName(t).toLowerCase();
      for (const piece of t.toLowerCase().split(/\s+/)) {
        if (piece.length >= 4) expect(name).not.toContain(piece);
      }
    }
  });

  it('produces non-empty, reasonably sized names', () => {
    for (let i = 0; i < 200; i++) {
      const name = systemName(`Test article ${i}`);
      expect(name.length).toBeGreaterThan(2);
      expect(name.length).toBeLessThan(40);
      expect(name).toMatch(/^[A-Z]/);
    }
  });
});

describe('bodyName / moonName / stationName', () => {
  it('formats body and moon names', () => {
    expect(bodyName('Vel Toshi', 0)).toBe('Vel Toshi I');
    expect(bodyName('Vel Toshi', 3)).toBe('Vel Toshi IV');
    expect(moonName('Vel Toshi II', 0)).toBe('Vel Toshi IIa');
  });

  it('station names are deterministic per stream', () => {
    const a = stationName(new Rng(hash128('station-test')));
    const b = stationName(new Rng(hash128('station-test')));
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Z][a-z]+ [A-Z]/);
  });

  describe('faction phoneme bias (§13.2)', () => {
    const PHONEMES = ['kr', 'dr', 'ka', 'gor'];

    it('biasing can change the generated name', () => {
      // Not guaranteed per-seed (the neutral table is still in the pool), but
      // across many seeds the biased and neutral streams must diverge.
      let diverged = 0;
      for (let i = 0; i < 100; i++) {
        const seed = hash128(`fac-name:${i}`);
        if (stationName(new Rng(seed)) !== stationName(new Rng(seed), PHONEMES)) diverged++;
      }
      expect(diverged).toBeGreaterThan(0);
    });

    it('CRITICAL: biasing does not change the draw count (priceLevel stays put)', () => {
      // generate.ts draws a station's priceLevel from the SAME stream right
      // after stationName. The onset-pool swap must consume identical draws,
      // or every faction station would silently reprice. Lock it: the rng is
      // in the same state after either call, so the next draw matches.
      for (let i = 0; i < 50; i++) {
        const seed = hash128(`fac-draw:${i}`);
        const neutral = new Rng(seed);
        stationName(neutral);
        const biased = new Rng(seed);
        stationName(biased, PHONEMES);
        expect(biased.nextUint32()).toBe(neutral.nextUint32());
      }
    });
  });
});
