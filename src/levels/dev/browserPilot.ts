/**
 * Browser playtest hook (dev only, never imported by the game): lets the
 * autopilot fly the REAL running game through the input mapper, from the
 * page console or a CDP script:
 *
 *   const m = await import('/the-little-lander/src/levels/dev/browserPilot.ts');
 *   m.fly(window.__lander);            // route for the current level
 *   m.status(window.__lander);         // { t, node, pos, fuel, hull, outcome }
 */

import type { InputSource, InputSourceSample } from '../../contracts';
import type { LevelSession } from '../../game/session';
import { Autopilot } from './autopilot';
import { ROUTES } from './routes';

interface AppLike {
  input: { add(src: InputSource): () => void };
}

let current: { pilot: Autopilot; remove: () => void } | null = null;

function sessionOf(app: AppLike): LevelSession | null {
  return (app as unknown as { session: LevelSession | null }).session;
}

export function fly(app: AppLike): string {
  stop();
  const s = sessionOf(app);
  if (!s) return 'no level running';
  const route = ROUTES[s.spec.id];
  if (!route) return `no route for ${s.spec.id}`;
  const pilot = new Autopilot(route);
  const src: InputSource = {
    id: 'autopilot',
    // physical engine frames: the App bypasses DIRECT steering while this is registered (any saved scheme)
    engineFrames: true,
    sample(): InputSourceSample {
      const sess = sessionOf(app);
      if (!sess) return { down: {}, pressed: {}, aim: null };
      const f = pilot.frame(sess);
      return { down: { thrust: f.thrust, engineLeft: f.engineLeft, engineRight: f.engineRight, rotateCW: f.rotateCW, rotateCCW: f.rotateCCW }, pressed: {}, aim: null };
    },
    clear() {},
    dispose() {},
  };
  current = { pilot, remove: app.input.add(src) };
  return `flying ${s.spec.id} (${route.length} nodes)`;
}

export function stop(): void {
  current?.remove();
  current = null;
}

export function status(app: AppLike): unknown {
  const s = sessionOf(app);
  if (!s) return null;
  const st = s.state;
  return {
    level: s.spec.id,
    t: +s.simTime.toFixed(1),
    node: current?.pilot.nodeIndex,
    pos: { x: Math.round(st.pos.x), y: Math.round(st.pos.y) },
    fuel: +st.fuel.toFixed(2),
    hull: +st.hull.toFixed(2),
    mode: st.mode,
    outcome: s.outcome,
  };
}
