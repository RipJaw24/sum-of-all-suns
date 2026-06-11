/**
 * names.ts — The laundering layer (SPEC §3.3).
 *
 * Generates display names from article titles via a syllable grammar.
 * RULES:
 *  - systemName must be a PURE function of the title (gate destinations are
 *    named without fetching the destination article).
 *  - Output must never leak the source title. Golden tests pin outputs;
 *    a secret-keeping test asserts no title substring survives.
 *  - Seeded from hash128(`name:${normalizeTitle(title)}`) — deliberately a
 *    different seed domain than systemSeed, so name tweaks never move stars.
 */

import { Rng, hash128, normalizeTitle } from '../rng';

// Phoneme tables. FROZEN once shipped — edits regenerate every name in the
// galaxy (acceptable pre-release; bump GEN_VERSION if changed after).
const ONSETS = [
  'k', 'v', 't', 's', 'n', 'r', 'm', 'd', 'th', 'z', 'sh', 'kr',
  'dr', 'vel', 'b', 'g', 'h', 'l', 'pr', 'str',
] as const;
const NUCLEI = [
  'a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ei', 'ou', 'au', 'y', 'oa',
] as const;
const CODAS = [
  '', '', '', 'n', 'r', 's', 'l', 'x', 'th', 'm', 'nd', 'rk', 'sh', 't',
] as const;
const SUFFIXES = ['Prime', 'Minor', 'Major', 'Reach', 'Verge', 'Drift'] as const;

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV',
] as const;

const STATION_PREFIX = [
  'Anchorage', 'Bastion', 'Beacon', 'Caldera', 'Harbor', 'Haven',
  'Lattice', 'Outpost', 'Relay', 'Spire', 'Terminal', 'Waypoint',
] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One generated word of 1–3 syllables. */
function word(rng: Rng, minSyl: number, maxSyl: number): string {
  const syllables = rng.int(minSyl, maxSyl + 1);
  let w = '';
  for (let i = 0; i < syllables; i++) {
    w += rng.pick(ONSETS) + rng.pick(NUCLEI);
    // Codas mostly on the final syllable; mid-word codas get muddy.
    if (i === syllables - 1 || rng.chance(0.2)) w += rng.pick(CODAS);
  }
  return capitalize(w);
}

/**
 * Display name for the system generated from an article title.
 * Pure and deterministic. e.g. 'Photosynthesis' -> 'Vel Toshi Prime' (shape).
 */
export function systemName(title: string): string {
  const rng = new Rng(hash128(`name:${normalizeTitle(title)}`));
  const wordCount = rng.chance(0.35) ? 1 : 2;
  const parts: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    // Single-word names get more syllables so they don't read as grunts.
    parts.push(wordCount === 1 ? word(rng, 2, 3) : word(rng, 1, 2));
  }
  if (rng.chance(0.25)) parts.push(rng.pick(SUFFIXES));
  return parts.join(' ');
}

/** Body display name: '{SystemName} {Roman}'. Index is 0-based orbit order. */
export function bodyName(systemDisplayName: string, index: number): string {
  return `${systemDisplayName} ${ROMAN[Math.min(index, ROMAN.length - 1)]}`;
}

/** Moon display name: parent body name + lowercase letter. */
export function moonName(parentBodyName: string, index: number): string {
  return `${parentBodyName}${String.fromCharCode(97 + index)}`;
}

/** Station name, drawn from the caller's seeded stream. */
export function stationName(rng: Rng): string {
  return `${rng.pick(STATION_PREFIX)} ${word(rng, 1, 2)}`;
}
