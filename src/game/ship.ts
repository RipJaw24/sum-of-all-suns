/**
 * ship.ts — §5 flight model: mouse-aim heading with capped turn rate,
 * Newtonian thrust with mild damping and a soft speed cap. Damped-Newtonian
 * ("Escape Velocity feel") per the spec — flight is not the skill ceiling.
 */

export interface ShipState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Nose heading, radians CCW from +X. */
  heading: number;
}

export interface ShipControls {
  /** Where the nose should point (mouse direction), radians. */
  targetHeading: number;
  thrust: boolean; // W / Up
  retro: boolean; // S / Down
  strafeLeft: boolean; // A / Left
  strafeRight: boolean; // D / Right
}

export const SHIP = {
  mainThrust: 260, // wu/s^2
  retroThrust: 150,
  strafeThrust: 90, // lateral RCS, weaker than main (§5)
  turnRate: 3.8, // rad/s max — gives the ship weight, no instant snap
  damping: 0.035, // fraction of velocity shed per second (spec: 2–5%/s)
  softCap: 420, // wu/s; thrust fades out approaching this
} as const;

export function makeShip(x = 0, y = 0): ShipState {
  return { x, y, vx: 0, vy: 0, heading: -Math.PI / 2 };
}

/** Shortest signed angle from a to b, in (-π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function updateShip(ship: ShipState, c: ShipControls, dt: number): void {
  // Rotate toward the cursor at a capped rate.
  const d = angleDelta(ship.heading, c.targetHeading);
  const maxTurn = SHIP.turnRate * dt;
  ship.heading += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;

  const nx = Math.cos(ship.heading);
  const ny = Math.sin(ship.heading);

  // Soft cap: thrust effectiveness fades as speed approaches the cap.
  const speed = Math.hypot(ship.vx, ship.vy);
  const headroom = Math.max(0, 1 - speed / SHIP.softCap);

  let ax = 0;
  let ay = 0;
  if (c.thrust) {
    ax += nx * SHIP.mainThrust * headroom;
    ay += ny * SHIP.mainThrust * headroom;
  }
  if (c.retro) {
    // Retro brakes against velocity, not backwards along the nose — feels
    // like a brake pedal, which is what players expect from S.
    if (speed > 1) {
      ax -= (ship.vx / speed) * SHIP.retroThrust;
      ay -= (ship.vy / speed) * SHIP.retroThrust;
    }
  }
  // Lateral RCS perpendicular to the nose.
  const strafe = (c.strafeRight ? 1 : 0) - (c.strafeLeft ? 1 : 0);
  if (strafe !== 0) {
    ax += -ny * strafe * SHIP.strafeThrust * headroom;
    ay += nx * strafe * SHIP.strafeThrust * headroom;
  }

  ship.vx += ax * dt;
  ship.vy += ay * dt;

  // Mild exponential damping (frame-rate independent).
  const damp = Math.exp(-SHIP.damping * dt); // ~3.5%/s
  ship.vx *= damp;
  ship.vy *= damp;

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
}
