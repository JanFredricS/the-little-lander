/**
 * S7 playtests: reference autopilots fly maps 5-8 headless through the real
 * LevelSession with real InputFrames, and must complete them. These are
 * the "is it beatable" guards for the tuning in each level file (see the
 * playtest notes in the level headers).
 */

import { describe, expect, it } from 'vitest';
import { HOLLOW_ORBS, HOLLOW_ROUTE, HOLLOW_SHELTERS, hollow } from '../src/levels/hollow';
import { vaults } from '../src/levels/vaults';
import { runPilot } from './support/s7Harness';
import { harpoonPilot, thrustPilot } from './support/s7Pilots';

describe('S7 playtests (autopilot completes the map)', () => {
  it('map 5 — The Vaults: hand-over-hand to the camp', { timeout: 120_000 }, async () => {
    const r = await runPilot(vaults, () => harpoonPilot({ landX: 13480 }), 240);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.last.hull).toBeGreaterThan(0.4);
    expect(r.timeSec).toBeLessThan(200);
  });

  it('map 6 — The Hollow: through every gravity zone, 22+ orbs, into the tunnel', { timeout: 120_000 }, async () => {
    const r = await runPilot(hollow, () => hollowPilot(), 300);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.counts.orbCollected).toBeGreaterThanOrEqual(22);
    expect(r.counts.gravityChanged).toBeGreaterThanOrEqual(8);
    expect(r.counts.radiationCharging).toBeGreaterThanOrEqual(10);
  });

  it('map 6 — The Hollow, careful line: hides from every sun pulse behind floating rock', { timeout: 120_000 }, async () => {
    const r = await runPilot(hollow, () => hollowPilot({ cover: true }), 480);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.counts.radiationHit ?? 0).toBeLessThanOrEqual(3);
    expect(r.counts.radiationCharging).toBeGreaterThanOrEqual(20);
    expect(Math.min(...r.trace.map((t) => t.fuel))).toBeGreaterThan(0.3);
  });
});

/** Thrust-only line through the on-route orbs (no rope). cover: hide in the nearest shelter while the sun charges. */
export function hollowPilot(o: { vmax?: number; cover?: boolean } = {}) {
  const orbs = HOLLOW_ORBS.filter((e) => !e.id.startsWith('orbBonus')).map((e) => ({ x: e.x, y: e.y }));
  const orbSet = new Set(orbs);
  const path = [...HOLLOW_ROUTE.filter((p) => !orbs.some((q) => Math.abs(q.x - p.x) < 80)), ...orbs].sort((a, b) => a.x - b.x);
  path.push({ x: 15900, y: 1430 });
  return thrustPilot({ path, precise: (p) => orbSet.has(p), vmax: o.vmax, ...(o.cover ? { shelters: HOLLOW_SHELTERS, shelterReach: 400 } : {}) });
}
