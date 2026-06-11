/**
 * screenshot.ts — capture the running game for visual inspection (SPEC §9:
 * the agent "can see the game"). Dev server must be running.
 * Run: npx vite-node scripts/screenshot.ts [-- url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/?debug';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleLines: string[] = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
// Hold W for a moment so the ship visibly moves/rotates before the shot.
await page.mouse.move(900, 250);
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
await page.screenshot({ path: 'scripts/screenshot.png' });
await browser.close();

console.log('saved scripts/screenshot.png');
console.log('--- page console ---');
for (const line of consoleLines) console.log(line);
