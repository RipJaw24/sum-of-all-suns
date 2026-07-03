/**
 * map.ts — the Tab/M system chart (SPEC §5): a scaled-down read-only view of
 * the current system — orbits, bodies, gates, ship. Like renderer.ts it is a
 * STRICTLY READ-ONLY consumer of SystemSpec + run state; no world data is
 * computed here. Uncharted gates stay unscannable (§4.5): no name, no cost.
 */

import { factionById } from '../gen/factions';
import type { GateSpec, SystemSpec } from '../types';
import { factionVisual } from './factionVisuals';
import { mixHex } from './palettes';
import { GATE_COLORS, bodyPosition, drawEmblem, gatePosition } from './view';
import { jumpCost, type RunState } from './run';
import type { ShipState } from './ship';

const BODY_DOT = 4;

export function drawMap(
  ctx: CanvasRenderingContext2D,
  spec: SystemSpec,
  gates: readonly GateSpec[],
  ship: ShipState,
  run: RunState,
  t: number,
  /** M6 Phase 5: gate.id → destination faction tint, where cached. */
  gateTints: ReadonlyMap<string, string> = new Map(),
): void {
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.fillStyle = 'rgba(4, 5, 10, 0.88)';
  ctx.fillRect(0, 0, width, height);

  // Fit the whole system (rim + margin) on screen.
  const extent = (gates[0]?.rimRadius ?? 600) + 80;
  const scale = (Math.min(width, height) * 0.45) / extent;
  ctx.translate(width / 2, height / 2);

  // Orbits.
  ctx.strokeStyle = 'rgba(140, 160, 200, 0.2)';
  ctx.lineWidth = 1;
  for (const body of spec.bodies) {
    ctx.beginPath();
    ctx.arc(0, 0, body.orbitRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (spec.belt) {
    const mid = ((spec.belt.innerRadius + spec.belt.outerRadius) / 2) * scale;
    ctx.strokeStyle = 'rgba(170, 150, 120, 0.35)';
    ctx.lineWidth = (spec.belt.outerRadius - spec.belt.innerRadius) * scale;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, mid, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  // Star.
  if (spec.star) {
    ctx.fillStyle = spec.star.color;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(5, spec.star.radius * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Bodies at their CURRENT orbital position. Stationed bodies take the
  // controlling faction's color + disposition emblem (M6 Phase 5); the
  // unaligned frontier keeps the neutral cyan.
  const fv = spec.faction ? factionVisual(spec.faction.id) : null;
  const stationColor = fv?.tint ?? '#7fd4ff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  for (const body of spec.bodies) {
    const pos = bodyPosition(body, t);
    const x = pos.x * scale;
    const y = pos.y * scale;
    ctx.fillStyle = body.station ? stationColor : 'rgba(205, 214, 244, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, BODY_DOT, 0, Math.PI * 2);
    ctx.fill();
    if (body.station && fv) drawEmblem(ctx, fv.emblem, x, y - 12, 5, fv.accent);
    else if (body.station) {
      ctx.strokeStyle = stationColor;
      ctx.strokeRect(x - 3, y - 14, 6, 6); // neutral relay tick
    }
    ctx.fillStyle = 'rgba(205, 214, 244, 0.7)';
    ctx.fillText(body.name, x, y + 16);
  }

  // Gates with destination + fuel cost; uncharted stay unscannable (§4.5).
  for (const gate of gates) {
    const pos = gatePosition(gate);
    const x = pos.x * scale;
    const y = pos.y * scale;
    const s = 6;
    const ft = gateTints.get(gate.id);
    ctx.strokeStyle = ft ? mixHex(GATE_COLORS[gate.kind], ft, 0.65) : GATE_COLORS[gate.kind];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(205, 214, 244, 0.85)';
    const label =
      gate.kind === 'uncharted' ? '??? signal' : `${gate.destinationName} · ${jumpCost(gate)} fuel`;
    ctx.fillText(label, x, y - s - 6);
  }

  // Ship marker.
  ctx.save();
  ctx.translate(ship.x * scale, ship.y * scale);
  ctx.rotate(ship.heading);
  ctx.fillStyle = '#e8edf7';
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, 4);
  ctx.lineTo(-5, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();

  // Header.
  ctx.fillStyle = '#cdd6f4';
  ctx.font = '16px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`SYSTEM CHART — ${spec.name}`, 16, 28);
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
  ctx.fillText(
    `fuel ${Math.round(run.fuel)}/${run.fuelMax} · hull ${Math.round(run.hull)}/${run.hullMax}` +
      ` · ${run.credits} cr · jumps ${run.route.length - 1} · [TAB] close`,
    16,
    46,
  );
  // Controlling faction, emblem + tint matching the HUD (M6 Phase 5).
  if (fv && spec.faction) {
    const name = factionById(spec.faction.id).name;
    drawEmblem(ctx, fv.emblem, 22, 60, 6, fv.accent);
    ctx.fillStyle = fv.tint;
    ctx.fillText(name, 34, 64);
    if (spec.faction.contested) {
      const w = ctx.measureText(name).width;
      ctx.fillStyle = '#ffb35e';
      ctx.fillText(' · CONTESTED', 34 + w, 64);
    }
  }
}
