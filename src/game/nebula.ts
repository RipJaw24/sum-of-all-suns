/**
 * nebula.ts — the procedural nebula background (SPEC §3.4): GLSL simplex
 * fbm, domain-warped, color-graded by the category-derived palette. Static
 * per system (no time uniform) — deterministic, free, and shared: the same
 * article shows every player the same clouds.
 *
 * Pure parameter derivation (nebulaUniformsFor) is separate from the GL
 * mesh (NebulaLayer) so tests never need a context. The mesh fills the
 * screen in screen space; a fractional uCamera offset adds parallax so the
 * clouds read as a distant backdrop.
 */

import { Geometry, Mesh, Shader } from 'pixi.js';
import { Rng, hash128 } from '../rng';
import type { SystemSpec } from '../types';
import { PALETTES, hexToRgb01 } from './palettes';

// --- pure derivation (unit-tested, GL-free) -----------------------------------

export interface NebulaParams {
  offset1: readonly [number, number];
  offset2: readonly [number, number];
  /** Noise frequency multiplier. */
  scale: number;
  /** Domain-warp amplitude. */
  warp: number;
}

/** Cloud-shape parameters for a system. Pure: seed in, params out. */
export function nebulaUniformsFor(nebulaSeed: string): NebulaParams {
  const rng = new Rng(hash128(`nebula:${nebulaSeed}`));
  return {
    offset1: [rng.range(-100, 100), rng.range(-100, 100)],
    offset2: [rng.range(-100, 100), rng.range(-100, 100)],
    scale: rng.range(0.8, 1.6),
    warp: rng.range(0.5, 1.2),
  };
}

/** How loud the clouds are per system kind: anomalies read as dead space. */
export function nebulaIntensityFor(kind: SystemSpec['kind']): number {
  switch (kind) {
    case 'shattered':
      return 0.55;
    case 'sparse':
      return 0.4;
    case 'salvage_field':
    case 'hazard_pocket':
    case 'deep_tunnel':
      return 0.7;
    default:
      return 1;
  }
}

// --- GL layer -------------------------------------------------------------------

const VERTEX = /* glsl */ `
  in vec2 aPosition;
  out vec2 vUv;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUv = aPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  in vec2 vUv;

  uniform vec2 uOffset1;
  uniform vec2 uOffset2;
  uniform float uScale;
  uniform float uWarp;
  uniform float uIntensity;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uColC;
  uniform vec2 uCamera;
  uniform vec2 uResolution;

  // Ashima-style 2D simplex noise (public domain).
  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * snoise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Screen px -> noise space; /900 keeps cloud size window-independent.
    vec2 p = (vUv * uResolution + uCamera) / 900.0 * uScale;
    vec2 w = vec2(fbm(p + uOffset1), fbm(p + uOffset2));
    vec2 q = p + uWarp * w;
    float n1 = fbm(q + uOffset1) * 0.5 + 0.5;
    float n2 = fbm(q * 1.7 + uOffset2) * 0.5 + 0.5;
    float n3 = fbm(q * 2.3 - uOffset1) * 0.5 + 0.5;

    vec3 bg = vec3(0.016, 0.020, 0.039); // #04050a, the world clear color
    // Keep it a BACKDROP: sparse band coverage, gentle mix — the starfield
    // and bodies must stay the brightest things on screen.
    float band = smoothstep(0.55, 0.95, n1);
    vec3 cloud = mix(uColA, uColB, clamp(n2, 0.0, 1.0));
    vec3 col = mix(bg, cloud, band * 0.45 * uIntensity);
    col += uColC * pow(clamp(n3, 0.0, 1.0), 4.0) * 0.12 * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class NebulaLayer {
  readonly mesh: Mesh<Geometry, Shader>;

  constructor() {
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        nebulaUniforms: {
          uOffset1: { value: [0, 0], type: 'vec2<f32>' },
          uOffset2: { value: [0, 0], type: 'vec2<f32>' },
          uScale: { value: 1, type: 'f32' },
          uWarp: { value: 1, type: 'f32' },
          uIntensity: { value: 1, type: 'f32' },
          uColA: { value: [0, 0, 0], type: 'vec3<f32>' },
          uColB: { value: [0, 0, 0], type: 'vec3<f32>' },
          uColC: { value: [0, 0, 0], type: 'vec3<f32>' },
          uCamera: { value: [0, 0], type: 'vec2<f32>' },
          uResolution: { value: [1, 1], type: 'vec2<f32>' },
        },
      },
    });
    this.mesh = new Mesh({ geometry, shader });
  }

  private get uniforms(): Record<string, unknown> {
    return (this.mesh.shader!.resources.nebulaUniforms as { uniforms: Record<string, unknown> })
      .uniforms;
  }

  setSystem(spec: SystemSpec): void {
    const params = nebulaUniformsFor(spec.ambient.nebulaSeed);
    const palette = PALETTES[spec.ambient.paletteId % PALETTES.length]!;
    const u = this.uniforms;
    u.uOffset1 = [...params.offset1];
    u.uOffset2 = [...params.offset2];
    u.uScale = params.scale;
    u.uWarp = params.warp;
    u.uIntensity = nebulaIntensityFor(spec.kind);
    u.uColA = hexToRgb01(palette.nebulaA);
    u.uColB = hexToRgb01(palette.nebulaB);
    u.uColC = hexToRgb01(palette.nebulaC);
  }

  /** Per-frame: fill the screen, drift at 0.15× camera for parallax. */
  frame(shipX: number, shipY: number, width: number, height: number): void {
    this.mesh.scale.set(width, height);
    const u = this.uniforms;
    u.uCamera = [shipX * 0.15, shipY * 0.15];
    u.uResolution = [width, height];
  }
}
