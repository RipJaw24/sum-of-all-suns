/**
 * agents.ts — §15 NPC agents: the ephemeral, MUTABLE half of the Living
 * Galaxy, kept strictly OUT of SystemSpec (the §15.1 determinism boundary).
 *
 *   populate(spec, run, rng) → a SEEDED initial spawn (count from traffic +
 *     habitation, type mix from faction + habitation), so a fresh arrival is
 *     reproducible — then stepAgents() drifts them freely each frame.
 *
 * Agents are despawned on jump, never persisted, never canon: they're flavor,
 * not topology. The shared galaxy is the graph + the pure spec; that's all
 * that must agree across players (§15.1).
 */

import type { Rng } from '../rng';
import type { FactionId, SystemSpec } from '../types';
import { COMBAT } from './combat';
import { patrolsHostile } from './reputation';
import type { RunState } from './run';

export type AgentType = 'trader' | 'patrol' | 'pirate' | 'drifter';

export interface Agent {
  id: string;
  type: AgentType;
  /** Owning faction (patrols/traders in faction space); null otherwise. */
  faction: FactionId | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  hull: number;
  hullMax: number;
  radius: number;
  /** Currently attacking the player. */
  hostile: boolean;
  /** Player has fired on this (faction) ship — standing already docked once. */
  provoked: boolean;
  fireCooldown: number;
  /** Wander waypoint for non-hostile drift. */
  targetX: number;
  targetY: number;
}

const AGENT = {
  warHull: 30, // pirate / patrol
  civHull: 18, // trader / drifter
  thrust: 175, // wu/s²
  turnRate: 2.6, // rad/s
  maxSpeed: 300, // wu/s
  damping: 0.4, // /s
  aggroRange: 620, // hostiles engage within this
  standoff: 120, // hostiles stop closing inside this
  radius: 9,
  /** Max agents in any one system — combat stays light (§15.3). */
  maxCount: 6,
} as const;

const TAU = Math.PI * 2;

/** Shortest signed angle from a to b, in (−π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

function turnToward(heading: number, target: number, maxStep: number): number {
  const d = angleDelta(heading, target);
  return heading + (Math.abs(d) <= maxStep ? d : Math.sign(d) * maxStep);
}

// --- spawn -------------------------------------------------------------------

/** Pick an agent type for the system's context (§15.2). Patrols need a
 *  faction to belong to; without one they degrade to drifters. */
function pickType(frontier: boolean, contested: boolean, hasFaction: boolean, rng: Rng): AgentType {
  let t: AgentType;
  if (frontier) {
    t = rng.pickWeighted([['pirate', 5], ['drifter', 4], ['trader', 1]]);
  } else if (contested) {
    t = rng.pickWeighted([['pirate', 3], ['patrol', 3], ['trader', 3], ['drifter', 1]]);
  } else {
    t = rng.pickWeighted([['trader', 5], ['patrol', 3], ['drifter', 2]]);
  }
  if (t === 'patrol' && !hasFaction) t = 'drifter';
  return t;
}

function makeAgent(
  id: string,
  type: AgentType,
  spec: SystemSpec,
  run: RunState,
  rim: number,
  rng: Rng,
): Agent {
  const angle = rng.angle();
  const dist = rng.range(140, rim * 0.9);
  const faction: FactionId | null =
    type === 'patrol' || type === 'trader' ? (spec.faction?.id ?? null) : null;
  const hull = type === 'pirate' || type === 'patrol' ? AGENT.warHull : AGENT.civHull;
  const hostile =
    type === 'pirate' ? true : type === 'patrol' && faction ? patrolsHostile(run, faction) : false;
  return {
    id,
    type,
    faction,
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    vx: 0,
    vy: 0,
    heading: rng.angle(),
    hull,
    hullMax: hull,
    radius: AGENT.radius,
    hostile,
    provoked: false,
    fireCooldown: rng.range(0, COMBAT.fireCooldown),
    targetX: 0,
    targetY: 0,
  };
}

/**
 * §15.1 — the seeded initial spawn for a system. Count scales with traffic +
 * habitation; the type mix with faction control. Reproducible from the passed
 * rng so a fresh arrival is the same each time, before the free-drift sim.
 */
export function populate(spec: SystemSpec, run: RunState, rng: Rng): Agent[] {
  const rim = spec.gates[0]?.rimRadius ?? 600;
  const frontier = spec.faction === null;
  const contested = spec.faction?.contested ?? false;

  let count = Math.round(spec.traffic * 4);
  if (spec.habitation === 'teeming') count += 2;
  else if (spec.habitation === 'settled') count += 1;
  // Even a quiet frontier has a little lawless traffic.
  if (frontier) count = Math.max(count, rng.int(1, 4));
  count = Math.min(Math.max(count, 0), AGENT.maxCount);

  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const type = pickType(frontier, contested, spec.faction !== null, rng);
    agents.push(makeAgent(`agent:${i}`, type, spec, run, rim, rng));
  }
  return agents;
}

// --- per-frame sim -----------------------------------------------------------

/**
 * Advance all agents one frame. Hostiles chase + fire at the player; everyone
 * else drifts between wander waypoints. Patrols flip hostile if standing has
 * fallen below the floor (§13.3). Returns the agents that fired this frame so
 * the caller can spawn their shots (combat.fireAgentShot). Mutates agents.
 */
export function stepAgents(
  agents: Agent[],
  ship: { x: number; y: number },
  run: RunState,
  dt: number,
  rng: Rng,
): Agent[] {
  const fired: Agent[] = [];
  for (const a of agents) {
    if (a.hull <= 0) continue;
    if (a.type === 'patrol' && a.faction && !a.hostile && patrolsHostile(run, a.faction)) {
      a.hostile = true;
    }

    const toShipX = ship.x - a.x;
    const toShipY = ship.y - a.y;
    const distShip = Math.hypot(toShipX, toShipY);
    const engaging = a.hostile && distShip < AGENT.aggroRange;

    let desiredHeading: number;
    let thrusting = true;
    if (engaging) {
      desiredHeading = Math.atan2(toShipY, toShipX);
      thrusting = distShip > AGENT.standoff; // hold a firing distance
    } else {
      if (Math.hypot(a.targetX - a.x, a.targetY - a.y) < 60) {
        const ang = rng.angle();
        const r = rng.range(150, 600);
        a.targetX = Math.cos(ang) * r;
        a.targetY = Math.sin(ang) * r;
      }
      desiredHeading = Math.atan2(a.targetY - a.y, a.targetX - a.x);
    }

    a.heading = turnToward(a.heading, desiredHeading, AGENT.turnRate * dt);
    if (thrusting) {
      a.vx += Math.cos(a.heading) * AGENT.thrust * dt;
      a.vy += Math.sin(a.heading) * AGENT.thrust * dt;
    }
    const sp = Math.hypot(a.vx, a.vy);
    if (sp > AGENT.maxSpeed) {
      a.vx = (a.vx / sp) * AGENT.maxSpeed;
      a.vy = (a.vy / sp) * AGENT.maxSpeed;
    }
    const damp = Math.exp(-AGENT.damping * dt);
    a.vx *= damp;
    a.vy *= damp;
    a.x += a.vx * dt;
    a.y += a.vy * dt;

    a.fireCooldown -= dt;
    if (a.hostile && distShip < COMBAT.fireRange && a.fireCooldown <= 0) {
      const aimError = Math.abs(angleDelta(a.heading, Math.atan2(toShipY, toShipX)));
      if (aimError < 0.4) {
        a.fireCooldown = COMBAT.fireCooldown;
        fired.push(a);
      }
    }
  }
  return fired;
}
