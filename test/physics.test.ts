import { afterEach, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/contracts';
import { PhysicsWorld } from '../src/physics/engine';

const worlds: PhysicsWorld[] = [];
async function world(gravity = { x: 0, y: 10 }): Promise<PhysicsWorld> {
  const w = await PhysicsWorld.create({ gravity, hitSpeedThreshold: 0.5 });
  worlds.push(w);
  return w;
}
afterEach(() => {
  while (worlds.length) worlds.pop()!.destroy();
});

function run(w: PhysicsWorld, steps: number, each?: () => void): void {
  for (let i = 0; i < steps; i++) {
    each?.();
    w.step(FIXED_DT);
  }
}

function ball(w: PhysicsWorld, x = 0, y = 0) {
  const b = w.createBody({ type: 'dynamic', position: { x, y }, tag: 'ball', enableSleep: false });
  w.addCircle(b, { x: 0, y: 0 }, 0.25);
  return b;
}

describe('PhysicsWorld', () => {
  it('getGravity mirrors exactly what Box2D stores (float32), without the per-call wasm read', async () => {
    const w = await world({ x: 0.1, y: 9.81 });
    const native = () => {
      const b2 = (w as unknown as { b2: { b2World_GetGravity(id: unknown): { x: number; y: number; delete(): void } } }).b2;
      const g = b2.b2World_GetGravity((w as unknown as { worldId: unknown }).worldId);
      const out = { x: g.x, y: g.y };
      g.delete();
      return out;
    };
    expect(w.getGravity()).toEqual(native());
    w.setGravity({ x: -0.3, y: 1.7 });
    expect(w.getGravity()).toEqual(native());
    const g = w.getGravity();
    g.y = 99; // a copy: callers cannot mutate the world's gravity
    expect(w.getGravity()).toEqual(native());
  });

  it('falls under gravity (y-down) at the expected rate', async () => {
    const w = await world();
    const b = ball(w);
    run(w, 60);
    const v = w.getLinearVelocity(b);
    expect(v.y).toBeCloseTo(10, 1);
    expect(w.getTransform(b).y).toBeGreaterThan(4.5);
    expect(w.simTime).toBeCloseTo(1, 9);
  });

  it('rejects any dt other than FIXED_DT', async () => {
    const w = await world();
    expect(() => w.step(0.02)).toThrow(/FIXED_DT/);
  });

  it('gravity is mutable at runtime (and wakes sleeping bodies)', async () => {
    const w = await world({ x: 0, y: 10 });
    const b = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 } });
    w.addCircle(b, { x: 0, y: 0 }, 0.25);
    w.setGravity({ x: 0, y: -5 });
    expect(w.getGravity()).toEqual({ x: 0, y: -5 });
    run(w, 60);
    expect(w.getLinearVelocity(b).y).toBeCloseTo(-5, 1);
  });

  it('per-body gravity scale: 0 floats, -1 rises, set at creation or later', async () => {
    const w = await world();
    const floating = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 }, gravityScale: 0 });
    w.addCircle(floating, { x: 0, y: 0 }, 0.2);
    const inverted = ball(w, 5, 0);
    w.setGravityScale(inverted, -1);
    expect(w.getGravityScale(inverted)).toBe(-1);
    run(w, 30);
    expect(w.getTransform(floating).y).toBeCloseTo(0, 6);
    expect(w.getLinearVelocity(inverted).y).toBeLessThan(-4);
  });

  it('ground chains are solid below; hit events report approach speed', async () => {
    const w = await world();
    const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 }, tag: 'terrain' });
    w.addChain(ground, [{ x: -10, y: 5 }, { x: 10, y: 5 }], false);
    const b = ball(w);
    let best = 0;
    let began = false;
    run(w, 120, () => {
      const c = w.contacts();
      if (c.begin.some((p) => (p.a === b && p.b === ground) || (p.a === ground && p.b === b))) began = true;
      for (const h of c.hits) if (h.a === b || h.b === b) best = Math.max(best, h.approachSpeed);
    });
    w.step(FIXED_DT);
    expect(w.getTransform(b).y).toBeCloseTo(4.75, 1);
    expect(began).toBe(true);
    expect(best).toBeGreaterThan(8);
    expect(w.getTag(ground)).toBe('terrain');
  });

  it('loop chains are solid inside regardless of winding', async () => {
    for (const reverse of [false, true]) {
      const w = await world();
      const rock = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
      const pts = [
        { x: -2, y: 3 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: -2, y: 4 },
      ];
      w.addChain(rock, reverse ? pts.reverse() : pts, true);
      const b = ball(w);
      run(w, 120);
      expect(w.getTransform(b).y).toBeCloseTo(2.75, 1);
    }
  });

  it('forces act along the given vector; impulses change velocity instantly', async () => {
    const w = await world({ x: 0, y: 0 });
    const b = ball(w);
    const m = w.getMass(b);
    w.applyImpulse(b, { x: m * 2, y: 0 });
    expect(w.getLinearVelocity(b).x).toBeCloseTo(2, 5);
    run(w, 60, () => w.applyForce(b, { x: 0, y: -m * 3 }));
    expect(w.getLinearVelocity(b).y).toBeCloseTo(-3, 1);
  });

  it('rope joints are slack inside the max length and taut at it', async () => {
    const w = await world();
    const anchor = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
    const b = ball(w, 1, 0);
    const j = w.createDistanceJoint({ bodyA: anchor, bodyB: b, anchorA: { x: 0, y: 0 }, anchorB: { x: 1, y: 0 }, rope: true, maxLength: 3 });
    run(w, 240);
    expect(w.getJointCurrentLength(j)).toBeLessThanOrEqual(3.05);
    expect(w.getJointCurrentLength(j)).toBeGreaterThan(2.8);
    w.setJointLength(j, 1.5); // reel in
    run(w, 240);
    expect(w.getJointCurrentLength(j)).toBeLessThanOrEqual(1.55);
    const anchors = w.getJointAnchors(j);
    expect(Math.hypot(anchors.b.x - anchors.a.x, anchors.b.y - anchors.a.y)).toBeCloseTo(w.getJointCurrentLength(j), 3);
    w.destroyJoint(j);
    expect(w.hasJoint(j)).toBe(false);
  });

  it('weld joints glue bodies together (mass adds up)', async () => {
    const w = await world();
    const a = w.createBody({ type: 'dynamic', position: { x: 0, y: 0 }, gravityScale: 0 });
    w.addBox(a, 0.5, 0.5);
    const g = ball(w, 0.75, 0);
    w.setGravityScale(g, 0);
    w.createWeldJoint({ bodyA: a, bodyB: g, anchor: { x: 0.5, y: 0 } });
    w.applyImpulse(a, { x: 0, y: 1 });
    run(w, 60);
    const pa = w.getTransform(a);
    const pg = w.getTransform(g);
    expect(Math.hypot(pg.x - pa.x, pg.y - pa.y)).toBeCloseTo(0.75, 2);
  });

  it('ray casts hit the closest body and can ignore bodies', async () => {
    const w = await world();
    const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
    w.addChain(ground, [{ x: -10, y: 5 }, { x: 10, y: 5 }], false);
    const b = w.createBody({ type: 'static', position: { x: 0, y: 2 } });
    w.addBox(b, 0.5, 0.5);
    const hit = w.rayCast({ x: 0, y: 0 }, { x: 0, y: 10 });
    expect(hit?.body).toBe(b);
    expect(hit?.point.y).toBeCloseTo(1.5, 3);
    const past = w.rayCast({ x: 0, y: 0 }, { x: 0, y: 10 }, [b]);
    expect(past?.body).toBe(ground);
    expect(past?.point.y).toBeCloseTo(5, 3);
    expect(past?.normal.y).toBeCloseTo(-1, 3);
    expect(w.rayCast({ x: 20, y: 0 }, { x: 20, y: 10 })).toBeNull();
  });

  it('sensors report dynamic visitors entering', async () => {
    const w = await world();
    const zone = w.createBody({ type: 'static', position: { x: 0, y: 3 } });
    w.addSensorBox(zone, 2, 0.5);
    const b = ball(w);
    let entered = false;
    run(w, 60, () => {
      if (w.sensorEvents().begin.some((e) => e.sensor === zone && e.visitor === b)) entered = true;
    });
    expect(entered).toBe(true);
  });

  it('interpolates poses between steps and does not interpolate across teleports', async () => {
    const w = await world();
    const b = ball(w);
    run(w, 10);
    const prev = w.getInterpolatedTransform(b, 0);
    const curr = w.getInterpolatedTransform(b, 1);
    const mid = w.getInterpolatedTransform(b, 0.5);
    expect(mid.y).toBeCloseTo((prev.y + curr.y) / 2, 9);
    w.setTransform(b, { x: 5, y: 5 }, 0);
    expect(w.getInterpolatedTransform(b, 0)).toEqual(w.getInterpolatedTransform(b, 1));
  });

  it('is deterministic across worlds', async () => {
    const sim = async () => {
      const w = await world();
      const ground = w.createBody({ type: 'static', position: { x: 0, y: 0 } });
      w.addChain(ground, [{ x: -10, y: 5 }, { x: 0, y: 4 }, { x: 10, y: 5 }], false);
      const bodies = [ball(w, -1, 0), ball(w, 0.2, -1), ball(w, 1, -2)];
      run(w, 300);
      return bodies.map((h) => w.getTransform(h));
    };
    expect(await sim()).toEqual(await sim());
  });

  it('destroying a body drops its joints and contacts', async () => {
    const w = await world();
    const a = ball(w);
    const b = ball(w, 1, 0);
    const j = w.createDistanceJoint({ bodyA: a, bodyB: b, anchorA: { x: 0, y: 0 }, anchorB: { x: 1, y: 0 } });
    w.destroyBody(b);
    expect(w.hasBody(b)).toBe(false);
    expect(w.hasJoint(j)).toBe(false);
    expect(() => w.getTransform(b)).toThrow(/unknown body/);
    run(w, 5);
  });
});
