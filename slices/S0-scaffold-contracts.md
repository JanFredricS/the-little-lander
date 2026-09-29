# S0 — Scaffold + frozen contracts

Runs alone on main. Everything later mocks against what S0 freezes.

## Deliverables

1. **Scaffold**: `package.json` (name `the-little-lander`, private, type
   module) with deps `pixi.js@^8`, `box2d3-wasm@^5` and devDeps
   `typescript`, `vite`, `vitest`, `@types/node` — mirror pineapple-run's
   setup (scripts: dev, build = `tsc --noEmit && vite build`, preview,
   test = `vitest run`, typecheck). `vite.config.ts` with
   `base: '/the-little-lander/'` for GitHub Pages and whatever
   exclude/optimizeDeps handling box2d3-wasm needs (see pineapple-run's
   config at ../pineapple-run/vite.config.ts). `tsconfig.json` strict.
   `index.html` mounting the game full-window, dark background,
   `image-rendering: pixelated` canvas.
2. **`src/contracts/`** — the frozen interfaces (types + docs only, no
   logic). At minimum:
   - `ThemeId`: 'hangar'|'asteroid'|'islands'|'caves'|'core'|'boss'|'collapse'
   - `VesselMode`: 'csm'|'lander'|'harpoon'|'harpoonThrust'
   - `InputFrame`: sampled digital inputs per tick (thrust, left/right
     engine, rotate CW/CCW, aim vector, fire/release harpoon, reel in/out,
     pause) — pure data, keyboard mapping lives elsewhere.
   - `LevelSpec`: id, title, themeId, vesselMode (+ optional mid-level
     mode switch trigger), worldSize (px), spawn, gravity (vec),
     gravityRamp?, terrain description (polyline/polygon chains +
     tile styling hints), entities: EntitySpec[] (kind + position +
     params), zones (gravityZone, windGustSchedule, radiationEmitter,
     brittleRegion), objectives (reachExit, plantBeacons(n, sites),
     collectOrbs, surviveBoss), cutsceneBefore?/After? (CutsceneId).
   - `EntitySpec` kinds: staticProp, debrisSpawner, gooSpawner, orb,
     beaconSite, movingIsland, vine, blastDoor, creature, bossSpawn,
     fuelPickup, exitDock.
   - `CutsceneScript`: id, shots: [{ still: StillId, textLines, durationOrAdvanceOnKey }].
   - `ArtApi`: what render needs from art — `getSprite(name, frame?)`,
     `getTile(theme, tileKind, variantSeed)`, `getBackdropLayers(theme)`,
     `getStill(stillId)` returning canvases/textures; plus the palette
     catalog type (named 12–16 color ramps per ThemeId).
   - `PhysicsApi`: step(dt), spawn/destroy body handles, vessel controller
     interface `VesselController { applyInput(frame, dt); state(): VesselState }`
     with VesselState (pos, vel, angle, fuel, hull, landed, attachedGoo,
     ropeState?).
   - `GameEvent` union: crash, softLand, beaconPlanted, orbCollected,
     fuelChanged, hullChanged, radiationHit, gooAttached/Burned,
     ropeAttached/Broken/Released, objectiveComplete, levelComplete,
     bossPhase, cutsceneDone.
   - `SaveState`: unlocked levels, per-level best (time, orbs), settings.
3. **Game shell**: screen state machine (boot → title → levelSelect →
   cutscene → playing → paused → results), fixed 60 Hz accumulator loop
   (4 physics sub-steps, render interpolation, 250 ms catch-up cap,
   pause + input clear on visibilitychange/blur), keyboard input mapper
   producing InputFrame, scrolling camera with world bounds + smoothing,
   Pixi app boot with nearest-neighbor scaling and integer zoom to fit a
   virtual 640×360 view.
4. **Physics wrapper boot**: box2d3-wasm loading, world create/step at
   30 px = 1 m, settable per-world gravity, body/joint helpers — port the
   approach from ../pineapple-run/src/physics/engine.ts (adapt, don't
   blind-copy; we need runtime-mutable gravity and per-body gravity scale).
5. **Debug level**: one hardcoded LevelSpec ("testpad": flat ground, a few
   boxes, placeholder rectangle vessel with a single thruster impulse on
   W) proving loop, physics, camera, input end-to-end. Placeholder art =
   flat-color rectangles via a stub ArtApi.
6. **Tests**: vitest for the accumulator/clock, input mapper, camera
   math, contract-shaped mock level validation. `npm run build` and
   `npm test` must pass. Keep `site/` placeholder removal + CI green.

## Non-goals
Real art, real vessels, real levels, audio, cutscene player, UI beyond a
debug HUD line. Do not implement S1–S7 features.

## Acceptance
- `npm ci && npm test && npm run build` green.
- `npm run dev` shows the debug level: rectangle vessel falls under
  gravity, W applies impulse thrust, camera follows, deterministic fixed
  step, pause on tab blur.
- `src/contracts/` compiles standalone and is documented enough that five
  concurrent slice agents can build against it without asking questions.
