/**
 * Round 8: the JOYSTICK steering scheme (virtual stick -> InputFrame.steer ->
 * the DIRECT steering layer) and the minimap (baked once per level; per-frame
 * marker math only).
 */

import { describe, expect, it } from 'vitest';
import type { InputFrame, InputSampleContext, LevelSpec, Rect } from '../src/contracts';
import { DirectSteering } from '../src/shell/directSteering';
import { InputMapper, VirtualControlsSource } from '../src/shell/input';
import { DEFAULT_SETTINGS, defaultSave, parseSave } from '../src/story/save';
import { DEFAULT_STEERING, resolveSteering, SAVE_VERSION, STEERING_SCHEMES } from '../src/contracts';
import { LEVELS } from '../src/levels/registry';
import { helpCard } from '../src/ui/controlsHelp';
import { itemAction, nextSteering, screenModel, type ScreenContext } from '../src/ui/screens';
import { contains, overlaps, STICK_DEADZONE, stickVector, touchLayout } from '../src/ui/touch/touchLayout';
import { TouchModel } from '../src/ui/touch/touchModel';
import { bakeMinimap, createMinimapLayout, MINIMAP_EDGE_INSET, MINIMAP_H, MINIMAP_SCALE, MINIMAP_W, minimapLayout, minimapPlacement, MinimapView } from '../src/ui/minimap';

const FLIGHT = ['thrust', 'rotateCW', 'rotateCCW', 'engineLeft', 'engineRight', 'topLeft', 'topRight'] as const;
const frameFlight = (f: InputFrame) => FLIGHT.filter((k) => f[k]);
const ctx: InputSampleContext = { mode: 'lander', vesselWorldPos: { x: 0, y: 0 }, clientToWorld: (x, y) => ({ x, y }) };

/** Stick + model + virtual source + mapper wired like the game (App.virtual is the TouchModel sink). */
function rig(mode: 'lander' | 'csm' = 'lander') {
  const v = new VirtualControlsSource();
  const m = new InputMapper();
  m.add(v);
  const tm = new TouchModel(v);
  const layout = touchLayout(mode, 844, 390, { joystick: true });
  tm.setLayout(layout);
  return { v, m, tm, stick: layout.stick! };
}

describe('JOYSTICK: stick vector -> InputFrame.steer', () => {
  it('stickVector: direction from the base centre, magnitude capped at 1, null inside the deadzone', () => {
    const s = { cx: 100, cy: 200, r: 50 };
    expect(stickVector(s, 100, 200)).toBeNull();
    expect(stickVector(s, 100 + STICK_DEADZONE * 50 - 0.5, 200)).toBeNull();
    expect(stickVector(s, 125, 200)).toEqual({ x: 0.5, y: 0 });
    const far = stickVector(s, 100, 0)!; // way past full deflection, straight up
    expect(far.x).toBeCloseTo(0);
    expect(far.y).toBeCloseTo(-1);
    const diag = stickVector(s, 130, 230)!;
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(Math.min(1, Math.hypot(30, 30) / 50));
  });

  it('a touch in the stick zone steers the frame toward the stick direction (normalised), follows moves, centres on release', () => {
    const { m, tm, stick } = rig();
    expect(tm.down(1, stick.cx + stick.r, stick.cy)).toBe(true); // full right
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    tm.move(1, stick.cx, stick.cy - stick.r * 0.5); // half up: still a unit steer
    const up = m.sample(ctx).steer;
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    tm.move(1, stick.cx - 30, stick.cy + 30);
    const dl = m.sample(ctx).steer;
    expect(dl.x).toBeCloseTo(-Math.SQRT1_2);
    expect(dl.y).toBeCloseTo(Math.SQRT1_2);
    tm.up(1);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
  });

  it('deadzone / centre / release = an EMPTY frame: the DIRECT layer fires no engine (coast)', () => {
    const { m, tm, stick } = rig();
    const ds = new DirectSteering();
    const att = { mode: 'lander' as const, angle: 0.4, angularVel: 0.3 };
    tm.down(1, stick.cx + 2, stick.cy - 2); // inside the deadzone
    const f = ds.apply(m.sample(ctx), att);
    expect(f.steer).toEqual({ x: 0, y: 0 });
    expect(frameFlight(f)).toEqual([]);
    // deflect, then back to the centre: coast again
    tm.move(1, stick.cx, stick.cy - stick.r);
    expect(frameFlight(ds.apply(m.sample(ctx), att)).length).toBeGreaterThan(0);
    tm.move(1, stick.cx, stick.cy); // the deflection was already sampled: no latch left, coast at once
    expect(frameFlight(ds.apply(m.sample(ctx), att))).toEqual([]);
    tm.up(1);
    expect(frameFlight(ds.apply(m.sample(ctx), att))).toEqual([]);
  });

  it('flick latch: a deflection that is centred again BEFORE the next tick steers exactly one tick, then nothing', () => {
    const { m, tm, stick } = rig();
    tm.down(1, stick.cx + stick.r, stick.cy);
    tm.move(1, stick.cx, stick.cy); // centred (deadzone) with no sample in between
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    // same for a tap-and-lift
    tm.up(1);
    tm.down(2, stick.cx, stick.cy - stick.r);
    tm.up(2);
    const once = m.sample(ctx).steer;
    expect(once.x).toBeCloseTo(0);
    expect(once.y).toBeCloseTo(-1);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    // a held deflection is NOT a latch: it steers every tick until centred
    tm.down(3, stick.cx - stick.r, stick.cy);
    for (let i = 0; i < 5; i++) expect(m.sample(ctx).steer).toEqual({ x: -1, y: 0 });
    tm.clear();
    expect(tm.stickHeld()).toBeNull();
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 }); // already sampled: clear() leaves no latch
  });

  it('a second finger cannot steal the stick, but takes it over when the owner lifts', () => {
    const { m, tm, stick } = rig();
    tm.down(1, stick.cx + stick.r, stick.cy);
    expect(tm.down(2, stick.cx - stick.r, stick.cy)).toBe(true); // tracked (captured), but waiting
    tm.move(2, stick.cx, stick.cy + stick.r);
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 }); // the owner still steers
    expect(tm.stickHeld()).toMatchObject({ x: stick.cx + stick.r, y: stick.cy });
    tm.up(1); // owner lifts: the resting finger adopts the stick from where it is now
    expect(tm.stickHeld()).toMatchObject({ x: stick.cx, y: stick.cy + stick.r });
    const s1 = m.sample(ctx).steer;
    expect(s1.x).toBeCloseTo(0);
    expect(s1.y).toBeCloseTo(1);
    tm.move(2, stick.cx + stick.r, stick.cy);
    expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    tm.up(2);
    m.sample(ctx);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
  });

  it('a waiting finger that slid out of the zone is not adopted; touches outside the zone do nothing', () => {
    const { m, tm, stick } = rig();
    tm.down(1, stick.cx + stick.r, stick.cy);
    tm.down(2, stick.cx, stick.cy - stick.r);
    tm.move(2, 800, 100); // wandered off to the right half
    tm.up(1);
    expect(tm.stickHeld()).toBeNull();
    m.sample(ctx); // flick latch of the owner
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    tm.move(2, stick.cx, stick.cy - stick.r); // coming back does not grab either: it must start in the zone
    expect(tm.stickHeld()).toBeNull();
    expect(tm.down(3, 800, 200)).toBe(false); // right half: free
  });

  it('relayout mid-drag (viewport resize, rotation, setting rebuild) keeps the finger on the stick', () => {
    const { m, tm, stick } = rig();
    tm.down(7, stick.cx, stick.cy - stick.r);
    m.sample(ctx);
    // mobile Safari's toolbar: the host gets 60 px shorter, the stick moves up 60 px
    const next = touchLayout('lander', 844, 330, { joystick: true });
    expect(tm.relayout(next)).toEqual([7]);
    expect(tm.stickHeld()).not.toBeNull();
    // the same finger keeps steering against the NEW stick
    tm.move(7, next.stick!.cx + next.stick!.r, next.stick!.cy);
    for (let i = 0; i < 3; i++) expect(m.sample(ctx).steer).toEqual({ x: 1, y: 0 });
    tm.up(7);
    m.sample(ctx);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
    // a relayout without a stick (steering switched to ENGINES) does drop it
    tm.down(8, next.stick!.cx + next.stick!.r, next.stick!.cy);
    expect(tm.relayout(touchLayout('lander', 844, 330))).toEqual([]);
    expect(tm.stickHeld()).toBeNull();
    m.sample(ctx);
    expect(m.sample(ctx).steer).toEqual({ x: 0, y: 0 });
  });

  it('layout: stick bottom-left, grab zone clear of pause / restart and in the left half; no flight buttons; harpoon modes unchanged', () => {
    for (const [w, h] of [
      [844, 390],
      [390, 844],
      [1280, 720],
      [667, 375],
    ] as const) {
      for (const mode of ['lander', 'csm'] as const) {
        const l = touchLayout(mode, w, h, { joystick: true });
        const s = l.stick!;
        expect(l.buttons.map((b) => b.control).sort()).toEqual(['pause', 'restart']);
        for (const b of l.buttons) expect(overlaps(b.rect, s.zone), `${w}x${h} ${b.id}`).toBe(false);
        expect(s.zone.x + s.zone.w).toBeLessThanOrEqual(w / 2 + 1);
        expect(contains(s.zone, s.cx, s.cy)).toBe(true);
        expect(s.cx - s.r).toBeGreaterThanOrEqual(0);
        expect(s.cy + s.r).toBeLessThanOrEqual(h);
        expect(s.cx).toBeLessThan(w / 3);
        expect(s.cy).toBeGreaterThan(h / 2);
      }
    }
    for (const mode of ['harpoon', 'harpoonThrust'] as const) expect(touchLayout(mode, 844, 390, { joystick: true })).toEqual(touchLayout(mode, 844, 390));
    // desktop joystick-only layout: the stick and nothing else
    const d = touchLayout('lander', 1280, 720, { joystick: true, systemButtons: false });
    expect(d.buttons).toEqual([]);
    expect(d.stick).not.toBeNull();
  });
});

describe('JOYSTICK: setting', () => {
  const c = (p: Partial<ScreenContext> = {}): ScreenContext => ({ levels: {}, save: null, showDebug: false, touchPref: 'auto', lastHull: null, ...p });
  const label = (ctx: ScreenContext, id: string) => screenModel({ id: 'paused', levelId: 'testpad' }, ctx).items.find((i) => i.id === id)!.label;

  it('STEERING cycles ENGINES -> DIRECT -> JOYSTICK -> AUTO (null) -> ENGINES', () => {
    expect(nextSteering('engines')).toBe('direct');
    expect(nextSteering('direct')).toBe('joystick');
    expect(nextSteering('joystick')).toBeNull();
    expect(nextSteering(null)).toBe('engines');
    expect(label(c({ steering: 'joystick' }), 'steering')).toBe('STEERING: JOYSTICK');
  });

  it('round 9 audit: AUTO shows the scheme it resolves to on the paused level; explicit values are shown as-is everywhere', () => {
    const at = (steering: ScreenContext['steering'], levelId: 'descent' | 'hangarRun' | 'testpad') =>
      screenModel({ id: 'paused', levelId }, c({ steering })).items.find((i) => i.id === 'steering')!.label;
    expect(at(null, 'descent')).toBe('STEERING: AUTO (ENGINES)');
    expect(at(null, 'hangarRun')).toBe('STEERING: AUTO (JOYSTICK)');
    expect(at(undefined, 'testpad')).toBe('STEERING: AUTO (JOYSTICK)');
    for (const lv of ['descent', 'hangarRun'] as const) {
      expect(at('engines', lv)).toBe('STEERING: ENGINES');
      expect(at('direct', lv)).toBe('STEERING: DIRECT');
      expect(at('joystick', lv)).toBe('STEERING: JOYSTICK');
    }
    // a full lap returns to AUTO and visits every explicit scheme once
    const seen: (string | null)[] = [];
    let s: ReturnType<typeof nextSteering> = null;
    for (let i = 0; i < 4; i++) seen.push((s = nextSteering(s)));
    expect(seen).toEqual(['engines', 'direct', 'joystick', null]);
  });

  it('Settings.steering joystick round-trips through the save; unknown values read as never chosen (null)', () => {
    const saved = JSON.parse(JSON.stringify({ version: SAVE_VERSION, settings: { ...DEFAULT_SETTINGS, steering: 'joystick' } }));
    expect(parseSave(saved)!.settings.steering).toBe('joystick');
    expect(parseSave({ version: SAVE_VERSION, settings: { steering: 'stick' } })!.settings.steering).toBeNull();
  });

  it('round 9: JOYSTICK is the default - new saves store null (never chosen), resolved to joystick at use', () => {
    expect(DEFAULT_STEERING).toBe('joystick');
    expect(DEFAULT_SETTINGS.steering).toBeNull();
    expect(defaultSave().version).toBe(2);
    expect(resolveSteering(null)).toBe('joystick');
    expect(resolveSteering(undefined)).toBe('joystick');
    for (const s of STEERING_SCHEMES) expect(resolveSteering(s)).toBe(s);
    // a fresh save survives the JSON round trip as null
    expect(parseSave(JSON.parse(JSON.stringify(defaultSave())))!.settings.steering).toBeNull();
    // the pause menu shows AUTO with the resolved scheme; the cycle leaves AUTO for ENGINES
    const c = (p: Partial<ScreenContext> = {}): ScreenContext => ({ levels: {}, save: null, showDebug: false, touchPref: 'auto', lastHull: null, ...p });
    expect(screenModel({ id: 'paused', levelId: 'testpad' }, c()).items.find((i) => i.id === 'steering')!.label).toBe('STEERING: AUTO (JOYSTICK)');
    expect(nextSteering(null)).toBe('engines');
  });

  it('round 9: the never-chosen default is per level - ENGINES on Descent, JOYSTICK elsewhere; an explicit choice applies everywhere', () => {
    expect(resolveSteering(null, 'descent')).toBe('engines');
    for (const id of ['hangarRun', 'floatingIsles', 'throat', 'vaults', 'hollow', 'keeper', 'madDash', 'testpad']) expect(resolveSteering(null, id), id).toBe('joystick');
    for (const s of STEERING_SCHEMES) {
      expect(resolveSteering(s, 'descent')).toBe(s);
      expect(resolveSteering(s, 'hangarRun')).toBe(s);
    }
  });

  it('round 9 migration: a v1 save\'s "engines" was the old default -> null (joystick); a v1 direct / joystick was a choice and is kept; a v2 explicit engines is kept', () => {
    const v1 = (steering: unknown) => parseSave({ version: 1, settings: { steering } })!.settings.steering;
    expect(v1('engines')).toBeNull();
    expect(v1('direct')).toBe('direct');
    expect(v1('joystick')).toBe('joystick');
    expect(v1(undefined)).toBeNull();
    expect(parseSave({ settings: { steering: 'engines' } })!.settings.steering).toBeNull(); // no version at all = legacy
    // the player cycles to ENGINES after the update: v2 keeps it across reloads
    const chosen = { ...defaultSave(), settings: { ...DEFAULT_SETTINGS, steering: 'engines' as const } };
    const back = parseSave(JSON.parse(JSON.stringify(chosen)))!;
    expect(back.settings.steering).toBe('engines');
    expect(back.version).toBe(2);
    // and the re-saved v1 data is written as v2 (the migration happens once)
    const migrated = parseSave(JSON.parse(JSON.stringify(parseSave({ version: 1, settings: { steering: 'engines' } }))))!;
    expect(migrated.settings.steering).toBeNull();
  });

  it('round 9 audit: legacy iff the version is not a finite number >= 2 (string / NaN / Infinity / missing)', () => {
    const steer = (version: unknown) => parseSave({ version, settings: { steering: 'engines' } })!.settings.steering;
    expect(steer(2)).toBe('engines');
    expect(steer(3)).toBe('engines');
    expect(steer(1)).toBeNull();
    expect(steer('2')).toBeNull();
    expect(steer(NaN)).toBeNull();
    expect(steer(Infinity)).toBeNull();
    expect(steer(-Infinity)).toBeNull();
    expect(steer(undefined)).toBeNull();
    expect(steer(null)).toBeNull();
  });

  it('round 9 audit: a full v1 save migrates with progress and every other setting intact; only the old default steering changes', () => {
    const v1 = {
      version: 1,
      unlocked: ['hangarRun', 'descent', 'floatingIsles'],
      best: { hangarRun: { timeSec: 41.5, score: 1200, orbs: 3 }, descent: { timeSec: 88.25, score: 2400, orbs: 5 } },
      seenCutscenes: ['briefing', 'meetIo', 'descentAwe'],
      settings: {
        musicVolume: 0.3,
        sfxVolume: 0.6,
        reducedMotion: true,
        touchControls: 'on',
        debugOverlay: true,
        swapEngineButtons: false,
        showFps: true,
        lowRes: true,
        steering: 'engines',
        showMinimap: false,
      },
    };
    const back = parseSave(JSON.parse(JSON.stringify(v1)))!;
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.unlocked).toEqual(v1.unlocked);
    expect(back.best).toEqual(v1.best);
    expect(back.seenCutscenes).toEqual(v1.seenCutscenes);
    const { steering, ...rest } = back.settings;
    expect(steering).toBeNull();
    const { steering: _old, ...v1rest } = v1.settings;
    expect(rest).toEqual({ ...v1rest });
    // a v1 player who chose DIRECT keeps it alongside everything else
    const d = parseSave({ ...v1, settings: { ...v1.settings, steering: 'direct' } })!;
    expect(d.settings).toEqual({ ...v1.settings, steering: 'direct' });
  });

  it('help card: JOYSTICK touch lines; keyboard keeps the DIRECT keys plus the mouse stick', () => {
    const t = helpCard('lander', true, true, false, true, true);
    expect(t.title).toMatch(/JOYSTICK/);
    const kb = helpCard('lander', false, true, false, true, true);
    expect(kb.lines.join(' ')).toMatch(/ROTATE LEFT/);
    expect(kb.lines.join(' ')).toMatch(/MOUSE/);
    expect(t.lines.join(' ')).not.toEqual(kb.lines.join(' '));
  });
});

// ------------------------------------------------------------------ minimap

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('minimap: bake', () => {
  it('bakes the whole level at 1/16 with a fill and a 1 px outline (world border not outlined)', () => {
    const spec = {
      worldSize: { w: 1600, h: 800 },
      terrain: { pieces: [{ kind: 'polygon' as const, points: box(320, 320, 320, 320) }] },
    } as unknown as Pick<LevelSpec, 'worldSize' | 'terrain'>;
    const b = bakeMinimap(spec);
    expect([b.w, b.h]).toEqual([100, 50]);
    const a = (c: number, r: number) => b.data[(r * b.w + c) * 4 + 3];
    expect(a(10, 10)).toBe(0); // empty
    expect(a(20, 20)).toBe(255); // corner = outline
    expect(a(25, 25)).toBe(150); // interior = fill
    expect(a(39, 30)).toBe(255); // right edge
    expect(a(40, 30)).toBe(0);
    // ground closed to the bottom: the bottom row is fill (the border counts as solid)
    const g = bakeMinimap({ worldSize: { w: 320, h: 320 }, terrain: { pieces: [{ kind: 'ground', points: [{ x: 0, y: 160 }, { x: 320, y: 160 }] }] } } as unknown as Pick<LevelSpec, 'worldSize' | 'terrain'>);
    const ga = (c: number, r: number) => g.data[(r * g.w + c) * 4 + 3];
    expect(ga(5, 5)).toBe(0);
    expect(ga(5, 10)).toBe(255); // top surface
    expect(ga(5, 19)).toBe(150);
    expect(ga(0, 15)).toBe(150); // left border: not outlined
  });

  it('every playable level bakes to ceil(world/16) and fits a 2048 texture', () => {
    for (const spec of Object.values(LEVELS)) {
      const b = bakeMinimap(spec!);
      expect([b.w, b.h]).toEqual([Math.ceil(spec!.worldSize.w / MINIMAP_SCALE), Math.ceil(spec!.worldSize.h / MINIMAP_SCALE)]);
      expect(Math.max(b.w, b.h)).toBeLessThanOrEqual(2048);
      expect(b.data.some((v) => v !== 0)).toBe(true);
    }
  });

  it('MinimapView bakes ONCE per level; frames only move the texture frame (no re-bake, frame object reused)', () => {
    const view = new MinimapView();
    const spec = LEVELS.hangarRun!;
    let uploads = 0;
    view.setLevel(spec, () => uploads++);
    expect(view.bakes).toBe(1);
    expect(uploads).toBe(1);
    expect(view.bakedSize).toEqual({ w: Math.ceil(spec.worldSize.w / 16), h: Math.ceil(spec.worldSize.h / 16) });
    const sprite = (view as unknown as { sprite: { texture: { frame: { x: number; y: number; width: number; height: number } } } }).sprite;
    const tex = sprite.texture;
    const frameObj = tex.frame;
    for (let i = 0; i < 600; i++) view.render(400 + i * 10, 800, 0.1 * i, 520, 280, 0xffffff);
    expect(view.bakes).toBe(1);
    expect(sprite.texture).toBe(tex);
    expect(tex.frame).toBe(frameObj);
    const l = minimapLayout(createMinimapLayout(), view.bakedSize.w, view.bakedSize.h, 400 + 599 * 10, 800, null);
    expect([frameObj.x, frameObj.y, frameObj.width, frameObj.height]).toEqual([l.fx, l.fy, l.fw, l.fh]);
    view.setLevel(LEVELS.descent!);
    expect(view.bakes).toBe(2);
    // leaving the level frees the texture; render is then a no-op until the next level bakes
    const descentTex = sprite.texture as unknown as { destroyed: boolean };
    view.clear();
    expect(view.hasTexture).toBe(false);
    expect(descentTex.destroyed).toBe(true);
    expect(view.root.visible).toBe(false);
    view.render(100, 100, 0, 0, 0, 0xffffff);
    expect(view.bakes).toBe(2);
    view.setLevel(LEVELS.hangarRun!);
    expect(view.hasTexture).toBe(true);
    expect(view.bakes).toBe(3);
    view.destroy();
  });
});

describe('minimap: marker math', () => {
  const exitAt = (x: number, y: number, h = 100) => ({ x, y, h });

  it('world -> minimap: the window is centred on the vessel; vessel and an in-range exit land at world/16 offsets', () => {
    const l = minimapLayout(createMinimapLayout(), 500, 100, 3200, 800, exitAt(3520, 900));
    expect(l.winX).toBe(200 - MINIMAP_W / 2);
    expect(l.winY).toBe(50 - MINIMAP_H / 2);
    expect(l.vx).toBeCloseTo(MINIMAP_W / 2);
    expect(l.vy).toBeCloseTo(MINIMAP_H / 2);
    expect(l.exitInside).toBe(true);
    expect(l.ex).toBeCloseTo(MINIMAP_W / 2 + 20);
    expect(l.ey).toBeCloseTo(MINIMAP_H / 2 + (850 - 800) / 16);
    expect([l.fx, l.fy, l.fw, l.fh, l.ox, l.oy]).toEqual([l.winX, l.winY, MINIMAP_W, MINIMAP_H, 0, 0]);
    const low = minimapLayout(createMinimapLayout(), 500, 80, 3200, 800, null); // level bottom at 80 baked px
    expect(low.fh).toBe(80 - low.winY); // clipped at the level bottom
  });

  it('the frame clips at the level edges (offset inside the window)', () => {
    const l = minimapLayout(createMinimapLayout(), 500, 100, 0, 0, null);
    expect([l.fx, l.fy, l.ox, l.oy, l.fw, l.fh]).toEqual([0, 0, MINIMAP_W / 2, MINIMAP_H / 2, MINIMAP_W / 2, MINIMAP_H / 2]);
    expect(l.hasExit).toBe(false);
    const far = minimapLayout(createMinimapLayout(), 500, 100, 1e6, 1e6, null);
    expect(far.fw * far.fh).toBe(0);
  });

  const I = MINIMAP_EDGE_INSET;
  it('an out-of-range exit is pinned to the window edge inset along the vessel -> exit ray', () => {
    const l = createMinimapLayout();
    minimapLayout(l, 500, 500, 1600, 1600, exitAt(1600 + 16 * 1000, 1650)); // far right, level
    expect(l.exitInside).toBe(false);
    expect(l.ex).toBeCloseTo(MINIMAP_W - I);
    expect(l.ey).toBeCloseTo(l.vy, 0);
    expect(l.exitAngle).toBeCloseTo(0, 2);
    minimapLayout(l, 500, 500, 1600, 1600, exitAt(1600, 1650 - 16 * 1000)); // far up
    expect(l.ey).toBeCloseTo(I);
    expect(l.ex).toBeCloseTo(l.vx);
    expect(l.exitAngle).toBeCloseTo(-Math.PI / 2);
    minimapLayout(l, 500, 500, 1600, 1600, exitAt(1600 - 16 * 500, 1650 + 16 * 500)); // far down-left
    expect(l.ex).toBeGreaterThanOrEqual(I);
    expect(l.ey).toBeLessThanOrEqual(MINIMAP_H - I);
    expect(l.ex === I || Math.abs(l.ey - (MINIMAP_H - I)) < 1e-9).toBe(true);
    // the pinned point lies on the ray
    expect(Math.atan2(l.ey - l.vy, l.ex - l.vx)).toBeCloseTo(l.exitAngle);
  });

  it('the pinned exit square and its edge arrow stay inside the window in every direction', () => {
    const l = createMinimapLayout();
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * 2 * Math.PI;
      for (const vy of [10, 600, 1590]) {
        // vessel anywhere (also near the level edge), exit far away at angle a
        minimapLayout(l, 500, 100, 3200, vy, { x: 3200 + 1e5 * Math.cos(a), y: vy + 50 + 1e5 * Math.sin(a), h: 100 });
        expect(l.exitInside).toBe(false);
        // square ±3, arrow ±3 around (ax, ay): all inside [0, W] × [0, H]
        expect(l.ex - 3).toBeGreaterThanOrEqual(0);
        expect(l.ex + 3).toBeLessThanOrEqual(MINIMAP_W);
        expect(l.ey - 3).toBeGreaterThanOrEqual(0);
        expect(l.ey + 3).toBeLessThanOrEqual(MINIMAP_H);
        expect(Math.round(l.ax) - 3).toBeGreaterThanOrEqual(0);
        expect(Math.round(l.ax) + 3).toBeLessThanOrEqual(MINIMAP_W);
        expect(Math.round(l.ay) - 3).toBeGreaterThanOrEqual(0);
        expect(Math.round(l.ay) + 3).toBeLessThanOrEqual(MINIMAP_H);
        // the arrow is on the exit side of the square
        expect((l.ax - l.ex) * Math.cos(l.exitAngle) + (l.ay - l.ey) * Math.sin(l.exitAngle)).toBeGreaterThan(0);
      }
    }
  });

  it('placement: bottom-right by default; shifts left past controls, else lifts above them', () => {
    const W = MinimapView.outerW;
    const H = MinimapView.outerH;
    expect(minimapPlacement([], W, H, 640, 360)).toEqual({ x: 640 - 4 - W, y: 360 - 4 - H });
    const cluster: Rect = { x: 560, y: 280, w: 76, h: 76 };
    const p = minimapPlacement([cluster], W, H, 640, 360);
    expect(overlaps({ x: p.x, y: p.y, w: W, h: H }, cluster)).toBe(false);
    expect(p.y).toBe(360 - 4 - H);
    const wide: Rect = { x: 300, y: 300, w: 340, h: 60 };
    const q = minimapPlacement([wide], W, H, 640, 360);
    expect(overlaps({ x: q.x, y: q.y, w: W, h: H }, wide)).toBe(false);
    expect(q.y).toBeGreaterThanOrEqual(80);
  });
});

describe('minimap: setting', () => {
  it('Settings.showMinimap defaults on, old saves read on, off round-trips', () => {
    expect(DEFAULT_SETTINGS.showMinimap).toBe(true);
    expect(parseSave({ settings: { swapEngineButtons: true } })!.settings.showMinimap).toBe(true);
    expect(parseSave({ settings: { showMinimap: 'no' } })!.settings.showMinimap).toBe(true);
    expect(parseSave(JSON.parse(JSON.stringify({ settings: { ...DEFAULT_SETTINGS, showMinimap: false } })))!.settings.showMinimap).toBe(false);
  });

  it('pause menu MINIMAP item reflects and toggles the setting', () => {
    const c = (p: Partial<ScreenContext> = {}): ScreenContext => ({ levels: {}, save: null, showDebug: false, touchPref: 'auto', lastHull: null, ...p });
    const lbl = (ctx: ScreenContext) => screenModel({ id: 'paused', levelId: 'testpad' }, ctx).items.find((i) => i.id === 'minimap')!.label;
    expect(lbl(c())).toBe('MINIMAP: ON');
    expect(lbl(c({ showMinimap: false }))).toBe('MINIMAP: OFF');
    expect(itemAction({ id: 'paused', levelId: 'testpad' }, 'minimap', c())).toEqual({ ui: 'toggleMinimap' });
  });
});
