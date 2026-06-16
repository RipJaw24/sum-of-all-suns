/**
 * events.ts — §16 random events, in two flavors, both laundered from metadata:
 *
 *  1. SEEDED system events (seededEvent): a characteristic, deterministic
 *     event baked from the article's metadata — the same for every player,
 *     stable and shareable. Pure of run state, derived like market.ts pricing
 *     (no SystemSpec field, no golden change). Mostly atmosphere in M5.
 *
 *  2. RUNTIME encounters (rollEncounter + the distress helpers): ephemeral,
 *     seeded-spawn events triggered during a visit that read live run state
 *     and resolve into it — ambushes (reuse combat) and distress calls.
 *
 * The Erasure foreshadow (§16) is a rare seeded class (erasure_omen): pure
 * flavor in M5 — it commits nothing — but plants the thread so The Erasure
 * (§12, the M8 capstone) arrives as payoff, not surprise.
 */

import { factionById } from '../gen/factions';
import { Rng, hash128 } from '../rng';
import type { FactionId, SystemSpec } from '../types';
import { STANDING_DELTA, standingOf } from './reputation';
import type { RunState } from './run';

// --- 1. seeded system events (deterministic flavor) --------------------------

export type SystemEventKind =
  | 'quiet'
  | 'bloom'
  | 'market_surge'
  | 'derelict_convoy'
  | 'pilgrimage'
  | 'erasure_omen';

export interface SystemEvent {
  kind: SystemEventKind;
  /** Laundered one-line flavor for the arrival note (never raw Wikipedia). */
  headline: string;
}

const HEADLINES: Record<SystemEventKind, readonly string[]> = {
  quiet: ['QUIET SPACE — ONLY YOUR REACTOR HUM', 'NO TRAFFIC ON THE LOCAL BAND'],
  bloom: [
    'A LIVING BLOOM TIDES ACROSS THE SYSTEM — BIOSIGNATURES EVERYWHERE',
    'SPORE-LIGHT DRIFTS BETWEEN THE WORLDS',
  ],
  market_surge: [
    'A TRADE SURGE HAS THE LOCAL MARKET ROARING',
    'FREIGHTERS CROWD THE LANES — PRICES RUN HOT',
  ],
  derelict_convoy: [
    'THE BONES OF A LOST CONVOY DRIFT HERE',
    'A GRAVEYARD OF HULLS — SALVAGE FOR THE BRAVE',
  ],
  pilgrimage: [
    'A PILGRIM FLEET GATHERS AT THE INNER WORLDS',
    'CHOIR-SHIPS HOLD A VIGIL IN CLOSE ORBIT',
  ],
  erasure_omen: [
    'A NEIGHBORING STAR IS SIMPLY GONE — REFUGEES SPEAK OF SOMETHING THAT UNMAKES SYSTEMS',
    'SENSORS GHOST WHERE A GATE DESTINATION USED TO RESOLVE — THE VOID IS WRONG HERE',
    'SURVIVORS DRIFT IN, RAVING ABOUT A DARKNESS THAT EATS WHOLE SUNS',
  ],
};

/** Rarity of the §16 Erasure foreshadow, among eligible systems. */
export const ERASURE_CHANCE = 0.04;

function pickEventKind(spec: SystemSpec, rng: Rng): SystemEventKind {
  // The rare Erasure foreshadow needs a "neighbor" to have gone dark, so it
  // only haunts living standard systems — never a dead anomaly.
  if (spec.kind === 'standard' && rng.chance(ERASURE_CHANCE)) return 'erasure_omen';
  if (spec.kind === 'salvage_field' || spec.kind === 'deep_tunnel') return 'derelict_convoy';
  if (spec.biome === 'verdant' && (spec.habitation === 'teeming' || spec.habitation === 'settled')) {
    return 'bloom';
  }
  if (spec.traffic >= 0.6) return 'market_surge';
  if (spec.faction && factionById(spec.faction.id).disposition === 'zealot') return 'pilgrimage';
  return 'quiet';
}

/** The deterministic system event for a system — same for every player (§16.1). */
export function seededEvent(spec: SystemSpec): SystemEvent {
  const rng = new Rng(hash128(`${spec.seed}/event`));
  const kind = pickEventKind(spec, rng);
  return { kind, headline: rng.pick(HEADLINES[kind]) };
}

// --- 2. runtime encounters (ephemeral, seeded spawn) -------------------------

export type EncounterKind = 'none' | 'ambush' | 'distress';

/**
 * §16.2 — roll a runtime encounter on arrival from the passed (ephemeral) rng.
 * Ambushes concentrate in lawless / hostile / busy space; distress calls drift
 * in populated space. Reads live run state (standing) so the galaxy reacts to
 * the player. Often returns 'none' — encounters are spice, not every visit.
 */
export function rollEncounter(spec: SystemSpec, run: RunState, rng: Rng): EncounterKind {
  const frontier = spec.faction === null;
  const contested = spec.faction?.contested ?? false;
  const lowStanding = spec.faction ? standingOf(run, spec.faction.id) < 0 : false;

  let ambush = 0;
  if (frontier) ambush += 0.25;
  if (contested) ambush += 0.2;
  if (lowStanding) ambush += 0.2;
  ambush += spec.traffic * 0.1;

  let distress = 0;
  if (spec.habitation === 'settled' || spec.habitation === 'teeming') distress += 0.2;
  if (!frontier) distress += 0.1;

  const roll = rng.float();
  if (roll < ambush) return 'ambush';
  if (roll < ambush + distress) return 'distress';
  return 'none';
}

/** Number of hostiles in an ambush wave (§16.2). */
export function ambushSize(rng: Rng): number {
  return rng.int(2, 4); // 2–3
}

export interface DistressBeacon {
  id: string;
  x: number;
  y: number;
  /** A pirate trap rather than a genuine call for help (§16.2). */
  trap: boolean;
}

/** Place a distress beacon out in the system; lawless/contested space is more
 *  often a trap. Position + trap roll come from the ephemeral rng. */
export function makeDistress(spec: SystemSpec, rng: Rng): DistressBeacon {
  const rim = spec.gates[0]?.rimRadius ?? 600;
  const ang = rng.angle();
  const dist = rng.range(160, rim * 0.8);
  const trapChance = spec.faction === null || spec.faction.contested ? 0.5 : 0.25;
  return {
    id: 'distress:0',
    x: Math.cos(ang) * dist,
    y: Math.sin(ang) * dist,
    trap: rng.chance(trapChance),
  };
}

export interface DistressOutcome {
  trap: boolean;
  credits: number;
  fuel: number;
  /** Faction whose standing the rescue earns (the system's controller), if any. */
  standingFaction: FactionId | null;
  standingDelta: number;
}

/**
 * Resolve answering a distress call (§16.2). A genuine call rewards credits +
 * fuel and earns the system faction's goodwill; a trap returns nothing (the
 * caller springs the ambush). Run mutations are applied by the caller.
 */
export function resolveDistress(beacon: DistressBeacon, spec: SystemSpec, rng: Rng): DistressOutcome {
  const standingFaction = spec.faction?.id ?? null;
  if (beacon.trap) {
    return { trap: true, credits: 0, fuel: 0, standingFaction, standingDelta: 0 };
  }
  return {
    trap: false,
    credits: rng.int(25, 61),
    fuel: rng.int(8, 21),
    standingFaction,
    standingDelta: STANDING_DELTA.killEnemy, // a rescued crew speaks well of you
  };
}
