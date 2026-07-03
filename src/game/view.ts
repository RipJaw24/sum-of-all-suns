/**
 * view.ts — shared, framework-free view helpers and HUD types. Split out of
 * renderer.ts at M3's PixiJS migration so map.ts / summary.ts / tests never
 * import the Pixi-backed renderer (keeps vitest's import graph GL-free).
 */

import type { BodySpec, GateSpec } from '../types';

export const BODY_COLORS: Record<BodySpec['type'], string> = {
  rocky: '#a08a72',
  ice: '#bcd8e8',
  gas_giant: '#d8a86a',
  lava: '#d2543a',
  ocean: '#3a78c2',
};

export const GATE_COLORS: Record<GateSpec['kind'], string> = {
  charted: '#7fd4ff',
  uncharted: '#ffb35e',
  wormhole: '#c98fff',
};

/** Bottom-center interact prompt; main.ts decides text per interactable. */
export interface HudPrompt {
  text: string;
  tone: 'ok' | 'warn';
}

/** Everything the HUD shows. Assembled by main.ts each frame. */
export interface HudState {
  fuel: number;
  fuelMax: number;
  hull: number;
  hullMax: number;
  credits: number;
  /** M3 trade hold: units carried / capacity. */
  cargo: number;
  cargoMax: number;
  jumps: number;
  /** M4 survive-N goal: jumps needed for victory (§2). */
  goalJumps: number;
  /** M5 §13: controlling faction + the player's standing with it. null =
   *  unaligned frontier; undefined = don't show (assembled by main.ts). */
  faction?: {
    name: string;
    /** Faction tint hex, for the name color. */
    tint: string;
    contested: boolean;
    standing: number;
  } | null;
  prompt: HudPrompt | null;
  /** Secondary hint under the main prompt (e.g. '[Q] scan …'). */
  subPrompt?: string;
  /** e.g. degraded-telemetry warning. */
  notice?: string;
  /** Active hazard warning, e.g. 'ASTEROID IMPACTS'. */
  hazardLabel?: string;
  /** §7 stranded state: fuel-out with no rescue in-system. */
  adrift?: boolean;
  /** 0..1 recent-damage intensity; drives the red vignette. */
  damageFlash?: number;
  /** M6: main thrust held this frame; drives the ship's engine plume. */
  thrusting?: boolean;
}

/** Orbital position at time t (types.ts convention). */
export function bodyPosition(body: BodySpec, t: number): { x: number; y: number } {
  const angle = body.initialAngle + ((Math.PI * 2) / body.orbitPeriodSec) * t;
  return { x: Math.cos(angle) * body.orbitRadius, y: Math.sin(angle) * body.orbitRadius };
}

export function gatePosition(gate: GateSpec): { x: number; y: number } {
  return { x: Math.cos(gate.angle) * gate.rimRadius, y: Math.sin(gate.angle) * gate.rimRadius };
}
