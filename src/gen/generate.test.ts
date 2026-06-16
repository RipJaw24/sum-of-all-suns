/**
 * generate.test.ts — Golden-file tests for the generation core (SPEC §9):
 * same ArticleMetadata must produce byte-identical SystemSpec, forever.
 * A golden diff means the shared galaxy changed for every player — either
 * revert, or accept the break and bump GEN_VERSION in rng.ts.
 */
import { describe, expect, it } from 'vitest';
import { GATES_MAX, GATES_MIN, MAX_BODIES, type SystemSpec } from '../types';
import { factionById } from './factions';
import { gateFuelFactor, generateSystem, unchartedOutcomeFor } from './generate';
import {
  bioluminescentBay,
  mercuryDisambiguation,
  photosynthesis,
  stubHazard,
  stubSalvage,
  stubSparse,
  stubTunnel,
} from './fixtures';
import { goodById } from './goods';

function golden(spec: SystemSpec): string {
  return JSON.stringify(spec, null, 2);
}

describe('golden files — byte-identical generation', () => {
  it('photosynthesis (rich standard article)', async () => {
    await expect(golden(generateSystem(photosynthesis))).toMatchFileSnapshot(
      './__goldens__/photosynthesis.golden.json',
    );
  });

  it('mercury (disambiguation -> shattered system)', async () => {
    await expect(golden(generateSystem(mercuryDisambiguation))).toMatchFileSnapshot(
      './__goldens__/mercury-disambiguation.golden.json',
    );
  });

  it('bioluminescent bay (rare star, stubs, wormhole)', async () => {
    await expect(golden(generateSystem(bioluminescentBay))).toMatchFileSnapshot(
      './__goldens__/bioluminescent-bay.golden.json',
    );
  });

  it('oxbow lake (stub -> salvage field)', async () => {
    await expect(golden(generateSystem(stubSalvage))).toMatchFileSnapshot(
      './__goldens__/stub-salvage.golden.json',
    );
  });

  it('tepui (stub -> deep tunnel)', async () => {
    await expect(golden(generateSystem(stubTunnel))).toMatchFileSnapshot(
      './__goldens__/stub-tunnel.golden.json',
    );
  });

  it('generation is pure: repeated calls are byte-identical', () => {
    expect(golden(generateSystem(photosynthesis))).toBe(golden(generateSystem(photosynthesis)));
  });
});

// --- §4.5 anomaly systems ------------------------------------------------------

describe('anomaly systems (§4.5: stub destinations)', () => {
  const sparse = generateSystem(stubSparse);
  const salvage = generateSystem(stubSalvage);
  const hazard = generateSystem(stubHazard);
  const tunnel = generateSystem(stubTunnel);
  const all = [sparse, salvage, hazard, tunnel];

  it("each stub's kind matches its gate pre-roll (promise == arrival)", () => {
    for (const [meta, sys] of [
      [stubSparse, sparse],
      [stubSalvage, salvage],
      [stubHazard, hazard],
      [stubTunnel, tunnel],
    ] as const) {
      expect(sys.kind).toBe(unchartedOutcomeFor(meta.title));
    }
  });

  it('no anomaly system hosts a station — stubs are wild space', () => {
    for (const sys of all) {
      expect(sys.bodies.every((b) => !b.station)).toBe(true);
    }
  });

  it('sparse: dim red dwarf, ≤2 barren bodies, ≤3 gates', () => {
    expect(sparse.star?.class).toBe('red_dwarf');
    expect(sparse.bodies.length).toBeLessThanOrEqual(2);
    expect(sparse.gates.length).toBeLessThanOrEqual(3);
    for (const b of sparse.bodies) {
      expect(b.hasRings).toBe(false);
      expect(b.moons).toEqual([]);
      expect(b.site.resource).toBeUndefined();
      expect(b.site.goodIds).toEqual([]);
    }
  });

  it('salvage field: richness in [0.2, 1], scaled by isolation', () => {
    expect(salvage.salvageRichness).toBeGreaterThanOrEqual(0.2);
    expect(salvage.salvageRichness).toBeLessThanOrEqual(1);
    // 2 outbound links, 950 bytes -> a well-isolated, well-paying wreck site.
    expect(salvage.salvageRichness!).toBeGreaterThan(0.5);
    // richness only exists on salvage fields
    for (const sys of [sparse, hazard, tunnel]) {
      expect(sys.salvageRichness).toBeUndefined();
    }
  });

  it('hazard pocket: ambient hazard + a tight-orbit rare-good deposit', () => {
    expect(['storm', 'radiation']).toContain(hazard.ambient.hazard);
    const deposit = hazard.bodies[0]!;
    expect(deposit.orbitRadius).toBeLessThan(150);
    expect(deposit.site.resource).toBe('mining');
    expect(deposit.site.goodIds).toHaveLength(1);
    expect(goodById(deposit.site.goodIds[0]!)?.tier).toBe('rare');
  });

  it('deep tunnel: every gate is uncharted with its own pre-roll, half fuel', () => {
    expect(tunnel.gates.length).toBeGreaterThan(0);
    for (const [i, gate] of tunnel.gates.entries()) {
      expect(gate.kind).toBe('uncharted');
      expect(gate.unchartedOutcome).toBe(unchartedOutcomeFor(gate.destinationTitle));
      expect(gate.fuelCostFactor).toBe(gateFuelFactor(i, 'uncharted'));
    }
  });

  it('disambiguation precedence: a tiny disambig page still shatters', () => {
    // mercury fixture is 1.9 KB — under STUB_BYTES, but disambig wins.
    expect(generateSystem(mercuryDisambiguation).kind).toBe('shattered');
  });
});

describe('structural invariants', () => {
  const standard = generateSystem(photosynthesis);
  const shattered = generateSystem(mercuryDisambiguation);
  const rare = generateSystem(bioluminescentBay);

  it('standard system respects spec bounds', () => {
    expect(standard.kind).toBe('standard');
    expect(standard.star).not.toBeNull();
    expect(standard.bodies.length).toBeLessThanOrEqual(MAX_BODIES);
    expect(standard.bodies.length).toBeGreaterThanOrEqual(1);
    expect(standard.gates.length).toBeGreaterThanOrEqual(GATES_MIN);
    expect(standard.gates.length).toBeLessThanOrEqual(GATES_MAX);
    // 135 refs >= belt threshold
    expect(standard.belt).toBeDefined();
    // infobox -> exactly one station
    expect(standard.bodies.filter((b) => b.station).length).toBe(1);
  });

  it('shattered system: no star, no bodies, EVERY entry is a gate', () => {
    expect(shattered.kind).toBe('shattered');
    expect(shattered.star).toBeNull();
    expect(shattered.bodies).toEqual([]);
    expect(shattered.gates.length).toBe(mercuryDisambiguation.links.length);
    expect(shattered.belt?.density).toBeGreaterThan(0.5);
  });

  it('rare article -> rare star', () => {
    expect(['pulsar', 'white_dwarf']).toContain(rare.star?.class);
  });

  it('uncharted gates carry pre-rolled outcomes; charted/wormhole do not', () => {
    for (const sys of [standard, shattered, rare]) {
      for (const gate of sys.gates) {
        if (gate.kind === 'uncharted') {
          expect(gate.unchartedOutcome).toBeDefined();
        } else {
          expect(gate.unchartedOutcome).toBeUndefined();
        }
      }
    }
  });

  it('fuel factors follow rank (§7): obscure links cost more, uncharted half', () => {
    expect(gateFuelFactor(0, 'charted')).toBe(1);
    expect(gateFuelFactor(2, 'charted')).toBeGreaterThan(gateFuelFactor(0, 'charted'));
    expect(gateFuelFactor(99, 'charted')).toBe(2.5); // capped
    expect(gateFuelFactor(4, 'uncharted')).toBe(gateFuelFactor(4, 'charted') / 2);
    for (const sys of [standard, shattered, rare]) {
      for (const [i, gate] of sys.gates.entries()) {
        expect(gate.fuelCostFactor).toBe(gateFuelFactor(i, gate.kind));
      }
    }
  });

  it('redirect links become wormholes targeting the resolved title', () => {
    const wormhole = rare.gates.find((g) => g.kind === 'wormhole');
    expect(wormhole?.destinationTitle).toBe('Noctiluca scintillans');
  });

  it('stub outcome depends only on the stub itself, not the origin system', () => {
    const a = unchartedOutcomeFor('Chemiosmosis');
    const b = unchartedOutcomeFor('chemiosmosis'); // normalization-insensitive
    expect(a).toBe(b);
  });

  it('SECRET-KEEPING: no display name ever contains a source title word', () => {
    for (const sys of [standard, shattered, rare]) {
      const spoilers = [
        sys.sourceTitle,
        ...sys.gates.map((g) => g.destinationTitle),
      ].flatMap((t) => t.toLowerCase().split(/[\s()]+/).filter((w) => w.length >= 4));
      const visible = [
        sys.name,
        ...sys.bodies.map((b) => b.name),
        ...sys.bodies.flatMap((b) => b.moons.map((m) => m.name)),
        ...sys.bodies.map((b) => b.station?.name ?? ''),
        ...sys.gates.map((g) => g.destinationName),
        // M5: the faction name (HUD + Decrypt) is a visible surface too.
        sys.faction ? factionById(sys.faction.id).name : '',
      ]
        .join(' ')
        .toLowerCase();
      for (const word of spoilers) {
        expect(visible, `leaked "${word}" in ${sys.sourceTitle}`).not.toContain(word);
      }
    }
  });

  it('traffic is normalized to [0, 1]', () => {
    for (const sys of [standard, shattered, rare]) {
      expect(sys.traffic).toBeGreaterThanOrEqual(0);
      expect(sys.traffic).toBeLessThanOrEqual(1);
    }
    expect(standard.traffic).toBeGreaterThan(rare.traffic); // 720k vs 4k views
  });
});
