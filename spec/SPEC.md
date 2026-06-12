# SUM OF ALL SUNS
## Design & Technical Specification — v0.3 (title locked)

> *Working tagline: "The free galaxy that anyone can explore." (Reveal-layer joke — surfaces post-decrypt.)*

---

## 1. Concept

A 2D top-down space roguelike (working title locked: **Sum of All Suns**, a riff on "the sum of all human knowledge") in which every star system, planet, station, and jump route is procedurally generated from Wikipedia articles via the public MediaWiki API. The player never sees a Wikipedia reference; to them it's an infinite, strangely coherent galaxy. Under the hood, each star system **is** an article, and the hyperlinks on that article **are** the jump points to neighboring systems.

**Design pillars**

1. **Hidden authorship** — Wikipedia is the world generator, but the seams must never show. All wiki-derived data is laundered through name generators, palettes, and rulesets before the player sees it.
2. **Determinism** — The same article always produces the same system. Two players who jump to "Photosynthesis" see the same star, same planets, same jump gates. The galaxy is shared and explorable, not random noise.
3. **The graph is the game** — Wikipedia's link topology gives us something hand-built galaxies rarely have: hubs, dead ends, weird tunnels, and six-degrees-of-separation routing. Navigation puzzles emerge for free.
4. **Light-touch roguelike** — Runs, permadeath, fuel pressure. Discovery is the reward; combat (if any) is secondary in v1.

---

## 2. Core Loop

```
Spawn in a start system
   → fly (arrows = thrust, mouse = heading)
   → scan / visit bodies in orbit (land, gather fuel/credits/lore)
   → choose a jump gate
   → spend fuel, jump to linked system
   → repeat until death (fuel-out, hazard) or run goal reached
```

**Run goal (decided for MVP): survive N jumps.** Gives every run a natural ending and a victory variant of the Decrypt Flight Log. Other options considered — reach a distant system ("find your way home"); chart a route between two named articles (a literal "Wiki race" without ever saying so) — remain candidates for later modes. Longer-term, movement pressure should come from a diegetic threat instead of a jump counter: a system-eating cosmic badness that detonates stars behind the player (see §12).

---

## 3. World Generation: Article → Star System

Everything is derived from a **system seed**: `seed = hash64(normalized_article_title)`. The seed drives a deterministic PRNG (e.g., PCG32 / xoshiro). Article *metadata* shapes the rules; the PRNG fills in the details. Pin behavior to the title only (not revision ID) so systems stay stable even as articles get edited — accept that article metadata drift can slowly mutate a system between play sessions, or snapshot metadata into the local cache on first visit (recommended: **snapshot on first visit**, so a player's known galaxy never shifts under them).

### 3.1 Star

| Wiki signal | System property |
|---|---|
| Article byte length | Star class/size: <10 KB → red dwarf, 10–40 KB → main sequence (G/K), 40–100 KB → giant, >100 KB → supergiant or binary |
| First letter of title (hashed) | Star color tint within class |
| Article is a Featured/Good article (categories) | Rare star: pulsar, white dwarf pair, etc. |
| Disambiguation page | Special case — see §4.3 |

### 3.2 Planets & bodies

| Wiki signal | System property |
|---|---|
| Number of top-level sections (`prop=sections`) | Number of major orbital bodies (clamped 1–9) |
| Section byte length | Body size; biggest sections become gas giants |
| Section has images | Body gets rings or a moon |
| Reference count (`<ref>` density) | Asteroid belt density |
| Infobox present | One body hosts a station (dockable, trade/refuel) |
| Categories (hashed) | System palette + nebula tint + ambient hazard type |
| Pageviews (last 60 days, Pageviews API) | "Traffic": NPC ship density, station prices, patrol presence |

Orbital radii, eccentricity, and starting angles come from the seeded PRNG. Bodies orbit in real time (slow — cosmetic, not a docking puzzle).

### 3.3 Naming (the laundering layer)

Never show article titles raw. Generate names with a syllable-grammar generator seeded from the title hash (e.g., "Photosynthesis" → "Vel Toshi Prime"). Keep a debug flag that reveals true titles for development. Body names: `{SystemName} {Roman numeral}` plus generated names for stations.

Optional spice: derive name *flavor* from the article's language links or categories (articles in Category:Rivers get watery phonemes, etc.). Cheap to do with a few phoneme tables keyed by category hash.

### 3.4 Background

Nebula background is GPU/canvas procedural noise (2–3 octaves of simplex, domain-warped), color-graded by the category-derived palette. Star field is seeded by system hash. No wiki imagery is ever displayed — keeps the secret and dodges image licensing entirely.

---

## 4. Galaxy Topology: Links → Jump Gates

### 4.1 Gate selection

In-fiction, the jump network is called the **See-Also Network** ("approaching See-Also Gate 3") — reads as flavor pre-reveal, lands as the second punchline post-decrypt.

Pull internal links from the article (`prop=links`, namespace 0 only). Filter out: dates/years, "List of…", and identifiers (ISBN etc.). Links to articles under ~2 KB become **uncharted gates** (see §4.5) rather than being discarded.

From the filtered set, select **3–6 gates** deterministically: rank by position-in-article (earlier links = more "natural" connections) and take the top N, where N = clamp(3 + log2(link_count)/2, 3, 6). Place gates at the system rim at seeded angles.

### 4.2 Bidirectionality

Wikipedia links are directed; jump gates shouldn't be (players hate one-way trips they didn't choose). Rule: **a gate you arrived through always works in reverse**, even if the destination article doesn't link back. Unvisited gates are forward-only until used. This makes the directed graph traversable without faking a symmetric galaxy.

### 4.3 Special pages as anomalies

- **Disambiguation pages** → "shattered systems": no star, debris field, every disambiguation entry is a gate. Natural hub-puzzle rooms.
- **Redirects** → wormholes: gate dumps you in the redirect target with a visual glitch effect.
- **Very high pageview articles** (current events) → "busy lanes": heavy traffic, pirates or patrols, good trade.

### 4.4 Start system

Use `action=query&list=random&rnnamespace=0` filtered to ≥20 KB articles, or curate a small pool of well-connected seed articles for fairer run starts (recommended for MVP).

### 4.5 Uncharted gates (stub articles) — risk/reward

Links to stub articles (<~2 KB) spawn **uncharted gates**: visually distinct (flickering, no destination ping on the map), cheaper to enter (~50% fuel cost), and unscannable until used.

What's on the other side, rolled deterministically from the stub's seed:

- **~50% — Sparse system**: dim star, 0–2 barren bodies, few onward gates. The dead-end risk *is* the cost; with fuel pressure, jumping blind into a stub can strand a run.
- **~30% — Salvage field**: stubs are "unfinished" articles, so their systems are littered with derelicts — free fuel, hull scrap, or rare goods. This is the reward case.
- **~15% — Hazard pocket**: radiation storm or dense debris; hull damage on entry, but often a rare-good deposit at the center.
- **~5% — Deep tunnel**: the stub's own few links are all uncharted too, opening a chain of cheap-fuel shortcuts across the galaxy for the brave.

Balance lever: salvage value scales with how *isolated* the stub is (fewer inbound links = richer wreck), so the most dangerous dead ends pay the best. Stub status is snapshotted with the rest of the system metadata on first visit.

---

## 5. Flight Model & Controls

- **Mouse** sets the ship's nose heading (ship rotates toward cursor with a max turn rate — not instant snap; gives ships weight).
- **Up arrow / W**: main thrust along nose vector.
- **Down arrow / S**: retro-thrust / brake.
- **Left/Right arrows / A,D**: lateral RCS strafe (weaker than main thrust).
- Physics: Newtonian with mild velocity damping (≈2–5%/s) and a soft speed cap. Pure Newtonian is purist but punishing with mouse-aim; damped feels like *Escape Velocity* and is the right call for a roguelike where flight isn't the skill ceiling.
- **Spacebar / E**: interact (dock, enter gate) when in range; show a radial prompt.
- **Tab/M**: system map (bodies + gates discovered so far).

---

## 6. Landing / Visiting Bodies

Approach within range, press interact → cut to a **site screen** (static illustrated panel + menu; no surface gameplay in v1).

Site content is generated from the article's *sections*: the section that spawned the body provides word-frequency-derived **trade goods** (nouns hashed into a goods table — never shown raw), a **lore fragment** (1–2 procedurally templated sentences whose mood is keyed to section sentiment/category — generated text, *not* quoted article text), and services by body type (stations: refuel/repair/trade; planets: mining/salvage; anomalies: risk/reward events).

> **Licensing note:** Wikipedia text is CC BY-SA. If we ever display actual article prose, the game must attribute and share-alike that content. The clean solution — used throughout this spec — is to use wiki data only as *numbers and seeds*, never as displayed text. Facts and statistics aren't copyrightable; prose is. Stick to seeds.

---

## 7. Roguelike Systems

- **Fuel** is the run clock. Jumps cost fuel scaled by destination "distance" (inverse link prominence — obscure links cost more). Refuel at stations (credits) or by skimming gas giants (slow, hazardous).
- **Hull** damaged by hazards (asteroid belts from reference-heavy articles, radiation near rare stars). Hull = 0 → run over.
- **Credits** from trading goods between systems (pageview-derived prices create natural trade routes between popular and obscure articles — emergent economy from the link graph!).
- **Meta-progression** (post-MVP): permanent star chart of visited systems; unlockable ship hulls.
- **Death/victory screen** shows the route taken — a constellation of the run — with a **"Decrypt Flight Log"** button. Decrypting plays a glitch/decode animation, then re-renders the constellation with every system's true Wikipedia article title revealed, jump by jump. The run retroactively becomes a story: "you died three jumps past *Fermentation* trying to reach *Byzantine Empire*." Include a share/export of the decrypted route (image or text). This is a core feature, not an Easter egg — it's the payoff that makes the hidden-authorship pillar land, and the thing players will screenshot.

---

## 8. Wikipedia API Integration

Use the **MediaWiki Action API** (`https://en.wikipedia.org/w/api.php`) + **REST summary** + **Wikimedia Pageviews API**.

Per-system fetch (batchable):

```
1. action=query&prop=info|categories|links&inprop=length
   &plnamespace=0&pllimit=500&titles={title}&format=json
2. action=parse&page={title}&prop=sections
3. GET wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
   en.wikipedia/all-access/user/{title}/monthly/{start}/{end}
```

**Client etiquette & resilience**

- Set a descriptive `User-Agent` (required by Wikimedia policy). Respect `maxlag`; back off on 429s.
- **Cache aggressively**: local store (SQLite / IndexedDB) keyed by title. First visit fetches + snapshots; revisits are fully offline. Pre-fetch the metadata of all gate destinations when entering a system so jump transitions never stall on network.
- **Offline/failure fallback**: if a fetch fails, generate a degraded system from the title hash alone ("sensor interference" — re-resolves next session).
- Bundle a small offline article-metadata pack (a few hundred systems) so the game is playable with zero network — also your demo build.

---

## 9. Tech Recommendations

**Constraint: this project will be primarily built by AI coding agents** (VS Code / Claude Code style). That changes the calculus — the stack is chosen for agent ergonomics: text-only project files, strong training-data representation, compiler feedback, CLI-driven test/run loops, and the ability for the agent to visually inspect the running game.

**Chosen stack: Web — TypeScript + PixiJS + Vite + Vitest.**

| Need | How the stack serves it |
|---|---|
| Generation quality | TypeScript is the best-represented language in model training data; far fewer hallucinated APIs than GDScript |
| Tight feedback loop | `tsc` errors are immediate and precise; Vitest runs the golden-file determinism tests headlessly in milliseconds |
| Visual iteration | Agent launches the Vite dev server and screenshots the canvas via Playwright — it can *see* the game and iterate |
| API layer | Wikimedia APIs are CORS-friendly JSON; `fetch` + IndexedDB snapshot cache are native territory |
| Distribution | Zero-install web build; desktop later via Tauri if wanted |

Raw Canvas2D is acceptable for M0; adopt PixiJS when nebula shaders and particle effects arrive (M3).

**Considered and passed on:**

- **Godot 4** — viable for agents in principle (all-text project files, `--headless` CLI for tests/exports, GUT test framework), but three real costs: models persistently confuse Godot 3 vs 4 syntax (changed signal/export APIs), `.tscn` scene files are corruptible when hand-edited by agents, and there's no good way for an agent to visually inspect a running build. Revisit only if the project outgrows hand-rolled rendering.
- **Unity** — poor agent fit: binary/YAML asset soup, editor-centric workflow, licensing weight. Out.

**Architecture rule (unchanged and now even more important):** generation is a pure, framework-free module `generate_system(metadata) -> SystemSpec` with golden-file tests — same input must produce byte-identical output. Agents can develop and verify the entire heart of the game with no browser in the loop; rendering and simulation are thin consumers of `SystemSpec`.

---

## 10. Milestones

**M0 — Toy (1–2 weekends):** Vite + TypeScript project; fetch one hardcoded article, `generate_system()` produces a SystemSpec with golden-file tests, render star + planets + gates on Canvas2D, fly around with the control scheme, gates print destination titles to console.

**M1 — Graph walk:** jumping works end-to-end with caching; name generator live; system map; fuel cost on jump.

**M2 — Roguelike skeleton:** fuel/hull/credits, docking + refuel, death + run summary **with Decrypt Flight Log** (it's cheap to build early and makes every playtest end on a high), curated start pool.

**M3 — Texture:** trade goods, lore fragments, anomaly systems (disambig/redirect/uncharted rules), nebula backgrounds per palette, audio. First combat pass (pirates in high-traffic systems) if M2 lands early.

**M4 — Shell, goal & ship (rebuilt 2026-06):** main menu + pause shell (title screen with New Run / Continue / Controls; Esc pause with Abandon Run); run goal — survive N jumps, with a victory variant of the Decrypt Flight Log; minimal synthesized Web Audio SFX (deferred from M3; no asset files); fail-early no-network UX on new-run start (**offline article pack: cut** — snapshot cache + degraded fallback already cover mid-run failures; a fresh run with no API access should error clearly, not silently degrade); secret-keeping playtest ("can anyone tell it's Wikipedia?"); balance fuel economy / trade / salvage / hazards; production build + acceptance script, ship it.

---

## 11. Resolved Decisions

1. **Stub links → uncharted gates** (§4.5). Risky, cheap, deterministic risk/reward table; dead ends are content.
2. **No combat in v1.** Hazards + economy carry runs. Pirates/patrols are a planned post-MVP addition (target M3+) — design the hull/damage system now so combat slots in without rework.
3. **Language-edition galaxies: cut.** Parked indefinitely; nothing in the architecture should preclude it, but no work goes toward it.
4. **Snapshot-on-first-visit caching: confirmed.** Doubles as API politeness — each article is fetched once per player, ever. Per-player galaxies may diverge slightly by first-visit date; accepted.
5. **Decrypt Flight Log: core feature** (§7). Post-run reveal of true article titles along the route, with shareable export.

## 12. Deferred / Later

- Combat layer (pirates, patrols, weapons) — post-v1
- Meta-progression (persistent star chart, ship unlocks)
- Language-edition galaxies — parked
- **The Erasure (working name)** — a system-eating cosmic threat that advances through the galaxy detonating stars behind the player, replacing the survive-N jump counter as the source of movement pressure. Post-decrypt punchline writes itself: the thing eating the sum of all knowledge is *deletion*. Post-v1.
- Offline article pack — cut from M4 (2026-06); revisit only if a zero-network demo build is ever needed
- Image export of the decrypted constellation (text export shipped in M2)
