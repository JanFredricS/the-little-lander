/**
 * Wind gust scheduler. Each WindGustSchedule's gusts run on simulation time
 * (optionally repeating). Per gust: 'warning' event warnSec before it (the
 * telegraph for render/audio), 'start' when it begins (full force), 'end'
 * after durationSec. While active, the gust's acceleration (m/s², mass-
 * independent) acts on the vessel if it is inside the schedule's rect.
 */

import type { GameEventSink, Vec2, WindGust, WindGustSchedule, ZoneSpec } from '../../contracts';
import { rectContains } from '../geom';

export type GustPhase = 'idle' | 'warning' | 'active';

/** Default telegraph lead time (s), per the WindGust contract. */
export const DEFAULT_WARN_SEC = 1.5;

export function gustPhase(g: WindGust, repeatEverySec: number | undefined, t: number): GustPhase {
  const warn = g.warnSec ?? DEFAULT_WARN_SEC;
  const bases: number[] = [];
  if (repeatEverySec) {
    const k = Math.floor(t / repeatEverySec);
    for (const c of [k - 1, k, k + 1]) if (c >= 0) bases.push(c * repeatEverySec);
  } else bases.push(0);
  for (const b of bases) if (t >= b + g.atSec && t < b + g.atSec + g.durationSec) return 'active';
  for (const b of bases) if (t >= b + g.atSec - warn && t < b + g.atSec) return 'warning';
  return 'idle';
}

export interface ActiveGust {
  zone: WindGustSchedule;
  gust: WindGust;
  phase: GustPhase;
}

export class WindSystem {
  readonly schedules: readonly WindGustSchedule[];
  private readonly phases: GustPhase[][];
  /** Gusts not idle right now (render telegraph). */
  active: ActiveGust[] = [];

  constructor(
    zones: readonly ZoneSpec[],
    private readonly events: GameEventSink,
  ) {
    this.schedules = zones.filter((z): z is WindGustSchedule => z.kind === 'windGustSchedule');
    this.phases = this.schedules.map((z) => z.gusts.map(() => 'idle' as GustPhase));
  }

  /** Advance to sim time `t`; returns the wind acceleration (m/s²) acting on a vessel at `vesselPos`. */
  update(t: number, vesselPos: Vec2): Vec2 {
    const accel = { x: 0, y: 0 };
    this.active = [];
    this.schedules.forEach((z, zi) => {
      z.gusts.forEach((g, gi) => {
        const prev = this.phases[zi]![gi]!;
        const cur = gustPhase(g, z.repeatEverySec, t);
        this.phases[zi]![gi] = cur;
        if (cur !== prev) {
          if (prev === 'active') this.events({ type: 'windGust', zoneId: z.id, phase: 'end', accel: { ...g.accel } });
          if (cur === 'warning') this.events({ type: 'windGust', zoneId: z.id, phase: 'warning', accel: { ...g.accel } });
          if (cur === 'active') this.events({ type: 'windGust', zoneId: z.id, phase: 'start', accel: { ...g.accel } });
        }
        if (cur !== 'idle') this.active.push({ zone: z, gust: g, phase: cur });
        if (cur === 'active' && (!z.rect || rectContains(z.rect, vesselPos))) {
          accel.x += g.accel.x;
          accel.y += g.accel.y;
        }
      });
    });
    return accel;
  }
}
