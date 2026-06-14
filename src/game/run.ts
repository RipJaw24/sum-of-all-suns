/**
 * run.ts — mutable roguelike run state, kept strictly OUT of SystemSpec
 * (types.ts invariant: world data is immutable; run state lives here, keyed
 * by titles/ids). M2 scope (§7): fuel as the run clock, hull, credits,
 * one-time loot tracking, and death — by hull breach or stranding. The
 * route log doubles as the Decrypt Flight Log's data (summary.ts).
 */

import { systemName } from '../gen/names';
import { hash128, normalizeTitle } from '../rng';
import type { FactionId, GateKind, GateSpec, SystemSpec } from '../types';
import { HULL_MAX, START_CREDITS } from './economy';
import { effectiveCargoValue, effectiveRefuelUnitPrice } from './reputation';
import { derelictsFor } from './salvage';

export const FUEL_MAX = 100;
export const BASE_JUMP_FUEL = 8;
/** M3 trade: total units of goods the ship can carry. */
export const CARGO_MAX = 10;
/** M4 run goal (§2): survive this many jumps. Tunable; ?goal= overrides. */
export const DEFAULT_GOAL_JUMPS = 15;

const TAU = Math.PI * 2;

export interface RouteEntry {
  /** Canonical article title. SPOILER — decrypt log / debug only. */
  title: string;
  via: 'start' | GateKind;
}

// 'destroyed' (M5 §15) = a hostile landed the killing blow; 'hull' stays the
// cause for environmental hull loss (hazards, skim, hazard-pocket entry).
export type DeathCause = 'hull' | 'adrift' | 'abandoned' | 'destroyed';

export interface RunState {
  schemaVersion: 5;
  /** Article title of the system the player is in. SPOILER. */
  currentTitle: string;
  /** Where we jumped here from; drives the §4.2 return gate. */
  previousTitle?: string;
  fuel: number;
  fuelMax: number;
  hull: number;
  hullMax: number;
  credits: number;
  /** M3 trade hold: goodId -> units. Total capped at CARGO_MAX. */
  cargo: Record<string, number>;
  /** One-time pickup/event keys ("<title>/<id>"): mined bodies, emptied
   *  derelicts, hazard-pocket entry hits. See lootKey(). */
  looted: string[];
  status: 'active' | 'dead' | 'won';
  deathCause?: DeathCause;
  route: RouteEntry[];
  /** M4 run goal: jumps to survive for victory (§2). */
  goalJumps: number;
  /** M5 §13.3: per-faction reputation in [−100, +100], absent = neutral 0.
   *  Per-run for v1; persistent cross-run standing is meta-progression (§12).
   *  Mutated via game/reputation.ts; gates prices, patrol hostility, services. */
  standing: Partial<Record<FactionId, number>>;
}

export function newRun(startTitle: string, goalJumps: number = DEFAULT_GOAL_JUMPS): RunState {
  const title = normalizeTitle(startTitle);
  return {
    schemaVersion: 5,
    currentTitle: title,
    fuel: FUEL_MAX,
    fuelMax: FUEL_MAX,
    hull: HULL_MAX,
    hullMax: HULL_MAX,
    credits: START_CREDITS,
    cargo: {},
    looted: [],
    status: 'active',
    route: [{ title, via: 'start' }],
    goalJumps: Math.max(1, Math.round(goalJumps)),
    standing: {},
  };
}

export function jumpsMade(run: RunState): number {
  return run.route.length - 1;
}

// --- §7 resources: hull, credits, fuel, loot -------------------------------

/** Apply hull damage. Returns true when this hit ends the run. `cause` lets
 *  combat (§15) record a killing blow as 'destroyed' while environmental
 *  damage stays 'hull'; both are hull-zero deaths through the same path. */
export function damageHull(
  run: RunState,
  amount: number,
  cause: 'hull' | 'destroyed' = 'hull',
): boolean {
  if (run.status !== 'active') return false;
  run.hull = Math.max(0, run.hull - amount);
  if (run.hull <= 0) {
    run.status = 'dead';
    run.deathCause = cause;
    return true;
  }
  return false;
}

export function repairHull(run: RunState, amount: number): void {
  run.hull = Math.min(run.hullMax, run.hull + amount);
}

export function addFuel(run: RunState, amount: number): void {
  run.fuel = Math.min(run.fuelMax, run.fuel + amount);
}

export function addCredits(run: RunState, amount: number): void {
  run.credits += amount;
}

/** Deduct if affordable; returns false (and changes nothing) otherwise. */
export function spendCredits(run: RunState, amount: number): boolean {
  if (run.credits < amount) return false;
  run.credits -= amount;
  return true;
}

// --- M3 cargo hold ------------------------------------------------------------

export function cargoCount(run: RunState): number {
  return Object.values(run.cargo).reduce((s, n) => s + n, 0);
}

/** Add up to `qty` units, capped by hold space. Returns units actually added. */
export function addCargo(run: RunState, goodId: string, qty: number): number {
  const space = Math.max(0, CARGO_MAX - cargoCount(run));
  const added = Math.min(space, qty);
  if (added > 0) run.cargo[goodId] = (run.cargo[goodId] ?? 0) + added;
  return added;
}

/** Remove `qty` units if held; returns false (and changes nothing) otherwise. */
export function removeCargo(run: RunState, goodId: string, qty: number): boolean {
  const held = run.cargo[goodId] ?? 0;
  if (held < qty) return false;
  if (held === qty) delete run.cargo[goodId];
  else run.cargo[goodId] = held - qty;
  return true;
}

/** Declare the run lost to stranding (player-acknowledged, see isStranded). */
export function declareAdrift(run: RunState): void {
  run.status = 'dead';
  run.deathCause = 'adrift';
}

/** M4 pause menu's Abandon Run: ends the run but keeps the flight log —
 *  abandonment still earns its Decrypt (summary.ts), it isn't a save-wipe. */
export function declareAbandoned(run: RunState): void {
  if (run.status !== 'active') return;
  run.status = 'dead';
  run.deathCause = 'abandoned';
}

export function lootKey(title: string, id: string): string {
  return `${normalizeTitle(title)}/${id}`;
}

export function isLooted(run: RunState, title: string, id: string): boolean {
  return run.looted.includes(lootKey(title, id));
}

export function markLooted(run: RunState, title: string, id: string): void {
  if (!isLooted(run, title, id)) run.looted.push(lootKey(title, id));
}

/**
 * Stranded = the run is unwinnable on fuel (§7 "death: fuel-out"): every
 * gate is unaffordable even after converting all credits to station fuel,
 * and there's no gas giant to skim and no unlooted derelict fuel. The game
 * surfaces this as an "ADRIFT — END RUN" prompt rather than killing
 * silently, so the player understands why the run ended.
 */
export function isStranded(run: RunState, gates: readonly GateSpec[], spec: SystemSpec): boolean {
  if (run.status !== 'active') return false;
  if (gates.length === 0) return true;
  const cheapest = Math.min(...gates.map(jumpCost));
  if (run.fuel >= cheapest) return false;

  // Station fuel, limited by what the player can pay for — counting what the
  // hold would liquidate for where the station also trades (M3): a player
  // sitting on sellable cargo is not stranded.
  const station = spec.bodies.find((b) => b.station?.services.includes('refuel'))?.station;
  if (station) {
    // Use the SAME faction/standing-adjusted prices the dock will charge, so
    // the safety check can't say "affordable" then leave the player soft-locked.
    const sellable = station.services.includes('trade') ? effectiveCargoValue(spec, run) : 0;
    const buyable = Math.floor(
      (run.credits + sellable) / effectiveRefuelUnitPrice(spec, run, station),
    );
    if (run.fuel + buyable >= cheapest) return false;
  }
  // Gas giants can always be skimmed (slow and hull-hazardous — that risk is
  // the player's to take; running out of hull is its own death).
  if (spec.bodies.some((b) => b.site.resource === 'fuel_skim')) return false;
  // Unlooted derelict fuel in salvage fields.
  const derelictFuel = derelictsFor(spec)
    .filter((d) => !isLooted(run, spec.sourceTitle, d.id))
    .reduce((sum, d) => sum + d.fuel, 0);
  if (run.fuel + derelictFuel >= cheapest) return false;

  return true;
}

export function jumpCost(gate: Pick<GateSpec, 'fuelCostFactor'>): number {
  return Math.round(BASE_JUMP_FUEL * gate.fuelCostFactor);
}

export function canJump(run: RunState, gate: GateSpec): boolean {
  return run.fuel >= jumpCost(gate);
}

/** Commit a jump: spend fuel, move, extend the route log. Completing the
 *  goalJumps-th jump wins the run (§2 survive-N) — the arrival still plays
 *  out; main.ts routes to the victory summary after the fade-in. */
export function applyJump(run: RunState, gate: GateSpec): void {
  run.fuel = Math.max(0, run.fuel - jumpCost(gate));
  run.previousTitle = run.currentTitle;
  run.currentTitle = gate.destinationTitle;
  run.route.push({ title: gate.destinationTitle, via: gate.kind });
  if (run.status === 'active' && jumpsMade(run) >= run.goalJumps) run.status = 'won';
}

// --- §4.2 bidirectionality ----------------------------------------------------

export const RETURN_GATE_ID = 'gate:return';

/** Deterministic slot in the largest angular gap between existing gates, so
 *  the injected gate never overlaps a generated one. */
function returnGateAngle(spec: SystemSpec, fromTitle: string): number {
  const angles = spec.gates.map((g) => ((g.angle % TAU) + TAU) % TAU).sort((a, b) => a - b);
  if (angles.length === 0) {
    return (hash128(`${spec.seed}/return:${fromTitle}`)[0] / 0x1_0000_0000) * TAU;
  }
  let bestGap = -1;
  let bestMid = 0;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i]!;
    const b = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + TAU;
    if (b - a > bestGap) {
      bestGap = b - a;
      bestMid = (a + b) / 2;
    }
  }
  return bestMid % TAU;
}

/**
 * The gates actually usable in a system: the spec's own, plus — when the
 * article we arrived from isn't linked back — an injected RETURN gate
 * ("a gate you arrived through always works in reverse", §4.2). The
 * injection is a run-state overlay; the SystemSpec is never mutated.
 */
export function gatesFor(spec: SystemSpec, arrivedFrom: string | undefined): GateSpec[] {
  if (!arrivedFrom) return [...spec.gates];
  const from = normalizeTitle(arrivedFrom);
  if (spec.gates.some((g) => g.destinationTitle === from)) return [...spec.gates];
  const rimRadius = spec.gates[0]?.rimRadius ?? 520;
  return [
    ...spec.gates,
    {
      id: RETURN_GATE_ID,
      destinationTitle: from,
      destinationName: systemName(from),
      kind: 'charted',
      angle: returnGateAngle(spec, from),
      rimRadius,
      fuelCostFactor: 1,
    },
  ];
}

// --- persistence ----------------------------------------------------------------

// v2: M2 added hull/credits/looted/status. v1 saves were discarded (prototype
// phase). v3: M3 added the cargo hold — v2 saves migrate in place (cargo: {}).
// v4: M4 added goalJumps + the 'won' status — v2/v3 saves migrate in place.
// v5: M5 added per-faction standing — v2/v3/v4 saves migrate in place ({}).
const RUN_KEY = 'sas:run:v5';
const RUN_KEY_V4 = 'sas:run:v4';
const RUN_KEY_V3 = 'sas:run:v3';
const RUN_KEY_V2 = 'sas:run:v2';

export function saveRun(run: RunState, storage: Storage = localStorage): void {
  storage.setItem(RUN_KEY, JSON.stringify(run));
}

/** Upgrade a v2/v3/v4 save to v5 (each adds the fields its version lacked).
 *  Returns null for anything else. */
function migrateLegacy(raw: string): RunState | null {
  const run = JSON.parse(raw);
  if (typeof run?.currentTitle !== 'string') return null;
  if (run.schemaVersion === 2) {
    return { ...run, schemaVersion: 5, cargo: {}, goalJumps: DEFAULT_GOAL_JUMPS, standing: {} } as RunState;
  }
  if (run.schemaVersion === 3) {
    return { ...run, schemaVersion: 5, goalJumps: DEFAULT_GOAL_JUMPS, standing: {} } as RunState;
  }
  if (run.schemaVersion === 4) {
    return { ...run, schemaVersion: 5, standing: {} } as RunState;
  }
  return null;
}

export function loadRun(storage: Storage = localStorage): RunState | null {
  try {
    const raw = storage.getItem(RUN_KEY);
    if (raw) {
      const run = JSON.parse(raw);
      return run?.schemaVersion === 5 && typeof run.currentTitle === 'string'
        ? (run as RunState)
        : null;
    }
    for (const key of [RUN_KEY_V4, RUN_KEY_V3, RUN_KEY_V2]) {
      const old = storage.getItem(key);
      if (!old) continue;
      const migrated = migrateLegacy(old);
      storage.removeItem(key);
      if (migrated) {
        saveRun(migrated, storage);
        return migrated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function clearRun(storage: Storage = localStorage): void {
  storage.removeItem(RUN_KEY);
}
