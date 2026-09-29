import type { ThemeId } from '../../contracts';
import type { Pix } from '../core/pix';
import type { ArtPalette } from '../core/palette';

/** A generated sprite: frames (same size) in one palette + a pivot. */
export interface SpriteDef {
  frames: Pix[];
  palette: ArtPalette;
  pivot: { x: number; y: number };
}

/** A registered sprite generator. */
export interface SpriteEntry {
  /** Theme used when the caller passes none (and for non-themed sprites, always). */
  home: ThemeId;
  /** Whether the requested theme changes the art (props drawn from theme ramps). */
  themed: boolean;
  /** Short description for the gallery. */
  note?: string;
  gen(theme: ThemeId): SpriteDef;
}
