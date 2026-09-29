import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame } from '../src/contracts';
import { LevelSession } from '../src/game/session';
import { testpad } from '../src/levels/testpad';
import { emptyFrame } from '../src/shell/input';

const idle = emptyFrame();
const thrust: InputFrame = { ...emptyFrame(), thrust: true };

async function session() {
  const s = await LevelSession.create(testpad);
  const events: GameEvent[] = [];
  s.on((e) => events.push(e));
  s.start();
  return { s, events };
}

describe('testpad session (end to end, headless)', () => {
  it('the vessel falls under gravity and lands softly', async () => {
    const { s, events } = await session();
    const y0 = s.state.pos.y;
    for (let i = 0; i < 20; i++) s.step(idle);
    expect(s.state.pos.y).toBeGreaterThan(y0);
    for (let i = 0; i < 600; i++) s.step(idle);
    expect(s.state.landed).toBe(true);
    expect(s.state.crashed).toBe(false);
    expect(events.some((e) => e.type === 'levelStarted')).toBe(true);
    expect(events.some((e) => e.type === 'softLand')).toBe(true);
    s.destroy();
  });

  it('thrust lifts the vessel and burns fuel; the camera follows', async () => {
    const { s, events } = await session();
    for (let i = 0; i < 600; i++) s.step(idle); // settle on the ground
    const y0 = s.state.pos.y;
    const cam0 = s.camera.position.y;
    for (let i = 0; i < 90; i++) s.step(thrust);
    expect(s.state.pos.y).toBeLessThan(y0 - 30);
    expect(s.state.fuel).toBeLessThan(1);
    expect(s.state.engines.main).toBe(true);
    expect(s.camera.position.y).toBeLessThan(cam0);
    expect(events.some((e) => e.type === 'enginesChanged' && e.main)).toBe(true);
    s.destroy();
  });

  it('is deterministic for the same input sequence', async () => {
    const trace = async () => {
      const { s } = await session();
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        s.step(i % 7 < 3 ? thrust : { ...idle, rotateCW: i % 50 < 10 });
        out.push(s.state.pos.x, s.state.pos.y, s.state.angle);
      }
      s.destroy();
      return out;
    };
    expect(await trace()).toEqual(await trace());
  });

  it('flying out of the world is a crash that ends the level', async () => {
    const { s, events } = await session();
    s.physics.setTransform(s.vessel.body, { x: -10, y: 10 }, 0);
    s.step(idle);
    expect(s.state.crashed).toBe(true);
    expect(s.outcome).toEqual({ kind: 'failed', cause: 'outOfBounds' });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['crash', 'levelFailed']));
    s.destroy();
  });

  it('landing on the exit pad completes the level', async () => {
    const { s, events } = await session();
    const exit = testpad.entities.find((e) => e.kind === 'exitDock')!;
    s.physics.setTransform(s.vessel.body, { x: exit.x / 30, y: (exit.y - 20) / 30 }, 0);
    for (let i = 0; i < 300 && !s.outcome; i++) s.step(idle);
    expect(s.outcome?.kind).toBe('complete');
    expect(events.some((e) => e.type === 'objectiveComplete')).toBe(true);
    expect(events.some((e) => e.type === 'levelComplete')).toBe(true);
    s.destroy();
  });
});
