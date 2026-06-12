/**
 * economy.test.ts — pricing scales with priceLevel (§3.2 traffic -> prices)
 * and yields are deterministic world data, not run randomness.
 */
import { describe, expect, it } from 'vitest';
import {
  miningYield,
  refuelUnitPrice,
  repairUnitPrice,
  serviceCost,
} from './economy';

describe('station pricing', () => {
  it('prices rise with priceLevel and never drop below 1 cr', () => {
    expect(refuelUnitPrice(0)).toBeGreaterThanOrEqual(1);
    expect(refuelUnitPrice(1)).toBeGreaterThan(refuelUnitPrice(0));
    expect(repairUnitPrice(0)).toBeGreaterThanOrEqual(1);
    expect(repairUnitPrice(1)).toBeGreaterThan(repairUnitPrice(0));
  });

  it('serviceCost rounds against the player', () => {
    expect(serviceCost(3, 1.5)).toBe(5);
    expect(serviceCost(0, 3)).toBe(0);
  });
});

describe('mining yield', () => {
  it('is deterministic per (system seed, body) and in range', () => {
    const a = miningYield('seed-a', 'body:2');
    expect(miningYield('seed-a', 'body:2')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(8);
    expect(a).toBeLessThanOrEqual(20);
    expect(miningYield('seed-a', 'body:3')).not.toBe(miningYield('seed-b', 'body:3'));
  });
});
