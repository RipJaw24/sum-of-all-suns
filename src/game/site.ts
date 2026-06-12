/**
 * site.ts — the [Q] scan panel (SPEC §6 site screen, minimal form): body
 * name, type line, and the lore fragment. Read-only overlay in the dock.ts
 * style; main.ts owns the toggle and proximity rules.
 */

import { loreFragment } from '../gen/lore';
import type { BodySpec, SystemSpec } from '../types';

const TYPE_LABEL: Record<BodySpec['type'], string> = {
  rocky: 'ROCKY WORLD',
  ice: 'ICE WORLD',
  gas_giant: 'GAS GIANT',
  lava: 'LAVA WORLD',
  ocean: 'OCEAN WORLD',
};

/** The fragment shown for a body — exported for tests / verify scripts. */
export function siteFragment(body: BodySpec, spec: SystemSpec): string {
  return loreFragment({
    loreSeed: body.site.loreSeed,
    bodyType: body.type,
    paletteId: spec.ambient.paletteId,
    systemKind: spec.kind,
    ...(spec.ambient.hazard ? { hazard: spec.ambient.hazard } : {}),
  });
}

function traitLine(body: BodySpec): string {
  const traits: string[] = [TYPE_LABEL[body.type]];
  if (body.station) traits.push('station in orbit');
  if (body.site.resource === 'fuel_skim') traits.push('skimmable atmosphere');
  if (body.site.resource === 'mining') traits.push('mineral deposits');
  if (body.hasRings) traits.push('ringed');
  if (body.moons.length > 0) traits.push(`${body.moons.length} moon`);
  return traits.join(' · ');
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function drawSite(ctx: CanvasRenderingContext2D, body: BodySpec, spec: SystemSpec): void {
  const { width, height } = ctx.canvas;
  const w = 440;
  ctx.font = '13px monospace';
  const lore = wrap(ctx, siteFragment(body, spec), w - 40);
  const h = 130 + lore.length * 18;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.fillStyle = 'rgba(10, 14, 24, 0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#7fd4ff';
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#7fd4ff';
  ctx.font = '16px monospace';
  ctx.fillText(`SCAN — ${body.name}`, x + 20, y + 32);
  ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
  ctx.font = '12px monospace';
  ctx.fillText(traitLine(body), x + 20, y + 52);

  ctx.fillStyle = '#cdd6f4';
  ctx.font = '13px monospace';
  lore.forEach((line, i) => ctx.fillText(line, x + 20, y + 86 + i * 18));

  ctx.fillStyle = 'rgba(205, 214, 244, 0.55)';
  ctx.font = '12px monospace';
  ctx.fillText('[Q] close', x + 20, y + h - 16);
}
