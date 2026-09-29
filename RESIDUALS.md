# Residuals

Findings still open after a slice's fix cycles + fresh-context fixer round.
Format: slice · severity · finding · why parked.

- S2/S1 · medium · Physics vessel collision dims differ from sprite sizes
  (art is offset-fitted to the collision bottom; overhangs remain) · parked
  for S8: harmonize tuning geometry with VESSEL_SIZES.
- S2 · medium · Terrain renders as flat-color polygons; generated terrain
  tiles are warmed but not drawn · parked for S6/S7/S8 terrain mesh pass.
- S2 · low · Zones, debris, goo, pickups, beacons, radiation use
  placeholder shapes; rope is a plain line (harpoon heads are sprites) ·
  parked for S6/S7/S8 visual pass.
- S1 · low · Contract amendment proposal: add bodyContacts/contact
  impulses to PhysicsApi (currently a physics-local extension with a
  narrowing adapter) · decide at S8.
- S5 · low · No world-position stereo panning (audio has no camera data);
  fixed pans only · fine unless S8 wants it.
- S5 · low · Harpoon reel sound keyed to harpoonMissed (no ropeReeling
  event in contracts) · S8 may add the event.
