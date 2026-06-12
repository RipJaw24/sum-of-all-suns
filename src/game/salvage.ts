/**
 * salvage.ts — derelicts in salvage_field systems (§4.5: stubs are
 * "unfinished" articles, so their systems are littered with derelicts).
 *
 * Derelicts are DERIVED world data: a pure, seeded function of the
 * SystemSpec, like renderer.ts's starfield — deliberately not stored in the
 * spec so yield tuning never churns the golden files. M3: yields scale with
 * SystemSpec.salvageRichness, the §4.5 isolation lever — the most isolated
 * stubs pay the best.
 *
 * Looting state ("which derelicts are emptied") is run state — run.ts
 * `looted` keys — never written here.
 */

import { Rng, hash128 } from '../rng';
import type { SystemSpec } from '../types';
import {
  DERELICT_CREDITS_MAX,
  DERELICT_CREDITS_MIN,
  DERELICT_FUEL_MAX,
  DERELICT_FUEL_MIN,
} from './economy';

export interface Derelict {
  id: string; // 'derelict:0' … stable within system
  x: number;
  y: number;
  fuel: number;
  credits: number;
}

/** Deterministic derelicts for a system; empty unless it's a salvage field. */
export function derelictsFor(spec: SystemSpec): Derelict[] {
  if (spec.kind !== 'salvage_field') return [];
  const rng = new Rng(hash128(`${spec.seed}/derelicts`));
  const rim = spec.gates[0]?.rimRadius ?? 520;
  // §4.5 isolation lever: richness multiplies yields (and adds a wreck at
  // the top end) AFTER the draws, so tuning never shifts the rng stream.
  const richness = spec.salvageRichness ?? 0.5;
  const mult = 0.75 + richness;
  const count = rng.int(2, 5) + (richness > 0.7 ? 1 : 0);
  return Array.from({ length: count }, (_, i) => {
    const angle = rng.angle();
    const radius = rng.range(rim * 0.25, rim * 0.85);
    return {
      id: `derelict:${i}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      fuel: Math.round(rng.int(DERELICT_FUEL_MIN, DERELICT_FUEL_MAX + 1) * mult),
      credits: Math.round(rng.int(DERELICT_CREDITS_MIN, DERELICT_CREDITS_MAX + 1) * mult),
    };
  });
}
