# S2 — Procedural pixel-art generation

> Palette-union, CSM 24×48 and warmup-API deviations from the original brief are orchestrator-approved (2026-09-30).

Builds only against `src/contracts/` (`ArtApi`, palettes, ThemeId,
StillId). Lives in `src/art/` (+ `src/render/` helpers it owns) + tests.
Style targets: research/inspiration/README.md and the images there —
open and study them before generating anything.

## Deliverables

1. **Palette catalog**: 12–16 color ramps per ThemeId as specified in
   PLAN.md ("Palette-first theming"). Shared helper for ramp shading and
   ordered dithering. All generators pick palette indices only. Each
   named ramp has 3–4 shades. A shared **craft palette** (`CRAFT`) is used
   for vessels, effects and cross-theme gameplay objects (goo, orbs,
   beacons, pickups, docks) so they read identically in every theme;
   themed props use their theme palette.
2. **Seeded RNG** (mulberry32 or similar) — same seed → identical pixels.
   Generation is memoised and lazy per asset (OffscreenCanvas when
   available), uploaded to Pixi textures with nearest scaling. An explicit
   preload API (`warmup(theme)`, `warmupStills(ids)`, time-sliced and
   abortable) is called from the level and cutscene start paths.
3. **Vessel sprites** (match the Apollo references: gold-foil descent
   stage, grey angular ascent stage, cone+cylinder+bell CSM, spindly legs
   with pads): csm stack (24×48, upright; the S0 stub box was 20×28), lander (~24×24), harpoon pod (~16×16),
   plus docked full-stack. 1px dark outline + top rim light. Thruster
   flame animations (2–4 frames, per-engine anchor points exposed),
   landing legs contact pose.
4. **Terrain tiles** per theme (16 px): surface, fill, edge variants,
   generated with value-noise/CA + outline pass. Theme props:
   - hangar: beams, gantries, rack modules, parked vessels, blast doors,
     amber screens (per pixel-space-station-deck ref)
   - asteroid: boulders (3 sizes), ember debris, purple goo ball (pulse
     anim)
   - islands: floating island chunks (top grass/jungle, hanging roots,
     waterfall strips), vines, beacon flag (plant anim), distant
     sky-creature silhouettes
   - caves: rock, god-ray light shafts, alien glowing vegetation,
     bioluminescent particle sprites, brittle-rock (visibly cracked)
   - core: tropical foliage, waterfalls, floating rocks, tech-orbs (glow
     anim), artificial sun (pulse/flare states)
   - boss: cthulhu-esque flying guardian (body + tendrils, 2-frame idle,
     hurt flash), loose ceiling rocks
   - collapse: ruined alien architecture, crumbling variants, falling
     debris
5. **Parallax backdrops**: 2–4 wide tiling layers per theme (e.g. islands:
   far haze islands + moon per floating-islands refs; caves: darkness
   gradient + distant glow).
6. **Cutscene stills**: compositor producing the ~10 StillIds the story
   needs (426×240): briefing deck, lander cockpit (two chars), cockpit
   awe view of islands, dragon-bird grabbing CSM, empty outpost, cave
   research team reunion, sun keeper wakes, boss aftermath, escape
   through crust, epilogue. Quality bar: pixel-astronaut-cabin ref —
   limited palette, strong warm-vs-cool lighting, big window/vista
   compositions. Reuse sprite generators + scene-specific composition.
7. **Art gallery debug page**: `?gallery=1` route rendering every sprite,
   tile set, backdrop and still with labels + a PNG export button (canvas
   toDataURL) so the whole set can be reviewed/exported at once. Also a
   small node/vitest-friendly export script if feasible; otherwise the
   button suffices.
8. **Tests**: determinism (same seed → same pixel hash), palette
   compliance (every sprite/tile/backdrop pixel ∈ theme palette ∪ shared
   craft palette ∪ transparent; themed props on the theme palette only;
   stills on their own ≤40-colour palettes), ramps 3–4 shades,
   size/anchor contracts for vessels, all ThemeIds/StillIds covered.

## Non-goals
Physics, levels, UI, audio, cutscene *player* (S3 — you provide stills).

## Acceptance
- `npm test` + `npm run build` green.
- `?gallery=1` shows the complete labelled art set per theme; craft
  sprites in their own section, and cross-theme objects additionally in
  every theme section over that theme's backdrop and tiles.
