# S6 — Maps 1–4 (Hangar, Descent, Floating Isles, The Throat)

> Note: terrain tile pass orchestrator-approved (terrain rendering replaced
> by the tiled pass on orchestrator instruction; ratified in the Codex audit).

Requires S1 (physics) + S2 (art) merged. Lives in `src/levels/` + tests.
Real side-scroller lengths (PLAN.md story section has full descriptions):

1. **Map 1 — Hangar Run** (`lander`, ~8,000 px horizontal): Halcyon hangar
   decks per pixel-space-station-deck ref: beams, gantries, parked
   vessels, timed blast doors, tight clearances that teach differential
   thrust. Low, comfortable gravity (ship's spin-grav ~0.4 g). Ends at
   exitDock (dock with CSM: enter dock sensor slowly, aligned).
2. **Map 2 — Descent** (`csm`, ~14,000 px, diagonal/vertical scroll):
   asteroid belt into the gravity well. gravityRamp 0.15 g → 1.2 g.
   Boulder fields → glowing ember debris streams (debrisSpawners) →
   fast-paced finale. Goo-ball spawners mid-map (teach burn-off).
   Rotating to aim retro-burns is the core skill.
3. **Map 3 — The Floating Isles** (`csm` first third, then `lander`,
   ~18,000 px): floating islands + vines + distant creatures per the two
   floating-islands refs. At 1/3: scripted dragon-bird event → cutscene
   hook → mode switch to lander (contract's mid-level switch trigger).
   Then 5 beaconSites of increasing difficulty (open pad → vegetation
   pockets → overhang → small swaying island → tight vine shaft), wind
   gust schedule intensifying. Ends at the abandoned outpost.
4. **Map 4 — The Throat** (`lander`, ~12,000 px descending): narrow cave
   descent, god-ray shafts, alien vegetation, squeeze passages needing
   precise differential pulses; a couple of debris trickles. Ends at a
   landing pad (soft-land to finish).

For each: LevelSpec data module (terrain chains, entities, zones,
objectives, cutscene hooks per PLAN.md), per-level physics tuning
overrides, difficulty curve pass (map 1 forgiving fuel/hull; map 4
demanding), and a fun pass — playtest and adjust until each map is
beatable and fair (document tuning notes in the level file header).

**Tests**: LevelSpec validation (all specs pass the S0 validator; terrain
chains within worldSize; objectives reachable — e.g. exit/beacon sensors
positioned on/above solid ground; door timings admit passage), plus any
scripted-event state machines (dragon-bird sequence).

## Non-goals
Maps 5–8, boss, cutscene art/scripts (hooks only), UI, audio.

## Acceptance
- `npm test` + `npm run build` green.
- `?level=map1..map4` each playable start→finish; story flow order works.
