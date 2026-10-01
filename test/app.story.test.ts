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
import { emptyFrame } from '../src/shell/input';
import { FIXED_DT } from '../src/contracts';
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
  /** Texture sources the App handed to PixiHost.uploadTexture (one fake source per LevelView). */
  uploaded: [] as unknown[],
  pilotFor: null as null | ((id: LevelId) => Pilot),
  /** Test override for every map's pilot (the crash test). */
  pilotOverride: null as null | ((id: LevelId) => Pilot),
  /** Fixed steps App has taken (fake loop ticks). */
  steps: 0,
  /** Optional LevelSpec patch (the chained-cutscene test adds a cutsceneBefore). */
  patch: null as null | ((spec: LevelSpec) => LevelSpec),
  /** Saved Settings.steering for the next playStory (the DIRECT-persisted test). */
  steering: 'engines' as 'engines' | 'direct',
  /** PilotKeys.engineFrames (true = like the browser autopilot; false only for the negative control). */
  pilotEngineFrames: true,
  /** GameUi.resetTerrainHistory() calls (once per LevelView, on its first rendered frame). */
  terrainResets: 0,
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
    lowRes: false,
    setLowRes() {},
    uploadTexture(src: unknown) {
      h.uploaded.push(src);
    },
    destroy() {},
  }),
}));

vi.mock('../src/render/levelView', () => ({
  LevelView: class {
    readonly root = {};
    constructor(readonly session: LevelSession) {
      h.session = session;
      h.pilot = (h.pilotOverride ?? h.pilotFor!)(session.spec.id);
      h.tick = 0;
      h.levelsStarted.push(session.spec.id);
    }
    render() {}
    setTerrainUploader() {}
    terrainDiag<T>(out: T): T {
      return out;
    }
    forEachTextureSource(upload: (src: unknown) => void) {
      upload({ level: this.session.spec.id });
    }
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
      noteFrameTiming() {}
      resetTerrainHistory() {
        h.terrainResets++;
      }
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
    /** Physical engine frames: the App must bypass DIRECT steering for them (like the browser autopilot). */
    get engineFrames() {
      return h.pilotEngineFrames;
    }
    sample(_ctx: InputSampleContext): InputSourceSample {
      if (!h.session || !h.pilot) return { down: {}, pressed: {}, aim: null };
      const f = h.pilot(h.session, h.tick++);
      return {
        down: { thrust: f.thrust, engineLeft: f.engineLeft, engineRight: f.engineRight, rotateCW: f.rotateCW, rotateCCW: f.rotateCCW, reelIn: f.reelIn, reelOut: f.reelOut },
        pressed: { fire: f.fire, release: f.release, pause: f.pause, restart: f.restart },
        aim: f.aim.x !== 0 || f.aim.y !== 0 ? { dir: f.aim, target: f.aimTarget } : null,
      };
    }
    /** The pilots emit physical engines: the swapped-keys setting does not apply to them. */
    setSwapEngines(_swap: boolean) {}
    /** The story runs on the default ENGINES scheme (the pilots emit engine frames). */
    setDirectSteering(_on: boolean) {}
    clear() {}
    dispose() {}
  }
  class NoPointer {
    readonly id = 'pointer';
    sample(): InputSourceSample {
      return { down: {}, pressed: {}, aim: null };
    }
    setDirectSteering(_on: boolean) {}
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
  /** Fixed-step index of the first `crash` event / the first results screen (-1 = none). */
  crashStep: number;
  resultsStep: number;
}

/**
 * Boot a real App and play it like a player: title START, pick map 1 in
 * level select, read every cutscene through, fly each level with its
 * reference pilot, press NEXT on results. Stops when `stop(run)` is true
 * or level select comes back after the pick.
 */
async function playStory(stop: (r: Run) => boolean = () => false): Promise<Run> {
  Object.assign(h, { session: null, pilot: null, tick: 0, loop: null, click: null, pending: null, steps: 0 });
  h.uiScreens = [];
  h.levelsStarted = [];
  h.uploaded = [];
  const save = new SaveStore(memoryStorage());
  if (h.steering !== 'engines') save.setSettings({ steering: h.steering }); // persisted by an earlier session
  const r: Run = { app: null!, save, events: [], screens: [], seen: [], fuel: {}, crashStep: -1, resultsStep: -1 };
  r.app = new App({} as HTMLElement, {
    art: {} as ArtApi, // no preload: cutscenes start synchronously
    save,
    onEvent: (e) => {
      r.events.push(e);
      if (e.type === 'crash' && r.crashStep < 0) r.crashStep = h.steps;
    },
    onScreen: (s) => {
      if (s.id === 'results' && r.resultsStep < 0) r.resultsStep = h.steps;
      r.screens.push(s.id === 'playing' || s.id === 'results' ? `${s.id}:${s.levelId}` : s.id === 'cutscene' ? `cutscene:${s.cutsceneId}` : s.id);
    },
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
          h.steps++;
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
    h.pilotOverride = null;
    h.steering = 'engines';
    h.pilotEngineFrames = true;
    h.terrainResets = 0;
    vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    vi.spyOn(console, 'warn').mockImplementation((...a) => void errors.push(a));
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => {
    h.patch = null;
    h.pilotOverride = null;
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
    // every level's textures were pre-uploaded at load (LevelView enumeration -> PixiHost.uploadTexture)
    expect(h.uploaded).toEqual(STORY_LEVELS.map((level) => ({ level })));
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

  it('a crash keeps the wreck on screen for CRASH_RESULTS_DELAY_SEC before GAME OVER', { timeout: 120_000 }, async () => {
    const { CRASH_RESULTS_DELAY_SEC } = await import('../src/app');
    // full thrust into the hangar ceiling: a guaranteed hard hit (the crash threshold is lowered
    // here so the test does not hang on map 1's climb tuning — the feel pass arrives at ~195 px/s)
    h.patch = (spec) => (spec.id === 'hangarRun' ? { ...spec, physicsOverrides: { ...spec.physicsOverrides, 'lander.crashSpeed': 120 } } : spec);
    h.pilotOverride = () => () => ({ ...emptyFrame(), thrust: true });
    const r = await playStory((run) => run.app.state.id === 'results');
    const s = r.app.state;
    expect(s.id === 'results' && s.outcome).toMatchObject({ kind: 'failed' });
    expect(r.crashStep).toBeGreaterThanOrEqual(0);
    // the level stays on `playing` (wreck + explosion visible) for the whole hold, then results
    expect(r.resultsStep - r.crashStep).toBe(Math.round(CRASH_RESULTS_DELAY_SEC / FIXED_DT));
    expect(r.screens.filter((x) => x.startsWith('results:'))).toEqual(['results:hangarRun']);
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    r.app.destroy();
  });

  it('RESTART during the crash hold starts the level again at once (no GAME OVER first)', { timeout: 120_000 }, async () => {
    h.patch = (spec) => (spec.id === 'hangarRun' ? { ...spec, physicsOverrides: { ...spec.physicsOverrides, 'lander.crashSpeed': 120 } } : spec);
    let restartAt = -1;
    h.pilotOverride = () => (s) => {
      if (!s.outcome) return { ...emptyFrame(), thrust: true };
      if (restartAt < 0) restartAt = h.steps;
      return { ...emptyFrame(), restart: true };
    };
    const r = await playStory(() => h.levelsStarted.filter((id) => id === 'hangarRun').length >= 2);
    const resetsAtRestart = h.terrainResets;
    for (let i = 0; i < 61; i++) {
      h.loop!.step();
      if (i % 60 === 0) h.loop!.render(1);
    }
    expect(restartAt).toBeGreaterThanOrEqual(0);
    // the terrain MAX / UP history restarts with each level view (start and restart), once each
    expect(resetsAtRestart).toBeGreaterThanOrEqual(1);
    expect(h.terrainResets).toBe(2);
    expect(r.screens.some((x) => x.startsWith('results:'))).toBe(false);
    expect(r.app.state).toMatchObject({ id: 'playing', levelId: 'hangarRun' });
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    r.app.destroy();
  });

  it('a persisted DIRECT steering setting does not disable pilot sources that emit physical engine frames', { timeout: 120_000 }, async () => {
    // the save says DIRECT, and the pilot fires both engines as PHYSICAL flags (no `thrust`): a frame the DIRECT
    // layer would drop (it reads only steer / thrust / rotate / the top pair). Marked engineFrames, it must reach
    // the lander untouched (no engineScale) and fly into the ceiling.
    const { LevelSession: Session } = await import('../src/game/session');
    const stepped = vi.spyOn(Session.prototype, 'step');
    h.patch = (spec) => (spec.id === 'hangarRun' ? { ...spec, physicsOverrides: { ...spec.physicsOverrides, 'lander.crashSpeed': 120 } } : spec);
    const pilot = () => () => ({ ...emptyFrame(), engineLeft: true, engineRight: true });
    h.pilotOverride = pilot;
    h.steering = 'direct';
    const r = await playStory((run) => run.app.state.id === 'results');
    expect(r.save.state.settings.steering).toBe('direct');
    const s = r.app.state;
    expect(s.id === 'results' && s.outcome).toMatchObject({ kind: 'failed' });
    expect(r.crashStep).toBeGreaterThanOrEqual(0);
    const flown = stepped.mock.calls.map((c) => c[0]!).filter((f) => f.engineLeft || f.engineRight);
    expect(flown.length).toBeGreaterThan(30);
    for (const f of flown) {
      expect(f.engineLeft && f.engineRight).toBe(true);
      expect(f.thrust).toBe(false);
      expect(f.engineScale).toBeUndefined(); // the DIRECT layer never touched it
    }
    stepped.mockRestore();
    expect(errors, JSON.stringify(errors.slice(0, 3))).toEqual([]);
    r.app.destroy();

    // negative control: the SAME pilot WITHOUT the engineFrames marker goes through the DIRECT layer, which
    // drops the physical engine flags (no steer, no DIRECT key command) and coasts: no engine fires, no crash
    h.pilotOverride = pilot;
    h.pilotEngineFrames = false;
    let fired = false;
    const c = await playStory((run) => {
      if (h.session?.state.engines.left || h.session?.state.engines.right) fired = true;
      return h.steps > 240;
    });
    expect(c.app.state.id).toBe('playing');
    expect(h.session!.simTime).toBeGreaterThan(2); // the level really ran
    expect(fired).toBe(false);
    expect(c.crashStep).toBe(-1);
    c.app.destroy();
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
