/**
 * run.test.ts — fuel math (§7), route log, the §4.2 return-gate rule, and
 * the M2 additions: hull, credits, loot keys, stranding, persistence v2.
 */
import { describe, expect, it } from 'vitest';
import { generateSystem } from '../gen/generate';
import { bioluminescentBay, photosynthesis } from '../gen/fixtures';
import type { BodySpec, GateSpec, SystemSpec } from '../types';
import { HULL_MAX, START_CREDITS, refuelUnitPrice } from './economy';
import {
  BASE_JUMP_FUEL,
  FUEL_MAX,
  RETURN_GATE_ID,
  addCredits,
  addFuel,
  applyJump,
  canJump,
  damageHull,
  declareAdrift,
  gatesFor,
  isLooted,
  isStranded,
  jumpCost,
  loadRun,
  markLooted,
  newRun,
  saveRun,
  spendCredits,
} from './run';

const standard = generateSystem(photosynthesis);
const rare = generateSystem(bioluminescentBay);

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe('fuel (§7)', () => {
  it('jump cost scales with the gate fuel factor', () => {
    expect(jumpCost({ fuelCostFactor: 1 })).toBe(BASE_JUMP_FUEL);
    expect(jumpCost({ fuelCostFactor: 0.5 })).toBe(Math.round(BASE_JUMP_FUEL * 0.5));
    expect(jumpCost({ fuelCostFactor: 2.5 })).toBe(Math.round(BASE_JUMP_FUEL * 2.5));
  });

  it('applyJump spends fuel, moves the run, and extends the route', () => {
    const run = newRun('Photosynthesis');
    const gate = standard.gates[0]!;
    expect(canJump(run, gate)).toBe(true);

    applyJump(run, gate);

    expect(run.fuel).toBe(FUEL_MAX - jumpCost(gate));
    expect(run.previousTitle).toBe('Photosynthesis');
    expect(run.currentTitle).toBe(gate.destinationTitle);
    expect(run.route).toEqual([
      { title: 'Photosynthesis', via: 'start' },
      { title: gate.destinationTitle, via: gate.kind },
    ]);
  });

  it('canJump blocks when fuel is short; fuel floors at zero', () => {
    const run = newRun('Photosynthesis');
    const gate = standard.gates[0]!;
    run.fuel = jumpCost(gate) - 1;
    expect(canJump(run, gate)).toBe(false);
    applyJump(run, gate); // M2 owns death; today the floor is 0
    expect(run.fuel).toBe(0);
  });
});

describe('return gate (§4.2)', () => {
  it('injects nothing when the destination links back', () => {
    const linkedBack = standard.gates[0]!.destinationTitle;
    const fakeBackLink: GateSpec = { ...standard.gates[0]!, destinationTitle: 'Photosynthesis' };
    const spec = { ...standard, gates: [fakeBackLink, ...standard.gates.slice(1)] };
    expect(gatesFor(spec, 'Photosynthesis')).toHaveLength(spec.gates.length);
    expect(linkedBack).not.toBe('Photosynthesis'); // sanity: fixture has no self-link
  });

  it('injects a return gate when the destination does not link back', () => {
    const gates = gatesFor(rare, 'Photosynthesis');
    expect(gates).toHaveLength(rare.gates.length + 1);
    const ret = gates.find((g) => g.id === RETURN_GATE_ID)!;
    expect(ret.destinationTitle).toBe('Photosynthesis');
    expect(ret.kind).toBe('charted');
    expect(ret.fuelCostFactor).toBe(1);
    expect(ret.angle).toBeGreaterThanOrEqual(0);
    expect(ret.angle).toBeLessThan(Math.PI * 2);
    // Deterministic: same spec + origin -> same gate.
    expect(gatesFor(rare, 'Photosynthesis')).toEqual(gates);
    // SystemSpec untouched.
    expect(rare.gates.some((g) => g.id === RETURN_GATE_ID)).toBe(false);
  });

  it('no origin -> spec gates only', () => {
    expect(gatesFor(standard, undefined)).toEqual([...standard.gates]);
  });
});

describe('persistence', () => {
  it('round-trips through storage and rejects garbage', () => {
    const storage = fakeStorage();
    expect(loadRun(storage)).toBeNull();

    const run = newRun('Photosynthesis');
    applyJump(run, standard.gates[1]!);
    saveRun(run, storage);
    expect(loadRun(storage)).toEqual(run);

    storage.setItem('sas:run:v2', '{"nope":true}');
    expect(loadRun(storage)).toBeNull();
  });

  it('discards pre-M2 (v1) saves via the version guard', () => {
    const storage = fakeStorage();
    storage.setItem(
      'sas:run:v2',
      JSON.stringify({ schemaVersion: 1, currentTitle: 'Photosynthesis', fuel: 50 }),
    );
    expect(loadRun(storage)).toBeNull();
  });
});

// --- M2: hull, credits, loot (§7) -------------------------------------------

describe('hull & credits (§7)', () => {
  it('new runs start with full hull and starting credits', () => {
    const run = newRun('Photosynthesis');
    expect(run.hull).toBe(HULL_MAX);
    expect(run.credits).toBe(START_CREDITS);
    expect(run.status).toBe('active');
  });

  it('hull damage floors at 0 and kills exactly once', () => {
    const run = newRun('Photosynthesis');
    expect(damageHull(run, 30)).toBe(false);
    expect(run.hull).toBe(HULL_MAX - 30);
    expect(damageHull(run, 999)).toBe(true);
    expect(run.hull).toBe(0);
    expect(run.status).toBe('dead');
    expect(run.deathCause).toBe('hull');
    expect(damageHull(run, 10)).toBe(false); // already dead — no double-report
  });

  it('credits spend only when affordable; fuel clamps at max', () => {
    const run = newRun('Photosynthesis');
    expect(spendCredits(run, START_CREDITS + 1)).toBe(false);
    expect(run.credits).toBe(START_CREDITS);
    expect(spendCredits(run, 10)).toBe(true);
    addCredits(run, 5);
    expect(run.credits).toBe(START_CREDITS - 5);
    addFuel(run, 9999);
    expect(run.fuel).toBe(run.fuelMax);
  });

  it('loot keys are one-time and title-scoped', () => {
    const run = newRun('Photosynthesis');
    expect(isLooted(run, 'Volcano', 'body:1')).toBe(false);
    markLooted(run, 'Volcano', 'body:1');
    markLooted(run, 'Volcano', 'body:1'); // idempotent
    expect(isLooted(run, 'Volcano', 'body:1')).toBe(true);
    expect(isLooted(run, 'Volcano', 'body:2')).toBe(false);
    expect(run.looted).toEqual(['Volcano/body:1']);
  });
});

describe('isStranded (§7 fuel-out death)', () => {
  const gate = (factor: number): GateSpec => ({
    id: 'gate:0',
    destinationTitle: 'X',
    destinationName: 'X',
    kind: 'charted',
    angle: 0,
    rimRadius: 520,
    fuelCostFactor: factor,
  });
  const body = (over: Partial<BodySpec>): BodySpec => ({
    id: 'body:0',
    name: 'B',
    type: 'rocky',
    radius: 10,
    orbitRadius: 100,
    orbitPeriodSec: 100,
    initialAngle: 0,
    hasRings: false,
    moons: [],
    site: { goodIds: [], loreSeed: 's' },
    ...over,
  });
  const fakeSpec = (over: Partial<SystemSpec>): SystemSpec =>
    ({
      schemaVersion: 1,
      seed: '00000000000000000000000000000000',
      sourceTitle: 'Fake',
      name: 'Fake',
      kind: 'standard',
      star: null,
      bodies: [],
      gates: [],
      ambient: { paletteId: 0, nebulaSeed: 'n' },
      traffic: 0,
      ...over,
    }) as SystemSpec;

  function brokeRun(): ReturnType<typeof newRun> {
    const run = newRun('Photosynthesis');
    run.fuel = 1; // cheapest gate costs BASE_JUMP_FUEL
    run.credits = 0;
    return run;
  }

  it('not stranded while any gate is affordable', () => {
    const run = newRun('Photosynthesis');
    expect(isStranded(run, [gate(1)], fakeSpec({}))).toBe(false);
  });

  it('stranded when broke with no rescue in-system', () => {
    expect(isStranded(brokeRun(), [gate(1)], fakeSpec({}))).toBe(true);
  });

  it('a refuel station rescues only if credits cover the gap', () => {
    const station = {
      id: 'station:0',
      name: 'S',
      services: ['refuel'] as const,
      priceLevel: 0.5,
    };
    const spec = fakeSpec({ bodies: [body({ station: { ...station, services: ['refuel'] } })] });
    const run = brokeRun();
    expect(isStranded(run, [gate(1)], spec)).toBe(true); // 0 cr -> still stuck
    run.credits = refuelUnitPrice(0.5) * BASE_JUMP_FUEL; // can buy the gap
    expect(isStranded(run, [gate(1)], spec)).toBe(false);
  });

  it('a gas giant (skim) always rescues', () => {
    const spec = fakeSpec({
      bodies: [body({ type: 'gas_giant', site: { goodIds: [], loreSeed: 's', resource: 'fuel_skim' } })],
    });
    expect(isStranded(brokeRun(), [gate(1)], spec)).toBe(false);
  });

  it('a dead run is never reported stranded', () => {
    const run = brokeRun();
    declareAdrift(run);
    expect(run.deathCause).toBe('adrift');
    expect(isStranded(run, [gate(1)], fakeSpec({}))).toBe(false);
  });
});
