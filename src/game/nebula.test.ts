/**
 * nebula.test.ts — the GL-free halves of the nebula (§3.4): pure parameter
 * derivation and the palette table's alignment with gen-side constants.
 */
import { describe, expect, it } from 'vitest';
import { PALETTE_COUNT } from '../gen/generate';
import { MOODS } from '../gen/lore';
import { nebulaIntensityFor, nebulaUniformsFor } from './nebula';
import { PALETTES, hexToRgb01 } from './palettes';

describe('palettes', () => {
  it('table length is pinned to gen PALETTE_COUNT', () => {
    expect(PALETTES.length).toBe(PALETTE_COUNT);
  });

  it('mood ids align index-for-index with gen/lore MOODS', () => {
    expect(PALETTES.map((p) => p.mood)).toEqual(MOODS.map((m) => m.id));
  });

  it('hexToRgb01 converts channels into 0..1', () => {
    expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb01('#04050a')).toEqual([4 / 255, 5 / 255, 10 / 255]);
    for (const p of PALETTES) {
      for (const hex of [p.nebulaA, p.nebulaB, p.nebulaC]) {
        for (const c of hexToRgb01(hex)) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('nebulaUniformsFor', () => {
  it('is deterministic and in range', () => {
    const a = nebulaUniformsFor('deadbeef');
    expect(nebulaUniformsFor('deadbeef')).toEqual(a);
    expect(a.scale).toBeGreaterThanOrEqual(0.8);
    expect(a.scale).toBeLessThanOrEqual(1.6);
    expect(a.warp).toBeGreaterThanOrEqual(0.5);
    expect(a.warp).toBeLessThanOrEqual(1.2);
    for (const v of [...a.offset1, ...a.offset2]) {
      expect(Math.abs(v)).toBeLessThanOrEqual(100);
    }
  });

  it('distinct seeds give distinct cloud shapes', () => {
    expect(nebulaUniformsFor('aaaa')).not.toEqual(nebulaUniformsFor('bbbb'));
  });
});

describe('nebulaIntensityFor', () => {
  it('damps anomalies below standard systems', () => {
    expect(nebulaIntensityFor('standard')).toBe(1);
    for (const kind of ['shattered', 'sparse', 'salvage_field', 'hazard_pocket', 'deep_tunnel'] as const) {
      expect(nebulaIntensityFor(kind)).toBeLessThan(1);
      expect(nebulaIntensityFor(kind)).toBeGreaterThan(0);
    }
  });
});
