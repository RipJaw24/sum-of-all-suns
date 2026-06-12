/**
 * verify-m2.ts — acceptance check for the M2 roguelike skeleton: hull and
 * credits live, docking + refuel works, mining is one-time, belt hazards
 * damage hull, death lands on the run summary, the Decrypt Flight Log
 * reveals true article titles, and [N] starts a fresh run from the curated
 * pool. Uses the ?debug __sas hook to teleport the ship between checkpoints.
 * Dev server must be running. Run: npx vite-node scripts/verify-m2.ts
 */
import { chromium } from 'playwright';

const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

// Fresh run from an article that guarantees the M2 fixtures: 'Moon' has an
// infobox (-> station) and hundreds of references (-> asteroid belt).
const START = 'Moon';
await page.goto(`http://localhost:5173/?debug&start=${START}`, {
  waitUntil: 'networkidle',
});
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined);

const start = await page.evaluate(() => {
  const { run } = (window as any).__sas;
  return { hull: run.hull, credits: run.credits, fuel: run.fuel, route: run.route.length };
});
check(start.hull === 100, `fresh run: hull ${start.hull}/100`);
check(start.credits === 60, `fresh run: ${start.credits} starting credits`);
check(start.route === 1, 'fresh run: route has only the start system');

/** Park the ship next to a body (by id), zero velocity. */
async function teleportToBody(bodyId: string, pad: number): Promise<void> {
  await page.evaluate(
    ([id, off]) => {
      const { spec, ship, t } = (window as any).__sas;
      const body = spec.bodies.find((b: any) => b.id === id);
      const angle = body.initialAngle + ((Math.PI * 2) / body.orbitPeriodSec) * t;
      ship.x = Math.cos(angle) * body.orbitRadius + body.radius + (off as number);
      ship.y = Math.sin(angle) * body.orbitRadius;
      ship.vx = 0;
      ship.vy = 0;
    },
    [bodyId, pad] as const,
  );
  await page.waitForTimeout(150); // let a frame recompute the interact target
}

// The LIVE article's metadata can drift from the test fixtures (snapshot is
// per-player, §3 / Decision 4), so derive all targets from the live spec.
const layout = await page.evaluate(() => {
  const { spec } = (window as any).__sas;
  const stationBody = spec.bodies.find((b: any) => b.station);
  const miningBody = spec.bodies.find((b: any) => b.site.resource === 'mining' && !b.station);
  return {
    stationBodyId: stationBody?.id ?? null,
    priceLevel: stationBody?.station.priceLevel ?? 0,
    miningBodyId: miningBody?.id ?? null,
    beltMid: spec.belt ? (spec.belt.innerRadius + spec.belt.outerRadius) / 2 : null,
  };
});
check(layout.stationBodyId !== null, `live system has a station (${layout.stationBodyId})`);
check(layout.miningBodyId !== null, `live system has a mining body (${layout.miningBodyId})`);
check(layout.beltMid !== null, 'live system has an asteroid belt');

// --- docking + refuel ---------------------------------------------------------
await page.evaluate(() => ((window as any).__sas.run.fuel = 40));
await teleportToBody(layout.stationBodyId!, 25);
await page.keyboard.press('KeyE');
await page
  .waitForFunction(() => (window as any).__sas.mode === 'docked', undefined, { timeout: 5000 })
  .catch(() => failures.push('never entered docked mode'));
await page.screenshot({ path: 'scripts/screenshot-dock.png' });

await page.keyboard.press('KeyR');
await page.waitForTimeout(150);
const afterRefuel = await page.evaluate(() => {
  const { run } = (window as any).__sas;
  return { fuel: run.fuel, credits: run.credits };
});
const expectedCost = Math.ceil(10 * Math.max(1, Math.round(1 + layout.priceLevel * 2)));
check(afterRefuel.fuel === 50, `refuel: 40 -> ${afterRefuel.fuel} fuel`);
check(
  afterRefuel.credits === 60 - expectedCost,
  `refuel: 60 -> ${afterRefuel.credits} cr (10 fuel, expected -${expectedCost})`,
);

await page.keyboard.press('KeyE'); // undock
await page.waitForFunction(() => (window as any).__sas.mode === 'flying');

// --- mining is one-time per body ---------------------------------------------
await teleportToBody(layout.miningBodyId!, 30);
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
const mined = await page.evaluate(() => (window as any).__sas.run.credits);
check(mined > afterRefuel.credits, `mining paid out: ${afterRefuel.credits} -> ${mined} cr`);
await page.keyboard.press('KeyE');
await page.waitForTimeout(150);
const minedAgain = await page.evaluate(() => (window as any).__sas.run.credits);
check(minedAgain === mined, 'mining the same body twice pays nothing');

// --- belt hazard -> hull damage -> death -> summary ---------------------------
// Pad the route log so the summary exercises the multi-node constellation
// (real jumps are M1-verified; this is about the decrypt rendering).
await page.evaluate(() => {
  const { run } = (window as any).__sas;
  run.route.push(
    { title: 'Apollo 11', via: 'charted' },
    { title: 'Tide', via: 'uncharted' },
    { title: 'Lighthouse', via: 'wormhole' },
  );
});
await page.evaluate((beltMid) => {
  const { ship, run } = (window as any).__sas;
  run.hull = 3; // belt base dps is 2+: dead within seconds
  ship.x = beltMid as number;
  ship.y = 5;
  ship.vx = 0;
  ship.vy = 0;
}, layout.beltMid);
await page
  .waitForFunction(() => (window as any).__sas.mode === 'summary', undefined, { timeout: 15_000 })
  .catch(() => failures.push('belt damage never killed the run'));
const death = await page.evaluate(() => {
  const { run } = (window as any).__sas;
  return { status: run.status, cause: run.deathCause, hull: run.hull };
});
check(death.status === 'dead' && death.cause === 'hull', `death by hull breach (hull=${death.hull})`);
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/screenshot-summary.png' });

// --- Decrypt Flight Log --------------------------------------------------------
// Encrypted export first: must NOT leak the article title (§3.3 laundering).
await page.keyboard.press('KeyC');
await page.waitForTimeout(300);
const encrypted = await page.evaluate(() => navigator.clipboard.readText());
check(!encrypted.includes(START), 'encrypted log hides the article title');
check(encrypted.includes('FLIGHT LOG'), 'encrypted log copied to clipboard');

await page.keyboard.press('KeyD');
await page.waitForTimeout(2500); // decode animation
await page.screenshot({ path: 'scripts/screenshot-decrypt.png' });
await page.keyboard.press('KeyC');
await page.waitForTimeout(300);
const decrypted = await page.evaluate(() => navigator.clipboard.readText());
check(decrypted.includes('[DECRYPTED]'), 'decrypted log is marked as such');
check(
  decrypted.includes(START),
  'decrypted log reveals the true article title (§7 payoff)',
);

// --- new run from the curated pool --------------------------------------------
await page.keyboard.press('KeyN');
await page
  .waitForFunction(
    () => {
      const s = (window as any).__sas;
      return s.mode === 'flying' && s.run.status === 'active' && s.run.route.length === 1;
    },
    undefined,
    { timeout: 30_000 }, // fresh article fetch over the network
  )
  .catch(() => failures.push('[N] never started a new run'));
const fresh = await page.evaluate(() => {
  const { run } = (window as any).__sas;
  return { title: run.currentTitle, hull: run.hull, credits: run.credits };
});
check(fresh.hull === 100 && fresh.credits === 60, 'new run resets hull and credits');
check(fresh.title.length > 0, `new run started in pool article "${fresh.title}"`);

await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — M2 roguelike skeleton verified end-to-end');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
