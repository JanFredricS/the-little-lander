/**
 * S8 App-level story flow: the REAL App (src/app.ts) drives the whole story.
 *
 * What is real:
 *  - App's screen state machine, uiDispatch/story routing (selectLevel,
 *    results NEXT via continuePlan, cutscene chains, mid-level mode-switch
 *    cutscene, loop pausing);
 *  - SaveStore on in-memory storage;
 *  - InputMapper;
 *  - one real LevelSession per map, created by App.startLevel and stepped by
 *    App.step().
 *
 * What is faked, only at the render / DOM seams (no WebGL in node):
 *  - the Pixi host;
 *  - (test 2 only) one LevelSpec patched through a getLevel wrapper;
 *  - LevelView, which records the session it is handed;
 *  - GameUi, which records screens. Menu clicks go through the REAL
 *    screenModel + itemAction (src/ui/screens.ts), as GameUi.activate does;
 *    only drawing and pointer handling are skipped;
 *  - the cutscene player, which records scripts; the test finishes each one;
 *  - FrameLoop, which the test ticks by hand;
 *  - the keyboard / pointer sources: the "keyboard" replays the map's
 *    reference pilot through the real InputMapper.
 *
 * Pixi drawing itself is covered by the orchestrator's live browser
 * playtest. Any console.error / warn fails the test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_LEVELS } from '../src/contracts';
import type { ArtApi, CutsceneId, CutsceneScript, GameEvent, InputSampleContext, InputSourceSample, LevelId, LevelSpec, ScreenState } from '../src/contracts';
import type { LevelSession } from '../src/game/session';
import type { GameUiOptions } from '../src/ui/gameUi';
import type { ScreenContext } from '../src/ui/screens';
import { SaveStore, type StorageLike } from '../src/story/save';
import { MIN_COMPLETION_FUEL, pilotFor, type Pilot } from './support/storyPilots';

// ------------------------------------------------------------ fakes (render / DOM seams)

interface PendingCutscene {
  id: CutsceneId;
  onDone: (skipped: boolean) => void;
}

const h = vi.hoisted(() => ({
  session: null as LevelSession | null,
  pilot: null as Pilot | null,
  tick: 0,
  loop: null as null | { step: () => void; render: (a: number) => void; paused: boolean },
  /** The player's menu click on the current screen (real screenModel + itemAction, as GameUi.activate). */
  click: null as null | ((itemId: string) => void),
  uiScreens: [] as string[],
  pending: null as PendingCutscene | null,
  levelsStarted: [] as LevelId[],
  pilotFor: null as null | ((id: LevelId) => Pilot),
  /** Optional LevelSpec patch (the chained-cutscene test adds a cutsceneBefore). */
  patch: null as null | ((spec: LevelSpec) => LevelSpec),
}));

vi.mock('../src/levels/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/levels/registry')>();
  return {
    ...real,
    getLevel: (id: LevelId) => {
      const spec = real.getLevel(id);
      return spec && h.patch ? h.patch(spec) : spec;
    },
  };
});

vi.mock('../src/render/pixiApp', () => ({
  createPixiHost: async () => ({
    app: { ticker: { stop() {} }, stage: { addChildAt() {} }, render() {} },
    canvas: {},
    clientToView: () => ({ x: 0, y: 0 }),
    destroy() {},
  }),
}));

vi.mock('../src/render/levelView', () => ({
  LevelView: class {
    readonly root = {};
    constructor(readonly session: LevelSession) {
      h.session = session;
      h.pilot = h.pilotFor!(session.spec.id);
      h.tick = 0;
      h.levelsStarted.push(session.spec.id);
    }
    render() {}
    destroy() {
      if (h.session === this.session) {
        h.session = null;
        h.pilot = null;
      }
    }
  },
}));

vi.mock('../src/ui/gameUi', async () => {
  const screens = await import('../src/ui/screens');
  return {
    GameUi: class {
      holdSimulation = false;
      private state: ScreenState = { id: 'boot' };
      constructor(private readonly o: GameUiOptions) {
        h.click = (itemId) => this.activate(itemId);
      }
      /** Same context GameUi.ctx() builds (lastHull only affects results text). */
      private ctx(): ScreenContext {
        return {
          levels: this.o.levels(),
          save: this.o.save!(),
          showDebug: !!this.o.showDebugLevels,
          touchPref: 'auto',
          lastHull: null,
          ...(this.o.story ? { story: this.o.story() } : {}),
        };
      }
      /** GameUi.activate() minus the drawing: the item must be on screen and enabled. */
      private activate(itemId: string): void {
        const model = screens.screenModel(this.state, this.ctx());
        const item = model.items.find((i) => i.id === itemId);
        expect(item, `${this.state.id}: no menu item '${itemId}' (${model.items.map((i) => i.id).join(', ')})`).toBeDefined();
        expect(item!.enabled, `${this.state.id}: '${itemId}' disabled`).toBe(true);
        const a = screens.itemAction(this.state, itemId, this.ctx());
        if (!screens.isUiCommand(a)) this.o.dispatch(a);
        else if (a.ui === 'continueStory') this.o.onContinueStory?.();
        else throw new Error(`unexpected UI command ${a.ui}`);
      }
      enter(s: ScreenState) {
        this.state = s;
        h.uiScreens.push(s.id);
      }
      setLoading() {}
      onEvent() {}
      levelStarted() {}
      noteFrame() {}
      tick() {}
      render() {}
      destroy() {}
    },
  };
});

vi.mock('../src/story/cutscenePlayer', () => ({
  playCutscene: (_host: unknown, script: CutsceneScript, opts: { onDone: (skipped: boolean) => void }) => {
    expect(h.pending, `cutscene ${script.id} started while another is open`).toBeNull();
    h.pending = { id: script.id, onDone: opts.onDone };
    return {
      destroy() {
        if (h.pending?.id === script.id) h.pending = null;
      },
    };
  },
}));

vi.mock('../src/shell/clock', () => ({
  FrameLoop: class {
    paused = false;
    constructor(cb: { step: () => void; render: (a: number) => void }) {
      h.loop = Object.assign(cb, { paused: false });
      const self = this; // keep one paused flag for App and the test
      Object.defineProperty(h.loop, 'paused', { get: () => self.paused });
    }
    start() {}
    stop() {}
    bindVisibility() {}
    setPaused(p: boolean) {
      this.paused = p;
    }
  },
}));

vi.mock('../src/shell/input', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/shell/input')>();
  /** "Keyboard": replays the active map's pilot frame (edge controls as presses). */
  class PilotKeys {
    readonly id = 'keyboard';
    sample(_ctx: InputSampleContext): InputSourceSample {
      if (!h.session || !h.pilot) return { down: {}, pressed: {}, aim: null };
      const f = h.pilot(h.session, h.tick++);
      return {
        down: { thrust: f.thrust, engineLeft: f.engineLeft, engineRight: f.engineRight, rotateCW: f.rotateCW, rotateCCW: f.rotateCCW, reelIn: f.reelIn, reelOut: f.reelOut },
        pressed: { fire: f.fire, release: f.release, pause: f.pause },
        aim: f.aim.x !== 0 || f.aim.y !== 0 ? { dir: f.aim, target: f.aimTarget } : null,
      };
    }
    clear() {}
    dispose() {}
  }
  class NoPointer {
    readonly id = 'pointer';
    sample(): InputSourceSample {
      return { down: {}, pressed: {}, aim: null };
    }
    clear() {}
    dispose() {}
  }
  return { ...real, KeyboardSource: PilotKeys, PointerSource: NoPointer };
});

// imported after the mocks are registered (vi.mock is hoisted)
const { App } = await import('../src/app');
h.pilotFor = pilotFor;

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) } as StorageLike;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface Run {
  app: InstanceType<typeof App>;
  save: SaveStore;
  events: GameEvent[];
  /** onScreen feed: `title`, `cutscene:<id>`, `playing:<level>`, ... */
  screens: string[];
  /** Cutscenes as the player saw them (mid-level ones marked) and levels as they started. */
  seen: string[];
  fuel: Partial<Record<LevelId, number>>;
}

/**
 * Boot a real App and play it like a player: title START, pick map 1 in
 * level select, read every cutscene through, fly each level with its
 * reference pilot, press NEXT on results. Stops when `stop(run)` is true
 * or level select comes back after the pick.
 */
async function playStory(stop: (r: Run) => boolean = () => false): Promise<Run> {
  Object.assign(h, { session: null, pilot: null, tick: 0, loop: null, click: null, pending: null });
  h.uiScreens = [];
  h.levelsStarted = [];
  const save = new SaveStore(memoryStorage());
  const r: Run = { app: null!, save, events: [], screens: [], seen: [], fuel: {} };
  r.app = new App({} as HTMLElement, {
    art: {} as ArtApi, // no preload: cutscenes start synchronously
    save,
    onEvent: (e) => r.events.push(e),
    onScreen: (s) => r.screens.push(s.id === 'playing' || s.id === 'results' ? `${s.id}:${s.levelId}` : s.id === 'cutscene' ? `cutscene:${s.cutsceneId}` : s.id),
  });
  await r.app.start();
  expect(r.app.state.id).toBe('title');
  let picked = false;
  for (let guard = 0; guard < 20_000 && !stop(r); guard++) {
    await flush();
    if (h.pending) {
      const c = h.pending;
      h.pending = null; // the real player tears itself down when it finishes
      r.seen.push(r.app.state.id === 'playing' ? `${c.id} (mid-level)` : c.id);
      c.onDone(false); // the player reads it through
      continue;
    }
    const s = r.app.state;
    switch (s.id) {
      case 'title':
        h.click!('start');
        break;
      case 'levelSelect':
        if (picked) return r;
        picked = true;
        h.click!('hangarRun');
        break;
      case 'playing': {
        if (!h.session || h.loop!.paused) break; // level still loading / inline cutscene
        if (!r.seen.includes(s.levelId)) r.seen.push(s.levelId);
        for (let i = 0; i < 600 && r.app.state.id === 'playing' && !h.loop!.paused; i++) {
          h.loop!.step();
          if (i % 60 === 0) h.loop!.render(1);
        }
        break;
      }
      case 'results':
        expect(s.outcome, `${s.levelId}: ${JSON.stringify(s.outcome)}`).toMatchObject({ kind: 'complete' });
        r.fuel[s.levelId] = h.session!.state.fuel;
        h.click!('next'); // results NEXT
        break;
      case 'cutscene':
        break; // App opens its player; handled on the next pass
      default:
        throw new Error(`unexpected screen ${s.id}`);
    }
  }
  if (!stop(r)) throw new Error(`story stuck on ${JSON.stringify(r.app.state)}`);
  return r;
}

describe('App story flow (real App, faked render/DOM seams)', () => {
  const errors: unknown[][] = [];
  beforeEach(() => {
    errors.length = 0;
    h.patch = null;
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    vi.spyOn(console, 'warn').mockImplementation((...a) => void errors.push(a));
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => {
    h.patch = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('title -> START -> map 1 pick -> briefing ... finale + credits -> level select, no console errors', { timeout: 600_000 }, async () => {
    const { app, save, events, screens, seen, fuel } = await playStory();

    expect(seen).toEqual([
      'briefing', 'hangarRun', 'meetIo', 'descent', 'descentAwe',
      'floatingIsles', 'csmSeized (mid-level)', 'emptyOutpost',
      'throat', 'podTransfer', 'vaults', 'teamFound', 'hollow', 'keeperWakes',
      'keeper', 'keeperFalls', 'madDash', 'finale',
    ]);
    expect(h.levelsStarted).toEqual([...STORY_LEVELS]);
    // App-owned side effects: save progress, cutscenes marked seen, cutsceneDone events
    expect(save.state.unlocked).toEqual([...STORY_LEVELS]);
    expect(STORY_LEVELS.every((id) => save.state.best[id] !== undefined)).toBe(true);
    const doneIds = events.filter((e) => e.type === 'cutsceneDone').map((e) => (e as Extract<GameEvent, { type: 'cutsceneDone' }>).cutsceneId);
    expect(doneIds).toEqual(seen.filter((x) => !(STORY_LEVELS as readonly string[]).includes(x)).map((x) => x.replace(' (mid-level)', '')));
    expect(events.filter((e) => e.type === 'vesselModeChanged')).toEqual([{ type: 'vesselModeChanged', from: 'csm', to: 'lander' }]);
    expect(events.filter((e) => e.type === 'bossDefeated')).toHaveLength(1);
    // every between-map cutscene gets exactly one cutscene screen; the mid-level one plays inside `playing`
    expect(screens.filter((x) => x.startsWith('cutscene:'))).toEqual(
      ['briefing', 'meetIo', 'descentAwe', 'emptyOutpost', 'podTransfer', 'teamFound', 'keeperWakes', 'keeperFalls', 'finale'].map((c) => `cutscene:${c}`),
    );
    expect(screens[screens.length - 1]).toBe('levelSelect');
    expect(h.uiScreens[h.uiScreens.length - 1]).toBe('levelSelect');
    // difficulty: every map keeps its fuel margin when flown through the App
    for (const id of STORY_LEVELS) expect(fuel[id], `${id} completion fuel`).toBeGreaterThanOrEqual(MIN_COMPLETION_FUEL[id]!);

    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    app.destroy();
  });

  it('results NEXT plays an after + before cutscene chain inside ONE cutscene screen, then the next level', { timeout: 120_000 }, async () => {
    // no shipped transition chains two scripts, so give map 2 a before-hook (map 1 already has meetIo after)
    h.patch = (spec) => (spec.id === 'descent' ? { ...spec, cutsceneBefore: 'descentAwe' } : spec);
    const { app, screens, seen } = await playStory((r) => r.app.state.id === 'playing' && r.app.state.levelId === 'descent' && h.session !== null);

    expect(seen).toEqual(['briefing', 'hangarRun', 'meetIo', 'descentAwe', 'descent']);
    expect(screens).toEqual(['title', 'levelSelect', 'cutscene:briefing', 'playing:hangarRun', 'results:hangarRun', 'cutscene:meetIo', 'playing:descent']);
    expect(h.levelsStarted).toEqual(['hangarRun', 'descent']);
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    app.destroy();
  });
});
