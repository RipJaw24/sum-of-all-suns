/**
 * main.ts — M4 boot: the full shell. Four top-level modes plus a pause flag:
 *
 *   menu    — title screen: Continue / New Run / Controls (menu.ts). New
 *             runs fail early here when the wiki API is unreachable (M4).
 *   flying  — M1 flight/jumping, plus hazard damage, body interactions
 *             (dock, mine, skim, salvage) and the adrift check (§7)
 *   docked  — station overlay: refuel/repair for credits (dock.ts)
 *   summary — run-over screen + Decrypt Flight Log (summary.ts); since M4
 *             also the victory screen (survive-N goal, §2) and abandonment
 *   paused  — Esc overlay on flying/docked (freezes the animation clock):
 *             Resume / Controls / Abandon Run
 *
 * Dev URL params: ?debug (true titles in console + window.__sas hook),
 * ?start=Article_Title (fresh run from that article, skips menu and saved
 * run — the verify scripts depend on this), ?goal=N (survive-N override).
 */

import { generateSystem } from '../gen/generate';
import type { BodySpec, GateSpec, SystemSpec } from '../types';
import {
  ArticleCache,
  IdbArticleStore,
  MemoryArticleStore,
  type ArticleSource,
} from '../wiki/cache';
import { buyGood, buyRefuel, buyRepair, drawDock, drawTrade, sellGood } from './dock';
import { goodById } from '../gen/goods';
import {
  HAZARD_POCKET_ENTRY_DAMAGE,
  SKIM_FUEL_PER_SEC,
  SKIM_HULL_DPS,
  depositYield,
  miningYield,
} from './economy';
import { hazardAt } from './hazards';
import { Input } from './input';
import { drawMap } from './map';
import { Renderer } from './renderer';
import { bodyPosition, gatePosition, type HudPrompt, type HudState } from './view';
import { marketGoodIds, priceFor } from './market';
import {
  CARGO_MAX,
  DEFAULT_GOAL_JUMPS,
  addCargo,
  addCredits,
  addFuel,
  applyJump,
  canJump,
  cargoCount,
  clearRun,
  damageHull,
  declareAbandoned,
  declareAdrift,
  gatesFor,
  isLooted,
  isStranded,
  jumpCost,
  jumpsMade,
  loadRun,
  markLooted,
  newRun,
  saveRun,
  type RunState,
} from './run';
import { derelictsFor, type Derelict } from './salvage';
import { makeShip, updateShip } from './ship';
import { drawSite, siteFragment } from './site';
import { GameAudio } from './audio';
import {
  PAUSE_ACTIONS,
  drawControls,
  drawPause,
  drawTitle,
  newMenuState,
  stepCursor,
  titleActions,
} from './menu';
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
/** Beat between the winning jump's fade-in and the victory summary. */
const VICTORY_BEAT_SEC = 1.6;
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

type Mode = 'menu' | 'flying' | 'docked' | 'summary';

type Interactable =
  | { kind: 'gate'; gate: GateSpec }
  | { kind: 'dock'; body: BodySpec }
  | { kind: 'mine'; body: BodySpec }
  | { kind: 'skim'; body: BodySpec }
  | { kind: 'salvage'; derelict: Derelict };

async function boot(): Promise<void> {
  // Two canvases (index.html): Pixi world in #game, 2D text overlays in
  // #overlay above it. All legacy ctx draws (dock/map/site/summary/fade)
  // target the overlay; renderer.draw() clears it at the start of a frame.
  const gameCanvas = document.getElementById('game') as HTMLCanvasElement;
  const canvas = document.getElementById('overlay') as HTMLCanvasElement;
  const renderer = await Renderer.create(gameCanvas, canvas);
  const ctx = canvas.getContext('2d')!;

  const fitCanvases = (): void => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    renderer.resize(window.innerWidth, window.innerHeight);
  };
  fitCanvases();
  window.addEventListener('resize', fitCanvases);

  const cache = new ArticleCache(
    typeof indexedDB !== 'undefined' ? new IdbArticleStore() : new MemoryArticleStore(),
  );

  // ?goal=N overrides the survive-N target for playtest tuning.
  const goalParam = Number(params.get('goal'));
  const goalJumps = Number.isFinite(goalParam) && goalParam >= 1 ? goalParam : DEFAULT_GOAL_JUMPS;

  // ?start (dev/verify path) skips the menu and the saved run entirely;
  // normal boots land on the title screen, where Continue offers the save.
  const startOverride = params.get('start');
  const savedAtBoot = startOverride ? null : loadRun();
  let run: RunState = startOverride ? newRun(startOverride, goalJumps) : (savedAtBoot ?? newRun(pickStart(), goalJumps));

  const ship = makeShip();
  const input = new Input();
  input.attach(gameCanvas);

  const audio = new GameAudio();
  // Autoplay policy: sound (and the menu track) may only start on a gesture.
  const unlockAudio = (): void => {
    audio.unlock();
    if (mode === 'menu') audio.playMenuMusic();
  };
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  let spec!: SystemSpec;
  let gates: GateSpec[] = [];
  let derelicts: Derelict[] = [];
  let lastSource: ArticleSource = 'cache';
  let mapOpen = false;
  let siteOpen = false; // [Q] scan panel (site.ts), only while a body is near
  let transition: Transition | null = null;
  let mode: Mode = 'menu';
  const menu = newMenuState();
  let paused = false; // overlay on flying/docked; mode is preserved underneath
  let pauseCursor = 0;
  let pauseControls = false; // controls panel on top of the pause overlay
  let dockedBody: BodySpec | null = null;
  let dockView: 'services' | 'trade' = 'services';
  let tradeCursor = 0;
  let summary: SummaryState = newSummaryState();
  let dyingUntil: number | null = null;
  let victoryAt: number | null = null; // VICTORY_BEAT_SEC after the winning fade-in
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
    siteOpen = false;

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
      audio.damage();
      damageFlash = 1;
      toast(`HULL -${HAZARD_POCKET_ENTRY_DAMAGE} — HAZARD ON ENTRY`, t);
      saveRun(run);
      if (died) dyingUntil = t + DEATH_BEAT_SEC;
    }

    if (DEBUG) {
      console.log(`[debug] system "${spec.name}" is "${spec.sourceTitle}" (${source})`);
      console.table(gates.map((g) => ({ gate: g.id, kind: g.kind, article: g.destinationTitle })));
    }
    Object.assign(debugState, {
      spec,
      gates,
      ship,
      run,
      source,
      // verify-m3 hooks: live market prices and the (filtered) derelict list.
      market: marketGoodIds(spec),
      priceFor: (id: string) => priceFor(spec, id),
      derelictsNow: () => derelicts,
      extractPixels: () => renderer.extractPixels(),
    });
  }

  /**
   * Start a fresh run, gated by the M4 fail-early rule: the start system's
   * metadata must resolve strictly (cache or live network) before the run
   * exists at all. No network on a NEW run is a clear error — the degraded
   * fallback is reserved for mid-run blips (§8).
   */
  async function beginNewRun(t: number, from: 'menu' | 'summary'): Promise<void> {
    if (menu.busy) return;
    menu.busy = true;
    menu.error = null;
    const title = pickStart();
    try {
      await cache.getStrict(title);
    } catch {
      menu.busy = false;
      const msg = 'NAV NETWORK UNREACHABLE — A NEW RUN NEEDS A LIVE UPLINK';
      if (from === 'menu') {
        menu.error = msg;
      } else {
        summary.toast = msg;
        summary.toastUntil = t + EVENT_TOAST_SEC;
      }
      return;
    }
    clearRun();
    run = newRun(title, goalJumps);
    saveRun(run);
    summary = newSummaryState();
    dyingUntil = null;
    victoryAt = null;
    damageFlash = 0;
    audio.stopMenuMusic();
    mode = 'flying';
    await enterSystem(t);
    menu.busy = false;
  }

  /** Title-screen Continue: resume the saved run (or its summary screen). */
  async function continueRun(t: number): Promise<void> {
    if (menu.busy) return;
    menu.busy = true;
    audio.stopMenuMusic();
    if (run.status === 'active') {
      mode = 'flying';
      await enterSystem(t);
    } else {
      // A saved death/victory: Continue returns to the summary screen.
      summary = newSummaryState();
      mode = 'summary';
    }
    menu.busy = false;
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

  /** Nearest body of any type in scan range — the [Q] site-panel target. */
  function nearestBody(t: number): BodySpec | null {
    let best: BodySpec | null = null;
    let bestD = Infinity;
    for (const body of spec.bodies) {
      const pos = bodyPosition(body, t);
      const d = Math.hypot(pos.x - ship.x, pos.y - ship.y);
      if (d < body.radius + BODY_RANGE_PAD && d < bestD) {
        bestD = d;
        best = body;
      }
    }
    return best;
  }

  /** The rare good a §4.5 hazard-pocket deposit body holds, if any. */
  function depositGoodOf(body: BodySpec) {
    if (spec.kind !== 'hazard_pocket') return undefined;
    const id = body.site.goodIds[0];
    return id ? goodById(id) : undefined;
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
      case 'mine': {
        const deposit = depositGoodOf(target.body);
        return deposit
          ? {
              text: `[E] Extract deposit — ${deposit.name} ×${depositYield(spec.seed, target.body.id)}`,
              tone: 'ok',
            }
          : {
              text: `[E] Mine ${target.body.name} — +${miningYield(spec.seed, target.body.id)} cr`,
              tone: 'ok',
            };
      }
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
        audio.jump();
        transition = { phase: 'out', alpha: 0 };
        return;
      case 'dock':
        audio.dock();
        mode = 'docked';
        dockedBody = target.body;
        dockView = 'services';
        ship.vx = 0;
        ship.vy = 0;
        return;
      case 'mine': {
        // §4.5 hazard-pocket deposits yield rare CARGO, not credits.
        const deposit = depositGoodOf(target.body);
        if (deposit) {
          const added = addCargo(run, deposit.id, depositYield(spec.seed, target.body.id));
          if (added === 0) {
            toast('CARGO HOLD FULL — deposit untouched', t);
            return; // not looted; come back with space
          }
          markLooted(run, spec.sourceTitle, target.body.id);
          saveRun(run);
          audio.pickup();
          toast(`+${added} ${deposit.name.toUpperCase()} — DEPOSIT EXTRACTED`, t);
          return;
        }
        const yieldCr = miningYield(spec.seed, target.body.id);
        addCredits(run, yieldCr);
        markLooted(run, spec.sourceTitle, target.body.id);
        saveRun(run);
        audio.pickup();
        toast(`+${yieldCr} cr — ORE EXTRACTED`, t);
        return;
      }
      case 'salvage': {
        addFuel(run, target.derelict.fuel);
        addCredits(run, target.derelict.credits);
        markLooted(run, spec.sourceTitle, target.derelict.id);
        derelicts = unlootedDerelicts();
        saveRun(run);
        audio.pickup();
        toast(`+${target.derelict.fuel} fuel, +${target.derelict.credits} cr — SALVAGED`, t);
        return;
      }
      case 'skim':
        return; // held action, handled in the frame loop
    }
  }

  // Dev/verify path: ?start skips the menu and boots straight into the run.
  if (startOverride) {
    mode = 'flying';
    await enterSystem(0);
  }

  let last = performance.now();
  // Animation clock: accumulated unpaused time. Freezing it while paused
  // freezes orbits, toasts, and beats all at once (everything keys off t).
  let clock = 0;

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05); // clamp: tab-switch spikes
    last = now;
    if (!paused) clock += dt;
    const t = clock;

    if (input.wasPressed('Digit0')) {
      const muted = audio.toggleMuted();
      if (mode === 'flying' && !paused) toast(muted ? 'AUDIO MUTED' : 'AUDIO ON', t);
    }
    if (paused || mode !== 'flying') audio.setThrust(false);

    damageFlash = Math.max(0, damageFlash - dt * 1.5);

    if (paused) {
      framePaused(t);
    } else if (mode === 'menu') {
      frameMenu(t);
    } else if (mode === 'summary') {
      frameSummary(t);
    } else if (mode === 'docked') {
      frameDocked(t);
    } else {
      frameFlying(t, dt);
    }

    if (DEBUG) {
      Object.assign(debugState, {
        run,
        mode,
        paused,
        menuBusy: menu.busy,
        menuError: menu.error,
        t,
        jumping: transition !== null,
        rendererName: renderer.rendererName,
      });
    }
    input.endFrame();
    requestAnimationFrame(frame);
  }

  function frameMenu(t: number): void {
    if (menu.controlsOpen) {
      if (input.wasPressed('Escape')) {
        menu.controlsOpen = false;
        audio.uiMove();
      }
      drawControls(ctx);
      return;
    }
    const actions = titleActions(savedAtBoot !== null);
    if (!menu.busy) {
      if (input.wasPressed('KeyW', 'ArrowUp')) {
        menu.cursor = stepCursor(menu.cursor, -1, actions.length);
        audio.uiMove();
      }
      if (input.wasPressed('KeyS', 'ArrowDown')) {
        menu.cursor = stepCursor(menu.cursor, 1, actions.length);
        audio.uiMove();
      }
      if (input.wasPressed('KeyE', 'Space', 'Enter')) {
        audio.uiSelect();
        const action = actions[menu.cursor]!;
        if (action === 'controls') menu.controlsOpen = true;
        else if (action === 'continue') void continueRun(t);
        else void beginNewRun(t, 'menu');
      }
    }
    drawTitle(ctx, menu, savedAtBoot !== null, t);
  }

  /** Esc overlay: world frame frozen underneath (clock is not advancing). */
  function framePaused(t: number): void {
    if (pauseControls) {
      if (input.wasPressed('Escape')) {
        pauseControls = false;
        audio.uiMove();
      }
      drawFrozenWorld(t);
      drawControls(ctx);
      return;
    }
    if (input.wasPressed('Escape')) {
      paused = false;
      audio.uiMove();
      return;
    }
    if (input.wasPressed('KeyW', 'ArrowUp')) {
      pauseCursor = stepCursor(pauseCursor, -1, PAUSE_ACTIONS.length);
      audio.uiMove();
    }
    if (input.wasPressed('KeyS', 'ArrowDown')) {
      pauseCursor = stepCursor(pauseCursor, 1, PAUSE_ACTIONS.length);
      audio.uiMove();
    }
    if (input.wasPressed('KeyE', 'Space', 'Enter')) {
      audio.uiSelect();
      switch (PAUSE_ACTIONS[pauseCursor]!) {
        case 'resume':
          paused = false;
          return;
        case 'controls':
          pauseControls = true;
          break;
        case 'abandon':
          declareAbandoned(run);
          saveRun(run);
          paused = false;
          dockedBody = null;
          summary = newSummaryState();
          mode = 'summary';
          return;
      }
    }
    drawFrozenWorld(t);
    drawPause(ctx, pauseCursor);
  }

  function drawFrozenWorld(t: number): void {
    const hud: HudState = {
      fuel: run.fuel,
      fuelMax: run.fuelMax,
      hull: run.hull,
      hullMax: run.hullMax,
      credits: run.credits,
      cargo: cargoCount(run),
      cargoMax: CARGO_MAX,
      jumps: jumpsMade(run),
      goalJumps: run.goalJumps,
      prompt: null,
    };
    renderer.draw(spec, gates, ship, t, hud, derelicts);
  }

  function frameFlying(t: number, dt: number): void {
    const jumping = transition !== null;
    // The victory beat gates input exactly like the death beat: the run is
    // decided, the arrival just gets a moment to land before the summary.
    const dying = dyingUntil !== null || victoryAt !== null;

    if (!jumping && !dying && input.wasPressed('Escape')) {
      paused = true;
      pauseCursor = 0;
      pauseControls = false;
      audio.uiSelect();
      return;
    }

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
    audio.setThrust(!jumping && !dying && input.isHeld('KeyW', 'ArrowUp'));

    if (input.wasPressed('Tab', 'KeyM')) mapOpen = !mapOpen;

    const target = jumping || dying ? null : findInteractable(t);

    // §6 site panel: [Q] toggles the scan of the nearest body in range.
    const nearBody = jumping || dying ? null : nearestBody(t);
    if (!nearBody) siteOpen = false;
    else if (input.wasPressed('KeyQ')) siteOpen = !siteOpen;

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
          audio.death();
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
      audio.death();
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

    // Victory beat (survive-N reached, §2) -> summary.
    if (victoryAt !== null && t >= victoryAt) {
      victoryAt = null;
      audio.victory();
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
        if (transition.alpha <= 0) {
          transition = null;
          // applyJump flipped status to 'won' on the goal jump; let the
          // arrival land for a beat before the victory summary.
          if (run.status === 'won') {
            victoryAt = t + VICTORY_BEAT_SEC;
            toast('FINAL JUMP COMPLETE — FLIGHT LOG READY', t);
          }
        }
      }
    }

    const hud: HudState = {
      fuel: run.fuel,
      fuelMax: run.fuelMax,
      hull: run.hull,
      hullMax: run.hullMax,
      credits: run.credits,
      cargo: cargoCount(run),
      cargoMax: CARGO_MAX,
      jumps: jumpsMade(run),
      goalJumps: run.goalJumps,
      prompt: jumping || dying || !target ? null : promptFor(target, skimming),
      ...(nearBody && !siteOpen ? { subPrompt: `[Q] scan ${nearBody.name}` } : {}),
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
    if (siteOpen && nearBody && !mapOpen && !jumping) drawSite(ctx, nearBody, spec);
    if (mapOpen && !jumping) drawMap(ctx, spec, gates, ship, run, t);

    if (DEBUG) {
      Object.assign(debugState, {
        siteOpen,
        siteFragment: nearBody ? siteFragment(nearBody, spec) : null,
      });
    }

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
    if (input.wasPressed('Escape')) {
      paused = true;
      pauseCursor = 0;
      pauseControls = false;
      audio.uiSelect();
      return;
    }
    const body = dockedBody!;
    const station = body.station!;
    if (dockView === 'services') {
      if (input.wasPressed('KeyR') && buyRefuel(spec, run, station)) {
        saveRun(run);
        audio.uiSelect();
      }
      if (input.wasPressed('KeyF') && buyRepair(spec, run, station)) {
        saveRun(run);
        audio.uiSelect();
      }
      if (input.wasPressed('KeyT') && station.services.includes('trade')) {
        dockView = 'trade';
        tradeCursor = 0;
      }
    } else {
      const goods = marketGoodIds(spec);
      if (input.wasPressed('KeyW', 'ArrowUp')) {
        tradeCursor = (tradeCursor + goods.length - 1) % goods.length;
      }
      if (input.wasPressed('KeyS', 'ArrowDown')) tradeCursor = (tradeCursor + 1) % goods.length;
      const goodId = goods[tradeCursor];
      if (goodId && input.wasPressed('KeyB') && buyGood(run, spec, goodId)) {
        saveRun(run);
        audio.uiSelect();
      }
      if (goodId && input.wasPressed('KeyV') && sellGood(run, spec, goodId)) {
        saveRun(run);
        audio.uiSelect();
      }
      if (input.wasPressed('KeyT')) dockView = 'services';
    }
    if (input.wasPressed('KeyE', 'Space')) {
      audio.undock();
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
      cargo: cargoCount(run),
      cargoMax: CARGO_MAX,
      jumps: jumpsMade(run),
      goalJumps: run.goalJumps,
      prompt: null,
    };
    renderer.draw(spec, gates, ship, t, hud, derelicts);
    if (dockView === 'trade') drawTrade(ctx, body, run, spec, tradeCursor);
    else drawDock(ctx, body, run, spec);
  }

  function frameSummary(t: number): void {
    if (input.wasPressed('KeyD') && summary.decryptStartedAt === null) {
      summary.decryptStartedAt = t;
      audio.decrypt();
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
      void beginNewRun(t, 'summary');
      return;
    }
    drawSummary(ctx, run, summary, t);
  }

  requestAnimationFrame(frame);
}

void boot();
