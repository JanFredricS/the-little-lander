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
import { InputMapper, VirtualControlsSource } from '../src/shell/input';
import type { GameUiOptions } from '../src/ui/gameUi';
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
});
