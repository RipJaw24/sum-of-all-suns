/**
 * run.ts — mutable roguelike run state, kept strictly OUT of SystemSpec
 * (types.ts invariant: world data is immutable; run state lives here, keyed
 * by titles/ids). M1 scope: fuel as the run clock (§7) and the route log —
 * which is already the Decrypt Flight Log's data (M2 builds the UI on it).
 * Hull, credits, and death handling are M2.
 */

import { systemName } from '../gen/names';
import { hash128, normalizeTitle } from '../rng';
import type { GateKind, GateSpec, SystemSpec } from '../types';

export const FUEL_MAX = 100;
export const BASE_JUMP_FUEL = 8;

const TAU = Math.PI * 2;

export interface RouteEntry {
  /** Canonical article title. SPOILER — decrypt log / debug only. */
  title: string;
  via: 'start' | GateKind;
}

export interface RunState {
  schemaVersion: 1;
  /** Article title of the system the player is in. SPOILER. */
  currentTitle: string;
  /** Where we jumped here from; drives the §4.2 return gate. */
  previousTitle?: string;
  fuel: number;
  fuelMax: number;
  route: RouteEntry[];
}

export function newRun(startTitle: string): RunState {
  const title = normalizeTitle(startTitle);
  return {
    schemaVersion: 1,
    currentTitle: title,
    fuel: FUEL_MAX,
    fuelMax: FUEL_MAX,
    route: [{ title, via: 'start' }],
  };
}

export function jumpCost(gate: Pick<GateSpec, 'fuelCostFactor'>): number {
  return Math.round(BASE_JUMP_FUEL * gate.fuelCostFactor);
}

export function canJump(run: RunState, gate: GateSpec): boolean {
  return run.fuel >= jumpCost(gate);
}

/** Commit a jump: spend fuel, move, extend the route log. */
export function applyJump(run: RunState, gate: GateSpec): void {
  run.fuel = Math.max(0, run.fuel - jumpCost(gate));
  run.previousTitle = run.currentTitle;
  run.currentTitle = gate.destinationTitle;
  run.route.push({ title: gate.destinationTitle, via: gate.kind });
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

const RUN_KEY = 'sas:run:v1';

export function saveRun(run: RunState, storage: Storage = localStorage): void {
  storage.setItem(RUN_KEY, JSON.stringify(run));
}

export function loadRun(storage: Storage = localStorage): RunState | null {
  try {
    const raw = storage.getItem(RUN_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw);
    return run?.schemaVersion === 1 && typeof run.currentTitle === 'string'
      ? (run as RunState)
      : null;
  } catch {
    return null;
  }
}

export function clearRun(storage: Storage = localStorage): void {
  storage.removeItem(RUN_KEY);
}
