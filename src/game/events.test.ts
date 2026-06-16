/**
 * events.test.ts — §16 events: deterministic seeded flavor (incl. the rare
 * Erasure foreshadow), the runtime encounter roll, and distress resolution.
 */
import { describe, expect, it } from 'vitest';
import { Rng, hash128 } from '../rng';
import type { SystemSpec } from '../types';
import {
  type DistressBeacon,
  ERASURE_CHANCE,
  makeDistress,
  resolveDistress,
  rollEncounter,
  seededEvent,
} from './events';
import { STANDING_HOSTILE_FLOOR, adjustStanding } from './reputation';
import { newRun } from './run';

function fakeSpec(over: Partial<SystemSpec> & { seed?: string } = {}): SystemSpec {
  return {
    schemaVersion: 2,
    seed: over.seed ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceTitle: 'X',
    name: 'X',
    kind: 'standard',
    star: null,
    bodies: [],
    gates: [{ id: 'g', destinationTitle: 'Y', destinationName: 'Y', kind: 'charted', angle: 0, rimRadius: 600, fuelCostFactor: 1 }],
    ambient: { paletteId: 0, nebulaSeed: 'n' },
    faction: { id: 'helion_compact', contested: false },
    habitation: 'frontier',
    biome: 'barren',
    traffic: 0.2,
    ...over,
  } as SystemSpec;
}

describe('seededEvent (§16.1 deterministic flavor)', () => {
  it('is the same for every player (pure of run state)', () => {
    const spec = fakeSpec({ seed: 'deadbeefdeadbeefdeadbeefdeadbeef' });
    expect(seededEvent(spec)).toEqual(seededEvent(spec));
  });

  it('reads context: convoy / bloom / surge / pilgrimage / quiet', () => {
    expect(seededEvent(fakeSpec({ kind: 'salvage_field' })).kind).toBe('derelict_convoy');
    expect(seededEvent(fakeSpec({ kind: 'deep_tunnel' })).kind).toBe('derelict_convoy');
    expect(seededEvent(fakeSpec({ biome: 'verdant', habitation: 'teeming' })).kind).toBe('bloom');
    expect(seededEvent(fakeSpec({ traffic: 0.9 })).kind).toBe('market_surge');
    expect(
      seededEvent(fakeSpec({ faction: { id: 'lattice_choir', contested: false } })).kind,
    ).toBe('pilgrimage'); // lattice_choir = zealot
    expect(seededEvent(fakeSpec({})).kind).toBe('quiet'); // plain frontier-ish standard
  });

  it('the Erasure foreshadow is rare and only haunts living standard systems', () => {
    let omens = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const seed = hash128(`omen-${i}`).map((w) => w.toString(16).padStart(8, '0')).join('');
      if (seededEvent(fakeSpec({ seed })).kind === 'erasure_omen') omens++;
    }
    // ~ERASURE_CHANCE of plain standard systems; assert present but rare.
    expect(omens).toBeGreaterThan(N * ERASURE_CHANCE * 0.5);
    expect(omens).toBeLessThan(N * ERASURE_CHANCE * 2);
    // Never in a dead anomaly (it needs a neighbor to lose).
    for (let i = 0; i < 200; i++) {
      const seed = hash128(`anom-${i}`).map((w) => w.toString(16).padStart(8, '0')).join('');
      expect(seededEvent(fakeSpec({ seed, kind: 'sparse' })).kind).not.toBe('erasure_omen');
    }
  });
});

describe('rollEncounter (§16.2 ephemeral)', () => {
  const sample = (spec: SystemSpec, run = newRun('X')) => {
    const counts = { none: 0, ambush: 0, distress: 0 };
    for (let i = 0; i < 400; i++) {
      counts[rollEncounter(spec, run, new Rng(hash128(`enc-${i}`)))]++;
    }
    return counts;
  };

  it('is deterministic for a given rng', () => {
    const spec = fakeSpec({});
    const a = rollEncounter(spec, newRun('X'), new Rng(hash128('x')));
    const b = rollEncounter(spec, newRun('X'), new Rng(hash128('x')));
    expect(a).toBe(b);
  });

  it('lawless busy space ambushes more than a peaceful faction core', () => {
    const lawless = sample(fakeSpec({ faction: null, traffic: 1 }));
    const core = sample(fakeSpec({ faction: { id: 'helion_compact', contested: false }, traffic: 0.1, habitation: 'settled' }));
    expect(lawless.ambush).toBeGreaterThan(core.ambush);
    // Encounters are spice, not every visit.
    expect(core.none).toBeGreaterThan(core.ambush + core.distress);
  });

  it('falling out of favor makes a faction system more dangerous', () => {
    const spec = fakeSpec({ faction: { id: 'helion_compact', contested: false }, traffic: 0.2 });
    const friendly = sample(spec);
    const hated = newRun('X');
    adjustStanding(hated, 'helion_compact', STANDING_HOSTILE_FLOOR);
    expect(sample(spec, hated).ambush).toBeGreaterThan(friendly.ambush);
  });
});

describe('distress (§16.2 resolution)', () => {
  it('makeDistress places a reachable beacon with a boolean trap', () => {
    const b = makeDistress(fakeSpec({}), new Rng(hash128('d')));
    expect(typeof b.trap).toBe('boolean');
    expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(600 * 0.8 + 1e-6);
  });

  it('a genuine call rewards credits + fuel and the system faction; a trap gives nothing', () => {
    const spec = fakeSpec({ faction: { id: 'helion_compact', contested: false } });
    const genuine: DistressBeacon = { id: 'd', x: 0, y: 0, trap: false };
    const out = resolveDistress(genuine, spec, new Rng(hash128('g')));
    expect(out.trap).toBe(false);
    expect(out.credits).toBeGreaterThan(0);
    expect(out.fuel).toBeGreaterThan(0);
    expect(out.standingFaction).toBe('helion_compact');
    expect(out.standingDelta).toBeGreaterThan(0);

    const trap: DistressBeacon = { id: 'd', x: 0, y: 0, trap: true };
    const trapped = resolveDistress(trap, spec, new Rng(hash128('t')));
    expect(trapped.trap).toBe(true);
    expect(trapped.credits).toBe(0);
    expect(trapped.fuel).toBe(0);
  });
});
