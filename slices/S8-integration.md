# S8 — Integration, hardening, polish

Runs alone on main, after S1–S7. Scope:

1. Wire the full story flow end-to-end: title → briefing → map1 → … →
   epilogue → credits; verify every cutscene hook, mode switch, unlock.
2. Resolve RESIDUALS.md items (fix or re-park with justification).
3. Merge duplicated helpers (e.g. pixel font S3/S4), dead code sweep.
4. Performance: sprite/particle pooling, offscreen culling, texture
   atlas sanity, steady 60 fps on a mid laptop; no per-frame allocs in
   hot loops.
5. Feel pass: screen shake, thruster particles, hit flashes, camera
   look-ahead, landing dust — small, consistent.
6. Difficulty curve check across all 8 maps; fuel economy tuning.
7. Mobile verification on the deployed Pages site: touch controls work
   in every mode, no scroll/zoom gestures leak, integer scaling correct
   in both orientations, playable performance on a mid-range phone
   (verify at phone viewport via browser emulation at minimum).
8. README player-facing polish (controls table, screenshots from the
   gallery), itch-style landing page copy on index.html title screen.
9. CI green, Pages deploy verified live.

## Acceptance
- Full playthrough (all 8 maps) possible without console errors.
- `npm test` + `npm run build` green; deployed game verified.
