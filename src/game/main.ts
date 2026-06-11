/**
 * main.ts — M1 boot: graph walk. Jump through gates end-to-end with the
 * snapshot cache, fuel cost per jump (§7), §4.2 return gates, and the
 * Tab/M system chart. Docking, hull, credits, and death are M2.
 *
 * Dev URL params: ?debug (true titles in console + window.__sas hook),
 * ?start=Article_Title (fresh run from that article, skips saved run).
 */

import { generateSystem } from '../gen/generate';
import type { GateSpec, SystemSpec } from '../types';
import {
  ArticleCache,
  IdbArticleStore,
  MemoryArticleStore,
  type ArticleSource,
} from '../wiki/cache';
import { Input } from './input';
import { drawMap } from './map';
import { Renderer, gatePosition, type HudState } from './renderer';
import {
  applyJump,
  canJump,
  gatesFor,
  jumpCost,
  loadRun,
  newRun,
  saveRun,
} from './run';
import { makeShip, updateShip } from './ship';

const DEFAULT_START = 'Photosynthesis';
const INTERACT_RANGE = 70; // wu
const FADE_SEC = 0.4;

const params = new URLSearchParams(location.search);
/** Dev-only secret-reveal flag (SPEC §3.3): ?debug shows true titles. */
const DEBUG = params.has('debug');

/** Jump fade: out -> (hold while destination resolves) -> in. */
interface Transition {
  phase: 'out' | 'hold' | 'in';
  alpha: number;
}

function fitCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  fitCanvas(canvas);
  window.addEventListener('resize', () => fitCanvas(canvas));
  const ctx = canvas.getContext('2d')!;

  const cache = new ArticleCache(
    typeof indexedDB !== 'undefined' ? new IdbArticleStore() : new MemoryArticleStore(),
  );

  // ?start forces a fresh run; otherwise resume the saved one.
  const startOverride = params.get('start');
  const run = (startOverride ? null : loadRun()) ?? newRun(startOverride ?? DEFAULT_START);

  const ship = makeShip();
  const renderer = new Renderer(ctx);
  const input = new Input();
  input.attach(canvas);

  let spec!: SystemSpec;
  let gates: GateSpec[] = [];
  let lastSource: ArticleSource = 'cache';
  let mapOpen = false;
  let transition: Transition | null = null;

  // Read-only state hook for dev tooling (autopilot / screenshot scripts).
  const debugState: Record<string, unknown> = {};
  if (DEBUG) (window as any).__sas = debugState;

  async function enterSystem(): Promise<void> {
    const { meta, source } = await cache.get(run.currentTitle);
    lastSource = source;
    spec = generateSystem(meta);
    gates = gatesFor(spec, run.previousTitle);

    // Spawn at the gate that leads back where we came from (it always
    // exists after a jump, §4.2); fresh runs start in open space.
    const back = run.previousTitle
      ? gates.find((g) => g.destinationTitle === run.previousTitle)
      : undefined;
    if (back) {
      const pos = gatePosition(back);
      const inward = Math.atan2(-pos.y, -pos.x);
      ship.x = pos.x + Math.cos(inward) * 90;
      ship.y = pos.y + Math.sin(inward) * 90;
      ship.vx = Math.cos(inward) * 50;
      ship.vy = Math.sin(inward) * 50;
      ship.heading = inward;
    } else {
      ship.x = 0;
      ship.y = (gates[0]?.rimRadius ?? 500) * 0.6;
      ship.vx = 0;
      ship.vy = 0;
    }

    renderer.setSystem(spec);
    // §8: warm the cache for every reachable system so jumps never stall.
    cache.prefetch(gates.map((g) => g.destinationTitle));

    if (DEBUG) {
      console.log(`[debug] system "${spec.name}" is "${spec.sourceTitle}" (${source})`);
      console.table(gates.map((g) => ({ gate: g.id, kind: g.kind, article: g.destinationTitle })));
    }
    Object.assign(debugState, { spec, gates, ship, run, source });
  }

  await enterSystem();

  let last = performance.now();
  const t0 = last;

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05); // clamp: tab-switch spikes
    last = now;
    const t = (now - t0) / 1000;

    const jumping = transition !== null;

    if (!jumping) {
      // Mouse -> world -> target heading (camera is ship-centered).
      const worldMouseX = ship.x + (input.mouseX - canvas.width / 2);
      const worldMouseY = ship.y + (input.mouseY - canvas.height / 2);
      updateShip(
        ship,
        {
          targetHeading: Math.atan2(worldMouseY - ship.y, worldMouseX - ship.x),
          thrust: input.isHeld('KeyW', 'ArrowUp'),
          retro: input.isHeld('KeyS', 'ArrowDown'),
          strafeLeft: input.isHeld('KeyA', 'ArrowLeft'),
          strafeRight: input.isHeld('KeyD', 'ArrowRight'),
        },
        dt,
      );
    }

    if (input.wasPressed('Tab', 'KeyM')) mapOpen = !mapOpen;

    // Nearest gate in interact range drives the prompt.
    let promptGate: GateSpec | null = null;
    let best = INTERACT_RANGE;
    for (const gate of gates) {
      const pos = gatePosition(gate);
      const d = Math.hypot(pos.x - ship.x, pos.y - ship.y);
      if (d < best) {
        best = d;
        promptGate = gate;
      }
    }

    if (!jumping && promptGate && input.wasPressed('KeyE', 'Space') && canJump(run, promptGate)) {
      applyJump(run, promptGate);
      saveRun(run);
      if (DEBUG) {
        console.log(
          `[jump] ${promptGate.id} (${promptGate.kind}) -> "${promptGate.destinationTitle}"` +
            ` cost ${jumpCost(promptGate)}, fuel ${run.fuel}`,
        );
      }
      transition = { phase: 'out', alpha: 0 };
    }

    // Advance the jump fade; the system swap happens behind full black.
    if (transition) {
      if (transition.phase === 'out') {
        transition.alpha = Math.min(1, transition.alpha + dt / FADE_SEC);
        if (transition.alpha >= 1) {
          transition.phase = 'hold';
          void enterSystem().then(() => {
            if (transition) transition.phase = 'in';
          });
        }
      } else if (transition.phase === 'in') {
        transition.alpha -= dt / FADE_SEC;
        if (transition.alpha <= 0) transition = null;
      }
    }

    const hud: HudState = {
      fuel: run.fuel,
      fuelMax: run.fuelMax,
      jumps: run.route.length - 1,
      promptGate: jumping ? null : promptGate,
      promptCost: promptGate ? jumpCost(promptGate) : 0,
      canAfford: promptGate ? canJump(run, promptGate) : false,
      ...(lastSource === 'degraded'
        ? { notice: 'SENSOR INTERFERENCE — telemetry degraded' }
        : {}),
    };

    if (DEBUG) debugState['jumping'] = transition !== null;

    renderer.draw(spec, gates, ship, t, hud);
    if (mapOpen && !jumping) drawMap(ctx, spec, gates, ship, run, t);

    if (transition) {
      ctx.fillStyle = `rgba(4, 5, 10, ${Math.min(1, Math.max(0, transition.alpha))})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(127, 212, 255, ${Math.min(1, transition.alpha) * 0.8})`;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('JUMPING…', canvas.width / 2, canvas.height / 2);
    }

    input.endFrame();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

void boot();
