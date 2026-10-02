/**
 * Per-mode controls help card content (keyboard/mouse and touch variants).
 * Keyboard text mirrors DEFAULT_BINDINGS in src/shell/input.ts.
 */

import type { InputFrame, ObjectiveSpec, VesselMode } from '../contracts';

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
  spring: ['A / ←  D / →   AIM THE JUMP', 'HOLD W / ↑ / SPACE   CHARGE THE SPRINGS', 'LET GO TO JUMP    S / ↓   CANCEL', 'NO CONTROL IN THE AIR - WATCH THE DOTS'],
};

const TOUCH: Record<VesselMode, readonly string[]> = {
  csm: ['◀ ▶ (LEFT THUMB)   ROTATE', 'THRUST (RIGHT THUMB)', 'TAP IT - SHORT BURNS!'],
  lander: ['L ENGINE: BOTTOM LEFT', 'R ENGINE: BOTTOM RIGHT', 'HOLD BOTH TO GO STRAIGHT UP', 'TOP L / TOP R: SMALL BUTTONS ABOVE', 'UPSIDE DOWN? TOP THRUSTERS FLIP YOU'],
  harpoon: ['DRAG ON THE LEFT TO AIM', 'FIRE / REL   HARPOON', '▲ IN  ▼ OUT   REEL THE ROPE'],
  harpoonThrust: ['DRAG ON THE LEFT TO AIM', 'FIRE / REL   HARPOON   ▲▼ REEL', '◀ ▶ ROTATE    THR   THRUST'],
  spring: ['◀ ▶   AIM THE JUMP', 'HOLD JUMP TO CHARGE, LET GO TO JUMP', '✕   CANCEL THE CHARGE', 'NO CONTROL IN THE AIR - WATCH THE DOTS'],
};

const TITLE: Record<VesselMode, string> = {
  csm: 'CSM CONTROLS',
  lander: 'LANDER CONTROLS',
  harpoon: 'HARPOON CONTROLS',
  harpoonThrust: 'HARPOON + THRUST',
  spring: 'SPRING LEGS',
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
  // round 15 (audit L5): the keys + the DIRECT pointer (drag from the ship: direction = aim, distance = charge)
  spring: ['A / ←  D / →   AIM THE JUMP', 'HOLD W / ↑ / SPACE   CHARGE', 'LET GO TO JUMP    S / ↓   CANCEL', 'OR DRAG THE MOUSE AWAY FROM THE SHIP:', 'DIRECTION = AIM, FURTHER = STRONGER'],
};
const DIRECT_TOUCH: Partial<Record<VesselMode, readonly string[]>> = {
  lander: ['HOLD ANYWHERE: THRUST TOWARD FINGER', 'THE LANDER TURNS ITSELF TO PUSH', 'BELOW THE SHIP: TOP THRUSTERS', 'LET GO TO COAST'],
  csm: ['HOLD ANYWHERE: THRUST TOWARD FINGER', 'THE CSM TURNS, THEN BURNS', 'LET GO TO COAST'],
  spring: ['HOLD: DRAG AWAY FROM THE SHIP TO AIM', 'FURTHER = STRONGER JUMP', 'LET GO TO JUMP    DRAG BELOW: CANCEL'],
};

/** JOYSTICK steering (round 8): the virtual stick bottom-left drives the DIRECT layer. */
const JOYSTICK_TOUCH: Partial<Record<VesselMode, readonly string[]>> = {
  lander: ['LEFT STICK: THRUST THAT WAY', 'THE LANDER TURNS ITSELF TO PUSH', 'STICK DOWN: TOP THRUSTERS', 'CENTRE OR LET GO TO COAST'],
  csm: ['LEFT STICK: THRUST THAT WAY', 'THE CSM TURNS, THEN BURNS', 'CENTRE OR LET GO TO COAST'],
  spring: ['LEFT STICK: AIM THE JUMP', 'PUSH FURTHER = STRONGER JUMP', 'LET GO TO JUMP    STICK DOWN: CANCEL'],
};
const JOYSTICK_MOUSE = 'MOUSE: DRAG THE STICK (BOTTOM LEFT)';

/** Cache key for a rendered help card: content AND the theme border it was drawn with. */
export function helpCardKey(mode: VesselMode, touch: boolean, start: boolean, border: number, swap = false, direct = false, joystick = false, stickRight = false): string {
  return `${mode}|${touch}|${start}|${border.toString(16)}|${swap}|${direct}|${joystick}|${stickRight}`;
}

/** Round 11 LAYOUT stick-right: the stick / classic CSM lines name the other side (LEFT <-> RIGHT). */
const mirrorSides = (lines: readonly string[]): string[] =>
  lines.map((l) => l.replace(/LEFT STICK|RIGHT STICK|LEFT THUMB|RIGHT THUMB|BOTTOM LEFT|BOTTOM RIGHT/g, (w) => (w.includes('LEFT') ? w.replace('LEFT', 'RIGHT') : w.replace('RIGHT', 'LEFT'))));

/**
 * `start` = the level-start card (the level waits for the first input). `swap` = engine buttons/keys swapped (S9).
 * `direct` = DIRECT steering (modes it does not drive keep their normal card; swap does not apply to it).
 * `stickRight` = round 11 LAYOUT: the stick (and the classic CSM buttons) on the right.
 */
export function helpCard(mode: VesselMode, touch: boolean, start = true, swap = false, direct = false, joystick = false, stickRight = false): HelpCard {
  if (joystick && JOYSTICK_TOUCH[mode]) {
    // touch: the stick; keyboard: the DIRECT keys (the CSM keeps its classic ones) + the mouse-draggable stick
    // (the spring's DIRECT keys card names the DIRECT mouse drag: under JOYSTICK the mouse drags the stick)
    const keys = mode === 'spring' ? KEYS[mode] : (DIRECT_KEYS[mode] ?? KEYS[mode]);
    const base = touch ? JOYSTICK_TOUCH[mode]! : [...keys, JOYSTICK_MOUSE];
    const lines = stickRight ? mirrorSides(base) : base;
    return {
      title: `${TITLE[mode]} (JOYSTICK)`,
      lines: [...lines, touch ? 'II  PAUSE    ↻  RESTART' : 'ESC / P   PAUSE    BKSP   RESTART'],
      hint: start ? (touch ? 'TOUCH ANY CONTROL TO START' : 'PRESS ANY CONTROL TO START') : touch ? 'TAP TO CLOSE' : 'ANY KEY TO CLOSE',
    };
  }
  const directLines = direct ? (touch ? DIRECT_TOUCH[mode] : DIRECT_KEYS[mode]) : undefined;
  const touchBase = directLines ?? (touch && swap && mode === 'lander' ? TOUCH_LANDER_SWAPPED : TOUCH[mode]);
  // only the classic CSM buttons move with LAYOUT (the lander's are symmetric, the harpoon's stay)
  const touchLines = stickRight && !directLines && mode === 'csm' ? mirrorSides(touchBase) : touchBase;
  const keyLines = directLines ?? (swap && mode === 'lander' ? KEYS_LANDER_SWAPPED : KEYS[mode]);
  return {
    title: directLines ? `${TITLE[mode]} (DIRECT)` : TITLE[mode],
    lines: [...(touch ? touchLines : keyLines), touch ? 'II  PAUSE    ↻  RESTART' : 'ESC / P   PAUSE    BKSP   RESTART'],
    hint: start ? (touch ? 'TOUCH ANY CONTROL TO START' : 'PRESS ANY CONTROL TO START') : touch ? 'TAP TO CLOSE' : 'ANY KEY TO CLOSE',
  };
}

/** One objective as a mission phrase ("PLANT 5 BEACONS"), generic over the objective kinds. */
export function missionPhrase(o: ObjectiveSpec): string {
  switch (o.kind) {
    case 'plantBeacons':
      return `PLANT ${o.count} BEACON${o.count === 1 ? '' : 'S'}`;
    case 'collectOrbs':
      return `COLLECT ${o.count} ORB${o.count === 1 ? '' : 'S'}`;
    case 'reachExit':
      return 'REACH THE EXIT';
    case 'surviveBoss':
      return 'DEFEAT THE KEEPER';
  }
}

/** Max characters per mission line on the start card (the pixel font is ~6 px a glyph; the card is ≤ 640 px). */
export const MISSION_LINE_CHARS = 44;

/**
 * Round 10 (G): the level's objectives stated on the level-start card -
 * "MISSION: PLANT 5 BEACONS + REACH THE EXIT", wrapped between phrases so a
 * line stays within MISSION_LINE_CHARS. Empty for a level without objectives.
 */
export function missionLines(objectives: readonly ObjectiveSpec[]): string[] {
  if (objectives.length === 0) return [];
  const lines: string[] = [];
  let cur = 'MISSION:';
  objectives.forEach((o, i) => {
    const part = (i === 0 ? ' ' : ' + ') + missionPhrase(o);
    if (i > 0 && cur.length + part.length > MISSION_LINE_CHARS) {
      lines.push(cur);
      cur = '  +' + part.slice(2);
    } else cur += part;
  });
  lines.push(cur);
  // guard: a single phrase too long for the card (none today: test/missionLine) is cut, never overflows it
  return lines.map((l) => (l.length > MISSION_LINE_CHARS ? `${l.slice(0, MISSION_LINE_CHARS - 1)}…` : l));
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

