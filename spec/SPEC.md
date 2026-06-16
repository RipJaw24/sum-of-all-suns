# SUM OF ALL SUNS
## Design & Technical Specification — v0.5 (title locked)

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

> **Post-v1 direction (M5+):** the galaxy gains inhabitants. NPCs, traders, factions, life, and light combat (§13–§16) add *texture and stakes* to the loop above — they do **not** replace survive-N as the pressure source (that role is still reserved for The Erasure, §12). The loop is unchanged; it now happens in a populated, politically-colored galaxy instead of an empty one.

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
- **Hull** damaged by hazards (asteroid belts from reference-heavy articles, radiation near rare stars) and, from M5, by **weapons fire** (§15). Hull = 0 → run over (death cause `destroyed` when a hostile lands the killing blow). The damage path is the same one combat was pre-designed against in v1.
- **Credits** from trading goods between systems (pageview-derived prices create natural trade routes between popular and obscure articles — emergent economy from the link graph!), and from M5, bounties on destroyed hostiles and faction-event payouts.
- **Standing** (M5) — per-faction reputation in run state (§13). Earned/lost by trading at faction stations, resolving events, and who you shoot. Gates prices, patrol hostility, and faction-locked services. Per-run for v1; meta-progression standing is deferred (§12).
- **Meta-progression** (post-MVP): permanent star chart of visited systems; unlockable ship hulls.
- **Death/victory screen** shows the route taken — a constellation of the run — with a **"Decrypt Flight Log"** button. Decrypting plays a glitch/decode animation, then re-renders the constellation with every system's true Wikipedia article title revealed, jump by jump. The run retroactively becomes a story: "you died three jumps past *Fermentation* trying to reach *Byzantine Empire*." Include a share/export of the decrypted route (image or text). This is a core feature, not an Easter egg — it's the payoff that makes the hidden-authorship pillar land, and the thing players will screenshot.

---

## 8. Wikipedia API Integration

Use the **MediaWiki Action API** (`https://en.wikipedia.org/w/api.php`) + **REST summary** + **Wikimedia Pageviews API**. This section covers the v1 signal set; **M5+ adds protection level, language count, Wikidata claims, and more — see §17 for the full catalogue and which call each rides in.**

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

**M4 — Shell, goal & ship (rebuilt 2026-06):** main menu + pause shell (title screen with New Run / Continue / Controls; Esc pause with Abandon Run); run goal — survive N jumps, with a victory variant of the Decrypt Flight Log; minimal synthesized Web Audio SFX (deferred from M3; no asset files) plus a sourced menu-music track (OGG static asset; starts on first user gesture per browser autoplay policy); fail-early no-network UX on new-run start (**offline article pack: cut** — snapshot cache + degraded fallback already cover mid-run failures; a fresh run with no API access should error clearly, not silently degrade); secret-keeping playtest ("can anyone tell it's Wikipedia?"); balance fuel economy / trade / salvage / hazards; production build + acceptance script, ship it. **(v1 shipped.)**

**M5 — The Living Galaxy (sim) — design locked 2026-06-14; shipped:** the empty galaxy gains inhabitants and politics, all still laundered from article metadata. Scope: **factions** derived deterministically from category clusters (MinHash over a coarsened category/P31 signature), producing contiguous territory from the link graph (§13); **life & habitation** classification from category class + language count + traffic (§14); an **NPC agent simulation** — traders, haulers, patrols, pirates, drifters — seeded per-system but run as ephemeral runtime state, never written into the pure `SystemSpec` (§15); **light combat** — one player weapon, hostile pirates/patrols, `destroyed` death cause, bounties — routed through the existing hull-damage path (§15); **per-faction reputation/standing** in run state, gating station prices and patrol hostility (§13, §7); **random events** — seeded system flavor (incl. the rare Erasure foreshadow) plus runtime encounters (ambush, distress) (§16). **Shipped:** `SystemSpec` gained pure `faction`/`habitation`/`biome` fields (schema v2, derived from `hash128` — no `GEN_VERSION` bump, golden diff purely additive); `RunState` gained per-faction `standing` (schema v5); new `gen/factions.ts`, `gen/habitation.ts`, `game/agents.ts`, `game/combat.ts`, `game/reputation.ts`, `game/events.ts`; `scripts/verify-m5.ts` proves it end-to-end; secret-keeping re-audit extended to faction names. Deferred to later passes: M5 reuses M4 SFX as placeholder combat cues (M7 does the real sound); patrol inspection / market-shock encounters remain seeded flavor; standing-from-trading is held back (a costless roundtrip would let players farm it).

**M6 — Visual Identity (graphics):** the visible payoff of M5's systems. Station graphics styled by faction + habitation; player-ship graphics pass; planet/body rendering refinement; NPC ship sprites; faction-colored HUD/map. Pure-asset/visual work, lower architectural risk — deliberately sequenced after the simulation that gives it meaning.

**M7 — Soundscape (audio pass):** M4 shipped only minimal synthesized SFX + a menu track; M5's combat, NPCs, factions, and events all generate sound that pass never covered. Scope: weapon-fire / impact / explosion cues for light combat; NPC & event stingers (hail, inspection, distress, ambush); per-faction and per-habitation **ambient beds** (sterile silence → teeming chatter) keyed to the §13–§14 fields; jump/dock/UI polish. Build on M4's Web Audio layer; sourced loops only where synthesis falls short (mind CC/licensing — same discipline as the menu track). **Note:** M5 reuses the existing M4 SFX system for *placeholder* combat fire/hit cues so combat isn't silent before this pass; M7 is the deliberate, complete sound design layer. M6/M7 are the two presentation passes after M5 and may be reordered if sound-after-combat is wanted sooner.

---

## 11. Resolved Decisions

1. **Stub links → uncharted gates** (§4.5). Risky, cheap, deterministic risk/reward table; dead ends are content.
2. **No combat in v1; light combat lands in M5.** Hazards + economy carried v1 as planned. The hull/damage system was built combat-ready; M5 now slots in pirates/patrols + one player weapon through that same path (§15), exactly as this decision anticipated. Combat stays *spice, not pillar* — discovery and economy remain the core, and the eventual headline pressure is still The Erasure, not firefights.
3. **Language-edition galaxies: cut.** Parked indefinitely; nothing in the architecture should preclude it, but no work goes toward it.
4. **Snapshot-on-first-visit caching: confirmed.** Doubles as API politeness — each article is fetched once per player, ever. Per-player galaxies may diverge slightly by first-visit date; accepted.
5. **Decrypt Flight Log: core feature** (§7). Post-run reveal of true article titles along the route, with shareable export.

## 12. Deferred / Later

- ~~Combat layer~~ — **light combat pulled into M5** (§15); full combat (loadouts, weapon variety, enemy roster, bounty boards) remains post-M5.
- Meta-progression (persistent star chart, ship unlocks) — **now also: persistent faction standing** carried across runs (M5 ships per-run standing only).
- Language-edition galaxies — parked
- **The Erasure (working name)** — a system-eating cosmic threat that advances through the galaxy detonating stars behind the player, replacing the survive-N jump counter as the source of movement pressure. Post-decrypt punchline writes itself: the thing eating the sum of all knowledge is *deletion*. **Targeted as the M8 capstone** after M5–M7 give it a populated, rendered, audible galaxy to threaten; M5 events seed the foreshadowing (§16). Post-v1.
- Offline article pack — cut from M4 (2026-06); revisit only if a zero-network demo build is ever needed
- Image export of the decrypted constellation (text export shipped in M2)

---

# M5 — THE LIVING GALAXY

> Sections §13–§16 specify M5. The governing constraint is unchanged: **every new thing is laundered from article metadata + the system seed.** Factions, life, NPCs, and events must never reveal that the galaxy is Wikipedia — the secret-keeping audit (§10) covers them too.

## 13. Factions: Categories → Territory

**The keystone of M5.** A faction is *palettes-but-for-politics*: derived deterministically from an article's categories, exactly like the ambient palette already is (`paletteIdFor`, generate.ts). Because articles that link each other tend to share top-level categories, **category-derived faction assignment produces contiguous territory along the link graph for free** — no fake political map, no hand-authoring. This is the same trick the whole game runs on, applied to politics. Pillars stay intact: hidden authorship (factions are category hashes, never shown as Wikipedia), determinism (two players see the same faction control the same systems), the-graph-is-the-game (territory *is* the link topology).

### 13.1 Derivation (pure, in `SystemSpec`)

Faction control is **world data** → it lives in `SystemSpec` (deterministic, golden-tested), not the runtime sim. Add to the spec:

```ts
faction: { id: FactionId; contested: boolean } | null   // null = unaligned frontier
```

- Curate **6–8 factions**, each a fixed archetype: id, name-generator phoneme style, palette bias, and a **disposition** ∈ `{ merchant, militarist, scientific, industrial, zealot, outlaw }`. Archetypes are static code (like `STAR_VISUALS`); only the *assignment* is data-driven.
- **Assign** via a *coarsened* category signature so neighbors cluster: hash the article's highest-level / most-common categories (not the full set) into a faction bucket. Coarsening is what makes territory regional rather than per-system noise — tune the coarsening grain so runs cross 2–4 systems of one faction before a border. **Sharpen with Wikidata `instance of` (P31)** where available (§17.2): the article's real ontological type is a far more stable disposition signal than category soup — a `country` leans militarist/civilian, a `chemical compound` industrial, a `taxon` (species) scientific/biological. Use P31 as the primary lever and the category hash as the fallback when no Q-id resolves.
- **Contested** = the category signature straddles two buckets near-evenly, traffic is high (busy lanes, §4.3), **or the article is edit-protected** (`inprop=protection`, §17.1) — the wiki's own "this page is fought over" flag maps directly onto contested space. Border/protected systems carry mixed presence and patrols; they're where light combat concentrates. Fully `sysop`-locked articles read as militarised faction cores.
- **Unaligned (`null`)** = stubs/anomalies (§4.5), shattered systems (§4.3), and low-category articles → lawless frontier; pirates roam, no patrols, best salvage, worst prices.

### 13.2 What faction does

| Surface | Effect |
|---|---|
| Naming | Station + system name flavor biased by the faction's phoneme style (extends §3.3) |
| Palette | Faction tint blended into the §3.4 ambient palette so a region reads as "theirs" |
| Stations | Services & price bias by disposition (merchant = cheap trade; militarist = repair/refuel, contraband checks) |
| NPCs | Which agent types spawn and their disposition toward the player (§15) |
| Reputation | Standing is tracked **per faction** (§13.3) |

### 13.3 Reputation / Standing (run state)

Per-faction standing lives in `RunState` (schema bump), **not** in `SystemSpec`:

```ts
standing: Record<FactionId, number>   // −100..+100, starts 0 (neutral)
```

- **Gains:** trading at a faction's stations, resolving its events favorably, destroying its enemies (pirates in its space, or a rival faction's hostiles).
- **Losses:** attacking its ships/patrols, smuggling contraband through its checks, aiding a rival.
- **Effects:** station price multiplier; patrol hostility threshold (below a floor → patrols attack on sight); access to faction-locked services and the occasional faction-gated gate; event availability.
- **Scope:** per-run for M5. Persistent cross-run standing is meta-progression (§12).
- **Decrypt payoff:** the post-run reveal (§7) can name the factions — "the trade compact you befriended were the systems under *Category:Logistics*" — a new layer on the hidden-authorship punchline. Nice-to-have, not required for M5.

## 14. Life & Habitation: Metadata → Who Lives Here

"System life determined by page metadata" — yes. A second pure classifier on `SystemSpec`, orthogonal to faction (faction = *who rules*, habitation = *how alive*):

```ts
habitation: 'sterile' | 'frontier' | 'settled' | 'teeming'   // + a biome hint
```

| Wiki signal | Habitation pull |
|---|---|
| **Wikidata `instance of` (P31)** (§17.2), category class as fallback (biology/organism → biospheres; geography/physics → industrial; culture/history → civilian; math/abstract → automated/sterile) | Biome flavor + whether bodies host life |
| **Language count** (`langlinks`, §17.1) | Civilization tier on the sterile → teeming axis: a 300-language article is a teeming capital; a 3-language one a frontier outpost |
| Pageviews / traffic (§3.2) | sterile → teeming axis (busy articles are crowded systems) |
| Infobox + section/body richness (§3.2) | Presence of settlements beyond the single station |

Habitation drives: life-bearing body rendering (M6), station aesthetic (organic vs industrial vs ceremonial), NPC density & type mix (§15), lore-fragment mood (extends §6), and ambient audio bias (M6). It must stay *flavor*, not a new resource — no "habitability score" the player farms.

## 15. NPCs, Agents & Light Combat

### 15.1 The determinism boundary (read first)

NPCs move, trade, and shoot — they are **mutable**, so they **cannot** live in `SystemSpec` (which is immutable, pure, golden-tested — types.ts invariant). The architecture:

- **`generate_system` stays pure.** It only emits the *static* faction/habitation fields (§13–§14) that tell the sim what to populate.
- **A new runtime module `game/agents.ts`** does `populate(spec, run, rng) → Agent[]`: a **seeded** initial spawn (count from `traffic`, types from faction + habitation) so a fresh arrival is reproducible, then a per-frame simulation that drifts freely. Agents are **ephemeral** — despawned on jump, never persisted, never canon. (They're flavor, not topology; the shared galaxy is the graph + the pure spec, and that's all that must agree across players.)
- This is the same separation v1 already uses for run state vs world data — agents are just the most dynamic case of it.

### 15.2 Agent types

| Type | Behavior | Source |
|---|---|---|
| **Trader / hauler** | Flies body↔gate routes; hailable to trade at field prices (no docking) | Any settled+ system; density ∝ traffic |
| **Patrol** | Faction ship; scans the player, may inspect for contraband; hostile if standing below floor | Faction-controlled, non-frontier systems |
| **Pirate** | Hunts the player & traders; drops bounty/cargo when destroyed | Frontier, contested, high-traffic lanes (§4.3) |
| **Civilian / drifter** | Ambient traffic; some are distress-event hooks (§16) | Density ∝ habitation |

### 15.3 Light combat (per the M5 decision)

- **One player weapon** (forward gun) — fire on a key; no loadouts/upgrades in M5 (deferred, §12).
- **Hostiles** (pirates always; patrols when standing is low or you fired first / carry contraband) shoot back. Damage routes through the **existing `damageHull`** path; reaching 0 hull sets death cause **`destroyed`** (new `DeathCause`).
- **Rewards:** destroyed hostiles drop credits (bounty) and sometimes cargo/fuel — folds into the existing loot/`isStranded` economy.
- **Keep it light:** dodge-and-shoot against a few enemies, not a combat sim. Discovery and economy stay the core (resolved decision #2). If combat starts overshadowing exploration in playtests, dial spawn rates down — that's the intended balance lever.
- **Files:** `game/agents.ts` (sim), `game/combat.ts` (weapons/damage), `game/reputation.ts` (standing), faction-aware tweaks to `game/market.ts`/`dock.ts`. New `verify-m5.ts` proves: faction assignment is deterministic, an NPC spawns & can be destroyed, standing changes prices, a `destroyed` death reaches the summary.

## 16. Random Events

Two flavors, both laundered from metadata:

1. **Seeded system events (deterministic flavor).** A characteristic event baked from the article's metadata, the same for every player: a biology/`teeming` system has a "bloom"; a high-pageview busy lane runs a market surge; a frontier salvage field has a derelict convoy. Generated like everything else — stable, shareable.
2. **Runtime encounters (ephemeral, seeded spawn).** Triggered during a visit: **distress call** (rescue for standing/reward, or a pirate trap), **patrol inspection** (contraband check — standing/cargo consequence), **pirate ambush**, **market shock** (prices swing). These read the live run state (fuel, standing, cargo) and resolve into it.

**Erasure foreshadowing (§12).** Reserve one rare event class for the M8 capstone: a system whose *adjacent* star has gone dark, refugees fleeing "something that unmakes systems," sensor ghosts where a gate's destination used to resolve. Pure flavor in M5 — it commits nothing — but it plants the thread so The Erasure arrives as payoff, not surprise. The post-decrypt line lands: the thing eating the sum of all knowledge is *deletion*.

---

## 17. Data Sources & Future Signals

v1 reads only article length, sections, links, categories, infobox/refs, and pageviews (§8). The public Wikimedia APIs expose far more, and most of the high-value signals ride in the **same `action=query` call we already make** — the Action API batches `prop=info|categories|links|langlinks|coordinates|pageprops|templates` with `inprop=protection` into one request. All endpoints below were verified live (2026-06-14); the snapshot-on-first-visit rule (§3, §8) covers every new field, so the determinism and drift contracts are unchanged.

**Licensing note:** Wikipedia content is CC BY-SA, but **Wikidata is CC0 (public domain)** — values pulled from Wikidata carry no attribution/share-alike obligation. We still keep to the numbers-and-seeds discipline (§6), but Wikidata is the freest source when in doubt.

### 17.1 Nearly free — already in the batched query

| Signal | API | Status | Mechanic |
|---|---|---|---|
| **Protection level** | `prop=info&inprop=protection` (`edit`/`move` → `autoconfirmed`/`sysop`) | **→ M5 §13** | The wiki literally flags which pages are fought over. Protected → guarded faction core / military lockdown / contested border; drives patrol density + combat intensity. |
| **Language count** | `prop=langlinks&lllimit=max` (Earth = 316) | **→ M5 §14** | Civilization tier: 300-language article = galactic capital; 3 = backwater. Baseline traffic, station tier, habitation. |
| **Wikidata Q-id** | `prop=pageprops` → `wikibase_item` | **→ M5 §13/§14** | Gateway to §17.2. Free — already returned. |
| **Maintenance templates** | `prop=templates&tltemplates=Template:Disputed\|Template:POV\|Template:Orphan\|Template:Refimprove` | Parked | `{{Disputed}}`/`{{POV}}` → contested; `{{Orphan}}` → isolated frontier; `{{Refimprove}}` → unstable/hazard. |
| **Coordinates** | `prop=coordinates` (GeoData; Paris → 48.86, 2.35) | Parked | Real places → deterministic galaxy-map position + a hard "physical place → settled world" classifier. |

### 17.2 One extra fetch — Wikidata claims (highest value)

Resolve `wikibase_item` → `wbgetentities&props=claims`. Verified on Q90 (Paris).

| Claim | Status | Mechanic |
|---|---|---|
| **`instance of` (P31)** | **→ M5 §13/§14** | Authoritative ontology (person / place / species / chemical / country / astronomical-object). Replaces fragile category-hashing for faction + life classification with a real type. |
| **`population` (P1082)** | Parked | Literal settlement population (Paris → 2,145,906) → habitation density, NPC count. |
| **`coordinate location` (P625)** | Parked | Structured galaxy position. |
| **mass / magnitude / distance** | Parked | Articles *about real stars/planets* → render with true astrophysical values. A quiet hidden-authorship payoff. |

### 17.3 Activity over time — Wikimedia Analytics REST

| Signal | Endpoint | Status | Mechanic |
|---|---|---|---|
| **Edits per page** | `wikimedia.org/api/rest_v1/metrics/edits/per-page/en.wikipedia.org/{title}/all-editor-types/monthly/{start}/{end}` | Parked | Volatility: boomtown vs ghost town → §16 event frequency, dynamic traffic. |
| **Editors per page** | `.../metrics/editors/per-page/...` | Parked | Population / inhabitant diversity. |
| **Article age** | `prop=revisions&rvdir=newer&rvlimit=1` (first edit) | Parked | Ancient ruins vs new colony → relics, tech level. |
| **Top-viewed** | `.../metrics/pageviews/top/...` | Parked | Dynamically pick "current events" busy lanes (§4.3). |

### 17.4 Graph signals beyond outbound links

| Signal | API | Status | Mechanic |
|---|---|---|---|
| **Inbound links (centrality)** | `prop=linkshere&lhnamespace=0` (paginated → continue token; cap ">N = hub") | Parked | Hub/capital systems, faction capitals, fame→value. **Revises §4.5's "never fetch inbound links"** — worth it for hub detection. |
| **Similarity** | `list=search&srsearch=morelike:{title}` (Photosynthesis → Photosystem, Chloroplast) | Parked | Connections by *similarity* not links → faction allies, trade partners, rumored kindred systems. |

### 17.5 Cost discipline

Every new signal = more to fetch on first visit. Mitigations, in priority order: **(1)** prefer §17.1 fields — they cost nothing beyond the existing call; **(2)** batch the Action API maximally; **(3)** Wikidata claims, analytics, backlinks, and `morelike` are *separate* round-trips — fetch them lazily and cache hard (snapshot-on-first-visit means once per player, ever); **(4)** never block a jump on §17.2–17.4 — they enrich a system, they don't gate entry, so degrade gracefully (§8 "sensor interference") if any fail.
