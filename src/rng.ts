/**
 * rng.ts — Deterministic randomness for SUM OF ALL SUNS world generation.
 *
 * DETERMINISM CONTRACT (do not break):
 *  1. Same article title  -> same 128-bit seed  -> same generated system. Forever.
 *  2. All math is 32-bit integer ops (Math.imul, >>> 0). No Math.random,
 *     no Date, no floating-point accumulation in the seed path. This makes
 *     output identical across browsers, Node versions, and OSes.
 *  3. Subsystems use FORKED streams, never the parent stream directly.
 *     Forks are derived from the ORIGINAL seed + a label, not from parent
 *     draw state — so adding/removing draws in one subsystem can never
 *     shift the output of another. (e.g. tweaking planet generation must
 *     not move the jump gates.)
 *  4. Any change to hashing, normalization, or generation rules bumps
 *     GEN_VERSION, which is mixed into every seed. Old caches regenerate
 *     cleanly instead of half-matching.
 */

/** Bump when generation rules change incompatibly. Mixed into all seeds.
 *  v2: M1 — rank-based gate fuel factors (gateFuelFactor).
 *  v3: M3 — anomaly systems for stub articles (§4.5), trade goodIds on
 *      bodies. */
export const GEN_VERSION = 'v3';

/**
 * Internal seed salt. FROZEN FOREVER — deliberately decoupled from the
 * public game title so branding changes can never regenerate the galaxy.
 * Never rename this string. (Changing generation RULES is what GEN_VERSION
 * is for; this constant never changes for any reason.)
 */
export const SEED_SALT = 'sas-core';

export type Seed128 = readonly [number, number, number, number];

/**
 * Normalize a Wikipedia article title to canonical form:
 * underscores -> spaces, collapsed whitespace, NFC, first letter uppercased
 * (MediaWiki canonical form for enwiki).
 */
export function normalizeTitle(raw: string): string {
  let t = raw.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').normalize('NFC');
  if (t.length > 0) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/**
 * Hash an arbitrary string to four 32-bit words (cyrb128-style).
 * Stable, dependency-free, good avalanche for seeding purposes.
 * NOT cryptographic — fine for world gen.
 */
export function hash128(str: string): Seed128 {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ] as const;
}

/** Canonical system seed for an article title. The single entry point. */
export function systemSeed(articleTitle: string): Seed128 {
  return hash128(`${SEED_SALT}:${GEN_VERSION}:system:${normalizeTitle(articleTitle)}`);
}

/** Hex string form of a seed, for SystemSpec storage and golden files. */
export function seedToHex(seed: Seed128): string {
  return seed.map((w) => w.toString(16).padStart(8, '0')).join('');
}

/**
 * sfc32 PRNG — small, fast, excellent statistical quality for game use,
 * and implementable with pure 32-bit integer ops (cross-platform stable).
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  /** Original seed retained so forks are independent of draw order. */
  private readonly origin: Seed128;

  constructor(seed: Seed128) {
    this.origin = seed;
    this.a = seed[0] >>> 0;
    this.b = seed[1] >>> 0;
    this.c = seed[2] >>> 0;
    this.d = seed[3] >>> 0;
    // Warm-up: decorrelates similar seeds.
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  /** Core step. Returns a uint32. */
  nextUint32(): number {
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const out = (t + this.d) | 0;
    this.c = (this.c + out) | 0;
    return out >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Uniform integer in [minIncl, maxExcl). */
  int(minIncl: number, maxExcl: number): number {
    return minIncl + Math.floor(this.float() * (maxExcl - minIncl));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Uniform angle in [0, 2π). */
  angle(): number {
    return this.float() * Math.PI * 2;
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    const v = arr[this.int(0, arr.length)];
    if (v === undefined && arr.length === 0) throw new Error('Rng.pick: empty array');
    return v as T;
  }

  /**
   * Weighted pick: entries of [value, weight]. Weights need not sum to 1.
   * Used for e.g. the uncharted-gate outcome table (§4.5).
   */
  pickWeighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = this.float() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    const last = entries[entries.length - 1];
    if (last === undefined) throw new Error('Rng.pickWeighted: empty table');
    return last[0];
  }

  /** In-place Fisher–Yates shuffle. Returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Derive an independent child stream for a named subsystem.
   * Derived from the ORIGINAL seed + label (not current draw state), so:
   *   - fork order doesn't matter
   *   - extra draws on the parent or sibling forks never shift this stream.
   * Convention: lowercase labels, ':' for indices — 'star', 'bodies',
   * 'body:3', 'gates', 'gate:0:outcome', 'nebula', 'naming'.
   */
  fork(label: string): Rng {
    return new Rng(hash128(`${seedToHex(this.origin)}/${label}`));
  }
}

/** Convenience: a ready-to-use Rng for an article's system. */
export function rngForArticle(articleTitle: string): Rng {
  return new Rng(systemSeed(articleTitle));
}
