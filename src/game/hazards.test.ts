/**
 * hazards.test.ts — §7 hull damage sampling: belts, stellar hazard radius,
 * ambient hazards, clean space.
 */
import { describe, expect, it } from 'vitest';
import type { SystemSpec } from '../types';
import {
  AMBIENT_RADIATION_DPS,
  AMBIENT_STORM_DPS,
  BELT_BASE_DPS,
  BELT_DENSITY_DPS,
  STAR_HAZARD_DPS,
} from './economy';
import { hazardAt } from './hazards';

const base: SystemSpec = {
  schemaVersion: 1,
  seed: '00000000000000000000000000000000',
  sourceTitle: 'Fake',
  name: 'Fake',
  kind: 'standard',
  star: { class: 'main_sequence', radius: 40, color: '#fff', hazardRadius: 0 },
  bodies: [],
  gates: [],
  ambient: { paletteId: 0, nebulaSeed: 'n' },
  traffic: 0,
};

describe('hazardAt', () => {
  it('returns null in clean space', () => {
    expect(hazardAt(base, 300, 0)).toBeNull();
  });

  it('belt occupancy deals density-scaled damage, only inside the ring', () => {
    const spec = { ...base, belt: { innerRadius: 100, outerRadius: 200, density: 0.5 } };
    expect(hazardAt(spec, 150, 0)).toEqual({
      dps: BELT_BASE_DPS + 0.5 * BELT_DENSITY_DPS,
      label: 'ASTEROID IMPACTS',
    });
    expect(hazardAt(spec, 99, 0)).toBeNull();
    expect(hazardAt(spec, 0, 201)).toBeNull();
  });

  it('stellar hazard radius (pulsar etc.) bites inside, not outside', () => {
    const spec = {
      ...base,
      star: { class: 'pulsar' as const, radius: 30, color: '#fff', hazardRadius: 220 },
    };
    expect(hazardAt(spec, 100, 0)).toEqual({ dps: STAR_HAZARD_DPS, label: 'STELLAR RADIATION' });
    expect(hazardAt(spec, 230, 0)).toBeNull();
  });

  it('ambient radiation/storm tick system-wide; debris is visual-only', () => {
    const rad = { ...base, ambient: { ...base.ambient, hazard: 'radiation' as const } };
    expect(hazardAt(rad, 5000, 5000)?.dps).toBe(AMBIENT_RADIATION_DPS);
    const storm = { ...base, ambient: { ...base.ambient, hazard: 'storm' as const } };
    expect(hazardAt(storm, 0, 0)?.dps).toBe(AMBIENT_STORM_DPS);
    const debris = { ...base, ambient: { ...base.ambient, hazard: 'debris' as const } };
    expect(hazardAt(debris, 0, 0)).toBeNull();
  });

  it('reports the strongest hazard when several overlap', () => {
    const spec = {
      ...base,
      star: { class: 'pulsar' as const, radius: 30, color: '#fff', hazardRadius: 220 },
      ambient: { ...base.ambient, hazard: 'radiation' as const },
    };
    expect(hazardAt(spec, 100, 0)?.label).toBe('STELLAR RADIATION');
  });
});
