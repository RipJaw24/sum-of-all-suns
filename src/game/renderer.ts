/**
 * renderer.ts — PixiJS (WebGL) view of a SystemSpec. STRICTLY READ-ONLY
 * consumer of the spec (SPEC §9): no world data is computed here, only
 * pixels. M3 replaced the M0–M2 Canvas2D renderer; the draw() contract is
 * unchanged and main.ts still owns the rAF loop (autoStart: false).
 *
 * Two canvases: the Pixi world renders into #game; all 2D text overlays
 * (HUD here; dock/map/site/summary/transition in their modules) draw onto
 * the #overlay canvas above it. draw() clears the overlay each frame, so
 * overlay modules paint after it in frame order, exactly as before.
 */

import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { Rng, hash128 } from '../rng';
import type { BodySpec, GateSpec, StarSpec, SystemSpec } from '../types';
import { NebulaLayer } from './nebula';
import {
  type Rgb,
  type RingletSpec,
  type SurfaceTint,
  atmosphereTexture,
  cityLightsTexture,
  gasBandTexture,
  gasCloudTexture,
  hexToRgb,
  iceTexture,
  lavaTextures,
  makeRingletSpecs,
  mixColor,
  moonShadeTexture,
  nightShadeTexture,
  oceanCloudTexture,
  oceanTexture,
  planetPalette,
  rgbToNumber,
  rockyTexture,
  sphereShadeTexture,
} from './planetTextures';
import type { Agent } from './agents';
import type { Projectile } from './combat';
import type { Derelict } from './salvage';
import type { ShipState } from './ship';
import { type HullStyle, type StationStyle, factionVisual } from './factionVisuals';
import { biomeVisual, habitationVisual } from './habitationVisuals';
import { mixHex } from './palettes';
import { GATE_COLORS, bodyPosition, gatePosition, type HudState } from './view';

const LABEL_STYLE = { fontFamily: 'monospace', fontSize: 11, fill: 0xcdd6f4 } as const;

/** Radial-gradient glow texture (star halos). Canvas-baked once per color. */
function glowTexture(color: string): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(size / 2, size / 2, size * 0.07, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

/** Stroke one ringlet half as a polyline (Pixi v8 Graphics has no
 *  half-ellipse primitive). `overlap` extends past both endpoints. */
function drawHalfEllipse(g: Graphics, ringlet: RingletSpec, from: number, to: number, overlap: number): void {
  const segments = 40;
  const start = from - overlap;
  const span = to - from + overlap * 2;
  for (let i = 0; i <= segments; i++) {
    const theta = start + (span * i) / segments;
    const x = Math.cos(theta) * ringlet.rx;
    const y = Math.sin(theta) * ringlet.ry;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke({ width: ringlet.width, color: ringlet.color, alpha: ringlet.alpha });
}

/**
 * Draw a faction's station silhouette into `g`, centered at the origin, sized
 * by `s` (half-extent in wu). `tint` is the structure, `accent` the trim/lights.
 * Pure vector — crisp at any zoom, no baked texture. One family per disposition
 * (factionVisuals.ts STATION_BY_DISPOSITION), so a region's docks read alike.
 */
function drawStationStructure(g: Graphics, style: StationStyle, s: number, tint: string, accent: string): void {
  switch (style) {
    case 'ring': {
      // Merchant: a docking torus on a hub with spokes.
      g.circle(0, 0, s).stroke({ width: Math.max(2, s * 0.32), color: tint, alpha: 0.9 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.moveTo(0, 0).lineTo(Math.cos(a) * s, Math.sin(a) * s);
      }
      g.stroke({ width: Math.max(1, s * 0.14), color: accent, alpha: 0.8 });
      g.circle(0, 0, s * 0.34).fill(tint);
      break;
    }
    case 'fortress': {
      // Militarist: a blocky hex keep with corner turrets.
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        pts.push(Math.cos(a) * s, Math.sin(a) * s);
      }
      g.poly(pts).fill({ color: tint, alpha: 0.92 }).stroke({ width: 1.5, color: accent, alpha: 0.9 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        g.rect(Math.cos(a) * s - s * 0.12, Math.sin(a) * s - s * 0.12, s * 0.24, s * 0.24).fill(accent);
      }
      break;
    }
    case 'array': {
      // Scientific: a hub with dish-tipped sensor arms.
      g.circle(0, 0, s * 0.4).fill(tint);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const ex = Math.cos(a) * s;
        const ey = Math.sin(a) * s;
        g.moveTo(0, 0).lineTo(ex, ey).stroke({ width: Math.max(1, s * 0.12), color: tint, alpha: 0.85 });
        g.arc(ex, ey, s * 0.45, a + Math.PI - 0.9, a + Math.PI + 0.9).stroke({
          width: Math.max(1, s * 0.12),
          color: accent,
          alpha: 0.9,
        });
      }
      break;
    }
    case 'gantry': {
      // Industrial: a girder frame with cross-beams.
      g.rect(-s * 0.9, -s * 0.35, s * 1.8, s * 0.7).stroke({ width: Math.max(1.5, s * 0.16), color: tint, alpha: 0.9 });
      for (let i = -2; i <= 2; i++) {
        g.moveTo(i * s * 0.36, -s * 0.35).lineTo(i * s * 0.36, s * 0.35);
      }
      g.stroke({ width: Math.max(1, s * 0.1), color: accent, alpha: 0.75 });
      break;
    }
    case 'spire': {
      // Zealot: a tall spire with a glowing tip.
      g.poly([0, -s * 1.3, s * 0.4, s * 0.4, 0, s * 0.7, -s * 0.4, s * 0.4])
        .fill({ color: tint, alpha: 0.92 })
        .stroke({ width: 1, color: accent, alpha: 0.8 });
      g.circle(0, -s * 1.3, s * 0.18).fill(accent);
      break;
    }
    case 'scavenged': {
      // Outlaw: asymmetric welded-together chunks.
      g.rect(-s * 0.8, -s * 0.3, s * 0.9, s * 0.5).fill({ color: tint, alpha: 0.8 });
      g.rect(s * 0.1, -s * 0.5, s * 0.6, s * 0.8).fill({ color: tint, alpha: 0.7 });
      g.moveTo(-s, s * 0.2).lineTo(s * 0.9, -s * 0.6).stroke({ width: 1, color: accent, alpha: 0.7 });
      g.circle(s * 0.4, s * 0.1, s * 0.15).fill(accent);
      break;
    }
  }
}

/** Agent paint: faction livery when owned, else the type-neutral hues the old
 *  overlay used — so patrol/trader/drifter/pirate still read at a glance. */
function agentPaint(a: Agent): { base: string; trim: string } {
  const fv = a.faction ? factionVisual(a.faction) : null;
  if (fv) return { base: fv.tint, trim: fv.accent };
  switch (a.type) {
    case 'trader':
      return { base: '#9ee887', trim: '#c9f2b6' };
    case 'pirate':
      return { base: '#464050', trim: '#ff6b4a' };
    default: // drifter (patrols always carry a faction)
      return { base: '#aab0c0', trim: '#d8dce6' };
  }
}

/**
 * Draw an agent hull into `g`, nose at +X, roughly 2×radius long. Silhouette
 * family by AgentType; faction ships bend toward their disposition's
 * HullStyle (blocky/utilitarian squared, angular/jagged sharpened) so a
 * militarist patrol and a merchant escort don't share a body plan.
 */
function drawAgentHull(g: Graphics, a: Agent): void {
  const { base, trim } = agentPaint(a);
  const r = a.radius;
  const style: HullStyle | null = a.faction ? factionVisual(a.faction).hullStyle : null;
  const boxy = style === 'blocky' || style === 'utilitarian';
  const sharp = style === 'angular' || style === 'jagged';
  switch (a.type) {
    case 'trader': {
      // Freighter: cargo pods astern of a spine, cab at the nose.
      g.rect(-r * 1.1, -r * 0.3, r * 1.7, r * 0.6).fill({ color: base, alpha: 0.9 });
      g.rect(-r * 1.05, -r * 0.85, r * 0.75, r * 1.7).fill({ color: base, alpha: 0.72 });
      g.rect(-r * 0.15, -r * 0.7, r * 0.55, r * 1.4).fill({ color: base, alpha: 0.72 });
      if (boxy) g.rect(r * 0.5, -r * 0.4, r * 0.7, r * 0.8).fill(trim);
      else g.poly([r * 1.25, 0, r * 0.5, r * 0.42, r * 0.5, -r * 0.42]).fill(trim);
      break;
    }
    case 'patrol': {
      // Fighter: winged dart; nose length follows the disposition family.
      const nose = sharp ? r * 1.45 : boxy ? r * 1.05 : r * 1.25;
      g.poly([0, r * 0.25, -r * 0.75, r * 0.95, -r * 1.0, r * 0.7, -r * 0.45, r * 0.18])
        .poly([0, -r * 0.25, -r * 0.75, -r * 0.95, -r * 1.0, -r * 0.7, -r * 0.45, -r * 0.18])
        .fill({ color: base, alpha: 0.8 });
      g.poly([nose, 0, -r * 0.2, r * 0.45, -r * 0.85, r * 0.3, -r * 0.85, -r * 0.3, -r * 0.2, -r * 0.45])
        .fill(base)
        .stroke({ width: 1, color: trim, alpha: 0.85 });
      g.circle(r * 0.25, 0, r * 0.16).fill(trim);
      break;
    }
    case 'pirate': {
      // Raider: asymmetric jagged blades, a slash of accent across the hull.
      g.poly([
        r * 1.3, 0,
        -r * 0.2, r * 0.55,
        -r * 1.0, r * 0.95,
        -r * 0.55, r * 0.15,
        -r * 0.8, -r * 0.75,
        -r * 0.3, -r * 0.5,
      ])
        .fill({ color: base, alpha: 0.95 })
        .stroke({ width: 1, color: trim, alpha: 0.75 });
      g.moveTo(r * 0.6, -r * 0.12).lineTo(-r * 0.5, r * 0.35).stroke({ width: 1.2, color: trim, alpha: 0.9 });
      break;
    }
    case 'drifter': {
      // Tug: rounded pod, cabin nub, a trailing antenna.
      g.ellipse(0, 0, r * 0.9, r * 0.55).fill({ color: base, alpha: 0.9 });
      g.rect(r * 0.35, -r * 0.26, r * 0.55, r * 0.52).fill({ color: trim, alpha: 0.85 });
      g.moveTo(-r * 0.9, 0).lineTo(-r * 1.3, 0).stroke({ width: 1, color: trim, alpha: 0.6 });
      g.circle(-r * 1.3, 0, r * 0.1).fill(trim);
      break;
    }
  }
}

/** Starfield camera factor: between nebula (0.15×) and playfield (1×). */
const STARFIELD_PARALLAX = 0.3;

interface StarNode {
  root: Container;
  baseRadius: number;
}

/** GL node for one live NPC (§15). Membership churns via a create/destroy-
 *  by-id diff in syncAgents; transforms update every frame in draw(). */
interface AgentNode {
  root: Container;
  /** Rotates with the agent's heading: trail + hull. */
  shipC: Container;
  trail: Sprite;
  /** Pulsing threat ring, visible only while the agent is hostile. */
  hostileRing: Graphics;
  /** Unrotated hull bar above the ship; fg scale.x = hull fraction. */
  bar: Container;
  barFg: Graphics;
  /** Per-agent flicker/pulse phase (hashed from id — no rng draw). */
  phase: number;
}

/** A station rim light: pulses alpha in draw() to read as "powered & busy". */
interface StationLight {
  g: Graphics;
  base: number;
  amp: number;
  freq: number;
  phase: number;
}

/** Faction-styled dockable structure on a body (§13.2). The `spin` container
 *  rotates slowly; lights blink. Both are cheap per-frame tweaks, no rebuild. */
interface StationNode {
  spin: Container;
  spinRate: number;
  lights: StationLight[];
}

interface BodyNode {
  root: Container;
  body: BodySpec;
  moons: Container[];
  planet: PlanetNode;
  station: StationNode | null;
}

/** A textured surface layer; speed scrolls tilePosition.x in draw()
 *  (0 = static — gas bands/clouds and ocean clouds drift, the rest don't). */
interface PlanetLayer {
  sprite: TilingSprite;
  speed: number;
}

interface PlanetNode {
  root: Container;
  layers: PlanetLayer[];
  /** Lava only: emissive glow layer alpha-pulses (no texture regen). */
  pulse?: { sprite: TilingSprite; base: number; amp: number; freq: number; phase: number };
  /** Axis tilt in radians; rings share it so they sit on the equator. */
  tilt: number;
  /** §14 atmospheric limb glow, sized & added BEHIND the disc by buildBodies
   *  so only the limb peeks out. null for airless/gas bodies. */
  atmosphere: Sprite | null;
}

interface GateNode {
  root: Container;
  gate: GateSpec;
}

export class Renderer {
  /** §3.4 nebula shader, behind the world. */
  private readonly nebula = new NebulaLayer();
  private readonly nebulaLayer = new Container();
  private readonly world = new Container();
  /** Distant stars: screen-space layer between nebula (0.15×) and world (1×). */
  private readonly starfield = new Graphics();
  private readonly orbits = new Graphics();
  private readonly starLayer = new Container();
  private readonly bodyLayer = new Container();
  private readonly derelictLayer = new Container();
  private readonly gateLayer = new Container();
  private readonly agentLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly ship = new Container();
  /** Shared white radial glow; tinted per use (trails, tracers). */
  private readonly glowTex = glowTexture('#ffffff');
  private readonly shipGlow: Sprite;
  private readonly shipShield = new Graphics();
  /** 0..1 eased thrust level; the plume ramps rather than snapping. */
  private engineLevel = 0;

  private starNodes: StarNode[] = [];
  private starClass: StarSpec['class'] | null = null;
  private bodyNodes: BodyNode[] = [];
  private gateNodes: GateNode[] = [];
  private derelictIds = '';
  private agentNodes = new Map<string, AgentNode>();
  /** Tracer sprite pool; grows to the high-water mark, never shrinks. */
  private projectileSprites: Sprite[] = [];

  private constructor(
    private readonly app: Application,
    private readonly overlay: CanvasRenderingContext2D,
  ) {
    this.world.addChild(
      this.orbits,
      this.starLayer,
      this.bodyLayer,
      this.derelictLayer,
      this.gateLayer,
      this.agentLayer,
      this.projectileLayer,
      this.ship,
    );
    this.nebulaLayer.addChild(this.nebula.mesh);
    app.stage.addChild(this.nebulaLayer, this.starfield, this.world);

    // M6 Phase 3 player ship: engine plume (behind) + layered hull + shield
    // shimmer (in front). Same ~24px footprint as the old placeholder poly.
    this.shipGlow = new Sprite(glowTexture('#9fe0ff'));
    this.shipGlow.anchor.set(0.5);
    this.shipGlow.position.set(-14, 0);
    this.shipGlow.scale.set(0.26, 0.1);
    this.shipGlow.blendMode = 'add';
    this.shipGlow.alpha = 0;

    const hull = new Graphics();
    // Swept wing blades, under the fuselage.
    hull
      .poly([1, 2.4, -7.5, 8.2, -9.5, 7.2, -5.5, 2.4])
      .poly([1, -2.4, -7.5, -8.2, -9.5, -7.2, -5.5, -2.4])
      .fill(0xaeb9cd);
    // Central fuselage: a sleek dart, nose at +X (heading convention).
    hull
      .poly([13, 0, 3, 3.1, -6.5, 4, -9, 2.2, -9, -2.2, -6.5, -4, 3, -3.1])
      .fill(0xe8edf7)
      .stroke({ width: 1, color: 0x9aa7bd, alpha: 0.8 });
    // Engine block + twin nozzles at the tail.
    hull.rect(-10.5, -3, 2.4, 6).fill(0x8b96ab);
    hull.rect(-11.8, -2.3, 1.5, 1.8).rect(-11.8, 0.5, 1.5, 1.8).fill(0x69748a);
    // Canopy near the nose, in the player accent cyan (matches player shots).
    hull.poly([9, 0, 4.5, 1.7, 1.5, 1.2, 1.5, -1.2, 4.5, -1.7]).fill({ color: 0x7fd4ff, alpha: 0.95 });

    // Shield shimmer: three arc segments around the hull; alpha follows the
    // damageFlash signal (same source as the red vignette) and spins in draw().
    for (let i = 0; i < 3; i++) {
      const a0 = (i * Math.PI * 2) / 3;
      this.shipShield
        .moveTo(Math.cos(a0) * 17, Math.sin(a0) * 17)
        .arc(0, 0, 17, a0, a0 + 1.35);
    }
    this.shipShield.stroke({ width: 1.6, color: 0x7fd4ff, alpha: 0.9 });
    this.shipShield.alpha = 0;

    this.ship.addChild(this.shipGlow, hull, this.shipShield);
  }

  static async create(
    gameCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
  ): Promise<Renderer> {
    const app = new Application();
    // WebGL pinned: one GLSL shader path for the Phase-5 nebula, and stable
    // output under headless Chromium (Playwright screenshots).
    await app.init({
      canvas: gameCanvas,
      preference: 'webgl',
      antialias: true,
      background: '#04050a',
      autoStart: false,
    });
    return new Renderer(app, overlayCanvas.getContext('2d')!);
  }

  /** 'webgl' — exposed for verify scripts via the ?debug hook. */
  get rendererName(): string {
    return this.app.renderer.name;
  }

  /** Live GL agent-node count — verify-m6 asserts it tracks the agent list. */
  get agentNodeCount(): number {
    return this.agentNodes.size;
  }

  /** RGBA snapshot of the GL stage (verify scripts; the canvas itself reads
   *  blank without preserveDrawingBuffer — extract is the supported path). */
  extractPixels(): { pixels: Uint8ClampedArray; width: number; height: number } {
    return this.app.renderer.extract.pixels(this.app.stage);
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
  }

  /** (Re)build the scene graph for a system. */
  setSystem(spec: SystemSpec): void {
    this.nebula.setSystem(spec);
    this.buildStarfield(spec);
    this.buildOrbitsAndBelt(spec);
    this.buildStar(spec);
    this.buildBodies(spec);
    this.buildGates();
    this.derelictIds = ''; // force derelict rebuild on next draw
    this.derelictLayer.removeChildren();
    // Agent ids restart at agent:0 in the next system — stale nodes must
    // never be reused across a jump (wrong type/faction under the same id).
    this.agentNodes.clear();
    for (const c of this.agentLayer.removeChildren()) c.destroy({ children: true });
  }

  /** `gates` is the active list (spec gates + any §4.2 injected return gate);
   *  `derelicts` is the unlooted remainder (salvage.ts, filtered by main.ts);
   *  `agents`/`projectiles` are the live §15 encounter lists (ephemeral,
   *  never canon — the renderer just mirrors them into GL each frame). */
  draw(
    spec: SystemSpec,
    gates: readonly GateSpec[],
    ship: ShipState,
    t: number,
    hud: HudState,
    derelicts: readonly Derelict[] = [],
    agents: readonly Agent[] = [],
    projectiles: readonly Projectile[] = [],
  ): void {
    const { width, height } = this.overlay.canvas;

    // Gate set can change between draws (return-gate injection happens
    // after setSystem); rebuild lazily when it differs.
    if (
      this.gateNodes.length !== gates.length ||
      this.gateNodes.some((n, i) => n.gate.id !== gates[i]!.id)
    ) {
      this.buildGateNodes(gates);
    }
    this.syncDerelicts(derelicts);
    this.syncAgents(agents, t);
    this.syncProjectiles(projectiles);

    this.world.position.set(width / 2 - ship.x, height / 2 - ship.y);
    this.starfield.position.set(
      width / 2 - ship.x * STARFIELD_PARALLAX,
      height / 2 - ship.y * STARFIELD_PARALLAX,
    );
    this.nebula.frame(ship.x, ship.y, width, height);

    // Pulsar strobe (§3.1 rare stars).
    if (this.starClass === 'pulsar') {
      const s = 1 + 0.15 * Math.sin(t * 12);
      for (const node of this.starNodes) node.root.scale.set(s);
    }
    for (const node of this.bodyNodes) {
      const pos = bodyPosition(node.body, t);
      node.root.position.set(pos.x, pos.y);
      for (const layer of node.planet.layers) {
        if (layer.speed !== 0) layer.sprite.tilePosition.x = t * layer.speed;
      }
      const pulse = node.planet.pulse;
      if (pulse) pulse.sprite.alpha = pulse.base + pulse.amp * Math.sin(t * pulse.freq + pulse.phase);
      node.body.moons.forEach((moon, i) => {
        const ma = moon.initialAngle + ((Math.PI * 2) / moon.orbitPeriodSec) * t;
        node.moons[i]!.position.set(Math.cos(ma) * moon.orbitRadius, Math.sin(ma) * moon.orbitRadius);
      });
      const st = node.station;
      if (st) {
        st.spin.rotation = t * st.spinRate;
        for (const l of st.lights) l.g.alpha = l.base + l.amp * Math.sin(t * l.freq + l.phase);
      }
    }
    for (const node of this.gateNodes) {
      // Uncharted gates flicker (§4.5): no steady ping.
      node.root.alpha =
        node.gate.kind === 'uncharted'
          ? 0.35 + 0.65 * Math.abs(Math.sin(t * 5 + node.gate.angle * 7))
          : 1;
    }
    this.ship.position.set(ship.x, ship.y);
    this.ship.rotation = ship.heading;
    // Engine plume: ease toward the thrust state, flicker while lit — cheap
    // per-frame alpha/scale tweaks, same budget as the station light blink.
    this.engineLevel += ((hud.thrusting ? 1 : 0) - this.engineLevel) * 0.35;
    if (this.engineLevel < 0.005) this.engineLevel = 0;
    const plume = 0.82 + 0.18 * Math.sin(t * 43);
    this.shipGlow.alpha = this.engineLevel * plume;
    this.shipGlow.scale.set(0.26 * (0.7 + 0.45 * this.engineLevel * plume), 0.1);
    // Shield shimmer on recent damage.
    this.shipShield.alpha = Math.min(1, hud.damageFlash ?? 0) * 0.6;
    this.shipShield.rotation = t * 2.4;

    this.app.render();

    // 2D overlay pass: clear, then HUD. Overlay modules (dock/map/site/
    // summary/transition) draw after this call in main.ts frame order.
    this.overlay.clearRect(0, 0, width, height);
    if (hud.damageFlash && hud.damageFlash > 0) this.drawDamageVignette(hud.damageFlash);
    this.drawHud(spec, hud);
  }

  // --- scene building ---------------------------------------------------------

  private buildStarfield(spec: SystemSpec): void {
    const rim = spec.gates[0]?.rimRadius ?? 600;
    const extent = rim + 900;
    const rng = new Rng(hash128(`${spec.seed}/starfield`));
    this.starfield.clear();
    for (let i = 0; i < 1100; i++) {
      const x = rng.range(-extent, extent);
      const y = rng.range(-extent, extent);
      // Power-law size bias: most stars stay sub-pixel, a rare few reach ~3px.
      const r = 0.4 + rng.float() ** 3 * 2.6;
      const alpha = rng.range(0.2, 0.55) + (r / 3) * 0.4;
      this.starfield.rect(x, y, r, r).fill({ color: 0xcdd6f4, alpha });
    }
  }

  private buildOrbitsAndBelt(spec: SystemSpec): void {
    const g = this.orbits;
    g.clear();
    for (const body of spec.bodies) {
      g.circle(0, 0, body.orbitRadius).stroke({ width: 1, color: 0x8ca0c8, alpha: 0.12 });
    }
    if (spec.belt) {
      // Dashed belt ring: short arc segments (Canvas2D used setLineDash).
      const mid = (spec.belt.innerRadius + spec.belt.outerRadius) / 2;
      const beltWidth = spec.belt.outerRadius - spec.belt.innerRadius;
      const alpha = 0.1 + spec.belt.density * 0.25;
      const circumference = Math.PI * 2 * mid;
      const dashes = Math.max(24, Math.floor(circumference / 10));
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * Math.PI * 2;
        const a1 = a0 + ((Math.PI * 2) / dashes) * 0.3;
        g.moveTo(Math.cos(a0) * mid, Math.sin(a0) * mid);
        g.arc(0, 0, mid, a0, a1);
        g.stroke({ width: beltWidth, color: 0xaa9678, alpha });
      }
    }
    const rim = spec.gates[0]?.rimRadius;
    if (rim) {
      g.circle(0, 0, rim).stroke({ width: 1, color: 0x7fd4ff, alpha: 0.08 });
    }
  }

  private buildStar(spec: SystemSpec): void {
    this.starLayer.removeChildren();
    this.starNodes = [];
    this.starClass = spec.star?.class ?? null;
    if (!spec.star) return;
    const star = spec.star;

    const make = (x: number, r: number): void => {
      const root = new Container();
      root.position.set(x, 0);
      const glow = new Sprite(glowTexture(star.color));
      glow.anchor.set(0.5);
      glow.width = r * 6;
      glow.height = r * 6;
      const core = new Graphics().circle(0, 0, r).fill(star.color);
      root.addChild(glow, core);
      this.starLayer.addChild(root);
      this.starNodes.push({ root, baseRadius: r });
    };

    if (star.class === 'binary') {
      const sep = star.radius * 1.6;
      make(-sep, star.radius * 0.8);
      make(sep, star.radius * 0.65);
    } else {
      make(0, star.radius);
    }
  }

  private buildBodies(spec: SystemSpec): void {
    this.bodyLayer.removeChildren();
    this.bodyNodes = [];
    for (const body of spec.bodies) {
      const root = new Container();
      const planet = this.makePlanet(body, spec);
      const atmo = planet.atmosphere;
      // Ring halves sandwich the sphere so the planet occludes the far side;
      // the atmosphere glow sits just behind the disc so only its limb shows.
      if (body.hasRings) {
        const rings = this.makeRings(body, spec.seed, planet.tilt);
        root.addChild(rings.back, ...(atmo ? [atmo] : []), planet.root, rings.front);
      } else {
        root.addChild(...(atmo ? [atmo] : []), planet.root);
      }

      const moons: Container[] = body.moons.map((moon) => {
        const m = new Container();
        const core = new Graphics().circle(0, 0, moon.radius).fill(0x9aa0ae);
        const shade = new Sprite(moonShadeTexture());
        shade.anchor.set(0.5);
        shade.width = moon.radius * 2;
        shade.height = moon.radius * 2;
        m.addChild(core, shade);
        root.addChild(m);
        return m;
      });

      let station: StationNode | null = null;
      if (body.station) {
        const built = this.makeStation(body, spec);
        root.addChild(built.root);
        station = built.node;
      }

      const label = new Text({ text: body.name, style: LABEL_STYLE });
      label.alpha = 0.75;
      label.anchor.set(0.5, 0);
      label.position.set(0, body.radius + 6);
      root.addChild(label);

      this.bodyLayer.addChild(root);
      this.bodyNodes.push({ root, body, moons, planet, station });
    }
  }

  /** Textured sphere for any body type. Gas giants keep their frozen rng
   *  labels and draw order (`gas:${id}:motion`: tilt, band speed, cloud
   *  speed) so existing systems don't reroll. */
  private makePlanet(body: BodySpec, spec: SystemSpec): PlanetNode {
    const seed = spec.seed;
    const diameter = body.radius * 2;
    const gas = body.type === 'gas_giant';
    const rng = new Rng(hash128(`${seed}/${gas ? 'gas' : 'planet'}:${body.id}:motion`));
    const tilt = gas ? rng.range(-0.5, 0.5) : rng.range(-0.35, 0.35);

    // §14: tint the surface toward the biome's hue (pure transform, no reroll).
    const bv = biomeVisual(spec.biome);
    const tint: SurfaceTint = { color: hexToRgb(bv.surfaceTint), strength: bv.tintStrength };

    interface LayerDef {
      texture: Texture;
      speed: number;
      alpha?: number;
      additive?: boolean;
    }
    const defs: LayerDef[] = [];
    switch (body.type) {
      case 'gas_giant':
        defs.push({
          texture: gasBandTexture(seed, body),
          speed: rng.range(3, 8) * (rng.chance(0.5) ? 1 : -1),
        });
        defs.push({
          texture: gasCloudTexture(seed, body),
          speed: rng.range(9, 18) * (rng.chance(0.5) ? 1 : -1),
          alpha: 0.62,
        });
        break;
      case 'rocky':
        defs.push({ texture: rockyTexture(seed, body, tint), speed: 0 });
        break;
      case 'ice':
        defs.push({ texture: iceTexture(seed, body, tint), speed: 0 });
        break;
      case 'lava': {
        const { crust, glow } = lavaTextures(seed, body);
        defs.push({ texture: crust, speed: 0 });
        defs.push({ texture: glow, speed: 0, additive: true });
        break;
      }
      case 'ocean':
        defs.push({ texture: oceanTexture(seed, body, tint), speed: 0 });
        defs.push({
          texture: oceanCloudTexture(seed, body),
          speed: rng.range(3, 7) * (rng.chance(0.5) ? 1 : -1),
          alpha: 0.5,
        });
        break;
    }

    const spin = new Container();
    spin.rotation = tilt;
    const layers: PlanetLayer[] = defs.map((def) => {
      // +4px bleed: the rotated square only just covers the inscribed circle,
      // and AA at the tangent points can show seams without it.
      const sprite = new TilingSprite({
        texture: def.texture,
        width: diameter + 4,
        height: diameter + 4,
        anchor: 0.5,
        applyAnchorToTexture: true,
        tileScale: {
          x: (body.radius * 4) / def.texture.width,
          y: diameter / def.texture.height,
        },
      });
      if (def.alpha !== undefined) sprite.alpha = def.alpha;
      if (def.additive) sprite.blendMode = 'add';
      spin.addChild(sprite);
      return { sprite, speed: def.speed };
    });

    let pulse: PlanetNode['pulse'];
    if (body.type === 'lava') {
      pulse = {
        sprite: layers[1]!.sprite,
        base: 0.75,
        amp: 0.25,
        freq: rng.range(1.5, 3),
        phase: rng.angle(),
      };
    }

    const shade = new Sprite(sphereShadeTexture());
    shade.anchor.set(0.5);
    shade.width = diameter;
    shade.height = diameter;

    // §14 deepened terminator: a directional night shadow on terrestrial
    // worlds (not gas/lava, which keep their bright/emissive look).
    const terrestrial = body.type === 'rocky' || body.type === 'ice' || body.type === 'ocean';
    let nightShade: Sprite | null = null;
    if (terrestrial) {
      nightShade = new Sprite(nightShadeTexture());
      nightShade.anchor.set(0.5);
      nightShade.width = diameter;
      nightShade.height = diameter;
    }

    // §14 night-side city lights: inhabited, life-bearing worlds only (barren
    // has lightColor '#000000'; gas/lava don't get cities). Additive, over the
    // shade so the glow reads against the dark side.
    const cityLights =
      bv.lightColor !== '#000000' &&
      habitationVisual(spec.habitation).cityLights > 0 &&
      (body.type === 'rocky' || body.type === 'ice' || body.type === 'ocean')
        ? habitationVisual(spec.habitation).cityLights
        : 0;
    let lights: Sprite | null = null;
    if (cityLights > 0) {
      lights = new Sprite(cityLightsTexture(seed, body, cityLights, bv.lightColor));
      lights.anchor.set(0.5);
      lights.width = diameter;
      lights.height = diameter;
      lights.blendMode = 'add';
    }

    const rimColor = gas
      ? 0xf4e8cf
      : rgbToNumber(mixColor(planetPalette(seed, body)[1]!, { r: 255, g: 255, b: 255 }, 0.55));
    const rim = new Graphics()
      .circle(0, 0, body.radius)
      .stroke({ width: 1.5, color: rimColor, alpha: gas ? 0.32 : 0.25 });
    const mask = new Graphics().circle(0, 0, body.radius).fill(0xffffff);
    const root = new Container();
    root.mask = mask;
    root.addChild(
      spin,
      shade,
      ...(nightShade ? [nightShade] : []),
      ...(lights ? [lights] : []),
      rim,
      mask,
    );

    // §14 atmosphere: oceans always; inhabited or verdant/civic land worlds too.
    const hasAtmosphere =
      body.type === 'ocean' ||
      ((body.type === 'rocky' || body.type === 'ice') &&
        (cityLights > 0 || spec.biome === 'verdant' || spec.biome === 'civic'));
    let atmosphere: Sprite | null = null;
    if (hasAtmosphere) {
      const skyHex = mixHex('#9fc6ff', bv.surfaceTint, 0.35);
      atmosphere = new Sprite(atmosphereTexture(skyHex));
      atmosphere.anchor.set(0.5);
      atmosphere.width = diameter * 1.6;
      atmosphere.height = diameter * 1.6;
    }

    return { root, layers, ...(pulse ? { pulse } : {}), tilt, atmosphere };
  }

  /** Ring system as two Graphics: the upper half-ellipse sits behind the
   *  sphere, the lower in front, so the planet occludes the far side. */
  private makeRings(body: BodySpec, seed: string, tilt: number): { back: Graphics; front: Graphics } {
    const palette = planetPalette(seed, body);
    const specs = makeRingletSpecs(seed, body, palette);
    const back = new Graphics();
    const front = new Graphics();
    for (const ringlet of specs) {
      // Front half overdraws the joint slightly: butt-capped polyline ends
      // otherwise leave an AA seam where the halves meet at the planet edge.
      drawHalfEllipse(back, ringlet, Math.PI, Math.PI * 2, 0);
      drawHalfEllipse(front, ringlet, 0, Math.PI, 0.06);
    }
    back.rotation = tilt;
    front.rotation = tilt;
    return { back, front };
  }

  /**
   * §13.2 station node sitting just off a body's edge. Silhouette from the
   * controlling faction's disposition, structure tinted by its color (a
   * contested system swaps in a warning accent), scale + light count from the
   * system's habitation tier. Unaligned frontier → a neutral relay.
   */
  private makeStation(body: BodySpec, spec: SystemSpec): { root: Container; node: StationNode } {
    const fv = spec.faction ? factionVisual(spec.faction.id) : null;
    const hv = habitationVisual(spec.habitation);
    const tint = fv?.tint ?? '#8aa0b8';
    const accent = spec.faction?.contested ? '#ffb35e' : (fv?.accent ?? '#cdd6f4');
    const style: StationStyle = fv?.stationStyle ?? 'ring';
    const size = 9 * hv.stationScale;
    const rng = new Rng(hash128(`${spec.seed}/station:${body.id}`));

    const root = new Container();
    root.position.set(body.radius + 16 + size, 0);

    // Dockable affordance: a faint static halo (a cue, not the exact range).
    const halo = new Graphics().circle(0, 0, size * 2.4).stroke({ width: 1, color: accent, alpha: 0.18 });
    root.addChild(halo);

    const spin = new Container();
    const structure = new Graphics();
    drawStationStructure(structure, style, size, tint, accent);
    spin.addChild(structure);

    // Blinking rim lights; count rises with habitation (sterile relay → teeming hub).
    const lights: StationLight[] = [];
    const count = Math.round(hv.stationLights * 6);
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = size * 1.15;
      const g = new Graphics()
        .circle(Math.cos(ang) * r, Math.sin(ang) * r, Math.max(1, size * 0.12))
        .fill(accent);
      spin.addChild(g);
      lights.push({ g, base: 0.5, amp: 0.5, freq: rng.range(2, 5), phase: rng.angle() });
    }

    root.addChild(spin);
    const spinRate = rng.range(0.12, 0.3) * (rng.chance(0.5) ? 1 : -1);
    return { root, node: { spin, spinRate, lights } };
  }

  private buildGates(): void {
    // Actual nodes are built lazily in draw() from the ACTIVE gate list
    // (which includes the §4.2 injected return gate, unknown at setSystem).
    this.gateLayer.removeChildren();
    this.gateNodes = [];
  }

  private buildGateNodes(gates: readonly GateSpec[]): void {
    this.gateLayer.removeChildren();
    this.gateNodes = gates.map((gate) => {
      const pos = gatePosition(gate);
      const size = 12;
      const root = new Container();
      root.position.set(pos.x, pos.y);
      const diamond = new Graphics()
        .poly([0, -size, size, 0, 0, size, -size, 0])
        .stroke({ width: 2, color: GATE_COLORS[gate.kind] });
      root.addChild(diamond);
      // Charted gates show where they lead; uncharted are unscannable (§4.5).
      if (gate.kind !== 'uncharted') {
        const label = new Text({ text: gate.destinationName, style: LABEL_STYLE });
        label.alpha = 0.7;
        label.anchor.set(0.5, 1);
        label.position.set(0, -size - 4);
        root.addChild(label);
      }
      this.gateLayer.addChild(root);
      return { root, gate };
    });
  }

  private syncDerelicts(derelicts: readonly Derelict[]): void {
    const ids = derelicts.map((d) => d.id).join('|');
    if (ids === this.derelictIds) return;
    this.derelictIds = ids;
    this.derelictLayer.removeChildren();
    for (const d of derelicts) {
      const root = new Container();
      root.position.set(d.x, d.y);
      // Wreck: broken hull silhouette, dim.
      const hull = new Graphics();
      hull.moveTo(10, 0).lineTo(-7, 6).moveTo(-3, 1).lineTo(-7, -6);
      hull.stroke({ width: 2, color: 0xaaafbe, alpha: 0.8 });
      hull.rotation = (hash128(d.id)[0] / 0x1_0000_0000) * Math.PI * 2;
      const label = new Text({
        text: 'derelict',
        style: { ...LABEL_STYLE, fontSize: 10 },
      });
      label.alpha = 0.55;
      label.anchor.set(0.5, 0);
      label.position.set(0, 12);
      root.addChild(hull, label);
      this.derelictLayer.addChild(root);
    }
  }

  /** Mirror the live agent list into GL: create/destroy by id (the
   *  syncDerelicts discipline, but per-node so survivors keep their sprites),
   *  then per-frame transform + trail/threat/hull-bar updates. */
  private syncAgents(agents: readonly Agent[], t: number): void {
    for (const [id, node] of this.agentNodes) {
      if (!agents.some((a) => a.id === id)) {
        this.agentLayer.removeChild(node.root);
        node.root.destroy({ children: true });
        this.agentNodes.delete(id);
      }
    }
    for (const a of agents) {
      let node = this.agentNodes.get(a.id);
      if (!node) {
        node = this.makeAgentNode(a);
        this.agentNodes.set(a.id, node);
        this.agentLayer.addChild(node.root);
      }
      node.root.position.set(a.x, a.y);
      node.shipC.rotation = a.heading;
      // Engine trail brightens with speed, with a light flicker.
      const sp = Math.min(1, Math.hypot(a.vx, a.vy) / 300);
      node.trail.alpha = sp * (0.55 + 0.18 * Math.sin(t * 37 + node.phase));
      node.hostileRing.visible = a.hostile;
      if (a.hostile) node.hostileRing.alpha = 0.35 + 0.25 * Math.sin(t * 6 + node.phase);
      const frac = Math.max(0, Math.min(1, a.hull / a.hullMax));
      node.bar.visible = frac < 1;
      node.barFg.scale.x = frac;
    }
  }

  private makeAgentNode(a: Agent): AgentNode {
    const { trim } = agentPaint(a);
    const root = new Container();

    const shipC = new Container();
    const trail = new Sprite(this.glowTex);
    trail.anchor.set(0.5);
    trail.position.set(-a.radius - 5, 0);
    trail.scale.set(0.16, 0.06);
    trail.blendMode = 'add';
    trail.tint = trim;
    trail.alpha = 0;
    const hull = new Graphics();
    drawAgentHull(hull, a);
    shipC.addChild(trail, hull);

    const hostileRing = new Graphics()
      .circle(0, 0, a.radius + 5)
      .stroke({ width: 1.2, color: 0xff6b4a, alpha: 0.8 });
    hostileRing.visible = false;

    // Hull bar above the ship (screen-up = −y), unrotated; fg anchors left
    // by drawing from x=0 in a container offset half a bar-width.
    const bar = new Container();
    bar.position.set(-8, -a.radius - 8);
    const barBg = new Graphics().rect(0, 0, 16, 2).fill({ color: 0x241c22, alpha: 0.85 });
    const barFg = new Graphics().rect(0, 0, 16, 2).fill(0xff6b4a);
    bar.addChild(barBg, barFg);
    bar.visible = false;

    root.addChild(shipC, hostileRing, bar);
    const phase = (hash128(a.id)[0]! / 0x1_0000_0000) * Math.PI * 2;
    return { root, shipC, trail, hostileRing, bar, barFg, phase };
  }

  /** Tracers: a pooled additive glow per live projectile, stretched along
   *  its velocity; player shots cyan, hostile shots red (the §15 colors). */
  private syncProjectiles(shots: readonly Projectile[]): void {
    while (this.projectileSprites.length < shots.length) {
      const s = new Sprite(this.glowTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.scale.set(0.2, 0.055);
      this.projectileLayer.addChild(s);
      this.projectileSprites.push(s);
    }
    for (let i = 0; i < this.projectileSprites.length; i++) {
      const sprite = this.projectileSprites[i]!;
      const shot = shots[i];
      if (!shot) {
        sprite.visible = false;
        continue;
      }
      sprite.visible = true;
      sprite.position.set(shot.x, shot.y);
      sprite.rotation = Math.atan2(shot.vy, shot.vx);
      sprite.tint = shot.fromPlayer ? 0x7fd4ff : 0xff6b4a;
      sprite.alpha = Math.min(1, shot.ttl / 0.25); // fade out at end of life
    }
  }

  // --- 2D overlay: vignette + HUD (ported verbatim from the M2 renderer) -------

  private drawDamageVignette(intensity: number): void {
    const ctx = this.overlay;
    const { width, height } = ctx.canvas;
    const g = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.35,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7,
    );
    g.addColorStop(0, 'rgba(255, 60, 30, 0)');
    g.addColorStop(1, `rgba(255, 60, 30, ${0.45 * Math.min(1, intensity)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  private drawHud(spec: SystemSpec, hud: HudState): void {
    const ctx = this.overlay;
    ctx.fillStyle = '#cdd6f4';
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(spec.name, 16, 28);
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
    ctx.fillText(`${spec.kind} system · jumps ${hud.jumps}/${hud.goalJumps} · [TAB] chart`, 16, 46);

    const bar = (y: number, frac: number, color: string, label: string) => {
      ctx.fillStyle = 'rgba(205, 214, 244, 0.25)';
      ctx.fillRect(16, y, 140, 8);
      ctx.fillStyle = frac < 0.25 ? '#ff6b4a' : color;
      ctx.fillRect(16, y, 140 * Math.max(0, frac), 8);
      ctx.fillStyle = 'rgba(205, 214, 244, 0.8)';
      ctx.fillText(label, 164, y + 8);
    };
    // Fuel is the run clock; hull is the other way to die (§7).
    bar(56, hud.fuel / hud.fuelMax, '#7fd4ff', `FUEL ${Math.round(hud.fuel)}/${hud.fuelMax}`);
    bar(72, hud.hull / hud.hullMax, '#9ee887', `HULL ${Math.round(hud.hull)}/${hud.hullMax}`);
    ctx.fillStyle = 'rgba(205, 214, 244, 0.8)';
    ctx.fillText(`${hud.credits} cr · CARGO ${hud.cargo}/${hud.cargoMax}`, 16, 100);

    // M5 §13: controlling faction + standing (faction-tinted name).
    let noticeY = 124;
    if (hud.faction !== undefined) {
      if (hud.faction === null) {
        ctx.fillStyle = 'rgba(170, 176, 192, 0.85)';
        ctx.fillText('UNALIGNED FRONTIER', 16, 122);
      } else {
        const f = hud.faction;
        ctx.fillStyle = f.tint;
        ctx.fillText(`${f.name}${f.contested ? ' · CONTESTED' : ''}`, 16, 122);
        ctx.fillStyle = f.standing > 0 ? '#9ee887' : f.standing < 0 ? '#ff6b4a' : 'rgba(205, 214, 244, 0.7)';
        ctx.fillText(`STANDING ${f.standing > 0 ? '+' : ''}${f.standing}`, 16, 138);
      }
      noticeY = 162;
    }
    if (hud.hazardLabel) {
      ctx.fillStyle = '#ff6b4a';
      ctx.fillText(`⚠ ${hud.hazardLabel}`, 16, noticeY);
      noticeY += 18;
    }
    if (hud.notice) {
      ctx.fillStyle = '#ffb35e';
      ctx.fillText(hud.notice, 16, noticeY);
    }

    if (hud.adrift) {
      ctx.textAlign = 'center';
      ctx.font = '16px monospace';
      ctx.fillStyle = '#ff6b4a';
      ctx.fillText('SHIP ADRIFT — FUEL EXHAUSTED, NO RESCUE IN SYSTEM', ctx.canvas.width / 2, 96);
      ctx.font = '13px monospace';
      ctx.fillText('[X] END RUN', ctx.canvas.width / 2, 118);
    }

    if (hud.prompt) {
      ctx.textAlign = 'center';
      ctx.font = '14px monospace';
      ctx.fillStyle = hud.prompt.tone === 'ok' ? '#7fd4ff' : '#ff6b4a';
      ctx.fillText(hud.prompt.text, ctx.canvas.width / 2, ctx.canvas.height - 40);
    }
    if (hud.subPrompt) {
      ctx.textAlign = 'center';
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
      ctx.fillText(hud.subPrompt, ctx.canvas.width / 2, ctx.canvas.height - 20);
    }
  }
}
