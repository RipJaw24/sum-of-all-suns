/**
 * lore.test.ts — lore fragments (§6) are deterministic, well-shaped, sized
 * for the scan panel, and — the licensing/secret rule — never contain a
 * word of any wiki title that seeded them.
 */
import { describe, expect, it } from 'vitest';
import type { BodyType, SystemKind } from '../types';
import {
  bioluminescentBay,
  mercuryDisambiguation,
  photosynthesis,
  stubHazard,
  stubSalvage,
  stubSparse,
  stubTunnel,
} from './fixtures';
import { generateSystem } from './generate';
import { MOODS, loreFragment } from './lore';

const BODY_TYPES: readonly BodyType[] = ['rocky', 'ice', 'gas_giant', 'lava', 'ocean'];
const KINDS: readonly SystemKind[] = [
  'standard',
  'shattered',
  'sparse',
  'salvage_field',
  'hazard_pocket',
  'deep_tunnel',
];

const FIXTURES = [
  photosynthesis,
  mercuryDisambiguation,
  bioluminescentBay,
  stubSparse,
  stubSalvage,
  stubHazard,
  stubTunnel,
];

describe('loreFragment', () => {
  it('is deterministic', () => {
    const input = { loreSeed: 'abc123', bodyType: 'rocky' as const, paletteId: 3, systemKind: 'standard' as const };
    expect(loreFragment(input)).toBe(loreFragment(input));
  });

  it('produces 1–2 sentences under 180 chars for every palette × body type × kind', () => {
    expect(MOODS.length).toBe(12);
    for (let paletteId = 0; paletteId < MOODS.length; paletteId++) {
      for (const bodyType of BODY_TYPES) {
        for (const systemKind of KINDS) {
          const text = loreFragment({ loreSeed: `${paletteId}/${bodyType}/${systemKind}`, bodyType, paletteId, systemKind });
          expect(text.length).toBeGreaterThan(0);
          expect(text.length).toBeLessThan(180);
          const sentences = text.match(/[.!?](\s|$)/g) ?? [];
          expect(sentences.length).toBeGreaterThanOrEqual(1);
          expect(sentences.length).toBeLessThanOrEqual(2);
          expect(text[0]).toBe(text[0]!.toUpperCase());
        }
      }
    }
  });

  it('varies across seeds (not a constant function)', () => {
    const texts = new Set(
      Array.from({ length: 20 }, (_, i) =>
        loreFragment({ loreSeed: `seed:${i}`, bodyType: 'rocky', paletteId: 0, systemKind: 'standard' }),
      ),
    );
    expect(texts.size).toBeGreaterThan(5);
  });

  it('SECRET-KEEPING: no fragment leaks a title, section, or link word', () => {
    for (const meta of FIXTURES) {
      const sys = generateSystem(meta);
      const spoilers = [
        meta.title,
        ...meta.sections.map((s) => s.title),
        ...meta.links.map((l) => l.title),
      ]
        .flatMap((t) => t.toLowerCase().split(/[\s()]+/))
        .filter((w) => w.length >= 4);
      for (const body of sys.bodies) {
        const text = loreFragment({
          loreSeed: body.site.loreSeed,
          bodyType: body.type,
          paletteId: sys.ambient.paletteId,
          systemKind: sys.kind,
          ...(sys.ambient.hazard ? { hazard: sys.ambient.hazard } : {}),
        }).toLowerCase();
        for (const word of spoilers) {
          expect(text, `leaked "${word}" via ${meta.title}/${body.id}`).not.toContain(word);
        }
      }
    }
  });
});
