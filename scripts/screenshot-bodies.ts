/**
 * screenshot-bodies.ts — M6 Phase 2 visual check: frame an inhabited, life-
 * bearing world to inspect biome surface tint, the atmospheric limb glow, and
 * night-side city lights. Picks a candidate start that's settled/teeming with a
 * non-gas body, parks the camera on it via the __sas debug hooks, and shoots.
 * Run: npx vite-node scripts/screenshot-bodies.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const CANDIDATES = ['Tokyo', 'France', 'Brazil', 'Iceland', 'Photosynthesis', 'Saturn'];
const LIVING = new Set(['settled', 'teeming']);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

interface Pick {
  start: string;
  bodyId: string;
  radius: number;
  type: string;
  biome: string;
  habitation: string;
  screenX: number;
}

let chosen: Pick | null = null;
let fallback: Pick | null = null;

for (const start of CANDIDATES) {
  await page.goto(`${BASE}/?debug&start=${start}&goal=50`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, { timeout: 30000 });

  const info = await page.evaluate(() => {
    const s = (window as any).__sas;
    const nonGas = s.spec.bodies
      .filter((b: any) => b.type === 'rocky' || b.type === 'ice' || b.type === 'ocean')
      .sort((a: any, b: any) => b.radius - a.radius);
    return {
      biome: s.spec.biome as string,
      habitation: s.spec.habitation as string,
      body: nonGas[0] ? { id: nonGas[0].id, radius: nonGas[0].radius, type: nonGas[0].type } : null,
    };
  });
  if (!info.body) {
    console.log(`- ${start}: no non-gas body`);
    continue;
  }
  const pick: Pick = {
    start,
    bodyId: info.body.id,
    radius: info.body.radius,
    type: info.body.type,
    biome: info.biome,
    habitation: info.habitation,
    screenX: 640 - (info.body.radius + 45),
  };
  fallback ??= pick;
  console.log(`- ${start}: ${info.habitation}/${info.biome}, biggest non-gas ${info.body.type} r=${info.body.radius}`);
  if (LIVING.has(info.habitation) && info.biome !== 'barren') {
    chosen = pick;
    break;
  }
}

const target = chosen ?? fallback;
if (!target) {
  console.log('no usable body found');
  await browser.close();
  process.exit(1);
}

// Re-boot the chosen start and park the camera just right of the body.
await page.goto(`${BASE}/?debug&start=${target.start}&goal=50`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, { timeout: 30000 });
for (let i = 0; i < 45; i++) {
  await page.evaluate(({ bodyId, radius }) => {
    const s = (window as any).__sas;
    const body = s.spec.bodies.find((b: any) => b.id === bodyId);
    const t = s.clock();
    const ang = body.initialAngle + ((Math.PI * 2) / body.orbitPeriodSec) * t;
    s.ship.x = Math.cos(ang) * body.orbitRadius + radius + 45;
    s.ship.y = Math.sin(ang) * body.orbitRadius;
    s.ship.vx = 0;
    s.ship.vy = 0;
  }, { bodyId: target.bodyId, radius: target.radius });
  await page.waitForTimeout(16);
}

await page.screenshot({ path: 'scripts/screenshot-bodies.png' });
await browser.close();
console.log(
  `framed ${target.start}: ${target.type} body ${target.bodyId} (r=${target.radius}), ` +
    `${target.habitation}/${target.biome}, screen-center x≈${Math.round(target.screenX)}` +
    `${chosen ? '' : ' [fallback — not living, lights may be absent]'}`,
);
console.log('saved scripts/screenshot-bodies.png');
