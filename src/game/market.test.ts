/**
 * market.test.ts — per-system pricing (§7): bounds, the traffic tilt that
 * creates trade routes, market listings, and buy/sell round-trips.
 */
import { describe, expect, it } from 'vitest';
import { generateSystem } from '../gen/generate';
import { photosynthesis } from '../gen/fixtures';
import { GOODS } from '../gen/goods';
import type { SystemSpec } from '../types';
import { buyGood, sellGood } from './dock';
import { MARKET_MIN_GOODS, cargoValue, marketGoodIds, priceFor } from './market';
import { CARGO_MAX, cargoCount, newRun } from './run';

const standard = generateSystem(photosynthesis);

/** Minimal spec; pricing only reads seed + traffic (+ bodies for listings). */
function fakeSpec(over: Partial<SystemSpec>): SystemSpec {
  return {
    schemaVersion: 2,
    seed: 'feedfacefeedfacefeedfacefeedface',
    sourceTitle: 'Fake',
    name: 'Fake',
    kind: 'standard',
    star: null,
    bodies: [],
    gates: [],
    ambient: { paletteId: 0, nebulaSeed: 'n' },
    faction: null,
    habitation: 'sterile',
    biome: 'barren',
    traffic: 0,
    ...over,
  } as SystemSpec;
}

const rareGood = GOODS.find((g) => g.tier === 'rare')!;
const commonGood = GOODS.find((g) => g.tier === 'common')!;

describe('priceFor (§7 pricing)', () => {
  it('is deterministic and ≥ 1 for every good', () => {
    for (const g of GOODS) {
      const p = priceFor(standard, g.id);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(p)).toBe(true);
      expect(priceFor(standard, g.id)).toBe(p);
    }
  });

  it('stays within base × [0.7, 1.3) × tilt bounds', () => {
    for (const g of GOODS) {
      const p = priceFor(standard, g.id);
      // Widest possible tilt across tiers is [0.85, 1.15].
      expect(p).toBeGreaterThanOrEqual(Math.floor(g.basePrice * 0.7 * 0.85));
      expect(p).toBeLessThanOrEqual(Math.ceil(g.basePrice * 1.3 * 1.15));
    }
  });

  it('traffic tilts rares up and commons down (the route engine)', () => {
    const quiet = fakeSpec({ traffic: 0 });
    const busy = fakeSpec({ traffic: 1 });
    // Same seed -> same local factor; only the tilt differs.
    expect(priceFor(busy, rareGood.id)).toBeGreaterThan(priceFor(quiet, rareGood.id));
    expect(priceFor(busy, commonGood.id)).toBeLessThan(priceFor(quiet, commonGood.id));
  });

  it('prices differ across systems for the same good', () => {
    const a = fakeSpec({ seed: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const b = fakeSpec({ seed: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    const differs = GOODS.some((g) => priceFor(a, g.id) !== priceFor(b, g.id));
    expect(differs).toBe(true);
  });
});

describe('marketGoodIds', () => {
  it('lists at least MARKET_MIN_GOODS distinct table goods, deterministically', () => {
    const ids = marketGoodIds(standard);
    expect(ids.length).toBeGreaterThanOrEqual(MARKET_MIN_GOODS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(marketGoodIds(standard)).toEqual(ids);
  });

  it('includes every good the system bodies supply', () => {
    const ids = marketGoodIds(standard);
    for (const body of standard.bodies) {
      for (const id of body.site.goodIds) expect(ids).toContain(id);
    }
  });
});

describe('buy/sell (dock.ts transactions)', () => {
  it('same-station buy-then-sell is credit-neutral', () => {
    const run = newRun('Photosynthesis');
    const before = run.credits;
    expect(buyGood(run, standard, commonGood.id)).toBe(true);
    expect(cargoCount(run)).toBe(1);
    expect(run.credits).toBe(before - priceFor(standard, commonGood.id));
    expect(sellGood(run, standard, commonGood.id)).toBe(true);
    expect(run.credits).toBe(before);
    expect(cargoCount(run)).toBe(0);
  });

  it('buy fails broke or full; sell fails when not held', () => {
    const run = newRun('Photosynthesis');
    expect(sellGood(run, standard, commonGood.id)).toBe(false);
    run.credits = 0;
    expect(buyGood(run, standard, commonGood.id)).toBe(false);
    run.credits = 100_000;
    for (let i = 0; i < CARGO_MAX; i++) expect(buyGood(run, standard, commonGood.id)).toBe(true);
    expect(cargoCount(run)).toBe(CARGO_MAX);
    expect(buyGood(run, standard, commonGood.id)).toBe(false); // hold full
  });
});

describe('cargoValue', () => {
  it('sums qty × local price', () => {
    const cargo = { [rareGood.id]: 2, [commonGood.id]: 1 };
    expect(cargoValue(cargo, standard)).toBe(
      2 * priceFor(standard, rareGood.id) + priceFor(standard, commonGood.id),
    );
    expect(cargoValue({}, standard)).toBe(0);
  });
});
