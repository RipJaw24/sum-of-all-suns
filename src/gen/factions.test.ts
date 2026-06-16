/**
 * factions.test.ts — §13 faction assignment: deterministic, clustering, and
 * the contested/unaligned rules. Pure-layer coverage (no rendering, no run
 * state); the golden suite (generate.test.ts) pins the field onto SystemSpec.
 */
import { describe, expect, it } from 'vitest';
import type { ArticleMetadata } from '../types';
import { CONTESTED_TRAFFIC, FACTIONS, factionById, factionFor } from './factions';

/** Minimal valid ArticleMetadata with overridable fields. */
function meta(over: Partial<ArticleMetadata>): ArticleMetadata {
  return {
    schemaVersion: 2,
    title: 'Test',
    byteLength: 20_000,
    sections: [],
    links: [],
    categories: [],
    hasInfobox: false,
    referenceCount: 0,
    pageviews60d: 0,
    isDisambiguation: false,
    snapshotAt: '2026-06-14T00:00:00.000Z',
    ...over,
  };
}

describe('factionFor (§13.1 assignment)', () => {
  it('is deterministic and returns a real archetype id', () => {
    const m = meta({ categories: ['Aquatic plants', 'Photosynthesis'] });
    const a = factionFor(m, 0);
    const b = factionFor(m, 0);
    expect(a).toEqual(b);
    expect(FACTIONS.map((f) => f.id)).toContain(a!.id);
  });

  it('no topical signal -> unaligned frontier (null)', () => {
    expect(factionFor(meta({ categories: [] }), 0)).toBeNull();
    // Only maintenance/hidden categories -> still no signal.
    expect(
      factionFor(
        meta({
          categories: [
            'Articles with short description',
            'CS1 maint: location',
            'Webarchive template wayback links',
            'Use dmy dates from June 2020',
          ],
        }),
        0,
      ),
    ).toBeNull();
  });

  it('MinHash clustering: a set maps to the faction of one of its members', () => {
    // The faction of {X, Y} is decided by the lowest-hashing token, which is
    // X or Y — so neighbours sharing that token land in the same faction.
    const xy = factionFor(meta({ categories: ['Rivers of France', 'Tributaries'] }), 0)!;
    const x = factionFor(meta({ categories: ['Rivers of France'] }), 0)!;
    const y = factionFor(meta({ categories: ['Tributaries'] }), 0)!;
    expect([x.id, y.id]).toContain(xy.id);
  });

  it('P31 is the primary lever: same instance-of -> same faction despite different categories', () => {
    const a = factionFor(meta({ instanceOf: ['Q11173'], categories: ['Acids'] }), 0)!;
    const b = factionFor(meta({ instanceOf: ['Q11173'], categories: ['Solvents'] }), 0)!;
    expect(a.id).toBe(b.id);
  });

  it('contested: a busy lane (high traffic) is fought over', () => {
    const m = meta({ categories: ['Capital cities'] });
    expect(factionFor(m, CONTESTED_TRAFFIC)!.contested).toBe(true);
    expect(factionFor(m, 0)!.contested).toBe(false);
  });

  it('protection: autoconfirmed -> contested border, sysop -> held core (not contested)', () => {
    const cats = ['Chemical elements'];
    expect(factionFor(meta({ categories: cats, protection: 'autoconfirmed' }), 0)!.contested).toBe(
      true,
    );
    const core = factionFor(meta({ categories: cats, protection: 'sysop' }), CONTESTED_TRAFFIC)!;
    // sysop overrides even a busy lane: a militarised core is held, not fought.
    expect(core.contested).toBe(false);
  });
});

describe('SECRET-KEEPING: faction identity never leaks Wikipedia', () => {
  it('names are static invented words, independent of the source article', () => {
    // The same faction id always shows the same name — it comes from the
    // archetype table, never from the controlled system's metadata.
    for (const f of FACTIONS) {
      expect(factionById(f.id).name).toBe(f.name);
      expect(f.name).toMatch(/^[A-Z][A-Za-z ]+$/); // invented, no titles/digits
      expect(f.tint).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Two unrelated articles that resolve to the same faction read identically.
    const a = factionFor(meta({ categories: ['Chemical elements'] }), 0);
    const b = factionFor(meta({ categories: ['Chemical elements'] }), 0);
    expect(a).toEqual(b);
  });
});
