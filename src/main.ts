import { App } from './app';
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
  // The game opens at the title screen. `?level=<id|map1..map8>` starts that
  // level directly (the menus still work from there); `?debug` lists debug
  // levels (testpad, physlab) in level select; `?touch=on|off|auto` forces the
  // on-screen touch controls.
  const actions: ScreenAction[] = [];
  const level = resolveLevelParam(params.get('level'));
  if (level && params.get('screen') !== 'title') actions.push({ type: 'start' }, { type: 'selectLevel', levelId: level });
  const touchParam = params.get('touch');
  const touchPref = touchParam === 'on' || touchParam === 'off' || touchParam === 'auto' ? touchParam : undefined;
  const app = new App(host, {
    ui: { showDebugLevels: params.has('debug'), touchPref },
    onEvent: import.meta.env.DEV ? (e) => (e.type === 'crash' || e.type === 'levelComplete' ? console.info('[event]', e) : undefined) : undefined,
  });
  if (import.meta.env.DEV) (window as unknown as { __lander?: App }).__lander = app;
  app.start(actions).catch(fail);
}
