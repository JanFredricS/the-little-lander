/**
 * S7 regression tests for the harpoon-rig fixes found while building
 * map 5 (see src/physics/vessel/harpoonRig.ts):
 *  - the rope joint keeps collideConnected, so a roped pod still collides
 *    with the terrain body its anchor lives on;
 *  - the winch stalls instead of crushing the pod into rock (a rigid rope
 *    limit fighting a contact reads as a fatal impact).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import type { GameEvent, InputFrame } from '../src/contracts';
import { PhysicsWorld } from '../src/physics/engine';
import { resolveTuning } from '../src/physics/tuning';
import { pxToM } from '../src/physics/units';
import { createVessel } from '../src/physics/vessel';
import { emptyFrame } from '../src/shell/input';

const input = (f: Partial<InputFrame>): InputFrame => ({ ...emptyFrame(), ...f });
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function rig(ceiling: number, ground: number) {
  const physics = await PhysicsWorld.create({ gravity: { x: 0, y: 5 }, hitSpeedThreshold: 0.5 });
  cleanup.push(() => physics.destroy());
  // one terrain body carries both roof and floor (like a built level)
  const terrain = physics.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: 'terrain' });
  physics.addChain(terrain, [{ x: -100, y: pxToM(ground) }, { x: 200, y: pxToM(ground) }], false);
  physics.addChain(terrain, [{ x: 200, y: pxToM(ceiling) }, { x: -100, y: pxToM(ceiling) }], false);
  const events: GameEvent[] = [];
  const vessel = createVessel('harpoon', physics, { pos: { x: 0, y: 0 } }, (e) => events.push(e), { tuning: resolveTuning(), refGravity: 5, harpoonGuns: 1 });
  const run = (n: number, f: InputFrame = emptyFrame()) => {
    let s = vessel.state();
    for (let i = 0; i < n; i++) {
      vessel.applyInput(f, FIXED_DT);
      physics.step(FIXED_DT);
      s = vessel.state();
    }
    return s;
  };
  return { physics, vessel, events, run, terrain };
}

describe('S7 harpoon rig fixes', () => {
  it('a roped pod still collides with the terrain body it is anchored to', async () => {
    const { run, events } = await rig(-200, 40);
    run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
    run(30);
    expect(events.some((e) => e.type === 'ropeAttached')).toBe(true);
    // pay out the whole rope: the floor (same body as the anchor) must stop the pod
    const s = run(240, input({ reelOut: true }));
    expect(s.ropeState!.guns[0]!.length!).toBeGreaterThan(245);
    expect(s.pos.y).toBeLessThan(40);
    expect(s.pos.y).toBeGreaterThan(20);
  });

  for (const lidY of [-16.5, -60]) {
    it(`the winch stalls against rock instead of crushing the pod (lid at ${lidY})`, async () => {
      const { run, physics } = await rig(-200, 40);
      run(1, input({ fire: true, aim: { x: 0, y: -1 } }));
      run(60);
      // a lid between the hanging pod and its anchor
      const lid = physics.createBody({ type: 'static', position: { x: 0, y: pxToM(lidY) }, tag: 'terrain' });
      physics.addBox(lid, pxToM(60), pxToM(8));
      let s = run(1);
      for (let i = 0; i < 240; i++) s = run(1, input({ reelIn: true }));
      const g = s.ropeState!.guns[0]!;
      expect(s.crashed).toBe(false);
      expect(g.phase).toBe('anchored');
      expect(s.pos.y).toBeGreaterThan(lidY); // held below the lid
      expect(g.length!).toBeGreaterThan(100); // the winch stopped (ropeMin is 24)
    });
  }
});
