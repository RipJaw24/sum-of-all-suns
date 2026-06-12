/**
 * goods.ts — the static trade-goods table and the section-title -> goods
 * derivation (SPEC §6: "word-frequency-derived trade goods — nouns hashed
 * into a goods table, never shown raw").
 *
 * RULES (same laundering contract as names.ts):
 *  - Wiki section titles are HASH INPUT ONLY. The displayed name always
 *    comes from this table — our own vocabulary, never wiki text.
 *  - goodsForSectionTitle is pure and galaxy-global: the same section
 *    heading ("History", "Habitat", …) supplies the same goods in every
 *    system, which is what makes trade routes topic-coherent.
 *  - Table is FROZEN once shipped — edits reshuffle every market in the
 *    galaxy (acceptable pre-release; bump GEN_VERSION if changed after).
 */

import { GEN_VERSION, Rng, SEED_SALT, hash128 } from '../rng';

export type GoodTier = 'common' | 'uncommon' | 'rare';

export interface GoodDef {
  id: string;
  /** Display name — ours, never wiki-derived. */
  name: string;
  tier: GoodTier;
  /** Credits before per-system modulation (market.ts). */
  basePrice: number;
}

export const GOODS: readonly GoodDef[] = [
  // common — bulk freight (base 6–12 cr)
  { id: 'ferrite-slag', name: 'Ferrite Slag', tier: 'common', basePrice: 6 },
  { id: 'water-ice', name: 'Water Ice', tier: 'common', basePrice: 7 },
  { id: 'polymer-stock', name: 'Polymer Stock', tier: 'common', basePrice: 8 },
  { id: 'ration-paste', name: 'Ration Paste', tier: 'common', basePrice: 9 },
  { id: 'scrap-alloy', name: 'Scrap Alloy', tier: 'common', basePrice: 10 },
  { id: 'silicate-dust', name: 'Silicate Dust', tier: 'common', basePrice: 12 },
  // uncommon — manufactured (base 14–24 cr)
  { id: 'cryo-cells', name: 'Cryo Cells', tier: 'uncommon', basePrice: 14 },
  { id: 'vat-proteins', name: 'Vat Proteins', tier: 'uncommon', basePrice: 16 },
  { id: 'optic-filament', name: 'Optic Filament', tier: 'uncommon', basePrice: 18 },
  { id: 'inert-gas', name: 'Inert Gas', tier: 'uncommon', basePrice: 20 },
  { id: 'coil-wire', name: 'Coil Wire', tier: 'uncommon', basePrice: 22 },
  { id: 'spore-cultures', name: 'Spore Cultures', tier: 'uncommon', basePrice: 24 },
  // rare — the reason to fly somewhere obscure (base 30–60 cr)
  { id: 'isotope-cores', name: 'Isotope Cores', tier: 'rare', basePrice: 30 },
  { id: 'void-pearls', name: 'Void Pearls', tier: 'rare', basePrice: 38 },
  { id: 'archive-crystals', name: 'Archive Crystals', tier: 'rare', basePrice: 46 },
  { id: 'strange-ore', name: 'Strange Ore', tier: 'rare', basePrice: 60 },
] as const;

const BY_ID = new Map(GOODS.map((g) => [g.id, g]));

export function goodById(id: string): GoodDef | undefined {
  return BY_ID.get(id);
}

/** Pick weights: commons everywhere, rares scarce — scarcity is the value. */
const TIER_WEIGHT: Record<GoodTier, number> = { common: 4, uncommon: 2, rare: 1 };
const PICK_TABLE: ReadonlyArray<readonly [string, number]> = GOODS.map(
  (g) => [g.id, TIER_WEIGHT[g.tier]] as const,
);

/**
 * Goods supplied by the body a section spawned (1–2 distinct ids).
 * Pure hash of the normalized section heading — no Rng fork of the system
 * seed, so populating goodIds never shifts any other generation stream.
 */
export function goodsForSectionTitle(sectionTitle: string): string[] {
  const norm = sectionTitle.trim().toLowerCase().replace(/\s+/g, ' ');
  const rng = new Rng(hash128(`${SEED_SALT}:${GEN_VERSION}:goods:${norm}`));
  const first = rng.pickWeighted(PICK_TABLE);
  if (!rng.chance(0.4)) return [first];
  const second = rng.pickWeighted(PICK_TABLE);
  return second === first ? [first] : [first, second];
}
