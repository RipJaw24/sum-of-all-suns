/**
 * Typed access to the checked-in ArticleMetadata fixtures (test inputs for
 * the golden-file suite; live fetch failures fall back to wiki/degraded.ts).
 */
import type { ArticleMetadata } from '../../types';
import bioluminescentBayJson from './bioluminescent-bay.json';
import mercuryDisambiguationJson from './mercury-disambiguation.json';
import photosynthesisJson from './photosynthesis.json';
import stubHazardJson from './stub-hazard.json';
import stubSalvageJson from './stub-salvage.json';
import stubSparseJson from './stub-sparse.json';
import stubTunnelJson from './stub-tunnel.json';

// JSON imports widen literals (schemaVersion: 1 -> number); the shapes are
// hand-maintained to match ArticleMetadata, so a single cast point is fine.
export const photosynthesis = photosynthesisJson as ArticleMetadata;
export const mercuryDisambiguation = mercuryDisambiguationJson as ArticleMetadata;
export const bioluminescentBay = bioluminescentBayJson as ArticleMetadata;

// §4.5 stub fixtures — titles chosen (under GEN_VERSION v3) so that
// unchartedOutcomeFor yields one of each anomaly kind. If GEN_VERSION bumps,
// re-discover titles whose pre-rolls match (scripts/find-stubs.ts pattern).
export const stubSparse = stubSparseJson as ArticleMetadata; // 'Kettle hole'
export const stubSalvage = stubSalvageJson as ArticleMetadata; // 'Oxbow lake'
export const stubHazard = stubHazardJson as ArticleMetadata; // 'Tarn (lake)'
export const stubTunnel = stubTunnelJson as ArticleMetadata; // 'Tepui'
