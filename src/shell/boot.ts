/**
 * Initial screen actions from the URL. The root URL boots to the title
 * screen (Continue / level select). `?level=<id|map1..map8>` is the debug
 * shortcut straight into a level (no cutscene, no unlock check); an unknown
 * level value falls back to the title.
 */

import type { ScreenAction } from '../contracts';
import { resolveLevelParam } from '../levels/registry';

export function bootActions(params: URLSearchParams): ScreenAction[] {
  const level = resolveLevelParam(params.get('level'));
  return level ? [{ type: 'start' }, { type: 'selectLevel', levelId: level }] : [];
}
