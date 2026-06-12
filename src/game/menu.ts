/**
 * menu.ts — M4 shell: title screen (Continue / New Run / Controls), the Esc
 * pause overlay (Resume / Controls / Abandon Run), and the shared controls
 * panel. Selection logic is pure (unit-tested); drawing stays thin per the
 * renderer.ts rule. main.ts owns key routing and mode transitions.
 */

import { hash128 } from '../rng';

export type TitleAction = 'continue' | 'new_run' | 'controls';

export const PAUSE_ACTIONS = ['resume', 'controls', 'abandon'] as const;
export type PauseAction = (typeof PAUSE_ACTIONS)[number];

/** Continue leads (and is the default cursor target) when a run exists. */
export function titleActions(hasSave: boolean): TitleAction[] {
  return hasSave ? ['continue', 'new_run', 'controls'] : ['new_run', 'controls'];
}

export function stepCursor(cursor: number, delta: number, length: number): number {
  return (cursor + delta + length) % length;
}

export interface MenuState {
  cursor: number;
  /** Controls panel open on top of the title / pause menu. */
  controlsOpen: boolean;
  /** Fail-early new-run error (M4, §8) — cleared on the next attempt. */
  error: string | null;
  /** Resolving the start system over the network. */
  busy: boolean;
}

export function newMenuState(): MenuState {
  return { cursor: 0, controlsOpen: false, error: null, busy: false };
}

const TITLE_LABELS: Record<TitleAction, string> = {
  continue: 'CONTINUE',
  new_run: 'NEW RUN',
  controls: 'CONTROLS',
};

const PAUSE_LABELS: Record<PauseAction, string> = {
  resume: 'RESUME',
  controls: 'CONTROLS',
  abandon: 'ABANDON RUN',
};

const CONTROL_LINES: readonly (readonly [string, string])[] = [
  ['MOUSE', 'set heading'],
  ['W / UP', 'main thrust'],
  ['S / DOWN', 'retro-thrust / brake'],
  ['A·D / L·R', 'lateral thrusters'],
  ['E / SPACE', 'interact — dock · gate · salvage (hold to skim fuel)'],
  ['Q', 'scan nearby body'],
  ['TAB / M', 'system chart'],
  ['0', 'mute audio'],
  ['ESC', 'pause'],
];

// --- drawing --------------------------------------------------------------------

/** Seeded static starfield for the title screen (no SystemSpec exists yet,
 *  so the Pixi world canvas is empty underneath). */
function drawMenuStars(ctx: CanvasRenderingContext2D, t: number): void {
  const { width, height } = ctx.canvas;
  for (let i = 0; i < 140; i++) {
    const [hx, hy, hb, hp] = hash128(`menu-star:${i}`);
    const x = (hx! / 0x1_0000_0000) * width;
    const y = (hy! / 0x1_0000_0000) * height;
    const base = 0.15 + (hb! / 0x1_0000_0000) * 0.5;
    const twinkle = 0.75 + 0.25 * Math.sin(t * 0.8 + (hp! / 0x1_0000_0000) * Math.PI * 2);
    ctx.fillStyle = `rgba(205, 214, 244, ${base * twinkle})`;
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawMenuItems(
  ctx: CanvasRenderingContext2D,
  labels: readonly string[],
  cursor: number,
  centerX: number,
  topY: number,
  dimmed: boolean,
): void {
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  labels.forEach((label, i) => {
    const selected = i === cursor;
    ctx.fillStyle = dimmed
      ? 'rgba(205, 214, 244, 0.25)'
      : selected
        ? '#7fd4ff'
        : 'rgba(205, 214, 244, 0.7)';
    ctx.fillText(selected ? `▸ ${label} ◂` : label, centerX, topY + i * 34);
  });
}

export function drawTitle(ctx: CanvasRenderingContext2D, state: MenuState, hasSave: boolean, t: number): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, width, height);
  drawMenuStars(ctx, t);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8edf7';
  ctx.font = '44px monospace';
  ctx.fillText('SUM OF ALL SUNS', width / 2, height * 0.32);

  const labels = titleActions(hasSave).map((a) => TITLE_LABELS[a]);
  drawMenuItems(ctx, labels, state.cursor, width / 2, height * 0.48, state.busy);

  if (state.busy) {
    ctx.fillStyle = '#7fd4ff';
    ctx.font = '13px monospace';
    const dots = '.'.repeat(1 + (Math.floor(t * 2) % 3));
    ctx.fillText(`ESTABLISHING NAV UPLINK${dots}`, width / 2, height * 0.48 + labels.length * 34 + 16);
  } else if (state.error) {
    ctx.fillStyle = '#ff6b4a';
    ctx.font = '13px monospace';
    ctx.fillText(state.error, width / 2, height * 0.48 + labels.length * 34 + 16);
    ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
    ctx.fillText('check your connection, then try again', width / 2, height * 0.48 + labels.length * 34 + 34);
  }

  ctx.fillStyle = 'rgba(205, 214, 244, 0.45)';
  ctx.font = '12px monospace';
  ctx.fillText('[W/S] SELECT · [E] CONFIRM', width / 2, height - 48);
}

/** Pause overlay — drawn over the frozen world frame, after renderer.draw(). */
export function drawPause(ctx: CanvasRenderingContext2D, cursor: number): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = 'rgba(4, 5, 10, 0.78)';
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8edf7';
  ctx.font = '24px monospace';
  ctx.fillText('PAUSED', width / 2, height * 0.34);

  drawMenuItems(ctx, PAUSE_ACTIONS.map((a) => PAUSE_LABELS[a]), cursor, width / 2, height * 0.46, false);

  ctx.fillStyle = 'rgba(205, 214, 244, 0.45)';
  ctx.font = '12px monospace';
  ctx.fillText('[W/S] SELECT · [E] CONFIRM · [ESC] RESUME', width / 2, height - 48);
}

export function drawControls(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = 'rgba(4, 5, 10, 0.92)';
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8edf7';
  ctx.font = '20px monospace';
  ctx.fillText('CONTROLS', width / 2, height * 0.2);

  ctx.font = '14px monospace';
  const topY = height * 0.2 + 48;
  CONTROL_LINES.forEach(([key, what], i) => {
    const y = topY + i * 26;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7fd4ff';
    ctx.fillText(key, width / 2 - 16, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(205, 214, 244, 0.8)';
    ctx.fillText(what, width / 2 + 16, y);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(205, 214, 244, 0.45)';
  ctx.font = '12px monospace';
  ctx.fillText('[ESC] BACK', width / 2, height - 48);
}
