# M5 — The Living Galaxy: Implementation Plan

> Companion to [SPEC.md](SPEC.md) §13–§17. Tracks the build order for M5. The
> governing constraint is unchanged: **every new thing is laundered from
> article metadata + the system seed, and the determinism boundary in
> `types.ts` is absolute** — pure world data in `SystemSpec`, mutable
> NPC/agent state in a new runtime layer.

## Decisions locked
- **P31 (Wikidata instance-of):** lazy fetch with a **category-hash fallback**
  that is the load-bearing path. P31 is a quality bump when it resolves; it
  never gates a jump (§17.5). (Chosen 2026-06-14.)

## Governing constraints
- **Pure fields only in `SystemSpec`** — faction + habitation are
  deterministic and golden-tested. NPCs/agents are mutable → new runtime
  module, never in the spec.
- **No RNG stream shift** — faction/habitation derive from *pure hashes* (the
  `paletteIdFor` pattern: `hash128` of a canonicalized signature, no `rng`
  draw interleaved into existing streams). Existing star/body/gate values stay
  byte-identical; only the new fields appear. Golden files regenerate once for
  the schema bump.
- **Snapshot-on-first-visit covers new signals** — new `ArticleMetadata`
  fields are optional; old snapshots lack them and fall back to category
  hashing. No cache wipe required.
- **Secret-keeping** — factions are category/P31 hashes, never shown as
  Wikipedia. Re-audited in Phase 9.

---

## Phase 0 — Schema & data plumbing
- **0a.** `ArticleMetadata` optional signals + `schemaVersion 1→2` (`types.ts`):
  `protection`, `languageCount`, `wikidataId`, `instanceOf`.
- **0b.** `fetch.ts`: add `langlinks` + `inprop=length|protection` + read
  `wikibase_item` to the existing batched call (free, §17.1); new lazy
  `fetchWikidataClaims(qid)` for P31 (separate round-trip, hard-cached, never
  gates a jump).
- **0c.** `degraded.ts` leaves new fields undefined; `fixtures/` bumped to v2.
- **0d.** `tsc` + existing tests green.

## Phase 1 — Factions (keystone, §13), pure layer
- **1a.** `src/gen/factions.ts`: 6–8 static archetypes; `factionFor(meta)` —
  coarsened category signature, P31-primary with category fallback, `contested`
  from straddle / high traffic / `autoconfirmed`, `sysop`→militarised core,
  stub/empty→`null` frontier.
- **1b.** `SystemSpec.faction` field + `schemaVersion 1→2`.
- **1c.** Wire into `generate.ts` `GenContext` (pure hash, no stream shift), set
  on all return paths.
- **1d.** Golden tests: regenerate; assert star/body/gate values unchanged;
  assert clustered fixtures share a faction.

## Phase 2 — Habitation (§14), pure layer
- `habitation` + `biomeHint` on `SystemSpec`; `src/gen/habitation.ts`
  (P31 class → biome, langCount + traffic → sterile↔teeming, richness →
  settlements). Flavor, not a resource. Golden + stream-stability assertion.

## Phase 3 — Naming & palette bias (§13.2)
- `names.ts`: faction phoneme bias (optional arg; gate-destination naming
  degrades to neutral). `palettes.ts`: blend faction tint into ambient palette.

## Phase 4 — Reputation / standing (§13.3, §7), run state
- `RunState.standing: Record<FactionId, number>`, `schemaVersion 4→5` + v4→v5
  migrator. `src/game/reputation.ts` (adjust/query + threshold helpers). New
  `DeathCause: 'destroyed'`.

## Phase 5 — Economy integration (§7, §13.2)
- `market.ts`/`dock.ts`: standing × disposition price multiplier (pure, not in
  spec). Bounty/cargo drops fold into the existing `addCredits`/loot path.

## Phase 6 — Agents & light combat (§15), runtime sim
- `src/game/agents.ts`: `populate(spec, run, rng) → Agent[]` (seeded spawn) +
  per-frame `stepAgents`. Ephemeral: despawn on jump, never persisted.
  Types: trader/hauler, patrol, pirate, civilian/drifter.
- `src/game/combat.ts`: one forward player gun; hostile fire → existing
  `damageHull`; player death → `deathCause: 'destroyed'`. M4 SFX as placeholder
  cues (M7 does the real pass).

## Phase 7 — Events (§16)
- Seeded system events (deterministic flavor) + runtime encounters
  (`src/game/events.ts`: distress / inspection / ambush / market shock). One
  rare class foreshadows The Erasure (pure flavor; M8 capstone).

## Phase 8 — Main-loop & render integration (`main.ts`)
- `enterSystem` populates/clears agents; `frameFlying` runs agent + combat
  sim; placeholder agent sprites; faction tint + standing on HUD. Extend
  `__sas` debug hook (agents/standing/faction). `destroyed` death in summary;
  optional faction naming in Decrypt.

## Phase 9 — Acceptance & audit
- `scripts/verify-m5.ts` (Playwright + `__sas`, mirroring verify-m4): faction
  determinism across reload; NPC spawn + destroy; standing moves prices;
  `destroyed` death reaches summary; faction/habitation present.
- Secret-keeping re-audit; spawn-rate balance pass (dial down if combat
  overshadows exploration — the intended lever, §15.3). Update SPEC + README.

---

## Sequencing & risk
- **Phases 0–2 are the architectural risk** and are fully golden-testable
  headless — land them first and lock the stream-stability proof before
  touching runtime.
- **Phases 4–7** are largely independent once Phase 1 lands; agents/combat
  (Phase 6) is the single largest chunk.
- **Biggest trap:** shifting RNG streams in `generate.ts`. Mitigation: derive
  faction/habitation from pure `hash128` signatures (never sequential draws on
  existing streams) and assert pre-M5 star/body/gate goldens are byte-identical.
