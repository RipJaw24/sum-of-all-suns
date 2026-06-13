/**
 * verify-planets.ts — visual check for the M4 planet-texture pass: every
 * body type (rocky/ice/lava/ocean/gas_giant) renders a procedural surface,
 * and ringed bodies show the back/front ringlet split. Screenshots are for
 * MANUAL inspection; the script only asserts coverage (each type + a ringed
 * body appeared somewhere) and no page errors. Uses the ?debug __sas hook.
 * Dev server must be running: npx vite-node scripts/verify-planets.ts
 */
import { chromium } from 'playwright';

// Long articles roll many bodies; spread across a few for type coverage.
const STARTS = ['Saturn', 'Iceland', 'Volcano', 'Pacific Ocean'];

const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

const seenTypes = new Set<string>();
let seenRings = false;

for (const start of STARTS) {
  await page.goto(`http://localhost:5173/?debug&start=${encodeURIComponent(start)}`, {
    waitUntil: 'networkidle',
  });
  await page
    .waitForFunction(() => (window as any).__sas?.mode === 'flying', undefined, { timeout: 30000 })
    .catch(() => failures.push(`${start}: never reached flying`));

  const bodies = await page.evaluate(() => {
    const s = (window as any).__sas;
    return (s.spec.bodies as any[]).map((b) => ({
      type: b.type as string,
      hasRings: b.hasRings as boolean,
      radius: b.radius as number,
    }));
  });
  console.log(`${start}: ${bodies.map((b) => b.type + (b.hasRings ? '+rings' : '')).join(', ')}`);
  for (const b of bodies) {
    seenTypes.add(b.type);
    if (b.hasRings) seenRings = true;
  }

  // Park the ship next to the most interesting body (ringed beats big) so
  // the close-up shows the surface texture and the ring depth split.
  await page.evaluate(() => {
    const s = (window as any).__sas;
    const bodies = s.spec.bodies as any[];
    if (bodies.length === 0) return;
    const target = [...bodies].sort(
      (a, b) => Number(b.hasRings) - Number(a.hasRings) || b.radius - a.radius,
    )[0];
    const angle = target.initialAngle + ((Math.PI * 2) / target.orbitPeriodSec) * s.t;
    s.ship.x = Math.cos(angle) * target.orbitRadius + target.radius + 70;
    s.ship.y = Math.sin(angle) * target.orbitRadius;
    s.ship.vx = 0;
    s.ship.vy = 0;
  });
  await page.waitForTimeout(400);
  const file = `scripts/screenshot-planets-${start.replace(/\s+/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log(`saved ${file}`);
}

for (const type of ['rocky', 'ice', 'lava', 'ocean', 'gas_giant']) {
  check(seenTypes.has(type), `body type "${type}" appeared in the captures`);
}
check(seenRings, 'at least one ringed body appeared');

await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — inspect the screenshots for surface/ring quality');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
