/**
 * habitationVisuals.ts — M6 §14: the renderer-side "how alive does this place
 * LOOK" table. gen stores only the pure `habitation` tier and `biome` hint
 * (golden-tested); the scale, light density, and surface tint they paint are
 * display data and live here, so tuning never touches goldens (the palettes.ts
 * discipline). habitation = how crowded (station size, light count, night-side
 * city glow); biome = what kind of place (surface tint, light hue).
 */

import type { BiomeHint, HabitationTier } from '../types';

export interface HabitationVisual {
  /** Multiplier on station structure scale — teeming hubs loom, sterile relays shrink. */
  stationScale: number;
  /** 0..1 density of blinking station lights. */
  stationLights: number;
  /** 0..1 density of night-side city lights on inhabited worlds (0 = dark). */
  cityLights: number;
}

/** Exhaustive by construction (Record over the tier union). Values rise
 *  monotonically with crowding so the axis reads at a glance. */
export const HABITATION_VISUALS: Record<HabitationTier, HabitationVisual> = {
  sterile: { stationScale: 0.8, stationLights: 0.1, cityLights: 0.0 },
  frontier: { stationScale: 0.95, stationLights: 0.35, cityLights: 0.15 },
  settled: { stationScale: 1.1, stationLights: 0.65, cityLights: 0.5 },
  teeming: { stationScale: 1.35, stationLights: 1.0, cityLights: 1.0 },
};

export interface BiomeVisual {
  /** '#rrggbb' nudged into the planet surface palette for this biome. */
  surfaceTint: string;
  /** 0..1 strength of the surface-tint nudge. */
  tintStrength: number;
  /** Night-side city-light hue for inhabited worlds of this biome.
   *  '#000000' = no lights (barren hosts no life — see types.ts §14). */
  lightColor: string;
}

export const BIOME_VISUALS: Record<BiomeHint, BiomeVisual> = {
  verdant: { surfaceTint: '#3fae5a', tintStrength: 0.28, lightColor: '#ffd98a' },
  industrial: { surfaceTint: '#b5703a', tintStrength: 0.22, lightColor: '#ff9a3a' },
  civic: { surfaceTint: '#6a8fd0', tintStrength: 0.18, lightColor: '#ffe8b0' },
  machine: { surfaceTint: '#7d8a99', tintStrength: 0.26, lightColor: '#8ad7ff' },
  barren: { surfaceTint: '#9a8b7a', tintStrength: 0.12, lightColor: '#000000' },
};

export function habitationVisual(tier: HabitationTier): HabitationVisual {
  return HABITATION_VISUALS[tier];
}

export function biomeVisual(biome: BiomeHint): BiomeVisual {
  return BIOME_VISUALS[biome];
}
