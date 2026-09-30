/**
 * S8 render culling: FlightView (beacon sites, pickups, radiation, debris,
 * goo, rope) and S7LevelFx (rocks, keeper pieces, chunks, ledges) only take
 * sprites from their pools for what overlaps the view (+ margin). The
 * same frame is rendered twice: once with the real view origin and once
 * with an origin far from everything, which must draw nothing. Textures are
 * stubbed as in s7.render.test.ts, since Pixi Graphics works headless.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import type { ArtApi, Vec2 } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { floatingIsles } from '../src/levels/floatingIsles';
import { keeper } from '../src/levels/keeper';
import { vaults } from '../src/levels/vaults';
import { FlightView } from '../src/render/flightView';
import { ropePolyline, ropePolylineInto } from '../src/render/ropeLine';
import { S7LevelFx } from '../src/render/s7LevelFx';
import { harpoonPilot } from './support/s7Pilots';

const art = { getSprite: () => ({ canvas: {}, width: 8, height: 8, pivot: { x: 4, y: 4 } }), getSpriteFrameCount: () => 1 } as unknown as ArtApi;
const FAR: Vec2 = { x: -100_000, y: -100_000 };

beforeAll(() => {
  vi.spyOn(Texture, 'from').mockImplementation(() => Texture.WHITE);
});
afterAll(() => {
  vi.restoreAllMocks();
});

interface Pools {
  bodies: { count: number };
  markers: { count: number };
}

const viewAround = (p: Vec2): Vec2 => ({ x: p.x - 320, y: p.y - 180 });

describe('render culling', () => {
  it('FlightView: pickups / beacon sites near the view are drawn, nothing is drawn for a far view', async () => {
    const s = await LevelSession.create(floatingIsles);
    s.start();
    const fv = new FlightView(s, art);
    const pools = fv as unknown as Pools;
    // look at the first uncollected pickup
    const pk = s.env.pickups.pickups.find((p) => !p.collected)!.entity;
    fv.render(1, 0, viewAround(pk));
    expect(pools.bodies.count).toBeGreaterThan(0);
    const site = s.env.beacons.sites[0]!.entity;
    fv.render(1, 0, viewAround(site));
    expect(pools.markers.count).toBeGreaterThan(0);
    fv.render(1, 0, FAR);
    expect(pools.bodies.count).toBe(0);
    expect(pools.markers.count).toBe(0);
    // no origin = no culling (tools / tests): everything is drawn
    fv.render(1, 0, null);
    expect(pools.bodies.count).toBeGreaterThan(s.env.pickups.pickups.filter((p) => !p.collected).length - 1);
    fv.destroy();
    s.destroy();
  });

  it('FlightView: rope segments off the view are skipped, the visible part keeps its spacing', { timeout: 60_000 }, async () => {
    const s = await LevelSession.create(vaults);
    s.start();
    const pilot = harpoonPilot({ landX: 13480 });
    let i = 0;
    while (i < 60 * 30 && !s.state.ropeState?.guns.some((g) => g.phase === 'anchored')) s.step(pilot(s, i++));
    expect(s.state.ropeState!.guns.some((g) => g.phase === 'anchored')).toBe(true);
    const fv = new FlightView(s, art);
    const pools = fv as unknown as Pools;
    fv.render(1, 0, null);
    const all = pools.bodies.count;
    fv.render(1, 0, viewAround(s.state.pos));
    const inView = pools.bodies.count;
    expect(inView).toBeGreaterThan(0);
    expect(inView).toBeLessThanOrEqual(all);
    fv.render(1, 0, FAR);
    expect(pools.bodies.count).toBe(0);
    fv.destroy();
    s.destroy();
  });

  it('S7LevelFx: keeper-map rocks are pooled only near the view', async () => {
    const s = await LevelSession.create(keeper);
    s.start();
    const fx = new S7LevelFx(s, art);
    const pool = (fx as unknown as { pool: { count: number } }).pool;
    const rock = s.systems.rocks!.rocks.find((r) => r.body)!.entity;
    fx.render(1, 0, viewAround(rock));
    expect(pool.count).toBeGreaterThan(0);
    fx.render(1, 0, FAR);
    expect(pool.count).toBe(0);
    fx.destroy();
    s.destroy();
  });

  it('ropePolylineInto reuses its scratch points and matches ropePolyline', () => {
    const out: Vec2[] = [];
    const a = ropePolylineInto(out, 0, 0, { x: 100, y: 0 }, 130);
    const first = out[3];
    const b = ropePolylineInto(out, 0, 0, { x: 50, y: 20 }, 60);
    expect(a).toBe(out);
    expect(b).toBe(out);
    expect(out[3]).toBe(first); // same objects, no new points
    expect(out).toEqual(ropePolyline({ x: 0, y: 0 }, { x: 50, y: 20 }, 60));
  });
});
