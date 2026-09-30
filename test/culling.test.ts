/**
 * S8 render culling: FlightView (beacon sites, pickups, radiation, debris,
 * goo, rope) and S7LevelFx (rocks, keeper pieces, chunks, ledges) only take
 * sprites from their pools for what overlaps the view (+ margin). The
 * same frame is rendered twice: once with the real view origin and once
 * with an origin far from everything, which must draw nothing. Textures are
 * stubbed as in s7.render.test.ts, since Pixi Graphics works headless.
 * EntityView (doors, islands, vines, creatures) is culled the same way, and
 * LevelView puts `foreground` props above the vessel layer.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Texture } from 'pixi.js';
import type { ArtApi, Vec2 } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { floatingIsles } from '../src/levels/floatingIsles';
import { hangarRun } from '../src/levels/hangarRun';
import { hollow } from '../src/levels/hollow';
import { keeper } from '../src/levels/keeper';
import { vaults } from '../src/levels/vaults';
import { EntityView } from '../src/render/entityView';
import { FlightView } from '../src/render/flightView';
import { LevelView } from '../src/render/levelView';
import { ropePolyline, ropePolylineInto } from '../src/render/ropeLine';
import { S7LevelFx } from '../src/render/s7LevelFx';
import { harpoonPilot } from './support/s7Pilots';

// Terrain painting needs a real 2D canvas; stub it (not under test here).
vi.mock('../src/render/terrainView', async (orig) => {
  const { Container: C } = await import('pixi.js');
  return {
    ...(await orig<typeof import('../src/render/terrainView')>()),
    paintOutline: () => ({ canvas: { width: 200, height: 100 }, offset: { x: -100, y: -50 } }),
    TerrainView: class {
      readonly root = new C();
      update(): void {}
      destroy(): void {}
    },
  };
});

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

  it('FlightView builds beacon columns, radiation glows and chevron patterns once: frames only move / fade them', async () => {
    for (const spec of [floatingIsles, hollow]) {
      const s = await LevelSession.create(spec);
      s.start();
      const fv = new FlightView(s, art);
      const calls = { rect: 0, circle: 0, fill: 0, poly: 0 };
      const spies = (Object.keys(calls) as (keyof typeof calls)[]).map((k) =>
        vi.spyOn(Graphics.prototype, k).mockImplementation(function (this: Graphics) {
          calls[k]++;
          return this;
        }),
      );
      for (let i = 0; i < 30; i++) {
        s.step({ thrust: false, engineLeft: false, engineRight: false, topLeft: false, topRight: false, rotateCW: false, rotateCCW: false, aim: { x: 0, y: 0 }, aimTarget: null, fire: false, release: false, reelIn: false, reelOut: false, pause: false });
        fv.render(1, i * 16.7, null); // no culling: every site / emitter / zone is live
      }
      for (const sp of spies) sp.mockRestore();
      expect(calls, spec.id).toEqual({ rect: 0, circle: 0, fill: 0, poly: 0 });
      fv.destroy();
      s.destroy();
    }
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

  it('EntityView: vines, doors, islands and creatures are culled for a far view', async () => {
    for (const spec of [floatingIsles, hangarRun]) {
      const s = await LevelSession.create(spec);
      s.start();
      const ev = new EntityView(s, art);
      const priv = ev as unknown as {
        doors: { visible: boolean }[];
        islands: { sprite: { visible: boolean } }[];
        creatures: { sprite: { visible: boolean } | null }[];
      };
      const rt = s.runtime;
      const counts = { moveTo: 0, circle: 0 };
      const spies = (Object.keys(counts) as (keyof typeof counts)[]).map((k) =>
        vi.spyOn(Graphics.prototype, k).mockImplementation(function (this: Graphics) {
          counts[k]++;
          return this;
        }),
      );
      try {
        // near each kind of entity it is drawn
        if (rt.vines.vines.length) {
          ev.render(1, viewAround(rt.vines.vines[0]!.entity), 0);
          expect(counts.moveTo, spec.id).toBeGreaterThan(0);
        }
        if (rt.doors.doors.length) {
          ev.render(1, viewAround(rt.doors.doors[0]!.pos), 0);
          expect(priv.doors[0]!.visible, spec.id).toBe(true);
        }
        if (rt.islands.islands.length) {
          ev.render(1, viewAround(rt.islands.islands[0]!.pos), 0);
          expect(priv.islands[0]!.sprite.visible, spec.id).toBe(true);
        }
        // far away: no vine link draws, every sprite hidden
        counts.moveTo = 0;
        counts.circle = 0;
        ev.render(1, FAR, 0);
        expect(counts, spec.id).toEqual({ moveTo: 0, circle: 0 });
        for (const d of priv.doors) expect(d.visible).toBe(false);
        for (const i of priv.islands) expect(i.sprite.visible).toBe(false);
        for (const c of priv.creatures) if (c.sprite) expect(c.sprite.visible).toBe(false);
      } finally {
        for (const sp of spies) sp.mockRestore();
      }
      expect(rt.vines.vines.length + rt.doors.doors.length + rt.islands.islands.length, spec.id).toBeGreaterThan(0);
      ev.destroy();
      s.destroy();
    }
  });

  it('LevelView: foreground props render above the vessel layer, normal props below it', async () => {
    const s = await LevelSession.create(vaults);
    s.start();
    const levelArt = {
      ...art,
      palettes: new Proxy({}, { get: () => ({ background: 0 }) }),
      getBackdropLayers: () => [],
    } as unknown as ArtApi;
    const lv = new LevelView(s, levelArt);
    const priv = lv as unknown as { world: Container; props: Map<string, Container>; flight: { over: Container } };
    const fgSpec = vaults.entities.find((e) => e.kind === 'staticProp' && e.foreground)!;
    const bgSpec = vaults.entities.find((e) => e.kind === 'staticProp' && !e.foreground && !e.dynamic)!;
    const layerIndex = (id: string): number => {
      let c: Container = priv.props.get(id)!;
      while (c.parent !== priv.world) c = c.parent!;
      return priv.world.getChildIndex(c);
    };
    const vessel = priv.world.getChildIndex(priv.flight.over);
    expect(layerIndex(fgSpec.id)).toBeGreaterThan(vessel);
    expect(layerIndex(bgSpec.id)).toBeLessThan(vessel);
    // both layers stay culled per frame
    lv.render(1, 0, false);
    const fg = priv.props.get(fgSpec.id)!;
    const staticProps = (lv as unknown as { staticProps: { sprite: Container }[] }).staticProps;
    expect(staticProps.some((p) => p.sprite === fg)).toBe(true);
    lv.destroy();
    s.destroy();
  });
});
