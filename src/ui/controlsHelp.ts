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

/** Cache key for a rendered help card: content AND the theme border it was drawn with. */
export function helpCardKey(mode: VesselMode, touch: boolean, start: boolean, border: number, swap = false): string {
  return `${mode}|${touch}|${start}|${border.toString(16)}|${swap}`;
}

/** `start` = the level-start card (the level waits for the first input). `swap` = touch engine buttons swapped (S9). */
export function helpCard(mode: VesselMode, touch: boolean, start = true, swap = false): HelpCard {
  const touchLines = touch && swap && mode === 'lander' ? TOUCH_LANDER_SWAPPED : TOUCH[mode];
  return {
    title: TITLE[mode],
    lines: [...(touch ? touchLines : KEYS[mode]), touch ? 'II  PAUSE' : 'ESC / P   PAUSE'],
    hint: start ? (touch ? 'TOUCH ANY CONTROL TO START' : 'PRESS ANY CONTROL TO START') : touch ? 'TAP TO CLOSE' : 'ANY KEY TO CLOSE',
  };
}

/**
 * Any control in a frame counts as "first input". Aim counts only from keys
 * or a touch drag (aimTarget === null): a mouse merely hovering over the
 * canvas always reports an aim and must not dismiss the card.
 */
export function frameHasInput(f: InputFrame): boolean {
  const aimed = (f.aim.x !== 0 || f.aim.y !== 0) && f.aimTarget === null;
  return f.thrust || f.engineLeft || f.engineRight || f.topLeft || f.topRight || f.rotateCW || f.rotateCCW || f.fire || f.release || f.reelIn || f.reelOut || aimed;
}

