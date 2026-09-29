import { App } from './app';
import { DEBUG_ROUTES } from './debugRoutes';
import { bootActions } from './shell/boot';

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
  // Root URL -> title screen (Continue / level select); ?level=<id> jumps straight in.
  const actions = bootActions(params);
  const app = new App(host, {
    onEvent: import.meta.env.DEV ? (e) => (e.type === 'crash' || e.type === 'levelComplete' ? console.info('[event]', e) : undefined) : undefined,
  });
  if (import.meta.env.DEV) (window as unknown as { __lander?: App }).__lander = app;
  app.start(actions).catch(fail);
}
