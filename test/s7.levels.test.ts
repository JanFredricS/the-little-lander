/**
 * LevelSpec design-rule tests for maps 5-8 (S7).
 */

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/contracts';
import { LEVELS } from '../src/levels/registry';
import { s7YAt } from '../src/levels/s7Helpers';
import { validateLevel } from '../src/levels/validate';
import { VAULTS_CEILING, VAULTS_GROUND, VAULTS_HOLES, VAULTS_ROUTE, VAULTS_SECTION_B, vaults } from '../src/levels/vaults';
import { resolveTuning } from '../src/physics/tuning';

/** Densely resampled polyline (every `step` px of x). */
function sample(points: readonly Vec2[], step = 10): Vec2[] {
  const out: Vec2[] = [];
  for (let x = points[0]!.x; x <= points[points.length - 1]!.x; x += step) out.push({ x, y: s7YAt(points, x) });
  return out;
}

describe('S7 levels are registered and valid', () => {
  it.each(['vaults'] as const)('%s', (id) => {
    const spec = LEVELS[id];
    expect(spec).toBeDefined();
    expect(validateLevel(spec!)).toEqual([]);
  });
});

describe('map 5 — The Vaults', () => {
  const t = resolveTuning(vaults.physicsOverrides);
  const reach = t.harpoon.ropeRange - 30; // margin: aim + mount offset
  const roof = sample(VAULTS_CEILING).filter((p) => !VAULTS_HOLES.some(([a, b]) => p.x > a && p.x < b));
  const nearestRoof = (p: Vec2, ahead = false) => {
    let best = Infinity;
    for (const q of roof) {
      if (q.y >= p.y - 40) continue; // must be above
      if (ahead && q.x < p.x) continue;
      best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
    }
    return best;
  };

  it('anchorable roof ahead within harpoon range along the whole swing line', () => {
    const bad: number[] = [];
    for (let x = VAULTS_ROUTE.x0; x <= VAULTS_ROUTE.x1; x += 20) {
      const floor = Math.min(s7YAt(VAULTS_GROUND, x), 700);
      const roofHere = s7YAt(VAULTS_CEILING, x) > 100 ? s7YAt(VAULTS_CEILING, x) : 330;
      const line = { x, y: (floor + roofHere) / 2 + 40 }; // swing line: a bit below mid-height
      if (nearestRoof(line, true) > reach) bad.push(x);
    }
    expect(bad).toEqual([]);
  });

  it('section A: from every floor point the roof is in reach (no soft-lock in a pit)', () => {
    const bad: number[] = [];
    for (let x = 300; x < VAULTS_SECTION_B; x += 20) {
      const p = { x, y: s7YAt(VAULTS_GROUND, x) - 14 };
      if (nearestRoof(p) > reach) bad.push(x);
    }
    expect(bad).toEqual([]);
  });

  it('god-ray holes are narrower than a rope swing', () => {
    for (const [a, b] of VAULTS_HOLES) expect(b - a).toBeLessThan(reach);
  });

  it('paying out rope onto a floor is gentle: reelOutSpeed < damageSpeed', () => {
    expect(t.harpoon.reelOutSpeed).toBeLessThan(t.harpoon.damageSpeed);
  });

  it('is ~14k px of harpoon cave with brittle stretches, debris rains and a camp to land at', () => {
    expect(vaults.worldSize.w).toBeGreaterThanOrEqual(13000);
    expect(vaults.vesselMode).toBe('harpoon');
    expect(vaults.zones.filter((z) => z.kind === 'brittleRegion').length).toBeGreaterThanOrEqual(2);
    expect(vaults.entities.filter((e) => e.kind === 'debrisSpawner')).toHaveLength(2);
    expect(vaults.entities.filter((e) => e.kind === 'staticProp' && e.sprite === 'prop.bioParticle').length).toBeGreaterThan(40);
    const camp = vaults.entities.find((e) => e.kind === 'exitDock');
    expect(camp).toMatchObject({ requireLanding: true });
  });
});
