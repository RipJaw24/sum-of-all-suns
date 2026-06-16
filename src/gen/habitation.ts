/**
 * habitation.ts — §14: life & habitation, a second PURE classifier on
 * SystemSpec, ORTHOGONAL to faction (faction = who rules; habitation = how
 * alive). Two outputs:
 *   - tier  (sterile→teeming): how crowded — langlinks + traffic + richness.
 *   - biome (what kind of place): the article's ontological CLASS — P31 when
 *     present (§17.2 primary lever), else category keywords (load-bearing
 *     fallback, decided 2026-06-14).
 *
 * PURITY: reads only ArticleMetadata + the already-rounded traffic; uses
 * integer log2 (clz32) and IEEE-exact arithmetic — no Rng draw, no raw log on
 * the bucketing path — so it cannot shift a generation stream and stays
 * byte-stable across engines. Like factions.ts: ADDS fields, bumps no seed.
 *
 * §14 discipline: this is FLAVOR, never a resource. No "habitability score"
 * leaks to the player; only the enums above reach rendering/NPC code.
 */

import type { ArticleMetadata, BiomeHint, HabitationTier } from '../types';
import { topicalCategories } from './categories';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Integer log2 via clz32 — exact on every platform (matches generate.ts). */
function ilog2(n: number): number {
  return n <= 1 ? 0 : 31 - Math.clz32(n);
}

// --- biome: ontological class ------------------------------------------------

/** High-confidence Wikidata P31 Q-ids → biome class. The PRIMARY lever when
 *  an `instanceOf` resolves; extend freely (CC0 data, §17 note). Unmapped
 *  Q-ids fall through to category keywords. */
const P31_BIOME: Readonly<Record<string, BiomeHint>> = {
  Q16521: 'verdant', // taxon
  Q8054: 'verdant', // protein
  Q7187: 'verdant', // gene
  Q12136: 'verdant', // disease
  Q11173: 'industrial', // chemical compound
  Q11344: 'industrial', // chemical element
  Q7397: 'machine', // software
  Q11862829: 'machine', // academic discipline
  Q395: 'machine', // mathematics
  Q5: 'civic', // human
  Q6256: 'civic', // country
  Q515: 'civic', // city
  Q11424: 'civic', // film
  Q571: 'civic', // book
  Q1656682: 'civic', // event
  Q523: 'barren', // star
  Q634: 'barren', // planet
  Q3863: 'barren', // asteroid
};

/** Category-keyword class table (the fallback). Keywords are matched at a WORD
 *  BOUNDARY prefix (see BIOME_MATCHERS), so stems like 'microb'/'biograph'
 *  still catch 'microbial'/'biography' while 'art' no longer fires on
 *  'earth'/'particle'. Order is the deterministic tiebreak. */
const BIOME_KEYWORDS: ReadonlyArray<readonly [BiomeHint, readonly string[]]> = [
  ['verdant', ['biology', 'biological', 'organism', 'species', 'plant', 'animal', 'fungi',
    'fungus', 'bacteria', 'taxa', 'taxon', 'flora', 'fauna', 'ecology', 'genus', 'botany',
    'zoology', 'microb', 'protein', 'genetic', 'disease', 'anatomy', 'forest', 'wildlife']],
  ['industrial', ['geology', 'geography', 'physics', 'chemistry', 'chemical', 'mineral',
    'metal', 'element', 'compound', 'mining', 'engineering', 'industrial', 'energy', 'rocks',
    'mountain', 'river', 'lake', 'machinery', 'manufactur', 'petroleum', 'alloy']],
  ['civic', ['history', 'historical', 'culture', 'cultural', 'politic', 'people', 'person',
    'society', 'social', 'music', 'film', 'religion', 'religious', 'language', 'country',
    'cities', 'city', 'warfare', 'wars', 'sport', 'literature', 'government', 'economy',
    'television', 'biograph', 'nation']],
  ['machine', ['mathematic', 'abstract', 'computing', 'computer', 'algorithm', 'software',
    'logic', 'theory', 'technology', 'database', 'cryptograph', 'informatics', 'automation',
    'statistics']],
];

/** One word-boundary regex per class (precompiled, case-insensitive). */
const BIOME_MATCHERS: ReadonlyArray<readonly [BiomeHint, RegExp]> = BIOME_KEYWORDS.map(
  ([biome, keywords]) => [biome, new RegExp(`\\b(?:${keywords.join('|')})`, 'i')] as const,
);

const BIOME_PRIORITY: readonly BiomeHint[] = ['verdant', 'industrial', 'civic', 'machine'];

function biomeFromCategories(categories: readonly string[]): BiomeHint {
  const score: Record<BiomeHint, number> = {
    verdant: 0, industrial: 0, civic: 0, machine: 0, barren: 0,
  };
  // Only subject-matter categories vote (maintenance/hidden dropped, §14).
  for (const cat of topicalCategories(categories)) {
    for (const [biome, matcher] of BIOME_MATCHERS) {
      if (matcher.test(cat)) score[biome] += 1;
    }
  }
  let best: BiomeHint = 'barren';
  let bestScore = 0;
  // Iterate in fixed priority order so ties resolve deterministically.
  for (const biome of BIOME_PRIORITY) {
    if (score[biome] > bestScore) {
      bestScore = score[biome];
      best = biome;
    }
  }
  return best; // 'barren' when nothing matched (no usable signal)
}

export function biomeFor(meta: ArticleMetadata): BiomeHint {
  // §17.2 primary: a real ontological type beats category keyword soup.
  if (meta.instanceOf) {
    for (const qid of meta.instanceOf) {
      const mapped = P31_BIOME[qid];
      if (mapped) return mapped;
    }
  }
  return biomeFromCategories(meta.categories);
}

// --- tier: sterile → teeming -------------------------------------------------

/** Earth carries ~316 langlinks; treat ~256+ as a saturated galactic capital.
 *  ilog2(256+1) == 8, so dividing by 8 normalizes the integer-log scale. */
const LANG_LOG_MAX = 8;

export const HABITATION_THRESHOLDS = { sterile: 0.15, frontier: 0.35, settled: 0.6 } as const;

/**
 * §14 — civilization tier. `traffic` is the already-rounded SystemSpec value
 * (generate.ts), so the only fresh math here is integer-log + IEEE-exact
 * weighting: deterministic, no stored float.
 */
export function habitationFor(meta: ArticleMetadata, traffic: number): HabitationTier {
  const langScore =
    meta.languageCount !== undefined
      ? clamp(ilog2(meta.languageCount + 1) / LANG_LOG_MAX, 0, 1)
      : 0;
  // Richer articles (infobox + many sections) read as more-settled places.
  const richness = clamp((meta.hasInfobox ? 0.4 : 0) + meta.sections.length / 14, 0, 1);
  const score = 0.42 * langScore + 0.4 * traffic + 0.18 * richness;

  if (score < HABITATION_THRESHOLDS.sterile) return 'sterile';
  if (score < HABITATION_THRESHOLDS.frontier) return 'frontier';
  if (score < HABITATION_THRESHOLDS.settled) return 'settled';
  return 'teeming';
}
