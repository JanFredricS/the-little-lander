import type { ArtPalette } from '../core/palette';
import type { Pix } from '../core/pix';

/** A generated cutscene still: 426×240 index buffer + its own limited palette. */
export interface Still {
  pix: Pix;
  palette: ArtPalette;
}
