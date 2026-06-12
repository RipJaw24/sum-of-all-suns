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

import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { Rng, hash128 } from '../rng';
import type { BodySpec, GateSpec, StarSpec, SystemSpec } from '../types';
import { NebulaLayer } from './nebula';
import type { Derelict } from './salvage';
import type { ShipState } from './ship';
import { BODY_COLORS, GATE_COLORS, bodyPosition, gatePosition, type HudState } from './view';

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

interface StarNode {
  root: Container;
  baseRadius: number;
}

interface BodyNode {
  root: Container;
  body: BodySpec;
  moons: Graphics[];
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
      this.starfield,
      this.orbits,
      this.starLayer,
      this.bodyLayer,
      this.derelictLayer,
      this.gateLayer,
      this.ship,
    );
    this.nebulaLayer.addChild(this.nebula.mesh);
    app.stage.addChild(this.nebulaLayer, this.world);

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
    this.nebula.frame(ship.x, ship.y, width, height);

    // Pulsar strobe (§3.1 rare stars).
    if (this.starClass === 'pulsar') {
      const s = 1 + 0.15 * Math.sin(t * 12);
      for (const node of this.starNodes) node.root.scale.set(s);
    }
    for (const node of this.bodyNodes) {
      const pos = bodyPosition(node.body, t);
      node.root.position.set(pos.x, pos.y);
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
    for (let i = 0; i < 500; i++) {
      const x = rng.range(-extent, extent);
      const y = rng.range(-extent, extent);
      const r = rng.range(0.4, 1.6);
      const alpha = rng.range(0.25, 0.9);
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
      const core = new Graphics().circle(0, 0, body.radius).fill(BODY_COLORS[body.type]);
      root.addChild(core);

      if (body.hasRings) {
        const rings = new Graphics()
          .ellipse(0, 0, body.radius * 1.9, body.radius * 0.6)
          .stroke({ width: 2, color: 0xdcd2b4, alpha: 0.5 });
        rings.rotation = 0.4;
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
      this.bodyNodes.push({ root, body, moons });
    }
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
    ctx.fillText(`${spec.kind} system · jumps ${hud.jumps} · [TAB] chart`, 16, 46);

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
