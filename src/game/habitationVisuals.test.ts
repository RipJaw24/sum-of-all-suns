/**
 * habitationVisuals.test.ts — pins the M6 habitation/biome visual tables: full
 * enum coverage, valid hex, in-range densities, and the monotonic crowding axis
 * (teeming looks busier than sterile) that makes the tier read at a glance.
 */
import { describe, expect, it } from 'vitest';
import type { BiomeHint, HabitationTier } from '../types';
import { BIOME_VISUALS, HABITATION_VISUALS, biomeVisual, habitationVisual } from './habitationVisuals';

const HEX = /^#[0-9a-f]{6}$/;
const TIERS: readonly HabitationTier[] = ['sterile', 'frontier', 'settled', 'teeming'];
const BIOMES: readonly BiomeHint[] = ['verdant', 'industrial', 'civic', 'machine', 'barren'];

describe('HABITATION_VISUALS', () => {
  it('covers every tier', () => {
    expect(Object.keys(HABITATION_VISUALS).sort()).toEqual([...TIERS].sort());
  });

  it('densities are in 0..1 and scale is positive', () => {
    for (const tier of TIERS) {
      const v = habitationVisual(tier);
      expect(v.stationScale).toBeGreaterThan(0);
      for (const d of [v.stationLights, v.cityLights]) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every field rises monotonically with crowding', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const lo = habitationVisual(TIERS[i - 1]!);
      const hi = habitationVisual(TIERS[i]!);
      expect(hi.stationScale).toBeGreaterThan(lo.stationScale);
      expect(hi.stationLights).toBeGreaterThan(lo.stationLights);
      expect(hi.cityLights).toBeGreaterThanOrEqual(lo.cityLights);
    }
  });

  it('sterile worlds are dark', () => {
    expect(habitationVisual('sterile').cityLights).toBe(0);
  });
});

describe('BIOME_VISUALS', () => {
  it('covers every biome', () => {
    expect(Object.keys(BIOME_VISUALS).sort()).toEqual([...BIOMES].sort());
  });

  it('tints are valid hex with an in-range strength', () => {
    for (const biome of BIOMES) {
      const v = biomeVisual(biome);
      expect(v.surfaceTint).toMatch(HEX);
      expect(v.lightColor).toMatch(HEX);
      expect(v.tintStrength).toBeGreaterThanOrEqual(0);
      expect(v.tintStrength).toBeLessThanOrEqual(1);
    }
  });

  it('barren hosts no life, so its night side stays dark', () => {
    expect(biomeVisual('barren').lightColor).toBe('#000000');
  });
});
