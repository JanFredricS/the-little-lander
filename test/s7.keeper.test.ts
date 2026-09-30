/**
 * The Keeper (map 7 boss) AI: phase transitions, damage accounting,
 * grab / burn / crush / release, rock-drop hits, attack gating, defeat.
 * Pure logic (src/levels/boss/keeperBrain.ts) — no physics needed.
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent, Vec2 } from '../src/contracts';
import { KeeperBrain, type KeeperInput, type KeeperRockSample } from '../src/levels/boss/keeperBrain';
import { KEEPER_TUNING } from '../src/levels/boss/keeperTuning';
import type { Cone } from '../src/physics/geom';

const DT = 1 / 60;
const ARENA = { x: 0, y: 100, w: 3000, h: 1100 };
const T = KEEPER_TUNING;

function make() {
  const events: GameEvent[] = [];
  const brain = new KeeperBrain(ARENA, { x: 1500, y: 500 }, (e) => events.push(e));
  return { brain, events };
}

function inp(vessel: Vec2, over: Partial<KeeperInput> = {}): KeeperInput {
  return { dt: DT, vessel: { pos: vessel, vel: { x: 0, y: 0 }, crashed: false }, exhaust: [], rocks: [], ...over };
}

const of = <K extends GameEvent['type']>(ev: GameEvent[], t: K) => ev.filter((e): e is Extract<GameEvent, { type: K }> => e.type === t);

/** A falling rock right on the boss. */
function rockOn(b: KeeperBrain, id = 1, radius = T.refRockRadius, vy = 300): KeeperRockSample {
  return { id, pos: { ...b.pos }, vel: { x: 0, y: vy }, radius };
}

/** Run until `pred` (max `sec`), feeding `input(i)`. */
function runUntil(b: KeeperBrain, input: () => KeeperInput, pred: () => boolean, sec = 20) {
  for (let i = 0; i < sec * 60 && !pred(); i++) b.update(input());
}

describe('Keeper brain — phases and damage accounting', () => {
  it('announces phase 1 on the first update, then idles after the intro', () => {
    const { brain, events } = make();
    brain.update(inp({ x: 1500, y: 900 }));
    expect(of(events, 'bossPhase')).toEqual([{ type: 'bossPhase', phase: 1, hp: 1 }]);
    expect(brain.mode).toBe('intro');
    runUntil(brain, () => inp({ x: 1500, y: 900 }), () => brain.mode !== 'intro');
    expect(brain.mode).toBe('idle');
    expect(of(events, 'bossPhase')).toHaveLength(1);
  });

  it('phase thresholds: 2/3 and 1/3 of hp', () => {
    const { brain } = make();
    expect(brain.phaseFor(1)).toBe(1);
    expect(brain.phaseFor(0.67)).toBe(1);
    expect(brain.phaseFor(0.66)).toBe(2);
    expect(brain.phaseFor(0.34)).toBe(2);
    expect(brain.phaseFor(0.33)).toBe(3);
  });

  it('hits reduce hp by exactly the applied damage; phases change once each; defeat once', () => {
    const { brain, events } = make();
    brain.update(inp({ x: 1500, y: 900 }));
    brain.hit(0.3, 'rock');
    expect(brain.hp).toBeCloseTo(0.7);
    expect(brain.phase).toBe(1);
    brain.hit(0.1, 'exhaust');
    expect(brain.phase).toBe(2);
    expect(brain.mode).toBe('transition');
    brain.hit(0.3, 'rock');
    expect(brain.phase).toBe(3);
    brain.hit(0.5, 'rock'); // overkill: only the remaining 0.3 is applied
    brain.hit(0.2, 'rock'); // ignored after defeat
    expect(brain.hp).toBe(0);
    const hits = of(events, 'bossHit');
    expect(hits).toHaveLength(4);
    expect(hits.reduce((s, h) => s + h.damage, 0)).toBeCloseTo(1, 9);
    expect(hits[3]!.damage).toBeCloseTo(0.3);
    expect(hits.map((h) => h.source)).toEqual(['rock', 'exhaust', 'rock', 'rock']);
    expect(brain.damageBy.rock + brain.damageBy.exhaust).toBeCloseTo(1, 9);
    expect(brain.damageBy.exhaust).toBeCloseTo(0.1);
    expect(of(events, 'bossPhase').map((e) => e.phase)).toEqual([1, 2, 3]);
    expect(of(events, 'bossDefeated')).toHaveLength(1);
    // hp in each bossHit is the hp after the hit
    expect(hits.map((h) => +h.hp.toFixed(6))).toEqual([0.7, 0.6, 0.3, 0]);
  });

  it('dies, then finishes after the death animation (surviveBoss)', () => {
    const { brain } = make();
    brain.update(inp({ x: 1500, y: 900 }));
    brain.hit(1, 'rock');
    expect(brain.defeated).toBe(true);
    expect(brain.mode).toBe('dying');
    expect(brain.finished).toBe(false);
    runUntil(brain, () => inp({ x: 1500, y: 900 }), () => brain.finished, T.deathSec + 1);
    expect(brain.finished).toBe(true);
    const out = brain.update(inp({ x: brain.pos.x, y: brain.pos.y }));
    expect(out.vesselDamage).toBe(0); // a dead boss does nothing
  });
});

describe('Keeper brain — rock drops', () => {
  it('a rock falling onto the body hits (scaled by size), shatters and staggers', () => {
    const { brain, events } = make();
    brain.update(inp({ x: 1500, y: 900 }));
    const out = brain.update(inp({ x: 1500, y: 900 }, { rocks: [rockOn(brain, 7)] }));
    expect(out.rockHits).toEqual([7]);
    expect(brain.hp).toBeCloseTo(1 - T.rockDamage);
    expect(brain.mode).toBe('stagger');
    expect(of(events, 'bossHit')[0]!.source).toBe('rock');
    // a big rock does more (clamped at 1.4×)
    const b2 = make().brain;
    b2.update(inp({ x: 1500, y: 900 }, { rocks: [rockOn(b2, 1, T.refRockRadius * 3)] }));
    expect(1 - b2.hp).toBeCloseTo(T.rockDamage * 1.4);
  });

  it('slow, rising or missing rocks do nothing', () => {
    const { brain } = make();
    brain.update(inp({ x: 1500, y: 900 }));
    const slow = rockOn(brain, 1, 16, T.rockMinSpeed - 1);
    const rising = rockOn(brain, 2, 16, -300);
    const miss = { ...rockOn(brain, 3), pos: { x: brain.pos.x + T.bodyRadius + 40, y: brain.pos.y } };
    const out = brain.update(inp({ x: 1500, y: 900 }, { rocks: [slow, rising, miss] }));
    expect(out.rockHits).toEqual([]);
    expect(brain.hp).toBe(1);
  });

  it('three well-aimed rocks reach phase 2, five reach phase 3, seven defeat it', () => {
    const { brain, events } = make();
    brain.update(inp({ x: 1500, y: 900 }));
    let n = 0;
    while (!brain.defeated && n < 20) {
      brain.update(inp({ x: 1500, y: 900 }, { rocks: [rockOn(brain, n)] }));
      n++;
      if (n === 2) expect(brain.phase).toBe(1);
      if (n === 3) expect(brain.phase).toBe(2);
      if (n === 4) expect(brain.phase).toBe(2);
      if (n === 5) expect(brain.phase).toBe(3);
    }
    expect(n).toBe(7);
    expect(of(events, 'bossDefeated')).toHaveLength(1);
  });
});

describe('Keeper brain — grab, burn, crush, release', () => {
  /** A brain that has just started a grab at a vessel sitting still at `v`. */
  function grabbing(v: Vec2) {
    const m = make();
    m.brain.update(inp(v));
    runUntil(m.brain, () => inp(v), () => m.brain.mode !== 'intro');
    m.brain.beginAttack('grab', v);
    expect(m.brain.tendrils).toHaveLength(T.grabTendrils[0]!);
    return m;
  }
  const V = { x: 1500, y: 700 }; // ~350 px below the boss (arena.y 100 + hoverY 250)

  it('the tendril reaches the vessel and holds it: pull towards the boss + hull damage', () => {
    const { brain } = grabbing(V);
    runUntil(brain, () => inp(V), () => brain.grabbing, 3);
    expect(brain.grabbing).toBe(true);
    const out = brain.update(inp(V));
    expect(out.pull).not.toBeNull();
    expect(Math.hypot(out.pull!.x, out.pull!.y)).toBeCloseTo(T.grabPull);
    expect(out.pull!.y).toBeLessThan(0); // up, towards the boss
    expect(out.vesselDamage).toBeCloseTo(T.grabDamagePerSec * DT);
  });

  it('a held vessel is reeled in only to the hold distance, and its motion is damped (no orbiting)', () => {
    const { brain } = grabbing(V);
    runUntil(brain, () => inp(V), () => brain.grabbing, 3);
    // at the hold distance, still: no pull
    const hold = { x: brain.pos.x, y: brain.pos.y + T.grabHoldDistance };
    let out = brain.update(inp(hold));
    expect(Math.hypot(out.pull!.x, out.pull!.y)).toBeLessThan(0.05);
    // closer than that: pushed back out (away from the body)
    out = brain.update(inp({ x: brain.pos.x, y: brain.pos.y + T.grabHoldDistance - 30 }));
    expect(out.pull!.y).toBeGreaterThan(0);
    // swinging sideways at the hold distance: the pull opposes the motion
    out = brain.update({ ...inp(hold), vessel: { pos: hold, vel: { x: 200, y: 0 }, crashed: false } });
    expect(out.pull!.x).toBeLessThan(0);
  });

  it('burning the tendril with exhaust releases it and damages the boss', () => {
    const { brain, events } = grabbing(V);
    runUntil(brain, () => inp(V), () => brain.grabbing, 3);
    // exhaust pointing from the vessel up along the tendril (thruster burn)
    const cone = (): Cone => {
      const dx = brain.pos.x - V.x;
      const dy = brain.pos.y - V.y;
      const l = Math.hypot(dx, dy);
      return { apex: V, dir: { x: dx / l, y: dy / l }, length: 90, halfAngle: 0.35 };
    };
    let t = 0;
    runUntil(brain, () => ((t += DT), inp(V, { exhaust: [cone()] })), () => !brain.grabbing, 2);
    expect(brain.grabbing).toBe(false);
    expect(t).toBeGreaterThanOrEqual(T.burnToBreak - DT);
    expect(t).toBeLessThan(T.burnToBreak + 0.1);
    const hit = of(events, 'bossHit');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.source).toBe('exhaust');
    expect(hit[0]!.damage).toBeCloseTo(T.tendrilBurnDamage);
    // the tendril retracts, then the attack ends
    runUntil(brain, () => inp(V), () => brain.mode !== 'grab', T.retractSec + 0.2);
    expect(brain.tendrils).toHaveLength(0);
    expect(brain.mode).toBe('idle');
  });

  it('burn decays when the exhaust wanders off (short blips do not add up forever)', () => {
    const { brain } = grabbing(V);
    runUntil(brain, () => inp(V), () => brain.grabbing, 3);
    const up: Cone = { apex: V, dir: { x: 0, y: -1 }, length: 120, halfAngle: 0.6 };
    for (let i = 0; i < 12; i++) brain.update(inp(V, { exhaust: [up] }));
    const b0 = brain.tendrils[0]!.burn;
    expect(b0).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) brain.update(inp(V));
    expect(brain.tendrils[0]!.burn).toBeLessThan(b0);
  });

  it('holding too long crushes: big hull damage + knockback, then release', () => {
    const { brain } = grabbing(V);
    runUntil(brain, () => inp(V), () => brain.grabbing, 3);
    let crush = 0;
    let knock = false;
    for (let i = 0; i < (T.crushAfterSec + 0.5) * 60 && brain.grabbing; i++) {
      const out = brain.update(inp(V));
      if (out.vesselDamage > T.crushDamage * 0.9) crush++;
      if (out.knockback) knock = true;
    }
    expect(crush).toBe(1);
    expect(knock).toBe(true);
    expect(brain.grabbing).toBe(false);
  });

  it('a tendril that cannot reach retracts; a crashed vessel is released', () => {
    const far = { x: 1500, y: 1180 };
    const { brain } = grabbing(far);
    runUntil(brain, () => inp(far), () => brain.tendrils[0]?.state !== 'reaching', 3);
    expect(brain.tendrils[0]?.state ?? 'retracting').toBe('retracting');

    const m = grabbing(V);
    runUntil(m.brain, () => inp(V), () => m.brain.grabbing, 3);
    m.brain.update({ ...inp(V), vessel: { pos: V, vel: { x: 0, y: 0 }, crashed: true } });
    expect(m.brain.grabbing).toBe(false);
  });

  it('a rock hit or phase change releases a held vessel', () => {
    const { brain } = grabbing(V);
    runUntil(brain, () => inp(V), () => brain.grabbing, 3);
    brain.update(inp(V, { rocks: [rockOn(brain)] }));
    expect(brain.grabbing).toBe(false);
    expect(brain.mode).toBe('stagger');

    const m = grabbing(V);
    runUntil(m.brain, () => inp(V), () => m.brain.grabbing, 3);
    m.brain.hit(0.4, 'rock');
    expect(m.brain.phase).toBe(2);
    expect(m.brain.grabbing).toBe(false);
  });

  it('phase 3 grabs with two tendrils', () => {
    const { brain } = make();
    brain.update(inp(V));
    brain.hit(0.7, 'rock');
    expect(brain.phase).toBe(3);
    brain.beginAttack('grab', V);
    expect(brain.tendrils).toHaveLength(2);
  });
});

describe('Keeper brain — attacks', () => {
  it('only attacks while the vessel is inside the arena', () => {
    const { brain } = make();
    const outside = { x: 3500, y: 900 };
    runUntil(brain, () => inp(outside), () => false, 12);
    expect(['intro', 'idle']).toContain(brain.mode);
    const inside = { x: 1500, y: 900 };
    runUntil(brain, () => inp(inside), () => brain.mode !== 'idle' && brain.mode !== 'intro', 12);
    expect(brain.mode).toBe('sweepWindup'); // pattern[0][0]
  });

  it('a sweep is telegraphed, then lunges; hitting the vessel damages + knocks it back', () => {
    const { brain } = make();
    const v = { x: 1500, y: 800 };
    brain.update(inp(v));
    runUntil(brain, () => inp(v), () => brain.mode !== 'intro');
    brain.beginAttack('sweep', v);
    let windup = 0;
    runUntil(brain, () => ((windup += DT), inp(v)), () => brain.mode === 'sweep', 3);
    expect(windup).toBeGreaterThanOrEqual(T.sweepWindup[0]! - 0.02);
    let dmg = 0;
    let kb: Vec2 | null = null;
    for (let i = 0; i < 180 && brain.mode === 'sweep'; i++) {
      const out = brain.update(inp(v));
      dmg += out.vesselDamage;
      kb = out.knockback ?? kb;
    }
    expect(dmg).toBeCloseTo(T.sweepDamage);
    expect(kb).not.toBeNull();
    expect(kb!.y).toBeGreaterThan(0); // pushed away (down)
  });

  it('the sweep aim tracks the vessel, then locks sweepLock s before the lunge (the dodge window)', () => {
    const { brain } = make();
    const v0 = { x: 1500, y: 800 };
    brain.update(inp(v0));
    runUntil(brain, () => inp(v0), () => brain.mode !== 'intro');
    brain.beginAttack('sweep', v0);
    brain.update(inp(v0));
    expect(brain.sweepLocked).toBe(false);
    expect(brain.sweepDir.y).toBeCloseTo(1); // straight down at the vessel
    // wait for the lock, then move away sideways: the lunge keeps the locked line
    runUntil(brain, () => inp(v0), () => brain.sweepLocked, 3);
    const lockedAt = brain.modeTime;
    expect(lockedAt).toBeCloseTo(T.sweepWindup[0]! - T.sweepLock[0]!, 1);
    const moved = { x: 1500 + 120, y: 800 };
    let dmg = 0;
    runUntil(brain, () => inp(moved), () => brain.mode === 'sweep', 3);
    expect(brain.sweepDir.y).toBeCloseTo(1);
    for (let i = 0; i < 180 && brain.mode === 'sweep'; i++) dmg += brain.update(inp(moved)).vesselDamage;
    expect(dmg).toBe(0); // dodged
  });

  it('bumping it while it is stunned or changing phase only shoves; an idle bump chips', () => {
    const { brain } = make();
    const v = { x: 1500, y: 2000 };
    brain.update(inp(v));
    runUntil(brain, () => inp(v), () => brain.mode !== 'intro');
    brain.update(inp(v, { rocks: [rockOn(brain)] }));
    expect(brain.mode).toBe('stagger');
    const out = brain.update(inp({ ...brain.pos }));
    expect(out.vesselDamage).toBe(0);
    expect(out.knockback).not.toBeNull();
    runUntil(brain, () => inp(v), () => brain.mode === 'idle', 3);
    const out2 = brain.update(inp({ x: brain.pos.x, y: brain.pos.y + 20 }));
    expect(out2.vesselDamage).toBeCloseTo(T.contactDamage);
  });

  it('after a low sweep it climbs back to its hover band briskly', () => {
    const { brain } = make();
    const v = { x: 1500, y: 2000 }; // outside the arena: no attacks
    brain.update(inp(v));
    runUntil(brain, () => inp(v), () => brain.mode !== 'intro');
    (brain as unknown as { pos: Vec2 }).pos = { x: 1500, y: 1000 };
    runUntil(brain, () => inp(v), () => false, 1);
    expect(1000 - brain.pos.y).toBeGreaterThan(T.returnSpeed * 0.9);
  });

  it('phase 2 slams: debris + rock regrowth signal after the windup', () => {
    const { brain } = make();
    const v = { x: 1500, y: 900 };
    brain.update(inp(v));
    brain.hit(0.4, 'rock');
    runUntil(brain, () => inp(v), () => brain.mode !== 'transition');
    brain.beginAttack('slam', v);
    let slam: { debris: number } | null = null;
    for (let i = 0; i < 180 && !slam; i++) slam = brain.update(inp(v)).slam;
    expect(slam).toEqual({ debris: T.slamDebris[1] });
    expect(brain.mode).toBe('slamRecover');
    expect(brain.pos.y).toBeLessThan(ARENA.y + T.bodyRadius + 40); // rose to the roof
  });

  it('idles in place while the vessel stays within the follow dead zone, then drifts after it', () => {
    const { brain } = make();
    const near = { x: 1500 + T.followDeadzone - 20, y: 2000 }; // below the arena: no attacks
    runUntil(brain, () => inp(near), () => false, 6);
    expect(brain.pos.x).toBeCloseTo(1500, 0);
    const far = { x: 2400, y: 2000 };
    runUntil(brain, () => inp(far), () => false, 20);
    expect(brain.pos.x).toBeCloseTo(2400 - T.followDeadzone, 0);
  });

  it('stays inside its arena', () => {
    const { brain } = make();
    const v = { x: 50, y: 1190 };
    for (let i = 0; i < 60 * 30; i++) {
      brain.update(inp(v));
      expect(brain.pos.x).toBeGreaterThanOrEqual(ARENA.x + T.bodyRadius - 1e-6);
      expect(brain.pos.x).toBeLessThanOrEqual(ARENA.x + ARENA.w - T.bodyRadius + 1e-6);
      expect(brain.pos.y).toBeGreaterThanOrEqual(ARENA.y + T.bodyRadius - 1e-6);
      expect(brain.pos.y).toBeLessThanOrEqual(ARENA.y + ARENA.h - T.bodyRadius + 1e-6);
    }
  });
});
