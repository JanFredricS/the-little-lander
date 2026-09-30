# S10 — Dynamic brake-assist thrust

User feedback: after switching direction it is hard to brake — once you
have speed it takes too long to kill it.

Feature: when a thruster fires AGAINST the vessel's current velocity
(retro-burn), boost its thrust initially and taper the boost back to
normal as the opposing speed drops.

Mechanics (tuning fields, not contract changes):
- Per mode: `brakeBoost` (max multiplier, e.g. 1.5) and `brakeBoostRef`
  (speed in px/s at which full boost applies; boost scales linearly from
  1.0 at 0 px/s opposing speed up to `brakeBoost` at >= ref speed).
- The boost applies per engine, scaled by how directly the engine's
  thrust vector opposes the velocity: factor = max(0, -dot(thrustDir,
  vNorm)) so a perpendicular burn gets no boost and a pure retro-burn
  the full one. Smooth — no discontinuity when the velocity flips.
- Fuel drain stays at the un-boosted rate (the assist is a game-feel
  aid, not a fuel penalty).
- Modes: lander ON by default (brakeBoost ~1.5, ref ~180 px/s), csm ON
  but gentler (~1.3 — retro-burns are map 2's core skill; keep it a
  skill), harpoonThrust same as lander. Fields registered in
  FIELD_RANGES; per-level overrides allowed.

Tests: boost factor math (pure function: zero at rest, full at ref,
perpendicular unaffected, smooth across flip); braking distance from a
reference speed measurably shorter with assist than with it forced to
1.0; existing pilots/playthrough/fuel-margin tests stay green (re-tune
pilots only if a map got EASIER-but-slower, never harder).

## Acceptance
- `npm test` + `npm run build` green; all pilots pass.
- Browser check: lander at speed visibly stops quicker on a retro-burn.
