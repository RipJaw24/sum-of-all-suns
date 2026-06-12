/**
 * salvage.ts — derelicts in salvage_field systems (§4.5: stubs are
 * "unfinished" articles, so their systems are littered with derelicts).
 *
 * Derelicts are DERIVED world data: a pure, seeded function of the
 * SystemSpec, like renderer.ts's starfield — deliberately not stored in the
 * spec so M2 doesn't churn the golden files. M3's anomaly pass can promote
 * them into SystemSpec proper (and add the §4.5 isolation-scaled yields,
 * which need inbound-link data we don't snapshot yet).
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
  const count = rng.int(2, 5);
  return Array.from({ length: count }, (_, i) => {
    const angle = rng.angle();
    const radius = rng.range(rim * 0.25, rim * 0.85);
    return {
      id: `derelict:${i}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      fuel: rng.int(DERELICT_FUEL_MIN, DERELICT_FUEL_MAX + 1),
      credits: rng.int(DERELICT_CREDITS_MIN, DERELICT_CREDITS_MAX + 1),
    };
  });
}
