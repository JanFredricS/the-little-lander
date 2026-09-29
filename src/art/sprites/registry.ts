/**
 * Every named sprite generator, keyed by SpriteName. Unknown names are
 * handled by the ArtApi (placeholder).
 */

import type { ThemeId } from '../../contracts';
import type { SpriteDef, SpriteEntry } from './types';
import { vesselSprites } from './vessels';
import { fxSprites } from './fx';
import { objectSprites, themedObjectSprites } from './objects';
import { propSprites } from './props';
import { creatureSprites } from './creatures';

function fixed(home: ThemeId, gens: Record<string, () => SpriteDef>): Record<string, SpriteEntry> {
  const out: Record<string, SpriteEntry> = {};
  for (const [k, g] of Object.entries(gens)) out[k] = { home, themed: false, gen: () => g() };
  return out;
}

let registry: Record<string, SpriteEntry> | null = null;

export function spriteRegistry(): Record<string, SpriteEntry> {
  if (!registry) {
    registry = {
      ...fixed('hangar', vesselSprites()),
      ...fixed('hangar', fxSprites()),
      ...fixed('hangar', objectSprites()),
      ...themedObjectSprites(),
      ...propSprites(),
      ...creatureSprites(),
    };
  }
  return registry;
}
