/**
 * verify-m6.ts — acceptance check for M6 "Visual Identity": station nodes in
 * the GL scene graph, NPC agents + projectiles rendered as GL nodes that
 * track the live encounter lists, gate markers tinted only for scannable
 * gates (§4.5), faction color reaching the HUD overlay, and a lit frame.
 *
 * Drives the REAL systems through the ?debug __sas hook, like verify-m2…m5 —
 * no faked state. Dev server must be running and reachable to
 * en.wikipedia.org:
 *     npx vite-node scripts/verify-m6.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const START = 'Saturn'; // reliably faction-aligned with a stationed body
const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

await page.goto(`${BASE}/?debug&start=${START}&goal=50`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, {
  timeout: 30000,
});

// === 1. WebGL pinned; the frame is actually lit ================================
const frame = await page.evaluate(() => {
  const s = (window as any).__sas;
  const { pixels } = s.extractPixels();
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
  }
  return { renderer: s.rendererName as string, litFrac: lit / (pixels.length / 4) };
});
check(frame.renderer === 'webgl', `renderer is webgl (${frame.renderer})`);
check(frame.litFrac > 0.05, `GL frame is lit (${(frame.litFrac * 100).toFixed(1)}% pixels)`);

// === 2. Station nodes live in the GL scene graph (Phase 1) =====================
const stations = await page.evaluate(() => {
  const s = (window as any).__sas;
  return {
    inSpec: s.spec.bodies.filter((b: any) => b.station).length as number,
    inScene: s.stationNodesNow() as number,
  };
});
check(
  stations.inScene === stations.inSpec && stations.inSpec >= 1,
  `station nodes track stationed bodies (${stations.inScene}/${stations.inSpec})`,
);

// === 3. GL agent nodes track the live agent list (Phase 4) =====================
const agents0 = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { live: s.agentsNow().length as number, gl: s.agentSpritesNow() as number };
});
check(agents0.gl === agents0.live, `GL agent nodes == live agents (${agents0.gl}/${agents0.live})`);

// Spawn a real hostile: the GL side must follow within a frame.
await page.evaluate(() => {
  const s = (window as any).__sas;
  s.run.hull = s.run.hullMax; // survive the exchange
  s.spawnHostileAhead(5);
});
await page.waitForTimeout(100);
const agents1 = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { live: s.agentsNow().length as number, gl: s.agentSpritesNow() as number };
});
check(
  agents1.gl === agents1.live && agents1.live === agents0.live + 1,
  `spawned hostile reaches the GL scene (${agents1.gl}/${agents1.live})`,
);

// === 4. Projectiles render as GL tracers while the fight is on =================
await page.keyboard.down('KeyF');
const sawShots = await page
  .waitForFunction(() => (window as any).__sas.projectilesNow().length > 0, undefined, {
    timeout: 5000,
  })
  .then(() => true)
  .catch(() => false);
check(sawShots, 'projectiles exist while firing (GL tracer pool feeds from this list)');

// Destroying the hostile must remove its GL node too.
const hostileGone = await page
  .waitForFunction(
    (n: number) => (window as any).__sas.agentsNow().length === n,
    agents0.live,
    { timeout: 8000 },
  )
  .then(() => true)
  .catch(() => false);
await page.keyboard.up('KeyF');
const agents2 = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { live: s.agentsNow().length as number, gl: s.agentSpritesNow() as number };
});
check(hostileGone, 'test hostile destroyed by player fire');
check(agents2.gl === agents2.live, `destroyed agent left the GL scene (${agents2.gl}/${agents2.live})`);

// === 5. Gate tints only ever name scannable gates (§4.5, Phase 5) ==============
await page.waitForTimeout(2000); // let destination lookups settle
const gateInfo = await page.evaluate(() => {
  const s = (window as any).__sas;
  const tints = s.gateTintsNow() as Record<string, string>;
  const uncharted = s.gates.filter((g: any) => g.kind === 'uncharted').map((g: any) => g.id);
  return { tinted: Object.keys(tints), uncharted, gateCount: s.gates.length as number };
});
check(
  gateInfo.tinted.every((id) => !gateInfo.uncharted.includes(id)),
  `no uncharted gate is tinted (${gateInfo.tinted.length}/${gateInfo.gateCount} gates tinted)`,
);

// === 6. Faction color reaches the HUD overlay (Phase 5) ========================
const hudColored = await page.evaluate(() => {
  const s = (window as any).__sas;
  if (!s.spec.faction) return null; // unaligned start: nothing to assert
  const overlay = document.querySelector('#overlay') as HTMLCanvasElement;
  const d = overlay.getContext('2d')!.getImageData(10, 105, 220, 40).data;
  // The faction line (emblem chip + tinted name) must include SATURATED
  // pixels — grayscale-only means the tint never landed.
  let saturated = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! === 0) continue;
    const mx = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
    const mn = Math.min(d[i]!, d[i + 1]!, d[i + 2]!);
    if (mx > 60 && mx - mn > 40) saturated++;
  }
  return saturated;
});
if (hudColored === null) console.log('skip HUD tint (start system is unaligned frontier)');
else check(hudColored > 20, `faction tint lands on the HUD overlay (${hudColored} saturated px)`);

await page.screenshot({ path: 'scripts/screenshot-m6-scene.png' });
await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — M6 Visual Identity verified end-to-end');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
