/**
 * rng.test.ts — Guardrails for the determinism contract.
 *
 * The GOLDEN VALUES test is the important one: it pins exact outputs.
 * If it fails after a change, generated worlds have shifted for every
 * player. Either revert, or accept the break and bump GEN_VERSION.
 */
import { describe, expect, it } from 'vitest';
import {
  Rng,
  hash128,
  normalizeTitle,
  rngForArticle,
  seedToHex,
  systemSeed,
} from './rng';

describe('normalizeTitle', () => {
  it('canonicalizes underscores, whitespace, and first letter', () => {
    expect(normalizeTitle('photosynthesis')).toBe('Photosynthesis');
    expect(normalizeTitle('  byzantine_empire ')).toBe('Byzantine empire');
    expect(normalizeTitle('red   dwarf')).toBe('Red dwarf');
  });

  it('maps equivalent raw titles to the same seed', () => {
    expect(seedToHex(systemSeed('photosynthesis'))).toBe(
      seedToHex(systemSeed('Photosynthesis')),
    );
    expect(seedToHex(systemSeed('byzantine_empire'))).toBe(
      seedToHex(systemSeed('Byzantine empire')),
    );
  });
});

describe('determinism', () => {
  it('same title -> identical draw sequence', () => {
    const a = rngForArticle('Photosynthesis');
    const b = rngForArticle('Photosynthesis');
    for (let i = 0; i < 1000; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('different titles -> different sequences', () => {
    const a = rngForArticle('Photosynthesis');
    const b = rngForArticle('Photosynthesis (album)');
    const draws = 32;
    let identical = 0;
    for (let i = 0; i < draws; i++) {
      if (a.nextUint32() === b.nextUint32()) identical++;
    }
    expect(identical).toBeLessThan(2);
  });
});

describe('fork independence (invariant #3)', () => {
  it('fork output does not depend on parent draw count', () => {
    const a = rngForArticle('Fermentation');
    const b = rngForArticle('Fermentation');
    // Disturb one parent before forking.
    for (let i = 0; i < 17; i++) b.nextUint32();
    const fa = a.fork('gates');
    const fb = b.fork('gates');
    for (let i = 0; i < 100; i++) {
      expect(fa.nextUint32()).toBe(fb.nextUint32());
    }
  });

  it('fork output does not depend on fork creation order', () => {
    const a = rngForArticle('Fermentation');
    const b = rngForArticle('Fermentation');
    const aGates = a.fork('gates');
    a.fork('bodies'); // sibling created after, on a only
    const bBodies = b.fork('bodies'); // sibling created before, on b
    const bGates = b.fork('gates');
    void bBodies;
    for (let i = 0; i < 100; i++) {
      expect(aGates.nextUint32()).toBe(bGates.nextUint32());
    }
  });

  it('differently labeled forks are decorrelated', () => {
    const root = rngForArticle('Fermentation');
    const x = root.fork('gates');
    const y = root.fork('bodies');
    let identical = 0;
    for (let i = 0; i < 32; i++) {
      if (x.nextUint32() === y.nextUint32()) identical++;
    }
    expect(identical).toBeLessThan(2);
  });
});

describe('GOLDEN VALUES — pins world stability across releases', () => {
  it('hash128 / systemSeed produce pinned values', () => {
    // If these change, every player's galaxy regenerates differently.
    expect(seedToHex(hash128('wikiverse'))).toMatchInlineSnapshot(
      `"979d9ede556218f8da2ed0f418d156d2"`,
    );
    expect(seedToHex(systemSeed('Photosynthesis'))).toMatchInlineSnapshot(
      `"efd84ffe9185d78655e6d69d2bbb4ee5"`,
    );
  });

  it('first draws from a pinned seed are stable', () => {
    const r = rngForArticle('Photosynthesis');
    const draws = Array.from({ length: 4 }, () => r.nextUint32());
    expect(draws).toMatchInlineSnapshot(`
      [
        3265048534,
        2868304156,
        2110042940,
        51687398,
      ]
    `);
  });
});

describe('distribution sanity', () => {
  it('float() stays in [0,1) and is roughly uniform', () => {
    const r = rngForArticle('Statistics');
    const n = 20_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += f;
    }
    expect(sum / n).toBeGreaterThan(0.48);
    expect(sum / n).toBeLessThan(0.52);
  });

  it('pickWeighted approximates the §4.5 outcome table', () => {
    const r = rngForArticle('Stub');
    const weights = [
      ['sparse', 50],
      ['salvage_field', 30],
      ['hazard_pocket', 15],
      ['deep_tunnel', 5],
    ] as const;
    const counts: Record<string, number> = {};
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const o = r.pickWeighted(weights);
      counts[o] = (counts[o] ?? 0) + 1;
    }
    const sparse = counts['sparse'] ?? 0;
    const tunnel = counts['deep_tunnel'] ?? 0;
    expect(sparse / n).toBeGreaterThan(0.46);
    expect(sparse / n).toBeLessThan(0.54);
    expect(tunnel / n).toBeGreaterThan(0.03);
    expect(tunnel / n).toBeLessThan(0.07);
  });

  it('int() covers its full range', () => {
    const r = rngForArticle('Dice');
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(r.int(0, 6));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
