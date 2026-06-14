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

import type { FactionId } from '../types';
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
