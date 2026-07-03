/**
 * planetTextures.ts — procedural Canvas2D textures for planet surfaces,
 * moons, and ring layouts. Split out of renderer.ts when texture work grew
 * beyond gas giants (M4 visual pass).
 *
 * All randomness here is RENDERER-SIDE: seeded via hash128(`${seed}/label`)
 * from the SystemSpec seed, never from generation streams — so nothing in
 * this file can affect world data or require a GEN_VERSION bump. Gas labels
 * (`gas:${id}:…`) and their rng draw order are frozen: changing either
 * silently rerolls every existing gas giant.
 */

import { Texture } from 'pixi.js';
import { Rng, hash128 } from '../rng';
import type { BodySpec, BodyType } from '../types';

export const GAS_TEXTURE_SIZE = 256;
/** Non-gas bodies are radius 9–23 wu; half the gas texture size suffices. */
export const PLANET_TEXTURE_SIZE = 128;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export function rgba(c: Rgb, alpha = 1): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/** Pack an Rgb into a 0xRRGGBB number for Pixi fills/strokes. */
export function rgbToNumber(c: Rgb): number {
  return (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b);
}

/** M6 §14 biome tint: a color nudged into a surface per pixel. Applied as a
 *  pure transform at the end of the color mix — no new rng draw, so existing
 *  systems keep their geometry and only their hue shifts. */
export interface SurfaceTint {
  color: Rgb;
  strength: number;
}

const GAS_PALETTES: ReadonlyArray<readonly string[]> = [
  ['#f4d3a2', '#d8955d', '#9a6048', '#fff0c4'],
  ['#d7c7a6', '#a9967c', '#726f88', '#ecdfc1'],
  ['#c6e3ef', '#7ea6c8', '#3f668e', '#f0fbff'],
  ['#d9c4ec', '#b48bc9', '#765d92', '#f4e6ff'],
  ['#dfc690', '#b77957', '#6e5143', '#f8e6b2'],
] as const;

/** Per-type surface palettes, anchored near the BODY_COLORS hues (view.ts)
 *  so the system map stays consistent with the rendered bodies. Convention
 *  (mirrors GAS_PALETTES): [0..1] base mottling, [2] accent/dark, [3] the
 *  brightest/hottest tone. */
const PLANET_PALETTES: Record<Exclude<BodyType, 'gas_giant'>, ReadonlyArray<readonly string[]>> = {
  rocky: [
    ['#a08a72', '#8a7460', '#6b584a', '#c4ad92'],
    ['#9c8468', '#7e6450', '#5c473c', '#bfa888'],
    ['#94837a', '#7a6a64', '#564a46', '#b8a79c'],
  ],
  ice: [
    ['#bcd8e8', '#a2c4dc', '#7ea4c4', '#eaf6fc'],
    ['#c4dce4', '#a8c8d4', '#84a8bc', '#f0fafc'],
    ['#b4d0ec', '#96b8dc', '#7494c0', '#e4f2ff'],
  ],
  lava: [
    ['#241210', '#3c1a14', '#d2543a', '#ffb24a'],
    ['#1e1012', '#38181c', '#c84830', '#ff9a3c'],
    ['#2a1410', '#46201a', '#dc6234', '#ffd27a'],
  ],
  ocean: [
    ['#1e4a86', '#3a78c2', '#d8c490', '#6a9a58'],
    ['#16406e', '#2e6cb4', '#ccc08a', '#5a8a54'],
    ['#24528e', '#4684ca', '#e0cc9a', '#7aa462'],
  ],
};

export function gasPalette(seed: string, body: BodySpec): readonly Rgb[] {
  const rng = new Rng(hash128(`${seed}/gas:${body.id}:palette`));
  return rng.pick(GAS_PALETTES).map(hexToRgb);
}

export function planetPalette(seed: string, body: BodySpec): readonly Rgb[] {
  if (body.type === 'gas_giant') return gasPalette(seed, body);
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:palette`));
  return rng.pick(PLANET_PALETTES[body.type]).map(hexToRgb);
}

export function gasBandTexture(seed: string, body: BodySpec): Texture {
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

export function gasCloudTexture(seed: string, body: BodySpec): Texture {
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

let sphereShade: Texture | null = null;

export function sphereShadeTexture(): Texture {
  if (sphereShade) return sphereShade;
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
  sphereShade = Texture.from(canvas);
  return sphereShade;
}

let moonShade: Texture | null = null;

/** Sphere shade pre-clipped to a circle: moons sit unmasked over the
 *  background, where the square shade's dark corners would show. */
export function moonShadeTexture(): Texture {
  if (moonShade) return moonShade;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.38, size * 0.34, size * 0.08, size / 2, size / 2, size * 0.56);
  g.addColorStop(0, 'rgba(255,255,255,0.24)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  g.addColorStop(0.82, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  moonShade = Texture.from(canvas);
  return moonShade;
}

let nightShade: Texture | null = null;

/** M6 §14 directional night-side shadow for terrestrial worlds — a disc-space
 *  overlay that darkens the lower-right toward black (matching the sphere
 *  shade's upper-left key light), deepening the terminator and giving city
 *  lights a dark canvas to read against. Normal-blend, over the surface. */
export function nightShadeTexture(): Texture {
  if (nightShade) return nightShade;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(size * 0.28, size * 0.28, size * 0.9, size * 0.9);
  g.addColorStop(0, 'rgba(2,4,12,0)');
  g.addColorStop(0.5, 'rgba(2,4,12,0.22)');
  g.addColorStop(1, 'rgba(2,4,12,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-in';
  const clip = ctx.createRadialGradient(size / 2, size / 2, size * 0.46, size / 2, size / 2, size * 0.5);
  clip.addColorStop(0, 'rgba(0,0,0,1)');
  clip.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = clip;
  ctx.fillRect(0, 0, size, size);
  nightShade = Texture.from(canvas);
  return nightShade;
}

/** Seamless-in-x pseudo-noise: a few sine octaves with INTEGER longitudinal
 *  frequencies, so the texture tiles horizontally without a seam. ~[0, 1]. */
interface NoiseOctave {
  fx: number;
  fy: number;
  phase: number;
  amp: number;
}

function makeOctaves(rng: Rng): NoiseOctave[] {
  return [
    { fx: rng.int(2, 5), fy: rng.range(1, 3), phase: rng.angle(), amp: 0.5 },
    { fx: rng.int(5, 11), fy: rng.range(3, 6), phase: rng.angle(), amp: 0.3 },
    { fx: rng.int(11, 21), fy: rng.range(6, 12), phase: rng.angle(), amp: 0.2 },
  ];
}

function octaveNoise(octs: NoiseOctave[], lon: number, lat: number): number {
  let n = 0;
  for (const o of octs) {
    n += o.amp * Math.sin((lon * o.fx + lat * o.fy) * Math.PI * 2 + o.phase);
  }
  return 0.5 + n * 0.5; // amps sum to 1 → [0, 1]
}

function planetCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = PLANET_TEXTURE_SIZE;
  canvas.height = PLANET_TEXTURE_SIZE / 2;
  return [canvas, canvas.getContext('2d')!];
}

/** Run a shape pass at x, x−w, x+w so strokes/fills wrap across the tiling
 *  seam (the pixel-loop bases are seamless by construction; shapes are not). */
function drawWrapped(ctx: CanvasRenderingContext2D, width: number, pass: () => void): void {
  for (const dx of [-width, 0, width]) {
    ctx.save();
    ctx.translate(dx, 0);
    pass();
    ctx.restore();
  }
}

export function rockyTexture(seed: string, body: BodySpec, tint?: SurfaceTint): Texture {
  const [canvas, ctx] = planetCanvas();
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:surface`));
  const palette = planetPalette(seed, body);
  const octs = makeOctaves(rng);

  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const lat = y / (canvas.height - 1);
    const polar = (Math.abs(lat - 0.5) * 2) ** 2 * 0.35;
    for (let x = 0; x < canvas.width; x++) {
      const n = octaveNoise(octs, x / canvas.width, lat);
      let c = mixColor(palette[0]!, palette[1]!, n);
      c = mixColor(c, palette[2]!, polar);
      if (tint) c = mixColor(c, tint.color, tint.strength);
      const i = (y * canvas.width + x) * 4;
      img.data[i] = c.r;
      img.data[i + 1] = c.g;
      img.data[i + 2] = c.b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const craters = rng.int(8, 15);
  for (let i = 0; i < craters; i++) {
    const x = rng.range(0, canvas.width);
    const y = rng.range(6, canvas.height - 6);
    const r = rng.range(1.5, 5);
    const depth = rng.range(0.25, 0.45);
    drawWrapped(ctx, canvas.width, () => {
      ctx.fillStyle = rgba(palette[2]!, depth);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // Rim catches the upper-left light.
      ctx.strokeStyle = rgba(palette[3]!, depth * 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x - r * 0.18, y - r * 0.18, r, Math.PI * 0.7, Math.PI * 1.7);
      ctx.stroke();
    });
  }

  return Texture.from(canvas);
}

export function iceTexture(seed: string, body: BodySpec, tint?: SurfaceTint): Texture {
  const [canvas, ctx] = planetCanvas();
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:surface`));
  const palette = planetPalette(seed, body);
  const octs = makeOctaves(rng);
  const white = { r: 255, g: 255, b: 255 };

  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const lat = y / (canvas.height - 1);
    const polar = (Math.abs(lat - 0.5) * 2) ** 2 * 0.5;
    for (let x = 0; x < canvas.width; x++) {
      const n = octaveNoise(octs, x / canvas.width, lat);
      let c = mixColor(palette[0]!, palette[1]!, n * 0.7);
      c = mixColor(c, white, polar);
      if (tint) c = mixColor(c, tint.color, tint.strength);
      const i = (y * canvas.width + x) * 4;
      img.data[i] = c.r;
      img.data[i + 1] = c.g;
      img.data[i + 2] = c.b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Fissures: jagged random-walk cracks, occasionally forked.
  const fissures = rng.int(6, 11);
  for (let i = 0; i < fissures; i++) {
    const segs = rng.int(4, 10);
    let x = rng.range(0, canvas.width);
    let y = rng.range(4, canvas.height - 4);
    const drift = rng.range(-0.6, 0.6);
    const pts: [number, number][] = [[x, y]];
    for (let s = 0; s < segs; s++) {
      x += rng.range(4, 12);
      y += rng.range(-4, 4) + drift * 2;
      pts.push([x, y]);
    }
    const alpha = rng.range(0.2, 0.45);
    const lineWidth = rng.range(0.8, 1.8);
    const fork = rng.chance(0.3);
    const forkAt = fork ? rng.int(1, pts.length - 1) : 0;
    const forkDx = rng.range(3, 9);
    const forkDy = rng.range(-6, 6);
    drawWrapped(ctx, canvas.width, () => {
      ctx.strokeStyle = `rgba(160, 200, 230, ${alpha})`;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      pts.forEach(([px, py], j) => (j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
      if (fork) {
        const [fx, fy] = pts[forkAt]!;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + forkDx, fy + forkDy);
        ctx.stroke();
      }
    });
  }

  return Texture.from(canvas);
}

/** Crust + glow built in ONE pass from ONE rng stream so the vein geometry
 *  matches between layers (glow pulses additively over the crust). */
export function lavaTextures(seed: string, body: BodySpec): { crust: Texture; glow: Texture } {
  const [crustCanvas, crust] = planetCanvas();
  const [glowCanvas, glow] = planetCanvas();
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:surface`));
  const palette = planetPalette(seed, body);
  const octs = makeOctaves(rng);

  const img = crust.createImageData(crustCanvas.width, crustCanvas.height);
  for (let y = 0; y < crustCanvas.height; y++) {
    const lat = y / (crustCanvas.height - 1);
    for (let x = 0; x < crustCanvas.width; x++) {
      const n = octaveNoise(octs, x / crustCanvas.width, lat);
      const c = mixColor(palette[0]!, palette[1]!, n);
      const i = (y * crustCanvas.width + x) * 4;
      img.data[i] = c.r;
      img.data[i + 1] = c.g;
      img.data[i + 2] = c.b;
      img.data[i + 3] = 255;
    }
  }
  crust.putImageData(img, 0, 0);

  const strokeVein = (ctx: CanvasRenderingContext2D, pts: [number, number][], width: number, style: string, blur: number) => {
    drawWrapped(ctx, crustCanvas.width, () => {
      ctx.save();
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      if (blur > 0) {
        ctx.shadowBlur = blur;
        ctx.shadowColor = rgba(palette[3]!, 0.9);
      }
      ctx.beginPath();
      pts.forEach(([px, py], j) => (j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
      ctx.restore();
    });
  };

  const veins = rng.int(5, 10);
  for (let i = 0; i < veins; i++) {
    const segs = rng.int(4, 9);
    let x = rng.range(0, crustCanvas.width);
    let y = rng.range(6, crustCanvas.height - 6);
    const pts: [number, number][] = [[x, y]];
    for (let s = 0; s < segs; s++) {
      x += rng.range(5, 14);
      y += rng.range(-5, 5);
      pts.push([x, y]);
    }
    const hot = rng.chance(0.5) ? palette[3]! : palette[2]!;
    const w = rng.range(1, 2);
    strokeVein(crust, pts, w, rgba(hot, 0.9), 0);
    strokeVein(glow, pts, w + rng.range(2, 4), rgba(hot, 0.55), 6);
    if (rng.chance(0.35)) {
      const at = pts[rng.int(1, pts.length - 1)]!;
      const branch: [number, number][] = [at, [at[0] + rng.range(4, 10), at[1] + rng.range(-7, 7)]];
      strokeVein(crust, branch, w * 0.8, rgba(hot, 0.8), 0);
      strokeVein(glow, branch, w * 0.8 + 2, rgba(hot, 0.5), 6);
    }
  }

  // Hot pools: small radial gradients on both layers.
  const pools = rng.int(2, 4);
  for (let i = 0; i < pools; i++) {
    const x = rng.range(0, crustCanvas.width);
    const y = rng.range(8, crustCanvas.height - 8);
    const r = rng.range(3, 7);
    drawWrapped(crust, crustCanvas.width, () => {
      const g = crust.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(palette[3]!, 0.85));
      g.addColorStop(0.6, rgba(palette[2]!, 0.5));
      g.addColorStop(1, rgba(palette[2]!, 0));
      crust.fillStyle = g;
      crust.fillRect(x - r, y - r, r * 2, r * 2);
    });
    drawWrapped(glow, glowCanvas.width, () => {
      const g = glow.createRadialGradient(x, y, 0, x, y, r * 1.4);
      g.addColorStop(0, rgba(palette[3]!, 0.7));
      g.addColorStop(1, rgba(palette[3]!, 0));
      glow.fillStyle = g;
      glow.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    });
  }

  return { crust: Texture.from(crustCanvas), glow: Texture.from(glowCanvas) };
}

export function oceanTexture(seed: string, body: BodySpec, tint?: SurfaceTint): Texture {
  const [canvas, ctx] = planetCanvas();
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:surface`));
  const palette = planetPalette(seed, body);
  const octs = makeOctaves(rng);
  const landThreshold = rng.range(0.62, 0.72);
  const shore = 0.04;

  const img = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const lat = y / (canvas.height - 1);
    for (let x = 0; x < canvas.width; x++) {
      const n = octaveNoise(octs, x / canvas.width, lat);
      let c: Rgb;
      if (n > landThreshold + shore) {
        // Land: sand → green with height.
        const h = Math.min(1, (n - landThreshold - shore) / (1 - landThreshold - shore));
        c = mixColor(palette[2]!, palette[3]!, h);
      } else if (n > landThreshold) {
        // Shoreline band: lightened sand.
        c = mixColor(palette[2]!, { r: 255, g: 255, b: 255 }, 0.3);
      } else {
        // Water: deep → shallow.
        c = mixColor(palette[0]!, palette[1]!, n / landThreshold);
      }
      if (tint) c = mixColor(c, tint.color, tint.strength);
      const i = (y * canvas.width + x) * 4;
      img.data[i] = c.r;
      img.data[i + 1] = c.g;
      img.data[i + 2] = c.b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  return Texture.from(canvas);
}

/** Drifting white cloud layer over the sea: same technique as the gas cloud
 *  texture but sparser and its own function — parameterizing the gas one
 *  would risk nudging its frozen rng stream. */
export function oceanCloudTexture(seed: string, body: BodySpec): Texture {
  const [canvas, ctx] = planetCanvas();
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:clouds`));

  for (let i = 0; i < 14; i++) {
    const y = rng.range(4, canvas.height - 4);
    const amp = rng.range(1.5, 5);
    const phase = rng.angle();
    const freq = rng.range(0.03, 0.07);
    ctx.beginPath();
    for (let x = -8; x <= canvas.width + 8; x += 6) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x === -8) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${rng.range(0.1, 0.25)})`;
    ctx.lineWidth = rng.range(1.5, 4.5);
    ctx.stroke();
  }

  return Texture.from(canvas);
}

/**
 * M6 §14 night-side city lights for an inhabited world. Unlike the surface
 * textures (lon/lat, tiled onto the disc), this is DISC-SPACE — clustered
 * settlement lights baked with the same upper-left lighting the sphere shade
 * uses, so the glow only shows on the night side (lower-right) and dies at the
 * lit limb. Drawn as an additive Sprite over the shade. `density` 0..1 scales
 * the light count (habitation tier); `colorHex` is the biome's light hue.
 */
export function cityLightsTexture(seed: string, body: BodySpec, density: number, colorHex: string): Texture {
  const size = PLANET_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(hash128(`${seed}/planet:${body.id}:citylights`));
  const color = hexToRgb(colorHex);

  // Lights cluster into a handful of settlements rather than scattering evenly.
  const clusters = rng.int(3, 6);
  const centers: [number, number][] = [];
  for (let i = 0; i < clusters; i++) {
    const a = rng.angle();
    const r = rng.range(0, size * 0.4);
    centers.push([size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r]);
  }
  // Bodies render at ~15–23 wu radius, so this 128px texture is downscaled ~4×;
  // dots must be a few px here to survive as a visible point on the disc.
  const total = Math.round(density * 55);
  for (let i = 0; i < total; i++) {
    const [cx, cy] = centers[rng.int(0, centers.length - 1)]!;
    const x = cx + rng.range(-size * 0.1, size * 0.1);
    const y = cy + rng.range(-size * 0.1, size * 0.1);
    const r = rng.range(1.6, 3.4);
    ctx.fillStyle = rgba(color, rng.range(0.6, 1));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fade to the lit side: keep lights toward lower-right (matches the shade's
  // upper-left key light), so the day side reads dark/empty.
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(size * 0.2, size * 0.2, size * 0.85, size * 0.85);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);

  // Clip to the disc.
  const clip = ctx.createRadialGradient(size / 2, size / 2, size * 0.46, size / 2, size / 2, size * 0.5);
  clip.addColorStop(0, 'rgba(0,0,0,1)');
  clip.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = clip;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

/** A soft atmospheric limb glow — a transparent-cored ring that peeks past the
 *  planet disc. Sized to ~1.6× the diameter when placed; sits BEHIND the disc
 *  so only the limb shows. `colorHex` is the sky tint. */
export function atmosphereTexture(colorHex: string): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const color = hexToRgb(colorHex);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.62, rgba(color, 0));
  g.addColorStop(0.72, rgba(color, 0.5));
  g.addColorStop(0.82, rgba(color, 0.16));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

/** One concentric ringlet of a body's ring system, in body-local units. */
export interface RingletSpec {
  rx: number;
  ry: number;
  width: number;
  color: number;
  alpha: number;
}

const RING_DUST = hexToRgb('#dcd2b4');

/** Ringlet layout: 3–6 concentric ringlets walking outward from ~1.4× body
 *  radius, with occasional wide Cassini-style gaps. Colors blend ring dust
 *  toward the body's palette so the system harmonizes. */
export function makeRingletSpecs(seed: string, body: BodySpec, palette: readonly Rgb[]): RingletSpec[] {
  const rng = new Rng(hash128(`${seed}/rings:${body.id}`));
  const squash = rng.range(0.28, 0.36);
  const outer = body.radius * 2.2;
  const count = rng.int(3, 7);
  const specs: RingletSpec[] = [];
  let r = body.radius * rng.range(1.3, 1.5);
  for (let i = 0; i < count && r < outer; i++) {
    const width = rng.range(1.5, 5);
    const mid = r + width / 2;
    specs.push({
      rx: mid,
      ry: mid * squash,
      width,
      color: rgbToNumber(mixColor(RING_DUST, rng.pick(palette), rng.range(0.25, 0.55))),
      alpha: rng.range(0.2, 0.55),
    });
    r += width + (rng.chance(0.35) ? rng.range(6, 10) : rng.range(1, 6));
  }
  return specs;
}
