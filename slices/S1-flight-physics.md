# S1 — Flight physics & gameplay mechanics

Builds only against `src/contracts/`. Lives in `src/physics/` (+ tests).
Consumed later by maps (S6/S7). Use the S0 debug level pattern to add a
physics playground level ("physlab") for manual testing; keep it behind a
`?level=physlab` query param.

## Deliverables

1. **Vessel controllers** implementing `VesselController` per `VesselMode`:
   - **csm**: single main thruster along body axis; rotate CW/CCW input
     applies torque (with angular damping); thrust applies force at engine
     mount. High thrust-to-weight (~1.8× hover) so pulsing is mandatory.
     Fuel drain while thrusting.
   - **lander**: two thrusters offset left/right of COM. Left/right engine
     inputs fire them independently; each applies force along body-up at
     its offset → both = climb, one = torque + tilt + lateral drift. No
     direct rotation input. Small passive angular damping so it's hard but
     learnable. Tunable offsets/thrust in one constants module.
   - **harpoon**: no thrusters. 1–2 harpoon guns: aim (InputFrame aim
     vector), fire → raycast to first anchorable surface within range →
     create rope (distance joint w/ motorized reel: reel in/out changes
     rest length within min/max), release → free flight, re-fire mid-air.
     Second gun optional per level param. Rope renders as segmented line
     (expose anchor + length in VesselState.ropeState).
   - **harpoonThrust**: harpoon + csm-style thruster combined (levels 6–8).
2. **Crash/landing**: contact impulse over threshold → hull damage; over
   crash threshold → crash event. Soft-land detection (low velocity, legs
   down within angle tolerance, sustained contact) → softLand event.
   Landed state enables beacon planting.
3. **Environment systems** (driven by LevelSpec zones/entities):
   - Per-level gravity + `gravityRamp` (interpolate gravity magnitude
     along scroll progress).
   - Gravity zones (AABB/polygon regions overriding gravity direction/
     magnitude for bodies inside, incl. inverted).
   - Wind gust scheduler: timed lateral force events with wind-up warning
     lead time (emit event so render/audio can telegraph).
   - Debris spawners: physics balls raining from roof regions, colliding
     with the vessel.
   - Goo balls: spawned blobs that steer toward the vessel; on contact,
     weld to hull adding mass/drag (stacking); a goo ball inside the
     thruster exhaust cone (while thrusting) for >0.4 s burns away
     (attached or approaching). Events for attach/burn.
   - Radiation pulses: emitter charges (event for telegraph), then fires;
     line-of-sight ray from emitter to vessel; blocked by static terrain/
     props → safe, else radiationHit (−30% fuel).
   - Brittle regions: harpoon anchors inside them break after 1–2 s
     (ropeBroken event).
   - Orbs & fuel pickups: sensor contact → collect events, fuel refill.
   - Beacon sites: sensor zone; softLand inside + hold 1 s → beaconPlanted.
4. **Tuning constants** in one module per mode (thrust, fuel rates,
   thresholds, rope speeds) — S6/S7 will tune per level via LevelSpec
   overrides (add an optional `physicsOverrides` passthrough if contracts
   allow; if not, propose a contract amendment rather than hacking).
5. **Tests**: deterministic vitest sims — e.g. lander both-engines climbs
   straight; single engine produces tilt + lateral motion; csm hover pulse
   duty cycle stays within band; rope pendulum conserves plausible energy;
   gravity zone flips acceleration; goo attach increases effective mass;
   radiation LOS blocked by occluder; brittle anchor breaks; crash vs
   soft-land thresholds.

## Non-goals
Art (rectangles fine), levels, UI, audio, boss AI (S7).

## Acceptance
- `npm test` + `npm run build` green.
- `?level=physlab` demonstrates all three modes (mode-switch key in the
  playground), gravity zone, wind, goo, debris, radiation, orb, beacon —
  each verifiable by playing.
