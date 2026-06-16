/**
 * factions.ts — §13: factions as "palettes-but-for-politics". A faction is a
 * static archetype (like STAR_VISUALS); only the ASSIGNMENT is data-driven.
 *
 * THE KEYSTONE (§13): assignment uses MinHash over a coarsened category (or
 * P31) signature. Because linked articles share categories, the lowest-hashing
 * shared token tends to win in BOTH — so neighbours land in the same faction
 * and contiguous territory falls out of the link graph for free. The grain
 * (noise filter + FACTIONS count + CONTESTED_TRAFFIC) is the tuning lever:
 * aim for runs crossing ~2–4 systems per faction before a border.
 *
 * PURITY (types.ts invariant): factionFor reads only ArticleMetadata + traffic
 * and hashes with hash128 — NEVER an Rng draw. It cannot shift any existing
 * generation stream; it only ADDS the faction field to SystemSpec. (This is
 * why M5 bumps SystemSpec.schemaVersion but NOT GEN_VERSION.)
 *
 * P31 (§17.2) is the PRIMARY lever when present — a real ontological type is a
 * more stable signal than category soup — with the coarsened category hash as
 * the load-bearing fallback (decided 2026-06-14: P31 is lazy, may be absent).
 */

import { hash128 } from '../rng';
import type { ArticleMetadata, FactionDisposition, FactionId, FactionRef } from '../types';
import { topicalCategories } from './categories';

export interface FactionArchetype {
  id: FactionId;
  /** In-fiction display name — laundered, never a Wikipedia string. */
  name: string;
  disposition: FactionDisposition;
  /** Tint blended into the §3.4 ambient palette (§13.2; consumed Phase 3/M6). */
  tint: string;
  /** Onset bias for the §3.3 naming layer (consumed Phase 3). */
  phonemes: readonly string[];
}

/**
 * 6–8 curated archetypes (§13.1). Order is STABLE and load-bearing: the
 * assignment indexes this array by hash modulo its length, so appending a
 * faction is safe but reordering or removing one remaps existing territory.
 */
export const FACTIONS: readonly FactionArchetype[] = [
  { id: 'helion_compact',    name: 'Helion Compact',     disposition: 'merchant',   tint: '#f2b65a', phonemes: ['vel', 'sa', 'lo', 'mi'] },
  { id: 'karn_ascendancy',   name: 'Karn Ascendancy',    disposition: 'militarist', tint: '#e0564a', phonemes: ['kr', 'dr', 'ka', 'gor'] },
  { id: 'orrery_collegium',  name: 'Orrery Collegium',   disposition: 'scientific', tint: '#5ad7f2', phonemes: ['th', 'sy', 'ae', 'lo'] },
  { id: 'vossik_combine',    name: 'Vossik Combine',     disposition: 'industrial', tint: '#9aa6b2', phonemes: ['vo', 'sk', 'tor', 'gr'] },
  { id: 'lattice_choir',     name: 'Lattice Choir',      disposition: 'zealot',     tint: '#c08af2', phonemes: ['li', 'sha', 'ael', 'no'] },
  { id: 'ashfall_cartel',    name: 'Ashfall Cartel',     disposition: 'outlaw',     tint: '#8a8f99', phonemes: ['ash', 'kx', 'rk', 'za'] },
  { id: 'mirec_concord',     name: 'Mirec Concord',      disposition: 'merchant',   tint: '#6ad79a', phonemes: ['mi', 're', 'co', 'la'] },
  { id: 'sable_directorate', name: 'Sable Directorate',  disposition: 'militarist', tint: '#5a6bf2', phonemes: ['sa', 'bl', 'dir', 'ka'] },
];

const FACTION_IDS: readonly FactionId[] = FACTIONS.map((f) => f.id);

export function factionById(id: FactionId): FactionArchetype {
  return FACTIONS.find((f) => f.id === id)!;
}

/** Traffic at/above which a system reads as a contested busy lane (§4.3/§13.1). */
export const CONTESTED_TRAFFIC = 0.6;

/**
 * The token set the faction MinHash runs over. P31 Q-ids when present (the
 * stable primary lever, §17.2), else the coarsened topical categories
 * (maintenance/hidden ones dropped, shared with §14 via categories.ts). Empty
 * set → the article has no usable signal → unaligned frontier.
 */
function signatureTokens(meta: ArticleMetadata): string[] {
  if (meta.instanceOf && meta.instanceOf.length > 0) {
    return [...new Set(meta.instanceOf.map((q) => `p31:${q}`))];
  }
  const topical = topicalCategories(meta.categories).map((c) => `cat:${c.toLowerCase()}`);
  return [...new Set(topical)];
}

/** MinHash ordering: lowest 32-bit hash first, title-stable tiebreak. */
function byMinHash(a: string, b: string): number {
  const ha = hash128(a)[0];
  const hb = hash128(b)[0];
  if (ha !== hb) return ha - hb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Hash a single signature token into a faction bucket. */
function bucketOf(token: string): FactionId {
  return FACTION_IDS[hash128(`faction:${token}`)[0] % FACTION_IDS.length]!;
}

/**
 * §13.1 — which faction controls a system, derived purely from its metadata.
 * Returns null for unaligned frontier (no topical/P31 signal). `traffic` is
 * passed in (generate.ts already computed it) so this stays a pure read.
 *
 * contested when: the top-two signature tokens fall in DIFFERENT factions (a
 * border straddle), the system is a busy lane (high traffic), or the article
 * is `autoconfirmed`-protected — the wiki's own "fought over" flag. A `sysop`
 * lock is the opposite: a held militarised core, never contested.
 */
export function factionFor(meta: ArticleMetadata, traffic: number): FactionRef | null {
  const tokens = signatureTokens(meta);
  if (tokens.length === 0) return null;

  const ranked = [...tokens].sort(byMinHash);
  const id = bucketOf(ranked[0]!);

  if (meta.protection === 'sysop') return { id, contested: false };

  const second = ranked[1];
  const straddle = second !== undefined && bucketOf(second) !== id;
  const contested =
    straddle || traffic >= CONTESTED_TRAFFIC || meta.protection === 'autoconfirmed';
  return { id, contested };
}
