/**
 * dock.ts — station docking (§7: refuel/repair for credits, M3 trade view).
 * Pure quote/transaction helpers on RunState plus canvas overlays in the
 * map.ts style. main.ts owns the docked/flying mode switch and the
 * services/trade view toggle; while docked the ship is parked and safe.
 */

import { goodById } from '../gen/goods';
import type { BodySpec, StationSpec, SystemSpec } from '../types';
import { REFUEL_STEP, REPAIR_STEP, serviceCost } from './economy';
import { marketGoodIds } from './market';
import {
  effectiveGoodPrice,
  effectiveRefuelUnitPrice,
  effectiveRepairUnitPrice,
} from './reputation';
import {
  CARGO_MAX,
  addCargo,
  addCredits,
  addFuel,
  cargoCount,
  removeCargo,
  repairHull,
  spendCredits,
  type RunState,
} from './run';

export interface ServiceQuote {
  /** Units actually deliverable (capped by the relevant gauge). */
  units: number;
  cost: number;
}

export function refuelQuote(spec: SystemSpec, run: RunState, station: StationSpec): ServiceQuote {
  const units = Math.min(REFUEL_STEP, run.fuelMax - run.fuel);
  return { units, cost: serviceCost(units, effectiveRefuelUnitPrice(spec, run, station)) };
}

export function repairQuote(spec: SystemSpec, run: RunState, station: StationSpec): ServiceQuote {
  const units = Math.min(REPAIR_STEP, run.hullMax - run.hull);
  return { units, cost: serviceCost(units, effectiveRepairUnitPrice(spec, run, station)) };
}

/** Buy one refuel step. False when tank is full or credits are short. */
export function buyRefuel(spec: SystemSpec, run: RunState, station: StationSpec): boolean {
  const { units, cost } = refuelQuote(spec, run, station);
  if (units <= 0 || !spendCredits(run, cost)) return false;
  addFuel(run, units);
  return true;
}

/** Buy one repair step. False when hull is full or credits are short. */
export function buyRepair(spec: SystemSpec, run: RunState, station: StationSpec): boolean {
  const { units, cost } = repairQuote(spec, run, station);
  if (units <= 0 || !spendCredits(run, cost)) return false;
  repairHull(run, units);
  return true;
}

// --- M3 trade (§7 base price × M5 faction/standing bias, reputation.ts) ------

/** Buy one unit. False when the hold is full or credits are short. */
export function buyGood(run: RunState, spec: SystemSpec, goodId: string): boolean {
  if (cargoCount(run) >= CARGO_MAX) return false;
  if (!spendCredits(run, effectiveGoodPrice(spec, run, goodId))) return false;
  addCargo(run, goodId, 1);
  return true;
}

/** Sell one held unit at the local price. False when none is held. */
export function sellGood(run: RunState, spec: SystemSpec, goodId: string): boolean {
  if (!removeCargo(run, goodId, 1)) return false;
  addCredits(run, effectiveGoodPrice(spec, run, goodId));
  return true;
}

// --- overlay ----------------------------------------------------------------

export function drawDock(
  ctx: CanvasRenderingContext2D,
  body: BodySpec,
  run: RunState,
  spec: SystemSpec,
): void {
  const station = body.station!;
  const { width, height } = ctx.canvas;
  const w = 420;
  const h = 250;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.fillStyle = 'rgba(4, 5, 10, 0.82)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(10, 14, 24, 0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#7fd4ff';
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#7fd4ff';
  ctx.font = '16px monospace';
  ctx.fillText(`DOCKED — ${station.name}`, x + 20, y + 32);
  ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
  ctx.font = '12px monospace';
  ctx.fillText(`${body.name} orbital`, x + 20, y + 50);

  ctx.fillStyle = '#cdd6f4';
  ctx.font = '13px monospace';
  ctx.fillText(
    `FUEL ${Math.round(run.fuel)}/${run.fuelMax}   HULL ${Math.round(run.hull)}/${run.hullMax}   ${run.credits} cr   CARGO ${cargoCount(run)}/${CARGO_MAX}`,
    x + 20,
    y + 84,
  );

  const line = (text: string, row: number, enabled: boolean) => {
    ctx.fillStyle = enabled ? '#cdd6f4' : 'rgba(205, 214, 244, 0.35)';
    ctx.fillText(text, x + 20, y + 124 + row * 26);
  };

  const fuel = refuelQuote(spec, run, station);
  const repair = repairQuote(spec, run, station);
  if (station.services.includes('refuel')) {
    const label =
      fuel.units > 0 ? `[R] REFUEL +${fuel.units} — ${fuel.cost} cr` : '[R] REFUEL — tank full';
    line(label, 0, fuel.units > 0 && run.credits >= fuel.cost);
  }
  if (station.services.includes('repair')) {
    const label =
      repair.units > 0
        ? `[F] REPAIR +${repair.units} — ${repair.cost} cr`
        : '[F] REPAIR — hull intact';
    line(label, 1, repair.units > 0 && run.credits >= repair.cost);
  }
  if (station.services.includes('trade')) {
    line('[T] TRADE', 2, true);
  }
  ctx.fillStyle = '#7fd4ff';
  ctx.fillText('[E] UNDOCK', x + 20, y + 124 + 3 * 26 + 10);
}

/** Trade view of the dock overlay. `cursor` indexes marketGoodIds(spec). */
export function drawTrade(
  ctx: CanvasRenderingContext2D,
  body: BodySpec,
  run: RunState,
  spec: SystemSpec,
  cursor: number,
): void {
  const station = body.station!;
  const goods = marketGoodIds(spec);
  const { width, height } = ctx.canvas;
  const w = 460;
  const h = 170 + goods.length * 22;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.fillStyle = 'rgba(4, 5, 10, 0.82)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(10, 14, 24, 0.95)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#7fd4ff';
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#7fd4ff';
  ctx.font = '16px monospace';
  ctx.fillText(`MARKET — ${station.name}`, x + 20, y + 32);
  ctx.fillStyle = '#cdd6f4';
  ctx.font = '13px monospace';
  ctx.fillText(`${run.credits} cr   CARGO ${cargoCount(run)}/${CARGO_MAX}`, x + 20, y + 58);

  goods.forEach((id, i) => {
    const good = goodById(id);
    if (!good) return;
    const price = effectiveGoodPrice(spec, run, id);
    const held = run.cargo[id] ?? 0;
    const rowY = y + 92 + i * 22;
    const selected = i === cursor;
    if (selected) {
      ctx.fillStyle = 'rgba(127, 212, 255, 0.12)';
      ctx.fillRect(x + 12, rowY - 14, w - 24, 20);
    }
    ctx.fillStyle = selected ? '#7fd4ff' : '#cdd6f4';
    ctx.fillText(`${selected ? '▸ ' : '  '}${good.name}`, x + 20, rowY);
    ctx.textAlign = 'right';
    ctx.fillStyle =
      run.credits >= price || held > 0 ? 'rgba(205, 214, 244, 0.85)' : 'rgba(205, 214, 244, 0.35)';
    ctx.fillText(`${price} cr   held ${held}`, x + w - 20, rowY);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
  ctx.fillText('[W/S] select   [B] buy   [V] sell   [T] services   [E] undock', x + 20, y + h - 20);
}
