/**
 * Round 13: a rope-only climber for The Hollow's floor-softlock test
 * (test/hollow.test.ts). An EMPTY tank, resting on the floor (or, in the UP
 * zones, on the crust): rope the best anchor above (high against the local
 * gravity, not too far to the side — a long side swing slams the pod into a
 * spire), reel in while the pod is calm, and once short (or stalled) re-rope
 * something higher. Looks at the level by ray casting, like a player; only
 * produces InputFrames.
 *
 * Round 17: also drives The Vaults' rope-only recovery test (test/vaults.test.ts):
 * the target line and band are parameters, and the rope tuning follows the vessel
 * mode (harpoon = rope guns only, harpoonThrust = The Hollow's rig).
 */

import type { Vec2 } from '../../src/contracts';
import type { LevelSession } from '../../src/game/session';
import { mulberry32 } from '../../src/art/core/rng';
import { hollowRouteY } from '../../src/levels/hollow';
import { frame } from './s7Harness';
import { castSolid } from '../../src/physics/tags';
import { vMToPx, vPxToM } from '../../src/physics/units';

/**
 * Back at the flight line (px off it): hanging under a spire tip (tips are <= 150 px off
 * the line, the pod hangs ~25 px past its anchor) or a rock beside the line.
 */
export const ROUTE_BAND = 220;
/** Score penalty (px of height) for an anchor that will crack. */
const BRITTLE_PENALTY = 60;

/** Where the climber is heading: `routeY(x)` and how close (px) counts as there. */
export interface ClimbTarget {
  routeY: (x: number) => number;
  band: number;
}

const ropeTuning = (s: LevelSession) => (s.vessel.mode === 'harpoon' ? s.tuning.harpoon : s.tuning.harpoonThrust);

/** Every acceptable anchor in the half plane above the pod (against `up`), 1° apart, within the rope range. */
function sweep(s: LevelSession, up: Vec2): { point: Vec2; dir: Vec2; brittle: boolean }[] {
  const st = s.state;
  const t = ropeTuning(s);
  const m = { x: st.pos.x + Math.sin(st.angle) * t.mountHeight, y: st.pos.y - Math.cos(st.angle) * t.mountHeight };
  const range = t.ropeRange - 10;
  const side = { x: -up.y, y: up.x };
  const out: { point: Vec2; dir: Vec2; brittle: boolean }[] = [];
  for (let deg = 0; deg <= 180; deg++) {
    const a = (deg * Math.PI) / 180;
    const dir = { x: side.x * Math.cos(a) + up.x * Math.sin(a), y: side.y * Math.cos(a) + up.y * Math.sin(a) };
    const hit = castSolid(s.physics, vPxToM(m), vPxToM({ x: m.x + dir.x * range, y: m.y + dir.y * range }), [...s.vessel.parts]);
    if (!hit) continue;
    const point = vMToPx(hit.point);
    const at = s.vessel.hooks.anchorAt(hit.body, point);
    if (at.ok) out.push({ point, dir, brittle: at.brittleSec !== undefined });
  }
  return out;
}

export function climbToRoute(
  s: LevelSession,
  maxSec: number,
  log?: (msg: string) => void,
  lateralWeight = 0.7,
  target: ClimbTarget = { routeY: hollowRouteY, band: ROUTE_BAND },
): { reached: boolean; t: number; closest: number } {
  const routeY = target.routeY;
  let cooldown = 0;
  let lastLen = Infinity;
  let stall = 0;
  let closest = Infinity;
  /** Directions the winch stalled in from here (the pod wedged against rock): avoid them until the pod moves on. */
  let wedged: { at: Vec2; dirs: Vec2[] } = { at: { x: 0, y: 0 }, dirs: [] };
  let lower = 0;
  /** Anchors used so far: a sidestep goes somewhere new. */
  const used: Vec2[] = [];
  /** Frames since the pod last got closer to the flight line (or last explored): after 5 s, explore. */
  let sinceProgress = 0;
  const rand = mulberry32(Math.round(s.state.pos.x * 7 + lateralWeight * 1000));
  for (let i = 0; i < maxSec * 60 && !s.outcome; i++) {
    const st = s.state;
    const off = Math.abs(st.pos.y - routeY(st.pos.x));
    if (off < closest - 10) sinceProgress = 0;
    else sinceProgress++;
    closest = Math.min(closest, off);
    if (off <= target.band) return { reached: true, t: i / 60, closest };
    const g = s.vessel.hooks.gravityAt?.(st.pos) ?? s.spec.gravity;
    const gl = Math.hypot(g.x, g.y) || 1;
    // "up" = towards the flight line (against gravity in the down / UP zones; in the
    // sideways zones gravity says little about where the line is)
    const up = { x: 0, y: routeY(st.pos.x) < st.pos.y ? -1 : 1 };
    const offAt = (p: Vec2) => Math.abs(p.y - routeY(p.x));
    const height = (p: Vec2) => off - offAt(p);
    const lateral = (p: Vec2) => Math.abs(p.x - st.pos.x);
    const speed = Math.hypot(st.vel.x, st.vel.y);
    /** Don't rope across a gravity boundary: the swing flips "down" mid-air and slams the pod. */
    const sameGravity = (p: Vec2) => {
      const q = s.vessel.hooks.gravityAt?.(p) ?? g;
      return (q.x * g.x + q.y * g.y) / ((Math.hypot(q.x, q.y) || 1) * gl) > 0.5;
    };
    const gun = st.ropeState?.guns[0];
    if (log && i % 300 === 0) log(`  .. t${i / 60} ${Math.round(st.pos.x)},${Math.round(st.pos.y)} v${speed.toFixed(1)} ${gun?.phase} len ${gun?.length?.toFixed(1)} head ${gun?.head ? `${Math.round(gun.head.x)},${Math.round(gun.head.y)}` : '-'} stall ${stall} landed ${st.landed}`);
    const f = frame();
    cooldown--;
    if (Math.hypot(st.pos.x - wedged.at.x, st.pos.y - wedged.at.y) > 60) wedged = { at: { ...st.pos }, dirs: [] };
    const pick = (minGain: number) => {
      let best: { dir: Vec2; score: number; point: Vec2 } | null = null;
      for (const c of sweep(s, up)) {
          const h = height(c.point);
          if (h < minGain) continue;
          if (wedged.dirs.some((d) => d.x * c.dir.x + d.y * c.dir.y > 0.8)) continue;
          // across a gravity boundary only as a last resort
          // a brittle anchor only when it is clearly better (round-17 audit: it breaks mid-climb)
          const score = h - lateralWeight * lateral(c.point) - (sameGravity(c.point) ? 0 : 1000) - (c.brittle ? BRITTLE_PENALTY : 0);
          if (!best || score > best.score) best = { dir: c.dir, score, point: c.point };
      }
      return best;
    };
    /**
     * Stuck (no progress for a while): traverse — rope a spot not tried yet that is not much
     * further from the line, chosen pseudo-randomly (seeded: the run is deterministic).
     */
    const explore = () => {
      const all = sweep(s, up).filter((c) => height(c.point) >= -150 && !used.some((u) => Math.hypot(u.x - c.point.x, u.y - c.point.y) < 60));
      const same = all.filter((c) => sameGravity(c.point));
      const from = same.length > 0 ? same : all;
      return from.length > 0 ? from[Math.floor(rand.next() * from.length)]! : null;
    };
    const fire = (p: { dir: Vec2; point: Vec2 }) => {
      used.push({ ...p.point });
      f.aim = p.dir;
      f.fire = true;
      cooldown = 30;
      lastLen = Infinity;
      stall = 0;
      log?.(`t${(i / 60).toFixed(1)} at ${Math.round(st.pos.x)},${Math.round(st.pos.y)} v${Math.round(speed)} -> ${Math.round(p.point.x)},${Math.round(p.point.y)}`);
    };
    let explored = false;
    if (cooldown <= 0 && speed < 60 && sinceProgress > 300 && (!gun || gun.phase !== 'flying')) {
      const p = explore();
      // nothing new in reach: carry on climbing as usual (and look again in 5 s)
      sinceProgress = 0;
      if (p) {
        fire(p);
        lower = 0;
        explored = true;
      }
    }
    if (explored) {
      // fired this frame
    } else if (!gun || gun.phase === 'idle') {
      if (cooldown <= 0 && speed < 60) {
        const p = pick(30);
        if (p) fire(p);
      }
    } else if (gun.phase === 'anchored' && gun.head) {
      const len = gun.length ?? 0;
      const tmin = ropeTuning(s).ropeMin;
      if (lower > 0) {
        // nothing else to rope from the wedge: pay out a little and look again
        lower--;
        f.reelOut = true;
        if (lower === 0) lastLen = Infinity;
        s.step(f);
        continue;
      }
      f.reelIn = speed < 70 && len > tmin + 2;
      // stalled = reeling in but not shortening (a swing too fast to reel is not a wedge)
      stall = !f.reelIn || len < lastLen - 0.5 ? 0 : stall + 1;
      lastLen = Math.min(lastLen, len);
      if (cooldown <= 0 && speed < 40 && len <= tmin + 8) {
        const p = pick(Math.max(30, height(gun.head) + 25));
        if (p) fire(p);
      } else if (cooldown <= 0 && stall > 60) {
        // wedged: the winch will not pull the pod through rock. Rope something else
        // above the POD (not necessarily above this anchor) that pulls it clear
        const d = { x: gun.head.x - st.pos.x, y: gun.head.y - st.pos.y };
        const l = Math.hypot(d.x, d.y) || 1;
        wedged.dirs.push({ x: d.x / l, y: d.y / l });
        const p = pick(25);
        if (p) fire(p);
        else {
          lower = 40;
          stall = 0;
          wedged.dirs = [];
        }
      }
    }
    s.step(f);
  }
  return { reached: false, t: maxSec, closest };
}
