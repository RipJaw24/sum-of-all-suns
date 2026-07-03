/**
 * screenshot-npcs.ts — M6 Phase 4 visual check: NPC agents + projectiles in
 * the GL scene. Finds a start with live agents, parks the camera next to one
 * for a close-up, then spawns a hostile and exchanges fire for a tracer shot.
 * Also asserts the GL agent-node count tracks the live agent list.
 * Dev server must be running.
 * Run: npx vite-node scripts/screenshot-npcs.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const CANDIDATES = ['Saturn', 'Tokyo', 'Photosynthesis', 'France', 'Jupiter'];
const CLIP = { x: 1280 / 2 - 160, y: 800 / 2 - 160, width: 320, height: 320 };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

let found = false;
for (const start of CANDIDATES) {
  await page.goto(`${BASE}/?debug&start=${start}&goal=50`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__sas?.spec !== undefined, undefined, {
    timeout: 30000,
  });
  const info = await page.evaluate(() => {
    const s = (window as any).__sas;
    return {
      agents: s.agentsNow().map((a: any) => ({ id: a.id, type: a.type, faction: a.faction })),
      glNodes: s.agentSpritesNow() as number,
    };
  });
  console.log(
    `- ${start}: ${info.agents.length} agents (${info.agents.map((a: any) => a.type).join(', ') || 'none'}), ${info.glNodes} GL nodes`,
  );
  if (info.glNodes !== info.agents.length) {
    throw new Error(`GL node count ${info.glNodes} != live agents ${info.agents.length}`);
  }
  if (info.agents.length >= 2) {
    found = true;
    break;
  }
}
if (!found) throw new Error('no candidate start with 2+ agents');

// Close-up: chase the nearest agent for a moment so its trail is lit.
for (let i = 0; i < 50; i++) {
  await page.evaluate(() => {
    const s = (window as any).__sas;
    const agents = s.agentsNow();
    let best = agents[0];
    for (const a of agents) {
      if (Math.hypot(a.x - s.ship.x, a.y - s.ship.y) < Math.hypot(best.x - s.ship.x, best.y - s.ship.y))
        best = a;
    }
    s.ship.x = best.x - 60;
    s.ship.y = best.y + 40;
    s.ship.vx = 0;
    s.ship.vy = 0;
  });
  await page.waitForTimeout(16);
}
await page.screenshot({ path: 'scripts/screenshot-npc-closeup.png', clip: CLIP });
console.log('saved scripts/screenshot-npc-closeup.png');

// Combat: hostile at tracer distance (spawnHostileAhead parks it point-blank
// where shots land within a frame — push it out so tracers fly visibly),
// player aimed at it via the mouse, both firing across the clip.
// Top up hull first — repeated script runs erode the saved run and a death
// beat would freeze the encounter sim.
await page.evaluate(() => {
  const s = (window as any).__sas;
  s.run.hull = s.run.hullMax;
  s.ship.vx = 0;
  s.ship.vy = 0;
  const hostile = s.spawnHostileAhead(9999);
  hostile.x = s.ship.x + 180;
  hostile.y = s.ship.y;
});
await page.mouse.move(1280 / 2 + 180, 800 / 2); // face the hostile
await page.keyboard.down('f');
await page.waitForFunction(
  () => {
    const s = (window as any).__sas;
    s.ship.vx = 0;
    s.ship.vy = 0;
    return s.projectilesNow().length >= 2;
  },
  undefined,
  { timeout: 15000 },
);
await page.screenshot({
  path: 'scripts/screenshot-npc-combat.png',
  clip: { x: 1280 / 2 - 120, y: 800 / 2 - 200, width: 400, height: 400 },
});
await page.keyboard.up('f');
console.log('saved scripts/screenshot-npc-combat.png');

// Structural: kill the hostile off (debug list splice is out of bounds here —
// jump-free check instead: node count still tracks the live list).
const counts = await page.evaluate(() => {
  const s = (window as any).__sas;
  return { agents: s.agentsNow().length, glNodes: s.agentSpritesNow() as number };
});
if (counts.glNodes !== counts.agents) {
  throw new Error(`after combat: GL node count ${counts.glNodes} != live agents ${counts.agents}`);
}
console.log(`GL agent nodes track live agents (${counts.agents})`);

await browser.close();
