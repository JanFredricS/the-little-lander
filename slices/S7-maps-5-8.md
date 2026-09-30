# S7 — Maps 5–8 (Vaults, Hollow, Boss, Mad Dash)

> Orchestrator-ratified deviations (fix cycle 1): (a) the
> src/physics/vessel/harpoonRig.ts changes (collideConnected, reel stall
> probe, reel guard) are accepted as shared bug fixes — S1 flight harpoon
> tests + physlab determinism cover the regression scope; (b) `rectPoints`
> added to src/levels/kit.ts on orchestrator instruction (S6 is merged and
> complete, so kit.ts ownership has passed to integration).

Requires S1 + S2 merged. Lives in `src/levels/` (+ `src/levels/boss/`) +
tests. Coordinate file naming with S6 (S6 owns map1–4 modules; shared
level helpers belong to S6 — if you need one S6 didn't build, add it
under a distinct name).

1. **Map 5 — The Vaults** (`harpoon`, ~14,000 px, two chained sections):
   cave caverns. Section A = swing school: generous anchors under
   god-ray holes, alien vegetation, gentle pits. Section B = mastery:
   two roof-collapse debris rains, brittle-rock stretches (constant
   re-anchoring), deepening darkness with bioluminescent particle
   density increasing. Ends at the research team camp (soft landing).
2. **Map 6 — The Hollow** (`harpoonThrust`, ~16,000 px): tropical
   interior, waterfalls, floating rocks, artificial sun. Alternating
   gravity zones (down/up/sideways) forcing thrust-in-all-directions
   control; ~30 tech-orbs to collect (fuel refill + points); sun
   radiation pulses on a telegraphed schedule — LOS cover behind floating
   rock/terrain; hits cost 30% fuel.
3. **Map 7 — Boss: The Keeper** (`harpoonThrust`, arena ~4,000 px wide):
   cthulhu-like flyer. Boss AI phases: sweep attacks, tendril grabs
   (burn tendrils with thruster exhaust to break free), summon debris.
   Damage: harpoon loose ceiling rocks so they fall on it (main damage)
   + thruster burns on tendrils. 3 phases, health bar events, arena
   hazards escalate. Death → cutscene hook.
4. **Map 8 — The Mad Dash** (`lander`, ~10,000 px upward, fast): the
   hollow collapses. Auto-rising kill floor (collapse front) forces
   speed; crumbling alien-city shafts, falling debris, closing gaps,
   brittle platforms; ends shooting through a hole in the crust
   (exit at top) as everything gives way. Collapse-theme art.

Per level: LevelSpec data, tuning overrides, difficulty/fun pass with
notes. Boss AI unit-tested (phase transitions, damage accounting,
tendril grab/release, rock-drop hit detection). LevelSpec validation
tests as in S6 (anchorable roofs within harpoon range along the whole
route in map 5; orb/zone placement sane in map 6; map 8 always admits a
survivable line ahead of the collapse front at intended speed).

## Non-goals
Maps 1–4, cutscene art/scripts (hooks only), UI, audio.

## Acceptance
- `npm test` + `npm run build` green.
- `?level=map5..map8` each playable start→finish; boss beatable.
