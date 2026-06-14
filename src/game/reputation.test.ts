/**
 * reputation.test.ts — §13.3 standing rules: clamping, the price multiplier,
 * the hostility floor, and the faction-less no-op.
 */
import { describe, expect, it } from 'vitest';
import { newRun, type RunState } from './run';
import {
  STANDING_HOSTILE_FLOOR,
  STANDING_MAX,
  STANDING_MIN,
  STANDING_PRICE_SWING,
  adjustStanding,
  patrolsHostile,
  standingOf,
  standingPriceMultiplier,
} from './reputation';

function run(): RunState {
  return newRun('Photosynthesis');
}

describe('standingOf / adjustStanding (§13.3)', () => {
  it('absent faction reads as neutral 0', () => {
    expect(standingOf(run(), 'helion_compact')).toBe(0);
  });

  it('accumulates and clamps to [MIN, MAX]', () => {
    const r = run();
    expect(adjustStanding(r, 'karn_ascendancy', 30)).toBe(30);
    expect(adjustStanding(r, 'karn_ascendancy', 30)).toBe(60);
    expect(adjustStanding(r, 'karn_ascendancy', 999)).toBe(STANDING_MAX);
    expect(adjustStanding(r, 'karn_ascendancy', -9999)).toBe(STANDING_MIN);
    expect(standingOf(r, 'karn_ascendancy')).toBe(STANDING_MIN);
  });

  it('null faction (unaligned frontier) is a no-op', () => {
    const r = run();
    expect(adjustStanding(r, null, 50)).toBe(0);
    expect(r.standing).toEqual({});
  });

  it('tracks factions independently', () => {
    const r = run();
    adjustStanding(r, 'helion_compact', 20);
    adjustStanding(r, 'ashfall_cartel', -40);
    expect(standingOf(r, 'helion_compact')).toBe(20);
    expect(standingOf(r, 'ashfall_cartel')).toBe(-40);
  });
});

describe('standingPriceMultiplier (§13.3)', () => {
  it('neutral is 1; allied is cheaper; pariah is pricier', () => {
    expect(standingPriceMultiplier(0)).toBe(1);
    expect(standingPriceMultiplier(STANDING_MAX)).toBeCloseTo(1 - STANDING_PRICE_SWING);
    expect(standingPriceMultiplier(STANDING_MIN)).toBeCloseTo(1 + STANDING_PRICE_SWING);
    expect(standingPriceMultiplier(50)).toBeLessThan(1);
    expect(standingPriceMultiplier(-50)).toBeGreaterThan(1);
  });
});

describe('patrolsHostile (§13.3 floor)', () => {
  it('turns hostile at or below the floor', () => {
    const r = run();
    expect(patrolsHostile(r, 'sable_directorate')).toBe(false);
    adjustStanding(r, 'sable_directorate', STANDING_HOSTILE_FLOOR);
    expect(patrolsHostile(r, 'sable_directorate')).toBe(true);
    adjustStanding(r, 'sable_directorate', 1); // just above the floor
    expect(patrolsHostile(r, 'sable_directorate')).toBe(false);
  });
});
