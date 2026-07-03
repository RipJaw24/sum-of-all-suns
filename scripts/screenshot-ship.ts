/**
 * screenshot-ship.ts — M6 Phase 3 visual check: the player ship close up.
 * Three clips around screen center: idle hull, thrust held (engine plume),
 * and shield shimmer right after a real hostile hit (via spawnHostileAhead).
 * Dev server must be running.
 * Run: npx vite-node scripts/screenshot-ship.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const CLIP = { x: 1280 / 2 - 120, y: 800 / 2 - 120, width: 240, height: 240 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

await page.goto(`${BASE}/?debug&start=Saturn&goal=50`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, {
  timeout: 30000,
});

// Park the ship (kill any drift so the clips stay centered).
const still = () =>
  page.evaluate(() => {
    const s = (window as any).__sas;
    s.ship.vx = 0;
    s.ship.vy = 0;
  });

await still();
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/screenshot-ship-idle.png', clip: CLIP });
console.log('saved scripts/screenshot-ship-idle.png');

// Hold main thrust; keep re-zeroing velocity so the ship stays in frame while
// the plume ramps and flickers.
await page.keyboard.down('w');
for (let i = 0; i < 40; i++) {
  await still();
  await page.waitForTimeout(16);
}
await page.screenshot({ path: 'scripts/screenshot-ship-thrust.png', clip: CLIP });
await page.keyboard.up('w');
console.log('saved scripts/screenshot-ship-thrust.png');

// Shield shimmer: spawn a real hostile dead ahead and wait for its shot to
// land (real combat path), then shoot the clip while damageFlash is fresh.
const hullBefore = await page.evaluate(() => {
  const s = (window as any).__sas;
  s.spawnHostileAhead(9999);
  return s.run.hull as number;
});
await page.waitForFunction(
  (before) => {
    const s = (window as any).__sas;
    s.ship.vx = 0;
    s.ship.vy = 0;
    return s.run.hull < before;
  },
  hullBefore,
  { timeout: 15000 },
);
await page.screenshot({ path: 'scripts/screenshot-ship-shield.png', clip: CLIP });
console.log('saved scripts/screenshot-ship-shield.png');

await browser.close();
