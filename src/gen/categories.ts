/**
 * categories.ts — shared category hygiene for the §13/§14 classifiers.
 *
 * Wikipedia articles carry many maintenance/hidden categories ("Articles with
 * short description", "CS1 maint…", "Use dmy dates…") that say nothing about
 * the subject. Both the faction MinHash (§13) and the habitation biome (§14)
 * must drop them, or they add noise — and short keyword matches like "art"
 * would fire on "Articles…". One source of truth lives here.
 */

/** True for a topical (subject-matter) category; false for maintenance/hidden. */
export function isTopicalCategory(cat: string): boolean {
  const lc = cat.toLowerCase();
  return !(
    lc.includes('wikidata') ||
    lc.includes('wikipedia') ||
    lc.includes('cs1') ||
    lc.includes('webarchive') ||
    lc.includes('short description') ||
    lc.includes('dmy dates') ||
    lc.includes('mdy dates') ||
    lc.includes('commons category') ||
    lc.includes('featured articles') ||
    lc.includes('good articles') ||
    lc.startsWith('articles ') ||
    lc.startsWith('pages ') ||
    lc.startsWith('all ') ||
    lc.startsWith('use ')
  );
}

/** The subject-matter categories only, maintenance/hidden ones removed. */
export function topicalCategories(categories: readonly string[]): string[] {
  return categories.filter(isTopicalCategory);
}
