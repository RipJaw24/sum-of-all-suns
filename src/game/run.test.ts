/**
 * run.test.ts — fuel math (§7), route log, and the §4.2 return-gate rule.
 */
import { describe, expect, it } from 'vitest';
import { generateSystem } from '../gen/generate';
import { bioluminescentBay, photosynthesis } from '../gen/fixtures';
import type { GateSpec } from '../types';
import {
  BASE_JUMP_FUEL,
  FUEL_MAX,
  RETURN_GATE_ID,
  applyJump,
  canJump,
  gatesFor,
  jumpCost,
  loadRun,
  newRun,
  saveRun,
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

    storage.setItem('sas:run:v1', '{"nope":true}');
    expect(loadRun(storage)).toBeNull();
  });
});
