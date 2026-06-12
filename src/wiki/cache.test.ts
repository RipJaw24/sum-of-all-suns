/**
 * cache.test.ts — snapshot-on-first-visit semantics (SPEC §8, Decision 4):
 * one fetch per title ever, in-flight dedupe, and the never-persisted
 * degraded fallback.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { generateSystem } from '../gen/generate';
import type { ArticleMetadata } from '../types';
import { ArticleCache, IdbArticleStore, MemoryArticleStore } from './cache';
import { degradedMetadata, isDegraded } from './degraded';
import { photosynthesis } from '../gen/fixtures';

function meta(title: string): ArticleMetadata {
  return { ...photosynthesis, title };
}

describe('ArticleCache', () => {
  it('fetches once, then serves from the snapshot forever', async () => {
    const fetcher = vi.fn(async (t: string) => meta(t));
    const cache = new ArticleCache(new MemoryArticleStore(), fetcher);

    const first = await cache.get('Oxygen');
    const second = await cache.get('oxygen'); // normalization-insensitive

    expect(first.source).toBe('network');
    expect(second.source).toBe('cache');
    expect(second.meta.title).toBe('Oxygen');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent requests for the same title', async () => {
    const fetcher = vi.fn(async (t: string) => meta(t));
    const cache = new ArticleCache(new MemoryArticleStore(), fetcher);

    const [a, b] = await Promise.all([cache.get('Chlorophyll'), cache.get('Chlorophyll')]);

    expect(a.meta).toBe(b.meta);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('degrades on fetch failure, never persists it, and retries later', async () => {
    let fail = true;
    const fetcher = vi.fn(async (t: string) => {
      if (fail) throw new Error('network down');
      return meta(t);
    });
    const store = new MemoryArticleStore();
    const cache = new ArticleCache(store, fetcher);

    const degraded = await cache.get('Thylakoid');
    expect(degraded.source).toBe('degraded');
    expect(isDegraded(degraded.meta)).toBe(true);
    expect(await store.get('Thylakoid')).toBeUndefined();

    fail = false;
    const recovered = await cache.get('Thylakoid');
    expect(recovered.source).toBe('network');
    expect(isDegraded(recovered.meta)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('getStrict rejects on fetch failure instead of degrading (M4 fail-early)', async () => {
    let fail = true;
    const fetcher = vi.fn(async (t: string) => {
      if (fail) throw new Error('network down');
      return meta(t);
    });
    const store = new MemoryArticleStore();
    const cache = new ArticleCache(store, fetcher);

    await expect(cache.getStrict('Granum')).rejects.toThrow('network down');
    expect(await store.get('Granum')).toBeUndefined(); // nothing persisted

    fail = false;
    const fetched = await cache.getStrict('Granum');
    expect(fetched.source).toBe('network');

    fail = true; // snapshot now covers it — strict reads work offline
    const cached = await cache.getStrict('granum');
    expect(cached.source).toBe('cache');
    expect(cached.meta.title).toBe('Granum');
  });
});

describe('degradedMetadata', () => {
  it('is deterministic and produces a generatable dead-end system', () => {
    const a = degradedMetadata('Some Lost Article');
    const b = degradedMetadata('some_Lost Article');
    expect(a).toEqual(b);

    const spec = generateSystem(a);
    expect(spec.kind).toBe('standard');
    expect(spec.star?.class).toBe('red_dwarf');
    expect(spec.gates).toEqual([]); // §4.2 return gate is the only exit
  });
});

describe('IdbArticleStore', () => {
  it('round-trips a snapshot through IndexedDB', async () => {
    const store = new IdbArticleStore();
    expect(await store.get('Photosynthesis')).toBeUndefined();
    await store.put(photosynthesis);
    expect(await store.get('Photosynthesis')).toEqual(photosynthesis);
  });
});
