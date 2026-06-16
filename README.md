# Sum of All Suns

> *"The free galaxy that anyone can explore."*

A 2D top-down space roguelike where every star system is secretly a Wikipedia article. The hyperlinks between articles are your jump gates. The galaxy is infinite, deterministic, and shared — two players who jump to the same article see the same star, the same planets, the same routes.

Wikipedia is the world generator, but the seams never show.

---

## How it works

Each article becomes a star system via a deterministic seed (`hash64(title)`). The article's metadata shapes the world:

| Wiki signal | What it becomes |
|---|---|
| Article byte length | Star class (red dwarf → supergiant) |
| Top-level sections | Number of orbital bodies |
| Section images | Rings or moons |
| Reference count | Asteroid belt density |
| Infobox present | A dockable station |
| Pageviews (60 days) | NPC traffic, trade prices |
| Internal links | Jump gates to neighboring systems |
| Disambiguation page | "Shattered system" — a debris field with every entry as a gate |
| Redirect | Wormhole to the redirect target |
| Stub article link | Uncharted gate: cheap fuel, unknown destination |
| Categories / Wikidata type (P31) | **Faction** control — category clusters form contiguous territory |
| Edit-protection level | Contested borders (`autoconfirmed`) and militarised cores (`sysop`) |
| Language count + traffic | **Habitation** — sterile → teeming, who lives here |

Article titles are never shown — a syllable-grammar generator launders every name (e.g. *Photosynthesis* → *Moash Nizith*). A post-run **Decrypt Flight Log** reveals the true articles behind each system you visited — and, since M5, the faction that held each one.

---

## Controls

| Input | Action |
|---|---|
| Mouse | Aim ship heading |
| W / ↑ | Main thrust |
| S / ↓ | Retro-brake |
| A/D / ←/→ | RCS strafe |
| E / Space | Interact (dock, jump, mine, salvage, answer distress) when in range |
| Left mouse / F | Fire forward gun (M5 light combat) |
| Q | Scan nearby body (site panel + lore) |
| Tab / M | System chart |
| T, B, V | While docked: trade view, buy, sell |

---

## Getting started

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

Add `?debug` to the URL to reveal true article titles in the console and enable `window.__sas` for scripting.  
Add `?start=Article_Title` to begin a fresh run from any Wikipedia article.

---

## Development

```bash
npm test           # Vitest unit + golden-file tests
npm run typecheck  # tsc --noEmit
```

**Acceptance / E2E** (dev server must be running):

```bash
npx vite-node scripts/verify-jump.ts   # M1: jump + offline cache proof
npx vite-node scripts/verify-m2.ts     # M2: hull/credits/docking/death/decrypt
npx vite-node scripts/verify-m3.ts     # M3: trade/lore/anomalies/nebula
npx vite-node scripts/verify-m4.ts     # M4: menu/pause/fail-early/survive-N victory
npx vite-node scripts/verify-m5.ts     # M5: factions/habitation/NPCs/standing→price/combat death
npx vite-node scripts/screenshot.ts    # Visual inspection screenshot
```

### Architecture

```
Wikipedia APIs
    └─► wiki/fetch.ts       — ArticleMetadata (numbers + titles only, never prose)
         └─► wiki/cache.ts  — snapshot-on-first-visit (IndexedDB); offline-safe
              └─► gen/generate.ts — pure fn: ArticleMetadata → SystemSpec
                   │                   (+ gen/factions.ts, gen/habitation.ts — pure §13/§14 fields)
                   └─► game/main.ts  — run state, jump flow, render loop
                        ├─► game/renderer.ts — PixiJS (WebGL) world + nebula shader
                        ├─► 2D overlay canvas — HUD, dock/trade, map, scan, summary
                        ├─► game/market.ts + reputation.ts — faction/standing-adjusted prices
                        └─► game/agents.ts + combat.ts + events.ts — NPCs, light combat, §16 events
```

**Core invariant:** `generate_system(meta)` is a pure function — same metadata in, byte-identical `SystemSpec` out, forever. Golden-file tests enforce this. The determinism is what makes the galaxy shared across all players. M5's factions and habitation are **pure fields** derived from `hash128` (no `GEN_VERSION` bump), so they were added without moving a single star.

Run state (fuel, route, visited gates, per-faction standing) is kept strictly separate from `SystemSpec` and persisted in `localStorage`. NPC agents are the most dynamic case: **ephemeral** runtime state, seeded per system but never written into the spec, despawned on jump and never persisted. The `SystemSpec` is never mutated.

---

## Milestones

| Milestone | Status | Description |
|---|---|---|
| **M0** | ✅ | Vite + TS project; fetch one article; `generate_system()` with golden tests; fly around on Canvas2D |
| **M1** | ✅ | Jumping works end-to-end; snapshot cache; §4.2 return gates; fuel cost; system map |
| **M2** | ✅ | Fuel/hull/credits; docking + refuel; death + run summary; **Decrypt Flight Log** |
| **M3** | ✅ | Trade goods; lore fragments; anomaly systems; nebula backgrounds; PixiJS |
| **M4** | ✅ | Main menu + pause; run goal (survive N jumps); audio; fail-early offline UX; secret-keeping audit; balance; ship (v1) |
| **M5** | ✅ | The Living Galaxy: factions from category clusters; life/habitation; NPC agents (traders/patrols/pirates); light combat; per-faction standing; faction-priced stations; random events + Erasure foreshadow |
| **M6** | 🔜 | Visual identity: faction/habitation-styled station graphics; player-ship graphics pass; body rendering refinement; NPC sprites; faction-colored UI |
| **M7** | 🔜 | Soundscape: combat/NPC/event SFX; per-faction & per-habitation ambient beds; jump/dock/UI audio polish (full pass beyond M4's minimal SFX) |

---

## Tech stack

**TypeScript + Vite + Vitest + PixiJS** — chosen for agent ergonomics: strong compiler feedback, headless test loops in milliseconds, and a Playwright path for visual iteration. The world renders on PixiJS (WebGL, with a GLSL nebula shader); all text UI draws on a 2D overlay canvas above it.

**Wikipedia APIs used:**
- MediaWiki Action API (`en.wikipedia.org/w/api.php`) — metadata, links, sections, edit-protection, language count, Wikidata id (one batched call)
- Wikidata API (`wikidata.org/w/api.php`) — `instance of` (P31) type, the primary faction/habitation lever (lazy, with a category-hash fallback)
- Wikimedia Pageviews API — 60-day traffic counts

All wiki data is used as *numbers and seeds*, never as displayed text. Facts and statistics aren't copyrightable; only prose is — and no prose ever reaches the player. (Wikidata values are CC0 — public domain.)

---

## License

ISC
