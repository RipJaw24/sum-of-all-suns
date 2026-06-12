/**
 * verify-m3.ts — acceptance check for M3 "texture": trade goods (buy/sell,
 * price divergence across systems), the [Q] lore scan panel, §4.5 anomaly
 * systems (one per outcome, via fixture snapshots injected into the article
 * cache so live wiki drift can't break the checks), and the PixiJS/nebula
 * renderer. Uses the ?debug __sas hook like verify-m2.
 * Dev server must be running. Run: npx vite-node scripts/verify-m3.ts
 */
import { chromium, type Page } from 'playwright';
import stubHazard from '../src/gen/fixtures/stub-hazard.json';
import stubSalvage from '../src/gen/fixtures/stub-salvage.json';
import stubSparse from '../src/gen/fixtures/stub-sparse.json';
import stubTunnel from '../src/gen/fixtures/stub-tunnel.json';

const failures: string[] = [];

function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));

async function gotoStart(title: string): Promise<void> {
  await page.goto(`http://localhost:5173/?debug&start=${encodeURIComponent(title)}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForFunction(() => (window as any).__sas?.spec !== undefined);
}

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
  await page.waitForTimeout(150);
}

/** Write an ArticleMetadata snapshot into the page's IndexedDB cache, so
 *  ?start=<title> resolves to the FIXTURE, not the live (drifting) article. */
async function injectSnapshot(targetPage: Page, meta: unknown): Promise<void> {
  await targetPage.evaluate(
    (snapshot) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('sum-of-all-suns', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('articles')) {
            req.result.createObjectStore('articles', { keyPath: 'title' });
          }
        };
        req.onsuccess = () => {
          const tx = req.result.transaction('articles', 'readwrite');
          tx.objectStore('articles').put(snapshot);
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    meta,
  );
}

// === 1. Trade at the Moon station ==============================================
await gotoStart('Moon');

const stationBodyId = await page.evaluate(
  () => (window as any).__sas.spec.bodies.find((b: any) => b.station)?.id ?? null,
);
check(stationBodyId !== null, `Moon system has a station body (${stationBodyId})`);

await teleportToBody(stationBodyId!, 25);
await page.keyboard.press('KeyE');
await page
  .waitForFunction(() => (window as any).__sas.mode === 'docked', undefined, { timeout: 5000 })
  .catch(() => failures.push('never entered docked mode'));
await page.keyboard.press('KeyT'); // services -> trade view
await page.waitForTimeout(200);
await page.screenshot({ path: 'scripts/screenshot-trade.png' });

const market = await page.evaluate(() => {
  const s = (window as any).__sas;
  return {
    goods: s.market as string[],
    firstPrice: s.priceFor(s.market[0]) as number,
    credits: s.run.credits as number,
  };
});
check(market.goods.length >= 4, `market lists ${market.goods.length} goods (≥4)`);

await page.keyboard.press('KeyB'); // buy 1 of goods[0] (cursor starts at 0)
await page.waitForTimeout(150);
const afterBuy = await page.evaluate(() => {
  const { run } = (window as any).__sas;
  return { credits: run.credits as number, cargo: { ...run.cargo } };
});
check(
  afterBuy.credits === market.credits - market.firstPrice,
  `buy: credits ${market.credits} -> ${afterBuy.credits} (price ${market.firstPrice})`,
);
check(afterBuy.cargo[market.goods[0]!] === 1, 'buy: 1 unit in the cargo hold');

await page.keyboard.press('KeyV'); // sell it back
await page.waitForTimeout(150);
const afterSell = await page.evaluate(() => (window as any).__sas.run.credits as number);
check(afterSell === market.credits, `sell: exact refund (${afterSell} cr) — same-station no-op`);

// Carry one unit out for the price-divergence check.
await page.keyboard.press('KeyB');
await page.waitForTimeout(150);
await page.keyboard.press('KeyE'); // undock
await page.waitForFunction(() => (window as any).__sas.mode === 'flying');

// === 2. Price divergence (the emergent-route engine) ===========================
const carriedGood = market.goods[0]!;
const moonPrice = market.firstPrice;
await gotoStart('Antarctica');
const antarcticaPrice = await page.evaluate(
  (id) => (window as any).__sas.priceFor(id) as number,
  carriedGood,
);
check(
  antarcticaPrice !== moonPrice,
  `"${carriedGood}" price differs across systems (${moonPrice} vs ${antarcticaPrice} cr)`,
);

// === 3. Lore scan panel ([Q]) ===================================================
const scanBodyId = await page.evaluate(
  () => (window as any).__sas.spec.bodies[0]?.id ?? null,
);
check(scanBodyId !== null, 'Antarctica system has a body to scan');
await teleportToBody(scanBodyId!, 20);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(200);
const site = await page.evaluate(() => {
  const s = (window as any).__sas;
  return {
    open: s.siteOpen as boolean,
    fragment: (s.siteFragment ?? '') as string,
    sourceTitle: s.spec.sourceTitle as string,
  };
});
check(site.open, '[Q] opened the scan panel');
check(site.fragment.length > 0 && site.fragment.length < 180, `lore fragment present (${site.fragment.length} chars)`);
const leaked = site.sourceTitle
  .toLowerCase()
  .split(/[\s()]+/)
  .filter((w) => w.length >= 4)
  .filter((w) => site.fragment.toLowerCase().includes(w));
check(leaked.length === 0, `lore fragment leaks no source-title word${leaked.length ? ` (${leaked.join(',')})` : ''}`);
await page.screenshot({ path: 'scripts/screenshot-site.png' });

// === 4. Anomaly systems (§4.5) — fixture snapshots injected into the cache =====
const ANOMALIES = [
  { meta: stubSparse, kind: 'sparse' },
  { meta: stubSalvage, kind: 'salvage_field' },
  { meta: stubHazard, kind: 'hazard_pocket' },
  { meta: stubTunnel, kind: 'deep_tunnel' },
] as const;

for (const { meta, kind } of ANOMALIES) {
  await injectSnapshot(page, meta);
  await gotoStart(meta.title);
  const spec = await page.evaluate(() => {
    const s = (window as any).__sas;
    return {
      kind: s.spec.kind as string,
      source: s.source as string,
      gateKinds: s.spec.gates.map((g: any) => g.kind) as string[],
      bodyCount: s.spec.bodies.length as number,
      hazard: s.spec.ambient.hazard as string | undefined,
      hull: s.run.hull as number,
      richness: s.spec.salvageRichness as number | undefined,
      hasStation: s.spec.bodies.some((b: any) => b.station) as boolean,
    };
  });
  check(spec.source === 'cache', `"${meta.title}" served from the injected snapshot`);
  check(spec.kind === kind, `"${meta.title}" -> ${spec.kind} (expected ${kind})`);
  check(!spec.hasStation, `${kind}: no station (wild space)`);

  if (kind === 'sparse') {
    check(spec.bodyCount <= 2 && spec.gateKinds.length <= 3, `sparse: ${spec.bodyCount} bodies, ${spec.gateKinds.length} gates`);
  }
  if (kind === 'salvage_field') {
    check((spec.richness ?? 0) >= 0.2 && (spec.richness ?? 0) <= 1, `salvage richness ${spec.richness}`);
    const salvaged = await page.evaluate(async () => {
      const s = (window as any).__sas;
      const derelicts = s.derelictsNow();
      if (derelicts.length === 0) return null;
      const d = derelicts[0];
      s.run.fuel = 10;
      s.ship.x = d.x + 20;
      s.ship.y = d.y;
      s.ship.vx = 0;
      s.ship.vy = 0;
      return { count: derelicts.length, fuelBefore: 10, dFuel: d.fuel };
    });
    check(salvaged !== null, `salvage field has ${salvaged?.count ?? 0} derelicts`);
    if (salvaged) {
      await page.waitForTimeout(200);
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(200);
      const fuelAfter = await page.evaluate(() => (window as any).__sas.run.fuel as number);
      check(
        fuelAfter === Math.min(100, salvaged.fuelBefore + salvaged.dFuel),
        `salvage looted: fuel 10 -> ${fuelAfter} (+${salvaged.dFuel})`,
      );
    }
  }
  if (kind === 'hazard_pocket') {
    check(spec.hazard === 'storm' || spec.hazard === 'radiation', `hazard pocket ambient: ${spec.hazard}`);
    check(spec.hull < 100, `entry damage applied (hull ${spec.hull})`);
    // The deposit body: mine it into the cargo hold.
    const deposit = await page.evaluate(() => {
      const s = (window as any).__sas;
      const body = s.spec.bodies.find((b: any) => b.site.goodIds.length > 0);
      return body ? { id: body.id, goodId: body.site.goodIds[0] } : null;
    });
    check(deposit !== null, 'hazard pocket has a rare-good deposit body');
    if (deposit) {
      await teleportToBody(deposit.id, 25);
      await page.keyboard.press('KeyE');
      await page.waitForTimeout(200);
      const held = await page.evaluate(
        (id) => ((window as any).__sas.run.cargo[id] ?? 0) as number,
        deposit.goodId,
      );
      check(held >= 3, `deposit mined into cargo (${held} × ${deposit.goodId})`);
    }
  }
  if (kind === 'deep_tunnel') {
    check(
      spec.gateKinds.length > 0 && spec.gateKinds.every((k) => k === 'uncharted'),
      `deep tunnel: all ${spec.gateKinds.length} gates uncharted`,
    );
  }
}

// === 5. PixiJS renderer + nebula ================================================
await gotoStart('Photosynthesis');
const gl = await page.evaluate(() => {
  const s = (window as any).__sas;
  const { pixels } = s.extractPixels();
  let off = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    // Background clear is #04050a; count pixels that differ noticeably.
    if (Math.abs(pixels[i] - 4) + Math.abs(pixels[i + 1] - 5) + Math.abs(pixels[i + 2] - 10) > 12) off++;
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return {
    renderer: s.rendererName as string,
    offFraction: off / n,
    mean: [r / n, g / n, b / n] as [number, number, number],
  };
});
check(gl.renderer === 'webgl', `renderer is ${gl.renderer}`);
check(gl.offFraction > 0.1, `nebula present: ${(gl.offFraction * 100).toFixed(1)}% of pixels off-background`);

await gotoStart('Whale');
const glWhale = await page.evaluate(() => {
  const s = (window as any).__sas;
  const { pixels } = s.extractPixels();
  let r = 0;
  let g = 0;
  let b = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  return { mean: [r / n, g / n, b / n] as [number, number, number] };
});
const tintDelta =
  Math.abs(gl.mean[0] - glWhale.mean[0]) +
  Math.abs(gl.mean[1] - glWhale.mean[1]) +
  Math.abs(gl.mean[2] - glWhale.mean[2]);
check(tintDelta > 0.5, `palette tint differs across systems (Δmean ${tintDelta.toFixed(2)})`);

await browser.close();

if (failures.length === 0) {
  console.log('\nPASS — M3 texture layer verified end-to-end');
} else {
  console.error(`\nFAIL — ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
