/**
 * agents.test.ts — §15 NPC spawn + AI: seeded reproducible spawn, the §15.2
 * type/faction rules, and hostile chase-and-fire behavior.
 */
import { describe, expect, it } from 'vitest';
import { Rng, hash128 } from '../rng';
import type { SystemSpec } from '../types';
import { type Agent, populate, stepAgents } from './agents';
import { adjustStanding, STANDING_HOSTILE_FLOOR } from './reputation';
import { newRun } from './run';

function rng(label = 'spawn'): Rng {
  return new Rng(hash128(label));
}

function fakeSpec(over: Partial<SystemSpec>): SystemSpec {
  return {
    schemaVersion: 2,
    seed: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceTitle: 'X',
    name: 'X',
    kind: 'standard',
    star: null,
    bodies: [],
    gates: [{ id: 'g', destinationTitle: 'Y', destinationName: 'Y', kind: 'charted', angle: 0, rimRadius: 600, fuelCostFactor: 1 }],
    ambient: { paletteId: 0, nebulaSeed: 'n' },
    faction: { id: 'helion_compact', contested: false },
    habitation: 'settled',
    biome: 'civic',
    traffic: 0.5,
    ...over,
  } as SystemSpec;
}

describe('populate (§15.1 seeded spawn)', () => {
  it('is reproducible from the same seed', () => {
    const spec = fakeSpec({});
    const a = populate(spec, newRun('X'), rng());
    const b = populate(spec, newRun('X'), rng());
    expect(a).toEqual(b);
  });

  it('count scales with traffic + habitation and caps at 6', () => {
    const quiet = populate(fakeSpec({ traffic: 0, habitation: 'sterile' }), newRun('X'), rng());
    const busy = populate(fakeSpec({ traffic: 1, habitation: 'teeming' }), newRun('X'), rng());
    expect(busy.length).toBeGreaterThan(quiet.length);
    expect(busy.length).toBeLessThanOrEqual(6);
  });

  it('frontier (no faction) spawns no patrols; faction ships carry the faction', () => {
    const frontier = populate(
      fakeSpec({ faction: null, traffic: 1, habitation: 'frontier' }),
      newRun('X'),
      rng('frontier'),
    );
    expect(frontier.length).toBeGreaterThan(0);
    expect(frontier.every((a) => a.type !== 'patrol')).toBe(true);
    expect(frontier.every((a) => a.faction === null)).toBe(true);
  });

  it('pirates spawn hostile; faction patrols are peaceful at neutral standing', () => {
    // A contested faction system reliably mixes pirates and patrols.
    const agents = populate(
      fakeSpec({ faction: { id: 'helion_compact', contested: true }, traffic: 1, habitation: 'teeming' }),
      newRun('X'),
      rng('mix'),
    );
    for (const a of agents) {
      if (a.type === 'pirate') expect(a.hostile).toBe(true);
      if (a.type === 'patrol') expect(a.hostile).toBe(false);
    }
  });

  it('patrols spawn hostile when standing is below the floor', () => {
    const run = newRun('X');
    adjustStanding(run, 'helion_compact', STANDING_HOSTILE_FLOOR - 10);
    const agents = populate(
      fakeSpec({ faction: { id: 'helion_compact', contested: true }, traffic: 1, habitation: 'teeming' }),
      run,
      rng('hostilePatrols'),
    );
    for (const a of agents) {
      if (a.type === 'patrol') expect(a.hostile).toBe(true);
    }
  });
});

function hostilePirate(over: Partial<Agent> = {}): Agent {
  return {
    id: 'p',
    type: 'pirate',
    faction: null,
    x: 120,
    y: 0,
    vx: 0,
    vy: 0,
    heading: Math.PI, // already facing the player at origin
    hull: 30,
    hullMax: 30,
    radius: 9,
    hostile: true,
    provoked: false,
    fireCooldown: 0,
    targetX: 0,
    targetY: 0,
    ...over,
  };
}

describe('stepAgents (§15 AI)', () => {
  const ship = { x: 0, y: 0 };

  it('a hostile pirate in range and on-target fires', () => {
    const p = hostilePirate();
    const fired = stepAgents([p], ship, newRun('X'), 0.1, rng());
    expect(fired).toEqual([p]);
    expect(p.fireCooldown).toBeGreaterThan(0); // reset after firing
  });

  it('a distant hostile closes on the player instead of firing', () => {
    const p = hostilePirate({ x: 500, y: 0 }); // beyond fireRange (360)
    const fired = stepAgents([p], ship, newRun('X'), 0.2, rng());
    expect(fired).toHaveLength(0);
    expect(p.x).toBeLessThan(500); // thrusting toward the player
  });

  it('a peaceful drifter never fires', () => {
    const d = hostilePirate({ type: 'drifter', hostile: false });
    const fired = stepAgents([d], ship, newRun('X'), 0.1, rng());
    expect(fired).toHaveLength(0);
  });
});
