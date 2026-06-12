/**
 * menu.test.ts — the pure half of the M4 shell: title-action availability
 * and cursor wrapping. Drawing is verified by scripts/verify-m4.ts.
 */
import { describe, expect, it } from 'vitest';
import { PAUSE_ACTIONS, newMenuState, stepCursor, titleActions } from './menu';

describe('titleActions', () => {
  it('offers Continue first only when a save exists', () => {
    expect(titleActions(true)).toEqual(['continue', 'new_run', 'controls']);
    expect(titleActions(false)).toEqual(['new_run', 'controls']);
  });

  it('the default cursor (0) lands on Continue when a save exists, New Run otherwise', () => {
    expect(newMenuState().cursor).toBe(0);
    expect(titleActions(true)[0]).toBe('continue');
    expect(titleActions(false)[0]).toBe('new_run');
  });
});

describe('stepCursor', () => {
  it('wraps in both directions', () => {
    expect(stepCursor(0, -1, 3)).toBe(2);
    expect(stepCursor(2, 1, 3)).toBe(0);
    expect(stepCursor(1, 1, 3)).toBe(2);
  });
});

describe('pause menu', () => {
  it('keeps Abandon Run last — farthest from a reflexive double-tap', () => {
    expect(PAUSE_ACTIONS[0]).toBe('resume');
    expect(PAUSE_ACTIONS[PAUSE_ACTIONS.length - 1]).toBe('abandon');
  });
});
