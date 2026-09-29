# S3 — Story, cutscenes, progression

Builds only against `src/contracts/`. Lives in `src/story/` + tests.
Uses stub stills (flat-color placeholder canvases behind ArtApi's
`getStill`) until S2 lands — code against the contract, not S2.

## Deliverables

1. **Cutscene player**: full-screen letterboxed still + typewriter
   dialogue text (bottom box, pixel font look via canvas-rendered text or
   a generated bitmap font), advance per shot via `CutsceneShot.advance` (`{ kind: 'duration', seconds }`
   auto-advances, any key skips ahead; `{ kind: 'key' }` waits for key/click/tap
   after typing finishes), skippable (hold Esc),
   multi-shot scripts per `CutsceneScript`. Emits cutsceneDone.
2. **All cutscene scripts + dialogue** for the story arc in PLAN.md
   (Halcyon briefing; Wren meets Io; awe at the isles; dragon-bird CSM
   loss; empty outpost; taking the pod; finding the research team; the
   keeper wakes; boss aftermath; escape + epilogue). Write the actual
   dialogue — warm, light, adventurous tone; Wren (player, they/them),
   Io (engineer), Commander. Keep lines short (fit a 2-line box).
3. **Level flow sequencing**: story mode = ordered LevelSpec ids with
   cutsceneBefore/After hooks; completing a level unlocks the next;
   game-over → retry level. Wire into the S0 state machine.
4. **Save/progress**: `SaveState` persisted to localStorage (guarded
   try/catch), unlocks, per-level best time/orbs, continue from title.
5. **Tests**: script advance logic, skip, sequencing/unlock rules, save
   round-trip + corrupted-save recovery.

## Non-goals
Real stills (S2), level content (S6/S7), menus beyond wiring into
existing state machine screens (S4 owns menu visuals).

## Acceptance
- `npm test` + `npm run build` green.
- `?cutscene=<id>` debug route plays any script with placeholder stills.
- Story sequence: finishing the debug level advances through cutscene →
  next-level flow with saved progress.
