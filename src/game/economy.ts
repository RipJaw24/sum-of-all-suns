/**
 * economy.ts — M2 economy tuning, in one place (§7). Pure functions and
 * constants only: prices scale with StationSpec.priceLevel (0..1, derived
 * from pageview traffic at generation time), yields are seeded off the
 * system seed so they're deterministic per world, not per run.
 *
 * Fuel constants (FUEL_MAX, BASE_JUMP_FUEL) predate this module and live
 * in run.ts; everything M2 adds is tuned here.
 */

import { Rng, hash128 } from '../rng';

export const HULL_MAX = 100;
export const START_CREDITS = 60;

// --- station services (§7: refuel at stations for credits) -------------------

/** Units bought per menu press while docked. */
export const REFUEL_STEP = 10;
export const REPAIR_STEP = 10;

/** Credits per unit of fuel. priceLevel 0..1 -> 1..3 cr. */
export function refuelUnitPrice(priceLevel: number): number {
  return Math.max(1, Math.round(1 + priceLevel * 2));
}

/** Credits per unit of hull. Repairs run pricier than fuel. */
export function repairUnitPrice(priceLevel: number): number {
  return Math.max(1, Math.round(1.5 + priceLevel * 2.5));
}

/** Cost of buying `units` at `unitPrice`, rounded against the player. */
export function serviceCost(units: number, unitPrice: number): number {
  return Math.ceil(units * unitPrice);
}

// --- gas giant skimming (§7: slow, hazardous refuel of last resort) ----------

export const SKIM_FUEL_PER_SEC = 4;
export const SKIM_HULL_DPS = 1.5;

// --- mining (rocky/lava bodies, one-time per run) ----------------------------

/** Deterministic credit yield for mining a body. Seeded by world, not run. */
export function miningYield(systemSeed: string, bodyId: string): number {
  return new Rng(hash128(`${systemSeed}/mine:${bodyId}`)).int(8, 21);
}

// --- salvage (§4.5 salvage_field derelicts; full table in salvage.ts) --------

export const DERELICT_FUEL_MIN = 10;
export const DERELICT_FUEL_MAX = 25;
export const DERELICT_CREDITS_MIN = 15;
export const DERELICT_CREDITS_MAX = 45;

// --- hazards (§7: hull damaged by hazards; hull = 0 -> run over) --------------

/** One-time hull hit when arriving in a hazard_pocket system (§4.5). */
export const HAZARD_POCKET_ENTRY_DAMAGE = 15;
/** Stellar hazard (pulsar etc.) inside star.hazardRadius. */
export const STAR_HAZARD_DPS = 6;
/** Asteroid belt: base + density-scaled (§3.2 reference density). */
export const BELT_BASE_DPS = 2;
export const BELT_DENSITY_DPS = 6;
/** System-wide ambient hazards (category-derived, §3.2). */
export const AMBIENT_RADIATION_DPS = 0.8;
export const AMBIENT_STORM_DPS = 1.2;
