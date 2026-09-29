/**
 * Debug routes: `?<param>=<value>` opens a tool page instead of the game
 * (e.g. S2 `?gallery=1`, S3 `?cutscene=<id>`, S5 `?audiolab=1`). Each slice
 * appends ONE entry here and keeps its page code in its own directory, so
 * concurrent slices only touch this list. Routes are lazy-imported so they
 * never bloat the game bundle.
 *
 * `?level=<id|map1..map8>` is not a route: the game itself starts that level.
 * The root URL boots to the title screen (src/shell/boot.ts).
 */

export interface DebugRoute {
  /** Query parameter that activates the route. */
  param: string;
  /** Mount the page into `host`. `value` = the parameter's value. */
  run(host: HTMLElement, value: string): Promise<void>;
}

export const DEBUG_ROUTES: DebugRoute[] = [
  { param: 'cutscene', run: async (host, v) => (await import('./story/debugCutscene')).mountCutsceneDebug(host, v) },
  // { param: 'gallery', run: async (host, v) => (await import('./art/gallery')).mountGallery(host, v) },
  { param: 'audiolab', run: async (host) => (await import('./audio/audiolab')).mountAudioLab(host) },
];
