# S4 — UI / HUD / menus

Builds only against `src/contracts/` (+ S0 state machine screens).
Lives in `src/ui/` + tests. Pixel-art styling: draw UI with the same
nearest-scaled 640×360 virtual resolution, chunky 1px-outline panels,
theme-tinted; no external fonts (canvas bitmap-font or generated font
texture consistent with S3's text rendering — coordinate via contracts;
if both need a shared pixel-font helper, put it in src/ui/font.ts and
have S3 consume it… it's fine for S3 to duplicate a minimal version
until S8 merges them).

## Deliverables

1. **HUD** (playing screen): fuel bar (flash under 25%), hull bar,
   objective tracker (beacons n/5, orbs count, "reach the exit"),
   mode indicator (csm/lander/harpoon), wind-gust warning arrow,
   radiation-charge warning, goo-attached count. Driven by GameEvents +
   VesselState polling.
2. **Screens**: title (logo generated as pixel text, starfield), level
   select (story map list w/ lock state + best results), pause overlay
   (resume/restart/quit), results (time, orbs, hull, retry/next),
   game-over (crash cause line, retry). Keyboard + mouse navigable.
3. **Controls help**: per-mode control card shown on level start
   (dismiss on first input) and from pause.
4. **Tests**: HUD state reducers from event streams, menu navigation
   logic, lock/unlock display logic.

## Non-goals
Gameplay, save logic (S3 owns SaveState; consume it), audio, art
generators (use ArtApi stubs where needed).

## Acceptance
- `npm test` + `npm run build` green.
- Full menu loop navigable with placeholder art: title → level select →
  (debug level) → pause → results → back.
