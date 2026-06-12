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
import type { Derelict } from './salvage';
import type { ShipState } from './ship';
import { BODY_COLORS, GATE_COLORS, bodyPosition, gatePosition, type HudState } from './view';

const LABEL_STYLE = { fontFamily: 'monospace', fontSize: 11, fill: 0xcdd6f4 } as const;
const GAS_TEXTURE_SIZE = 256;
const GAS_PALETTES: ReadonlyArray<readonly string[]> = [
  ['#f4d3a2', '#d8955d', '#9a6048', '#fff0c4'],
  ['#d7c7a6', '#a9967c', '#726f88', '#ecdfc1'],
  ['#c6e3ef', '#7ea6c8', '#3f668e', '#f0fbff'],
  ['#d9c4ec', '#b48bc9', '#765d92', '#f4e6ff'],
  ['#dfc690', '#b77957', '#6e5143', '#f8e6b2'],
] as const;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function rgba(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

function gasPalette(seed: string, body: BodySpec): readonly Rgb[] {
  const rng = new Rng(hash128(`${seed}/gas:${body.id}:palette`));
  return rng.pick(GAS_PALETTES).map(hexToRgb);
}

function gasBandTexture(seed: string, body: BodySpec): Texture {
  const size = GAS_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(hash128(`${seed}/gas:${body.id}:bands`));
  const palette = gasPalette(seed, body);
  const img = ctx.createImageData(canvas.width, canvas.height);
  const waves = [
    { amp: rng.range(0.04, 0.1), freq: rng.int(2, 5), phase: rng.angle() },
    { amp: rng.range(0.015, 0.05), freq: rng.int(5, 10), phase: rng.angle() },
  ];

  for (let y = 0; y < canvas.height; y++) {
    const lat = y / (canvas.height - 1);
    const belt = Math.floor((lat + 0.03 * Math.sin(lat * Math.PI * 11 + rng.float())) * 11);
    const a = palette[Math.abs(belt) % palette.length]!;
    const b = palette[(Math.abs(belt) + 1) % palette.length]!;
    for (let x = 0; x < canvas.width; x++) {
      const lon = x / canvas.width;
      const ripple =
        waves[0]!.amp * Math.sin((lon * waves[0]!.freq + lat * 1.6) * Math.PI * 2 + waves[0]!.phase) +
        waves[1]!.amp * Math.sin((lon * waves[1]!.freq - lat * 3.2) * Math.PI * 2 + waves[1]!.phase);
      const thin = Math.abs(Math.sin((lat + ripple) * Math.PI * 23));
      const tint = Math.min(1, Math.max(0, 0.35 + thin * 0.4 + ripple * 1.5));
      const c = mixColor(a, b, tint);
      const i = (y * canvas.width + x) * 4;
      img.data[i] = c.r;
      img.data[i + 1] = c.g;
      img.data[i + 2] = c.b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  for (let i = 0; i < 10; i++) {
    const y = rng.range(8, canvas.height - 8);
    const h = rng.range(1, 3);
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.11)' : 'rgba(45,30,45,0.13)';
    ctx.fillRect(0, y, canvas.width, h);
  }

  if (rng.chance(0.55)) {
    const storm = palette[palette.length - 1]!;
    const x = rng.range(canvas.width * 0.25, canvas.width * 0.75);
    const y = rng.range(canvas.height * 0.28, canvas.height * 0.7);
    const rx = rng.range(14, 26);
    const ry = rng.range(5, 10);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.range(-0.15, 0.15));
    ctx.fillStyle = rgba(storm, 0.32);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  return Texture.from(canvas);
}

function gasCloudTexture(seed: string, body: BodySpec): Texture {
  const size = GAS_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(hash128(`${seed}/gas:${body.id}:clouds`));

  for (let i = 0; i < 28; i++) {
    const y = rng.range(8, canvas.height - 8);
    const amp = rng.range(2, 8);
    const phase = rng.angle();
    const freq = rng.range(0.015, 0.035);
    ctx.beginPath();
    for (let x = -8; x <= canvas.width + 8; x += 8) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x === -8) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${rng.range(0.08, 0.22)})`;
    ctx.lineWidth = rng.range(1.2, 3.8);
    ctx.stroke();
  }

  return Texture.from(canvas);
}

let gasShadeTexture: Texture | null = null;

function sphereShadeTexture(): Texture {
  if (gasShadeTexture) return gasShadeTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  let g = ctx.createRadialGradient(size * 0.38, size * 0.34, size * 0.08, size / 2, size / 2, size * 0.56);
  g.addColorStop(0, 'rgba(255,255,255,0.24)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  g.addColorStop(0.82, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.24)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  gasShadeTexture = Texture.from(canvas);
  return gasShadeTexture;
}

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

/** Starfield camera factor: between nebula (0.15×) and playfield (1×). */
const STARFIELD_PARALLAX = 0.3;

interface StarNode {
  root: Container;
  baseRadius: number;
}

interface BodyNode {
  root: Container;
  body: BodySpec;
  moons: Graphics[];
  gas?: GasGiantNode;
}

interface GasGiantNode {
  root: Container;
  bands: TilingSprite;
  clouds: TilingSprite;
  bandSpeed: number;
  cloudSpeed: number;
  /** Axis tilt in radians; rings share it so they sit on the equator. */
  tilt: number;
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
  private readonly ship = new Graphics();

  private starNodes: StarNode[] = [];
  private starClass: StarSpec['class'] | null = null;
  private bodyNodes: BodyNode[] = [];
  private gateNodes: GateNode[] = [];
  private derelictIds = '';

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
      this.ship,
    );
    this.nebulaLayer.addChild(this.nebula.mesh);
    app.stage.addChild(this.nebulaLayer, this.starfield, this.world);

    this.ship
      .poly([12, 0, -8, 7, -4, 0, -8, -7])
      .fill(0xe8edf7);
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
  }

  /** `gates` is the active list (spec gates + any §4.2 injected return gate);
   *  `derelicts` is the unlooted remainder (salvage.ts, filtered by main.ts). */
  draw(
    spec: SystemSpec,
    gates: readonly GateSpec[],
    ship: ShipState,
    t: number,
    hud: HudState,
    derelicts: readonly Derelict[] = [],
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
      if (node.gas) {
        node.gas.bands.tilePosition.x = t * node.gas.bandSpeed;
        node.gas.clouds.tilePosition.x = t * node.gas.cloudSpeed;
      }
      node.body.moons.forEach((moon, i) => {
        const ma = moon.initialAngle + ((Math.PI * 2) / moon.orbitPeriodSec) * t;
        node.moons[i]!.position.set(Math.cos(ma) * moon.orbitRadius, Math.sin(ma) * moon.orbitRadius);
      });
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
      const gas = body.type === 'gas_giant' ? this.makeGasGiant(body, spec.seed) : undefined;
      if (gas) {
        root.addChild(gas.root);
      } else {
        const core = new Graphics().circle(0, 0, body.radius).fill(BODY_COLORS[body.type]);
        root.addChild(core);
      }

      if (body.hasRings) {
        const rings = new Graphics()
          .ellipse(0, 0, body.radius * 1.9, body.radius * 0.6)
          .stroke({ width: 2, color: 0xdcd2b4, alpha: 0.5 });
        rings.rotation = gas ? gas.tilt : 0.4;
        root.addChild(rings);
      }

      const moons: Graphics[] = body.moons.map((moon) => {
        const m = new Graphics().circle(0, 0, moon.radius).fill(0x9aa0ae);
        root.addChild(m);
        return m;
      });

      if (body.station) {
        const tick = new Graphics()
          .rect(body.radius + 6, -4, 8, 8)
          .stroke({ width: 1, color: 0x7fd4ff });
        root.addChild(tick);
      }

      const label = new Text({ text: body.name, style: LABEL_STYLE });
      label.alpha = 0.75;
      label.anchor.set(0.5, 0);
      label.position.set(0, body.radius + 6);
      root.addChild(label);

      this.bodyLayer.addChild(root);
      this.bodyNodes.push({ root, body, moons, ...(gas ? { gas } : {}) });
    }
  }

  private makeGasGiant(body: BodySpec, seed: string): GasGiantNode {
    const diameter = body.radius * 2;
    const rng = new Rng(hash128(`${seed}/gas:${body.id}:motion`));
    const tilt = rng.range(-0.5, 0.5);
    const root = new Container();
    const tileScale = {
      x: (body.radius * 4) / GAS_TEXTURE_SIZE,
      y: diameter / (GAS_TEXTURE_SIZE / 2),
    };
    // +4px bleed: the rotated square only just covers the inscribed circle,
    // and AA at the tangent points can show seams without it.
    const bands = new TilingSprite({
      texture: gasBandTexture(seed, body),
      width: diameter + 4,
      height: diameter + 4,
      anchor: 0.5,
      applyAnchorToTexture: true,
      tileScale,
    });
    const clouds = new TilingSprite({
      texture: gasCloudTexture(seed, body),
      width: diameter + 4,
      height: diameter + 4,
      anchor: 0.5,
      applyAnchorToTexture: true,
      tileScale,
    });
    clouds.alpha = 0.62;
    const spin = new Container();
    spin.rotation = tilt;
    spin.addChild(bands, clouds);

    const shade = new Sprite(sphereShadeTexture());
    shade.anchor.set(0.5);
    shade.width = diameter;
    shade.height = diameter;

    const rim = new Graphics()
      .circle(0, 0, body.radius)
      .stroke({ width: 1.5, color: 0xf4e8cf, alpha: 0.32 });
    const mask = new Graphics().circle(0, 0, body.radius).fill(0xffffff);
    root.mask = mask;
    root.addChild(spin, shade, rim, mask);

    return {
      root,
      bands,
      clouds,
      bandSpeed: rng.range(3, 8) * (rng.chance(0.5) ? 1 : -1),
      cloudSpeed: rng.range(9, 18) * (rng.chance(0.5) ? 1 : -1),
      tilt,
    };
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

    let noticeY = 120;
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
