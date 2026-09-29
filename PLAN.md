# The Little Lander — Implementation Plan

A pixel-art physics side-scroller where you fly an Apollo-lunar-lander-style
vessel through seven story-mode maps on a fantastical planet. Published as a
playable web game on GitHub Pages.

Repo: `JanFredricS/the-little-lander` (public).

## Locked decisions

- **Stack:** TypeScript + Vite + Vitest, PixiJS v8 (WebGL) for rendering,
  Box2D v3 via `box2d3-wasm` (compat single-threaded build) behind our own
  wrapper module — same stack and physics approach as `pineapple-run`, with
  the wrapper adapted for per-level gravity, gravity zones, wind impulses,
  and rope/joint work (harpoon).
- **All art is generated in-game** (procedural pixel art, see below). No
  binary image assets in the repo.
- **Hosting:** GitHub Pages via Actions (same `deploy.yml` pattern as
  pineapple-run: test + build on push/PR, deploy on main).
- **Engine scale:** 30 px = 1 m. Fixed 60 Hz timestep, 4 sub-steps, render
  interpolation, simulation-time clock, pause on `visibilitychange`.
- **Map length:** real side-scroller lengths — 8,000–24,000 px of playfield
  per map (3–6 min traversal), scrolling camera with parallax backgrounds.
- **Delivery process:** Opus sub-agents implement slices (concurrent where
  possible, isolated worktrees), fresh-context Codex `sol-medium` audits,
  max 2 fix cycles, then one fresh-context Opus fixer cycle, then residuals
  to RESIDUALS.md. See PROCESS.md.

## Three flight modes

All modes share: fuel tank, hull integrity, crash on hard impact
(impulse threshold), soft-landing detection, rotation via torque with
angular damping.

1. **CSM mode** (lander + command/service module docked): one large main
   thruster along the vessel axis. High thrust-to-weight — holding it
   runaway-accelerates, so the core skill is **pulsing** short burns.
   Rotation keys (A/D or ←/→) rotate the whole stack to aim the thruster;
   thrust key (W/↑/Space) fires it. Heavy: high linear damping is *not*
   used — momentum is real.
2. **Lander mode** (legs, no CSM): **two independent thrusters**, left and
   right of center (keys: J = left engine, L = right engine, or ←/→; both =
   K/↑ optional "both" key). Both together → straight up. One alone (or
   pulsed asymmetrically) → torque tilts the vessel, and the tilted thrust
   vector moves you sideways. Differential pulsing IS the steering — no
   direct rotation input in this mode.
3. **Harpoon mode** (ascent-stage pod, no legs): 1–2 harpoon guns firing a
   retractable rope (Box2D distance joint with motorized reel) at cave
   roofs / floating islands. Aim with mouse or arrow keys, fire to attach,
   reel in/out, release to swing free, re-fire mid-air. Miss and fall too
   long (or float away in inverted-gravity zones) → crash. No thrusters
   (level 5 re-attaches a thruster stage: harpoon + thrusters combined).

## Physics features per level

- **Per-level gravity** (magnitude and comfort), **gravity ramps**
  (asteroid descent), **local gravity zones** (up/down/sideways regions),
  **wind gusts** (timed lateral force events), **debris rain** (dynamic
  bodies affecting the vessel), **goo balls** (semi-organic blobs that
  home on the hull, attach as weld joints adding mass/drag, burned off by
  pointing thruster exhaust at them), **radiation pulses** (line-of-sight
  check against occluders; hit = −30% fuel), **brittle anchors** (harpoon
  joints that break after a short timer), **collectible orbs** (points +
  fuel refill), **beacon placement** (soft-land in a marked zone, hold
  still to plant).

## Procedural pixel-art solution

- **Deterministic seeded generators** draw every sprite, tile, and
  backdrop into offscreen canvases at native low resolution (8–64 px
  sprites, 16 px terrain tiles), uploaded once to Pixi textures with
  `scaleMode: 'nearest'`, integer-scaled at render time. Same seed → same
  art, so "assets" are code and tuning numbers only.
- **Palette-first theming:** each map has a named 12–16 color palette
  (ramps of 3–4 shades per hue) defined in one theme catalog; generators
  only pick palette indices, never raw colors. Themes: `hangar` (steel
  blues/amber warning lights), `asteroid` (charcoal/ember orange/purple
  goo), `islands` (lush greens/sky cyan/sunset pink), `caves` (deep
  blue-black/god-ray gold/bioluminescent teal), `core` (tropical
  green/white sunlight/aurora violet), `boss` (abyssal purple/sickly
  green), `collapse` (ruin grey/alarm red/dawn gold).
- **Generator techniques:** mirrored-symmetry stamping for vessels and
  machinery; value-noise + threshold + outline pass for rocks and islands;
  cellular-automata caves; ordered-dither shading ramps; 1px dark outline
  + top rim-light pass for the classic pixel look; parallax backdrop
  layers (2–4 per theme) generated as wide tiling strips; animated sprites
  (thruster flames, goo pulse, orbs, water) as 2–6 frame generated flip
  sequences.
- **Cutscene stills** are generated too: full-screen (426×240 native,
  integer-scaled) composed scenes built from the same generators plus
  scene-specific composition code, with letterboxing and typewriter text.

## Story arc — "The Little Lander"

Retro-futuristic. The mothership **VSS Halcyon**, a generation survey ship,
arrives at **Aster** — a planet whose shattered crust floats in ribbons
above a glowing hollow interior. Pilot **Wren** (the player) and engineer
**Io** are assigned to find the ground team that went silent.

1. **Cutscene:** Halcyon briefing deck — Commander assigns Wren the survey.
2. **Map 1 — Hangar Run** (lander mode, ~8k px): thread the Halcyon's
   hangar decks — beams, gantries, parked vessels, closing blast doors.
   Ends docking with the CSM. *Cutscene:* inside the lander, Wren meets Io.
3. **Map 2 — Descent** (CSM mode, ~14k px, vertical-biased scroll):
   asteroid belt into the gravity well. Gravity ramps up; ends fast-paced
   among flaring, burning debris. Purple **goo balls** chase and cling —
   burn them off with the exhaust before they latch. *Cutscene:* cockpit —
   rough ride, then awe at the floating islands.
4. **Map 3 — The Floating Isles** (CSM → lander, ~18k px): Avatar-style
   floating islands, hanging vines, huge distant sky-creatures. At 1/3, a
   dragon-bird seizes the CSM — *cutscene:* emergency detach, escape.
   Continue in lander mode: plant **5 beacons** on progressively harder
   island sites (tight vegetation, overhangs), with sudden wind gusts.
   Ends at the abandoned science outpost. *Cutscene:* empty base — where
   did they go?
5. **Map 4 — The Throat** (lander mode, ~12k px): narrow cave descent,
   nimble flying. *Cutscene:* the lander can't fit deeper; Wren takes the
   pod with the harpoon rig.
6. **Map 5 — The Vaults** (harpoon mode, ~14k px): learn-to-swing caverns
   under god-rays from holes above lighting alien vegetation; two
   roof-collapse debris rains; brittle-rock stretches force constant
   re-anchoring; bioluminescent particles thicken with depth. Ends finding
   the research team — they've found something amazing. *Cutscene.*
7. **Map 6 — The Hollow** (harpoon + thrusters, ~16k px): tropical hollow
   interior — waterfalls, an artificial white sun, floating rock. Changing
   up/down gravity zones; collect glowing tech-orbs (points + fuel) for
   the team; the malfunctioning sun pulses radiation — hide behind rock or
   lose 30% fuel. *Cutscene:* the sun's keeper wakes.
8. **Map 7 — Boss: The Keeper** (harpoon + thrusters, arena): a cthulhu-like
   flying guardian. Burn its tendrils with the thruster, harpoon loose
   ceiling rock down onto it, dodge sweeps. *Cutscenes* before and after.
9. **Map 8 — The Mad Dash** (lander mode, ~10k px, fast): the hollow
   collapses; fly flat-out up through crumbling alien-city shafts, debris
   falling, closing gaps; escape through a hole in the crust as everything
   gives way. *Final cutscene:* reunion above the clouds, Halcyon pickup,
   Aster's sun stabilizing — the beacons Wren planted light the safe road
   for the colony.

(User will supply style-reference images later; palettes/generators are
parameterized so retuning to references is a tuning pass, not a rewrite.)

## Architecture

```
src/
  app.ts, main.ts        boot, screen/state machine (menu → story → level → cutscene)
  contracts/             S0-frozen interfaces: LevelSpec, ThemeId, VesselMode,
                         InputFrame, CutsceneScript, EntitySpec, events
  physics/               engine wrapper (box2d3-wasm), vessel controllers per mode,
                         harpoon/rope, zones (gravity/wind/radiation), goo, debris
  levels/                level specs (data modules), spawning, objectives, triggers
  art/                   seeded pixel generators: palettes, vessels, tiles, props,
                         backdrops, effects, cutscene stills
  render/                pixi scene, camera, parallax, particle FX, screen shake
  story/                 cutscene player, script data, dialogue text
  ui/                    HUD (fuel/hull/objectives), menus, level select, saves
  audio/                 WebAudio procedural chiptune SFX/music per theme
test/                    vitest unit tests per module
```

## Slices (for concurrent Opus agents)

- **S0 — Scaffold + contracts** (alone, first): repo scaffold, Vite/TS/
  Vitest, CI, state machine shell, `contracts/` frozen interfaces, physics
  engine wrapper boot, fixed-timestep loop, camera, input mapper, debug
  level. Everything later mocks against S0's contracts.
- **S1 — Flight physics** : three vessel controllers, fuel/hull/crash,
  harpoon rope, gravity zones, wind, goo, debris, radiation, orbs, beacons.
- **S2 — Pixel-art generation**: palette catalog, all sprite/tile/backdrop/
  effect generators, cutscene still compositor, art debug gallery page.
- **S3 — Story & cutscenes**: cutscene player, all scripts + dialogue,
  save/progress, level flow sequencing.
- **S4 — UI/HUD + menus**: HUD, pause, level select, results screens.
- **S5 — Audio**: procedural SFX + per-theme music loops, mixer.
- **S6 — Maps 1–4** (after S1+S2): level specs, terrain, objectives, tuning.
- **S7 — Maps 5–8** (after S1+S2): level specs, terrain, boss AI, tuning.
- **S8 — Integration + hardening** (last): wire everything, difficulty
  tuning, performance (pooling, culling), mobile-friendly checks, polish.

Concurrency: S0 alone → S1..S5 concurrent → S6+S7 concurrent → S8 alone.
Contract changes after S0 are stop-the-line (see PROCESS.md).
