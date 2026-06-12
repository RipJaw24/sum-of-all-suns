/**
 * types.ts — The SUM OF ALL SUNS generation contract.
 *
 * Data flow:
 *   Wikipedia APIs -> ArticleMetadata (snapshot, cached forever per player)
 *                  -> generate_system(meta): SystemSpec   (PURE, deterministic)
 *                  -> renderer / simulation consume SystemSpec (read-only)
 *
 * INVARIANTS (agents: read before touching anything):
 *  - SystemSpec is IMMUTABLE WORLD DATA. Mutable run state (which gates the
 *    player has used, depleted salvage, discovered bodies) lives in the save
 *    file, keyed by SystemSpec ids — never written back into the spec.
 *  - generate_system must be a pure function: ArticleMetadata in, SystemSpec
 *    out, no I/O, no Date, no Math.random. Same input -> byte-identical
 *    output (enforced by golden-file tests).
 *  - sourceTitle and Gate.destinationTitle are SPOILERS. They exist for the
 *    jump system, the cache, and the post-run Decrypt Flight Log. They must
 *    never reach normal gameplay UI.
 *
 * Units & conventions:
 *  - Distances in world units (wu); 1 wu ≈ 1 px at zoom 1.0.
 *  - Angles in radians, CCW from +X axis. System origin = star at (0, 0).
 *  - Times in seconds. Orbital position at time t:
 *      angle(t) = initialAngle + (2π / orbitPeriodSec) * t
 */

// ---------------------------------------------------------------------------
// INPUT: snapshot of wiki metadata (numbers and titles only — never prose)
// ---------------------------------------------------------------------------

export interface SectionMeta {
  /** Wiki section heading (internal only; never displayed). */
  title: string;
  byteLength: number;
  imageCount: number;
}

export interface LinkMeta {
  /** Canonical destination article title (normalizeTitle'd). Spoiler. */
  title: string;
  /** Destination article byte length, if known at snapshot time. */
  byteLength?: number;
  /** True if destination is a stub (< STUB_BYTES) or byteLength unknown. */
  isStub: boolean;
  /** 0-based order of first appearance in the article body. */
  positionIndex: number;
  /** True if destination is itself a disambiguation page. */
  isDisambiguation: boolean;
  /** True if the link is a redirect; resolvedTitle is the true target. */
  isRedirect: boolean;
  resolvedTitle?: string;
}

/** Everything generate_system is allowed to know. Snapshotted on first visit. */
export interface ArticleMetadata {
  /** Schema version of this snapshot shape. */
  schemaVersion: 1;
  /** Canonical title (already normalizeTitle'd). Spoiler. */
  title: string;
  byteLength: number;
  /** Top-level (== h2) sections, in document order. */
  sections: SectionMeta[];
  /** Namespace-0 links after junk filtering (dates, List of…, identifiers). */
  links: LinkMeta[];
  /** Category titles without the 'Category:' prefix. */
  categories: string[];
  hasInfobox: boolean;
  /** Count of <ref> citations. */
  referenceCount: number;
  /** Total pageviews over the trailing 60 days at snapshot time. */
  pageviews60d: number;
  isDisambiguation: boolean;
  /** ISO 8601 timestamp of when this snapshot was taken. */
  snapshotAt: string;
}

// ---------------------------------------------------------------------------
// OUTPUT: the generated system (immutable world data)
// ---------------------------------------------------------------------------

export type StarClass =
  | 'red_dwarf'      // article < 10 KB
  | 'main_sequence'  // 10–40 KB
  | 'giant'          // 40–100 KB
  | 'supergiant'     // > 100 KB
  | 'binary'         // > 100 KB, alternate roll
  | 'pulsar'         // rare (featured/good articles)
  | 'white_dwarf';   // rare

export interface StarSpec {
  class: StarClass;
  /** Visual radius in wu. */
  radius: number;
  /** Hex color, e.g. '#ffd9a0'. Derived from class + seed tint. */
  color: string;
  /** Hazard radius: hull damage when inside (pulsar etc.). 0 = none. */
  hazardRadius: number;
}

export type BodyType = 'rocky' | 'ice' | 'gas_giant' | 'lava' | 'ocean';

export interface MoonSpec {
  id: string;
  name: string;
  radius: number;
  orbitRadius: number;        // around parent body
  orbitPeriodSec: number;
  initialAngle: number;
}

export interface StationSpec {
  id: string;
  name: string;
  services: ReadonlyArray<'refuel' | 'repair' | 'trade'>;
  /** 0..1 price level; derived from system traffic. Higher = pricier. */
  priceLevel: number;
}

/** Generated visit-screen content for a body. Numbers/ids only — text is
 *  produced at display time by templates keyed on these seeds. */
export interface SiteSpec {
  /** Ids into the static goods table (derived from section word hashing). */
  goodIds: string[];
  /** Seed for the lore-fragment template generator. */
  loreSeed: string;
  /** What interacting yields, if anything. */
  resource?: 'fuel_skim' | 'mining' | 'salvage';
}

export interface BodySpec {
  id: string;                 // 'body:0' … stable within system
  name: string;               // generated name — safe to display
  type: BodyType;
  radius: number;             // wu
  orbitRadius: number;        // wu from star
  orbitPeriodSec: number;
  initialAngle: number;       // radians at t=0
  hasRings: boolean;
  moons: MoonSpec[];
  station?: StationSpec;
  site: SiteSpec;
}

export type GateKind =
  | 'charted'    // normal link to a substantial article
  | 'uncharted'  // stub link (§4.5): cheap, unscannable, outcome table
  | 'wormhole';  // redirect: visual glitch, dumps at resolvedTitle

/** Outcome rolled for uncharted gates (§4.5). Pre-rolled at generation so
 *  scanning tech can't cheat by re-rolling. */
export type UnchartedOutcome = 'sparse' | 'salvage_field' | 'hazard_pocket' | 'deep_tunnel';

export interface GateSpec {
  id: string;                 // 'gate:0' … stable within system
  /** True destination article title. SPOILER — decrypt log / jump system only. */
  destinationTitle: string;
  /** Display name of the destination system (name-generator output). */
  destinationName: string;
  kind: GateKind;
  /** Position on the system rim. */
  angle: number;
  rimRadius: number;          // wu from star; gates sit on this ring
  /** Multiplier on base jump fuel cost: grows with link rank (§7 "inverse
   *  link prominence"), halved for uncharted gates (§4.5). See gateFuelFactor. */
  fuelCostFactor: number;
  /** Present iff kind === 'uncharted'. */
  unchartedOutcome?: UnchartedOutcome;
}

export interface AsteroidBeltSpec {
  innerRadius: number;
  outerRadius: number;
  /** 0..1; drives both visuals and collision hazard rate. */
  density: number;
}

export type SystemKind =
  | 'standard'
  | 'shattered'      // disambiguation page: no star, debris, every entry a gate
  | 'sparse'         // §4.5 stub outcomes — the destination article IS a stub,
  | 'salvage_field'  //   and its kind matches the unchartedOutcomeFor pre-roll
  | 'hazard_pocket'  //   stamped on every gate that points at it
  | 'deep_tunnel';   // stub whose own gates are all uncharted (cheap chain)

export interface AmbientSpec {
  /** Index into the curated palette table (category hash -> palette). */
  paletteId: number;
  /** Seed for the procedural nebula shader/canvas noise. */
  nebulaSeed: string;
  hazard?: 'radiation' | 'debris' | 'storm';
}

export interface SystemSpec {
  schemaVersion: 1;
  /** seedToHex(systemSeed(sourceTitle)) — also the golden-file key. */
  seed: string;
  /** Canonical source article title. SPOILER. */
  sourceTitle: string;
  /** Generated display name — what the player sees. */
  name: string;
  kind: SystemKind;
  /** null for 'shattered' systems. */
  star: StarSpec | null;
  bodies: BodySpec[];
  gates: GateSpec[];
  belt?: AsteroidBeltSpec;
  ambient: AmbientSpec;
  /** 0..1 normalized from pageviews60d (log scale). Drives NPC density,
   *  prices, and (post-MVP) patrol/pirate presence. */
  traffic: number;
  /** Present iff kind === 'salvage_field' (§4.5: isolated stubs pay best).
   *  0.2..1 from an isolation proxy — the stub's own OUTBOUND link count and
   *  byte length; we never fetch inbound links. Scales derelict yields. */
  salvageRichness?: number;
}

// ---------------------------------------------------------------------------
// Tuning constants (single source of truth for thresholds named in the spec)
// ---------------------------------------------------------------------------

export const STUB_BYTES = 2_000;
export const STAR_CLASS_BYTES = { redDwarfMax: 10_000, mainSequenceMax: 40_000, giantMax: 100_000 } as const;
export const MAX_BODIES = 9;
export const GATES_MIN = 3;
export const GATES_MAX = 6;
export const UNCHARTED_FUEL_FACTOR = 0.5;
/** §4.5 outcome weights. */
export const UNCHARTED_OUTCOME_WEIGHTS: ReadonlyArray<readonly [UnchartedOutcome, number]> = [
  ['sparse', 50],
  ['salvage_field', 30],
  ['hazard_pocket', 15],
  ['deep_tunnel', 5],
];

/** The one function that matters. Implemented in generate.ts (M0). */
export type GenerateSystem = (meta: ArticleMetadata) => SystemSpec;
