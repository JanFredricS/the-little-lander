/**
 * S7 render layer smoke test: S7LevelFx draws every S7 system's state
 * (Keeper + tendrils + sweep telegraph, rocks, slam debris, crumbling ledges,
 * the collapse front, map 5 darkness) frame after frame of a real piloted run
 * without throwing. Pixi Graphics works headless; sprite textures (which
 * need a real canvas) are stubbed.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import type { ArtApi, LevelSpec } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { keeper } from '../src/levels/keeper';
import { MADDASH_ROUTE, madDash } from '../src/levels/madDash';
import { testpad } from '../src/levels/testpad';
import { VAULTS_SECTION_B, vaults } from '../src/levels/vaults';
import { S7LevelFx, s7DarknessAt } from '../src/render/s7LevelFx';
import type { Pilot } from './support/s7Harness';
import { keeperPilot, landerDashPilot } from './support/s7Pilots';

const art = { getSprite: () => ({ canvas: {}, width: 8, height: 8, pivot: { x: 4, y: 4 } }), getSpriteFrameCount: () => 1 } as unknown as ArtApi;

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
      fx.render(0.5, i * 16.7, { x: s.state.pos.x - 320, y: s.state.pos.y - 180 }); // view follows the vessel (culling)
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
      closing ||= s.runtime.doors.doors.some((d) => d.phase === 'closing');
    });
    expect(frontSeen).toBe(true);
    expect(closing).toBe(true);
  });

  it('map 5 darkness deepens through Section B (overlay alpha start vs end)', async () => {
    const start = s7DarknessAt(vaults, VAULTS_SECTION_B);
    const mid = s7DarknessAt(vaults, (VAULTS_SECTION_B + 13300) / 2);
    const end = s7DarknessAt(vaults, 13300);
    expect(s7DarknessAt(vaults, 3000)).toBe(0); // section A untouched
    expect(start).toBeLessThan(0.02);
    expect(mid).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(mid);
    expect(end).toBeGreaterThanOrEqual(0.5);
    expect(end).toBeLessThanOrEqual(0.65); // browser-playtested cap: route stays readable
    // the live layer follows the vessel and draws glow halos
    const s = await LevelSession.create(vaults);
    expect(S7LevelFx.wanted(s)).toBe(true);
    const fx = new S7LevelFx(s, art);
    fx.render(0, 0);
    expect(fx.darkness).toBe(s7DarknessAt(vaults, s.state.pos.x));
    (s.state.pos as { x: number }).x = 13000;
    fx.render(0, 0);
    expect(fx.darkness).toBeCloseTo(end, 5);
    fx.destroy();
    s.destroy();
  });

  it('is not built for levels without S7 systems', async () => {
    const s = await LevelSession.create(testpad);
    expect(S7LevelFx.wanted(s)).toBe(false);
    s.destroy();
  });
});
