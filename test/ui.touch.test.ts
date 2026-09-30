import { describe, expect, it } from 'vitest';
import type { ControlId, InputSampleContext, Vec2 } from '../src/contracts';
import { VESSEL_MODES } from '../src/contracts';
import { InputMapper, VirtualControlsSource } from '../src/shell/input';
import { measureText, glyphFor, hasGlyph } from '../src/ui/font';
import { shouldShowRotateHint } from '../src/ui/rotateHint';
import { contains, overlaps, touchLayout } from '../src/ui/touch/touchLayout';
import { nextTouchPref, TouchModel, touchVisible } from '../src/ui/touch/touchModel';

class Sink {
  log: string[] = [];
  aim: Vec2 | null = null;
  press(c: ControlId) {
    this.log.push(`+${c}`);
  }
  release(c: ControlId) {
    this.log.push(`-${c}`);
  }
  setAim(d: Vec2 | null) {
    this.aim = d;
  }
}

const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const SIZES = [
  [844, 390], // iPhone landscape (safe area removed ~ similar)
  [667, 375],
  [568, 320], // small phone
  [1024, 768], // tablet
  [1920, 1080],
  [390, 844], // portrait (letterboxed)
] as const;

describe('touch layout', () => {
  it('every target is >= 48 CSS px, inside the host box (= safe area), non-overlapping', () => {
    for (const mode of VESSEL_MODES) {
      for (const [w, h] of SIZES) {
        const l = touchLayout(mode, w, h);
        for (const b of l.buttons) {
          expect(b.rect.w, `${mode} ${b.id} ${w}x${h}`).toBeGreaterThanOrEqual(48);
          expect(b.rect.h).toBeGreaterThanOrEqual(48);
          expect(b.rect.x).toBeGreaterThanOrEqual(0);
          expect(b.rect.y).toBeGreaterThanOrEqual(0);
          expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(w);
          expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(h);
        }
        for (let i = 0; i < l.buttons.length; i++)
          for (let j = i + 1; j < l.buttons.length; j++)
            expect(overlaps(l.buttons[i]!.rect, l.buttons[j]!.rect), `${mode} ${l.buttons[i]!.id}/${l.buttons[j]!.id} ${w}x${h}`).toBe(false);
        if (l.aimZone) {
          expect(l.aimZone.w).toBeGreaterThan(48);
          expect(l.aimZone.h).toBeGreaterThan(48);
          for (const b of l.buttons) expect(overlaps(l.aimZone, b.rect), `${mode} aim/${b.id} ${w}x${h}`).toBe(false);
        }
      }
    }
  });

  it('per-mode control sets', () => {
    const ids = (m: (typeof VESSEL_MODES)[number]) => touchLayout(m, 844, 390).buttons.map((b) => b.control).sort();
    expect(ids('csm')).toEqual(['pause', 'rotateCCW', 'rotateCW', 'thrust']);
    expect(ids('lander')).toEqual(['engineLeft', 'engineRight', 'pause', 'topLeft', 'topRight']);
    expect(ids('harpoon')).toEqual(['fire', 'pause', 'reelIn', 'reelOut', 'release']);
    expect(ids('harpoonThrust')).toEqual(['fire', 'pause', 'reelIn', 'reelOut', 'release', 'rotateCCW', 'rotateCW', 'thrust']);
    expect(touchLayout('lander', 844, 390).aimZone).toBeNull();
    expect(touchLayout('harpoon', 844, 390).aimZone).not.toBeNull();
  });

  it('lander engines sit in the bottom corners (thumb zones)', () => {
    const l = touchLayout('lander', 844, 390);
    const left = l.buttons.find((b) => b.control === 'engineLeft')!.rect;
    const right = l.buttons.find((b) => b.control === 'engineRight')!.rect;
    expect(left.x).toBeLessThan(40);
    expect(844 - (right.x + right.w)).toBeLessThan(40);
    expect(390 - (left.y + left.h)).toBeLessThan(40);
  });
});

describe('S9 lander top-thruster buttons', () => {
  it('sit above the engine buttons on the same side, ~0.7x their size, >= 48 CSS px', () => {
    for (const [w, h] of SIZES) {
      const l = touchLayout('lander', w, h);
      const get = (c: string) => l.buttons.find((b) => b.control === c)!.rect;
      for (const [top, eng] of [
        ['topLeft', 'engineLeft'],
        ['topRight', 'engineRight'],
      ] as const) {
        const t = get(top);
        const e = get(eng);
        expect(t.y + t.h, `${top} ${w}x${h}`).toBeLessThanOrEqual(e.y);
        expect(t.w).toBeGreaterThanOrEqual(48);
        expect(t.w).toBeLessThan(e.w);
        expect(t.w).toBeGreaterThanOrEqual(Math.min(e.w * 0.7 - 1, 48) - 0);
        // same side of the screen as its engine button
        expect(Math.sign(t.x + t.w / 2 - w / 2)).toBe(Math.sign(e.x + e.w / 2 - w / 2));
      }
    }
  });
});

describe('S9 swapped engine buttons (touch)', () => {
  const side = (l: ReturnType<typeof touchLayout>, control: string, w: number) => {
    const b = l.buttons.find((x) => x.control === control)!;
    return b.rect.x + b.rect.w / 2 < w / 2 ? 'left' : 'right';
  };

  it('direct mapping: left buttons fire the left engine / top thruster', () => {
    const l = touchLayout('lander', 844, 390, { swapEngines: false });
    expect(side(l, 'engineLeft', 844)).toBe('left');
    expect(side(l, 'engineRight', 844)).toBe('right');
    expect(side(l, 'topLeft', 844)).toBe('left');
    expect(side(l, 'topRight', 844)).toBe('right');
    expect(touchLayout('lander', 844, 390)).toEqual(l); // pure default = direct
  });

  it('swapped: the LEFT buttons fire the RIGHT engine / top thruster and vice versa; labels name the engine', () => {
    for (const [w, h] of SIZES) {
      const l = touchLayout('lander', w, h, { swapEngines: true });
      expect(side(l, 'engineRight', w), `${w}x${h}`).toBe('left');
      expect(side(l, 'engineLeft', w)).toBe('right');
      expect(side(l, 'topRight', w)).toBe('left');
      expect(side(l, 'topLeft', w)).toBe('right');
      expect(l.buttons.find((b) => b.control === 'engineRight')!.label).toBe('R ENG');
      // same rects as the direct layout, only the controls move
      const d = touchLayout('lander', w, h);
      expect(l.buttons.map((b) => b.rect).sort((a, b) => a.x - b.x || a.y - b.y)).toEqual(d.buttons.map((b) => b.rect).sort((a, b) => a.x - b.x || a.y - b.y));
    }
  });

  it('touch model: pressing the bottom-left button presses engineRight when swapped, engineLeft when direct', () => {
    for (const [swap, left, right, topLeftSide] of [
      [true, 'engineRight', 'engineLeft', 'topRight'],
      [false, 'engineLeft', 'engineRight', 'topLeft'],
    ] as const) {
      const l = touchLayout('lander', 844, 390, { swapEngines: swap });
      const bl = l.buttons.filter((b) => b.control !== 'pause').sort((a, b) => a.rect.x - b.rect.x || b.rect.y - a.rect.y);
      const bottomLeft = centre(bl[0]!.rect);
      const topLeftBtn = centre(bl[1]!.rect);
      const bottomRight = centre(l.buttons.find((b) => b.control === right)!.rect);
      const sink = new Sink();
      const m = new TouchModel(sink);
      m.setLayout(l);
      m.down(1, bottomLeft.x, bottomLeft.y);
      m.down(2, bottomRight.x, bottomRight.y);
      m.down(3, topLeftBtn.x, topLeftBtn.y);
      expect(sink.log, `swap=${swap}`).toEqual([`+${left}`, `+${right}`, `+${topLeftSide}`]);
    }
  });

  it('other modes ignore the swap', () => {
    for (const mode of ['csm', 'harpoon', 'harpoonThrust'] as const) expect(touchLayout(mode, 844, 390, { swapEngines: true })).toEqual(touchLayout(mode, 844, 390));
  });

  it('keyboard mapping is unaffected by the setting (it lives in the touch layout only)', async () => {
    const { DEFAULT_BINDINGS } = await import('../src/shell/input');
    expect(DEFAULT_BINDINGS.lander.KeyA).toEqual(['engineLeft']);
    expect(DEFAULT_BINDINGS.lander.KeyD).toEqual(['engineRight']);
    expect(DEFAULT_BINDINGS.lander.KeyQ).toEqual(['topLeft']);
    expect(DEFAULT_BINDINGS.lander.KeyE).toEqual(['topRight']);
  });
});

describe('touch model (multi-touch)', () => {
  const layout = touchLayout('lander', 844, 390);
  const L = centre(layout.buttons.find((b) => b.control === 'engineLeft')!.rect);
  const R = centre(layout.buttons.find((b) => b.control === 'engineRight')!.rect);

  it('two fingers hold both engines independently', () => {
    const sink = new Sink();
    const m = new TouchModel(sink);
    m.setLayout(layout);
    expect(m.down(1, L.x, L.y)).toBe(true);
    expect(m.down(2, R.x, R.y)).toBe(true);
    expect(sink.log).toEqual(['+engineLeft', '+engineRight']);
    expect(m.heldButtons()).toEqual(new Set(['engineLeft', 'engineRight']));
    m.up(1);
    expect(sink.log).toEqual(['+engineLeft', '+engineRight', '-engineLeft']);
    m.up(2);
    expect(sink.log.at(-1)).toBe('-engineRight');
  });

  it('sliding off releases; sliding onto another hold button presses it', () => {
    const sink = new Sink();
    const m = new TouchModel(sink);
    const csm = touchLayout('csm', 844, 390);
    m.setLayout(csm);
    const ccw = centre(csm.buttons.find((b) => b.control === 'rotateCCW')!.rect);
    const cw = centre(csm.buttons.find((b) => b.control === 'rotateCW')!.rect);
    m.down(5, ccw.x, ccw.y);
    m.move(5, ccw.x + 2, ccw.y); // still on it
    m.move(5, cw.x, cw.y); // rolled onto rotate CW
    m.move(5, 420, 100); // off everything
    m.move(5, cw.x, cw.y); // back on: a pointer that left does not re-press
    m.up(5);
    expect(sink.log).toEqual(['+rotateCCW', '-rotateCCW', '+rotateCW', '-rotateCW']);
  });

  it('tap buttons press on down, release on up, never by sliding onto them', () => {
    const sink = new Sink();
    const m = new TouchModel(sink);
    const h = touchLayout('harpoon', 844, 390);
    m.setLayout(h);
    const fire = centre(h.buttons.find((b) => b.control === 'fire')!.rect);
    const reelIn = centre(h.buttons.find((b) => b.control === 'reelIn')!.rect);
    m.down(1, reelIn.x, reelIn.y);
    m.move(1, fire.x, fire.y);
    m.up(1);
    expect(sink.log).toEqual(['+reelIn', '-reelIn']);
    m.down(2, fire.x, fire.y);
    m.up(2);
    expect(sink.log.slice(2)).toEqual(['+fire', '-fire']);
  });

  it('pointercancel releases everything that pointer held; clear releases all', () => {
    const sink = new Sink();
    const m = new TouchModel(sink);
    m.setLayout(layout);
    m.down(1, L.x, L.y);
    m.down(2, R.x, R.y);
    m.cancel(1);
    expect(sink.log).toEqual(['+engineLeft', '+engineRight', '-engineLeft']);
    m.clear();
    expect(sink.log.at(-1)).toBe('-engineRight');
    expect(m.heldButtons().size).toBe(0);
  });

  it('drag-to-aim in the aim zone (deadzone, sticky after lift, cleared by clear())', () => {
    const sink = new Sink();
    const m = new TouchModel(sink);
    const h = touchLayout('harpoon', 844, 390);
    m.setLayout(h);
    const z = centre(h.aimZone!);
    expect(m.down(3, z.x, z.y)).toBe(true);
    m.move(3, z.x + 3, z.y - 3);
    expect(sink.aim).toBeNull(); // inside deadzone
    m.move(3, z.x + 30, z.y - 40);
    expect(sink.aim).toEqual({ x: 30, y: -40 });
    expect(m.aimDrag()).toMatchObject({ sx: z.x, sy: z.y });
    m.up(3);
    expect(sink.aim).toEqual({ x: 30, y: -40 });
    expect(m.aimDrag()).toBeNull();
    m.clear();
    expect(sink.aim).toBeNull();
  });

  it('touches outside controls are ignored (fall through to the canvas)', () => {
    const sink = new Sink();
    const m = new TouchModel(sink);
    m.setLayout(layout);
    expect(m.down(1, 422, 200)).toBe(false);
    expect(sink.log).toEqual([]);
  });

  it('feeds App.virtual end to end: a short tap still yields a one-tick burn', () => {
    const virtual = new VirtualControlsSource('touch');
    const mapper = new InputMapper();
    mapper.add(virtual);
    const m = new TouchModel(virtual);
    m.setLayout(layout);
    const ctx: InputSampleContext = { mode: 'lander', vesselWorldPos: { x: 0, y: 0 }, clientToWorld: (x, y) => ({ x, y }) };
    m.down(1, L.x, L.y);
    m.up(1); // released before the tick
    expect(mapper.sample(ctx).engineLeft).toBe(true);
    expect(mapper.sample(ctx).engineLeft).toBe(false);
    m.down(1, L.x, L.y);
    m.down(2, R.x, R.y);
    const f = mapper.sample(ctx);
    expect(f.engineLeft && f.engineRight).toBe(true);
  });

  it('button hit test uses host-relative CSS px', () => {
    const b = layout.buttons[0]!;
    expect(contains(b.rect, b.rect.x, b.rect.y)).toBe(true);
    expect(contains(b.rect, b.rect.x + b.rect.w, b.rect.y)).toBe(false);
  });
});

describe('touch visibility / rotate hint / font', () => {
  it('auto shows on touch detection; on/off force', () => {
    expect(touchVisible('auto', false)).toBe(false);
    expect(touchVisible('auto', true)).toBe(true);
    expect(touchVisible('on', false)).toBe(true);
    expect(touchVisible('off', true)).toBe(false);
    expect(nextTouchPref('auto')).toBe('on');
    expect(nextTouchPref('on')).toBe('off');
    expect(nextTouchPref('off')).toBe('auto');
  });

  it('rotate hint only for portrait touch devices until dismissed', () => {
    expect(shouldShowRotateHint(390, 844, true, false)).toBe(true);
    expect(shouldShowRotateHint(844, 390, true, false)).toBe(false);
    expect(shouldShowRotateHint(390, 844, false, false)).toBe(false);
    expect(shouldShowRotateHint(390, 844, true, true)).toBe(false);
  });

  it('pixel font measures and covers the UI strings', () => {
    expect(measureText('AB')).toEqual({ width: 11, height: 7 });
    expect(measureText('A\nB', 2)).toEqual({ width: 10, height: 32 });
    for (const ch of 'THE LITTLE LANDER 0123456789 ←→↑↓▲▼◀▶★×…·%:/-') expect(hasGlyph(ch), ch).toBe(true);
    expect(glyphFor('a')).toBe(glyphFor('A'));
    expect(glyphFor('§')).toBe(glyphFor('?'));
  });
});
