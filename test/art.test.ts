import { describe, expect, it } from 'vitest';
import { STILL_HEIGHT, STILL_WIDTH, THEME_IDS, TILE_SIZE } from '../src/contracts';
import type { CoreSpriteName, PixelCanvas, RampName, StillId, TileKind } from '../src/contracts';
import { createArt, placeholderPix, resolveSprite, TILE_VARIANTS } from '../src/art/art';
import { generateBackdrop } from '../src/art/backdrops';
import type { Pix } from '../src/art/core/pix';
import { mulberry32, seedOf } from '../src/art/core/rng';
import { CRAFT, PALETTES } from '../src/art/palettes';
import { spriteRegistry } from '../src/art/sprites/registry';
import { buildLander, getVesselAnchors, VESSEL_SIZES, type VesselSpriteName } from '../src/art/sprites/vessels';
import { generateStill, STILL_IDS } from '../src/art/stills';
import { asterFromOrbit, hangarLaunch } from '../src/art/stills/space';
import { allTileKinds, generateTile } from '../src/art/tiles';

const CORE_SPRITES: CoreSpriteName[] = [
  'vessel.csm', 'vessel.lander', 'vessel.pod', 'vessel.podThrust', 'vessel.debris',
  'fx.flameMain', 'fx.flameSmall', 'fx.explosion', 'fx.spark', 'fx.smoke', 'fx.dust', 'fx.radiationPulse', 'fx.windStreak',
  'obj.goo', 'obj.orb', 'obj.fuel', 'obj.beacon', 'obj.beaconSite', 'obj.exitDock', 'obj.harpoonHead', 'obj.ropeSegment',
  'obj.debrisSmall', 'obj.debrisLarge', 'obj.debrisBurning', 'obj.blastDoor', 'obj.vineSegment',
  'creature.dragonBird', 'creature.skyWhale', 'boss.keeperBody', 'boss.keeperTendril', 'boss.keeperEye',
];

const ALL_STILLS: StillId[] = [
  'asterFromOrbit', 'halcyonBriefingDeck', 'commanderPortrait', 'wrenPortrait', 'ioPortrait', 'hangarLaunch', 'landerCockpit',
  'csmCockpitRough', 'floatingIslandsVista', 'dragonBirdAttack', 'emptyOutpost', 'caveMouthPodTransfer', 'researchTeamFound',
  'hollowSunKeeper', 'keeperDefeated', 'collapseEscape', 'reunionAboveClouds', 'beaconRoadDawn',
];

const RAMPS: RampName[] = ['shadow', 'primary', 'secondary', 'accent', 'sky', 'foliage', 'light'];

/** Every pixel index must exist in the palette. */
function maxIndex(p: Pix): number {
  let m = 0;
  for (const v of p.data) if (v > m) m = v;
  return m;
}

/** Canvas stand-in for Node: records the RGBA written into it. */
function fakeCanvasFactory() {
  const made: { w: number; h: number; data?: Uint8ClampedArray }[] = [];
  const factory = (w: number, h: number): PixelCanvas => {
    const rec: { w: number; h: number; data?: Uint8ClampedArray } = { w, h };
    made.push(rec);
    return {
      width: w,
      height: h,
      getContext: () => ({
        createImageData: (iw: number, ih: number) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }),
        putImageData: (img: { data: Uint8ClampedArray }) => {
          rec.data = img.data;
        },
      }),
    } as unknown as PixelCanvas;
  };
  return { factory, made };
}

describe('seeded rng', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const c = mulberry32(1235);
    const sa = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(sa);
    expect(seedOf('caves', 'rock:fill', 3)).toBe(seedOf('caves', 'rock:fill', 3));
  });
});

describe('determinism (pixel hashes)', () => {
  it('tiles: same seed -> same pixels, different seed -> different pixels', () => {
    for (const theme of THEME_IDS) {
      const a = generateTile(theme, 'rock:fill', 7).hash();
      expect(generateTile(theme, 'rock:fill', 7).hash()).toBe(a);
      expect(generateTile(theme, 'rock:fill', 8).hash()).not.toBe(a);
    }
  });
  it('vessels and stills regenerate identically', () => {
    expect(buildLander(1, 'flight').pix.hash()).toBe(buildLander(1, 'flight').pix.hash());
    expect(asterFromOrbit().pix.hash()).toBe(asterFromOrbit().pix.hash());
    expect(hangarLaunch().pix.hash()).toBe(hangarLaunch().pix.hash());
  });
  it('every registry sprite regenerates identically', () => {
    for (const [name, entry] of Object.entries(spriteRegistry())) {
      const a = entry.gen(entry.home).frames.map((f) => f.hash());
      const b = entry.gen(entry.home).frames.map((f) => f.hash());
      expect(b, name).toEqual(a);
    }
  });
});

describe('palettes', () => {
  it('each theme has 12-16 colours, transparent index 0 and every ramp in range', () => {
    for (const theme of THEME_IDS) {
      const p = PALETTES[theme];
      expect(p.themeId).toBe(theme);
      expect(p.colors.length).toBeGreaterThanOrEqual(12);
      expect(p.colors.length).toBeLessThanOrEqual(16);
      for (const r of RAMPS) {
        const ramp = p.ramps[r];
        expect(ramp, `${theme}.${r}`).toBeDefined();
        expect(ramp.length, `${theme}.${r} has 3-4 shades`).toBeGreaterThanOrEqual(3);
        expect(ramp.length, `${theme}.${r} has 3-4 shades`).toBeLessThanOrEqual(4);
        for (const i of ramp) {
          expect(i).toBeGreaterThan(0);
          expect(i).toBeLessThan(p.colors.length);
        }
      }
      expect(p.outline).toBeGreaterThan(0);
      expect(p.outline).toBeLessThan(p.colors.length);
    }
  });

  it('sprite pixels belong to (theme palette ∪ shared craft palette ∪ transparent)', () => {
    const craft = new Set(CRAFT.colors.slice(1));
    for (const [name, entry] of Object.entries(spriteRegistry())) {
      // themed sprites render in every theme; fixed ones only in their home theme
      const themes = entry.themed ? THEME_IDS : [entry.home];
      for (const t of themes) {
        const allowed = new Set([...PALETTES[t].colors.slice(1), ...craft]);
        const d = entry.gen(t);
        // themed props must use their theme palette itself, never the craft palette
        if (entry.themed) expect(d.palette.colors, `${name}@${t} uses the theme palette`).toEqual(PALETTES[t].colors);
        for (const f of d.frames) {
          expect(maxIndex(f), `${name}@${t}`).toBeLessThan(d.palette.colors.length);
          const bad = new Set<number>();
          for (const i of f.data) if (i !== 0 && !allowed.has(d.palette.colors[i]!)) bad.add(d.palette.colors[i]!);
          expect([...bad].map((c) => c.toString(16)), `${name}@${t} off-palette colours`).toEqual([]);
        }
      }
    }
  });

  it('tiles and backdrops only use their theme palette', () => {
    for (const theme of THEME_IDS) {
      const n = PALETTES[theme].colors.length;
      for (const kind of allTileKinds()) expect(maxIndex(generateTile(theme, kind, 3)), `${theme} ${kind}`).toBeLessThan(n);
      for (const l of generateBackdrop(theme)) expect(maxIndex(l.pix), `${theme} ${l.label}`).toBeLessThan(n);
    }
  });

  it('stills use a limited palette of their own', () => {
    for (const id of STILL_IDS) {
      const s = generateStill(id);
      expect(s.palette.colors.length - 1, `${id} colours (excl. transparent)`).toBeLessThanOrEqual(40);
      expect(maxIndex(s.pix), id).toBeLessThan(s.palette.colors.length);
    }
  });
});

describe('vessel contracts', () => {
  const names = Object.keys(VESSEL_SIZES) as VesselSpriteName[];

  it('frame sizes match VESSEL_SIZES and anchors lie inside the sprite', () => {
    for (const name of names) {
      const { def } = resolveSprite(name);
      const size = VESSEL_SIZES[name];
      const anchors = getVesselAnchors(name);
      expect(anchors.engines.length, name).toBe(def.frames.length);
      def.frames.forEach((f, i) => {
        expect([f.w, f.h], name).toEqual([size.w, size.h]);
        for (const e of anchors.engines[i]!) {
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x).toBeLessThanOrEqual(f.w);
          expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.y).toBeLessThanOrEqual(f.h);
          expect(Math.hypot(e.dir.x, e.dir.y)).toBeCloseTo(1, 5);
          expect(['main', 'left', 'right']).toContain(e.engine);
          expect(['fx.flameMain', 'fx.flameSmall']).toContain(e.flame);
        }
      });
      for (const pt of [...anchors.guns, ...anchors.feet]) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(size.w);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeLessThanOrEqual(size.h);
      }
      expect(def.pivot.x).toBeGreaterThan(0);
      expect(def.pivot.x).toBeLessThan(size.w);
    }
  });

  it('every vessel has at least one engine; the lander has flight + contact poses', () => {
    for (const name of names) for (const frame of getVesselAnchors(name).engines) expect(frame.length, name).toBeGreaterThan(0);
    expect(resolveSprite('vessel.lander').def.frames.length).toBe(2);
    expect(getVesselAnchors('vessel.lander').feet.length).toBe(2);
    expect(getVesselAnchors('vessel.pod').guns.length).toBe(2);
  });

  it('flames animate with 2-4 frames', () => {
    for (const n of ['fx.flameMain', 'fx.flameSmall']) {
      const k = resolveSprite(n).def.frames.length;
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(4);
    }
  });
});

describe('coverage', () => {
  it('every core sprite name is generated (no placeholders)', () => {
    for (const n of CORE_SPRITES) expect(resolveSprite(n).known, n).toBe(true);
  });

  it('props used by the levels exist', () => {
    for (const n of ['prop.box', 'prop.crate', 'prop.pillar']) expect(resolveSprite(n).known, n).toBe(true);
  });

  it('every theme has a full 16px tile set and 3-4 backdrop layers', () => {
    const kinds = allTileKinds();
    expect(kinds.length).toBe(30);
    for (const theme of THEME_IDS) {
      for (const k of kinds) {
        const t = generateTile(theme, k as TileKind, 1);
        expect([t.w, t.h]).toEqual([TILE_SIZE, TILE_SIZE]);
      }
      const layers = generateBackdrop(theme);
      expect(layers.length, theme).toBeGreaterThanOrEqual(3);
      expect(layers.length, theme).toBeLessThanOrEqual(4);
      for (const l of layers) {
        expect(l.pix.w).toBe(640);
        expect(l.pix.opaqueCount()).toBeGreaterThan(0);
      }
      expect(layers[0]!.pix.opaqueCount(), `${theme} far layer is opaque`).toBe(l0Size(layers[0]!.pix));
    }
  });

  it('every StillId generates at 426x240, fully opaque', () => {
    expect([...STILL_IDS].sort()).toEqual([...ALL_STILLS].sort());
    for (const id of ALL_STILLS) {
      const s = generateStill(id);
      expect([s.pix.w, s.pix.h], id).toEqual([STILL_WIDTH, STILL_HEIGHT]);
      expect(s.pix.opaqueCount(), id).toBe(STILL_WIDTH * STILL_HEIGHT);
    }
  });
});

function l0Size(p: Pix): number {
  return p.w * p.h;
}

describe('ArtApi', () => {
  it('memoises: same arguments return the same object', () => {
    const { factory } = fakeCanvasFactory();
    const art = createArt({ canvasFactory: factory });
    expect(art.getSprite('vessel.lander', 0)).toBe(art.getSprite('vessel.lander', 0));
    expect(art.getTile('caves', 'rock:top', 3)).toBe(art.getTile('caves', 'rock:top', 3));
    expect(art.getBackdropLayers('islands')).toBe(art.getBackdropLayers('islands'));
    expect(art.getStill('asterFromOrbit')).toBe(art.getStill('asterFromOrbit'));
  });

  it('never throws for unknown prop./creature. names and returns a placeholder', () => {
    const { factory } = fakeCanvasFactory();
    const art = createArt({ canvasFactory: factory });
    const a = art.getSprite('prop.doesNotExist', 0, 'caves');
    const b = art.getSprite('creature.nope', 3);
    expect(a.width).toBe(16);
    expect(b.height).toBe(16);
    expect(art.getSpriteFrameCount('prop.doesNotExist')).toBe(1);
    expect(placeholderPix().opaqueCount()).toBe(256);
    // unknown tile kinds / stills also fall back
    expect(() => art.getTile('hangar', 'lava:top' as TileKind, 1)).not.toThrow();
    expect(() => art.getStill('notAStill' as StillId)).not.toThrow();
  });

  it('wraps frame indices and exposes sizes + pivots', () => {
    const { factory } = fakeCanvasFactory();
    const art = createArt({ canvasFactory: factory });
    const n = art.getSpriteFrameCount('fx.flameMain');
    expect(art.getSprite('fx.flameMain', n)).toBe(art.getSprite('fx.flameMain', 0));
    const csm = art.getSprite('vessel.csm');
    expect([csm.width, csm.height]).toEqual([VESSEL_SIZES['vessel.csm'].w, VESSEL_SIZES['vessel.csm'].h]);
    expect(csm.pivot.x).toBeGreaterThan(0);
  });

  it('warmup pre-generates a theme so level-time lookups create no canvases', async () => {
    const { factory, made } = fakeCanvasFactory();
    const art = createArt({ canvasFactory: factory });
    await art.warmup('caves');
    const before = made.length;
    expect(before).toBeGreaterThan(0);
    art.getSprite('vessel.lander', 0);
    art.getSprite('obj.goo', 0, 'caves');
    for (const seed of [0, 2, 3, 4, 7, 13, 1000, -1]) art.getTile('caves', 'rock:top', seed);
    for (const kind of ['rock:fill', 'rock:bottom', 'rock:side', 'rock:decor'] as TileKind[]) art.getTile('caves', kind, 7);
    art.getBackdropLayers('caves');
    expect(made.length).toBe(before);
    expect(art.getTile('caves', 'rock:top', 7)).toBe(art.getTile('caves', 'rock:top', 7 % TILE_VARIANTS));
    await art.warmupStills(['asterFromOrbit']);
    const n = made.length;
    art.getStill('asterFromOrbit');
    expect(made.length).toBe(n);
    const ac = new AbortController();
    ac.abort();
    await expect(art.warmup('boss', { signal: ac.signal })).resolves.toBeUndefined();
  });

  it('writes palette colours into the canvas (index 0 transparent)', () => {
    const { factory, made } = fakeCanvasFactory();
    const art = createArt({ canvasFactory: factory });
    art.getSprite('obj.orb', 0);
    const rec = made[made.length - 1]!;
    expect(rec.data).toBeDefined();
    const alpha = new Set<number>();
    for (let i = 3; i < rec.data!.length; i += 4) alpha.add(rec.data![i]!);
    expect([...alpha].sort()).toEqual([0, 255]);
    expect(CRAFT.colors.length).toBeGreaterThan(16);
  });

  it('themed sprites differ per theme; untyped calls use the home theme', () => {
    const { factory } = fakeCanvasFactory();
    const art = createArt({ canvasFactory: factory });
    const t = Object.entries(spriteRegistry()).find(([, e]) => e.themed)!;
    expect(art.getSprite(t[0] as `prop.${string}`, 0, 'caves')).not.toBe(art.getSprite(t[0] as `prop.${string}`, 0, 'hangar'));
  });
});
