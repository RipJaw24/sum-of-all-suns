/**
 * reputation.ts — §13.3 per-faction standing, a pure helper layer over the
 * RunState.standing map (run.ts owns the field; this owns the rules). Mirrors
 * market.ts/salvage.ts: deterministic functions of run state, no I/O.
 *
 * Standing is per-run for M5 (persistent cross-run standing is meta-
 * progression, §12). Effects, wired in later phases:
 *   - station price multiplier (Phase 5: market/dock)
 *   - patrol hostility threshold (Phase 6: agents/combat)
 *   - faction-locked services / gates (later)
 */

import { factionById } from '../gen/factions';
import type { FactionDisposition, FactionId, StationSpec, SystemSpec } from '../types';
import { refuelUnitPrice, repairUnitPrice } from './economy';
import { priceFor } from './market';
import type { RunState } from './run';

export const STANDING_MIN = -100;
export const STANDING_MAX = 100;
export const STANDING_NEUTRAL = 0;

/** At/below this, a faction's patrols turn hostile on sight (§13.3). */
export const STANDING_HOSTILE_FLOOR = -50;

/** Max ± fraction the station price swings across the standing range (§13.3):
 *  +100 → ×(1−swing) (allied discount), −100 → ×(1+swing) (pariah markup). */
export const STANDING_PRICE_SWING = 0.2;

/** Standard standing deltas reused by trades/events/kills (tunable levers). */
export const STANDING_DELTA = {
  trade: 2, // a sale at a faction station (Phase 5)
  killEnemy: 5, // destroying a pirate / a rival's hostile in their space (§13.3)
  attackShip: -15, // firing on a faction patrol/trader (§13.3)
  smuggle: -8, // contraband caught at an inspection (§16)
} as const;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Current standing with a faction; absent = neutral. */
export function standingOf(run: RunState, faction: FactionId): number {
  return run.standing[faction] ?? STANDING_NEUTRAL;
}

/** Apply a delta, clamped to [MIN, MAX]. Returns the new standing. No-op for
 *  a faction-less context (callers pass null for unaligned frontier). */
export function adjustStanding(
  run: RunState,
  faction: FactionId | null,
  delta: number,
): number {
  if (faction === null) return STANDING_NEUTRAL;
  const next = clamp(standingOf(run, faction) + delta, STANDING_MIN, STANDING_MAX);
  run.standing[faction] = next;
  return next;
}

/** Station price multiplier from a standing value (§13.3). Friendly → cheaper,
 *  hostile → pricier; neutral → 1. Pure function of the number so callers can
 *  apply it to any quote (refuel/repair/trade). */
export function standingPriceMultiplier(standing: number): number {
  const m = 1 - (standing / STANDING_MAX) * STANDING_PRICE_SWING;
  return clamp(m, 1 - STANDING_PRICE_SWING, 1 + STANDING_PRICE_SWING);
}

/** Whether a faction's patrols attack the player on sight (§13.3, §15.2). */
export function patrolsHostile(run: RunState, faction: FactionId): boolean {
  return standingOf(run, faction) <= STANDING_HOSTILE_FLOOR;
}

// --- station pricing (§13.2 disposition bias × §13.3 standing) ----------------

export type PriceKind = 'trade' | 'refuel' | 'repair';

/** Unaligned frontier (§13.1): no patrols, best salvage, WORST prices. */
export const FRONTIER_PRICE_MULT = 1.15;

/** Disposition × service price bias (§13.2): merchants discount goods,
 *  militarists discount repair/refuel, outlaws gouge services, etc. Modest —
 *  the base priceLevel (traffic) and standing do the heavy lifting. */
const DISPOSITION_PRICE_BIAS: Record<FactionDisposition, Record<PriceKind, number>> = {
  merchant:   { trade: 0.85, refuel: 1.0,  repair: 1.0  },
  militarist: { trade: 1.05, refuel: 0.9,  repair: 0.85 },
  industrial: { trade: 0.95, refuel: 0.85, repair: 0.95 },
  scientific: { trade: 1.0,  refuel: 1.0,  repair: 0.9  },
  zealot:     { trade: 1.1,  refuel: 1.0,  repair: 1.0  },
  outlaw:     { trade: 0.9,  refuel: 1.1,  repair: 1.1  },
};

/**
 * §13.2/§13.3 — the full price multiplier at a system's station: the
 * controlling faction's disposition bias times the player's standing with it.
 * Unaligned frontier has no faction, so it just carries the frontier markup.
 * Pure of the spec (not stored) — tuning never touches goldens.
 */
export function factionPriceMultiplier(spec: SystemSpec, run: RunState, kind: PriceKind): number {
  const faction = spec.faction;
  if (!faction) return FRONTIER_PRICE_MULT;
  const disposition = factionById(faction.id).disposition;
  return standingPriceMultiplier(standingOf(run, faction.id)) * DISPOSITION_PRICE_BIAS[disposition][kind];
}

/** Apply a multiplier to a base price, kept an integer ≥ 1 (like the §7 base
 *  price helpers it wraps). */
function applyMult(base: number, mult: number): number {
  return Math.max(1, Math.round(base * mult));
}

export function effectiveRefuelUnitPrice(spec: SystemSpec, run: RunState, station: StationSpec): number {
  return applyMult(refuelUnitPrice(station.priceLevel), factionPriceMultiplier(spec, run, 'refuel'));
}

export function effectiveRepairUnitPrice(spec: SystemSpec, run: RunState, station: StationSpec): number {
  return applyMult(repairUnitPrice(station.priceLevel), factionPriceMultiplier(spec, run, 'repair'));
}

/** A good's price at this station, faction- and standing-adjusted. Buy and
 *  sell use the SAME value, so a same-station roundtrip stays a credit no-op
 *  (market.ts invariant) even as the multiplier shifts between systems. */
export function effectiveGoodPrice(spec: SystemSpec, run: RunState, goodId: string): number {
  return applyMult(priceFor(spec, goodId), factionPriceMultiplier(spec, run, 'trade'));
}

/** What the held cargo liquidates for at this station's effective prices. */
export function effectiveCargoValue(spec: SystemSpec, run: RunState): number {
  return Object.entries(run.cargo).reduce(
    (sum, [id, qty]) => sum + effectiveGoodPrice(spec, run, id) * qty,
    0,
  );
}
