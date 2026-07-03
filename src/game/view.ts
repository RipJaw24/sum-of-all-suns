/**
 * view.ts — shared, framework-free view helpers and HUD types. Split out of
 * renderer.ts at M3's PixiJS migration so map.ts / summary.ts / tests never
 * import the Pixi-backed renderer (keeps vitest's import graph GL-free).
 */

import type { BodySpec, GateSpec } from '../types';
import type { EmblemMotif } from './factionVisuals';

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

/**
 * M6 §13.2: draw a faction emblem motif (factionVisuals EMBLEM_BY_DISPOSITION)
 * as a small stroked glyph at (x, y), radius r. Procedural 2D — shared by the
 * HUD chip and the chart, never an asset file.
 */
export function drawEmblem(
  ctx: CanvasRenderingContext2D,
  motif: EmblemMotif,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.22);
  ctx.beginPath();
  switch (motif) {
    case 'ring': // merchant: docking torus
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'chevron': // militarist: sergeant stripes
      ctx.moveTo(-r * 0.8, 0);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(r * 0.8, 0);
      ctx.moveTo(-r * 0.8, r * 0.7);
      ctx.lineTo(0, 0);
      ctx.lineTo(r * 0.8, r * 0.7);
      ctx.stroke();
      break;
    case 'orbit': // scientific: electron path
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.45, -Math.PI / 5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'gear': { // industrial: toothed wheel
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
      }
      break;
    }
    case 'flame': // zealot: rising flame
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.9, -r * 0.1, 0, r * 0.9);
      ctx.quadraticCurveTo(-r * 0.9, -r * 0.1, 0, -r);
      ctx.stroke();
      break;
    case 'fang': // outlaw: twin fangs
      ctx.moveTo(-r * 0.7, -r * 0.6);
      ctx.lineTo(-r * 0.35, r * 0.8);
      ctx.lineTo(0, -r * 0.2);
      ctx.lineTo(r * 0.35, r * 0.8);
      ctx.lineTo(r * 0.7, -r * 0.6);
      ctx.stroke();
      break;
  }
  ctx.restore();
}
