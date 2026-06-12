/**
 * dock.ts — station docking (§7: refuel at stations for credits; M2 scope is
 * refuel + repair, trade goods are M3). Pure quote/transaction helpers on
 * RunState plus a canvas overlay in the map.ts style. main.ts owns the
 * docked/flying mode switch; while docked the ship is parked and safe.
 */

import type { BodySpec, StationSpec } from '../types';
import {
  REFUEL_STEP,
  REPAIR_STEP,
  refuelUnitPrice,
  repairUnitPrice,
  serviceCost,
} from './economy';
import { addFuel, repairHull, spendCredits, type RunState } from './run';

export interface ServiceQuote {
  /** Units actually deliverable (capped by the relevant gauge). */
  units: number;
  cost: number;
}

export function refuelQuote(run: RunState, station: StationSpec): ServiceQuote {
  const units = Math.min(REFUEL_STEP, run.fuelMax - run.fuel);
  return { units, cost: serviceCost(units, refuelUnitPrice(station.priceLevel)) };
}

export function repairQuote(run: RunState, station: StationSpec): ServiceQuote {
  const units = Math.min(REPAIR_STEP, run.hullMax - run.hull);
  return { units, cost: serviceCost(units, repairUnitPrice(station.priceLevel)) };
}

/** Buy one refuel step. False when tank is full or credits are short. */
export function buyRefuel(run: RunState, station: StationSpec): boolean {
  const { units, cost } = refuelQuote(run, station);
  if (units <= 0 || !spendCredits(run, cost)) return false;
  addFuel(run, units);
  return true;
}

/** Buy one repair step. False when hull is full or credits are short. */
export function buyRepair(run: RunState, station: StationSpec): boolean {
  const { units, cost } = repairQuote(run, station);
  if (units <= 0 || !spendCredits(run, cost)) return false;
  repairHull(run, units);
  return true;
}

// --- overlay ----------------------------------------------------------------

export function drawDock(
  ctx: CanvasRenderingContext2D,
  body: BodySpec,
  run: RunState,
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
    `FUEL ${Math.round(run.fuel)}/${run.fuelMax}   HULL ${Math.round(run.hull)}/${run.hullMax}   ${run.credits} cr`,
    x + 20,
    y + 84,
  );

  const line = (text: string, row: number, enabled: boolean) => {
    ctx.fillStyle = enabled ? '#cdd6f4' : 'rgba(205, 214, 244, 0.35)';
    ctx.fillText(text, x + 20, y + 124 + row * 26);
  };

  const fuel = refuelQuote(run, station);
  const repair = repairQuote(run, station);
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
    line('[T] TRADE — market offline', 2, false); // goods arrive in M3
  }
  ctx.fillStyle = '#7fd4ff';
  ctx.fillText('[E] UNDOCK', x + 20, y + 124 + 3 * 26 + 10);
}
