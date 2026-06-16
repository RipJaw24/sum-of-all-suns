/**
 * combat.ts — §15.3 light combat: one forward player gun, hostile return fire,
 * and the projectile sim. Damage routes through the existing damageHull path
 * (run.ts); a hostile killing blow sets death cause 'destroyed'. Rewards
 * (bounty credits, sometimes fuel/cargo) fold into the existing economy.
 *
 * Deliberately light (§15.3): dodge-and-shoot against a few enemies, not a
 * combat sim. Projectiles and agents are ephemeral runtime state — nothing
 * here is persisted or canon (the determinism boundary, §15.1).
 */

import { GOODS } from '../gen/goods';
import type { Rng } from '../rng';
import type { FactionId } from '../types';
import type { Agent } from './agents';
import { STANDING_DELTA, adjustStanding } from './reputation';
import { addCargo, addCredits, addFuel, damageHull, type RunState } from './run';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds of life left; ≤ 0 culls the shot. */
  ttl: number;
  /** Player shots hit agents; agent shots hit the player. */
  fromPlayer: boolean;
  damage: number;
}

export const COMBAT = {
  projectileSpeed: 520, // wu/s
  projectileTtl: 1.3, // s → ~675 wu effective range
  fireRange: 360, // agents only fire within this
  fireCooldown: 0.55, // s between shots (player and agents)
  playerDamage: 12,
  agentDamage: 6,
  /** Projectile vs ship/agent hit slop (added to the target radius). */
  hitRadius: 12,
} as const;

interface Pose {
  x: number;
  y: number;
  heading: number;
}

/** A forward shot from a ship at `heading`, spawned just off the nose. */
function shoot(from: Pose, fromPlayer: boolean, damage: number): Projectile {
  const nx = Math.cos(from.heading);
  const ny = Math.sin(from.heading);
  return {
    x: from.x + nx * 14,
    y: from.y + ny * 14,
    vx: nx * COMBAT.projectileSpeed,
    vy: ny * COMBAT.projectileSpeed,
    ttl: COMBAT.projectileTtl,
    fromPlayer,
    damage,
  };
}

export function firePlayerShot(ship: Pose): Projectile {
  return shoot(ship, true, COMBAT.playerDamage);
}

/** An agent's shot, aimed straight at the player's current position. */
export function fireAgentShot(agent: Agent, ship: { x: number; y: number }): Projectile {
  const heading = Math.atan2(ship.y - agent.y, ship.x - agent.x);
  return shoot({ x: agent.x, y: agent.y, heading }, false, COMBAT.agentDamage);
}

export interface KillEvent {
  type: Agent['type'];
  bounty: number;
  fuel: number;
  goodId?: string;
}

export interface CombatResult {
  /** A player-fired shot connected (for a kill toast). */
  playerScored: boolean;
  /** The player took a hit this step (damage flash / audio). */
  playerHit: boolean;
  /** The hit that ended the run, if any. */
  playerKilled: boolean;
  kills: KillEvent[];
}

/** Reward for destroying a hostile (§15.3): bounty + sometimes fuel/cargo. */
function rewardFor(agent: Agent, rng: Rng): KillEvent {
  const bounty = agent.type === 'pirate' ? rng.int(20, 51) : rng.int(10, 31);
  const fuel = rng.chance(0.4) ? rng.int(5, 16) : 0;
  const goodId = rng.chance(0.3) ? rng.pick(GOODS).id : undefined;
  return { type: agent.type, bounty, fuel, ...(goodId ? { goodId } : {}) };
}

/** Firing on a faction ship (not a pirate) costs standing with that faction
 *  once, and makes that ship hostile (handled by the caller setting hostile). */
function onPlayerHitAgent(agent: Agent, run: RunState): void {
  if (agent.faction && agent.type !== 'pirate' && !agent.provoked) {
    agent.provoked = true;
    adjustStanding(run, agent.faction, STANDING_DELTA.attackShip);
  }
}

/**
 * Advance projectiles, resolve collisions, and apply damage / rewards /
 * standing. Mutates `projectiles` (culls spent shots), agent hulls, and run
 * state; dead agents (hull ≤ 0) are left for the caller to filter. Returns a
 * summary for audio / toasts / damage flash.
 */
export function stepProjectiles(
  projectiles: Projectile[],
  agents: Agent[],
  ship: { x: number; y: number },
  run: RunState,
  systemFaction: FactionId | null,
  dt: number,
  rng: Rng,
): CombatResult {
  const result: CombatResult = {
    playerScored: false,
    playerHit: false,
    playerKilled: false,
    kills: [],
  };

  for (const p of projectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ttl -= dt;
    if (p.ttl <= 0) continue;

    if (p.fromPlayer) {
      for (const a of agents) {
        if (a.hull <= 0) continue;
        if (Math.hypot(a.x - p.x, a.y - p.y) <= COMBAT.hitRadius + a.radius) {
          a.hull -= p.damage;
          a.hostile = true; // shooting anything makes it fight back
          onPlayerHitAgent(a, run);
          p.ttl = 0;
          result.playerScored = true;
          if (a.hull <= 0) {
            const reward = rewardFor(a, rng);
            addCredits(run, reward.bounty);
            if (reward.fuel) addFuel(run, reward.fuel);
            if (reward.goodId) addCargo(run, reward.goodId, 1);
            // §13.3: destroying a pirate in a faction's space earns its favor;
            // a faction ship's death already cost standing on the first hit.
            if (a.type === 'pirate' && systemFaction) {
              adjustStanding(run, systemFaction, STANDING_DELTA.killEnemy);
            }
            result.kills.push(reward);
          }
          break;
        }
      }
    } else if (Math.hypot(ship.x - p.x, ship.y - p.y) <= COMBAT.hitRadius) {
      p.ttl = 0;
      result.playerHit = true;
      if (damageHull(run, p.damage, 'destroyed')) result.playerKilled = true;
    }
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    if (projectiles[i]!.ttl <= 0) projectiles.splice(i, 1);
  }
  return result;
}
