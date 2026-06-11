/**
 * Typed access to the checked-in ArticleMetadata fixtures (test inputs for
 * the golden-file suite; live fetch failures fall back to wiki/degraded.ts).
 */
import type { ArticleMetadata } from '../../types';
import bioluminescentBayJson from './bioluminescent-bay.json';
import mercuryDisambiguationJson from './mercury-disambiguation.json';
import photosynthesisJson from './photosynthesis.json';

// JSON imports widen literals (schemaVersion: 1 -> number); the shapes are
// hand-maintained to match ArticleMetadata, so a single cast point is fine.
export const photosynthesis = photosynthesisJson as ArticleMetadata;
export const mercuryDisambiguation = mercuryDisambiguationJson as ArticleMetadata;
export const bioluminescentBay = bioluminescentBayJson as ArticleMetadata;
