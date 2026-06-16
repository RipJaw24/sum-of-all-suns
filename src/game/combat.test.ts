/**
 * combat.test.ts — §15.3 projectile resolution: hits, kills + rewards, the
 * 'destroyed' player death, and the standing consequences of who you shoot.
 */
import { describe, expect, it } from 'vitest';
import { Rng, hash128 } from '../rng';
import type { Agent } from './agents';
import { COMBAT, type Projectile, firePlayerShot, stepProjectiles } from './combat';
import { STANDING_DELTA, standingOf } from './reputation';
import { newRun, type RunState } from './run';

function rng(): Rng {
  return new Rng(hash128('combat-test'));
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'a',
    type: 'pirate',
    faction: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    heading: 0,
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

/** A stationary player shot sitting on a point (so it lands this step). */
function playerShotAt(x: number, y: number): Projectile {
  return { x, y, vx: 0, vy: 0, ttl: 1, fromPlayer: true, damage: COMBAT.playerDamage };
}

describe('firePlayerShot (§15.3 forward gun)', () => {
  it('launches a player projectile along the ship heading', () => {
    const p = firePlayerShot({ x: 0, y: 0, heading: 0 });
    expect(p.fromPlayer).toBe(true);
    expect(p.vx).toBeCloseTo(COMBAT.projectileSpeed);
    expect(Math.abs(p.vy)).toBeLessThan(1e-6);
  });
});

describe('stepProjectiles (§15.3 resolution)', () => {
  const ship = { x: 0, y: 0 };

  it('a player shot damages an agent and is consumed', () => {
    const a = agent({ x: 100, y: 0, hull: 30 });
    const projectiles = [playerShotAt(100, 0)];
    const result = stepProjectiles(projectiles, [a], ship, newRun('X'), null, 0.016, rng());
    expect(a.hull).toBe(30 - COMBAT.playerDamage);
    expect(result.playerScored).toBe(true);
    expect(projectiles).toHaveLength(0); // spent
  });

  it('destroying a pirate pays a bounty and earns the system faction favor', () => {
    const run = newRun('X');
    const a = agent({ type: 'pirate', hull: 5, x: 0, y: 0 });
    const result = stepProjectiles([playerShotAt(0, 0)], [a], ship, run, 'helion_compact', 0.016, rng());
    expect(a.hull).toBeLessThanOrEqual(0);
    expect(result.kills).toHaveLength(1);
    expect(run.credits).toBeGreaterThan(newRun('X').credits); // bounty added
    expect(standingOf(run, 'helion_compact')).toBe(STANDING_DELTA.killEnemy);
  });

  it("a lethal enemy hit ends the run as 'destroyed'", () => {
    const run = newRun('X');
    run.hull = 4; // less than agentDamage
    const enemyShot: Projectile = { x: 0, y: 0, vx: 0, vy: 0, ttl: 1, fromPlayer: false, damage: COMBAT.agentDamage };
    const result = stepProjectiles([enemyShot], [], ship, run, null, 0.016, rng());
    expect(result.playerHit).toBe(true);
    expect(result.playerKilled).toBe(true);
    expect(run.status).toBe('dead');
    expect(run.deathCause).toBe('destroyed');
  });

  it('shooting a faction ship costs standing once and turns it hostile', () => {
    const run = newRun('X');
    const patrol = agent({ type: 'patrol', faction: 'helion_compact', hull: 100, hostile: false });
    const step = (): RunState => {
      stepProjectiles([playerShotAt(0, 0)], [patrol], ship, run, 'helion_compact', 0.016, rng());
      return run;
    };
    step();
    expect(patrol.hostile).toBe(true);
    expect(patrol.provoked).toBe(true);
    expect(standingOf(run, 'helion_compact')).toBe(STANDING_DELTA.attackShip);
    step(); // a second hit must NOT dock standing again
    expect(standingOf(run, 'helion_compact')).toBe(STANDING_DELTA.attackShip);
  });

  it('expired projectiles are culled without effect', () => {
    const projectiles = [{ x: 0, y: 0, vx: 0, vy: 0, ttl: 0.01, fromPlayer: true, damage: 12 }];
    const a = agent({ x: 9999, y: 0 });
    stepProjectiles(projectiles, [a], ship, newRun('X'), null, 0.05, rng());
    expect(projectiles).toHaveLength(0);
    expect(a.hull).toBe(30);
  });
});
