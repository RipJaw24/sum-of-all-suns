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

Article titles are never shown — a syllable-grammar generator launders every name (e.g. *Photosynthesis* → *Moash Nizith*). A post-run **Decrypt Flight Log** reveals the true articles behind each system you visited.

---

## Controls

| Input | Action |
|---|---|
| Mouse | Aim ship heading |
| W / ↑ | Main thrust |
| S / ↓ | Retro-brake |
| A/D / ←/→ | RCS strafe |
| E / Space | Interact (dock, jump, mine, salvage) when in range |
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
npx vite-node scripts/screenshot.ts    # Visual inspection screenshot
```

### Architecture

```
Wikipedia APIs
    └─► wiki/fetch.ts       — ArticleMetadata (numbers + titles only, never prose)
         └─► wiki/cache.ts  — snapshot-on-first-visit (IndexedDB); offline-safe
              └─► gen/generate.ts — pure fn: ArticleMetadata → SystemSpec
                   └─► game/main.ts  — run state, jump flow, render loop
                        ├─► game/renderer.ts — PixiJS (WebGL) world + nebula shader
                        ├─► 2D overlay canvas — HUD, dock/trade, map, scan, summary
                        └─► game/market.ts   — derived per-system goods prices
```

**Core invariant:** `generate_system(meta)` is a pure function — same metadata in, byte-identical `SystemSpec` out, forever. Golden-file tests enforce this. The determinism is what makes the galaxy shared across all players.

Run state (fuel, route, visited gates) is kept strictly separate from `SystemSpec` and persisted in `localStorage`. The `SystemSpec` is never mutated.

---

## Milestones

| Milestone | Status | Description |
|---|---|---|
| **M0** | ✅ | Vite + TS project; fetch one article; `generate_system()` with golden tests; fly around on Canvas2D |
| **M1** | ✅ | Jumping works end-to-end; snapshot cache; §4.2 return gates; fuel cost; system map |
| **M2** | ✅ | Fuel/hull/credits; docking + refuel; death + run summary; **Decrypt Flight Log** |
| **M3** | ✅ | Trade goods; lore fragments; anomaly systems; nebula backgrounds; PixiJS |
| **M4** | 🔲 | Polish; secret-keeping audit; offline article pack; ship |

---

## Tech stack

**TypeScript + Vite + Vitest + PixiJS** — chosen for agent ergonomics: strong compiler feedback, headless test loops in milliseconds, and a Playwright path for visual iteration. The world renders on PixiJS (WebGL, with a GLSL nebula shader); all text UI draws on a 2D overlay canvas above it.

**Wikipedia APIs used:**
- MediaWiki Action API (`en.wikipedia.org/w/api.php`) — article metadata, links, sections
- Wikimedia Pageviews API — 60-day traffic counts

All wiki data is used as *numbers and seeds*, never as displayed text. Facts and statistics aren't copyrightable; only prose is — and no prose ever reaches the player.

---

## License

ISC
