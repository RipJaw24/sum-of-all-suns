/**
 * summary.ts — death screen + Decrypt Flight Log (§7, core feature: the
 * post-run reveal that every system was a Wikipedia article, jump by jump).
 *
 * The route constellation renders RunState.route as a serpentine polyline of
 * nodes labeled with generated system names. Decrypting scrambles each label
 * and resolves it into the TRUE article title — the only place outside
 * ?debug where sourceTitle-class spoilers reach the screen, by design.
 *
 * Layout, scramble text, and the export text are pure and deterministic
 * (unit-tested); drawing stays thin per the renderer.ts rule.
 */

import { factionById } from '../gen/factions';
import { systemName } from '../gen/names';
import { hash128 } from '../rng';
import { GATE_COLORS } from './view';
import type { RouteEntry, RunState } from './run';

/** §13.3 Decrypt payoff: name the faction that held a visited system. Empty
 *  for pre-M5 / unstamped entries; "Unaligned" for the frontier. */
export function factionLabel(entry: RouteEntry): string {
  if (entry.faction === undefined) return '';
  return entry.faction === null ? ' · Unaligned' : ` · ${factionById(entry.faction).name}`;
}

// --- constellation layout -----------------------------------------------------

export interface NodePos {
  x: number;
  y: number;
}

const PER_ROW = 8;

/** Serpentine left-right rows with per-title jitter. Pure: same route + box
 *  -> same constellation (it's the shareable image). */
export function layoutRoute(
  route: readonly RouteEntry[],
  width: number,
  height: number,
): NodePos[] {
  const rows = Math.max(1, Math.ceil(route.length / PER_ROW));
  const rowH = height / rows;
  const cols = Math.min(route.length, PER_ROW);
  const colW = width / Math.max(1, cols);
  return route.map((entry, i) => {
    const row = Math.floor(i / PER_ROW);
    const colRaw = i % PER_ROW;
    const col = row % 2 === 0 ? colRaw : Math.min(route.length - row * PER_ROW, PER_ROW) - 1 - colRaw;
    const [jx, jy] = hash128(`${entry.title}:${i}`);
    const jitter = (v: number, scale: number) => ((v / 0x1_0000_0000) - 0.5) * scale;
    return {
      x: (col + 0.5) * colW + jitter(jx, colW * 0.3),
      y: (row + 0.5) * rowH + jitter(jy, Math.min(40, rowH * 0.5)),
    };
  });
}

// --- decrypt animation ----------------------------------------------------------

export const DECRYPT_STAGGER_SEC = 0.35; // per node
export const DECRYPT_DECODE_SEC = 0.9; // scramble -> resolved

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@!?';

/** Decode progress (0..1) of node `index`, `elapsed` secs after [D]. */
export function decryptProgress(index: number, elapsed: number): number {
  return Math.max(0, Math.min(1, (elapsed - index * DECRYPT_STAGGER_SEC) / DECRYPT_DECODE_SEC));
}

/**
 * Partially decoded title: a left-to-right resolve with seeded churn in the
 * unresolved tail. Deterministic in (title, progress, tick) so it's testable;
 * `tick` advances with the animation clock to keep the static churning.
 */
export function scrambledTitle(title: string, progress: number, tick: number): string {
  if (progress >= 1) return title;
  const resolved = Math.floor(progress * title.length);
  let out = title.slice(0, resolved);
  for (let i = resolved; i < title.length; i++) {
    const ch = title[i]!;
    if (ch === ' ') {
      out += ' '; // keep word shape readable mid-decode
      continue;
    }
    const [h] = hash128(`${title}:${i}:${tick}`);
    out += SCRAMBLE_CHARS[h % SCRAMBLE_CHARS.length]!;
  }
  return out;
}

// --- export ---------------------------------------------------------------------

const VIA_TAG: Record<RouteEntry['via'], string> = {
  start: 'start',
  charted: 'gate',
  uncharted: 'uncharted gate',
  wormhole: 'wormhole',
};

/** Header line for the run's outcome — death, abandonment, or M4 victory. */
export function summaryTitle(run: RunState): string {
  if (run.status === 'won') {
    return `RUN COMPLETE — SURVIVED ${run.goalJumps} JUMP${run.goalJumps === 1 ? '' : 'S'}`;
  }
  switch (run.deathCause) {
    case 'adrift':
      return 'RUN OVER — ADRIFT, FUEL EXHAUSTED';
    case 'abandoned':
      return 'RUN ABANDONED';
    case 'destroyed':
      return 'RUN OVER — DESTROYED IN COMBAT';
    default:
      return 'RUN OVER — HULL BREACH';
  }
}

export function statsLine(run: RunState): string {
  const systems = new Set(run.route.map((e) => e.title)).size;
  return `${run.route.length - 1} jumps · ${systems} systems charted · ${run.credits} cr`;
}

/** Shareable text form of the route (§7 "share/export of the decrypted
 *  route"). Encrypted form shows only generated names — spoiler-safe. */
export function routeText(run: RunState, decrypted: boolean): string {
  const lines = [
    `SUM OF ALL SUNS — FLIGHT LOG${decrypted ? ' [DECRYPTED]' : ''}`,
    summaryTitle(run),
    statsLine(run),
    '',
  ];
  run.route.forEach((entry, i) => {
    const label = decrypted ? `${entry.title}${factionLabel(entry)}` : systemName(entry.title);
    lines.push(`${String(i + 1).padStart(2)}. ${label}  [${VIA_TAG[entry.via]}]`);
  });
  return lines.join('\n');
}

// --- drawing ---------------------------------------------------------------------

export interface SummaryState {
  /** Animation-clock time when [D] was pressed; null until then. */
  decryptStartedAt: number | null;
  /** Transient "copied!" toast deadline on the animation clock. */
  toastUntil: number;
  toast: string;
}

export function newSummaryState(): SummaryState {
  return { decryptStartedAt: null, toastUntil: 0, toast: '' };
}

const NODE_COLOR: Record<RouteEntry['via'], string> = {
  start: '#e8edf7',
  charted: GATE_COLORS.charted,
  uncharted: GATE_COLORS.uncharted,
  wormhole: GATE_COLORS.wormhole,
};

export function drawSummary(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  state: SummaryState,
  t: number,
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = run.status === 'won' ? '#9ee887' : '#ff6b4a';
  ctx.font = '22px monospace';
  ctx.fillText(summaryTitle(run), width / 2, 64);
  ctx.fillStyle = 'rgba(205, 214, 244, 0.7)';
  ctx.font = '13px monospace';
  ctx.fillText(statsLine(run), width / 2, 90);

  // Constellation.
  const boxX = width * 0.1;
  const boxY = 130;
  const boxW = width * 0.8;
  const boxH = height - 260;
  const nodes = layoutRoute(run.route, boxW, boxH);
  const decrypting = state.decryptStartedAt !== null;
  const elapsed = decrypting ? t - state.decryptStartedAt! : 0;
  const tick = Math.floor(t * 20);

  ctx.strokeStyle = 'rgba(127, 212, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  nodes.forEach((n, i) => {
    if (i === 0) ctx.moveTo(boxX + n.x, boxY + n.y);
    else ctx.lineTo(boxX + n.x, boxY + n.y);
  });
  ctx.stroke();

  ctx.font = '11px monospace';
  run.route.forEach((entry, i) => {
    const n = nodes[i]!;
    const x = boxX + n.x;
    const y = boxY + n.y;
    ctx.fillStyle = NODE_COLOR[entry.via];
    ctx.beginPath();
    ctx.arc(x, y, i === run.route.length - 1 ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();

    const progress = decrypting ? decryptProgress(i, elapsed) : 0;
    const label = decrypting
      ? scrambledTitle(entry.title, progress, tick) + (progress >= 1 ? factionLabel(entry) : '')
      : systemName(entry.title);
    ctx.fillStyle =
      decrypting && progress >= 1 ? '#7fd4ff' : 'rgba(205, 214, 244, 0.8)';
    ctx.fillText(label, x, y - 12);
  });

  // Footer / controls.
  ctx.font = '14px monospace';
  ctx.fillStyle = '#cdd6f4';
  const controls = decrypting
    ? '[C] COPY LOG · [S] SAVE IMAGE · [N] NEW RUN'
    : '[D] DECRYPT FLIGHT LOG · [C] COPY LOG · [S] SAVE IMAGE · [N] NEW RUN';
  ctx.fillText(controls, width / 2, height - 60);

  if (t < state.toastUntil) {
    ctx.fillStyle = '#7fd4ff';
    ctx.font = '12px monospace';
    ctx.fillText(state.toast, width / 2, height - 36);
  }
}
