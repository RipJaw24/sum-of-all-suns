/**
 * main.ts — M2 boot: the roguelike skeleton. Three top-level modes:
 *
 *   flying  — M1 flight/jumping, plus hazard damage, body interactions
 *             (dock, mine, skim, salvage) and the adrift check (§7)
 *   docked  — station overlay: refuel/repair for credits (dock.ts)
 *   summary — death screen + Decrypt Flight Log (summary.ts)
 *
 * Dev URL params: ?debug (true titles in console + window.__sas hook),
 * ?start=Article_Title (fresh run from that article, skips saved run).
 */

import { generateSystem } from '../gen/generate';
import type { BodySpec, GateSpec, SystemSpec } from '../types';
import {
  ArticleCache,
  IdbArticleStore,
  MemoryArticleStore,
  type ArticleSource,
} from '../wiki/cache';
import { buyRefuel, buyRepair, drawDock } from './dock';
import {
  HAZARD_POCKET_ENTRY_DAMAGE,
  SKIM_FUEL_PER_SEC,
  SKIM_HULL_DPS,
  miningYield,
} from './economy';
import { hazardAt } from './hazards';
import { Input } from './input';
import { drawMap } from './map';
import { Renderer, bodyPosition, gatePosition, type HudPrompt, type HudState } from './renderer';
import {
  addCredits,
  addFuel,
  applyJump,
  canJump,
  clearRun,
  damageHull,
  declareAdrift,
  gatesFor,
  isLooted,
  isStranded,
  jumpCost,
  loadRun,
  markLooted,
  newRun,
  saveRun,
  type RunState,
} from './run';
import { derelictsFor, type Derelict } from './salvage';
import { makeShip, updateShip } from './ship';
import { pickStart } from './startPool';
import {
  drawSummary,
  newSummaryState,
  routeText,
  type SummaryState,
} from './summary';

const INTERACT_RANGE = 70; // wu, gates and derelicts
const BODY_RANGE_PAD = 60; // wu beyond a body's radius
const FADE_SEC = 0.4;
const DEATH_BEAT_SEC = 1.0;
const EVENT_TOAST_SEC = 3;
const SAVE_INTERVAL_SEC = 2; // for continuous drains (skim, hazards)

const params = new URLSearchParams(location.search);
/** Dev-only secret-reveal flag (SPEC §3.3): ?debug shows true titles. */
const DEBUG = params.has('debug');

/** Jump fade: out -> (hold while destination resolves) -> in. */
interface Transition {
  phase: 'out' | 'hold' | 'in';
  alpha: number;
}

type Mode = 'flying' | 'docked' | 'summary';

type Interactable =
  | { kind: 'gate'; gate: GateSpec }
  | { kind: 'dock'; body: BodySpec }
  | { kind: 'mine'; body: BodySpec }
  | { kind: 'skim'; body: BodySpec }
  | { kind: 'salvage'; derelict: Derelict };

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

  // ?start forces a fresh run; otherwise resume the saved one (including a
  // saved death — reloading at the summary screen returns to it).
  const startOverride = params.get('start');
  let run: RunState =
    (startOverride ? null : loadRun()) ?? newRun(startOverride ?? pickStart());

  const ship = makeShip();
  const renderer = new Renderer(ctx);
  const input = new Input();
  input.attach(canvas);

  let spec!: SystemSpec;
  let gates: GateSpec[] = [];
  let derelicts: Derelict[] = [];
  let lastSource: ArticleSource = 'cache';
  let mapOpen = false;
  let transition: Transition | null = null;
  let mode: Mode = run.status === 'dead' ? 'summary' : 'flying';
  let dockedBody: BodySpec | null = null;
  let summary: SummaryState = newSummaryState();
  let dyingUntil: number | null = null;
  let damageFlash = 0;
  let eventMsg = '';
  let eventUntil = 0;
  let saveDirtyAt = 0; // 0 = clean; else animation-clock time of first unsaved drain

  // Read-only state hook for dev tooling (autopilot / screenshot scripts).
  const debugState: Record<string, unknown> = {};
  if (DEBUG) (window as any).__sas = debugState;

  function toast(msg: string, t: number): void {
    eventMsg = msg;
    eventUntil = t + EVENT_TOAST_SEC;
  }

  function unlootedDerelicts(): Derelict[] {
    return derelictsFor(spec).filter((d) => !isLooted(run, spec.sourceTitle, d.id));
  }

  async function enterSystem(t: number): Promise<void> {
    const { meta, source } = await cache.get(run.currentTitle);
    lastSource = source;
    spec = generateSystem(meta);
    gates = gatesFor(spec, run.previousTitle);
    derelicts = unlootedDerelicts();

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

    // §4.5 hazard pocket: one-time hull hit on first-ever entry.
    if (spec.kind === 'hazard_pocket' && !isLooted(run, spec.sourceTitle, 'entry-hazard')) {
      markLooted(run, spec.sourceTitle, 'entry-hazard');
      const died = damageHull(run, HAZARD_POCKET_ENTRY_DAMAGE);
      damageFlash = 1;
      toast(`HULL -${HAZARD_POCKET_ENTRY_DAMAGE} — HAZARD ON ENTRY`, t);
      saveRun(run);
      if (died) dyingUntil = t + DEATH_BEAT_SEC;
    }

    if (DEBUG) {
      console.log(`[debug] system "${spec.name}" is "${spec.sourceTitle}" (${source})`);
      console.table(gates.map((g) => ({ gate: g.id, kind: g.kind, article: g.destinationTitle })));
    }
    Object.assign(debugState, { spec, gates, ship, run, source });
  }

  function startNewRun(t: number): void {
    clearRun();
    run = newRun(pickStart());
    saveRun(run);
    summary = newSummaryState();
    dyingUntil = null;
    damageFlash = 0;
    mode = 'flying';
    void enterSystem(t);
  }

  /** Nearest thing in interact range, if any. */
  function findInteractable(t: number): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    const consider = (d: number, range: number, make: () => Interactable) => {
      if (d < range && d < bestD) {
        bestD = d;
        best = make();
      }
    };
    for (const gate of gates) {
      const pos = gatePosition(gate);
      const d = Math.hypot(pos.x - ship.x, pos.y - ship.y);
      consider(d, INTERACT_RANGE, () => ({ kind: 'gate', gate }));
    }
    for (const body of spec.bodies) {
      const pos = bodyPosition(body, t);
      const d = Math.hypot(pos.x - ship.x, pos.y - ship.y);
      const range = body.radius + BODY_RANGE_PAD;
      if (body.station) consider(d, range, () => ({ kind: 'dock', body }));
      else if (body.site.resource === 'fuel_skim') consider(d, range, () => ({ kind: 'skim', body }));
      else if (body.site.resource === 'mining' && !isLooted(run, spec.sourceTitle, body.id))
        consider(d, range, () => ({ kind: 'mine', body }));
    }
    for (const derelict of derelicts) {
      const d = Math.hypot(derelict.x - ship.x, derelict.y - ship.y);
      consider(d, INTERACT_RANGE, () => ({ kind: 'salvage', derelict }));
    }
    return best;
  }

  function promptFor(target: Interactable, skimming: boolean): HudPrompt {
    switch (target.kind) {
      case 'gate': {
        const label =
          target.gate.kind === 'uncharted' ? 'uncharted signal' : target.gate.destinationName;
        const cost = jumpCost(target.gate);
        return canJump(run, target.gate)
          ? { text: `[E] Enter See-Also Gate — ${label} (${cost} fuel)`, tone: 'ok' }
          : { text: `INSUFFICIENT FUEL — ${label} needs ${cost}`, tone: 'warn' };
      }
      case 'dock':
        return { text: `[E] Dock — ${target.body.station!.name}`, tone: 'ok' };
      case 'mine':
        return {
          text: `[E] Mine ${target.body.name} — +${miningYield(spec.seed, target.body.id)} cr`,
          tone: 'ok',
        };
      case 'skim':
        return skimming
          ? { text: `SKIMMING ${target.body.name} — hull stress`, tone: 'warn' }
          : { text: `[hold E] Skim fuel — slow, hazardous`, tone: 'ok' };
      case 'salvage':
        return { text: '[E] Salvage derelict', tone: 'ok' };
    }
  }

  /** Discrete [E] interactions (gates handle their own jump transition). */
  function interact(target: Interactable, t: number): void {
    switch (target.kind) {
      case 'gate':
        if (!canJump(run, target.gate)) return;
        applyJump(run, target.gate);
        saveRun(run);
        if (DEBUG) {
          console.log(
            `[jump] ${target.gate.id} (${target.gate.kind}) -> "${target.gate.destinationTitle}"` +
              ` cost ${jumpCost(target.gate)}, fuel ${run.fuel}`,
          );
        }
        transition = { phase: 'out', alpha: 0 };
        return;
      case 'dock':
        mode = 'docked';
        dockedBody = target.body;
        ship.vx = 0;
        ship.vy = 0;
        return;
      case 'mine': {
        const yieldCr = miningYield(spec.seed, target.body.id);
        addCredits(run, yieldCr);
        markLooted(run, spec.sourceTitle, target.body.id);
        saveRun(run);
        toast(`+${yieldCr} cr — ORE EXTRACTED`, t);
        return;
      }
      case 'salvage': {
        addFuel(run, target.derelict.fuel);
        addCredits(run, target.derelict.credits);
        markLooted(run, spec.sourceTitle, target.derelict.id);
        derelicts = unlootedDerelicts();
        saveRun(run);
        toast(`+${target.derelict.fuel} fuel, +${target.derelict.credits} cr — SALVAGED`, t);
        return;
      }
      case 'skim':
        return; // held action, handled in the frame loop
    }
  }

  await enterSystem(0);

  let last = performance.now();
  const t0 = last;

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05); // clamp: tab-switch spikes
    last = now;
    const t = (now - t0) / 1000;

    damageFlash = Math.max(0, damageFlash - dt * 1.5);

    if (mode === 'summary') {
      frameSummary(t);
    } else if (mode === 'docked') {
      frameDocked(t);
    } else {
      frameFlying(t, dt);
    }

    if (DEBUG) Object.assign(debugState, { run, mode, t, jumping: transition !== null });
    input.endFrame();
    requestAnimationFrame(frame);
  }

  function frameFlying(t: number, dt: number): void {
    const jumping = transition !== null;
    const dying = dyingUntil !== null;

    if (!jumping && !dying) {
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

    const target = jumping || dying ? null : findInteractable(t);

    // Continuous hull drains: ambient/belt/stellar hazards + active skim (§7).
    let hazardLabel: string | undefined;
    let skimming = false;
    if (!jumping && !dying) {
      const hz = hazardAt(spec, ship.x, ship.y);
      let dps = hz?.dps ?? 0;
      hazardLabel = hz?.label;
      if (target?.kind === 'skim' && input.isHeld('KeyE', 'Space') && run.fuel < run.fuelMax) {
        skimming = true;
        addFuel(run, SKIM_FUEL_PER_SEC * dt);
        dps += SKIM_HULL_DPS;
        hazardLabel = hazardLabel ?? 'ATMOSPHERIC SKIMMING';
      }
      if (dps > 0) {
        const died = damageHull(run, dps * dt);
        damageFlash = Math.max(damageFlash, Math.min(1, dps / 6));
        if (saveDirtyAt === 0) saveDirtyAt = t;
        if (died) {
          saveRun(run);
          saveDirtyAt = 0;
          dyingUntil = t + DEATH_BEAT_SEC;
        }
      } else if (skimming && saveDirtyAt === 0) {
        saveDirtyAt = t;
      }
      if (saveDirtyAt !== 0 && t - saveDirtyAt > SAVE_INTERVAL_SEC) {
        saveRun(run);
        saveDirtyAt = 0;
      }
    }

    // Discrete interactions (skim is held, not pressed).
    if (!jumping && !dying && target && target.kind !== 'skim' && input.wasPressed('KeyE', 'Space')) {
      interact(target, t);
    }

    // §7 stranded check -> player-acknowledged adrift death.
    const adrift = !jumping && !dying && isStranded(run, gates, spec);
    if (adrift && input.wasPressed('KeyX')) {
      declareAdrift(run);
      saveRun(run);
      mode = 'summary';
      summary = newSummaryState();
      return;
    }

    // Death beat -> summary.
    if (dyingUntil !== null && t >= dyingUntil) {
      dyingUntil = null;
      mode = 'summary';
      summary = newSummaryState();
      return;
    }

    // Advance the jump fade; the system swap happens behind full black.
    if (transition) {
      if (transition.phase === 'out') {
        transition.alpha = Math.min(1, transition.alpha + dt / FADE_SEC);
        if (transition.alpha >= 1) {
          transition.phase = 'hold';
          void enterSystem(t).then(() => {
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
      hull: run.hull,
      hullMax: run.hullMax,
      credits: run.credits,
      jumps: run.route.length - 1,
      prompt: jumping || dying || !target ? null : promptFor(target, skimming),
      adrift,
      damageFlash: dying ? 1 : damageFlash,
      ...(hazardLabel ? { hazardLabel } : {}),
      ...(t < eventUntil
        ? { notice: eventMsg }
        : lastSource === 'degraded'
          ? { notice: 'SENSOR INTERFERENCE — telemetry degraded' }
          : {}),
    };

    renderer.draw(spec, gates, ship, t, hud, derelicts);
    if (mapOpen && !jumping) drawMap(ctx, spec, gates, ship, run, t);

    if (transition) {
      ctx.fillStyle = `rgba(4, 5, 10, ${Math.min(1, Math.max(0, transition.alpha))})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(127, 212, 255, ${Math.min(1, transition.alpha) * 0.8})`;
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('JUMPING…', canvas.width / 2, canvas.height / 2);
    }
  }

  function frameDocked(t: number): void {
    const body = dockedBody!;
    const station = body.station!;
    if (input.wasPressed('KeyR') && buyRefuel(run, station)) saveRun(run);
    if (input.wasPressed('KeyF') && buyRepair(run, station)) saveRun(run);
    if (input.wasPressed('KeyE', 'Space')) {
      // Undock just outside the body, on its anti-star side (the body kept
      // orbiting while we were docked).
      const pos = bodyPosition(body, t);
      const out = Math.atan2(pos.y, pos.x);
      ship.x = pos.x + Math.cos(out) * (body.radius + BODY_RANGE_PAD * 0.7);
      ship.y = pos.y + Math.sin(out) * (body.radius + BODY_RANGE_PAD * 0.7);
      ship.vx = 0;
      ship.vy = 0;
      dockedBody = null;
      mode = 'flying';
      return;
    }

    const hud: HudState = {
      fuel: run.fuel,
      fuelMax: run.fuelMax,
      hull: run.hull,
      hullMax: run.hullMax,
      credits: run.credits,
      jumps: run.route.length - 1,
      prompt: null,
    };
    renderer.draw(spec, gates, ship, t, hud, derelicts);
    drawDock(ctx, body, run);
  }

  function frameSummary(t: number): void {
    if (input.wasPressed('KeyD') && summary.decryptStartedAt === null) {
      summary.decryptStartedAt = t;
    }
    if (input.wasPressed('KeyC')) {
      const text = routeText(run, summary.decryptStartedAt !== null);
      void navigator.clipboard?.writeText(text).then(() => {
        summary.toast = 'log copied to clipboard';
        summary.toastUntil = t + EVENT_TOAST_SEC;
      });
    }
    if (input.wasPressed('KeyS')) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'sum-of-all-suns-run.png';
        a.click();
        URL.revokeObjectURL(a.href);
      });
      summary.toast = 'image saved';
      summary.toastUntil = t + EVENT_TOAST_SEC;
    }
    if (input.wasPressed('KeyN')) {
      startNewRun(t);
      return;
    }
    drawSummary(ctx, run, summary, t);
  }

  requestAnimationFrame(frame);
}

void boot();
