/**
 * S7 render layer smoke test: S7LevelFx draws every S7 system's state
 * (Keeper + tendrils + sweep telegraph, rocks, slam debris, crumbling ledges,
 * the collapse front, S7 gates) frame after frame of a real piloted run
 * without throwing. Pixi Graphics works headless; sprite textures (which
 * need a real canvas) are stubbed.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import type { ArtApi, LevelSpec } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { keeper } from '../src/levels/keeper';
import { MADDASH_ROUTE, madDash } from '../src/levels/madDash';
import { vaults } from '../src/levels/vaults';
import { S7LevelFx } from '../src/render/s7LevelFx';
import type { Pilot } from './support/s7Harness';
import { keeperPilot, landerDashPilot } from './support/s7Pilots';

const art = { getSprite: () => ({ canvas: {}, width: 8, height: 8, pivot: { x: 4, y: 4 } }) } as unknown as ArtApi;

beforeAll(() => {
  vi.spyOn(Texture, 'from').mockImplementation(() => Texture.WHITE);
});
afterAll(() => {
  vi.restoreAllMocks();
});

async function drive(spec: LevelSpec, pilot: Pilot, seconds: number, seen: (fx: S7LevelFx, s: LevelSession) => void) {
  const s = await LevelSession.create(spec);
  s.start();
  const fx = new S7LevelFx(s, art);
  expect(S7LevelFx.wanted(s)).toBe(true);
  for (let i = 0; i < seconds * 60 && !s.outcome; i++) {
    s.step(pilot(s, i));
    if (i % 3 === 0) {
      fx.render(0.5, i * 16.7);
      seen(fx, s);
    }
  }
  fx.destroy();
  s.destroy();
}

describe('S7 render layer', () => {
  it('draws the Keeper fight: body, tendrils, the sweep telegraph (tracking and locked), rocks', { timeout: 120_000 }, async () => {
    const modes = new Set<string>();
    let locked = false;
    let tendrils = 0;
    let falling = 0;
    await drive(keeper, keeperPilot(), 120, (_fx, s) => {
      const b = s.systems.keeper!.brain;
      modes.add(b.mode);
      if (b.mode === 'sweepWindup' && b.sweepLocked) locked = true;
      tendrils = Math.max(tendrils, b.tendrils.length);
      falling = Math.max(falling, s.systems.rocks!.falling.length);
    });
    expect(modes.has('sweepWindup')).toBe(true);
    expect(locked).toBe(true);
    expect(tendrils).toBeGreaterThan(0);
    expect(falling).toBeGreaterThan(0);
  });

  it('draws the Mad Dash: ledges, the collapse front, the closing gates', { timeout: 120_000 }, async () => {
    let frontSeen = false;
    let closing = false;
    await drive(madDash, landerDashPilot({ route: MADDASH_ROUTE }), 75, (_fx, s) => {
      frontSeen ||= s.systems.killFront!.fronts[0]!.active;
      closing ||= s.systems.doors!.doors.some((d) => d.phase === 'closing');
    });
    expect(frontSeen).toBe(true);
    expect(closing).toBe(true);
  });

  it('is not built for levels without S7 systems', async () => {
    const s = await LevelSession.create(vaults);
    expect(S7LevelFx.wanted(s)).toBe(false);
    s.destroy();
  });
});
