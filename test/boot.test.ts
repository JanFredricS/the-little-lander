import { describe, expect, it } from 'vitest';
import { bootActions } from '../src/shell/boot';
import { transition, INITIAL_STATE } from '../src/shell/state';
import type { ScreenState } from '../src/contracts';

const run = (q: string): ScreenState =>
  [{ type: 'booted' } as const, ...bootActions(new URLSearchParams(q))].reduce<ScreenState>((s, a) => transition(s, a), INITIAL_STATE);

describe('boot actions', () => {
  it('root URL boots to the title screen', () => {
    expect(bootActions(new URLSearchParams(''))).toEqual([]);
    expect(run('')).toEqual({ id: 'title' });
    expect(run('?screen=title')).toEqual({ id: 'title' });
  });

  it('?level=<id> / mapN jumps straight into that level', () => {
    expect(run('?level=testpad')).toEqual({ id: 'playing', levelId: 'testpad' });
    expect(run('?level=map2')).toEqual({ id: 'playing', levelId: 'descent' });
  });

  it('an unknown level falls back to the title', () => {
    expect(run('?level=nope')).toEqual({ id: 'title' });
    expect(run('?level=')).toEqual({ id: 'title' });
  });
});
