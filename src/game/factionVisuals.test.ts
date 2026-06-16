/**
 * factionVisuals.test.ts — pins the M6 faction visual table to gen/factions,
 * the same alignment guardrail nebula.test.ts puts on PALETTES↔MOODS. The
 * Record<FactionDisposition, …> maps are exhaustive at compile time; these
 * tests pin the runtime shape and the table↔FACTIONS coverage.
 */
import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../gen/factions';
import {
  EMBLEM_BY_DISPOSITION,
  FACTION_VISUALS,
  HULL_BY_DISPOSITION,
  STATION_BY_DISPOSITION,
  factionVisual,
} from './factionVisuals';

const HEX = /^#[0-9a-f]{6}$/;
const channelSum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
};

describe('FACTION_VISUALS', () => {
  it('covers exactly the gen FACTIONS ids', () => {
    expect(Object.keys(FACTION_VISUALS).sort()).toEqual(FACTIONS.map((f) => f.id).sort());
  });

  it('tint mirrors gen/factions and accent is a lighter, valid hex', () => {
    for (const f of FACTIONS) {
      const v = factionVisual(f.id);
      expect(v.tint).toBe(f.tint);
      expect(v.accent).toMatch(HEX);
      // Accent is the tint lifted toward white, so it must be strictly brighter.
      expect(channelSum(v.accent)).toBeGreaterThan(channelSum(v.tint));
    }
  });

  it('character (station/hull/emblem) derives from the disposition maps', () => {
    for (const f of FACTIONS) {
      const v = factionVisual(f.id);
      expect(v.stationStyle).toBe(STATION_BY_DISPOSITION[f.disposition]);
      expect(v.hullStyle).toBe(HULL_BY_DISPOSITION[f.disposition]);
      expect(v.emblem).toBe(EMBLEM_BY_DISPOSITION[f.disposition]);
    }
  });

  it('every disposition present in FACTIONS resolves in all three maps', () => {
    for (const d of new Set(FACTIONS.map((f) => f.disposition))) {
      expect(STATION_BY_DISPOSITION[d]).toBeDefined();
      expect(HULL_BY_DISPOSITION[d]).toBeDefined();
      expect(EMBLEM_BY_DISPOSITION[d]).toBeDefined();
    }
  });
});
