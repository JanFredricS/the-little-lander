# S5 — Procedural audio

Builds only against `src/contracts/` (GameEvents, ThemeId). Lives in
`src/audio/` + tests. Everything synthesized in WebAudio at runtime — no
audio files.

## Deliverables

1. **Engine**: WebAudio graph with master/music/sfx gain buses, mute +
   volume persisted (localStorage, try/catch), init on first user
   gesture (autoplay policy), suspend on visibilitychange.
2. **SFX** (subtractive/FM synth + noise, chiptune character): thruster
   loop (per-mode timbre, starts/stops with thrust, pitch wobble),
   harpoon fire/hit/reel/release/break, crash & hull hit, soft-land
   thump, beacon plant chime, orb pickup arpeggio, fuel pickup, goo
   attach (wet blip) & burn (sizzle), radiation charge whine + blast,
   wind gust whoosh, debris clatter, UI move/confirm, dialogue
   typewriter blips, boss roar/hurt.
3. **Music**: small procedural sequencer (scale + chord progression +
   seeded melody, square/triangle/noise voices) with one mood per
   ThemeId: hangar = calm mechanical, asteroid = tense accelerando (hook
   to gravityRamp progress), islands = airy wonder, caves = sparse echoing,
   core = luminous, boss = driving, collapse = frantic; plus title and
   cutscene underscore. Crossfade on theme change.
4. **Event wiring**: subscribe to GameEvent stream; no gameplay imports
   beyond contracts.
5. **Tests**: sequencer determinism (seeded note streams), event→sfx
   mapping table completeness, volume persistence.

## Non-goals
Gameplay, art, UI. No audio assets/files.

## Acceptance
- `npm test` + `npm run build` green.
- `?audiolab=1` debug route: buttons to trigger every SFX and switch
  every music mood live.
