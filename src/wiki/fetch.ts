/**
 * fetch.ts — Wikipedia -> ArticleMetadata (SPEC §8). The snapshot cache
 * (cache.ts) sits in front of this; nothing here is called twice per title.
 *
 * Etiquette: browsers forbid setting User-Agent, so we send Api-User-Agent
 * (accepted by Wikimedia policy) plus origin=* for CORS. All Action-API
 * calls are serialized through one queue, send maxlag=5, and back off on
 * 429/503/maxlag per Wikimedia policy.
 *
 * Licensing guardrail: only numbers, counts, and titles leave this module —
 * never article prose (SPEC §6 note).
 */

import { normalizeTitle } from '../rng';
import { STUB_BYTES, type ArticleMetadata, type LinkMeta, type SectionMeta } from '../types';

const API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';
const API_USER_AGENT = 'SumOfAllSuns/0.1 (prototype; maxshippee@gmail.com)';

/** How many filtered links get a destination-info lookup (stub/redirect). */
const LINK_INFO_BUDGET = 100;
const INFO_BATCH = 50;

// --- junk-link filter (§4.1) -------------------------------------------------

const JUNK_PATTERNS: readonly RegExp[] = [
  /^\d{1,4}$/, // bare years: "1905"
  /^\d{1,4}s$/, // decades: "1900s"
  /^(January|February|March|April|May|June|July|August|September|October|November|December)( \d{1,2})?$/,
  /^\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)$/,
  /^List of /i,
  /^(ISBN|ISSN|DOI|OCLC|PMID|S2CID|Bibcode|ArXiv|JSTOR|Wayback Machine)\b/i,
];

export function isJunkLink(title: string): boolean {
  return JUNK_PATTERNS.some((re) => re.test(title));
}

// --- API plumbing --------------------------------------------------------------

const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** All Action-API requests run one at a time, in order (politeness §8). */
let apiQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = apiQueue.then(task, task);
  apiQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function apiGet(params: Record<string, string>): Promise<any> {
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      const qs = new URLSearchParams({ format: 'json', origin: '*', maxlag: '5', ...params });
      const res = await fetch(`${API}?${qs}`, {
        headers: { 'Api-User-Agent': API_USER_AGENT },
      });
      const retryAfterSec = Number(res.headers.get('retry-after')) || 2 ** attempt;
      if (res.status === 429 || res.status === 503) {
        if (attempt >= MAX_RETRIES) throw new Error(`wiki api ${res.status} after ${attempt} retries`);
        await sleep(retryAfterSec * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`wiki api ${res.status} for ${params['action']}`);
      const data = await res.json();
      if (data?.error?.code === 'maxlag') {
        if (attempt >= MAX_RETRIES) throw new Error('wiki api lagged, gave up');
        await sleep(retryAfterSec * 1000);
        continue;
      }
      if (data?.error) throw new Error(`wiki api error: ${data.error.code}`);
      return data;
    }
  });
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size) as T[]);
  return out;
}

// --- queries -------------------------------------------------------------------

interface PageBasics {
  byteLength: number;
  categories: string[];
  linkTitles: string[];
  isDisambiguation: boolean;
  /** §17.1 — edit-protection level, defaulted to 'none' when unprotected. */
  protection: 'none' | 'autoconfirmed' | 'sysop';
  /** §17.1 — interlanguage link count. */
  languageCount: number;
  /** §17.1 — Wikidata Q-id, if the page is linked to one. */
  wikidataId?: string;
}

/** Map a MediaWiki `protection` array to our coarse §13 enum. We only read
 *  the `edit` restriction; 'extendedconfirmed' folds into 'autoconfirmed'
 *  (both read as "contested border"), 'sysop' is the militarised core. */
export function protectionLevel(
  protection: any[] | undefined,
): 'none' | 'autoconfirmed' | 'sysop' {
  const edit = (protection ?? []).find((p) => p?.type === 'edit');
  const level = String(edit?.level ?? '');
  if (level === 'sysop') return 'sysop';
  if (level === 'autoconfirmed' || level === 'extendedconfirmed') return 'autoconfirmed';
  return 'none';
}

async function fetchBasics(title: string): Promise<PageBasics> {
  const data = await apiGet({
    action: 'query',
    // §17.1: langlinks + inprop=protection ride in the SAME batched call;
    // wikibase_item comes back in pageprops (already requested). Nearly free.
    prop: 'info|categories|links|langlinks|pageprops',
    inprop: 'length|protection',
    plnamespace: '0',
    pllimit: '500',
    cllimit: '500',
    lllimit: 'max',
    ppprop: 'disambiguation|wikibase_item',
    redirects: '1',
    titles: title,
  });
  const pages = data?.query?.pages ?? {};
  const page: any = Object.values(pages)[0];
  if (!page || page.missing !== undefined) throw new Error(`article not found: ${title}`);
  const wikidataId = page.pageprops?.wikibase_item;
  return {
    byteLength: page.length ?? 0,
    categories: (page.categories ?? []).map((c: any) =>
      String(c.title).replace(/^Category:/, ''),
    ),
    linkTitles: (page.links ?? [])
      .map((l: any) => String(l.title))
      .filter((t: string) => !isJunkLink(t)),
    isDisambiguation: page.pageprops?.disambiguation !== undefined,
    protection: protectionLevel(page.protection),
    languageCount: (page.langlinks ?? []).length,
    ...(wikidataId ? { wikidataId: String(wikidataId) } : {}),
  };
}

/**
 * §17.2 — resolve a Wikidata Q-id to its `instance of` (P31) Q-ids. A SEPARATE
 * round-trip to wikidata.org (CC0 — no attribution constraint, §17 note).
 * NEVER fails the snapshot: P31 is the *primary* faction/habitation lever when
 * present, but category hashing is the load-bearing fallback (decided
 * 2026-06-14), so a failure here just leaves `instanceOf` undefined.
 */
async function fetchWikidataInstanceOf(qid: string): Promise<string[] | undefined> {
  try {
    const qs = new URLSearchParams({
      format: 'json',
      origin: '*',
      action: 'wbgetentities',
      ids: qid,
      props: 'claims',
      // P31 is all we need; trim the payload hard.
      languages: 'en',
    });
    const res = await fetch(`${WIKIDATA_API}?${qs}`);
    if (!res.ok) return undefined;
    const data = await res.json();
    const claims = data?.entities?.[qid]?.claims?.P31 ?? [];
    const ids = claims
      .map((c: any) => c?.mainsnak?.datavalue?.value?.id)
      .filter((id: unknown): id is string => typeof id === 'string');
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}

interface LinkInfo {
  byteLength?: number;
  isRedirect: boolean;
  resolvedTitle?: string;
  isDisambiguation: boolean;
}

/** Batch-resolve destination length / redirect / disambig for link titles. */
async function fetchLinkInfo(titles: readonly string[]): Promise<Map<string, LinkInfo>> {
  const out = new Map<string, LinkInfo>();
  for (const batch of chunk(titles, INFO_BATCH)) {
    const data = await apiGet({
      action: 'query',
      prop: 'info|pageprops',
      inprop: 'length',
      ppprop: 'disambiguation',
      redirects: '1',
      titles: batch.join('|'),
    });
    // &redirects moves resolution into query.redirects: [{from, to}]
    const redirectMap = new Map<string, string>(
      (data?.query?.redirects ?? []).map((r: any) => [String(r.from), String(r.to)]),
    );
    const byTitle = new Map<string, any>(
      Object.values(data?.query?.pages ?? {}).map((p: any) => [String(p.title), p]),
    );
    for (const original of batch) {
      const resolved = redirectMap.get(original);
      const page = byTitle.get(resolved ?? original);
      if (!page || page.missing !== undefined) continue;
      out.set(original, {
        byteLength: page.length,
        isRedirect: resolved !== undefined,
        ...(resolved !== undefined ? { resolvedTitle: resolved } : {}),
        isDisambiguation: page.pageprops?.disambiguation !== undefined,
      });
    }
  }
  return out;
}

/**
 * First-appearance order of [[wikilink]] targets in the article body (§4.1:
 * "earlier links = more natural connections"). Plain regex pass — nested
 * file-caption links and template-generated links are imperfectly handled,
 * which is fine: this only RANKS titles the Action API already returned;
 * anything unmatched sorts after everything matched.
 */
export function extractLinkOrder(wikitext: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const re = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]/g;
  for (const match of wikitext.matchAll(re)) {
    const target = normalizeTitle(match[1] ?? '');
    if (!target || seen.has(target)) continue;
    // Skip obvious non-mainspace targets; harmless if one slips through.
    if (/^(File|Image|Category|Template|Wikipedia|Help|Portal|Special|Media|Draft|Module|wikt|commons):/i.test(target)) continue;
    seen.add(target);
    order.push(target);
  }
  return order;
}

interface ParseInfo {
  sections: SectionMeta[];
  referenceCount: number;
  hasInfobox: boolean;
  /** Normalized link targets in first-appearance order. */
  linkOrder: string[];
}

async function fetchParseInfo(title: string): Promise<ParseInfo> {
  const data = await apiGet({
    action: 'parse',
    page: title,
    prop: 'sections|wikitext',
    redirects: '1',
  });
  const wikitext: string = data?.parse?.wikitext?.['*'] ?? '';
  const rawSections: any[] = data?.parse?.sections ?? [];
  const topLevel = rawSections.filter((s) => Number(s.toclevel) === 1);

  // Section byte lengths: byteoffset delta between consecutive TOP-LEVEL
  // sections (nested sections are inside their parent's span).
  const sections: SectionMeta[] = topLevel.map((s, i) => {
    const start = Number(s.byteoffset ?? 0);
    const next = topLevel[i + 1];
    const end = next ? Number(next.byteoffset ?? wikitext.length) : wikitext.length;
    const body = wikitext.slice(start, Math.max(start, end));
    return {
      title: String(s.line),
      byteLength: Math.max(0, end - start),
      imageCount: (body.match(/\[\[(File|Image):/gi) ?? []).length,
    };
  });

  return {
    sections,
    referenceCount: (wikitext.match(/<ref[\s>]/gi) ?? []).length,
    hasInfobox: /\{\{\s*Infobox/i.test(wikitext),
    linkOrder: extractLinkOrder(wikitext),
  };
}

/** Sum pageviews over the last two complete months (≈ 60 days, §3.2). */
async function fetchPageviews60d(title: string): Promise<number> {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // 1st of this month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;
  const article = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_API}/en.wikipedia/all-access/user/${article}/monthly/${fmt(start)}/${fmt(end)}`;
  // Pageviews are flavor — never fail the whole snapshot over them. No
  // Api-User-Agent here: the custom header forces a CORS preflight that
  // the REST endpoint rejects in browsers (the browser UA is sent anyway).
  try {
    const res = await fetch(url);
    if (!res.ok) return 0;
    const data = await res.json();
    return (data?.items ?? []).reduce((sum: number, it: any) => sum + (it.views ?? 0), 0);
  } catch {
    return 0;
  }
}

// --- entry point -----------------------------------------------------------------

export async function fetchArticleMetadata(rawTitle: string): Promise<ArticleMetadata> {
  const title = normalizeTitle(rawTitle);
  const [basics, parseInfo, pageviews60d] = await Promise.all([
    fetchBasics(title),
    fetchParseInfo(title),
    fetchPageviews60d(title),
  ]);

  // Rank API link titles by first appearance in the wikitext (§4.1). Titles
  // the regex pass missed (template-generated links) sort after all matched
  // ones, alphabetically — deterministic per snapshot either way.
  const order = new Map<string, number>(parseInfo.linkOrder.map((t, i) => [t, i]));
  const orderedTitles = [...basics.linkTitles].sort((a, b) => {
    const oa = order.get(normalizeTitle(a)) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(normalizeTitle(b)) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const infoTargets = orderedTitles.slice(0, LINK_INFO_BUDGET);
  const linkInfo = await fetchLinkInfo(infoTargets);

  // §17.2: one extra hop for P31, only when a Q-id exists. Guarded inside
  // fetchWikidataInstanceOf — never gates the snapshot (§17.5).
  const instanceOf = basics.wikidataId
    ? await fetchWikidataInstanceOf(basics.wikidataId)
    : undefined;

  const links: LinkMeta[] = infoTargets.map((linkTitle, i) => {
    const info = linkInfo.get(linkTitle);
    return {
      title: normalizeTitle(linkTitle),
      ...(info?.byteLength !== undefined ? { byteLength: info.byteLength } : {}),
      isStub: info?.byteLength === undefined || info.byteLength < STUB_BYTES,
      positionIndex: i,
      isDisambiguation: info?.isDisambiguation ?? false,
      isRedirect: info?.isRedirect ?? false,
      ...(info?.resolvedTitle !== undefined
        ? { resolvedTitle: normalizeTitle(info.resolvedTitle) }
        : {}),
    };
  });

  return {
    schemaVersion: 2,
    title,
    byteLength: basics.byteLength,
    sections: parseInfo.sections,
    links,
    categories: basics.categories,
    hasInfobox: parseInfo.hasInfobox,
    referenceCount: parseInfo.referenceCount,
    pageviews60d,
    isDisambiguation: basics.isDisambiguation,
    snapshotAt: new Date().toISOString(),
    // M5 §17 signals — protection/languageCount always known from the batched
    // call; wikidataId/instanceOf only when the page resolves to Wikidata.
    protection: basics.protection,
    languageCount: basics.languageCount,
    ...(basics.wikidataId ? { wikidataId: basics.wikidataId } : {}),
    ...(instanceOf ? { instanceOf } : {}),
  };
}
