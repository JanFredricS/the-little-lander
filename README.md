# The Little Lander

A pixel-art physics side-scroller: fly an Apollo-style lunar lander through
the shattered floating world of **Aster** — hangars, asteroid descents,
floating jungle islands, glowing caves, and the hollow heart of the planet.

**Play:** https://janfredrics.github.io/the-little-lander/ (deployed from
`main` via GitHub Pages)

- Three flight modes: pulsed single-thruster **CSM**, differential
  twin-thruster **lander**, and rope-swinging **harpoon pod**.
- Real physics (Box2D v3 / WASM): per-map gravity, gravity zones, wind,
  debris, clinging goo, radiation pulses.
- Every sprite, tile, backdrop and cutscene still is **generated in-game**
  as procedural pixel art — no image assets.
- Story mode: 8 maps with classic pixel-art cutscenes between them.

Docs: [PLAN.md](PLAN.md) (design + slices), [PROCESS.md](PROCESS.md)
(delivery process), [RESIDUALS.md](RESIDUALS.md). Style references in
[research/inspiration/](research/inspiration/).

## Develop

```
npm ci
npm run dev     # Vite dev server
npm test        # Vitest
npm run build   # typecheck + production build
```

URL flags (dev and production): `?level=<id|map1..map8>` starts a level
directly, `?debug` lists debug levels (testpad, physlab) in level select,
`?touch=on|off|auto` forces the on-screen touch controls.
