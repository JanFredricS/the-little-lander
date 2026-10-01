/**
 * Per-mode controls help card content (keyboard/mouse and touch variants).
 * Keyboard text mirrors DEFAULT_BINDINGS in src/shell/input.ts.
 */

import type { InputFrame, VesselMode } from '../contracts';

export interface HelpCard {
  title: string;
  lines: readonly string[];
  hint: string;
}

const KEYS: Record<VesselMode, readonly string[]> = {
  csm: ['A / ←   ROTATE LEFT', 'D / →   ROTATE RIGHT', 'W / ↑ / SPACE   THRUST', 'PULSE THE THRUSTER - IT IS STRONG!'],
  lander: [
    'A / ← / J   LEFT ENGINE',
    'D / → / L   RIGHT ENGINE',
    'W / ↑ / K / SPACE   BOTH',
    'Q / U   TOP LEFT    E / O   TOP RIGHT',
    'ONE ENGINE TILTS YOU - PULSE TO STEER',
    'UPSIDE DOWN? TOP THRUSTERS FLIP YOU',
  ],
  harpoon: ['MOUSE / ARROWS   AIM', 'CLICK / SPACE   FIRE HARPOON', 'RIGHT CLICK / X   RELEASE', 'W / R   REEL IN    S / F   REEL OUT'],
  harpoonThrust: ['MOUSE / ARROWS   AIM', 'CLICK / SPACE   FIRE    X   RELEASE', 'W   THRUST    A / D   ROTATE', 'R   REEL IN    F   REEL OUT'],
};

const TOUCH: Record<VesselMode, readonly string[]> = {
  csm: ['◀ ▶ (LEFT THUMB)   ROTATE', 'THRUST (RIGHT THUMB)', 'TAP IT - SHORT BURNS!'],
  lander: ['L ENGINE: BOTTOM LEFT', 'R ENGINE: BOTTOM RIGHT', 'HOLD BOTH TO GO STRAIGHT UP', 'TOP L / TOP R: SMALL BUTTONS ABOVE', 'UPSIDE DOWN? TOP THRUSTERS FLIP YOU'],
  harpoon: ['DRAG ON THE LEFT TO AIM', 'FIRE / REL   HARPOON', '▲ IN  ▼ OUT   REEL THE ROPE'],
  harpoonThrust: ['DRAG ON THE LEFT TO AIM', 'FIRE / REL   HARPOON   ▲▼ REEL', '◀ ▶ ROTATE    THR   THRUST'],
};

const TITLE: Record<VesselMode, string> = {
  csm: 'CSM CONTROLS',
  lander: 'LANDER CONTROLS',
  harpoon: 'HARPOON CONTROLS',
  harpoonThrust: 'HARPOON + THRUST',
};

/** S9: touch lander card with the swapped engine buttons (the default). */
const TOUCH_LANDER_SWAPPED: readonly string[] = [
  'LEFT BUTTON FIRES THE RIGHT ENGINE:',
  'YOU TILT TOWARD THE BUTTON YOU PRESS',
  'HOLD BOTH TO GO STRAIGHT UP',
  'SMALL TOP BUTTONS: TOP THRUSTERS',
  'UPSIDE DOWN? TOP THRUSTERS FLIP YOU',
];

/** S9 (+ keyboard): lander keys with engines swapped (the default) - the left key fires the right engine. */
const KEYS_LANDER_SWAPPED: readonly string[] = [
  'A / ← / J   RIGHT ENGINE (TILT LEFT)',
  'D / → / L   LEFT ENGINE (TILT RIGHT)',
  'W / ↑ / K / SPACE   BOTH',
  'Q / U   TOP RIGHT    E / O   TOP LEFT',
  'ONE ENGINE TILTS YOU - PULSE TO STEER',
  'UPSIDE DOWN? TOP THRUSTERS FLIP YOU',
];

/**
 * DIRECT steering (Settings.steering = 'direct'): cards for the modes it drives (src/shell/directSteering.ts).
 * Keyboard: lander only (rotate + thrust). The CSM keeps its classic keys in DIRECT (Descent on a
 * keyboard is the ENGINE scheme in both settings), so its keyboard card is the normal one.
 */
const DIRECT_KEYS: Partial<Record<VesselMode, readonly string[]>> = {
  lander: ['A / ←   ROTATE LEFT', 'D / →   ROTATE RIGHT', 'W / ↑ / SPACE   THRUST', 'S / ↓   TOP THRUSTERS (PUSH DOWN)', 'LET GO TO COAST'],
};
const DIRECT_TOUCH: Partial<Record<VesselMode, readonly string[]>> = {
  lander: ['HOLD ANYWHERE: THRUST TOWARD FINGER', 'THE LANDER TURNS ITSELF TO PUSH', 'BELOW THE SHIP: TOP THRUSTERS', 'LET GO TO COAST'],
  csm: ['HOLD ANYWHERE: THRUST TOWARD FINGER', 'THE CSM TURNS, THEN BURNS', 'LET GO TO COAST'],
};

/** JOYSTICK steering (round 8): the virtual stick bottom-left drives the DIRECT layer. */
const JOYSTICK_TOUCH: Partial<Record<VesselMode, readonly string[]>> = {
  lander: ['LEFT STICK: THRUST THAT WAY', 'THE LANDER TURNS ITSELF TO PUSH', 'STICK DOWN: TOP THRUSTERS', 'CENTRE OR LET GO TO COAST'],
  csm: ['LEFT STICK: THRUST THAT WAY', 'THE CSM TURNS, THEN BURNS', 'CENTRE OR LET GO TO COAST'],
};
const JOYSTICK_MOUSE = 'MOUSE: DRAG THE STICK (BOTTOM LEFT)';

/** Cache key for a rendered help card: content AND the theme border it was drawn with. */
export function helpCardKey(mode: VesselMode, touch: boolean, start: boolean, border: number, swap = false, direct = false, joystick = false): string {
  return `${mode}|${touch}|${start}|${border.toString(16)}|${swap}|${direct}|${joystick}`;
}

/**
 * `start` = the level-start card (the level waits for the first input). `swap` = engine buttons/keys swapped (S9).
 * `direct` = DIRECT steering (modes it does not drive keep their normal card; swap does not apply to it).
 */
export function helpCard(mode: VesselMode, touch: boolean, start = true, swap = false, direct = false, joystick = false): HelpCard {
  if (joystick && JOYSTICK_TOUCH[mode]) {
    // touch: the stick; keyboard: the DIRECT keys (the CSM keeps its classic ones) + the mouse-draggable stick
    const lines = touch ? JOYSTICK_TOUCH[mode]! : [...(DIRECT_KEYS[mode] ?? KEYS[mode]), JOYSTICK_MOUSE];
    return {
      title: `${TITLE[mode]} (JOYSTICK)`,
      lines: [...lines, touch ? 'II  PAUSE    ↻  RESTART' : 'ESC / P   PAUSE    BKSP   RESTART'],
      hint: start ? (touch ? 'TOUCH ANY CONTROL TO START' : 'PRESS ANY CONTROL TO START') : touch ? 'TAP TO CLOSE' : 'ANY KEY TO CLOSE',
    };
  }
  const directLines = direct ? (touch ? DIRECT_TOUCH[mode] : DIRECT_KEYS[mode]) : undefined;
  const touchLines = directLines ?? (touch && swap && mode === 'lander' ? TOUCH_LANDER_SWAPPED : TOUCH[mode]);
  const keyLines = directLines ?? (swap && mode === 'lander' ? KEYS_LANDER_SWAPPED : KEYS[mode]);
  return {
    title: directLines ? `${TITLE[mode]} (DIRECT)` : TITLE[mode],
    lines: [...(touch ? touchLines : keyLines), touch ? 'II  PAUSE    ↻  RESTART' : 'ESC / P   PAUSE    BKSP   RESTART'],
    hint: start ? (touch ? 'TOUCH ANY CONTROL TO START' : 'PRESS ANY CONTROL TO START') : touch ? 'TAP TO CLOSE' : 'ANY KEY TO CLOSE',
  };
}

/**
 * Any control in a frame counts as "first input" (a DIRECT steer too). Aim counts only from keys
 * or a touch drag (aimTarget === null): a mouse merely hovering over the
 * canvas always reports an aim and must not dismiss the card.
 */
export function frameHasInput(f: InputFrame): boolean {
  const aimed = (f.aim.x !== 0 || f.aim.y !== 0) && f.aimTarget === null;
  return f.steer.x !== 0 || f.steer.y !== 0 || f.thrust || f.engineLeft || f.engineRight || f.topLeft || f.topRight || f.rotateCW || f.rotateCCW || f.fire || f.release || f.reelIn || f.reelOut || aimed;
}

