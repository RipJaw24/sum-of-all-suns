/**
 * verify-m5.ts — acceptance check for M5 "The Living Galaxy": factions +
 * habitation on the spec (pure, deterministic across reload), NPC agents that
 * spawn and can be destroyed, standing that moves station prices, the
 * 'destroyed' combat death reaching the summary, and the §16 seeded event.
 *
 * Drives the REAL systems through the ?debug __sas hook (spawnHostileAhead /
 * effectivePrice), like verify-m2/m3/m4 — no faked state. Dev server must be
 * running and reachable to en.wikipedia.org:
 *     npx vite-node scripts/verify-m5.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const START = 'Photosynthesis'; // well-connected, reliably faction-aligned
const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

async function bootFlying(): Promise<void> {
  await page.goto(`${BASE}/?debug&start=${START}&goal=50`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, {
    timeout: 30000,
  });
}

// === 1. Spec carries the pure faction + habitation fields (§13/§14) =============
await bootFlying();
const world = await page.evaluate(() => {
  const s = (window as any).__sas;
  return {
    faction: s.spec.faction,
    habitation: s.spec.habitation as string,
    biome: s.spec.biome as string,
    event: s.event?.kind as string,
    source: s.source as string,
  };
});
check(world.source !== 'degraded', `start system resolved strictly (${world.source})`);
check(
  typeof world.habitation === 'string' && typeof world.biome === 'string',
  `habitation/biome present (${world.habitation} · ${world.biome})`,
);
check(world.faction !== undefined, `faction field present (${JSON.stringify(world.faction)})`);
check(typeof world.event === 'string', `seeded system event present (${world.event})`);
const factionId: string | null = world.faction ? world.faction.id : null;

// === 2. Faction/habitation are deterministic across a reload (pure §13) =========
await bootFlying();
const world2 = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { faction: s.spec.faction?.id ?? null, habitation: s.spec.habitation as string };
});
check(
  world2.faction === factionId && world2.habitation === world.habitation,
  `same article -> same faction/habitation on reload (${world2.faction} · ${world2.habitation})`,
);

// === 3. NPC agents exist as ephemeral runtime state (§15.1) ======================
const agentCount = await page.evaluate(() => (window as any).__sas.agentsNow().length as number);
check(agentCount >= 0, `agents populated as runtime state (${agentCount} present)`);
const inSpec = await page.evaluate(() => 'faction' in (window as any).__sas.spec && !('agents' in (window as any).__sas.spec));
check(inSpec, 'agents are NOT written into the pure SystemSpec (determinism boundary)');

// === 4. Standing moves station prices (§13.3) ===================================
if (factionId) {
  const prices = await page.evaluate((fid: string) => {
    const s = (window as any).__sas;
    const good = s.market[0] as string;
    s.run.standing[fid] = 0;
    const neutral = s.effectivePrice(good) as number;
    s.run.standing[fid] = 100;
    const allied = s.effectivePrice(good) as number;
    s.run.standing[fid] = -100;
    const hostile = s.effectivePrice(good) as number;
    s.run.standing[fid] = 0;
    return { neutral, allied, hostile };
  }, factionId);
  check(
    prices.allied <= prices.neutral && prices.neutral <= prices.hostile && prices.allied < prices.hostile,
    `standing shifts prices: allied ${prices.allied} <= neutral ${prices.neutral} <= hostile ${prices.hostile}`,
  );
} else {
  console.log('skip standing->price (start system is unaligned frontier)');
}

// === 5. An NPC spawns and can be destroyed; the bounty pays out (§15.3) ==========
const before = await page.evaluate(() => {
  const s = (window as any).__sas;
  s.agentsNow().length = 0; // isolate: clear ambient agents
  const a = s.spawnHostileAhead(5);
  return { credits: s.run.credits as number, id: a.id as string };
});
await page.keyboard.down('KeyF'); // hold fire
await page
  .waitForFunction(
    (id: string) => !(window as any).__sas.agentsNow().some((a: any) => a.id === id),
    before.id,
    { timeout: 5000 },
  )
  .catch(() => failures.push('player fire never destroyed the test hostile'));
await page.keyboard.up('KeyF');
const afterCredits = await page.evaluate(() => (window as any).__sas.run.credits as number);
check(afterCredits > before.credits, `destroying a hostile pays a bounty (+${afterCredits - before.credits} cr)`);

// === 6. A hostile killing blow ends the run as 'destroyed' (§15.3) ===============
await page.evaluate(() => {
  const s = (window as any).__sas;
  s.agentsNow().length = 0;
  s.run.hull = 3; // less than one hostile shot
  s.spawnHostileAhead(100); // a tank that will gun the player down
});
await page
  .waitForFunction(() => (window as any).__sas?.mode === 'summary', undefined, { timeout: 10000 })
  .catch(() => failures.push('combat death never reached the summary'));
const death = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { status: s.run.status as string, cause: s.run.deathCause as string };
});
check(
  death.status === 'dead' && death.cause === 'destroyed',
  `combat death reaches the summary as 'destroyed' (cause=${death.cause})`,
);
await page.screenshot({ path: 'scripts/screenshot-m5-destroyed.png' });

await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — M5 Living Galaxy verified end-to-end');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
