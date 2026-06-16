/**
 * screenshot-station.ts — M6 Phase 1 visual check: frame a faction-styled
 * station. Boots a few candidate starts until one has a body with a station,
 * then parks the camera on it (via the __sas debug ship + clock hooks) and
 * shoots. Dev server must be running.
 * Run: npx vite-node scripts/screenshot-station.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const CANDIDATES = ['Saturn', 'Photosynthesis', 'Iceland', 'France', 'Jupiter'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

let framed: { start: string; body: string; faction: string | null; habitation: string } | null = null;

for (const start of CANDIDATES) {
  await page.goto(`${BASE}/?debug&start=${start}&goal=50`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, { timeout: 30000 });

  const info = await page.evaluate(() => {
    const s = (window as any).__sas;
    const body = s.spec.bodies.find((b: any) => b.station);
    if (!body) return null;
    return {
      bodyId: body.id,
      faction: s.spec.faction ? s.spec.faction.id : null,
      contested: s.spec.faction?.contested ?? false,
      habitation: s.spec.habitation as string,
    };
  });
  if (!info) {
    console.log(`- ${start}: no station body, trying next`);
    continue;
  }

  // Park the camera on the station: track the orbiting body for ~0.7s using
  // the live clock so the body sits just left of center with its station beside it.
  for (let i = 0; i < 45; i++) {
    await page.evaluate((bodyId) => {
      const s = (window as any).__sas;
      const body = s.spec.bodies.find((b: any) => b.id === bodyId);
      const t = s.clock();
      const ang = body.initialAngle + ((Math.PI * 2) / body.orbitPeriodSec) * t;
      const bx = Math.cos(ang) * body.orbitRadius;
      const by = Math.sin(ang) * body.orbitRadius;
      s.ship.x = bx + body.radius + 30;
      s.ship.y = by;
      s.ship.vx = 0;
      s.ship.vy = 0;
    }, info.bodyId);
    await page.waitForTimeout(16);
  }

  framed = { start, body: info.bodyId, faction: info.faction, habitation: info.habitation };
  console.log(
    `framed ${start}: body ${info.bodyId}, faction ${info.faction ?? 'unaligned'}` +
      `${info.contested ? ' (contested)' : ''}, habitation ${info.habitation}`,
  );
  break;
}

if (!framed) console.log('no station found in any candidate start');
await page.screenshot({ path: 'scripts/screenshot-station.png' });
await browser.close();
console.log('saved scripts/screenshot-station.png');
