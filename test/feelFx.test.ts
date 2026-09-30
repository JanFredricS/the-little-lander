/**
 * S8 feel layer: shake is capped, whole-pixel and decays; reduced motion
 * turns shake + hit flash off; particles are pooled (bounded) and freeze
 * while paused. Runs headless on a real LevelSession (sprite textures stubbed).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import type { ArtApi, GameEvent } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { testpad } from '../src/levels/testpad';
import { FeelFx, HIT_FLASH_SEC, SHAKE_MAX_PX } from '../src/render/feelFx';
import { SpriteTextures } from '../src/render/spritePool';

const art = { getSprite: () => ({ canvas: {}, width: 8, height: 8, pivot: { x: 4, y: 4 } }), getSpriteFrameCount: () => 4 } as unknown as ArtApi;

beforeAll(() => {
  vi.spyOn(Texture, 'from').mockImplementation(() => Texture.WHITE);
});
afterAll(() => vi.restoreAllMocks());

const crash: GameEvent = { type: 'crash', cause: 'impact', pos: { x: 100, y: 100 }, speed: 400 };
const hit: GameEvent = { type: 'hullChanged', hull: 0.7, delta: -0.3, reason: 'impact' };

async function make(reducedMotion = false) {
  const s = await LevelSession.create(testpad);
  const fx = new FeelFx(s, new SpriteTextures(art, testpad.themeId), { reducedMotion });
  return { s, fx };
}

describe('FeelFx', () => {
  it('shake is capped, whole-pixel, and decays to zero', async () => {
    const { s, fx } = await make();
    fx.update(0, false);
    for (let i = 0; i < 5; i++) fx.onEvent(crash);
    expect(fx.traumaLevel).toBe(1);
    let maxAbs = 0;
    for (let t = 16; t < 400; t += 16) {
      fx.update(t, false);
      const { x, y } = fx.shake;
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    }
    expect(maxAbs).toBeGreaterThan(0);
    expect(maxAbs).toBeLessThanOrEqual(SHAKE_MAX_PX);
    for (let t = 400; t < 1400; t += 16) fx.update(t, false);
    expect(fx.shake).toEqual({ x: 0, y: 0 });
    fx.destroy();
    s.destroy();
  });

  it('hull damage flashes briefly; reduced motion disables flash and shake', async () => {
    const a = await make();
    a.fx.update(0, false);
    a.fx.onEvent(hit);
    expect(a.fx.flashing).toBe(true);
    for (let t = 16; t <= HIT_FLASH_SEC * 1000 + 32; t += 16) a.fx.update(t, false);
    expect(a.fx.flashing).toBe(false);
    const b = await make(true);
    b.fx.update(0, false);
    b.fx.onEvent(hit);
    b.fx.onEvent(crash);
    b.fx.update(16, false);
    expect(b.fx.flashing).toBe(false);
    expect(b.fx.shake).toEqual({ x: 0, y: 0 });
    expect(b.fx.particleCount).toBeGreaterThan(0); // particles stay: they are not motion sickness material
    for (const x of [a, b]) {
      x.fx.destroy();
      x.s.destroy();
    }
  });

  it('impacts spark + shake only at or above the active vessel\'s damageSpeed (safe landings just dust)', async () => {
    const { s, fx } = await make();
    const dmg = s.tuning[s.state.mode].damageSpeed;
    const impact = (speed: number): GameEvent => ({ type: 'impact', pos: { x: 0, y: 0 }, speed, with: 'terrain' });
    fx.update(0, false);
    fx.onEvent(impact(dmg - 1)); // a firm but safe touchdown
    fx.update(16, false);
    expect(fx.traumaLevel).toBe(0);
    const kinds = () => (fx as unknown as { parts: { live: boolean; kind: string }[] }).parts.filter((p) => p.live).map((p) => p.kind);
    expect(kinds().length).toBeGreaterThan(0);
    expect(kinds().every((k) => k === 'dust')).toBe(true);
    fx.onEvent(impact(dmg + 20)); // a damaging hit
    expect(fx.traumaLevel).toBeGreaterThan(0);
    expect(kinds()).toContain('spark');
    fx.destroy();
    s.destroy();
  });

  it('particles are pooled (bounded), freeze while paused and expire', async () => {
    const { s, fx } = await make();
    fx.update(0, false);
    for (let i = 0; i < 40; i++) fx.onEvent(crash);
    fx.onEvent({ type: 'softLand', pos: { x: 0, y: 0 } });
    fx.update(16, false);
    const n = fx.particleCount;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(96);
    expect(fx.layer.children.length).toBeLessThanOrEqual(96);
    fx.update(2000, true); // paused: no time passes
    expect(fx.particleCount).toBe(n);
    for (let t = 2016; t < 5000; t += 16) fx.update(t, false);
    expect(fx.particleCount).toBe(0);
    fx.destroy();
    s.destroy();
  });
});
