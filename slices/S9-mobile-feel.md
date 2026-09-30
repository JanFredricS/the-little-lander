# S9 — Mobile feel: fullscreen, scaling, tuning, top thrusters

Post-release slice from the user's real-phone playtest. Runs alone on main.

> Orchestrator-pre-approved contract amendments: (a) InputFrame / input
> contracts may gain top-thruster controls (topLeft/topRight) and a
> swapped-thruster-buttons setting; (b) lander tuning fields for the top
> thrusters. No other contract changes without stopping the line.
>
> amendment made: enginesChanged gains optional topLeft/topRight (orchestrator-approved, audit cycle 1)

1. **Landscape browser toolbar** eats the screen on phones. Port the
   pineapple-run FS1 approach (read
   /Users/janfredricsandvik/dev/pineapple-run/src/ui/fullscreen.ts and
   ui/chrome.ts + its index.html dvh CSS): Fullscreen API from a user
   gesture where supported (Android/iPad/desktop); on iPhone Safari an
   over-height scroll body so swiping up collapses the toolbar, with a
   "swipe up for fullscreen" hint overlay while the toolbar is showing
   in landscape, and #app position:fixed over 100dvh.
2. **Portrait letterboxing**: the game shows with large black side bars
   in portrait. Make the scaler fill the screen better in portrait:
   allow fractional (non-integer) scale in portrait so the 640×360 view
   spans the full width (keep integer scaling in landscape where it
   already fits well; keep pixel crispness acceptable — round to
   half-integer steps if plain fractional shimmers). Touch buttons may
   sit in the remaining top/bottom bars.
3. **Map 1 difficulty**: lower hangarRun gravity and reduce lander
   thrust acceleration a bit (per-level overrides only, FIELD_RANGES
   valid). Symptom: once you gain speed it is too fast to kill again.
   Keep map 1 forgiving; re-run the map-1 pilot and fuel margins.
4. **Top thrusters on the lander**: when sideways/upside down on the
   ground you cannot right yourself. Add two top-mounted thrusters to
   the lander (and harpoonThrust pod if trivial — else lander only):
   physics engines at top anchors firing opposite to the main pair, so
   an inverted vessel can lift and flip. Two additional inputs:
   keyboard (suggest Q/E or S-row keys that don't clash with existing
   A/D/W/arrows), touch = two additional smaller buttons above the
   existing L/R engine buttons. Art: nozzles + flames on top anchors
   (S2 vessel sprite update), fuel drain same per-thruster rate. HUD
   controls-help cards updated. Tests: inverted-on-ground vessel can
   lift off and right itself using top thrusters in a scripted run.
5. **Swapped thruster buttons (touch)**: try the flipped mapping — the
   LEFT touch button fires the RIGHT thruster and vice versa (tilt
   toward the button you press). Make flipped the DEFAULT on touch, add
   a settings toggle ("SWAP ENGINE BUTTONS") to restore direct mapping,
   persisted in the save. Keyboard mapping unchanged. Top-thruster
   buttons follow the same swap.

## Acceptance
- `npm test` + `npm run build` green; all pilots/playthrough tests pass.
- Verified in browser emulation: portrait fills width, landscape hint
  logic, top thrusters right an inverted lander, swapped touch mapping.
