/**
 * Round 8 audit (M1): the REAL GameUi (fake DOM, real Pixi containers) for the
 * JOYSTICK / minimap wiring that pure tests cannot see: the desktop stick-only
 * layer, the pause-menu MINIMAP toggle persisting, and the minimap texture
 * freed on leaving the level.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferImageSource, Container } from 'pixi.js';
import type { ArtApi, InputSampleContext, SteeringScheme } from '../src/contracts';
import { getLevel } from '../src/levels/registry';
import { emptyFrame, InputMapper, VirtualControlsSource } from '../src/shell/input';
import type { GameUiOptions } from '../src/ui/gameUi';
import { MinimapView } from '../src/ui/minimap';
import { FakeDom, type FakeElement } from './support/fakeDom';

// PixelText rasterises through a DOM canvas (Texture.from): stubbed with fixed-width glyphs, as in ui.hudView.test.ts
vi.mock('../src/ui/pixelText', async () => {
  const { Container } = await import('pixi.js');
  class PixelText extends Container {
    text = '';
    constructor(text = '') {
      super();
      this.text = text;
    }
    setText(text: string): this {
      this.text = text;
      return this;
    }
    override get width(): number {
      return this.text.length * 6;
    }
    override set width(_v: number) {}
    override get height(): number {
      return 7;
    }
    override set height(_v: number) {}
  }
  return { PixelText };
});

const ctx: InputSampleContext = { mode: 'lander', vesselWorldPos: { x: 0, y: 0 }, clientToWorld: (x, y) => ({ x, y }) };

describe('GameUi: JOYSTICK + minimap wiring (real GameUi, fake DOM)', () => {
  let dom: FakeDom;
  let host: FakeElement;
  beforeEach(() => {
    dom = new FakeDom();
    vi.stubGlobal('document', dom.document());
    vi.stubGlobal('window', dom.window());
    host = dom.body.appendChild(dom.document().createElement('div'));
    host.clientWidth = 1280;
    host.clientHeight = 720;
  });
  afterEach(() => vi.unstubAllGlobals());

  async function make(o: Partial<GameUiOptions> & { touchPref?: 'auto' | 'on' | 'off'; steering?: SteeringScheme | null }) {
    const { GameUi } = await import('../src/ui/gameUi');
    const virtual = new VirtualControlsSource();
    const m = new InputMapper();
    m.add(virtual);
    const canvas = dom.document().createElement('canvas');
    const pixi = { app: { stage: new Container() }, canvas, clientToView: (x: number, y: number) => ({ x: x / 2, y: y / 2 }), uploadTexture() {}, scale: { cssPerVirtual: 2 } };
    const ui = new GameUi({
      host: host as unknown as HTMLElement,
      pixi: pixi as never,
      art: { palettes: {}, getSprite: () => ({ canvas: new BufferImageSource({ resource: new Uint8Array(4), width: 1, height: 1 }), pivot: { x: 0, y: 0 }, width: 1, height: 1 }) } as unknown as ArtApi,
      virtual,
      dispatch: () => {},
      levels: () => ({}),
      save: () => null,
      ...o,
    });
    return { ui, m };
  }

  const playHangarRun = (ui: { enter(s: never): void; levelStarted(s: never): void }) => {
    ui.enter({ id: 'playing', levelId: 'hangarRun' } as never);
    ui.levelStarted(getLevel('hangarRun')! as never);
  };

  it('desktop (touch off) + JOYSTICK: the stick alone is shown (no pause / restart), and a mouse drag on it steers', async () => {
    const { ui, m } = await make({ touchPref: 'off', steering: 'joystick' });
    playHangarRun(ui as never);
    const layer = ui.touchLayer;
    expect(layer.isVisible).toBe(true);
    const l = layer.getLayout()!;
    expect(l.buttons).toEqual([]);
    expect(l.stick).not.toBeNull();
    const zone = (layer.el as unknown as FakeElement).children.find((c) => c.dataset.testid === 'joystick-zone')!;
    dom.pointer('pointerdown', 1, l.stick!.cx + l.stick!.r, l.stick!.cy, zone);
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    ui.destroy();
  });

  it('desktop + ENGINES / DIRECT: no touch layer at all; touch on + JOYSTICK: the stick plus the system buttons', async () => {
    for (const steering of ['engines', 'direct'] as const) {
      const { ui } = await make({ touchPref: 'off', steering });
      playHangarRun(ui as never);
      expect(ui.touchLayer.isVisible, steering).toBe(false);
      ui.destroy();
    }
    const { ui } = await make({ touchPref: 'on', steering: 'joystick' });
    playHangarRun(ui as never);
    const l = ui.touchLayer.getLayout()!;
    expect(ui.touchLayer.isVisible).toBe(true);
    expect(l.buttons.map((b) => b.control).sort()).toEqual(['pause', 'restart']);
    expect(l.stick).not.toBeNull();
    ui.destroy();
  });

  it('round 9: never-chosen steering = the stick on hangarRun, the classic CSM buttons on Descent; the pause menu shows what is active; an explicit choice applies on Descent too', async () => {
    const steer: (SteeringScheme | null)[] = [];
    const { ui } = await make({ touchPref: 'on', steering: null, onSteeringChange: (s) => steer.push(s) });
    playHangarRun(ui as never);
    expect(ui.touchLayer.getLayout()!.stick).not.toBeNull();
    ui.enter({ id: 'playing', levelId: 'descent' } as never);
    ui.levelStarted(getLevel('descent')! as never);
    const l = ui.touchLayer.getLayout()!;
    expect(l.stick).toBeNull();
    expect(l.buttons.map((b) => b.control).sort()).toEqual(['pause', 'restart', 'rotateCCW', 'rotateCW', 'thrust']);
    ui.enter({ id: 'paused', levelId: 'descent' } as never);
    const label = () => ui.currentModel!.items.find((i) => i.id === 'steering')!.label;
    expect(label()).toBe('STEERING: AUTO (ENGINES)');
    const activate = () => (ui as unknown as { activate(id: string): void }).activate('steering');
    /** The in-flight layout (the touch layer relayouts when play resumes), then back to the pause menu. */
    const flying = () => {
      ui.enter({ id: 'playing', levelId: 'descent' } as never);
      const l = ui.touchLayer.getLayout()!;
      ui.enter({ id: 'paused', levelId: 'descent' } as never);
      return { flight: l.buttons.map((b) => b.control).filter((c) => c !== 'pause' && c !== 'restart').length, stick: l.stick !== null };
    };
    activate(); // AUTO -> ENGINES (explicit; same scheme here)
    expect(steer).toEqual(['engines']);
    expect(label()).toBe('STEERING: ENGINES');
    activate(); // -> DIRECT
    expect(steer).toEqual(['engines', 'direct']);
    expect(label()).toBe('STEERING: DIRECT');
    expect(flying()).toEqual({ flight: 0, stick: false });
    activate(); // -> JOYSTICK
    expect(flying()).toEqual({ flight: 0, stick: true });
    activate(); // -> AUTO: stored as null, Descent's per-level default (the CSM buttons) again
    expect(steer).toEqual(['engines', 'direct', 'joystick', null]);
    expect(label()).toBe('STEERING: AUTO (ENGINES)');
    expect(flying()).toEqual({ flight: 3, stick: false });
    ui.destroy();
    // explicit JOYSTICK: the stick on Descent too
    const j = await make({ touchPref: 'on', steering: 'joystick' });
    j.ui.enter({ id: 'playing', levelId: 'descent' } as never);
    j.ui.levelStarted(getLevel('descent')! as never);
    expect(j.ui.touchLayer.getLayout()!.stick).not.toBeNull();
    j.ui.destroy();
  });

  it('pause menu STEERING cycles to JOYSTICK (persisted) and the stick appears; MINIMAP toggles + persists; leaving frees the minimap texture', async () => {
    const steer: (SteeringScheme | null)[] = [];
    const mini: boolean[] = [];
    const { ui } = await make({ touchPref: 'off', steering: 'direct', onSteeringChange: (s) => steer.push(s), onShowMinimapChange: (on) => mini.push(on) });
    playHangarRun(ui as never);
    expect(ui.touchLayer.isVisible).toBe(false);
    ui.enter({ id: 'paused', levelId: 'hangarRun' } as never);
    const activate = (id: string) => (ui as unknown as { activate(id: string): void }).activate(id);
    const label = (id: string) => ui.currentModel!.items.find((i) => i.id === id)!.label;
    activate('steering');
    expect(steer).toEqual(['joystick']);
    expect(label('steering')).toBe('STEERING: JOYSTICK');
    expect(label('minimap')).toBe('MINIMAP: ON');
    activate('minimap');
    expect(mini).toEqual([false]);
    expect(label('minimap')).toBe('MINIMAP: OFF');
    activate('minimap');
    expect(mini).toEqual([false, true]);
    ui.enter({ id: 'playing', levelId: 'hangarRun' } as never);
    expect(ui.touchLayer.isVisible).toBe(true);
    expect(ui.touchLayer.getLayout()!.stick).not.toBeNull();
    const mm = (ui as unknown as { minimap: { hasTexture: boolean; bakes: number } }).minimap;
    expect(mm.hasTexture).toBe(true);
    expect(mm.bakes).toBe(1);
    ui.enter({ id: 'levelSelect' } as never);
    expect(mm.hasTexture).toBe(false);
    ui.destroy();
  });

  it('round 10: floatingIsles AUTO steering is per phase - ENGINES (CSM buttons) for the CSM, JOYSTICK after the detach; an explicit choice wins', async () => {
    const steer: (SteeringScheme | null)[] = [];
    const { ui } = await make({ touchPref: 'on', steering: null, onSteeringChange: (s) => steer.push(s) });
    const isles = getLevel('floatingIsles')!;
    ui.enter({ id: 'playing', levelId: 'floatingIsles' } as never);
    ui.levelStarted(isles as never);
    ui.noteFrame({ ...emptyFrame(), thrust: true }); // dismiss the start card
    const label = () => ui.currentModel!.items.find((i) => i.id === 'steering')!.label;
    const layout = () => ui.touchLayer.getLayout()!;
    expect(layout().stick).toBeNull();
    expect(layout().buttons.map((b) => b.control)).toContain('thrust');
    ui.enter({ id: 'paused', levelId: 'floatingIsles' } as never);
    expect(label()).toBe('STEERING: AUTO (ENGINES)');
    ui.enter({ id: 'playing', levelId: 'floatingIsles' } as never);
    ui.onEvent({ type: 'vesselModeChanged', from: 'csm', to: 'lander' });
    expect(layout().stick).not.toBeNull();
    expect(layout().buttons.map((b) => b.control).sort()).toEqual(['pause', 'restart']);
    ui.noteFrame({ ...emptyFrame(), thrust: true });
    ui.enter({ id: 'paused', levelId: 'floatingIsles' } as never);
    expect(label()).toBe('STEERING: AUTO (JOYSTICK)');
    expect(steer).toEqual([]); // nothing persisted: still AUTO
    ui.destroy();
    // explicit DIRECT: the same in both phases
    const d = await make({ touchPref: 'on', steering: 'direct' });
    d.ui.enter({ id: 'playing', levelId: 'floatingIsles' } as never);
    d.ui.levelStarted(isles as never);
    d.ui.noteFrame({ ...emptyFrame(), thrust: true });
    const flight = () => d.ui.touchLayer.getLayout()!.buttons.map((b) => b.control).sort();
    expect(flight()).toEqual(['pause', 'restart']);
    d.ui.onEvent({ type: 'vesselModeChanged', from: 'csm', to: 'lander' });
    expect(flight()).toEqual(['pause', 'restart']);
    expect(d.ui.touchLayer.getLayout()!.stick).toBeNull();
    d.ui.enter({ id: 'paused', levelId: 'floatingIsles' } as never);
    expect(d.ui.currentModel!.items.find((i) => i.id === 'steering')!.label).toBe('STEERING: DIRECT');
    d.ui.destroy();
  });

  it('round 10: the lander controls card at the detach HOLDS the simulation until the first input (like the level-start card)', async () => {
    const { ui } = await make({ touchPref: 'off', steering: null });
    ui.enter({ id: 'playing', levelId: 'floatingIsles' } as never);
    ui.levelStarted(getLevel('floatingIsles')! as never);
    expect(ui.holdSimulation).toBe(true); // level start card
    ui.noteFrame({ ...emptyFrame(), thrust: true });
    expect(ui.holdSimulation).toBe(false);
    expect(ui.helpVisible).toBe(false);
    ui.onEvent({ type: 'vesselModeChanged', from: 'csm', to: 'lander' });
    expect(ui.helpVisible).toBe(true);
    expect(ui.holdSimulation).toBe(true);
    for (let i = 0; i < 600; i++) {
      ui.noteFrame(emptyFrame());
      ui.tick(null, 1 / 60); // 10 s without input: no timeout
    }
    expect(ui.holdSimulation).toBe(true);
    expect(ui.helpVisible).toBe(true);
    ui.noteFrame({ ...emptyFrame(), engineLeft: true });
    expect(ui.holdSimulation).toBe(false);
    expect(ui.helpVisible).toBe(false);
    ui.destroy();
  });

  it('round 10: the level-start card states the mission while it holds the level; the detach card does not repeat it', async () => {
    const { ui } = await make({ touchPref: 'off' });
    ui.enter({ id: 'playing', levelId: 'floatingIsles' } as never);
    ui.levelStarted(getLevel('floatingIsles')! as never);
    expect(ui.holdSimulation).toBe(true);
    expect(ui.helpMission).toBe('MISSION: PLANT 5 BEACONS + REACH THE EXIT');
    for (let i = 0; i < 300; i++) ui.tick(null, 1 / 60); // still there while the player reads
    expect(ui.helpMission).toBe('MISSION: PLANT 5 BEACONS + REACH THE EXIT');
    ui.noteFrame({ ...emptyFrame(), thrust: true });
    expect(ui.helpMission).toBe('');
    ui.onEvent({ type: 'vesselModeChanged', from: 'csm', to: 'lander' });
    expect(ui.helpVisible).toBe(true);
    expect(ui.helpMission).toBe('');
    ui.destroy();
    const h = await make({ touchPref: 'on' });
    playHangarRun(h.ui as never);
    expect(h.ui.helpMission).toMatch(/^MISSION: .*REACH THE EXIT/);
    h.ui.destroy();
  });

  it('round 10: a beaconPlanted event marks that site planted on the minimap', async () => {
    const { ui } = await make({ touchPref: 'off' });
    ui.enter({ id: 'playing', levelId: 'floatingIsles' } as never);
    ui.levelStarted(getLevel('floatingIsles')! as never);
    const mm = (ui as unknown as { minimap: { siteMarkers: readonly { id: string; planted: boolean }[] } }).minimap;
    expect(mm.siteMarkers.filter((s) => s.planted)).toEqual([]);
    ui.onEvent({ type: 'beaconPlanted', siteId: 'site3', planted: 1, total: 5 });
    expect(mm.siteMarkers.filter((s) => s.planted).map((s) => s.id)).toEqual(['site3']);
    ui.destroy();
  });
  it('round 11: pause-menu LAYOUT flips the stick lower-right + the minimap lower-left (persisted); a stick held across a swap is released (no ghost stick)', async () => {
    const sides: string[] = [];
    const { ui, m } = await make({ touchPref: 'on', steering: 'joystick', onStickSideChange: (s) => sides.push(s) });
    playHangarRun(ui as never);
    const W = host.clientWidth;
    const mmAt = () => {
      (ui as unknown as { insetCache: { at: number } }).insetCache.at = -Infinity;
      ui.render(1000);
      return (ui as unknown as { mmAt: { x: number; y: number } }).mmAt;
    };
    let l = ui.touchLayer.getLayout()!;
    expect(l.stick!.cx).toBeLessThan(W / 2);
    expect(mmAt().x).toBeGreaterThan(320); // bottom-right (640-wide view)
    const layer = ui.touchLayer;
    const zone = () => (layer.el as unknown as FakeElement).children.find((c) => c.dataset.testid === 'joystick-zone')!;

    // a finger holding the stick when the side flips (the layer rebuilt while visible)
    dom.pointer('pointerdown', 7, l.stick!.cx + l.stick!.r, l.stick!.cy, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    layer.setStickRight(true);
    l = layer.getLayout()!;
    expect(l.stick!.cx).toBeGreaterThan(W / 2);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 }); // centred (coast)
    // the old finger keeps moving / lifts: nothing steers, no stuck stick
    dom.pointer('pointermove', 7, l.stick!.cx - l.stick!.r, l.stick!.cy, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 }); // centred (coast)
    dom.pointer('pointerup', 7, l.stick!.cx - l.stick!.r, l.stick!.cy, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 }); // centred (coast)
    // a fresh touch on the new (right) stick works
    dom.pointer('pointerdown', 8, l.stick!.cx, l.stick!.cy - l.stick!.r, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: -1 });
    dom.pointer('pointerup', 8, l.stick!.cx, l.stick!.cy - l.stick!.r, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 }); // centred (coast)
    layer.setStickRight(false);

    // the pause menu item: label, persistence, the layout on resume, the minimap on the other corner
    ui.enter({ id: 'paused', levelId: 'hangarRun' } as never);
    const label = () => ui.currentModel!.items.find((i) => i.id === 'layout')!.label;
    const activate = () => (ui as unknown as { activate(id: string): void }).activate('layout');
    expect(label()).toBe('LAYOUT: STICK LEFT');
    activate();
    expect(sides).toEqual(['right']);
    expect(label()).toBe('LAYOUT: STICK RIGHT');
    ui.enter({ id: 'playing', levelId: 'hangarRun' } as never);
    l = ui.touchLayer.getLayout()!;
    expect(l.stick!.zone.x).toBeGreaterThanOrEqual(W / 2);
    const at = mmAt();
    expect(at.x).toBeLessThan(320); // bottom-left now
    // clear of the stick (view px = css / 2 in this harness)
    const s = l.stick!;
    const base = { x: (s.cx - s.r) / 2, y: (s.cy - s.r) / 2, w: s.r, h: s.r };
    const mm = { x: at.x, y: at.y, w: MinimapView.outerW, h: MinimapView.outerH };
    expect(mm.x + mm.w <= base.x || base.x + base.w <= mm.x || mm.y + mm.h <= base.y || base.y + base.h <= mm.y).toBe(true);
    ui.enter({ id: 'paused', levelId: 'hangarRun' } as never);
    activate();
    expect(sides).toEqual(['right', 'left']);
    ui.enter({ id: 'playing', levelId: 'hangarRun' } as never);
    expect(ui.touchLayer.getLayout()!.stick!.cx).toBeLessThan(W / 2);
    expect(mmAt().x).toBeGreaterThan(320);
    ui.destroy();
  });

  it('round 11 audit: the real flow - hold the stick, pause, LAYOUT, resume: centred, the stale finger is ignored; a restart keeps the side', async () => {
    const { ui, m } = await make({ touchPref: 'on', steering: 'joystick' });
    playHangarRun(ui as never);
    const W = host.clientWidth;
    const layer = ui.touchLayer;
    const zone = () => (layer.el as unknown as FakeElement).children.find((c) => c.dataset.testid === 'joystick-zone')!;
    let st = layer.getLayout()!.stick!;
    dom.pointer('pointerdown', 5, st.cx + st.r, st.cy, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    // the finger stays down through pause -> LAYOUT -> resume
    ui.enter({ id: 'paused', levelId: 'hangarRun' } as never);
    (ui as unknown as { activate(id: string): void }).activate('layout');
    ui.enter({ id: 'playing', levelId: 'hangarRun' } as never);
    st = layer.getLayout()!.stick!;
    expect(st.cx).toBeGreaterThan(W / 2);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    // the old pointer id keeps moving (even onto the new stick) and lifts: ignored
    dom.pointer('pointermove', 5, st.cx - st.r, st.cy, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    dom.pointer('pointerup', 5, st.cx - st.r, st.cy, zone());
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    // restart (the level starts again): still right
    ui.enter({ id: 'playing', levelId: 'hangarRun' } as never);
    ui.levelStarted(getLevel('hangarRun')! as never);
    expect(layer.getLayout()!.stick!.cx).toBeGreaterThan(W / 2);
    ui.enter({ id: 'paused', levelId: 'hangarRun' } as never);
    expect(ui.currentModel!.items.find((i) => i.id === 'layout')!.label).toBe('LAYOUT: STICK RIGHT');
    ui.destroy();
  });

  it('round 11: a saved stickSide right starts with the stick lower-right; the classic CSM buttons mirror (Descent)', async () => {
    const { ui } = await make({ touchPref: 'on', steering: null, stickSide: 'right' });
    ui.enter({ id: 'playing', levelId: 'descent' } as never);
    ui.levelStarted(getLevel('descent')! as never);
    const l = ui.touchLayer.getLayout()!;
    const b = (c: string) => l.buttons.find((x) => x.control === c)!.rect;
    expect(b('thrust').x).toBeLessThan(host.clientWidth / 2);
    expect(b('rotateCCW').x).toBeGreaterThan(host.clientWidth / 2);
    expect(b('rotateCCW').x).toBeLessThan(b('rotateCW').x);
    ui.destroy();
  });
});
