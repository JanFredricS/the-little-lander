/**
 * Round 15 audit H1: no still pose may soft-lock the spring legs. A hull hooked over an islet
 * corner or planted tilted on a slope is never `landed`, but it must always be able to charge
 * and hop free (the launch aims against gravity, not along the body). Three probes: a 25°
 * slope rig, a grid of drops over the whole Spring Isles tower, and a sloppy (±0.15 rad aim
 * error) scripted jumper over several seeds.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT, PX_PER_M } from '../src/contracts';
import type { GameEvent, InputFrame } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { SPRING_ISLES_ROUTE, springIsles } from '../src/levels/springIsles';
import { PhysicsWorld } from '../src/physics/engine';
import { resolveTuning } from '../src/physics/tuning';
import { pxToM } from '../src/physics/units';
import { createVessel } from '../src/physics/vessel';
import { emptyFrame } from '../src/shell/input';
import { springJumper } from './support/springJumper';

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });
const speed = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
/** Ticks a still, unlanded hull may sit without being able to jump. */
const STUCK_TICKS = 5 * 60;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('spring legs never soft-lock (audit H1)', () => {
  it('planted tilted on a 25° slope (not `landed`), it still charges and jumps clear', async () => {
    const physics = await PhysicsWorld.create({ gravity: { x: 0, y: 12 }, hitSpeedThreshold: 0.5 });
    cleanup.push(() => physics.destroy());
    const terrain = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: 'terrain' });
    const k = Math.tan((25 * Math.PI) / 180);
    physics.addChain(terrain, [{ x: pxToM(-600), y: pxToM(600 - 600 * k) }, { x: pxToM(600), y: pxToM(600 + 600 * k) }], false);
    const events: GameEvent[] = [];
    const v = createVessel('spring', physics, { pos: { x: 0, y: 540 } }, (e) => events.push(e), { tuning: resolveTuning(), refGravity: 12, harpoonGuns: 1 });
    const tick = (f: InputFrame = emptyFrame()) => {
      v.applyInput(f, FIXED_DT);
      physics.step(FIXED_DT);
      return v.state();
    };
    let s = v.state();
    for (let i = 0; i < 240; i++) s = tick();
    expect(speed(s.vel)).toBeLessThan(1); // planted: the springs soak, friction holds
    expect(Math.abs(s.angle)).toBeGreaterThan(0.3); // tilted with the slope: never `landed`
    expect(s.landed).toBe(false);
    const y0 = s.pos.y;
    for (let i = 0; i < 40; i++) tick(input({ thrust: true }));
    tick();
    expect(events.some((e) => e.type === 'springJump')).toBe(true);
    let minY = y0;
    for (let i = 0; i < 30; i++) minY = Math.min(minY, tick().pos.y);
    expect(y0 - minY).toBeGreaterThan(60);
  });

  it('grid of drops over the whole tower: every still pose can jump again', async () => {
    const stuck: string[] = [];
    let tried = 0;
    for (let x = 60; x <= 1340; x += 80) {
      for (let y = 3200; y >= 500; y -= 300) {
        const s = await LevelSession.create({ ...springIsles, spawn: { x, y } });
        const events: GameEvent[] = [];
        s.on((e) => events.push(e));
        s.start();
        // settle: still for half a second (max 8 s)
        let still = 0;
        for (let i = 0; i < 8 * 60 && still < 30 && !s.outcome; i++) {
          s.step(emptyFrame());
          still = speed(s.state.vel) < 1 && s.vessel.springState!().phase !== 'air' ? still + 1 : 0;
        }
        if (!s.outcome && still >= 30) {
          tried++;
          for (let i = 0; i < 40 && !s.outcome; i++) s.step(input({ thrust: true }));
          s.step(emptyFrame());
          if (!s.outcome && !events.some((e) => e.type === 'springJump')) {
            stuck.push(`(${x},${y}) -> (${s.state.pos.x.toFixed(0)},${s.state.pos.y.toFixed(0)}) angle ${s.state.angle.toFixed(2)} landed ${s.state.landed}`);
          }
        }
        s.destroy();
      }
    }
    expect(tried).toBeGreaterThan(100);
    expect(stuck).toEqual([]);
  }, 120_000);

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])('a sloppy jumper (±0.15 rad aim error, seed %i) is never still on the ground for 5 s without hopping', async (seed) => {
    const rnd = mulberry32(seed);
    const pilot = springJumper(SPRING_ISLES_ROUTE, { hops: [], misses: 0 }, { aimNoise: () => (rnd() * 2 - 1) * 0.15 });
    const s = await LevelSession.create(springIsles);
    cleanup.push(() => s.destroy());
    let jumps = 0;
    s.on((e) => {
      if (e.type === 'springJump') jumps++;
    });
    s.start();
    let stillSince = -1;
    let lastJumps = 0;
    let worst = 0;
    let worstAt = '';
    for (let i = 0; i < 150 * 60 && !s.outcome; i++) {
      s.step(pilot(s, i));
      const st = s.state;
      const onSummit = Math.abs(st.pos.y + 17 - SPRING_ISLES_ROUTE[SPRING_ISLES_ROUTE.length - 1]!.top) < 8;
      if (jumps !== lastJumps || speed(st.vel) >= 1 || onSummit) {
        stillSince = -1;
        lastJumps = jumps;
      } else if (stillSince < 0) stillSince = i;
      else if (i - stillSince > worst) {
        worst = i - stillSince;
        worstAt = `(${st.pos.x.toFixed(0)},${st.pos.y.toFixed(0)}) angle ${st.angle.toFixed(2)} landed ${st.landed} phase ${s.vessel.springState!().phase}`;
      }
    }
    expect(worst, worstAt).toBeLessThan(STUCK_TICKS);
    void PX_PER_M;
  }, 60_000);
});
