/**
 * Round 15: the level systems the spring maps add, through the real LevelSession on Spring
 * Isles: one-way tiers (jump up through, stand on top), crumbling islets (telegraph events,
 * collapse, regrow, a checkpoint respawn rebuilds them), the validator rules for the new
 * flags, and the spring touch layout.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { BodyHandle, GameEvent, InputFrame, LevelSpec, PhysicsApi, TerrainPiece } from '../src/contracts';
import { OneWayGate, VesselCorners } from '../src/levels/systems/oneWay';
import { LevelSession } from '../src/game/session';
import { SPRING_ISLES_ROUTE, springIsles, STAND_DY } from '../src/levels/springIsles';
import { validateLevel } from '../src/levels/validate';
import { pxToM } from '../src/physics/units';
import { emptyFrame } from '../src/shell/input';
import { helpCard } from '../src/ui/controlsHelp';
import { contains, overlaps, touchLayout } from '../src/ui/touch/touchLayout';
import { runPilot } from './support/s7Harness';
import { springJumper } from './support/springJumper';

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });
const stop = (id: string) => SPRING_ISLES_ROUTE.find((s) => s.id === id)!;

async function standOn(id: string, spec: LevelSpec = springIsles) {
  const at = stop(id);
  const s = await LevelSession.create({ ...spec, spawn: { x: at.cx, y: at.top - STAND_DY - 2 } });
  cleanup.push(() => s.destroy());
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  const run = (n: number, f: InputFrame = emptyFrame()) => {
    for (let i = 0; i < n && !s.outcome; i++) s.step(f);
    return s.state;
  };
  return { s, events, run };
}

describe('one-way tiers', () => {
  it('a straight-up jump from a4 passes up through b1 (directly above) and lands on top of it', async () => {
    const a4 = stop('a4');
    const b1 = stop('b1');
    expect(Math.abs(b1.cx - a4.cx)).toBeLessThan(20);
    const { s, run } = await standOn('a4');
    run(30);
    expect(s.state.landed).toBe(true);
    run(70, input({ thrust: true })); // full charge, aim straight up
    run(1);
    expect(s.vessel.springState!().phase).toBe('air');
    let minY = Infinity;
    for (let i = 0; i < 240 && !(s.state.landed && s.vessel.springState!().phase === 'ground' && i > 20); i++) minY = Math.min(minY, run(1).pos.y);
    expect(minY + STAND_DY).toBeLessThan(b1.top - 20); // its feet went above the tier
    run(30);
    expect(s.state.landed).toBe(true);
    expect(Math.abs(s.state.pos.y + STAND_DY - b1.top)).toBeLessThan(4); // standing on it
    expect(s.state.hull).toBe(1);
  });

  it('standing on a one-way tier is stable (no flicker, no sink) for seconds', async () => {
    const { s, run } = await standOn('b2');
    run(30);
    const y = s.state.pos.y;
    run(300);
    expect(s.state.landed).toBe(true);
    expect(Math.abs(s.state.pos.y - y)).toBeLessThan(0.5);
  });
});

describe('one-way gate per corner (audit M2)', () => {
  // a flat box platform x 0..100, top 0, on a fake physics that only tracks the enabled flag
  const fake = () => {
    let on = true;
    return {
      api: { hasBody: () => true, isBodyEnabled: () => on, setBodyEnabled: (_h: unknown, e: boolean) => void (on = e) } as unknown as PhysicsApi,
      get on() {
        return on;
      },
    };
  };
  const box = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 }];
  const corners = (pts: [number, number][]) => {
    const v = new VesselCorners();
    v.count = pts.length;
    pts.forEach(([x, y], i) => {
      v.xy[2 * i] = x;
      v.xy[2 * i + 1] = y;
    });
    v.bottom = Math.max(...pts.map((p) => p[1]));
    v.top = Math.min(...pts.map((p) => p[1]));
    v.x0 = Math.min(...pts.map((p) => p[0]));
    v.x1 = Math.max(...pts.map((p) => p[0]));
    return v;
  };

  it('a hull tilted over the edge (its lowest corner out over the drop) stays supported', () => {
    const f = fake();
    const g = new OneWayGate(f.api, 1 as unknown as BodyHandle, box);
    g.update(corners([[96, -1], [104, 12], [86, -20], [94, -28]])); // the global bottom (12) is below the top, out past x 100
    expect(f.on).toBe(true);
  });

  it('a hull rising through (a corner over the span below the top) is let through; above it, solid again', () => {
    const f = fake();
    const g = new OneWayGate(f.api, 1 as unknown as BodyHandle, box);
    g.update(corners([[40, 10], [60, 10], [40, -8], [60, -8]]));
    expect(f.on).toBe(false);
    g.update(corners([[40, 0.2], [60, 0.2], [40, -18], [60, -18]]));
    expect(f.on).toBe(true);
  });

  it('beside the platform: solid only when the whole hull is above its peak (side entry lower down passes)', () => {
    const f = fake();
    const g = new OneWayGate(f.api, 1 as unknown as BodyHandle, box);
    g.update(corners([[110, 15], [130, 15], [110, -3], [130, -3]]));
    expect(f.on).toBe(false);
    g.update(corners([[110, -1], [130, -1], [110, -19], [130, -19]]));
    expect(f.on).toBe(true);
  });

  it('Spring Isles: a hull tumbling tilted onto f2 (near either edge) never drops through it to f1', async () => {
    const f2 = stop('f2');
    for (const dx of [-50, -30, 30, 50]) {
      for (const angle of [-0.6, 0.6]) {
        const s = await LevelSession.create({ ...springIsles, spawn: { x: f2.cx + dx, y: f2.top - 50 } });
        s.start();
        s.physics.setTransform(s.vessel.body, s.physics.getTransform(s.vessel.body), angle);
        let maxY = -Infinity;
        for (let i = 0; i < 90; i++) {
          s.step(emptyFrame());
          maxY = Math.max(maxY, s.state.pos.y);
        }
        expect(maxY, `dx ${dx} angle ${angle}`).toBeLessThan(f2.top);
        s.destroy();
      }
    }
  });
});

describe('crumbling islets', () => {
  it('telegraph (platformCrumbling) on the first touch, collapse after delaySec (platformCrumbled, regrow flagged), drop, then grow back', async () => {
    const e1 = stop('e1');
    const { s, events, run } = await standOn('e1');
    run(10);
    const warn = events.find((e) => e.type === 'platformCrumbling');
    expect(warn).toMatchObject({ entityId: 'e1', inSec: 1.4 });
    const c = s.systems.crumble!.platforms.find((p) => p.entity.id === 'e1')!;
    expect(c.gone).toBe(false);
    run(Math.round(1.4 * 60));
    expect(c.gone).toBe(true);
    expect(events.find((e) => e.type === 'platformCrumbled')).toMatchObject({ entityId: 'e1', regrow: true });
    run(120);
    expect(s.state.pos.y + STAND_DY).toBeGreaterThan(e1.top + 40); // fell
    run(Math.round(4 * 60));
    expect(c.gone).toBe(false); // the vessel is far below: it grew back
    expect(c.touchedAt).toBeNull();
  });

  it('a crumble does not regrow into the vessel (held while it is inside the box clearance)', async () => {
    const { s, run } = await standOn('e1');
    const c = s.systems.crumble!.platforms.find((p) => p.entity.id === 'e1')!;
    run(100);
    expect(c.gone).toBe(true);
    // pin the vessel where the platform was: the regrow waits
    for (let i = 0; i < 6 * 60; i++) {
      s.physics.setTransform(s.vessel.body, { x: s.physics.getTransform(s.vessel.body).x, y: pxToM(stop('e1').top - STAND_DY) }, 0);
      s.physics.setLinearVelocity(s.vessel.body, { x: 0, y: 0 });
      run(1);
    }
    expect(c.gone).toBe(true);
  });

  it('a checkpoint respawn rebuilds every crumbled islet', async () => {
    let respawn: ReturnType<LevelSession['respawnState']> = null;
    await runPilot(springIsles, () => springJumper(SPRING_ISLES_ROUTE), 400, (s) => {
      if (respawn === null && s.systems.crumble!.platforms.some((p) => p.gone)) respawn = s.respawnState();
    });
    expect(respawn).not.toBeNull();
    const s = await LevelSession.create(springIsles, respawn!);
    cleanup.push(() => s.destroy());
    expect(s.systems.crumble!.platforms.every((p) => !p.gone)).toBe(true);
  });
});

describe('validator: round-15 flags', () => {
  const base = springIsles;
  const withPiece = (p: TerrainPiece): LevelSpec => ({ ...base, terrain: { ...base.terrain, pieces: [...base.terrain.pieces, p] } });

  it('oneWay is only for polygon pieces and must be a boolean', () => {
    const groundOneWay = withPiece({ id: 'bad', kind: 'ground', points: [{ x: 0, y: 3400 }, { x: 100, y: 3400 }], style: { material: 'soil' }, oneWay: true });
    expect(validateLevel(groundOneWay).some((e) => e.includes('bad') && e.includes('oneWay'))).toBe(true);
    const notBool = withPiece({ id: 'bad2', kind: 'polygon', points: [{ x: 0, y: 3400 }, { x: 100, y: 3400 }, { x: 100, y: 3420 }], style: { material: 'soil' }, oneWay: 1 as unknown as boolean });
    expect(validateLevel(notBool).some((e) => e.includes('bad2') && e.includes('oneWay'))).toBe(true);
  });

  it('crumble platforms: oneWay must be a boolean, regrowSec >= 1', () => {
    const crumbles = base.entities.filter((e) => e.kind === 'crumblePlatform');
    expect(crumbles.length).toBeGreaterThan(0);
    const patch = (over: Record<string, unknown>): LevelSpec => ({ ...base, entities: base.entities.map((e) => (e.id === crumbles[0]!.id ? ({ ...e, ...over } as typeof e) : e)) });
    expect(validateLevel(patch({ regrowSec: 0.5 })).some((e) => e.includes(crumbles[0]!.id) && e.includes('regrowSec'))).toBe(true);
    expect(validateLevel(patch({ oneWay: 'yes' })).some((e) => e.includes(crumbles[0]!.id) && e.includes('oneWay'))).toBe(true);
    expect(validateLevel(patch({ regrowSec: 1 }))).toEqual([]);
  });
});

describe('spring help cards (audit L5)', () => {
  it('DIRECT keyboard: its own SPRING LEGS (DIRECT) card naming the mouse drag; ENGINES touch names the ✕ cancel; JOYSTICK keeps the keys', () => {
    const direct = helpCard('spring', false, true, false, true);
    expect(direct.title).toBe('SPRING LEGS (DIRECT)');
    expect(direct.lines.some((l) => l.includes('MOUSE'))).toBe(true);
    expect(helpCard('spring', true).lines.some((l) => l.includes('✕') && l.includes('CANCEL'))).toBe(true);
    const joy = helpCard('spring', false, true, false, false, true);
    expect(joy.lines.some((l) => l.includes('DRAG THE MOUSE AWAY'))).toBe(false); // under JOYSTICK the mouse drags the stick
    for (const c of [direct, joy, helpCard('spring', true), helpCard('spring', false)]) for (const l of c.lines) expect(l.length, l).toBeLessThanOrEqual(40);
  });
});

describe('spring touch layout', () => {
  it('ENGINES: ◀ ▶ aim, a big JUMP hold button (charge) and a ✕ cancel tap, none overlapping, on both stick sides', () => {
    for (const stickRight of [false, true]) {
      const l = touchLayout('spring', 844, 390, { stickRight });
      const by = (c: string) => l.buttons.find((b) => b.control === c)!;
      expect(by('rotateCCW')).toBeDefined();
      expect(by('rotateCW')).toBeDefined();
      expect(by('thrust')).toMatchObject({ label: 'JUMP', kind: 'hold' });
      expect(by('release')).toMatchObject({ kind: 'tap' });
      for (const a of l.buttons) for (const b of l.buttons) if (a !== b) expect(overlaps(a.rect, b.rect), `${a.id}/${b.id}`).toBe(false);
      for (const b of l.buttons) expect(b.rect.x >= 0 && b.rect.y >= 0 && b.rect.x + b.rect.w <= 844 && b.rect.y + b.rect.h <= 390).toBe(true);
    }
  });

  it('JOYSTICK: the virtual stick (direction = aim, deflection = charge) replaces the flight buttons', () => {
    const l = touchLayout('spring', 844, 390, { joystick: true });
    expect(l.stick).not.toBeNull();
    expect(l.buttons.filter((b) => !b.system)).toEqual([]);
    expect(contains(l.stick!.zone, l.stick!.cx, l.stick!.cy)).toBe(true);
  });
});
