/**
 * verify-jump.ts — autopilot acceptance check for the M1 deliverable:
 * fly to a gate, jump, confirm the system actually changed and fuel was
 * spent; then reload with Wikimedia blocked and confirm the snapshot cache
 * serves the system fully offline (SPEC §8 / Decision 4).
 * Dev server must be running. Run: npx vite-node scripts/verify-jump.ts
 */
import { chromium } from 'playwright';

const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

await page.goto('http://localhost:5173/?debug', { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined);

const before = await page.evaluate(() => {
  const { spec, run } = (window as any).__sas;
  return { title: spec.sourceTitle, fuel: run.fuel };
});

// Autopilot: aim mouse at the nearest gate; brake when velocity points away
// from the target (prevents endless orbiting), otherwise track a desired
// speed that shrinks with distance.
interface Nav {
  dx: number;
  dy: number;
  dist: number;
  vx: number;
  vy: number;
  speed: number;
}

async function nav(): Promise<Nav> {
  return page.evaluate(() => {
    const { gates, ship } = (window as any).__sas;
    let best: any = null;
    let bestD = Infinity;
    for (const g of gates) {
      const gx = Math.cos(g.angle) * g.rimRadius;
      const gy = Math.sin(g.angle) * g.rimRadius;
      const d = Math.hypot(gx - ship.x, gy - ship.y);
      if (d < bestD) {
        bestD = d;
        best = { gx, gy };
      }
    }
    return {
      dx: best.gx - ship.x,
      dy: best.gy - ship.y,
      dist: bestD,
      vx: ship.vx,
      vy: ship.vy,
      speed: Math.hypot(ship.vx, ship.vy),
    };
  });
}

const deadline = Date.now() + 60_000;
let arrived = false;
while (Date.now() < deadline) {
  const n = await nav();
  if (n.dist < 55) {
    arrived = true;
    break;
  }
  const len = Math.hypot(n.dx, n.dy) || 1;
  await page.mouse.move(640 + (n.dx / len) * 300, 400 + (n.dy / len) * 300);
  const desired = Math.min(300, Math.max(30, n.dist / 2.5));
  // cos of the angle between velocity and the to-target direction.
  const align = n.speed > 1 ? (n.dx * n.vx + n.dy * n.vy) / (len * n.speed) : 1;
  if (n.speed > 50 && align < 0.7) {
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
  } else if (n.speed < desired - 15) {
    await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyW');
  } else if (n.speed > desired + 15) {
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
  } else {
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyS');
  }
  await page.waitForTimeout(60);
}
await page.keyboard.up('KeyW');
await page.keyboard.up('KeyS');
check(arrived, 'autopilot reached a gate');

// Jump and wait for the system swap.
await page.keyboard.press('KeyE');
await page
  .waitForFunction(
    (t) => (window as any).__sas.spec.sourceTitle !== t && (window as any).__sas.run.previousTitle === t,
    before.title,
    { timeout: 20_000 },
  )
  .catch(() => failures.push('system never changed after pressing E'));

const after = await page.evaluate(() => {
  const { spec, run, gates } = (window as any).__sas;
  return {
    title: spec.sourceTitle,
    fuel: run.fuel,
    route: run.route.length,
    hasReturnGate: gates.some((g: any) => g.destinationTitle === run.previousTitle),
  };
});
check(after.title !== before.title, `jumped: "${before.title}" -> "${after.title}"`);
check(after.fuel < before.fuel, `fuel spent: ${before.fuel} -> ${after.fuel}`);
check(after.route === 2, 'route log has start + 1 jump');
check(after.hasReturnGate, 'a gate leads back to the origin (§4.2)');

// Toggle the system chart and screenshot it (after the jump fade settles —
// the chart is suppressed mid-transition).
await page.waitForFunction(() => (window as any).__sas.jumping === false);
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/screenshot-map.png' });
await page.keyboard.press('Tab');

// Offline proof: block all Wikimedia traffic, reload, expect the saved run
// to resume in the same system served from the IndexedDB snapshot.
await page.route(/wikipedia\.org|wikimedia\.org/, (route) => route.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, {
  timeout: 15_000,
});
const offline = await page.evaluate(() => {
  const { spec, source, run } = (window as any).__sas;
  return { title: spec.sourceTitle, source, fuel: run.fuel };
});
check(offline.title === after.title, `offline reload resumed in "${offline.title}"`);
check(offline.source === 'cache', `system served from snapshot cache (source=${offline.source})`);
check(offline.fuel === after.fuel, 'run state (fuel) survived the reload');

await page.screenshot({ path: 'scripts/screenshot-jump.png' });
await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — M1 graph walk verified end-to-end');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
