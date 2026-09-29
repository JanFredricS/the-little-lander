/**
 * Reference autopilots for the S7 playtest pass. They only produce
 * InputFrames (aim / fire / reel / thrust / rotate / engines) — exactly what
 * a player's devices produce — and "look" at the level the way a player
 * does: by casting rays at what is on screen. No state is poked.
 */

import type { InputFrame, Vec2 } from '../../src/contracts';
import type { LevelSession } from '../../src/game/session';
import { castSolid } from '../../src/physics/tags';
import { mToPx, vMToPx, vPxToM } from '../../src/physics/units';
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

/** Angle wrap to (-pi, pi]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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
    const g = s.vessel.hooks.gravityAt(st.pos); // m/s²
    const k = 1.6; // 1/s
    const req = { x: ((vd.x - st.vel.x) * k) / 30 - g.x, y: ((vd.y - st.vel.y) * k) / 30 - g.y };
    // never tilt more than maxTilt away from "against gravity" (keep lift)
    const gUp = Math.atan2(-g.x, g.y);
    const raw = wrap(Math.atan2(req.x, -req.y) - gUp);
    const want = gUp + Math.max(-maxTilt, Math.min(maxTilt, raw));
    const err = wrap(want - st.angle);
    const u = err * 4 - st.angularVel * 1.2;
    f.rotateCW = u > 0.15;
    f.rotateCCW = u < -0.15;
    const thrustAcc = s.tuning.harpoonThrust.thrust * Math.max(1.6, Math.hypot(s.spec.gravity.x, s.spec.gravity.y));
    const upNow = { x: Math.sin(st.angle), y: -Math.cos(st.angle) };
    const along = req.x * upNow.x + req.y * upNow.y;
    // on the ground a pod cannot pivot: lift off straight first
    f.thrust = (Math.abs(err) < 0.5 || st.landed) && along > thrustAcc * 0.45;
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
