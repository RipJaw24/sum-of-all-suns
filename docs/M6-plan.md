# M6 — Visual Identity Pass ("the seams stay hidden, the galaxy gets a face")

> Status: 🔜 planned. Branch target: `m6-visual-identity` (off `main` after M5 merges).

M6 turns the simulation M5 shipped into something that *looks* like a living galaxy:
faction-styled stations, NPC ships with real presence, refined worlds, a proper
player ship, and faction-colored UI. It is a **presentation pass** — reorderable
with the M7 audio pass, and it adds **zero gameplay systems**.

---

## The governing constraint (read this first)

The renderer is a **strictly read-only consumer of `SystemSpec`** (`renderer.ts`
header; SPEC §9). Every visual signal M6 needs **already exists as a pure field**:

| Pure field (already on the spec) | Drives in M6 |
|---|---|
| `faction.id` → `FACTIONS[].tint`/`disposition` | Station silhouette, hull style, UI tint, emblem |
| `faction.contested` | Border/contested station + gate styling |
| `habitation` (`sterile`→`teeming`) | Station scale & lights, world night-lights, NPC density |
| `biome` (`verdant`/`industrial`/`civic`/`machine`/`barren`) | World surface tint & detail |
| `station` (`StationSpec`) | Whether/where a station renders |
| existing `bodies`/`star`/`gates`/`belt` | Refined body pass |

Therefore **M6 is entirely renderer/display-side**:

- **No `GEN_VERSION` bump. No golden-file changes. No new `SystemSpec` fields.**
- Display→look mappings live in **renderer-side tables** (the `palettes.ts`
  pattern: "gen stores only an id; what it *looks* like lives here, so tuning
  never touches goldens").
- **Procedural only** — canvas-baked textures like `glowTexture`/`planetTextures`,
  no image/sprite asset files. Headless-screenshot-safe and consistent with the
  whole project (the lone asset-file exception in repo history is M4's menu OGG).

If any task seems to need a new spec field, that's a signal it belongs in a future
sim milestone, not M6.

---

## Where the visuals stand today (the gap M6 closes)

- **Stations**: a single 8×8 cyan tick mark — `renderer.ts:356-361`. No structure,
  no faction identity.
- **NPCs + projectiles**: flat triangles/dots on the **2D overlay**, outside the GL
  scene, colored only by hostile/type — `main.ts:741-786`. The code itself flags
  the intent: *"M6 gives agents real sprites in the GL scene."*
- **Player ship**: a bare 4-point poly, no engine glow — `renderer.ts:142-145`.
- **Bodies**: already richly textured (`planetTextures.ts` via
  `renderer.ts:377-474`) but **ignore `biome`/`habitation`** — a teeming civic
  world looks identical to a sterile barren one.
- **Faction tint**: exists and reaches the HUD name + nebula
  (`palettes.ts:64`, `renderer.ts:595-607`) — but nothing else.

---

## Phases (each independently shippable; M5 used the same rhythm)

### Phase 0 — Visual language tables (scaffolding, no visible change)

New renderer-side display tables, the `palettes.ts` discipline:

- `src/game/factionVisuals.ts` — keyed to `FACTIONS` ids:
  `{ tint, accent, stationStyle, hullStyle, emblem }`, with `disposition`-driven
  defaults (militarist = blocky/armed, merchant = ringed dock, scientific = dish
  array, industrial = gantry, zealot = spire, outlaw = scavenged).
- `src/game/habitationVisuals.ts` — `habitation`/`biome` → world night-light
  density, station scale multiplier, surface-tint nudges.

**Tests:** `factionVisuals.test.ts` / `habitationVisuals.test.ts` pin **full
coverage** of all 8 faction ids and every `disposition`/`habitation`/`biome` enum
value (the alignment-pinning pattern used for `PALETTES`↔`MOODS`). A missing/extra
key fails the test — the same guardrail that keeps the palette table honest.

### Phase 1 — Station graphics

Replace the tick mark with a real GL station node on the body:

- Hub + ring/spokes; **silhouette by `disposition`**, **scale & light count by
  `habitation`** (teeming = larger, more blinking lights; sterile = a lone relay).
- **Faction-tinted** structure + accent; `contested` stations show a warning
  accent / damaged trim.
- Slow rotation and light-blink animated in `draw()` (like the pulsar strobe /
  gate flicker already there).
- Docking-range affordance (subtle ring) so the dock prompt reads spatially.
- Canvas-baked texture(s) cached per style, mirroring `glowTexture`.

**Acceptance:** screenshot on dock approach shows a faction-styled station; two
different-faction stations are visibly distinct.

### Phase 2 — Body rendering refinement (FULL pass)

Bodies get the milestone's deepest art pass, still inside the `planetTextures`
system and still pure-field-driven:

- **Atmospheres & terminator**: stronger day/night terminator shading, atmospheric
  rim scatter tuned per body type; gas giants get softer limb darkening.
- **Surface detail per `biome`**: verdant → green continents/vegetation mottling;
  industrial/machine → sodium-orange waste glow + grid hints; civic → temperate
  land + dense night-lights; barren → muted regolith.
- **Night-side city lights** on `settled`/`teeming` worlds (density from
  `habitationVisuals`), occluded correctly by the sphere mask.
- Refined ring shading and moon terminators to match.
- **Determinism note:** all new looks derive from existing `seed`/`biome`/
  `habitation` via the same per-body `Rng(hash128(...))` streams already used —
  no reroll of existing motion/label streams (keep the `:motion` seed strings
  byte-identical so existing systems don't shift).

**Acceptance:** screenshot sweep across all `BodyType`×`biome` combinations
(extend `verify-planets.ts`/`screenshot-planets-*`); a teeming civic world is
visibly alive vs. a sterile barren one.

### Phase 3 — Player-ship pass

- Better hull silhouette (still a small, readable triangle-class craft).
- Additive **engine glow** gated on thrust (the renderer already receives thrust
  intent via `input`→`ship`; thread a `thrusting` flag into `draw()` if not
  already available).
- Brief **hit-flash**/shield shimmer on hull damage (reuse the `damageFlash`
  signal already in `HudState`).

**Acceptance:** screenshot with thrust on shows engine glow; ship reads as a
designed craft, not a wireframe.

### Phase 4 — NPCs + projectiles into the GL scene

Move the ephemeral encounter layer off the overlay and into WebGL:

- New `agentLayer` + `projectileLayer` containers on the renderer.
- `syncAgents(agents)` with a **create/destroy-by-id** diff (copy `syncDerelicts`,
  `renderer.ts:525`), plus per-frame transform updates in `draw()`.
- Sprites **styled by `AgentType`** (trader/patrol/pirate/drifter) and **faction
  tint**; hull bars; additive **engine trails**.
- Projectiles as **additive glow tracers** (player vs. hostile color), replacing
  the overlay dots.
- Delete the agent/projectile drawing in `main.ts` `drawEncounter`; keep only the
  text affordances (e.g. the distress-beacon label) on the overlay, or migrate
  those too.

**Acceptance:** `verify-m6.ts` asserts `agentLayer` child count tracks the live
agent list via the `__sas` hook; combat screenshot shows tinted NPC ships + tracers.

### Phase 5 — Faction-colored UI

- Faction **emblem chip** + styled **standing bar** in the HUD (extends the
  existing faction-name tinting at `renderer.ts:595-607`).
- **Gate markers tinted by *destination* faction** (not just kind) where known;
  `GATE_COLORS` becomes a base mixed with faction tint.
- **Station + map markers** faction-colored; disposition iconography on the chart.
- Contested systems get a consistent UI accent across HUD/gates/station.

**Acceptance:** screenshots of HUD + chart show faction identity at a glance;
unaligned-frontier still reads as neutral.

### Phase 6 — Verify + screenshots + docs

- `scripts/verify-m6.ts` (Playwright, the `verify-m2…m5` pattern): structural
  assertions via the `?debug __sas` hook — station node present in the scene graph,
  `agentLayer` child count == live agents, faction tint applied to HUD/station —
  plus an `extractPixels` sanity check and a screenshot sweep across faction /
  habitation / biome variety.
- Add the `npx vite-node scripts/verify-m6.ts` line to the README run list; flip
  the **M6 milestone row → ✅**.
- **Secret-keeping audit:** confirm no laundered Wikipedia title leaks through any
  new label, emblem, or tooltip (the M5 audit, repeated for new surfaces).
- Update memory `m5-scope-decisions` (or a new `m6-scope-decisions`) with what
  shipped and any deferrals.

---

## Risks & watch-items

- **Headless WebGL stability** — WebGL is pinned for the GLSL nebula and stable
  Playwright screenshots (`renderer.ts:154`); keep all new effects on the same
  WebGL path, no WebGPU-only features.
- **Overdraw/perf** — additive trails + station lights + city-lights on up to 6
  NPCs and several bodies; cache baked textures, animate via cheap
  `tilePosition`/`alpha`/`rotation` tweaks (no per-frame texture regen), as the
  existing planet/lava code already does.
- **Determinism drift by accident** — visuals must read existing seed streams
  without inserting new `Rng` draws into shared seed strings; if a new look needs
  randomness, use a *new* seed suffix so it can't perturb generation. Golden tests
  must stay green untouched.
- **Overlay→GL migration regressions** — moving NPCs/projectiles into GL changes
  draw order relative to the HUD; verify HUD/vignette still composite on top.

## Definition of done

- All phases merged; `npm test` + `npm run typecheck` green; **goldens unchanged**.
- `verify-m6.ts` passes against the live dev server.
- README milestone table shows M6 ✅; screenshots refreshed.
- A faction's territory is identifiable from stations, NPCs, worlds, and UI without
  any text — the seams still never show.
