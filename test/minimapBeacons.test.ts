/**
 * Round 10 (F): beacon sites on the minimap - one amber diamond per
 * plantBeacons site, edge-pinned with an arrow when out of the window like the
 * exit, solid until planted then hollow + dimmed. Markers are made once per
 * level; per frame they only move (no allocation, no redraw).
 */

import { describe, expect, it, vi } from 'vitest';
import type { LevelSpec } from '../src/contracts';
import { floatingIsles } from '../src/levels/floatingIsles';
import { LEVELS } from '../src/levels/registry';
import {
  createMinimapLayout,
  createMinimapMarker,
  MINIMAP_BEACON_COLOR,
  MINIMAP_EDGE_INSET,
  MINIMAP_H,
  MINIMAP_SCALE,
  MINIMAP_W,
  minimapLayout,
  minimapSiteMarker,
  MinimapView,
} from '../src/ui/minimap';
import { UI } from '../src/ui/uiTheme';

const site = (id: string) => floatingIsles.entities.find((e) => e.id === id)! as { x: number; y: number };

describe('minimap: beacon site marker math', () => {
  it('an in-range site lands at its world/16 offset from the vessel', () => {
    const l = minimapLayout(createMinimapLayout(), 2000, 300, 7000, 1400, null);
    const m = minimapSiteMarker(createMinimapMarker(), l, { x: 7200, y: 1500 });
    expect(m.inside).toBe(true);
    expect(m.x).toBeCloseTo(l.vx + 200 / MINIMAP_SCALE);
    expect(m.y).toBeCloseTo(l.vy + 100 / MINIMAP_SCALE);
  });

  it('an out-of-range site is pinned to the edge inset along the vessel -> site ray, with its arrow inside the window', () => {
    const l = createMinimapLayout();
    const m = createMinimapMarker();
    const I = MINIMAP_EDGE_INSET;
    minimapLayout(l, 2000, 300, 1600, 1600, null);
    minimapSiteMarker(m, l, { x: 1600 + 16 * 1000, y: 1600 });
    expect(m.inside).toBe(false);
    expect(m.x).toBeCloseTo(MINIMAP_W - I);
    expect(m.y).toBeCloseTo(l.vy);
    expect(m.angle).toBeCloseTo(0);
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * 2 * Math.PI;
      minimapSiteMarker(m, l, { x: 1600 + 1e5 * Math.cos(a), y: 1600 + 1e5 * Math.sin(a) });
      expect(m.inside).toBe(false);
      expect(Math.atan2(m.y - l.vy, m.x - l.vx)).toBeCloseTo(m.angle);
      for (const v of [m.x - 3, m.ax - 3]) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of [m.x + 3, m.ax + 3]) expect(v).toBeLessThanOrEqual(MINIMAP_W);
      for (const v of [m.y - 3, m.ay - 3]) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of [m.y + 3, m.ay + 3]) expect(v).toBeLessThanOrEqual(MINIMAP_H);
      expect((m.ax - m.x) * Math.cos(m.angle) + (m.ay - m.y) * Math.sin(m.angle)).toBeGreaterThan(0);
    }
  });

  it('its colour is not the exit green nor the vessel amber', () => {
    expect(MINIMAP_BEACON_COLOR).not.toBe(UI.ok);
    expect(MINIMAP_BEACON_COLOR).not.toBe(UI.accent);
  });
});

type Internal = { sites: { mark: { clear(): unknown }; arrow: unknown; m: unknown }[] };

describe('MinimapView: beacon sites', () => {
  it('one marker per plantBeacons site (any level: floatingIsles 5, physlab 2, none elsewhere); pinned ones show an arrow', () => {
    const view = new MinimapView();
    view.setLevel(floatingIsles);
    expect(view.siteMarkers.map((s) => s.id)).toEqual(['site1', 'site2', 'site3', 'site4', 'site5']);
    view.render(site('site1').x - 300, site('site1').y - 100, 0, 0, 0, 0xffffff);
    const near = view.siteMarkers.find((s) => s.id === 'site1')!;
    expect(near.inside).toBe(true);
    expect(near.arrow).toBe(false);
    const far = view.siteMarkers.find((s) => s.id === 'site5')!;
    expect(far.inside).toBe(false);
    expect(far.arrow).toBe(true);
    expect([far.x >= MINIMAP_EDGE_INSET - 0.5, far.x <= MINIMAP_W - MINIMAP_EDGE_INSET + 0.5]).toEqual([true, true]);
    view.setLevel(LEVELS.physlab! as LevelSpec);
    expect(view.siteMarkers.map((s) => s.id)).toEqual(['siteA', 'siteB']);
    view.setLevel(LEVELS.hangarRun! as LevelSpec);
    expect(view.siteMarkers).toEqual([]);
    view.destroy();
  });

  it('planting turns the marker hollow and dim, once; frames only move the reused marker objects', () => {
    const view = new MinimapView();
    view.setLevel(floatingIsles);
    const internal = (view as unknown as Internal).sites;
    const refs = internal.map((s) => [s.mark, s.arrow, s.m]);
    const clears = internal.map((s) => vi.spyOn(s.mark, 'clear'));
    for (let i = 0; i < 300; i++) view.render(6000 + i * 20, 1400, 0, 0, 0, 0xffffff);
    expect(clears.every((c) => c.mock.calls.length === 0)).toBe(true);
    expect(view.siteMarkers.every((s) => !s.planted && s.alpha === 1)).toBe(true);
    view.setPlanted('site2');
    for (let i = 0; i < 300; i++) view.render(9000 + i * 5, 1300, 0, 0, 0, 0xffffff);
    expect(clears.map((c) => c.mock.calls.length)).toEqual([0, 1, 0, 0, 0]);
    const s2 = view.siteMarkers.find((s) => s.id === 'site2')!;
    expect(s2.planted).toBe(true);
    expect(s2.alpha).toBeLessThan(1);
    expect(view.siteMarkers.filter((s) => s.planted).map((s) => s.id)).toEqual(['site2']);
    expect((view as unknown as Internal).sites.map((s) => [s.mark, s.arrow, s.m])).toEqual(refs);
    view.setPlanted('nope'); // unknown ids are ignored
    // a new level / retry starts unplanted again
    view.setLevel(floatingIsles);
    expect(view.siteMarkers.every((s) => !s.planted)).toBe(true);
    view.destroy();
  });
});
