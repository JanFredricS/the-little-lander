/**
 * Exit dock gate (round 8: "should be enough to just touch the square - i
 * touched it but did not progress"). One rule for the session (does the
 * vessel complete the exit?) and the HUD (why not yet?), so a vessel inside
 * the exit rect that fails a gate is never a silent failure: the HUD shows
 * exitHintText() while it is in there.
 *
 * Exit rect: centred on (x, y) horizontally, extending h px ABOVE the
 * landing surface; the vessel CENTRE must be inside it.
 */

import type { ExitDockEntity, VesselState } from '../contracts';

/** 'out' = not in the rect; 'ok' = completes; otherwise the gate that holds it back. */
export type ExitGate = 'out' | 'ok' | 'land' | 'slow' | 'level';

export function inExitRect(exit: Pick<ExitDockEntity, 'x' | 'y' | 'w' | 'h'>, x: number, y: number): boolean {
  return x >= exit.x - exit.w / 2 && x <= exit.x + exit.w / 2 && y <= exit.y && y >= exit.y - exit.h;
}

export function exitGate(exit: ExitDockEntity, s: Pick<VesselState, 'pos' | 'vel' | 'angle' | 'landed'>): ExitGate {
  if (!inExitRect(exit, s.pos.x, s.pos.y)) return 'out';
  if (exit.requireLanding && !s.landed) return 'land';
  if (exit.maxSpeed !== undefined && Math.hypot(s.vel.x, s.vel.y) > exit.maxSpeed) return 'slow';
  if (exit.maxAngle !== undefined && Math.abs(s.angle) > exit.maxAngle) return 'level';
  return 'ok';
}

/** HUD hint for a vessel inside the exit rect that a gate still holds back (null = none). */
export function exitHintText(g: ExitGate): string | null {
  switch (g) {
    case 'land':
      return 'LAND ON THE PAD TO FINISH';
    case 'slow':
      return 'TOO FAST - SLOW DOWN';
    case 'level':
      return 'LEVEL OUT TO DOCK';
    default:
      return null;
  }
}
