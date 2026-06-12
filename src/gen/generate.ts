/**
 * generate.ts — Article metadata -> star system. The heart of the game.
 *
 * PURE FUNCTION CONTRACT (types.ts invariants, SPEC §9):
 *  - No I/O, no Date, no Math.random. Same ArticleMetadata in ->
 *    byte-identical SystemSpec out (golden-file tests enforce this).
 *  - All randomness comes from forked streams of the system seed; the fork
 *    labels follow the convention in rng.ts. Adding draws in one subsystem
 *    must never shift another.
 *  - Transcendental math (log) is kept out of stored values except through
 *    roundTo(), which absorbs any cross-engine ulp differences.
 */

import { Rng, hash128, normalizeTitle, rngForArticle, seedToHex, systemSeed } from '../rng';
import { GOODS, goodsForSectionTitle } from './goods';
import { bodyName, moonName, stationName, systemName } from './names';
import {
  type ArticleMetadata,
  type AsteroidBeltSpec,
  type BodySpec,
  type BodyType,
  type GateKind,
  type GateSpec,
  type LinkMeta,
  type StarClass,
  type StarSpec,
  type SystemSpec,
  type UnchartedOutcome,
  GATES_MAX,
  GATES_MIN,
  MAX_BODIES,
  STAR_CLASS_BYTES,
  STUB_BYTES,
  UNCHARTED_FUEL_FACTOR,
  UNCHARTED_OUTCOME_WEIGHTS,
} from '../types';

/** Number of curated ambient palettes the renderer ships (renderer cycles
 *  by index, so this can grow without breaking old paletteIds). */
export const PALETTE_COUNT = 12;

/** Belt appears at or above this many <ref> citations. */
export const BELT_MIN_REFS = 50;

// --- deterministic numeric helpers ------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Round to `places` decimals — every float stored in a SystemSpec passes
 *  through this so golden files are stable across JS engines. */
function roundTo(x: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/** Integer log2 via clz32 — exact on every platform, unlike Math.log2. */
function ilog2(n: number): number {
  return n <= 1 ? 0 : 31 - Math.clz32(n);
}

// --- star --------------------------------------------------------------------

const STAR_VISUALS: Record<StarClass, { radius: number; colors: readonly string[] }> = {
  red_dwarf: { radius: 26, colors: ['#ff6b4a', '#ff5533', '#e8553f'] },
  main_sequence: { radius: 40, colors: ['#ffd9a0', '#ffe8b0', '#ffcf86', '#fff4d6'] },
  giant: { radius: 62, colors: ['#ffb347', '#ff9d3c', '#ffc05e'] },
  supergiant: { radius: 88, colors: ['#a0c8ff', '#8fb8ff', '#ffae6b'] },
  binary: { radius: 48, colors: ['#ffd9a0', '#a0c8ff', '#ffb347'] },
  pulsar: { radius: 16, colors: ['#c4f0ff', '#aee6ff'] },
  white_dwarf: { radius: 14, colors: ['#f4f8ff', '#e8f0ff'] },
};

function isRareArticle(categories: readonly string[]): boolean {
  return categories.some((c) => {
    const lc = c.toLowerCase();
    return lc.includes('featured articles') || lc.includes('good articles');
  });
}

function starClassFor(meta: ArticleMetadata, rng: Rng): StarClass {
  if (isRareArticle(meta.categories)) {
    return rng.chance(0.5) ? 'pulsar' : 'white_dwarf';
  }
  if (meta.byteLength < STAR_CLASS_BYTES.redDwarfMax) return 'red_dwarf';
  if (meta.byteLength < STAR_CLASS_BYTES.mainSequenceMax) return 'main_sequence';
  if (meta.byteLength < STAR_CLASS_BYTES.giantMax) return 'giant';
  return rng.chance(0.7) ? 'supergiant' : 'binary';
}

function generateStar(meta: ArticleMetadata, rng: Rng): StarSpec {
  const cls = starClassFor(meta, rng);
  const visuals = STAR_VISUALS[cls];
  return {
    class: cls,
    radius: roundTo(visuals.radius * rng.range(0.9, 1.15)),
    color: rng.pick(visuals.colors),
    hazardRadius: cls === 'pulsar' ? 220 : 0,
  };
}

// --- bodies ------------------------------------------------------------------

const ROCKY_TYPES: readonly BodyType[] = ['rocky', 'rocky', 'ice', 'lava', 'ocean'];

const FIRST_ORBIT = 150;
const ORBIT_SPACING = 95;

function generateBodies(meta: ArticleMetadata, root: Rng, displayName: string): BodySpec[] {
  const count = clamp(meta.sections.length, 1, MAX_BODIES);
  const layout = root.fork('bodies');
  const maxSectionLen = Math.max(1, ...meta.sections.map((s) => s.byteLength));
  const bodies: BodySpec[] = [];

  for (let i = 0; i < count; i++) {
    const rng = root.fork(`body:${i}`);
    // Section may be missing when the article has zero sections (count
    // clamps up to 1): synthesize a small barren body from the seed alone.
    const section = meta.sections[i];
    const sizeFactor = section ? section.byteLength / maxSectionLen : rng.range(0.1, 0.4);
    const isGasGiant = sizeFactor > 0.85 && (section?.byteLength ?? 0) > 5_000;
    const type: BodyType = isGasGiant ? 'gas_giant' : rng.pick(ROCKY_TYPES);
    const radius = roundTo((isGasGiant ? 26 : 9) + sizeFactor * (isGasGiant ? 18 : 14));
    const orbitRadius = roundTo(FIRST_ORBIT + i * ORBIT_SPACING + layout.range(-18, 18));
    const name = bodyName(displayName, i);

    const hasImages = (section?.imageCount ?? 0) > 0;
    const hasRings = hasImages && rng.chance(0.5);
    const moons =
      hasImages && !hasRings
        ? [
            {
              id: `moon:${i}:0`,
              name: moonName(name, 0),
              radius: roundTo(radius * rng.range(0.18, 0.3)),
              orbitRadius: roundTo(radius * rng.range(2.2, 3.5)),
              orbitPeriodSec: roundTo(rng.range(20, 45)),
              initialAngle: roundTo(rng.angle()),
            },
          ]
        : [];

    bodies.push({
      id: `body:${i}`,
      name,
      type,
      radius,
      orbitRadius,
      // Outer bodies orbit slower; period grows with radius. Cosmetic (§3.2).
      orbitPeriodSec: roundTo(orbitRadius * rng.range(1.6, 2.4)),
      initialAngle: roundTo(rng.angle()),
      hasRings,
      moons,
      site: {
        // §6: the section that spawned the body supplies its trade goods.
        // Pure hash of the heading (goods.ts) — not a draw, so no stream shift.
        goodIds: section ? goodsForSectionTitle(section.title) : [],
        loreSeed: seedToHex(hash128(`${seedToHex(systemSeed(meta.title))}/lore:${i}`)),
        resource:
          type === 'gas_giant' ? 'fuel_skim' : type === 'rocky' || type === 'lava' ? 'mining' : undefined,
      },
    });
  }

  // Station (§3.2): infobox present -> one seeded body hosts a dockable station.
  if (meta.hasInfobox && bodies.length > 0) {
    const srng = root.fork('station');
    const host = bodies[srng.int(0, bodies.length)];
    if (host) {
      host.station = {
        id: 'station:0',
        name: stationName(srng),
        services: ['refuel', 'repair', 'trade'],
        priceLevel: roundTo(clamp(0.35 + trafficFor(meta) * 0.5 + srng.range(-0.1, 0.1), 0, 1)),
      };
    }
  }

  return bodies;
}

// --- gates -------------------------------------------------------------------

function gateCount(linkCount: number): number {
  return clamp(3 + Math.floor(ilog2(linkCount) / 2), GATES_MIN, GATES_MAX);
}

/**
 * Outcome behind an uncharted gate (§4.5), rolled from the DESTINATION stub's
 * own seed — the same stub article resolves identically no matter which
 * system you approach it from.
 */
export function unchartedOutcomeFor(stubTitle: string): UnchartedOutcome {
  return rngForArticle(stubTitle).fork('uncharted:outcome').pickWeighted(UNCHARTED_OUTCOME_WEIGHTS);
}

/**
 * Fuel-cost multiplier for a gate (§7: "distance" = inverse link prominence).
 * rank = the gate's index in the position-ranked link order, so later/more
 * obscure links cost more; uncharted gates are half price (§4.5).
 */
export function gateFuelFactor(rank: number, kind: GateKind): number {
  const charted = clamp(1 + rank * 0.15, 1, 2.5);
  return roundTo(kind === 'uncharted' ? charted * UNCHARTED_FUEL_FACTOR : charted);
}

function makeGate(link: LinkMeta, index: number, angle: number, rimRadius: number): GateSpec {
  const destinationTitle = normalizeTitle(
    link.isRedirect && link.resolvedTitle ? link.resolvedTitle : link.title,
  );
  const kind: GateKind = link.isRedirect ? 'wormhole' : link.isStub ? 'uncharted' : 'charted';
  const gate: GateSpec = {
    id: `gate:${index}`,
    destinationTitle,
    destinationName: systemName(destinationTitle),
    kind,
    angle: roundTo(angle),
    rimRadius: roundTo(rimRadius),
    fuelCostFactor: gateFuelFactor(index, kind),
  };
  if (kind === 'uncharted') gate.unchartedOutcome = unchartedOutcomeFor(destinationTitle);
  return gate;
}

function generateGates(
  links: readonly LinkMeta[],
  rng: Rng,
  rimRadius: number,
  opts: { all?: boolean; cap?: number } = {},
): GateSpec[] {
  // Dedupe by destination, keep earliest occurrence, rank by position (§4.1).
  const seen = new Set<string>();
  const ranked = [...links]
    .sort((a, b) => a.positionIndex - b.positionIndex)
    .filter((l) => {
      const key = normalizeTitle(l.isRedirect && l.resolvedTitle ? l.resolvedTitle : l.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const count = Math.min(gateCount(ranked.length), opts.cap ?? Infinity);
  const chosen = opts.all ? ranked : ranked.slice(0, count);
  const n = chosen.length;
  const baseAngle = rng.angle();
  return chosen.map((link, i) => {
    const jitter = rng.range(-0.25, 0.25) * (Math.PI * 2) / Math.max(n, 1) * 0.5;
    const angle = baseAngle + (i / Math.max(n, 1)) * Math.PI * 2 + jitter;
    return makeGate(link, i, angle % (Math.PI * 2), rimRadius);
  });
}

// --- ambient / traffic ---------------------------------------------------------

function trafficFor(meta: ArticleMetadata): number {
  // log10 normalization: 10M views / 60 days ≈ 1.0. roundTo absorbs ulp noise.
  return roundTo(clamp(Math.log10(meta.pageviews60d + 1) / 7, 0, 1));
}

function paletteIdFor(categories: readonly string[]): number {
  const canonical = [...categories].map((c) => c.toLowerCase()).sort().join('|');
  return hash128(`palette:${canonical}`)[0] % PALETTE_COUNT;
}

// --- anomaly systems (§4.5: stub destinations) ---------------------------------

/** Shared per-system context threaded through the generation paths. */
interface GenContext {
  title: string;
  seedHex: string;
  name: string;
  traffic: number;
  ambientBase: { paletteId: number; nebulaSeed: string };
}

/** A lifeless rock for sparse/salvage/hazard systems: no rings, no moons,
 *  no station, no goods. loreSeed derivation matches generateBodies. */
function barrenBody(rng: Rng, layout: Rng, i: number, ctx: GenContext): BodySpec {
  const orbitRadius = roundTo(FIRST_ORBIT + i * ORBIT_SPACING + layout.range(-18, 18));
  return {
    id: `body:${i}`,
    name: bodyName(ctx.name, i),
    type: rng.chance(0.5) ? 'rocky' : 'ice',
    radius: roundTo(rng.range(7, 15)),
    orbitRadius,
    orbitPeriodSec: roundTo(orbitRadius * rng.range(1.6, 2.4)),
    initialAngle: roundTo(rng.angle()),
    hasRings: false,
    moons: [],
    site: {
      goodIds: [],
      loreSeed: seedToHex(hash128(`${ctx.seedHex}/lore:${i}`)),
    },
  };
}

/**
 * §4.5: a stub article (< STUB_BYTES) generates as the anomaly its
 * unchartedOutcomeFor pre-roll promises — the SAME roll every origin gate
 * stamped on itself, so the gate's promise and the arrival always agree
 * (including ?start=<stub> runs). No anomaly hosts a station: stubs are
 * wild space. degraded.ts deliberately synthesizes byteLength >= 2,500 so
 * sensor-interference fallbacks can never land here.
 */
function generateAnomaly(meta: ArticleMetadata, root: Rng, ctx: GenContext): SystemSpec {
  const outcome = unchartedOutcomeFor(ctx.title);

  if (outcome === 'deep_tunnel') {
    // The stub's own few links are all uncharted too (§4.5) — otherwise a
    // standard system. The forced kind wins over each link's own nature; a
    // destination that turns out substantial simply generates normally on
    // arrival and its pre-rolled outcome goes unused.
    const spec = generateStandard(meta, root, ctx);
    return {
      ...spec,
      kind: 'deep_tunnel',
      gates: spec.gates.map((g, i) => ({
        ...g,
        kind: 'uncharted' as const,
        fuelCostFactor: gateFuelFactor(i, 'uncharted'),
        unchartedOutcome: unchartedOutcomeFor(g.destinationTitle),
      })),
      bodies: spec.bodies.map(({ station: _station, ...body }) => body),
    };
  }

  const arng = root.fork('anomaly');

  // Dim husk of a star — every non-tunnel anomaly reads as dead space.
  const star: StarSpec = {
    class: 'red_dwarf',
    radius: roundTo(STAR_VISUALS.red_dwarf.radius * 0.7 * arng.range(0.9, 1.15)),
    color: arng.pick(STAR_VISUALS.red_dwarf.colors),
    hazardRadius: 0,
  };

  const layout = root.fork('bodies');
  const bodyCount =
    outcome === 'sparse' ? arng.int(0, 3) : outcome === 'salvage_field' ? arng.int(0, 4) : arng.int(1, 3);
  const bodies: BodySpec[] = [];
  for (let i = 0; i < bodyCount; i++) {
    bodies.push(barrenBody(root.fork(`body:${i}`), layout, i, ctx));
  }

  if (outcome === 'hazard_pocket' && bodies[0]) {
    // The rare-good deposit at the center, inside the danger (§4.5).
    const deposit = bodies[0];
    deposit.type = arng.chance(0.5) ? 'lava' : 'rocky';
    deposit.orbitRadius = roundTo(110 + arng.range(0, 25));
    deposit.orbitPeriodSec = roundTo(deposit.orbitRadius * arng.range(1.6, 2.4));
    deposit.site.resource = 'mining';
    deposit.site.goodIds = [arng.pick(GOODS.filter((g) => g.tier === 'rare')).id];
  }

  const rimRadius = FIRST_ORBIT + Math.max(0, bodies.length - 1) * ORBIT_SPACING + 160;
  const gates = generateGates(
    meta.links,
    root.fork('gates'),
    rimRadius,
    // Sparse systems are nearly dead ends — that risk is the §4.5 cost.
    outcome === 'sparse' ? { cap: 3 } : {},
  );

  const hazard = outcome === 'hazard_pocket' ? (arng.chance(0.5) ? 'storm' : 'radiation') : undefined;

  return {
    schemaVersion: 1,
    seed: ctx.seedHex,
    sourceTitle: ctx.title,
    name: ctx.name,
    kind: outcome,
    star,
    bodies,
    gates,
    ambient: { ...ctx.ambientBase, ...(hazard ? { hazard } : {}) },
    traffic: ctx.traffic,
    ...(outcome === 'salvage_field'
      ? {
          // Isolation proxy: fewer outbound links + tinier article = richer
          // wreck (§4.5 balance lever; we never fetch inbound links).
          salvageRichness: roundTo(
            clamp(
              0.3 + (1 - meta.links.length / 8) * 0.5 + (1 - meta.byteLength / STUB_BYTES) * 0.2,
              0.2,
              1,
            ),
          ),
        }
      : {}),
  };
}

// --- standard systems -----------------------------------------------------------

function generateStandard(meta: ArticleMetadata, root: Rng, ctx: GenContext): SystemSpec {
  const star = generateStar(meta, root.fork('star'));
  const bodies = generateBodies(meta, root, ctx.name);

  let belt: AsteroidBeltSpec | undefined;
  if (meta.referenceCount >= BELT_MIN_REFS) {
    const brng = root.fork('belt');
    // Belt sits just beyond the outermost body.
    const outermost = FIRST_ORBIT + (bodies.length - 1) * ORBIT_SPACING;
    const inner = outermost + brng.range(50, 90);
    belt = {
      innerRadius: roundTo(inner),
      outerRadius: roundTo(inner + brng.range(40, 80)),
      density: roundTo(clamp(meta.referenceCount / 400, 0.1, 1)),
    };
  }

  const rimRadius = (belt?.outerRadius ?? FIRST_ORBIT + (bodies.length - 1) * ORBIT_SPACING) + 160;
  const gates = generateGates(meta.links, root.fork('gates'), rimRadius);

  const hazard =
    star.class === 'pulsar' ? 'radiation' : (belt?.density ?? 0) > 0.6 ? 'debris' : undefined;

  return {
    schemaVersion: 1,
    seed: ctx.seedHex,
    sourceTitle: ctx.title,
    name: ctx.name,
    kind: 'standard',
    star,
    bodies,
    gates,
    ...(belt ? { belt } : {}),
    ambient: { ...ctx.ambientBase, ...(hazard ? { hazard } : {}) },
    traffic: ctx.traffic,
  };
}

// --- entry point ---------------------------------------------------------------

export function generateSystem(meta: ArticleMetadata): SystemSpec {
  const title = normalizeTitle(meta.title);
  const seed = systemSeed(title);
  const seedHex = seedToHex(seed);
  const root = new Rng(seed);
  const ctx: GenContext = {
    title,
    seedHex,
    name: systemName(title),
    traffic: trafficFor(meta),
    ambientBase: {
      paletteId: paletteIdFor(meta.categories),
      nebulaSeed: seedToHex(hash128(`${seedHex}/nebula`)),
    },
  };

  if (meta.isDisambiguation) {
    // Shattered system (§4.3): no star, debris everywhere, every entry a
    // gate. Precedence over the stub rule — a tiny disambig page shatters.
    const debris = root.fork('belt');
    return {
      schemaVersion: 1,
      seed: seedHex,
      sourceTitle: title,
      name: ctx.name,
      kind: 'shattered',
      star: null,
      bodies: [],
      gates: generateGates(meta.links, root.fork('gates'), 520, { all: true }),
      belt: {
        innerRadius: roundTo(debris.range(60, 120)),
        outerRadius: roundTo(debris.range(380, 470)),
        density: roundTo(debris.range(0.6, 0.9)),
      },
      ambient: { ...ctx.ambientBase, hazard: 'debris' },
      traffic: ctx.traffic,
    };
  }

  // §4.5: stub articles generate as their pre-rolled anomaly.
  if (meta.byteLength < STUB_BYTES) return generateAnomaly(meta, root, ctx);

  return generateStandard(meta, root, ctx);
}
