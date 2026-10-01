/**
 * Round 11 (a player's request: "switch side joystick and map via pause menu"):
 * Settings.stickSide, the mirrored touch layout, the minimap on the other
 * corner, and no ghost stick when the side flips under a held finger.
 */

import { describe, expect, it } from 'vitest';
import type { ControlId, Rect, Vec2, VesselMode } from '../src/contracts';
import { helpCard } from '../src/ui/controlsHelp';
import { DEFAULT_SETTINGS, defaultSave, parseSave, SaveStore, type StorageLike } from '../src/story/save';
import { minimapPlacement, minimapSide, MinimapView } from '../src/ui/minimap';
import { itemAction, screenModel, stickSideLabel, type ScreenContext } from '../src/ui/screens';
import { overlaps, touchLayout, type TouchLayout, type TouchLayoutOptions } from '../src/ui/touch/touchLayout';
import { TouchModel } from '../src/ui/touch/touchModel';

/** Phones (landscape + portrait), tablets, desktop - CSS px. */
const SIZES: [number, number][] = [
  [300, 300],
  [320, 240],
  [401, 250],
  [568, 320],
  [667, 375],
  [375, 667],
  [844, 390],
  [932, 430],
  [390, 844],
  [1024, 768],
  [1366, 1024],
  [1280, 720],
  [1920, 1080],
];
const MODES: VesselMode[] = ['lander', 'csm', 'harpoon', 'harpoonThrust'];
const SCHEMES: { name: string; o: TouchLayoutOptions }[] = [
  { name: 'engines', o: {} },
  { name: 'direct', o: { direct: true } },
  { name: 'joystick', o: { joystick: true } },
  { name: 'joystick desktop', o: { joystick: true, systemButtons: false } },
];

const sys = (l: TouchLayout) => l.buttons.filter((b) => b.system).map((b) => b.rect);
const flight = (l: TouchLayout) => l.buttons.filter((b) => !b.system);
const inside = (a: Rect, w: number, h: number) => a.x >= 0 && a.y >= 0 && a.x + a.w <= w && a.y + a.h <= h;

describe('round 11 LAYOUT: touch layout mirror', () => {
  it('stick right: the grab zone is in the right half, below the pause / restart row, and mirrors the left one', () => {
    for (const [w, h] of SIZES) {
      for (const mode of ['lander', 'csm'] as const) {
        for (const systemButtons of [true, false]) {
          const tag = `${w}x${h} ${mode} sys=${systemButtons}`;
          const L = touchLayout(mode, w, h, { joystick: true, systemButtons });
          const R = touchLayout(mode, w, h, { joystick: true, systemButtons, stickRight: true });
          const a = L.stick!;
          const b = R.stick!;
          expect(b.zone.x, tag).toBeGreaterThanOrEqual(w / 2 - 0.5);
          expect(b.zone.x + b.zone.w, tag).toBe(w);
          expect(inside(b.zone, w, h), tag).toBe(true);
          expect(b.cx, tag).toBeGreaterThan(w / 2);
          // the exact mirror image (±1 px rounding)
          expect(Math.abs(b.cx - (w - a.cx)), tag).toBeLessThanOrEqual(1);
          expect(Math.abs(b.zone.x - (w - a.zone.x - a.zone.w)), tag).toBeLessThanOrEqual(1);
          expect([b.cy, b.r, b.zone.y, b.zone.h, b.zone.w], tag).toEqual([a.cy, a.r, a.zone.y, a.zone.h, a.zone.w]);
          // the base sits inside its own zone and the screen
          expect(b.cx + b.r, tag).toBeLessThanOrEqual(w);
          expect(b.cx - b.r, tag).toBeGreaterThanOrEqual(b.zone.x);
          // pause / restart untouched and never under the zone
          expect(sys(R), tag).toEqual(sys(L));
          for (const s of sys(R)) expect(overlaps(s, b.zone), tag).toBe(false);
          // the opposite (left) half stays free for the minimap
          expect(overlaps(b.zone, { x: 0, y: 0, w: Math.floor(w / 2), h }), tag).toBe(false);
        }
      }
    }
  });

  it('classic CSM buttons mirror (THRUST lower-left, ◀ ▶ lower-right in order); the lander and harpoon buttons stay; DIRECT has none', () => {
    for (const [w, h] of SIZES) {
      for (const mode of MODES) {
        for (const { name, o } of SCHEMES) {
          const tag = `${w}x${h} ${mode} ${name}`;
          const L = touchLayout(mode, w, h, o);
          const R = touchLayout(mode, w, h, { ...o, stickRight: true });
          expect(sys(R), tag).toEqual(sys(L));
          for (const b of R.buttons) expect(inside(b.rect, w, h), `${tag} ${b.id}`).toBe(true);
          const fl = flight(R);
          // no flight button overlaps another, a system button, or the stick zone
          for (let i = 0; i < fl.length; i++) {
            // (pre-existing, untouched by LAYOUT: on a ≤240-tall screen harpoonThrust's THR bar reaches the pause button)
            const tinyHarpoon = mode === 'harpoonThrust' && h <= 240;
            if (!tinyHarpoon) for (const s of sys(R)) expect(overlaps(fl[i]!.rect, s), `${tag} ${fl[i]!.id}`).toBe(false);
            for (let j = i + 1; j < fl.length; j++) expect(overlaps(fl[i]!.rect, fl[j]!.rect), `${tag} ${fl[i]!.id}/${fl[j]!.id}`).toBe(false);
            if (R.stick) expect(overlaps(fl[i]!.rect, R.stick.zone), tag).toBe(false);
          }
          if (mode === 'csm' && name === 'engines') {
            const at = (l: TouchLayout, c: ControlId) => l.buttons.find((b) => b.control === c)!.rect;
            // the exact mirror of each button, the rotate pair still ◀ then ▶
            for (const c of ['thrust', 'rotateCCW', 'rotateCW'] as const) {
              const a = at(L, c);
              const b = at(R, c);
              expect([b.y, b.w, b.h], `${tag} ${c}`).toEqual([a.y, a.w, a.h]);
            }
            expect(Math.abs(at(R, 'thrust').x - (w - at(L, 'thrust').x - at(L, 'thrust').w))).toBeLessThanOrEqual(1);
            expect(at(R, 'thrust').x + at(R, 'thrust').w).toBeLessThan(w / 2);
            expect(at(R, 'rotateCCW').x).toBeGreaterThan(w / 2);
            expect(at(R, 'rotateCCW').x).toBeLessThan(at(R, 'rotateCW').x);
            expect(Math.abs(at(R, 'rotateCCW').x - (w - at(L, 'rotateCW').x - at(L, 'rotateCW').w))).toBeLessThanOrEqual(1);
          } else {
            // symmetric (lander) / unaffected (harpoon modes, DIRECT, JOYSTICK's buttons): identical
            expect(R.buttons, tag).toEqual(L.buttons);
            expect(R.aimZone, tag).toEqual(L.aimZone);
          }
        }
      }
    }
  });
});

/** GameUi's css -> view mapping: the 640×360 view letterboxed into the host (uniform scale, centred). */
function toView(css: Rect[], w: number, h: number): Rect[] {
  const k = Math.min(w / 640, h / 360);
  const ox = (w - 640 * k) / 2;
  const oy = (h - 360 * k) / 2;
  return css.map((r) => ({ x: (r.x - ox) / k, y: (r.y - oy) / k, w: r.w / k, h: r.h / k }));
}
/** GameUi.touchRectsInView: flight buttons, the aim zone, the stick base. */
function controls(l: TouchLayout): Rect[] {
  const out = flight(l).map((b) => b.rect);
  if (l.aimZone) out.push(l.aimZone);
  if (l.stick) out.push({ x: l.stick.cx - l.stick.r, y: l.stick.cy - l.stick.r, w: 2 * l.stick.r, h: 2 * l.stick.r });
  return out;
}

describe('round 11 LAYOUT: minimap on the left', () => {
  const W = MinimapView.outerW;
  const H = MinimapView.outerH;

  it("side 'left' = bottom-left corner, the mirror of the right placement", () => {
    expect(minimapPlacement([], W, H, 640, 360, 4, 80, 'left')).toEqual({ x: 4, y: 360 - 4 - H });
    const cluster: Rect = { x: 4, y: 280, w: 76, h: 76 };
    const p = minimapPlacement([cluster], W, H, 640, 360, 4, 80, 'left')!;
    expect(overlaps({ x: p.x, y: p.y, w: W, h: H }, cluster)).toBe(false);
    expect(p.y).toBe(360 - 4 - H);
    expect(p.x).toBeLessThan(320);
    const wide: Rect = { x: 0, y: 300, w: 340, h: 60 };
    const q = minimapPlacement([wide], W, H, 640, 360, 4, 80, 'left')!;
    expect(overlaps({ x: q.x, y: q.y, w: W, h: H }, wide)).toBe(false);
    expect(q.y).toBeGreaterThanOrEqual(80);
    expect(q.x).toBeLessThan(320);
  });

  it('every screen size × mode × scheme: the minimap clear of every control (the aim zone too) and the objectives (y ≥ 80); stick right = the left half (stick / CSM), the unmirrored harpoon modes keep the default spot', () => {
    const report: string[] = [];
    for (const [w, h] of SIZES) {
      const normal = w >= 568 && h >= 320;
      for (const mode of MODES) {
        for (const { name, o } of SCHEMES) {
          const tag = `${w}x${h} ${mode} ${name}`;
          const at: Record<string, { x: number; y: number } | null> = {};
          for (const right of [false, true]) {
            const l = touchLayout(mode, w, h, { ...o, stickRight: right });
            // exactly what GameUi passes: flight buttons, the aim zone, the stick base
            const avoid = toView(controls(l), w, h);
            const p = minimapPlacement(avoid, W, H, 640, 360, 4, 80, minimapSide(right, !!l.aimZone));
            at[String(right)] = p;
            if (!p) {
              // hidden: only allowed where the controls leave no room (tiny / short screens)
              expect(normal, `${tag} right=${right} hidden`).toBe(false);
              report.push(`${tag} right=${right}: hidden`);
              continue;
            }
            const box = { x: p.x, y: p.y, w: W, h: H };
            expect(inside(box, 640, 360), tag).toBe(true);
            expect(p.y, tag).toBeGreaterThanOrEqual(80);
            for (const a of avoid) expect(overlaps(box, a), `${tag} right=${right} ${JSON.stringify(p)}`).toBe(false);
            if (!normal) continue;
            if (l.aimZone) {
              // harpoon modes: the controls do not mirror, nor does the minimap; it stays low (bottom row)
              expect(p.y, `${tag} right=${right}`).toBeGreaterThanOrEqual(200);
            } else if (right) expect(p.x + W, tag).toBeLessThanOrEqual(320);
            else expect(p.x, tag).toBeGreaterThanOrEqual(320);
          }
          if (mode === 'harpoon' || mode === 'harpoonThrust') expect(at.true, tag).toEqual(at.false);
        }
      }
    }
    expect(report.length).toBeLessThan(SIZES.length * MODES.length * SCHEMES.length * 2);
  });

  it('pre-existing (audit): tiny / short screens never put the default minimap on the harpoon buttons (re-check after the minTop clamp)', () => {
    for (const [w, h] of [
      [300, 300],
      [401, 250],
      [320, 240],
    ] as const) {
      for (const mode of MODES) {
        const l = touchLayout(mode, w, h, {});
        const avoid = toView(controls(l), w, h);
        const p = minimapPlacement(avoid, W, H, 640, 360);
        if (p) for (const a of avoid) expect(overlaps({ x: p.x, y: p.y, w: W, h: H }, a), `${w}x${h} ${mode}`).toBe(false);
      }
    }
    // a column of controls from the bottom to minTop: the old code returned (corner.x, 80) on top of them
    const col: Rect[] = [{ x: 500, y: 60, w: 140, h: 300 }];
    const p = minimapPlacement(col, W, H, 640, 360)!;
    expect(overlaps({ x: p.x, y: p.y, w: W, h: H }, col[0]!)).toBe(false);
    expect(p.y).toBe(360 - 4 - H); // the bottom row, left of the column
    // nothing fits anywhere: hidden
    expect(minimapPlacement([{ x: 0, y: 70, w: 640, h: 290 }], W, H, 640, 360)).toBeNull();
    expect(minimapPlacement([{ x: 0, y: 70, w: 640, h: 290 }], W, H, 640, 360, 4, 80, 'left')).toBeNull();
  });
});

describe('round 11 LAYOUT: setting + pause menu', () => {
  it('Settings.stickSide defaults left; old / bad saves read left; right round-trips through storage', () => {
    expect(DEFAULT_SETTINGS.stickSide).toBe('left');
    expect(defaultSave().settings.stickSide).toBe('left');
    // a round-10 save (no field), a v1 save, junk values
    expect(parseSave({ version: 2, settings: { showMinimap: false, steering: 'joystick' } })!.settings.stickSide).toBe('left');
    expect(parseSave({ version: 1, settings: { swapEngineButtons: true } })!.settings.stickSide).toBe('left');
    for (const bad of ['LEFT', 'up', 1, null, true]) expect(parseSave({ version: 2, settings: { stickSide: bad } })!.settings.stickSide).toBe('left');
    expect(parseSave(JSON.parse(JSON.stringify({ version: 2, settings: { ...DEFAULT_SETTINGS, stickSide: 'right' } })))!.settings.stickSide).toBe('right');
    const mem = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
    const a = new SaveStore(storage);
    expect(a.state.settings.stickSide).toBe('left');
    a.setSettings({ stickSide: 'right' });
    const b = new SaveStore(storage);
    expect(b.state.settings.stickSide).toBe('right');
    expect(b.state.settings.showMinimap).toBe(true); // nothing else moved
  });

  it('pause menu LAYOUT item: label per side, toggles via toggleStickSide', () => {
    const c = (stickSide?: 'left' | 'right'): ScreenContext => ({ levels: {}, save: null, showDebug: false, touchPref: 'auto', lastHull: null, ...(stickSide ? { stickSide } : {}) }) as ScreenContext;
    const s = { id: 'paused', levelId: 'testpad' } as const;
    const item = (ctx: ScreenContext) => screenModel(s, ctx).items.find((i) => i.id === 'layout')!;
    expect(item(c()).label).toBe('LAYOUT: STICK LEFT');
    expect(item(c('right')).label).toBe('LAYOUT: STICK RIGHT');
    expect(item(c()).enabled).toBe(true);
    expect(stickSideLabel('left')).toBe('LAYOUT: STICK LEFT');
    expect(itemAction(s, 'layout', c())).toEqual({ ui: 'toggleStickSide' });
  });
});

describe('round 11 LAYOUT: no ghost stick across a swap', () => {
  const sink = () => {
    const steer: (Vec2 | null)[] = [];
    const held = new Set<ControlId>();
    return { steer, held, s: { press: (c: ControlId) => held.add(c), release: (c: ControlId) => held.delete(c), setAim() {}, setSteer: (d: Vec2 | null) => steer.push(d) } };
  };

  for (const [w, h] of [
    [844, 390],
    [1366, 1024],
  ] as const) {
    it(`${w}x${h}: a held (and a waiting) stick finger is released when the stick changes side; later moves / lifts do nothing`, () => {
      for (const [from, to] of [
        [false, true],
        [true, false],
      ]) {
        const k = sink();
        const m = new TouchModel(k.s);
        const A = touchLayout('lander', w, h, { joystick: true, stickRight: from });
        m.setLayout(A);
        const st = A.stick!;
        expect(m.down(1, st.cx + st.r, st.cy)).toBe(true);
        expect(k.steer.at(-1)).toEqual({ x: 1, y: 0 });
        expect(m.down(2, st.cx, st.cy - st.r)).toBe(true); // waits
        const B = touchLayout('lander', w, h, { joystick: true, stickRight: to });
        expect(m.relayout(B)).toEqual([]); // nothing carried: the DOM layer re-captures nobody
        expect(k.steer.at(-1)).toBeNull();
        expect(m.stickHeld()).toBeNull();
        const n = k.steer.length;
        m.move(1, B.stick!.cx - B.stick!.r, B.stick!.cy); // the old thumb drags on
        m.up(1);
        m.move(2, B.stick!.cx, B.stick!.cy + B.stick!.r); // the waiting finger can't take over either
        m.up(2);
        expect(k.steer.length).toBe(n);
        expect(m.stickHeld()).toBeNull();
        // the new stick works for a fresh touch
        expect(m.down(3, B.stick!.cx, B.stick!.cy - B.stick!.r)).toBe(true);
        expect(k.steer.at(-1)).toEqual({ x: 0, y: -1 });
        m.up(3);
        expect(k.steer.at(-1)).toBeNull();
      }
    });
  }

  it('a same-side relayout (resize / toolbar) still carries the stick finger', () => {
    const k = sink();
    const m = new TouchModel(k.s);
    for (const right of [false, true]) {
      const A = touchLayout('csm', 844, 390, { joystick: true, stickRight: right });
      m.setLayout(A);
      expect(m.down(1, A.stick!.cx + A.stick!.r, A.stick!.cy)).toBe(true);
      const B = touchLayout('csm', 844, 340, { joystick: true, stickRight: right });
      expect(m.relayout(B)).toEqual([1]);
      expect(m.stickHeld()).not.toBeNull();
      m.up(1);
      expect(k.steer.at(-1)).toBeNull();
    }
  });

  it('a swap from ENGINES buttons (CSM mirrored) releases held buttons', () => {
    const k = sink();
    const m = new TouchModel(k.s);
    const A = touchLayout('csm', 844, 390, {});
    m.setLayout(A);
    const t = A.buttons.find((b) => b.control === 'thrust')!.rect;
    m.down(1, t.x + 1, t.y + 1);
    expect(k.held.has('thrust')).toBe(true);
    m.relayout(touchLayout('csm', 844, 390, { stickRight: true }));
    expect(k.held.size).toBe(0);
    m.move(1, 5, 380);
    expect(k.held.size).toBe(0);
  });
});

describe('round 11 LAYOUT: the controls card names the side', () => {
  it('stick right: RIGHT STICK / BOTTOM RIGHT; the classic CSM thumbs swap; lander / harpoon / DIRECT cards unchanged', () => {
    for (const mode of ['lander', 'csm'] as const) {
      expect(helpCard(mode, true, true, false, false, true).lines.join(' ')).toMatch(/LEFT STICK/);
      const r = helpCard(mode, true, true, false, false, true, true).lines.join(' ');
      expect(r).toMatch(/RIGHT STICK/);
      expect(r).not.toMatch(/LEFT STICK/);
      expect(helpCard(mode, false, true, false, false, true, true).lines.join(' ')).toMatch(/BOTTOM RIGHT/);
      expect(helpCard(mode, true, true, false, true, false, true)).toEqual(helpCard(mode, true, true, false, true, false));
    }
    const csm = helpCard('csm', true, true, false, false, false, true).lines;
    expect(csm.join(' ')).toMatch(/◀ ▶ \(RIGHT THUMB\)/);
    expect(csm.join(' ')).toMatch(/THRUST \(LEFT THUMB\)/);
    for (const mode of ['lander', 'harpoon', 'harpoonThrust'] as const)
      for (const swap of [false, true]) expect(helpCard(mode, true, true, swap, false, false, true), mode).toEqual(helpCard(mode, true, true, swap, false, false));
  });
});
