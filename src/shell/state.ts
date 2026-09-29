/**
 * Screen state machine (contracts/screens.ts). Pure transition function:
 * invalid actions leave the state unchanged (same object).
 */

import type { ScreenAction, ScreenState } from '../contracts';

export const INITIAL_STATE: ScreenState = { id: 'boot' };

export function transition(state: ScreenState, action: ScreenAction): ScreenState {
  switch (state.id) {
    case 'boot':
      return action.type === 'booted' ? { id: 'title' } : state;
    case 'title':
      return action.type === 'start' ? { id: 'levelSelect' } : state;
    case 'levelSelect':
      if (action.type === 'back') return { id: 'title' };
      if (action.type === 'selectLevel') {
        const playing: ScreenState = { id: 'playing', levelId: action.levelId };
        return action.cutsceneBefore ? { id: 'cutscene', cutsceneId: action.cutsceneBefore, then: playing } : playing;
      }
      return state;
    case 'cutscene':
      return action.type === 'cutsceneDone' ? state.then : state;
    case 'playing':
      if (action.type === 'pause') return { id: 'paused', levelId: state.levelId };
      if (action.type === 'levelEnded') return { id: 'results', levelId: state.levelId, outcome: action.outcome };
      if (action.type === 'retry') return { id: 'playing', levelId: state.levelId };
      return state;
    case 'paused':
      if (action.type === 'resume' || action.type === 'pause') return { id: 'playing', levelId: state.levelId };
      if (action.type === 'retry') return { id: 'playing', levelId: state.levelId };
      if (action.type === 'quit') return { id: 'levelSelect' };
      return state;
    case 'results':
      if (action.type === 'retry') return { id: 'playing', levelId: state.levelId };
      if (action.type === 'back') return { id: 'levelSelect' };
      if (action.type === 'continue') {
        const next: ScreenState = action.next ? { id: 'playing', levelId: action.next } : { id: 'levelSelect' };
        return action.cutsceneAfter ? { id: 'cutscene', cutsceneId: action.cutsceneAfter, then: next } : next;
      }
      return state;
  }
}


/** True when the transition resumes an existing level session (the App keeps the world alive). */
export function isResume(from: ScreenState, action: ScreenAction, to: ScreenState): boolean {
  return (from.id === 'playing' && to.id === 'paused') || (from.id === 'paused' && to.id === 'playing' && action.type !== 'retry');
}
