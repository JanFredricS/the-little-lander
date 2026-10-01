import { App } from './app';
import { getAudio } from './audio';
import { DEBUG_ROUTES } from './debugRoutes';
import { bootActions } from './shell/boot';
import { installSwipeToFullscreen } from './ui/fullscreen';

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
  // Root URL -> title screen (Continue / level select). `?level=<id|map1..map8>`
  // starts that level directly (the menus still work from there; `?screen=title`
  // overrides it); `?debug` lists debug levels (testpad, physlab) in level
  // select; `?touch=on|off|auto` forces the on-screen touch controls (else the
  // saved preference applies).
  installSwipeToFullscreen(); // iPhone Safari: swipe-up hint while the landscape toolbar shows
  const actions = bootActions(params);
  const touchParam = params.get('touch');
  const touchPref = touchParam === 'on' || touchParam === 'off' || touchParam === 'auto' ? touchParam : undefined;
  const audio = getAudio();
  const app = new App(host, {
    ui: { showDebugLevels: params.has('debug'), touchPref, audioDiag: () => audio.diag },
    onEvent: (e) => {
      audio.handle(e);
      if (import.meta.env.DEV && (e.type === 'crash' || e.type === 'levelComplete')) console.info('[event]', e);
    },
    onScreen: (s) => audio.onScreen(s),
  });
  if (import.meta.env.DEV) (window as unknown as { __lander?: App }).__lander = app;
  app.start(actions).catch(fail);
}
