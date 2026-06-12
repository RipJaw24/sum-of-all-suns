/**
 * hazards.ts — §7 hull damage sources, as a pure sample of the SystemSpec at
 * a position: star hazard radius (pulsar etc.), asteroid belt occupancy, and
 * system-wide ambient hazards. main.ts applies `dps * dt` to run.hull each
 * frame; this module computes, never mutates.
 *
 * Ambient 'debris' is visual-only for now (the belt already covers localized
 * impact damage); radiation and storms tick everywhere in-system.
 */

import type { SystemSpec } from '../types';
import {
  AMBIENT_RADIATION_DPS,
  AMBIENT_STORM_DPS,
  BELT_BASE_DPS,
  BELT_DENSITY_DPS,
  STAR_HAZARD_DPS,
} from './economy';

export interface HazardSample {
  dps: number;
  /** HUD warning text. */
  label: string;
}

/** Strongest hazard acting at (x, y), or null when in clean space. */
export function hazardAt(spec: SystemSpec, x: number, y: number): HazardSample | null {
  const dist = Math.hypot(x, y);
  let worst: HazardSample | null = null;
  const consider = (dps: number, label: string) => {
    if (dps > 0 && (!worst || dps > worst.dps)) worst = { dps, label };
  };

  if (spec.star && spec.star.hazardRadius > 0 && dist < spec.star.hazardRadius) {
    consider(STAR_HAZARD_DPS, 'STELLAR RADIATION');
  }
  if (spec.belt && dist >= spec.belt.innerRadius && dist <= spec.belt.outerRadius) {
    consider(BELT_BASE_DPS + spec.belt.density * BELT_DENSITY_DPS, 'ASTEROID IMPACTS');
  }
  if (spec.ambient.hazard === 'radiation') consider(AMBIENT_RADIATION_DPS, 'AMBIENT RADIATION');
  if (spec.ambient.hazard === 'storm') consider(AMBIENT_STORM_DPS, 'ION STORM');

  return worst;
}
