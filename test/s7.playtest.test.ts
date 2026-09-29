/**
 * S7 playtests: reference autopilots fly maps 5-8 headless through the real
 * LevelSession with real InputFrames, and must complete them. These are
 * the "is it beatable" guards for the tuning in each level file (see the
 * playtest notes in the level headers).
 */

import { describe, expect, it } from 'vitest';
import { vaults } from '../src/levels/vaults';
import { runPilot } from './support/s7Harness';
import { harpoonPilot } from './support/s7Pilots';

describe('S7 playtests (autopilot completes the map)', () => {
  it('map 5 — The Vaults: hand-over-hand to the camp', { timeout: 120_000 }, async () => {
    const r = await runPilot(vaults, () => harpoonPilot({ landX: 13480 }), 240);
    expect(r.outcome?.kind).toBe('complete');
    expect(r.last.hull).toBeGreaterThan(0.4);
    expect(r.timeSec).toBeLessThan(200);
  });
});
