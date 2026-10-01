/**
 * Wind gust scheduler. Each WindGustSchedule's gusts run on simulation time
 * (optionally repeating). Per gust: 'warning' event warnSec before it (the
 * telegraph for render/audio), 'start' when it begins (full force), 'end'
 * after durationSec. While active, the gust's acceleration (mass-independent)
 * acts on the vessel if it is inside the schedule's rect.
 *
 * Round 10 (floatingIsles' sky ceiling, low turbulence, CSM crosswinds) - all
 * optional per schedule, legacy schedules behave exactly as before:
 *  - unit 'vesselThrust': accel is a multiple of the flying vessel's max
 *    thrust acceleration (its tuning × the level's reference gravity), so a
 *    "stronger than your engines" gust stays true if thrust is retuned.
 *  - fade: strength ramps with altitude over a height band (no hard line).
 *  - turbulence: deterministic irregular modulation (time, position, seed).
 *  - speedCap: each axis of the push fades out as the vessel reaches that
 *    speed along it (per axis: a cruise across a vertical wind is still pushed).
 *  - local: the telegraph (events + streaks) only for gust instances that begin
 *    (warning or start) while the vessel is in the zone or within
 *    telegraphMargin of it, instead of level-wide. An instance once heard is
 *    LATCHED: it runs warning -> start -> end on its own timing even if the
 *    vessel leaves, and bobbing across the margin never re-telegraphs it (at
 *    most one warning / whoosh per gust instance).
 *  - gust.silent: background force, never telegraphed.
 */

import type { GameEventSink, Vec2, WindGust, WindGustSchedule, ZoneSpec } from '../../contracts';
import { rectContains } from '../geom';

export type GustPhase = 'idle' | 'warning' | 'active';

/** Default telegraph lead time (s), per the WindGust contract. */
export const DEFAULT_WARN_SEC = 1.5;
/** speedCap: the push fades out linearly over this many px/s below the cap. */
export const WIND_CAP_SOFT = 30;
/** Default distance (px) at which a `local` schedule starts telegraphing. */
export const DEFAULT_TELEGRAPH_MARGIN = 150;

/** Scratch result of gustTimed (one per module: no allocation per call). */
const timedOut = { phase: 'idle' as GustPhase, instance: -1 };

/** The gust's timed phase at `t` and which repeat (instance index, -1 when idle) it belongs to. Writes and returns a shared record. */
export function gustTimed(g: WindGust, repeatEverySec: number | undefined, t: number): { phase: GustPhase; instance: number } {
  const warn = g.warnSec ?? DEFAULT_WARN_SEC;
  const k = repeatEverySec ? Math.floor(t / repeatEverySec) : 0;
  const c0 = repeatEverySec ? Math.max(0, k - 1) : 0;
  const c1 = repeatEverySec ? k + 1 : 0;
  const rep = repeatEverySec ?? 0;
  for (let c = c0; c <= c1; c++) {
    const b = c * rep;
    if (t >= b + g.atSec && t < b + g.atSec + g.durationSec) {
      timedOut.phase = 'active';
      timedOut.instance = c;
      return timedOut;
    }
  }
  for (let c = c0; c <= c1; c++) {
    const b = c * rep;
    if (t >= b + g.atSec - warn && t < b + g.atSec) {
      timedOut.phase = 'warning';
      timedOut.instance = c;
      return timedOut;
    }
  }
  timedOut.phase = 'idle';
  timedOut.instance = -1;
  return timedOut;
}

export function gustPhase(g: WindGust, repeatEverySec: number | undefined, t: number): GustPhase {
  return gustTimed(g, repeatEverySec, t).phase;
}

/** Altitude fade 0..1 at world y (1 without a fade band). */
export function windFade(z: Pick<WindGustSchedule, 'fade'>, y: number): number {
  const f = z.fade;
  if (!f) return 1;
  if (f.y1 === f.y0) return 0; // rejected by validateLevel
  return Math.min(1, Math.max(0, (y - f.y0) / (f.y1 - f.y0)));
}

/** Smooth deterministic noise in -1..1 (value noise, cosine-interpolated). */
export function windNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    let v = Math.imul(n ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
    v ^= v >>> 13;
    v = Math.imul(v, 0xc2b2ae35);
    v ^= v >>> 16;
    return ((v >>> 0) / 0xffffffff) * 2 - 1;
  };
  const w = (1 - Math.cos(f * Math.PI)) / 2;
  return h(i) * (1 - w) + h(i + 1) * w;
}

/** Is the vessel close enough to a `local` schedule to hear / see its telegraph? */
function heard(z: WindGustSchedule, p: Vec2): boolean {
  if (!z.local) return true;
  const m = z.telegraphMargin ?? DEFAULT_TELEGRAPH_MARGIN;
  if (z.rect && !rectContains({ x: z.rect.x - m, y: z.rect.y - m, w: z.rect.w + 2 * m, h: z.rect.h + 2 * m }, p)) return false;
  if (!z.fade) return true;
  // m px earlier along the band: from y0 toward y1
  return windFade(z, p.y + m * Math.sign(z.fade.y1 - z.fade.y0)) > 0;
}

export interface ActiveGust {
  zone: WindGustSchedule;
  gust: WindGust;
  phase: GustPhase;
  /** Felt direction / size (m/s², before fade and turbulence) for the telegraph. */
  accel: Vec2;
}

export class WindSystem {
  readonly schedules: readonly WindGustSchedule[];
  private readonly phases: GustPhase[][];
  /** Local schedules: the gust instance being telegraphed (-1 = none). */
  private readonly latched: number[][];
  /** Gusts not idle right now that the vessel can see (render telegraph). */
  active: ActiveGust[] = [];

  /**
   * @param gravityScale legacy m/s² gusts were balanced against the unscaled
   *   gravity, so they are felt × gravity.scale (feel pass)
   */
  constructor(
    zones: readonly ZoneSpec[],
    private readonly events: GameEventSink,
    private readonly gravityScale = 1,
  ) {
    this.schedules = zones.filter((z): z is WindGustSchedule => z.kind === 'windGustSchedule');
    this.phases = this.schedules.map((z) => z.gusts.map(() => 'idle' as GustPhase));
    this.latched = this.schedules.map((z) => z.gusts.map(() => -1));
  }

  /**
   * Advance to sim time `t`; returns the felt wind acceleration (m/s²) on a
   * vessel at `vesselPos` (moving at `vesselVel` px/s) whose engines give at
   * most `thrustAccel` m/s².
   */
  update(t: number, vesselPos: Vec2, thrustAccel = 0, vesselVel: Vec2 = { x: 0, y: 0 }): Vec2 {
    const accel = { x: 0, y: 0 };
    this.active = [];
    this.schedules.forEach((z, zi) => {
      const unit = z.unit === 'vesselThrust' ? thrustAccel : this.gravityScale;
      const local = !!z.local;
      const near = heard(z, vesselPos);
      const inside = !z.rect || rectContains(z.rect, vesselPos);
      z.gusts.forEach((g, gi) => {
        const prev = this.phases[zi]![gi]!;
        const tm = gustTimed(g, z.repeatEverySec, t);
        const timed = tm.phase;
        let cur: GustPhase;
        if (g.silent) cur = 'idle';
        else if (!local) cur = timed;
        else {
          // telegraph an instance only if it begins (or is entered) near the vessel; once heard it runs to its end
          const lat = this.latched[zi]!;
          if (timed !== 'idle' && (lat[gi] === tm.instance || near)) {
            lat[gi] = tm.instance;
            cur = timed;
          } else {
            if (timed === 'idle') lat[gi] = -1;
            cur = 'idle';
          }
        }
        this.phases[zi]![gi] = cur;
        // legacy events carry the designed accel; thrust-relative ones the felt m/s²
        const ev = (): Vec2 => (z.unit === 'vesselThrust' ? { x: g.accel.x * unit, y: g.accel.y * unit } : { ...g.accel });
        if (cur !== prev) {
          if (prev === 'active' || (local && prev === 'warning' && cur === 'idle')) this.events({ type: 'windGust', zoneId: z.id, phase: 'end', accel: ev() });
          if (cur === 'warning') this.events({ type: 'windGust', zoneId: z.id, phase: 'warning', accel: ev() });
          if (cur === 'active') this.events({ type: 'windGust', zoneId: z.id, phase: 'start', accel: ev() });
        }
        if (cur !== 'idle') this.active.push({ zone: z, gust: g, phase: cur, accel: { x: g.accel.x * unit, y: g.accel.y * unit } });
        if (timed === 'active' && inside) {
          const k = unit * windFade(z, vesselPos.y);
          if (k === 0) return;
          let ax = g.accel.x;
          let ay = g.accel.y;
          const tb = z.turbulence;
          if (tb) {
            // irregular shoves: the strength swells and dips, and a sideways kick wanders (deterministic).
            // The kick is along world x: perpendicular only for vertical gusts (all current turbulence)
            const u = t * tb.hz + vesselPos.x / 400;
            const mag = Math.hypot(ax, ay);
            const along = 1 + tb.amount * windNoise(u, tb.seed);
            ax = ax * along + tb.lateral * mag * windNoise(u * 1.37 + 11.3, tb.seed + 101);
            ay = ay * along;
          }
          let capX = 1;
          let capY = 1;
          if (z.speedCap !== undefined) {
            // per axis: the vessel's speed in the direction this axis pushes
            capX = Math.min(1, Math.max(0, (z.speedCap - vesselVel.x * Math.sign(ax)) / WIND_CAP_SOFT));
            capY = Math.min(1, Math.max(0, (z.speedCap - vesselVel.y * Math.sign(ay)) / WIND_CAP_SOFT));
          }
          accel.x += ax * k * capX;
          accel.y += ay * k * capY;
        }
      });
    });
    return accel;
  }
}
