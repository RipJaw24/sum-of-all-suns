/**
 * summary.test.ts — the pure half of the Decrypt Flight Log (§7):
 * constellation layout, scramble text, and the shareable export. The
 * laundering check matters most: the ENCRYPTED export must never leak a
 * Wikipedia title.
 */
import { describe, expect, it } from 'vitest';
import { systemName } from '../gen/names';
import { newRun, type RunState } from './run';
import {
  decryptProgress,
  DECRYPT_STAGGER_SEC,
  layoutRoute,
  routeText,
  scrambledTitle,
  statsLine,
  summaryTitle,
} from './summary';

function deadRun(): RunState {
  const run = newRun('Photosynthesis');
  run.route.push(
    { title: 'Chloroplast', via: 'charted' },
    { title: 'Byzantine Empire', via: 'wormhole' },
  );
  run.currentTitle = 'Byzantine Empire';
  run.status = 'dead';
  run.deathCause = 'hull';
  return run;
}

describe('layoutRoute', () => {
  it('is deterministic and stays inside the box', () => {
    const route = deadRun().route;
    const a = layoutRoute(route, 800, 400);
    expect(layoutRoute(route, 800, 400)).toEqual(a);
    expect(a).toHaveLength(route.length);
    for (const n of a) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(800);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(400);
    }
  });

  it('wraps long routes into rows', () => {
    const route = Array.from({ length: 20 }, (_, i) => ({
      title: `Article ${i}`,
      via: 'charted' as const,
    }));
    const nodes = layoutRoute(route, 800, 400);
    const ys = new Set(nodes.map((n) => Math.round(n.y / 100)));
    expect(ys.size).toBeGreaterThan(1); // more than one row used
  });
});

describe('scrambledTitle', () => {
  it('resolves fully at progress 1 and not before', () => {
    expect(scrambledTitle('Byzantine Empire', 1, 7)).toBe('Byzantine Empire');
    const half = scrambledTitle('Byzantine Empire', 0.5, 7);
    expect(half).not.toBe('Byzantine Empire');
    expect(half).toHaveLength('Byzantine Empire'.length);
    expect(half.startsWith('Byzantin')).toBe(true); // left-to-right resolve
    expect(half[9]).toBe(' '); // word shape preserved
  });

  it('is deterministic per tick and churns across ticks', () => {
    expect(scrambledTitle('Chloroplast', 0, 3)).toBe(scrambledTitle('Chloroplast', 0, 3));
    expect(scrambledTitle('Chloroplast', 0, 3)).not.toBe(scrambledTitle('Chloroplast', 0, 4));
  });

  it('staggers node decode start times', () => {
    expect(decryptProgress(0, 0.1)).toBeGreaterThan(0);
    expect(decryptProgress(3, 3 * DECRYPT_STAGGER_SEC - 0.01)).toBe(0);
    expect(decryptProgress(3, 99)).toBe(1);
  });
});

describe('routeText (share/export)', () => {
  it('encrypted export shows generated names and NEVER article titles', () => {
    const run = deadRun();
    const text = routeText(run, false);
    expect(text).toContain(systemName('Photosynthesis'));
    expect(text).toContain(systemName('Byzantine Empire'));
    for (const title of ['Photosynthesis', 'Chloroplast', 'Byzantine Empire']) {
      expect(text).not.toContain(title);
    }
    expect(text).not.toContain('[DECRYPTED]');
  });

  it('decrypted export reveals the true route, jump by jump', () => {
    const text = routeText(deadRun(), true);
    expect(text).toContain('[DECRYPTED]');
    expect(text).toContain('1. Photosynthesis  [start]');
    expect(text).toContain('2. Chloroplast  [gate]');
    expect(text).toContain('3. Byzantine Empire  [wormhole]');
  });

  it('outcome and stats are included', () => {
    const run = deadRun();
    expect(summaryTitle(run)).toContain('HULL BREACH');
    run.deathCause = 'adrift';
    expect(summaryTitle(run)).toContain('ADRIFT');
    run.deathCause = 'abandoned';
    expect(summaryTitle(run)).toContain('ABANDONED');
    expect(statsLine(run)).toContain('2 jumps');
    expect(statsLine(run)).toContain('3 systems');
  });

  it('a won run gets the victory header (M4 survive-N)', () => {
    const run = deadRun();
    run.status = 'won';
    run.goalJumps = 2;
    delete run.deathCause;
    expect(summaryTitle(run)).toBe('RUN COMPLETE — SURVIVED 2 JUMPS');
    expect(routeText(run, true)).toContain('RUN COMPLETE');
  });
});
