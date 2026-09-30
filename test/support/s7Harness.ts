/**
 * S7 playtest harness: runs a LevelSession headless with a scripted pilot
 * that produces real InputFrames (the same data keyboard / mouse / touch
 * produce), and records what happened. Used by test/s7.playtest.test.ts and
 * the tuning script (npx vitest run test/s7.playtest.test.ts).
 */

import type { GameEvent, InputFrame, LevelOutcome, LevelSpec } from '../../src/contracts';
import { LevelSession } from '../../src/game/session';
import { emptyFrame } from '../../src/shell/input';

export type Pilot = (s: LevelSession, tick: number) => InputFrame;

export interface RunResult {
  outcome: LevelOutcome | null;
  timeSec: number;
  maxX: number;
  minY: number;
  last: { x: number; y: number; fuel: number; hull: number };
  events: GameEvent[];
  counts: Record<string, number>;
  trace: { t: number; x: number; y: number; v: number; fuel: number; hull: number }[];
}

export async function runPilot(spec: LevelSpec, makePilot: () => Pilot, maxSec: number, onStep?: (s: LevelSession) => void): Promise<RunResult> {
  const s = await LevelSession.create(spec);
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  const pilot = makePilot();
  let maxX = -Infinity;
  let minY = Infinity;
  const trace: RunResult['trace'] = [];
  const steps = Math.round(maxSec * 60);
  for (let i = 0; i < steps && !s.outcome; i++) {
    s.step(pilot(s, i));
    onStep?.(s);
    const st = s.state;
    maxX = Math.max(maxX, st.pos.x);
    minY = Math.min(minY, st.pos.y);
    if (i % 60 === 0) trace.push({ t: s.simTime, x: Math.round(st.pos.x), y: Math.round(st.pos.y), v: Math.round(Math.hypot(st.vel.x, st.vel.y)), fuel: +st.fuel.toFixed(2), hull: +st.hull.toFixed(2) });
  }
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const st = s.state;
  const res: RunResult = {
    outcome: s.outcome,
    timeSec: s.simTime,
    maxX,
    minY,
    last: { x: Math.round(st.pos.x), y: Math.round(st.pos.y), fuel: st.fuel, hull: st.hull },
    events,
    counts,
    trace,
  };
  s.destroy();
  return res;
}

export function frame(p: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyFrame(), ...p };
}
