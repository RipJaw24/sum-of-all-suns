/**
 * startPool.ts — curated run-start articles (§4.4, recommended option for
 * MVP: "curate a small pool of well-connected seed articles for fairer run
 * starts"). Criteria: substantial (≥40 KB, so a decent star), link-rich
 * (plenty of gates), broad topic spread so consecutive runs feel different.
 *
 * Math.random is fine HERE — run-start choice is meant to vary. The world
 * each title produces stays fully deterministic (rng.ts contract).
 */

export const START_POOL: readonly string[] = [
  'Photosynthesis',
  'Byzantine Empire',
  'Volcano',
  'Silk Road',
  'Jazz',
  'Antarctica',
  'Whale',
  'Renaissance',
  'Electricity',
  'Amazon rainforest',
  'Ancient Egypt',
  'Honey bee',
  'Samurai',
  'Coral reef',
  'Printing press',
  'Gold',
  'Moon',
  'Tea',
  'Vikings',
  'Alexander the Great',
  'Glacier',
  'Salt',
  'Chess',
  'Lighthouse',
];

export function pickStart(random: () => number = Math.random): string {
  return START_POOL[Math.floor(random() * START_POOL.length)]!;
}
