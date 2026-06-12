/**
 * market.ts — per-system trade pricing (§7: "credits from trading goods
 * between systems; pageview-derived prices create natural trade routes").
 *
 * DERIVED world data in the salvage.ts mold: pure, seeded functions of the
 * SystemSpec — never stored in the spec, so price tuning never churns the
 * golden files. No RunState import here (run.ts depends on this module for
 * the stranded check); transactions live in dock.ts.
 *
 * The route engine: every good gets a per-system price factor from the
 * system seed, then a tier tilt from traffic — busy (popular-article)
 * systems pay MORE for rares and LESS for commons. Hauling rares from
 * obscure systems to hubs, and commons back out, is profitable by
 * construction. Buy price == sell price: profit comes from geography, and a
 * same-station roundtrip is a guaranteed no-op.
 */

import { Rng, hash128 } from '../rng';
import { GOODS, goodById } from '../gen/goods';
import type { SystemSpec } from '../types';

/** Minimum distinct goods a station lists (padded with seeded extras). */
export const MARKET_MIN_GOODS = 4;

/** Local price factor in [0.7, 1.3), per good per system. */
function localFactor(spec: SystemSpec, goodId: string): number {
  const u = hash128(`${spec.seed}/price:${goodId}`)[0] / 0x1_0000_0000;
  return 0.7 + 0.6 * u;
}

/** Unit price of a good in this system. ≥ 1, deterministic. */
export function priceFor(spec: SystemSpec, goodId: string): number {
  const good = goodById(goodId);
  if (!good) return 1;
  const tilt =
    good.tier === 'rare'
      ? 0.85 + 0.3 * spec.traffic
      : good.tier === 'common'
        ? 1.15 - 0.3 * spec.traffic
        : 1;
  return Math.max(1, Math.round(good.basePrice * localFactor(spec, goodId) * tilt));
}

/**
 * Goods listed at this system's market: whatever its bodies supply (§6),
 * padded with seeded extras up to MARKET_MIN_GOODS so tiny markets still
 * have something on the board. Order is stable: bodies first, extras after.
 */
export function marketGoodIds(spec: SystemSpec): string[] {
  const ids: string[] = [];
  for (const body of spec.bodies) {
    for (const id of body.site.goodIds) if (!ids.includes(id)) ids.push(id);
  }
  const rng = new Rng(hash128(`${spec.seed}/market`));
  while (ids.length < MARKET_MIN_GOODS && ids.length < GOODS.length) {
    const extra = rng.pick(GOODS).id;
    if (!ids.includes(extra)) ids.push(extra);
  }
  return ids;
}

/** What the held cargo would liquidate for at this system's prices. */
export function cargoValue(cargo: Readonly<Record<string, number>>, spec: SystemSpec): number {
  return Object.entries(cargo).reduce((sum, [id, qty]) => sum + priceFor(spec, id) * qty, 0);
}
