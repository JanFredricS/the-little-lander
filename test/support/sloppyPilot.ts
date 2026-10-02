/**
 * Round 14: a mid-skill pilot for The Throat's difficulty test (test/throat.test.ts).
 * The dev Autopilot is a competent pilot; this one flies the same route like a
 * player who is getting the hang of it:
 *  - late: every input reaches the engines `lagFrames` late (reaction time), so
 *    it overshoots and overcorrects;
 *  - hurried: cruise speeds × `speedMul`, and it never centres - each route node
 *    is aimed `aimErr` px off to one side (alternating, seeded);
 *  - fumbling: a fraction `holdRate` of frames repeats the previous input (a key
 *    held too long) and a fraction `dropRate` loses an engine pulse.
 * Deterministic for a given seed. Only produces InputFrames.
 */

import type { InputFrame } from '../../src/contracts';
import type { LevelSession } from '../../src/game/session';
import { Autopilot, type RouteNode } from '../../src/levels/dev/autopilot';
import { mulberry32 } from '../../src/art/core/rng';

export interface SloppyOpts {
  lagFrames: number;
  /** Thumbs, not a PWM: inputs change only every `holdFrames` frames (sample-and-hold), so thrust comes in coarse pulses. */
  holdFrames: number;
  speedMul: number;
  aimErr: number;
  holdRate: number;
  dropRate: number;
  seed: number;
}

export const MID_SKILL: SloppyOpts = { lagFrames: 9, holdFrames: 7, speedMul: 1.15, aimErr: 16, holdRate: 0.12, dropRate: 0.06, seed: 1 };

export class SloppyPilot {
  private readonly ap: Autopilot;
  private readonly queue: InputFrame[] = [];
  private last: InputFrame | null = null;
  private held: InputFrame | null = null;
  private n = 0;
  /** Engine duty accumulated over the current hold window (the autopilot's PWM averaged). */
  private dutyL = 0;
  private dutyR = 0;
  private readonly rand: { next(): number };

  constructor(route: readonly RouteNode[], readonly o: SloppyOpts = MID_SKILL) {
    const r = mulberry32(o.seed * 7919 + 13);
    this.rand = r;
    const sloppy = route.map((n, i) => {
      if (n.land) return { ...n };
      const side = (i % 2 === 0 ? 1 : -1) * (0.5 + r.next() * 0.5);
      return { ...n, x: n.x + side * o.aimErr, speed: Math.round((n.speed ?? 140) * o.speedMul), tol: Math.round((n.tol ?? 40) * 1.2) };
    });
    this.ap = new Autopilot(sloppy);
  }

  get done(): boolean {
    return this.ap.done;
  }

  frame(s: LevelSession): InputFrame {
    const want = this.ap.frame(s);
    // the thumbs average what the autopilot pulses over a window, then press for the whole next window
    this.dutyL += want.engineLeft ? 1 : 0;
    this.dutyR += want.engineRight ? 1 : 0;
    if (this.n++ % this.o.holdFrames === 0 || !this.held) {
      const k = this.o.holdFrames;
      this.held = { ...want, engineLeft: this.dutyL / k >= 0.5, engineRight: this.dutyR / k >= 0.5 };
      this.dutyL = this.dutyR = 0;
    }
    this.queue.push({ ...this.held });
    let f = this.queue.length > this.o.lagFrames ? this.queue.shift()! : { ...this.queue[0]!, engineLeft: false, engineRight: false, thrust: false };
    if (this.last && this.rand.next() < this.o.holdRate) f = { ...this.last };
    else if (this.rand.next() < this.o.dropRate) f = { ...f, engineLeft: this.rand.next() < 0.5 ? false : f.engineLeft, engineRight: this.rand.next() < 0.5 ? false : f.engineRight };
    this.last = f;
    return f;
  }
}

export interface LivesReport {
  outcome: 'complete' | 'failed' | 'timeout';
  /** Crashes survived thanks to a checkpoint (respawns used). */
  respawns: number;
  /** Where each life ended in a crash. */
  crashes: { y: number; cause: string; checkpoint: string | null }[];
  timeSec: number;
  hull: number;
  fuel: number;
}

/**
 * Fly `spec` with a fresh SloppyPilot per life: after a crash with a checkpoint,
 * resume from it (the route from the respawn on), up to `maxLives` lives.
 */
export async function flyLives(
  create: (respawn: ReturnType<LevelSession['respawnState']>) => Promise<LevelSession>,
  route: readonly RouteNode[],
  o: SloppyOpts,
  maxLives: number,
  maxSec = 400,
): Promise<LivesReport> {
  const crashes: LivesReport['crashes'] = [];
  let respawn: ReturnType<LevelSession['respawnState']> = null;
  for (let life = 0; life < maxLives; life++) {
    const s = await create(respawn);
    s.start();
    const fromY = respawn ? respawn.checkpoint.spawn.pos.y : -Infinity;
    const rest = route.filter((n) => n.y > fromY + 20);
    const pilot = new SloppyPilot(rest, { ...o, seed: o.seed + life * 101 });
    for (let k = 0; k < maxSec * 60 && !s.outcome; k++) s.step(pilot.frame(s));
    const out = s.outcome;
    const report = { timeSec: s.elapsed, hull: s.state.hull, fuel: s.state.fuel };
    if (out?.kind === 'complete') {
      s.destroy();
      return { outcome: 'complete', respawns: life, crashes, ...report };
    }
    if (!out) {
      s.destroy();
      return { outcome: 'timeout', respawns: life, crashes, ...report };
    }
    crashes.push({ y: Math.round(s.state.pos.y), cause: out.kind === 'failed' ? out.cause : '?', checkpoint: s.checkpoint?.id ?? null });
    respawn = s.respawnState();
    s.destroy();
    if (!respawn) return { outcome: 'failed', respawns: life, crashes, ...report };
  }
  return { outcome: 'failed', respawns: maxLives - 1, crashes, timeSec: 0, hull: 0, fuel: 0 };
}
