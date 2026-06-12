// Throwaway: find one title per §4.5 outcome for the checked-in stub fixtures.
import { unchartedOutcomeFor } from '../src/gen/generate';

const candidates = [
  'Glarus thrust', 'Whim of the Gods', 'Kettle hole', 'Murmuration', 'Oxbow lake',
  'Tarn (lake)', 'Cirque glacier', 'Nunatak', 'Drumlin field', 'Esker',
  'Pingo', 'Polje', 'Sastrugi', 'Yardang', 'Ventifact',
  'Inselberg', 'Tepui', 'Bornhardt', 'Tor (rock formation)', 'Hoodoo (geology)',
];

const found = new Map<string, string[]>();
for (const title of candidates) {
  const outcome = unchartedOutcomeFor(title);
  found.set(outcome, [...(found.get(outcome) ?? []), title]);
}
for (const [outcome, titles] of found) console.log(outcome.padEnd(14), titles.join(' | '));
