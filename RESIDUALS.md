# Residuals

Findings still open after a slice's fix cycles + fresh-context fixer round.
Format: slice · severity · finding · why parked.

## Open (re-parked at S8, with justification)

- S5 · low · No world-position stereo panning; SFX use fixed pans · re-parked
  at S8. The audio engine gets only GameEvents and has no camera data, so
  panning needs a camera to audio feed (a new App hook plus per-event
  screen-x). The playfield is 640 px wide and the vessel stays near the
  centre, so the audible gain is small against a cross-module change this
  late. Revisit with a camera-aware audio pass.
- S7 · low · s7Helpers.ts: s7Blob/s7Band/s7Noise seed differently from
  kit's blobPoints/roughen · re-parked at S8. Merging would change the
  geometry of maps 5-8, which are tuned and pinned by the S7 pilots, the
  playthrough test and the fuel margins. s7Notch now reuses kit's
  surfaceY (level specs verified byte-identical). s7Piece, s7Prop,
  s7Scatter and s7Profile have no kit equivalent.
- S7 · low · Crumbling ledges on maps 7-8 are a shaded ruin slab
  (Graphics), not tiles. Their chunks are debris sprites since S8 · re-parked.
  The slab is a moving, breaking body that the chunk tile cache cannot
  serve, and it reads well in play. A tiled ledge needs a per-ledge
  canvas like moving islands, which is cosmetic only.
- S7 · low · Keeper tendrils are procedural Graphics strokes, not sprites ·
  re-parked. They bend and burn per frame (physics-driven lengths and
  angles), so a sprite strip would look worse. The draw is one Graphics
  per frame, and a whole keeper-fight frame measured about 0.3 ms median.

## Resolved at S8

- S2/S1 · medium · Vessel collision dims vs sprite sizes: tuning geometry
  harmonized with VESSEL_SIZES (be93434).
- S2 · medium · Flat-colour terrain: terrain chunks are painted with the
  S2 tiles. S8 added a chunk paint budget and canvas recycling (a859c67).
- S2 · low · Placeholder shapes: zones, debris, goo, pickups, beacons,
  radiation and the rope are pooled S2 sprites. Gravity zones have a tint
  and chevrons, the debug outlines are gone (eab4c92, 3160918), and S7
  rocks are boulder sprites (a859c67).
- S1 · low · bodyContacts: added to PhysicsApi as an orchestrator
  pre-approved contract amendment. The physics-local FlightPhysics
  extension and its narrowing adapter are deleted (4efc48b).
- S5 · low · Reel sound keyed to harpoonMissed: a new `ropeReeling` event
  (orchestrator pre-approved amendment) drives harpoonReel (in/out
  variants). harpoonMissed has its own `harpoonMiss` SFX (4efc48b).
- S7 · low · Playtest visual notes (4 items):
  - The brittle-zone rectangle is replaced by cracks and a crumbling rim
    painted into the terrain.
  - Fuel pickups are sprites.
  - The map 6 backdrop seam is hidden behind a two-screen far layer with a
    dithered mist base (eab4c92).
- S8 (found here) · medium · Hull-hit SFX intensity divided the 0..1 hull
  delta by 30 (percent units), so hits were almost silent. It now scales
  by HARD_HULL_LOSS, with a regression test (ccc58bd).
