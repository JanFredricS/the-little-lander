/**
 * FROZEN (S0) contracts barrel. Every slice imports shared types from here:
 *
 *   import type { LevelSpec, InputFrame, PhysicsApi } from '../contracts';
 *
 * Contracts are types, documentation and a few constant tables — no logic.
 * Changing anything in src/contracts/ after S0 is STOP-THE-LINE (PROCESS.md):
 * pause dependent slices, amend contract + mocks, resume.
 *
 * Start with constants.ts (units & coordinate conventions).
 */

export * from './constants';
export * from './common';
export * from './art';
export * from './cutscene';
export * from './input';
export * from './physics';
export * from './events';
export * from './level';
export * from './save';
export * from './screens';
