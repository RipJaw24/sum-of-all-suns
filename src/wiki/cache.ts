/**
 * cache.ts — snapshot-on-first-visit article cache (SPEC §8, Decision 4).
 * First visit fetches + snapshots; revisits are fully offline. Each article
 * is fetched once per player, ever — the cache IS the player's galaxy, so a
 * snapshot is immutable once written (a player's known systems never shift).
 */

import { normalizeTitle } from '../rng';
import type { ArticleMetadata } from '../types';
import { degradedMetadata } from './degraded';
import { fetchArticleMetadata } from './fetch';

export interface ArticleStore {
  get(title: string): Promise<ArticleMetadata | undefined>;
  put(meta: ArticleMetadata): Promise<void>;
}

/** Test / SSR-safe store. */
export class MemoryArticleStore implements ArticleStore {
  private readonly map = new Map<string, ArticleMetadata>();

  async get(title: string): Promise<ArticleMetadata | undefined> {
    return this.map.get(title);
  }

  async put(meta: ArticleMetadata): Promise<void> {
    this.map.set(meta.title, meta);
  }
}

const DB_NAME = 'sum-of-all-suns';
const DB_VERSION = 1;
const STORE = 'articles';

/** Browser store: one object store, keyed by canonical article title. */
export class IdbArticleStore implements ArticleStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'title' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async get(title: string): Promise<ArticleMetadata | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(title);
      req.onsuccess = () => resolve((req.result as ArticleMetadata | undefined) ?? undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async put(meta: ArticleMetadata): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export type ArticleSource = 'cache' | 'network' | 'degraded';

export interface CachedArticle {
  meta: ArticleMetadata;
  source: ArticleSource;
}

export class ArticleCache {
  /** In-flight dedupe: prefetch + jump for the same title share one fetch. */
  private readonly inflight = new Map<string, Promise<CachedArticle>>();

  constructor(
    private readonly store: ArticleStore,
    private readonly fetcher: (title: string) => Promise<ArticleMetadata> = fetchArticleMetadata,
  ) {}

  /**
   * Cached snapshot, or fetch-and-snapshot on first visit. Never rejects:
   * fetch failure yields deterministic degraded metadata ("sensor
   * interference", §8) which is NOT persisted, so it re-resolves on retry.
   */
  get(rawTitle: string): Promise<CachedArticle> {
    const title = normalizeTitle(rawTitle);
    const pending = this.inflight.get(title);
    if (pending) return pending;
    const job = this.lookup(title).finally(() => this.inflight.delete(title));
    this.inflight.set(title, job);
    return job;
  }

  private async lookup(title: string): Promise<CachedArticle> {
    const cached = await this.store.get(title);
    if (cached) return { meta: cached, source: 'cache' };
    try {
      const meta = await this.fetcher(title);
      await this.store.put(meta);
      return { meta, source: 'network' };
    } catch (err) {
      console.warn('[sensor interference] snapshot fetch failed, degrading:', err);
      return { meta: degradedMetadata(title), source: 'degraded' };
    }
  }

  /**
   * Like get(), but REJECTS instead of degrading when the article isn't
   * cached and the fetch fails. M4 fail-early rule: a NEW run must start
   * from real metadata — no-network at run start is a clear error in the
   * menu, never a silently degraded galaxy. Mid-run lookups keep using
   * get()'s degraded fallback. Bypasses the in-flight map so it can't be
   * handed a degraded result from a concurrent lenient lookup.
   */
  async getStrict(rawTitle: string): Promise<CachedArticle> {
    const title = normalizeTitle(rawTitle);
    const cached = await this.store.get(title);
    if (cached) return { meta: cached, source: 'cache' };
    const meta = await this.fetcher(title);
    await this.store.put(meta);
    return { meta, source: 'network' };
  }

  /** Fire-and-forget warm-up for gate destinations (§8: jump never stalls). */
  prefetch(titles: readonly string[]): void {
    for (const title of titles) void this.get(title);
  }
}
