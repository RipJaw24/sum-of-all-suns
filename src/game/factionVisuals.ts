/**
 * factionVisuals.ts — M6 §13.2: the renderer-side "what a faction LOOKS like"
 * table. The gen layer stores only `faction.id` + `disposition` (pure, golden-
 * tested); how that paints a station, a hull, an emblem, and UI trim is display
 * data and lives here — so visual tuning never touches goldens. This is the
 * palettes.ts discipline applied to politics.
 *
 * Faction IDENTITY rides on the per-faction `tint` (sourced straight from
 * gen/factions FACTIONS so the two tables cannot drift). Faction CHARACTER —
 * station silhouette, hull shape, emblem — derives from the fixed
 * `disposition`, so two merchant guilds share a body plan but fly different
 * colors. Appending a faction needs no change here; the table rebuilds from
 * FACTIONS and the disposition maps (both compile-time exhaustive).
 */

import { FACTIONS } from '../gen/factions';
import type { FactionDisposition, FactionId } from '../types';
import { mixHex } from './palettes';

/** Station silhouette family (Phase 1 picks the build from this). */
export type StationStyle = 'ring' | 'fortress' | 'array' | 'gantry' | 'spire' | 'scavenged';

/** NPC/player hull silhouette family (Phase 3/4). */
export type HullStyle = 'sleek' | 'blocky' | 'ornate' | 'utilitarian' | 'angular' | 'jagged';

/** Procedural emblem motif id — drawn in code (Phase 5 HUD chip), never an asset. */
export type EmblemMotif = 'ring' | 'chevron' | 'orbit' | 'gear' | 'flame' | 'fang';

export interface FactionVisual {
  id: FactionId;
  /** Structural/base color — mirrors FACTIONS[].tint exactly. */
  tint: string;
  /** Brighter trim/light/emblem-stroke color (tint lifted toward white). */
  accent: string;
  /** Station silhouette family (from disposition). */
  stationStyle: StationStyle;
  /** Hull silhouette family (from disposition). */
  hullStyle: HullStyle;
  /** Emblem motif (from disposition). */
  emblem: EmblemMotif;
}

/** disposition → station silhouette. Exhaustive by construction (Record). */
export const STATION_BY_DISPOSITION: Record<FactionDisposition, StationStyle> = {
  merchant: 'ring',
  militarist: 'fortress',
  scientific: 'array',
  industrial: 'gantry',
  zealot: 'spire',
  outlaw: 'scavenged',
};

/** disposition → hull silhouette. */
export const HULL_BY_DISPOSITION: Record<FactionDisposition, HullStyle> = {
  merchant: 'sleek',
  militarist: 'blocky',
  scientific: 'ornate',
  industrial: 'utilitarian',
  zealot: 'angular',
  outlaw: 'jagged',
};

/** disposition → emblem motif. */
export const EMBLEM_BY_DISPOSITION: Record<FactionDisposition, EmblemMotif> = {
  merchant: 'ring',
  militarist: 'chevron',
  scientific: 'orbit',
  industrial: 'gear',
  zealot: 'flame',
  outlaw: 'fang',
};

function visualFor(id: FactionId): FactionVisual {
  const f = FACTIONS.find((a) => a.id === id)!;
  return {
    id,
    tint: f.tint,
    accent: mixHex(f.tint, '#ffffff', 0.4),
    stationStyle: STATION_BY_DISPOSITION[f.disposition],
    hullStyle: HULL_BY_DISPOSITION[f.disposition],
    emblem: EMBLEM_BY_DISPOSITION[f.disposition],
  };
}

/**
 * Every faction's visual, keyed by id. Built from FACTIONS so coverage is
 * automatic: add an archetype there and its visual appears here for free.
 */
export const FACTION_VISUALS: Record<FactionId, FactionVisual> = Object.fromEntries(
  FACTIONS.map((f) => [f.id, visualFor(f.id)]),
) as Record<FactionId, FactionVisual>;

export function factionVisual(id: FactionId): FactionVisual {
  return FACTION_VISUALS[id];
}
