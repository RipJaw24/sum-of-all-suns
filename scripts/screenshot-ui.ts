/**
 * screenshot-ui.ts — M6 Phase 5 visual check: faction-colored UI. Captures
 * the HUD corner (emblem chip + standing bar) and the Tab chart (faction
 * header, faction-colored station marker + emblem, destination-tinted gates).
 * Dev server must be running.
 * Run: npx vite-node scripts/screenshot-ui.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

await page.goto(`${BASE}/?debug&start=Saturn&goal=50`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, {
  timeout: 30000,
});
// Let the gate-destination faction lookups resolve (they ride the prefetch).
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const s = (window as any).__sas;
  return {
    faction: s.spec.faction?.id ?? null,
    contested: s.spec.faction?.contested ?? false,
    gates: s.gates.map((g: any) => ({ id: g.id, kind: g.kind, dest: g.destinationName })),
  };
});
console.log(JSON.stringify(info, null, 2));

await page.screenshot({
  path: 'scripts/screenshot-ui-hud.png',
  clip: { x: 0, y: 0, width: 340, height: 200 },
});
console.log('saved scripts/screenshot-ui-hud.png');

await page.keyboard.press('Tab');
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/screenshot-ui-chart.png' });
console.log('saved scripts/screenshot-ui-chart.png');

await browser.close();
