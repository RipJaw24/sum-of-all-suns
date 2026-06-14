/**
 * degraded.ts — the "sensor interference" fallback (SPEC §8): when a live
 * fetch fails and no snapshot exists, synthesize sparse-but-valid metadata
 * deterministically from the title alone. cache.ts NEVER persists these,
 * so the system re-resolves properly on a later session with network.
 */

import { normalizeTitle, rngForArticle } from '../rng';
import type { ArticleMetadata } from '../types';

/** Sentinel snapshotAt value marking metadata that must not be persisted. */
export const DEGRADED_SNAPSHOT_AT = 'degraded';

export function isDegraded(meta: ArticleMetadata): boolean {
  return meta.snapshotAt === DEGRADED_SNAPSHOT_AT;
}

export function degradedMetadata(rawTitle: string): ArticleMetadata {
  const title = normalizeTitle(rawTitle);
  const rng = rngForArticle(title).fork('degraded');
  const sectionCount = rng.int(1, 4);
  // M5 §17 signals are deliberately omitted: a sensor-glitch system has no
  // protection/langlinks/Wikidata reading, so faction/habitation fall back to
  // the (empty) category path → unaligned frontier, fittingly lawless.
  return {
    schemaVersion: 2,
    title,
    // Always small -> dim red dwarf, fittingly "off" for a sensor glitch.
    // INVARIANT: must stay >= STUB_BYTES (2,000) so a degraded system can
    // never trip generate.ts's §4.5 anomaly branch (generateAnomaly).
    byteLength: rng.int(2_500, 9_000),
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      title: `static:${i}`,
      byteLength: rng.int(400, 2_000),
      imageCount: 0,
    })),
    // No onward links: the §4.2 return gate is the only way back out.
    links: [],
    categories: [],
    hasInfobox: false,
    referenceCount: 0,
    pageviews60d: 0,
    isDisambiguation: false,
    snapshotAt: DEGRADED_SNAPSHOT_AT,
  };
}
