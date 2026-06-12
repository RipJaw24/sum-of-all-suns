/**
 * lore.ts — procedurally templated lore fragments (SPEC §6): 1–2 sentences
 * per body, mood keyed to the system's category-derived palette. GENERATED
 * text from our own word tables — never article prose (the licensing rule:
 * wiki data is seeds, not strings).
 *
 * Display-time generation: fragments come from SiteSpec.loreSeed, which is
 * already in every golden — nothing here touches generate.ts. Word tables
 * are FROZEN once shipped (names.ts convention); the MOOD list is indexed
 * by AmbientSpec.paletteId and must stay aligned with game/palettes.ts.
 */

import { Rng, hash128 } from '../rng';
import type { AmbientSpec, BodyType, SystemKind } from '../types';
import { loreWord } from './names';

export interface LoreInput {
  loreSeed: string;
  bodyType: BodyType;
  paletteId: number;
  systemKind: SystemKind;
  hazard?: AmbientSpec['hazard'];
}

interface Mood {
  /** Stable mood key — game/palettes.ts pins its 12 entries to these. */
  id: string;
  adj: readonly string[];
  noun: readonly string[];
  close: readonly string[];
}

/** Indexed by paletteId (12 entries, one per renderer palette). */
export const MOODS: readonly Mood[] = [
  {
    id: 'serene',
    adj: ['still', 'patient', 'unhurried', 'mild'],
    noun: ['tide pools', 'slow clouds', 'old light', 'calm air'],
    close: ['Nothing here is in a hurry.', 'The silence feels deliberate.'],
  },
  {
    id: 'desolate',
    adj: ['empty', 'scoured', 'abandoned', 'thin'],
    noun: ['dead channels', 'bare rock', 'cold static', 'open ground'],
    close: ['No one has filed a claim in living memory.', 'The wind owns everything here.'],
  },
  {
    id: 'feverish',
    adj: ['restless', 'flickering', 'overheated', 'crowded'],
    noun: ['signal chatter', 'heat shimmer', 'bright debris', 'fast shadows'],
    close: ['Everything reads two degrees too warm.', 'The sensors will not sit still.'],
  },
  {
    id: 'funereal',
    adj: ['solemn', 'grey', 'heavy', 'quiet'],
    noun: ['standing stones', 'long shadows', 'closed doors', 'still water'],
    close: ['Something was mourned here once.', 'Visitors tend to lower their voices.'],
  },
  {
    id: 'verdant',
    adj: ['overgrown', 'luminous', 'tangled', 'fertile'],
    noun: ['spore drifts', 'green terraces', 'root systems', 'soft moss'],
    close: ['Life found a foothold and kept it.', 'The green does not ask permission.'],
  },
  {
    id: 'industrial',
    adj: ['rusted', 'load-bearing', 'unpainted', 'humming'],
    noun: ['gantry lines', 'slag heaps', 'old conveyors', 'pressure pipes'],
    close: ['The machines outlived their owners.', 'Somewhere, a pump is still running.'],
  },
  {
    id: 'haunted',
    adj: ['half-seen', 'wrong', 'returning', 'pale'],
    noun: ['echo returns', 'double images', 'cold spots', 'missing hours'],
    close: ['The logs disagree about what happened.', 'Crews do not stay past nightfall.'],
  },
  {
    id: 'radiant',
    adj: ['gilded', 'blinding', 'glassy', 'high'],
    noun: ['mirror flats', 'light wells', 'burning edges', 'clear horizons'],
    close: ['Everything here throws a long reflection.', 'Eyes adjust slowly, if at all.'],
  },
  {
    id: 'brackish',
    adj: ['stagnant', 'mineral', 'briny', 'low'],
    noun: ['salt crusts', 'slow deltas', 'grey foam', 'sunken markers'],
    close: ['The water remembers older coastlines.', 'Nothing rusts faster than hope here.'],
  },
  {
    id: 'austere',
    adj: ['exact', 'unadorned', 'cold', 'sheer'],
    noun: ['clean lines', 'flat terraces', 'right angles', 'bare poles'],
    close: ['Whoever shaped this wasted nothing.', 'There is no ornament for a thousand miles.'],
  },
  {
    id: 'opaline',
    adj: ['iridescent', 'shifting', 'milky', 'strange'],
    noun: ['colour seams', 'soft prisms', 'pearl fog', 'banded glass'],
    close: ['The colours change when no one watches.', 'Every survey photographs it differently.'],
  },
  {
    id: 'ashen',
    adj: ['burnt', 'settling', 'smothered', 'late'],
    noun: ['ash drifts', 'charcoal fields', 'dim embers', 'fallen plumes'],
    close: ['Whatever burned here burned completely.', 'The dust has not finished falling.'],
  },
] as const;

const FEATURES: Record<BodyType, readonly string[]> = {
  rocky: ['dust canyons', 'rust plains', 'fractured mesas'],
  ice: ['glacier fields', 'frost ridges', 'methane snows'],
  gas_giant: ['cloud bands', 'storm cells', 'pressure decks'],
  lava: ['magma seas', 'ash fields', 'cinder coasts'],
  ocean: ['world-ocean', 'kelp shallows', 'grey swells'],
};

/** First-sentence shapes. Slots: {adj} {noun} {feature} {name}. */
const TEMPLATES: readonly string[] = [
  'The {feature} stretch out beneath a {adj} sky.',
  'Survey drones report {adj} {noun} across the {feature}.',
  'The {feature} here hold a {adj} quiet.',
  'Old charts mark the {feature} as "{name}".',
  'Something {adj} drifts through the {noun} below.',
  'A {adj} light settles over the {feature}.',
];

/** §4.5 / §4.3 flavor for anomalous systems; takes precedence over mood. */
const KIND_CLAUSES: Partial<Record<SystemKind, readonly string[]>> = {
  sparse: ['Nothing else has come out this far in years.', 'The beacon list ends one entry back.'],
  salvage_field: ['Someone left here in a hurry.', 'The wrecks outnumber the stars.'],
  hazard_pocket: ['The storm never quite ends.', 'Hull plating sings the whole way down.'],
  deep_tunnel: ['The charts simply stop past this point.', 'Cheap fuel, no promises.'],
  shattered: ['The debris keeps a slow, patient orbit.', 'Whatever this was, it is in pieces now.'],
};

/** Ambient-hazard flavor for otherwise-ordinary systems. */
const HAZARD_CLAUSES: Record<NonNullable<AmbientSpec['hazard']>, readonly string[]> = {
  radiation: ['Dosimeters click all the way down.', 'The star is not as far away as it looks.'],
  debris: ['Impact warnings come in flurries.', 'The belt sheds something every hour.'],
  storm: ['The weather has opinions.', 'Lightning maps the cloud tops at night.'],
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The 1–2 sentence fragment for a body. Pure: same input -> same string,
 * forever (loreSeed is per-body world data, so fragments are shared lore,
 * not per-run flavor).
 */
export function loreFragment(input: LoreInput): string {
  const rng = new Rng(hash128(`lore:${input.loreSeed}`));
  const mood = MOODS[((input.paletteId % MOODS.length) + MOODS.length) % MOODS.length]!;

  const first = rng
    .pick(TEMPLATES)
    .replace('{feature}', rng.pick(FEATURES[input.bodyType]))
    .replace('{adj}', rng.pick(mood.adj))
    .replace('{noun}', rng.pick(mood.noun))
    .replace('{name}', loreWord(rng));

  // Second sentence: anomaly kind > ambient hazard > mood close.
  const pool = KIND_CLAUSES[input.systemKind] ?? (input.hazard ? HAZARD_CLAUSES[input.hazard] : undefined);
  const second = pool
    ? rng.chance(0.75)
      ? rng.pick(pool)
      : undefined
    : rng.chance(0.6)
      ? rng.pick(mood.close)
      : undefined;

  return second ? `${capitalize(first)} ${second}` : capitalize(first);
}
