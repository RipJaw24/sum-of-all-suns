/**
 * smoke-live.ts — manual end-to-end check of the live Wikipedia path
 * (network-dependent, so NOT part of the vitest suite).
 * Run: npx vite-node scripts/smoke-live.ts
 */
import { generateSystem } from '../src/gen/generate';
import { fetchArticleMetadata } from '../src/wiki/fetch';

const meta = await fetchArticleMetadata('Photosynthesis');
console.log('--- ArticleMetadata ---');
console.log({
  title: meta.title,
  byteLength: meta.byteLength,
  sections: meta.sections.length,
  links: meta.links.length,
  stubs: meta.links.filter((l) => l.isStub).length,
  redirects: meta.links.filter((l) => l.isRedirect).length,
  categories: meta.categories.length,
  hasInfobox: meta.hasInfobox,
  referenceCount: meta.referenceCount,
  pageviews60d: meta.pageviews60d,
});

const spec = generateSystem(meta);
console.log('--- SystemSpec ---');
console.log({
  name: spec.name,
  kind: spec.kind,
  star: spec.star?.class,
  bodies: spec.bodies.length,
  belt: !!spec.belt,
  traffic: spec.traffic,
});
console.log('--- Gates ---');
for (const g of spec.gates) {
  console.log(`${g.id} ${g.kind.padEnd(9)} ${g.destinationName.padEnd(24)} -> ${g.destinationTitle}`);
}
