import { App } from './app';
import { getAudio } from './audio';
import type { ScreenAction } from './contracts';
import { DEBUG_ROUTES } from './debugRoutes';
import { resolveLevelParam } from './levels/registry';

const host = document.getElementById('app');
if (!host) throw new Error('#app missing');

function fail(err: unknown): void {
  console.error(err);
  host!.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
}

// Mobile: no pinch-zoom / double-tap zoom / scroll / pull-to-refresh on the game.
const stop = (e: Event) => {
  if (e.cancelable) e.preventDefault();
};
host.addEventListener('touchmove', stop, { passive: false });
host.addEventListener('gesturestart', stop);
host.addEventListener('dblclick', stop);

const params = new URLSearchParams(location.search);
const route = DEBUG_ROUTES.find((r) => params.has(r.param));

if (route) {
  route.run(host, params.get(route.param) ?? '').catch(fail);
} else {
  // Until the menus land (S3/S4), the game opens straight into a level
  // (default: the debug testpad). ?screen=title stops at the title screen.
  const actions: ScreenAction[] = [];
  if (params.get('screen') !== 'title') {
    actions.push({ type: 'start' }, { type: 'selectLevel', levelId: resolveLevelParam(params.get('level')) ?? 'testpad' });
  }
  const audio = getAudio();
  const app = new App(host, {
    onEvent: (e) => {
      audio.handle(e);
      if (import.meta.env.DEV && (e.type === 'crash' || e.type === 'levelComplete')) console.info('[event]', e);
    },
    onScreen: (s) => audio.onScreen(s),
  });
  if (import.meta.env.DEV) (window as unknown as { __lander?: App }).__lander = app;
  app.start(actions).catch(fail);
}
