/**
 * FROZEN (S0). What the renderer (and cutscene player / UI) needs from the
 * procedural art slice (S2), and the palette catalog shape.
 *
 * Rules for implementers (S2):
 *  - Every image is generated deterministically from code + seeds. Same
 *    inputs -> pixel-identical output.
 *  - Generators pick PALETTE INDICES, never raw colours (palette-first).
 *  - Images are returned as canvases at NATIVE pixel resolution; the render
 *    layer uploads them once as Pixi textures with scaleMode 'nearest'. ArtApi
 *    itself never imports Pixi (so it can run in workers/tests).
 *  - ArtApi calls are memoised by the implementation: repeated calls with the
 *    same arguments return the SAME object.
 *  - Unknown names never throw: they return a deterministic, clearly visible
 *    placeholder (magenta/black checker) so levels can reference art before
 *    it exists.
 */

import type { Rgb, Seed } from './common';
import type { StillId } from './cutscene';

/** Map themes (one palette + tile set + backdrop set each). */
export type ThemeId = 'hangar' | 'asteroid' | 'islands' | 'caves' | 'core' | 'boss' | 'collapse';

export const THEME_IDS: readonly ThemeId[] = ['hangar', 'asteroid', 'islands', 'caves', 'core', 'boss', 'collapse'];

/** A drawable surface. OffscreenCanvas where available, else a DOM canvas. */
export type PixelCanvas = HTMLCanvasElement | OffscreenCanvas;

// ----------------------------------------------------------------- palettes

/**
 * A ramp: palette indices ordered DARK -> LIGHT (3-4 shades of one hue).
 * Shading/dither code walks ramps; it never invents colours.
 */
export type PaletteRamp = readonly number[];

/** Ramp names every palette provides (a theme may alias ramps to the same indices). */
export type RampName =
  | 'shadow' // near-black outline / deepest shade
  | 'primary' // the theme's dominant material hue
  | 'secondary' // supporting material hue
  | 'accent' // warning lights, glows, pickups
  | 'sky' // backdrop/background hue
  | 'foliage' // vegetation / organic (may alias primary in non-organic themes)
  | 'light'; // highlights, rim-light, sun/god-ray

export interface Palette {
  themeId: ThemeId;
  /** Human-readable name, e.g. "Halcyon Hangar". */
  name: string;
  /** 12..16 colours. Index 0 is ALWAYS fully transparent in generated images (colour value ignored). */
  colors: readonly Rgb[];
  /** Named ramps into `colors`. */
  ramps: Readonly<Record<RampName, PaletteRamp>>;
  /** Index used for the 1px dark outline pass. */
  outline: number;
  /** Clear colour behind all backdrop layers. */
  background: Rgb;
}

/** The single theme catalog (S2 owns the values). */
export type PaletteCatalog = Readonly<Record<ThemeId, Palette>>;

// ------------------------------------------------------------------ sprites

/**
 * Sprite names are `<category>.<name>`. Core names that several slices rely
 * on are listed in CoreSpriteName; level-specific props / creatures use the
 * open `prop.*` / `creature.*` namespaces (S2 generates them; unknown ones
 * render as placeholders until then).
 */
export type CoreSpriteName =
  // vessels (pivot = centre of mass; nose points up at angle 0)
  | 'vessel.csm' // lander + command/service module stack
  | 'vessel.lander' // lander with legs, two engines
  | 'vessel.pod' // harpoon ascent-stage pod
  | 'vessel.podThrust' // pod with re-attached thruster stage
  | 'vessel.debris' // generic wreck chunk after a crash
  // effects (animated: several frames)
  | 'fx.flameMain' // big CSM exhaust
  | 'fx.flameSmall' // lander/pod engine exhaust
  | 'fx.explosion'
  | 'fx.spark'
  | 'fx.smoke'
  | 'fx.dust' // landing dust puff
  | 'fx.radiationPulse'
  | 'fx.windStreak'
  // gameplay objects
  | 'obj.goo' // animated purple goo ball
  | 'obj.orb' // animated tech orb
  | 'obj.fuel' // fuel canister pickup
  | 'obj.beacon' // planted beacon (animated light)
  | 'obj.beaconSite' // landing marker for a beacon site
  | 'obj.exitDock' // level exit / docking target
  | 'obj.harpoonHead'
  | 'obj.ropeSegment' // tiled along the rope
  | 'obj.debrisSmall'
  | 'obj.debrisLarge'
  | 'obj.debrisBurning' // animated
  | 'obj.blastDoor'
  | 'obj.vineSegment'
  // creatures / boss
  | 'creature.dragonBird'
  | 'creature.skyWhale'
  | 'boss.keeperBody'
  | 'boss.keeperTendril'
  | 'boss.keeperEye';

export type SpriteName = CoreSpriteName | `prop.${string}` | `creature.${string}`;

/** One frame of a sprite at native resolution. */
export interface SpriteFrame {
  canvas: PixelCanvas;
  /** Native size in px (== canvas size). */
  width: number;
  height: number;
  /** Pivot in px from the top-left (rotation/placement origin). */
  pivot: { x: number; y: number };
}

// -------------------------------------------------------------------- tiles

/** Surface material of a terrain chain; picks the tile family. */
export type TerrainMaterial = 'metal' | 'rock' | 'soil' | 'crystal' | 'organic' | 'ruin';

/** Role of a tile within a terrain piece. */
export type TileRole =
  | 'fill' // interior, tiles seamlessly in x and y
  | 'top' // surface strip facing up (grass/plating edge), tiles in x
  | 'bottom' // surface strip facing down (ceiling edge), tiles in x
  | 'side' // vertical surface strip, tiles in y (mirror for the other side)
  | 'decor'; // small overlay decoration (pebbles, bolts, moss)

/** `material:role`, e.g. 'rock:top'. */
export type TileKind = `${TerrainMaterial}:${TileRole}`;

// ---------------------------------------------------------------- backdrops

export interface BackdropLayer {
  canvas: PixelCanvas;
  width: number;
  height: number;
  /**
   * Parallax factor: 0 = fixed to the screen (sky), 1 = moves with the world.
   * Layers are returned far -> near.
   */
  parallax: number;
  /** Vertical placement: screen-space y (px, virtual view) of the layer's top edge at camera y = 0. */
  offsetY: number;
  /** Whether the strip repeats horizontally / vertically. */
  repeatX: boolean;
  repeatY: boolean;
}

// ------------------------------------------------------------------ the API

export interface ArtApi {
  readonly palettes: PaletteCatalog;
  /** Frame `frame` (default 0, wraps modulo the frame count) of a sprite, optionally themed. */
  getSprite(name: SpriteName, frame?: number, theme?: ThemeId): SpriteFrame;
  /** Number of animation frames (>= 1). */
  getSpriteFrameCount(name: SpriteName): number;
  /** A TILE_SIZE×TILE_SIZE tile. Different variantSeeds give interchangeable variants. */
  getTile(theme: ThemeId, tileKind: TileKind, variantSeed: Seed): PixelCanvas;
  /** 2..4 parallax layers, far -> near. */
  getBackdropLayers(theme: ThemeId): readonly BackdropLayer[];
  /** A STILL_WIDTH×STILL_HEIGHT cutscene still. */
  getStill(stillId: StillId): PixelCanvas;
}
