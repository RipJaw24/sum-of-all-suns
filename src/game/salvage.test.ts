/**
 * salvage.test.ts — derelicts are deterministic derived world data (§4.5),
 * present only in salvage fields.
 */
import { describe, expect, it } from 'vitest';
import type { SystemSpec } from '../types';
import { DERELICT_CREDITS_MAX, DERELICT_FUEL_MAX } from './economy';
import { derelictsFor } from './salvage';

const fakeSpec = (over: Partial<SystemSpec>): SystemSpec =>
  ({
    schemaVersion: 1,
    seed: 'abcd1234abcd1234abcd1234abcd1234',
    sourceTitle: 'Fake stub',
    name: 'Fake',
    kind: 'salvage_field',
    star: null,
    bodies: [],
    gates: [],
    ambient: { paletteId: 0, nebulaSeed: 'n' },
    traffic: 0,
    ...over,
  }) as SystemSpec;

describe('derelictsFor', () => {
  it('returns nothing outside salvage fields', () => {
    expect(derelictsFor(fakeSpec({ kind: 'standard' }))).toEqual([]);
    expect(derelictsFor(fakeSpec({ kind: 'sparse' }))).toEqual([]);
  });

  it('is deterministic per system seed', () => {
    const spec = fakeSpec({});
    expect(derelictsFor(spec)).toEqual(derelictsFor(spec));
    expect(derelictsFor(fakeSpec({ seed: 'ffff0000ffff0000ffff0000ffff0000' }))).not.toEqual(
      derelictsFor(spec),
    );
  });

  it('spawns 2–4 wrecks inside the rim with bounded yields (richness 0.5 default)', () => {
    const derelicts = derelictsFor(fakeSpec({}));
    const mult = 0.75 + 0.5; // default richness when the spec carries none
    expect(derelicts.length).toBeGreaterThanOrEqual(2);
    expect(derelicts.length).toBeLessThanOrEqual(4);
    for (const d of derelicts) {
      expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(520 * 0.85 + 1e-9);
      expect(d.fuel).toBeGreaterThan(0);
      expect(d.fuel).toBeLessThanOrEqual(Math.round(DERELICT_FUEL_MAX * mult));
      expect(d.credits).toBeGreaterThan(0);
      expect(d.credits).toBeLessThanOrEqual(Math.round(DERELICT_CREDITS_MAX * mult));
    }
    expect(new Set(derelicts.map((d) => d.id)).size).toBe(derelicts.length);
  });

  it('richer fields pay more (§4.5 isolation lever) and add a wreck at the top end', () => {
    const poor = derelictsFor(fakeSpec({ salvageRichness: 0.2 }));
    const rich = derelictsFor(fakeSpec({ salvageRichness: 1 }));
    const total = (ds: typeof poor) => ds.reduce((s, d) => s + d.fuel + d.credits, 0);
    expect(total(rich)).toBeGreaterThan(total(poor));
    expect(rich.length).toBe(poor.length + 1); // richness > 0.7 bonus wreck
  });
});
