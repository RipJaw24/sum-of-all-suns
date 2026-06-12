/**
 * renderer.ts — Canvas2D view of a SystemSpec. STRICTLY READ-ONLY consumer
 * of the spec (SPEC §9): no world data is computed here, only pixels.
 * PixiJS replaces this at M3; keep it dumb.
 */

import { Rng, hash128 } from '../rng';
import type { BodySpec, GateSpec, SystemSpec } from '../types';
import type { Derelict } from './salvage';
import type { ShipState } from './ship';

const BODY_COLORS: Record<BodySpec['type'], string> = {
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
}

interface StarfieldDot {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

/** Orbital position at time t (types.ts convention). */
export function bodyPosition(body: BodySpec, t: number): { x: number; y: number } {
  const angle = body.initialAngle + ((Math.PI * 2) / body.orbitPeriodSec) * t;
  return { x: Math.cos(angle) * body.orbitRadius, y: Math.sin(angle) * body.orbitRadius };
}

export function gatePosition(gate: GateSpec): { x: number; y: number } {
  return { x: Math.cos(gate.angle) * gate.rimRadius, y: Math.sin(gate.angle) * gate.rimRadius };
}

export class Renderer {
  private starfield: StarfieldDot[] = [];
  private fieldExtent = 0;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  /** (Re)build the seeded backdrop for a system. */
  setSystem(spec: SystemSpec): void {
    const rim = spec.gates[0]?.rimRadius ?? 600;
    this.fieldExtent = rim + 900;
    const rng = new Rng(hash128(`${spec.seed}/starfield`));
    this.starfield = Array.from({ length: 500 }, () => ({
      x: rng.range(-this.fieldExtent, this.fieldExtent),
      y: rng.range(-this.fieldExtent, this.fieldExtent),
      r: rng.range(0.4, 1.6),
      alpha: rng.range(0.25, 0.9),
    }));
  }

  /** `gates` is the active list (spec gates + any §4.2 injected return gate);
   *  `derelicts` is the unlooted remainder (salvage.ts, filtered by main.ts). */
  draw(
    spec: SystemSpec,
    gates: readonly GateSpec[],
    ship: ShipState,
    t: number,
    hud: HudState,
    derelicts: readonly Derelict[] = [],
  ): void {
    const { ctx } = this;
    const { width, height } = ctx.canvas;
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    // Camera: ship locked to screen center.
    ctx.translate(width / 2 - ship.x, height / 2 - ship.y);

    this.drawStarfield(ctx);
    this.drawOrbitsAndBelt(ctx, spec);
    if (spec.star) this.drawStar(ctx, spec, t);
    for (const body of spec.bodies) this.drawBody(ctx, body, t);
    for (const derelict of derelicts) this.drawDerelict(ctx, derelict);
    for (const gate of gates) this.drawGate(ctx, gate, t);
    this.drawShip(ctx, ship);
    ctx.restore();

    if (hud.damageFlash && hud.damageFlash > 0) this.drawDamageVignette(ctx, hud.damageFlash);
    this.drawHud(ctx, spec, hud);
  }

  private drawStarfield(ctx: CanvasRenderingContext2D): void {
    for (const s of this.starfield) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = '#cdd6f4';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  private drawOrbitsAndBelt(ctx: CanvasRenderingContext2D, spec: SystemSpec): void {
    ctx.strokeStyle = 'rgba(140, 160, 200, 0.12)';
    ctx.lineWidth = 1;
    for (const body of spec.bodies) {
      ctx.beginPath();
      ctx.arc(0, 0, body.orbitRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (spec.belt) {
      const mid = (spec.belt.innerRadius + spec.belt.outerRadius) / 2;
      const width = spec.belt.outerRadius - spec.belt.innerRadius;
      ctx.strokeStyle = `rgba(170, 150, 120, ${0.1 + spec.belt.density * 0.25})`;
      ctx.lineWidth = width;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, mid, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
    // Gate rim ring.
    const rim = spec.gates[0]?.rimRadius;
    if (rim) {
      ctx.strokeStyle = 'rgba(127, 212, 255, 0.08)';
      ctx.beginPath();
      ctx.arc(0, 0, rim, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawStar(ctx: CanvasRenderingContext2D, spec: SystemSpec, t: number): void {
    const star = spec.star!;
    const draw = (x: number, r: number) => {
      const glow = ctx.createRadialGradient(x, 0, r * 0.4, x, 0, r * 3);
      glow.addColorStop(0, star.color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, 0, r * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(x, 0, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (star.class === 'binary') {
      const sep = star.radius * 1.6;
      draw(-sep, star.radius * 0.8);
      draw(sep, star.radius * 0.65);
    } else if (star.class === 'pulsar') {
      draw(0, star.radius * (1 + 0.15 * Math.sin(t * 12))); // strobe
    } else {
      draw(0, star.radius);
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, body: BodySpec, t: number): void {
    const pos = bodyPosition(body, t);
    ctx.fillStyle = BODY_COLORS[body.type];
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, body.radius, 0, Math.PI * 2);
    ctx.fill();
    if (body.hasRings) {
      ctx.strokeStyle = 'rgba(220, 210, 180, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, body.radius * 1.9, body.radius * 0.6, 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    for (const moon of body.moons) {
      const ma = moon.initialAngle + ((Math.PI * 2) / moon.orbitPeriodSec) * t;
      ctx.fillStyle = '#9aa0ae';
      ctx.beginPath();
      ctx.arc(
        pos.x + Math.cos(ma) * moon.orbitRadius,
        pos.y + Math.sin(ma) * moon.orbitRadius,
        moon.radius,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    if (body.station) {
      ctx.strokeStyle = '#7fd4ff';
      ctx.strokeRect(pos.x + body.radius + 6, pos.y - 4, 8, 8);
    }
    ctx.fillStyle = 'rgba(205, 214, 244, 0.75)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(body.name, pos.x, pos.y + body.radius + 16);
  }

  private drawGate(ctx: CanvasRenderingContext2D, gate: GateSpec, t: number): void {
    const pos = gatePosition(gate);
    const size = 12;
    // Uncharted gates flicker (§4.5): no steady ping.
    const flicker =
      gate.kind === 'uncharted' ? 0.35 + 0.65 * Math.abs(Math.sin(t * 5 + gate.angle * 7)) : 1;
    ctx.globalAlpha = flicker;
    ctx.strokeStyle = GATE_COLORS[gate.kind];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - size);
    ctx.lineTo(pos.x + size, pos.y);
    ctx.lineTo(pos.x, pos.y + size);
    ctx.lineTo(pos.x - size, pos.y);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
    // Charted gates show where they lead; uncharted are unscannable (§4.5).
    if (gate.kind !== 'uncharted') {
      ctx.fillStyle = 'rgba(205, 214, 244, 0.7)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(gate.destinationName, pos.x, pos.y - size - 8);
    }
    ctx.globalAlpha = 1;
  }

  private drawDerelict(ctx: CanvasRenderingContext2D, d: Derelict): void {
    ctx.save();
    ctx.translate(d.x, d.y);
    // Wreck: broken hull silhouette, dim.
    ctx.rotate((hash128(d.id)[0] / 0x1_0000_0000) * Math.PI * 2);
    ctx.strokeStyle = 'rgba(170, 175, 190, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, 6);
    ctx.moveTo(-3, 1);
    ctx.lineTo(-7, -6);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.restore();
    ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('derelict', d.x, d.y + 20);
  }

  private drawDamageVignette(ctx: CanvasRenderingContext2D, intensity: number): void {
    const { width, height } = ctx.canvas;
    const g = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.35,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7,
    );
    g.addColorStop(0, 'rgba(255, 60, 30, 0)');
    g.addColorStop(1, `rgba(255, 60, 30, ${0.45 * Math.min(1, intensity)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  private drawShip(ctx: CanvasRenderingContext2D, ship: ShipState): void {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.heading);
    ctx.fillStyle = '#e8edf7';
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-8, 7);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, spec: SystemSpec, hud: HudState): void {
    ctx.fillStyle = '#cdd6f4';
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(spec.name, 16, 28);
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
    ctx.fillText(`${spec.kind} system · jumps ${hud.jumps} · [TAB] chart`, 16, 46);

    const bar = (y: number, frac: number, color: string, label: string) => {
      ctx.fillStyle = 'rgba(205, 214, 244, 0.25)';
      ctx.fillRect(16, y, 140, 8);
      ctx.fillStyle = frac < 0.25 ? '#ff6b4a' : color;
      ctx.fillRect(16, y, 140 * Math.max(0, frac), 8);
      ctx.fillStyle = 'rgba(205, 214, 244, 0.8)';
      ctx.fillText(label, 164, y + 8);
    };
    // Fuel is the run clock; hull is the other way to die (§7).
    bar(56, hud.fuel / hud.fuelMax, '#7fd4ff', `FUEL ${Math.round(hud.fuel)}/${hud.fuelMax}`);
    bar(72, hud.hull / hud.hullMax, '#9ee887', `HULL ${Math.round(hud.hull)}/${hud.hullMax}`);
    ctx.fillStyle = 'rgba(205, 214, 244, 0.8)';
    ctx.fillText(`${hud.credits} cr · CARGO ${hud.cargo}/${hud.cargoMax}`, 16, 100);

    let noticeY = 120;
    if (hud.hazardLabel) {
      ctx.fillStyle = '#ff6b4a';
      ctx.fillText(`⚠ ${hud.hazardLabel}`, 16, noticeY);
      noticeY += 18;
    }
    if (hud.notice) {
      ctx.fillStyle = '#ffb35e';
      ctx.fillText(hud.notice, 16, noticeY);
    }

    if (hud.adrift) {
      ctx.textAlign = 'center';
      ctx.font = '16px monospace';
      ctx.fillStyle = '#ff6b4a';
      ctx.fillText('SHIP ADRIFT — FUEL EXHAUSTED, NO RESCUE IN SYSTEM', ctx.canvas.width / 2, 96);
      ctx.font = '13px monospace';
      ctx.fillText('[X] END RUN', ctx.canvas.width / 2, 118);
    }

    if (hud.prompt) {
      ctx.textAlign = 'center';
      ctx.font = '14px monospace';
      ctx.fillStyle = hud.prompt.tone === 'ok' ? '#7fd4ff' : '#ff6b4a';
      ctx.fillText(hud.prompt.text, ctx.canvas.width / 2, ctx.canvas.height - 40);
    }
    if (hud.subPrompt) {
      ctx.textAlign = 'center';
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
      ctx.fillText(hud.subPrompt, ctx.canvas.width / 2, ctx.canvas.height - 20);
    }
  }
}
