/**
 * verify-m4.ts — acceptance check for M4 "shell, goal & ship": the title
 * menu (New Run / Continue / Controls), the fail-early no-network rule on
 * new-run start (context.setOffline), Esc pause with Abandon Run, and the
 * survive-N victory path (?goal=1). Uses the ?debug __sas hook like
 * verify-m2/m3. Dev server must be running: npx vite-node scripts/verify-m4.ts
 */
import { chromium } from 'playwright';

const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

// === 1. Boot lands on the title menu (no saved run) =============================
await page.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.mode === 'menu');
check(true, 'boot (no save) lands on the menu');
await page.screenshot({ path: 'scripts/screenshot-title.png' });

// === 2. Controls panel opens and closes =========================================
// No save -> actions are [NEW RUN, CONTROLS]; cursor starts on NEW RUN.
await page.keyboard.press('KeyS'); // -> CONTROLS
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);
await page.screenshot({ path: 'scripts/screenshot-controls.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('KeyW'); // back to NEW RUN
await page.waitForTimeout(100);

// === 3. Fail-early: New Run with no network errors in the menu ==================
await context.setOffline(true);
await page.keyboard.press('KeyE'); // NEW RUN
await page
  .waitForFunction(() => (window as any).__sas?.menuError !== null, undefined, { timeout: 10000 })
  .catch(() => failures.push('offline new run never surfaced a menu error'));
const offline = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { mode: s.mode as string, error: (s.menuError ?? '') as string };
});
check(offline.mode === 'menu', 'offline new run stays on the menu (no degraded galaxy)');
check(offline.error.includes('UNREACHABLE'), `menu shows a clear uplink error ("${offline.error}")`);
await page.screenshot({ path: 'scripts/screenshot-offline.png' });

// === 4. Same menu, network back: New Run starts ==================================
await context.setOffline(false);
await page.keyboard.press('KeyE');
await page
  .waitForFunction(() => (window as any).__sas?.mode === 'flying', undefined, { timeout: 30000 })
  .catch(() => failures.push('online new run never reached flying'));
const fresh = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { goal: s.run.goalJumps as number, status: s.run.status as string, source: s.source as string };
});
check(fresh.status === 'active', 'new run is active');
check(fresh.goal >= 1, `survive-N goal set (${fresh.goal} jumps)`);
check(fresh.source !== 'degraded', `start system resolved strictly (${fresh.source})`);

// === 5. Esc pause: freeze, then Abandon Run ======================================
await page.keyboard.press('Digit0'); // mute toggle must not crash anything
await page.keyboard.press('Escape');
await page.waitForFunction(() => (window as any).__sas?.paused === true);
const tPaused = await page.evaluate(() => (window as any).__sas.t as number);
await page.waitForTimeout(400);
const tStill = await page.evaluate(() => (window as any).__sas.t as number);
check(tStill === tPaused, `animation clock frozen while paused (Δ${(tStill - tPaused).toFixed(3)}s)`);
await page.screenshot({ path: 'scripts/screenshot-pause.png' });

await page.keyboard.press('KeyS'); // RESUME -> CONTROLS
await page.keyboard.press('KeyS'); // -> ABANDON RUN
await page.keyboard.press('KeyE');
await page.waitForFunction(() => (window as any).__sas?.mode === 'summary');
const abandoned = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { status: s.run.status as string, cause: s.run.deathCause as string };
});
check(abandoned.status === 'dead' && abandoned.cause === 'abandoned', 'Abandon Run -> summary with cause "abandoned"');
await page.screenshot({ path: 'scripts/screenshot-abandoned.png' });

// === 6. Reload: Continue returns to the saved (ended) run's summary ==============
await page.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.mode === 'menu');
await page.keyboard.press('KeyE'); // CONTINUE leads when a save exists
await page.waitForFunction(() => (window as any).__sas?.mode === 'summary');
const resumed = await page.evaluate(() => (window as any).__sas.run.deathCause as string);
check(resumed === 'abandoned', 'Continue resumes the saved run (its summary)');

// === 7. Victory: survive-N reached -> victory summary =============================
await page.goto('http://localhost:5173/?debug&start=Moon&goal=1', { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined);
const goal = await page.evaluate(() => (window as any).__sas.run.goalJumps as number);
check(goal === 1, '?goal=1 override applied');

// Park at the first gate and jump.
await page.evaluate(() => {
  const s = (window as any).__sas;
  const g = s.gates[0];
  s.ship.x = Math.cos(g.angle) * g.rimRadius + 12;
  s.ship.y = Math.sin(g.angle) * g.rimRadius;
  s.ship.vx = 0;
  s.ship.vy = 0;
});
await page.waitForTimeout(200);
await page.keyboard.press('KeyE');
await page
  .waitForFunction(() => (window as any).__sas?.mode === 'summary', undefined, { timeout: 30000 })
  .catch(() => failures.push('winning jump never reached the summary'));
const wonStatus = await page.evaluate(() => (window as any).__sas.run.status as string);
check(wonStatus === 'won', 'goal jump flips the run to won');
await page.keyboard.press('KeyD'); // decrypt still works on a victory
await page.waitForTimeout(1500);
await page.screenshot({ path: 'scripts/screenshot-victory.png' });

await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — M4 shell, goal & fail-early verified end-to-end');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
