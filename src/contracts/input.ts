/**
 * FROZEN (S0; S9 amendment: topLeft / topRight controls). Input: the per-tick InputFrame (pure, device-agnostic data)
 * and the InputSource plug-in interface that keyboard, mouse/pointer and
 * on-screen touch controls all implement. The game is first-class on BOTH
 * desktop and mobile browsers: every control must be reachable by touch.
 *
 * Pipeline: InputSource[] --(src/shell/input.ts InputMapper, once per fixed
 * step)--> InputFrame --> VesselController.applyInput().
 *
 * Sampling rules (implemented by the mapper, relied on by controllers):
 *  - One InputFrame is produced per FIXED step, before that step runs.
 *  - HELD fields are true while the control is down in ANY source, AND for at
 *    least one tick after any press, even a press+release shorter than a
 *    tick. (Pulsed burns are the core CSM skill: a tap must always burn one
 *    tick.)
 *  - EDGE fields (fire, release, pause) are true on exactly ONE tick per press.
 *  - When the loop runs several catch-up steps in one frame, only the first
 *    step sees edges; held state repeats.
 *  - On pause / blur / visibility loss every source is cleared.
 *
 * Every field is always present. Controllers read only what their mode uses.
 * Sources speak in SEMANTIC controls (ControlId); keyboard sources resolve
 * physical keys through the ACTIVE VesselMode's bindings (so e.g. the left
 * arrow is rotateCCW in CSM mode but engineLeft in lander mode).
 *
 * ON-SCREEN TOUCH CONTROLS (built by the UI slice as an InputSource):
 *  - Every touch target is at least 48 CSS px in both dimensions (≈48 dp /
 *    ≈9 mm physical), measured in CSS pixels, NEVER in virtual 640×360
 *    view pixels (whose size varies with the integer scale).
 *  - Targets sit inside the safe area (env(safe-area-inset-*)).
 *  - Multi-touch: each button tracks its own pointerId; sliding off a
 *    button releases it; pointercancel releases everything it held.
 */

import type { Vec2 } from './common';
import type { VesselMode } from './physics';

export interface InputFrame {
  /** HELD. Main thruster (CSM / "both engines" in lander modes). */
  thrust: boolean;
  /** HELD. Left engine (left of centre -> pushes left side up -> clockwise torque). */
  engineLeft: boolean;
  /** HELD. Right engine. */
  engineRight: boolean;
  /**
   * HELD. Top-left thruster (S9 amendment, lander mode): mounted on the top
   * of the vessel, left of centre, pushing along the body's DOWN axis
   * (opposite to the main pair), so an inverted lander can lift off and
   * flip upright with differential pulses.
   */
  topLeft: boolean;
  /** HELD. Top-right thruster (S9 amendment, lander mode). */
  topRight: boolean;
  /** HELD. Rotate clockwise (CSM mode). */
  rotateCW: boolean;
  /** HELD. Rotate counter-clockwise (CSM mode). */
  rotateCCW: boolean;
  /**
   * Harpoon aim direction: unit vector in world space (y-down), or {0,0}
   * when there is no aim input. From arrow keys (8-way), the mouse (vessel
   * -> pointer), or a touch drag (drag start -> current). Normalised when
   * non-zero.
   */
  aim: Vec2;
  /** Mouse pointer in WORLD px when a hovering pointer is the aim source, else null. */
  aimTarget: Vec2 | null;
  /** EDGE. Fire harpoon. */
  fire: boolean;
  /** EDGE. Release (detach) the harpoon rope. */
  release: boolean;
  /** HELD. Reel rope in (shorten). */
  reelIn: boolean;
  /** HELD. Reel rope out (lengthen). */
  reelOut: boolean;
  /** EDGE. Toggle pause (handled by the shell, not by controllers). */
  pause: boolean;
}

/** Semantic digital controls, 1:1 with InputFrame's boolean fields. */
export type ControlId =
  | 'thrust'
  | 'engineLeft'
  | 'engineRight'
  | 'topLeft'
  | 'topRight'
  | 'rotateCW'
  | 'rotateCCW'
  | 'fire'
  | 'release'
  | 'reelIn'
  | 'reelOut'
  | 'pause';

/** Controls whose InputFrame field is an EDGE (one tick per press). The rest are HELD. */
export type EdgeControlId = 'fire' | 'release' | 'pause';

export type ControlFlags = Partial<Record<ControlId, boolean>>;

/** Aim reported by one source. */
export interface AimSample {
  /** World-space direction (need not be normalised; zero = no aim). */
  dir: Vec2;
  /** World px target (hovering mouse) or null (keys / touch drag). */
  target: Vec2 | null;
}

/** What one source reports for one fixed tick. */
export interface InputSourceSample {
  /** Controls down right now. */
  down: ControlFlags;
  /**
   * Controls that went down since the previous sample (latched, then
   * consumed by this sample) — even if already released again.
   */
  pressed: ControlFlags;
  /** Aim, or null when this source has no aim opinion this tick. */
  aim: AimSample | null;
}

/** Context the mapper hands every source when sampling. */
export interface InputSampleContext {
  /** Active vessel mode (keyboard bindings depend on it). */
  mode: VesselMode;
  /** Vessel centre in world px, or null when there is no vessel (menus). */
  vesselWorldPos: Vec2 | null;
  /** Converts a CLIENT (CSS px, relative to the viewport) point to world px. */
  clientToWorld(clientX: number, clientY: number): Vec2;
}

/**
 * A pluggable input device. Implementations: keyboard + mouse (S0, in
 * src/shell/input.ts), on-screen touch controls (UI slice). Sources are
 * merged by the mapper: controls OR together; the aim comes from the FIRST
 * source in registration order that reports a non-null aim with a non-zero
 * dir.
 */
export interface InputSource {
  readonly id: string;
  /** Sample (and consume latched presses) for one tick. */
  sample(ctx: InputSampleContext): InputSourceSample;
  /** Forget all state (pause, blur, visibility loss, screen change). */
  clear(): void;
  /** Remove DOM listeners. */
  dispose(): void;
}
