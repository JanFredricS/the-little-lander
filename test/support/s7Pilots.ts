/**
 * Reference autopilots for the S7 playtest pass. They only produce
 * InputFrames (aim / fire / reel / thrust / rotate / engines) — exactly what
 * a player's devices produce — and "look" at the level the way a player
 * does: by casting rays at what is on screen. No state is poked.
 */

import type { InputFrame, Vec2 } from '../../src/contracts';
import type { LevelSession } from '../../src/game/session';
import { castSolid } from '../../src/physics/tags';
import { levelReferenceGravity } from '../../src/physics/tuning';
import { mToPx, vMToPx, vPxToM } from '../../src/physics/units';
import { HOLLOW_ORBS, HOLLOW_ROUTE, HOLLOW_SHELTERS } from '../../src/levels/hollow';
import { frame, type Pilot } from './s7Harness';

export interface AnchorPick {
  point: Vec2;
  dir: Vec2;
  brittle: boolean;
  dist: number;
}

function mountOf(s: LevelSession): Vec2 {
  const st = s.state;
  const h = s.vessel.mode === 'harpoonThrust' ? s.tuning.harpoonThrust.mountHeight : s.tuning.harpoon.mountHeight;
  return { x: st.pos.x + Math.sin(st.angle) * h, y: st.pos.y - Math.cos(st.angle) * h };
}

/**
 * Anchor candidates by ray casting from the rope mount: directions `fwd`
 * side, `minDeg`..`maxDeg` above the horizontal (in the frame where "up" is
 * against `up`). Returns hits the harpoon would accept.
 */
export function anchorCandidates(s: LevelSession, fwd: 1 | -1, opts: { minDeg?: number; maxDeg?: number; up?: Vec2; rangeMargin?: number } = {}): AnchorPick[] {
  const range = (s.vessel.mode === 'harpoonThrust' ? s.tuning.harpoonThrust.ropeRange : s.tuning.harpoon.ropeRange) - (opts.rangeMargin ?? 10);
  const m = mountOf(s);
  const up = opts.up ?? { x: 0, y: -1 };
  const side = { x: -up.y * fwd, y: up.x * fwd }; // perpendicular, pointing "forward"
  // normalise: for up=(0,-1), fwd=1 -> side=(1,0)
  const out: AnchorPick[] = [];
  const ignore = [...s.vessel.parts];
  for (let deg = opts.minDeg ?? 12; deg <= (opts.maxDeg ?? 89); deg += 3) {
    const a = (deg * Math.PI) / 180;
    const dir = { x: side.x * Math.cos(a) + up.x * Math.sin(a), y: side.y * Math.cos(a) + up.y * Math.sin(a) };
    const to = { x: m.x + dir.x * range, y: m.y + dir.y * range };
    const hit = castSolid(s.physics, vPxToM(m), vPxToM(to), ignore);
    if (!hit) continue;
    const p = vMToPx(hit.point);
    const info = s.vessel.hooks.anchorAt(hit.body, p);
    if (!info.ok) continue;
    out.push({ point: p, dir, brittle: info.brittleSec !== undefined, dist: Math.hypot(p.x - m.x, p.y - m.y) });
  }
  return out;
}

export interface HarpoonPilotOptions {
  /** Reel in until the rope is this short (px) before moving on. */
  minLen?: number;
  /** Re-fire once the rope is this short. */
  switchLen?: number;
  /** A new anchor must be at least this far ahead of the current one (px). */
  minAdvance?: number;
  /** Stop advancing (lower yourself instead) once past this x. */
  landX?: number;
  /** Direction of travel. */
  fwd?: 1 | -1;
  /** Brittle anchors are worth this many px less. */
  brittlePenalty?: number;
  /** Max |dx| of a pick ahead (px): don't pick anchors too far ahead (long drops). */
  maxAhead?: number;
  /** Reel in only below this speed (px/s); pay out above wildSpeed. */
  calmSpeed?: number;
  wildSpeed?: number;
  /** Anchors must be at least this far above the pod (px). */
  minRise?: number;
}

/**
 * Hand-over-hand harpoon pilot: rope the farthest good roof point ahead,
 * reel in, re-fire ahead when the rope is short / the pod has swung past /
 * a brittle anchor is about to crack. Past landX: reel out to the floor.
 */
export function harpoonPilot(o: HarpoonPilotOptions = {}): Pilot {
  const minLen = o.minLen ?? 60;
  const switchLen = o.switchLen ?? 90;
  const minAdvance = o.minAdvance ?? 70;
  const fwd = o.fwd ?? 1;
  const brittlePenalty = o.brittlePenalty ?? 120;
  const maxAhead = o.maxAhead ?? 230;
  const calmSpeed = o.calmSpeed ?? 130;
  const minRise = o.minRise ?? 60;
  const wildSpeed = o.wildSpeed ?? 210;
  let cooldown = 0;
  let descending = false;
  let settled = false;
  return (s) => {
    const st = s.state;
    const gun = st.ropeState?.guns[0];
    const f = frame();
    cooldown--;
    const landing = o.landX !== undefined && st.pos.x * fwd >= o.landX * fwd;
    const pick = (fromX: number): AnchorPick | null => {
      let best: AnchorPick | null = null;
      let bestScore = -Infinity;
      for (const c of anchorCandidates(s, fwd, { minDeg: -30 })) {
        const ahead = (c.point.x - fromX) * fwd;
        if (ahead < minAdvance || ahead > maxAhead) continue;
        if (c.point.y > st.pos.y - minRise) continue; // roof only
        const score = ahead - (c.brittle ? brittlePenalty : 0);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    };
    const fire = (p: AnchorPick) => {
      f.aim = p.dir;
      f.fire = true;
      cooldown = 15;
    };
    if (!gun || gun.phase === 'idle') {
      if (cooldown <= 0) {
        const p = pick(st.pos.x) ?? (landing ? null : pickAny(s, fwd));
        if (p) fire(p);
      }
      return f;
    }
    if (gun.phase === 'flying') return f;
    const A = gun.head!;
    const len = gun.length ?? 0;
    if (landing) {
      // re-anchor almost straight above, then damp the swing (reel in while fast,
      // pay out while slow) so the pod settles upright onto the pad
      if (st.landed) return f;
      if (Math.abs(A.x - st.pos.x) > 45 && cooldown <= 0) {
        // slightly behind the pod: the rope brakes the drift
        const up = anchorCandidates(s, fwd, { minDeg: 84, maxDeg: 120 }).filter((c) => c.point.y < st.pos.y - minRise);
        const want = st.pos.x - fwd * 25;
        up.sort((a, b) => Math.abs(a.point.x - want) - Math.abs(b.point.x - want));
        if (up[0]) {
          fire(up[0]);
          cooldown = 40;
          return f;
        }
      }
      // wait for the swing to die down, then hold reel-out to the pad
      if (Math.abs(A.x - st.pos.x) < 45 && Math.abs(st.vel.x) < 30) settled = true;
      f.reelOut = settled;
      return f;
    }
    const brittleSoon = gun.brittleTimeLeft !== undefined && gun.brittleTimeLeft < 0.4;
    const speed = Math.hypot(st.vel.x, st.vel.y);
    const p = pick(Math.max(A.x * fwd, st.pos.x * fwd) * fwd);
    if (p) {
      descending = false;
      // pump-damping: take rope in when slow (swing extremes), pay out when fast (bottom)
      f.reelIn = len > minLen && speed < calmSpeed;
      f.reelOut = speed > wildSpeed && len < 260;
      const ahead = (st.pos.x - A.x) * fwd;
      const swingingOn = ahead > 10 && st.vel.x * fwd > 20 && (st.vel.y < 0 || speed < 70);
      if (cooldown <= 0 && (swingingOn || (len <= switchLen && speed < 140) || brittleSoon)) fire(p);
    } else if (brittleSoon) {
      const q = pickAny(s, fwd);
      if (q && cooldown <= 0) fire(q);
    } else {
      // nothing good in reach: climb towards the anchor (see further); if that
      // does not help, drop lower on the rope for a better angle
      if (len <= switchLen) descending = true;
      if (len >= 210) descending = false;
      if (descending) f.reelOut = speed < wildSpeed;
      else f.reelIn = speed < calmSpeed;
    }
    return f;
  };
}

export interface ThrustPilotOptions {
  /** Waypoints (px), in order. */
  path: Vec2[];
  /** Points that must be hit precisely (orbs): tolerance `tight`; others `loose`. */
  precise?: (p: Vec2) => boolean;
  tight?: number;
  loose?: number;
  /** Cruise speed (px/s). */
  vmax?: number;
  /** Radiation cover: shelters + sun; hide while the sun charges. */
  shelters?: Vec2[];
  /** Max distance (px) worth flying to a shelter. */
  shelterReach?: number;
  /** Max tilt (rad) away from "against gravity". */
  maxTilt?: number;
  /** Stop at the last waypoint (hover) instead of flying through. */
  hover?: boolean;
}

/**
 * Thruster steering (harpoonThrust / CSM controls): fly at velocity `vd`
 * (px/s). Desired acceleration = velocity error minus local gravity (as the
 * HUD shows it: vessel.hooks.gravityAt); rotate the nose to it (tilt capped
 * at maxTilt from "against gravity"), burn while aligned.
 */
export function steer(s: LevelSession, f: InputFrame, vd: Vec2, maxTilt = 0.8, gain = 1.6): void {
  const st = s.state;
  const g = s.vessel.hooks.gravityAt?.(st.pos) ?? s.spec.gravity; // m/s²
  const req = { x: ((vd.x - st.vel.x) * gain) / 30 - g.x, y: ((vd.y - st.vel.y) * gain) / 30 - g.y };
  const gUp = Math.atan2(-g.x, g.y);
  const raw = wrap(Math.atan2(req.x, -req.y) - gUp);
  const want = gUp + Math.max(-maxTilt, Math.min(maxTilt, raw));
  const err = wrap(want - st.angle);
  const u = err * 4 - st.angularVel * 1.2;
  f.rotateCW = u > 0.15;
  f.rotateCCW = u < -0.15;
  const thrustAcc = s.tuning.harpoonThrust.thrust * levelReferenceGravity(s.spec, s.tuning);
  const upNow = { x: Math.sin(st.angle), y: -Math.cos(st.angle) };
  const along = req.x * upNow.x + req.y * upNow.y;
  // on the ground a pod cannot pivot: lift off straight first
  f.thrust = (Math.abs(err) < 0.5 || st.landed) && along > thrustAcc * 0.45;
}

/** Velocity command towards `target`: cruise at vmax, slow down on arrival. */
export function approach(s: LevelSession, target: Vec2, vmax: number, brake = 1.5): Vec2 {
  const st = s.state;
  const d = { x: target.x - st.pos.x, y: target.y - st.pos.y };
  const dist = Math.hypot(d.x, d.y);
  if (dist < 1e-6) return { x: 0, y: 0 };
  const sp = Math.min(vmax, dist * brake);
  return { x: (d.x / dist) * sp, y: (d.y / dist) * sp };
}

/** Angle wrap to (-pi, pi]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Thruster autopilot (harpoonThrust / CSM-style controls: thrust + rotate):
 * velocity-command waypoint follower. Desired acceleration = velocity error
 * minus local gravity (read the way the HUD shows it: vessel.hooks.gravityAt);
 * rotate the nose to it, burn while aligned. Hides in the nearest shelter
 * while the sun is charging.
 */
export function thrustPilot(o: ThrustPilotOptions) {
  const tight = o.tight ?? 10;
  const loose = o.loose ?? 70;
  const vmax = o.vmax ?? 160;
  const maxTilt = o.maxTilt ?? 0.8;
  let i = 0;
  let shelter: Vec2 | null = null;
  const pilot: Pilot = (s) => {
    const st = s.state;
    const f = frame();
    // advance waypoints
    while (i < o.path.length - 1) {
      const w = o.path[i]!;
      const tol = o.precise?.(w) ? tight : loose;
      const d = Math.hypot(w.x - st.pos.x, w.y - st.pos.y);
      if (d < tol || st.pos.x > w.x + (o.precise?.(w) ? 220 : 20)) i++;
      else break;
    }
    // radiation: hide while charging
    let target = o.path[i]!;
    let speedCap = vmax;
    if (o.shelters && o.shelters.length) {
      const charging = s.env.radiation.emitters.some((e) => e.charging || s.env.radiation.charge(e, s.simTime) > 0);
      if (charging) {
        if (!shelter) {
          let best: Vec2 | null = null;
          let bd = o.shelterReach ?? 600;
          for (const q of o.shelters) {
            const d = Math.hypot(q.x - st.pos.x, q.y - st.pos.y);
            if (d < bd && !castSolid(s.physics, vPxToM(st.pos), vPxToM(q), [...s.vessel.parts])) {
              bd = d;
              best = q;
            }
          }
          shelter = best;
        }
        if (shelter) target = shelter;
      } else shelter = null;
    }
    const isLast = i === o.path.length - 1;
    // blocked (a rock in the way): detour via a side point that sees both
    const ignore = [...s.vessel.parts];
    const clear = (a: Vec2, b: Vec2) => !castSolid(s.physics, vPxToM(a), vPxToM(b), ignore);
    if (!clear(st.pos, target)) {
      const fwd = target.x >= st.pos.x ? 1 : -1;
      let best: Vec2 | null = null;
      outer: for (const k of [1, -1, 2, -2, 3, -3]) {
        for (const dy of [0, -150, 150, -300, 300]) {
          const c = { x: st.pos.x + fwd * k * 160, y: st.pos.y + dy };
          if (clear(st.pos, c) && clear(c, target)) {
            best = c;
            break outer;
          }
        }
      }
      if (best) target = best;
    }
    const d = { x: target.x - st.pos.x, y: target.y - st.pos.y };
    const dist = Math.hypot(d.x, d.y);
    const slow = shelter !== null || isLast || o.precise?.(target) ? 1.2 : 3;
    const sp = Math.min(speedCap, Math.max(40, dist * slow));
    const vd = dist > 1e-6 ? { x: (d.x / dist) * sp, y: (d.y / dist) * sp } : { x: 0, y: 0 };
    if ((shelter || (isLast && o.hover)) && dist < 12) {
      vd.x = 0;
      vd.y = 0;
    }
    steer(s, f, vd, maxTilt);
    return f;
  };
  return pilot;
}

/** Any anchor at all (straight-ish up first), for recovery. */
function pickAny(s: LevelSession, fwd: 1 | -1): AnchorPick | null {
  const c = anchorCandidates(s, fwd, { minDeg: 30, maxDeg: 150 });
  c.sort((a, b) => b.point.x * fwd - a.point.x * fwd);
  return c[0] ?? null;
}

export function describeFrame(f: InputFrame): string {
  return Object.entries(f)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(',');
}

export { mToPx };

export interface KeeperPilotLog {
  attempts: number;
  drops: number;
  why?: string[];
  branches?: Record<string, number>;
  last?: string;
}

/**
 * Boss pilot (map 7): lure the Keeper under a loose rock (it idles while you
 * stay within its follow dead zone), hover beside-and-below the rock, harpoon
 * it and winch it loose; burn free of tendril grabs (nose away from the
 * Keeper + thrust); refuel from canisters when low.
 */
export function keeperPilot(log: KeeperPilotLog = { attempts: 0, drops: 0 }, o: { offset?: number; below?: number } = {}): Pilot {
  const offset = o.offset ?? 140;
  const below = o.below ?? 200;
  let rockId: string | null = null;
  let side: 1 | -1 = 1;
  let fired = 0;
  let wasAnchored = false;
  let dodge = 0; // 0 = none, else chosen escape direction index + 1
  let stuck = 0;
  const mark = (b: string) => {
    if (log.branches) log.branches[b] = (log.branches[b] ?? 0) + 1 / 60;
    log.last = b;
  };
  return (s) => {
    const st = s.state;
    const f = frame();
    // 0. knocked over on the floor: roll back upright (the ground righting kick)
    const tilt = wrap(st.angle);
    stuck = Math.hypot(st.vel.x, st.vel.y) < 8 && Math.abs(tilt) > 0.85 ? stuck + 1 : 0;
    // resting tilted on rubble (too steep to count as landed): hop off it
    const resting = Math.hypot(st.vel.x, st.vel.y) < 10 && s.physics.bodyContacts(s.vessel.body).length > 0 && !st.landed;
    if (resting && Math.abs(tilt) > 0.3 && Math.abs(tilt) <= 0.85) {
      f.thrust = true;
      f.rotateCW = tilt < 0;
      f.rotateCCW = tilt > 0;
      mark('hop');
      return f;
    }
    if (stuck > 30) {
      f.rotateCW = tilt < 0;
      f.rotateCCW = tilt > 0;
      mark('stuck');
      return f;
    }
    const keeper = s.systems.keeper;
    const rocks = s.systems.rocks;
    if (!keeper || !rocks) return f;
    const boss = keeper.brain;
    const gun = st.ropeState?.guns[0];
    fired--;
    const hanging = rocks.rocks.filter((r) => r.body !== null);
    const fire = (e: { x: number; y: number }) => {
      const h = s.tuning.harpoonThrust.mountHeight;
      const m = { x: st.pos.x + Math.sin(st.angle) * h, y: st.pos.y - Math.cos(st.angle) * h };
      const l = Math.hypot(e.x - m.x, e.y - m.y);
      f.aim = { x: (e.x - m.x) / l, y: (e.y - m.y) / l };
      f.fire = true;
      fired = 40;
      log.attempts++;
    };
    // 1. grabbed: burn the tendril (exhaust towards the Keeper)
    if (boss.grabbing) {
      const away = { x: st.pos.x - boss.pos.x, y: st.pos.y - boss.pos.y };
      const l = Math.hypot(away.x, away.y) || 1;
      // nose straight away from the Keeper: the exhaust plays along the tendril
      const want = Math.atan2(away.x / l, -away.y / l);
      const err = wrap(want - st.angle);
      const u = err * 4 - st.angularVel * 1.2;
      f.rotateCW = u > 0.15;
      f.rotateCCW = u < -0.15;
      f.thrust = Math.abs(err) < 0.7;
      if (gun && gun.phase !== 'idle') f.release = true;
      mark('grab');
      return f;
    }
    // 2. sweep telegraph / lunge: keep moving across the line of attack
    if (boss.mode === 'sweepWindup' || boss.mode === 'sweep') {
      const to = boss.sweepDir; // the (locking) line of attack
      const a = boss.arena;
      if (boss.mode === 'sweepWindup' && !boss.sweepLocked) {
        steer(s, f, { x: 0, y: 0 }); // hold: moving now only drags the aim along
        // it stands still while it winds up: a rock now still lands on it
        const r = hanging.find((h) => Math.abs(h.entity.x - boss.pos.x) < 40 && Math.hypot(h.entity.x - st.pos.x, h.entity.y - st.pos.y) < 290);
        if (r && fired <= 0 && gun?.phase === 'idle') fire(r.entity);
        if (gun?.phase === 'anchored') f.reelIn = true;
        mark('windupHold');
        return f;
      }
      if (gun && gun.phase !== 'idle') f.release = true;
      // off the locked line: keep to the side we are already on; dead on it -> the lower side (gravity helps)
      const perp = { x: -to.y, y: to.x };
      if (dodge === 0) {
        const rel = { x: st.pos.x - boss.pos.x, y: st.pos.y - boss.pos.y };
        const off = rel.x * perp.x + rel.y * perp.y;
        const vOff = st.vel.x * perp.x + st.vel.y * perp.y;
        const lead = off + vOff * 0.4;
        dodge = Math.abs(lead) > 30 ? Math.sign(lead) : perp.y > 0 ? 1 : -1;
        const end = { x: st.pos.x + perp.x * dodge * 150, y: st.pos.y + perp.y * dodge * 150 };
        if (end.x < a.x + 20 || end.x > a.x + a.w - 20 || end.y < a.y + 20 || end.y > a.y + a.h - 60) dodge = -dodge;
      }
      const rel = { x: st.pos.x - boss.pos.x, y: st.pos.y - boss.pos.y };
      const clear = (rel.x * perp.x + rel.y * perp.y) * dodge > 95; // far enough off the line: stop there
      // never dive fast: braking a fall costs far more than it gains (thrust is only 1.5 g)
      const dv = { x: perp.x * dodge * 200, y: Math.min(140, perp.y * dodge * 200) };
      steer(s, f, clear ? { x: 0, y: 0 } : dv, 1.2, 3);
      mark('dodge');
      return f;
    }
    dodge = 0;
    // 2b. thrown / dropped: get upright and kill the fall first
    const speed = Math.hypot(st.vel.x, st.vel.y);
    if (gun?.phase !== 'anchored' && (st.vel.y > 110 || (speed > 60 && Math.abs(wrap(st.angle)) > 1.2))) {
      steer(s, f, { x: 0, y: -20 }, 0.6, 2);
      mark('recover');
      return f;
    }
    // 2c. keep clear of the Keeper's body
    const away = { x: st.pos.x - boss.pos.x, y: st.pos.y - boss.pos.y };
    const dBoss = Math.hypot(away.x, away.y) || 1;
    if (dBoss < 125 && gun?.phase !== 'anchored') {
      steer(s, f, { x: (away.x / dBoss) * 150, y: (away.y / dBoss) * 150 });
      mark('clear');
      return f;
    }
    // 3. low on fuel: nearest canister
    if (st.fuel < 0.3) {
      const cans = s.env.pickups.pickups.filter((p) => !p.collected && p.entity.kind === 'fuelPickup');
      cans.sort((a, b) => Math.hypot(a.entity.x - st.pos.x, a.entity.y - st.pos.y) - Math.hypot(b.entity.x - st.pos.x, b.entity.y - st.pos.y));
      const c = cans[0];
      if (c) {
        if (gun && gun.phase !== 'idle') f.release = true;
        steer(s, f, approach(s, { x: c.entity.x, y: c.entity.y - 10 }, 170, 1.2));
        mark('fuel');
        return f;
      }
    }
    // 4. rock drop: pick the hanging rock nearest the Keeper
    let rock = hanging.find((r) => r.entity.id === rockId) ?? null;
    if (!rock || (gun?.phase !== 'anchored' && Math.abs(rock.entity.x - boss.pos.x) > 200)) {
      hanging.sort((a, b) => Math.abs(a.entity.x - boss.pos.x) - Math.abs(b.entity.x - boss.pos.x));
      rock = hanging[0] ?? null;
      rockId = rock?.entity.id ?? null;
      if (rock) {
        side = st.pos.x >= rock.entity.x ? 1 : -1;
        const a = boss.arena;
        if (rock.entity.x + side * offset > a.x + a.w - 60 || rock.entity.x + side * offset < a.x + 60) side = side === 1 ? -1 : 1;
      }
    }
    if (!rock) {
      steer(s, f, approach(s, { x: boss.pos.x + 250, y: boss.pos.y - 150 }, 150));
      mark('norock');
      return f;
    }
    // lure: wait on the far side of the rock from the Keeper, one dead zone
    // away — it drifts over and stops right under the rock
    if (gun?.phase !== 'anchored' && Math.abs(boss.pos.x - rock.entity.x) > 40) side = boss.pos.x < rock.entity.x ? 1 : -1;
    const a = boss.arena;
    const sx = Math.min(a.x + a.w - 40, Math.max(a.x + 40, rock.entity.x + side * offset));
    const spot = { x: sx, y: rock.entity.y + below };
    const anchored = gun?.phase === 'anchored';
    if (wasAnchored && !anchored) log.drops += rocks.isHanging(rock.entity.id) ? 0 : 1;
    wasAnchored = anchored;
    if (anchored) {
      steer(s, f, { x: 0, y: 0 });
      f.reelIn = true;
      mark('anchored');
      return f;
    }
    // pass over the Keeper, never through it
    const seg = { x: spot.x - st.pos.x, y: spot.y - st.pos.y };
    const sl = Math.hypot(seg.x, seg.y) || 1;
    const u = Math.max(0, Math.min(1, ((boss.pos.x - st.pos.x) * seg.x + (boss.pos.y - st.pos.y) * seg.y) / (sl * sl)));
    const near = Math.hypot(st.pos.x + seg.x * u - boss.pos.x, st.pos.y + seg.y * u - boss.pos.y);
    const over = { x: boss.pos.x + Math.sign(seg.x || 1) * 30, y: Math.max(boss.arena.y + 45, boss.pos.y - 125) };
    steer(s, f, approach(s, near < 105 && u > 0 && u < 1 && sl > 60 ? over : spot, 170, 1.4));
    const d = Math.hypot(spot.x - st.pos.x, spot.y - st.pos.y);
    const ready = d < 45 && speed < 70 && Math.abs(boss.pos.x - rock.entity.x) < 40;
    if (log.why && s.simTime % 1 < 1 / 60) log.why.push(`${s.simTime.toFixed(0)} ${rock.entity.id} d${d.toFixed(0)} v${speed.toFixed(0)} bx${(boss.pos.x - rock.entity.x).toFixed(0)} ${boss.mode} ${gun?.phase}`);
    if (ready && fired <= 0 && (!gun || gun.phase === 'idle')) fire(rock.entity);
    mark('approach');
    return f;
  };
}

// ------------------------------------------------------------------ lander (map 8)

export interface DashPilotOptions {
  /** The intended line, bottom -> top (y decreasing). */
  route: readonly Vec2[];
  /** Climb speed (px/s). */
  vclimb?: number;
  /** Cross-track gain (1/s) and max sideways speed (px/s). */
  xGain?: number;
  vxMax?: number;
  /** Max tilt from upright (rad). */
  maxTilt?: number;
  /** Attitude PD gains (tilt error, spin damping). */
  kp?: number;
  kd?: number;
  /** Optional debug log. */
  log?: { tilt: number; duty: number }[];
}

/**
 * Lander autopilot (engineLeft / engineRight only, like the keyboard): holds
 * a climb speed up the route with a cross-track correction. The required
 * acceleration sets a tilt target (±maxTilt) and a burn level; a PD loop on
 * the tilt splits the burn between the engines (left engine = clockwise),
 * and each engine is pulse-width modulated (sigma-delta) — a player taps.
 */
export function landerDashPilot(o: DashPilotOptions): Pilot {
  const vclimb = o.vclimb ?? 110;
  // Feel pass (gravity.scale 0.65): softer cross-track gains (were 0.7 / 100). Under the lighter
  // gravity the old ones over-corrected on the S-bends at a 125 px/s climb and hit the wall.
  const xGain = o.xGain ?? 0.5;
  const vxMax = o.vxMax ?? 70;
  const maxTilt = o.maxTilt ?? 0.6;
  const kp = o.kp ?? 2;
  const kd = o.kd ?? 1;
  let accL = 0;
  let accR = 0;
  const xAt = (y: number): number => {
    const r = o.route;
    if (y >= r[0]!.y) return r[0]!.x;
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1]!;
      const b = r[i]!;
      if (y >= b.y) return a.x + ((b.x - a.x) * (a.y - y)) / (a.y - b.y);
    }
    return r[r.length - 1]!.x;
  };
  return (s) => {
    const f = frame();
    const st = s.state;
    // aim at the line a little ahead (above), where we will be in ~0.5 s
    const look = st.pos.y - Math.max(40, -st.vel.y * 0.6);
    const tx = xAt(look);
    const vd = { x: Math.max(-vxMax, Math.min(vxMax, (tx - st.pos.x) * xGain)), y: -vclimb };
    // felt gravity (GRAVITY_TUNING.scale applied); engines are T/W against the felt reference gravity
    const g = s.vessel.hooks.gravityAt?.(st.pos) ?? s.spec.gravity; // m/s²
    const gain = 1.8;
    const req = { x: ((vd.x - st.vel.x) * gain) / 30 - g.x, y: ((vd.y - st.vel.y) * gain) / 30 - g.y };
    const tilt = Math.max(-maxTilt, Math.min(maxTilt, Math.atan2(req.x, -req.y)));
    const both = 2 * s.tuning.lander.thrust * levelReferenceGravity(s.spec, s.tuning);
    const upNow = { x: Math.sin(st.angle), y: -Math.cos(st.angle) };
    const along = Math.max(0, req.x * upNow.x + req.y * upNow.y);
    const duty = Math.min(1, along / both);
    const err = wrap(tilt - st.angle);
    const u = Math.max(-0.6, Math.min(0.6, err * kp - st.angularVel * kd));
    const dl = Math.max(0, Math.min(1, duty + u));
    const dr = Math.max(0, Math.min(1, duty - u));
    accL += dl;
    accR += dr;
    if (accL >= 1) {
      accL -= 1;
      f.engineLeft = true;
    }
    if (accR >= 1) {
      accR -= 1;
      f.engineRight = true;
    }
    o.log?.push({ tilt, duty });
    return f;
  };
}

/** Thrust-only line through the on-route orbs (no rope). cover: hide in the nearest shelter while the sun charges. */
export function hollowPilot(o: { vmax?: number; cover?: boolean } = {}) {
  const orbs = HOLLOW_ORBS.filter((e) => !e.id.startsWith('orbBonus')).map((e) => ({ x: e.x, y: e.y }));
  const orbSet = new Set(orbs);
  const path = [...HOLLOW_ROUTE.filter((p) => !orbs.some((q) => Math.abs(q.x - p.x) < 80)), ...orbs].sort((a, b) => a.x - b.x);
  path.push({ x: 15900, y: 1430 });
  return thrustPilot({ path, precise: (p) => orbSet.has(p), vmax: o.vmax, ...(o.cover ? { shelters: HOLLOW_SHELTERS, shelterReach: 400 } : {}) });
}
