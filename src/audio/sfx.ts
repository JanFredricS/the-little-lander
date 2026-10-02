/**
 * One-shot SFX recipes (chiptune character: square/triangle voices, FM
 * bells, filtered noise). Each recipe only schedules voices on the driver.
 * Sustained sounds (thrusters) live in thrusters.ts.
 */

import type { AudioDriver } from './driver';
import { mtof } from './util';

export const SFX_IDS = [
  // harpoon
  'harpoonFire',
  'harpoonHit',
  'harpoonHitBrittle',
  'harpoonReel',
  'harpoonMiss',
  'harpoonRelease',
  'harpoonBreak',
  // impacts
  'bump',
  'hullHit',
  'crash',
  'softLand',
  // pickups / objectives
  'beaconChime',
  'orbArp',
  'fuelPickup',
  'repair',
  'objective',
  'levelComplete',
  'levelFailed',
  'modeChange',
  // hazards
  'gooAttach',
  'gooBurn',
  'radiationCharge',
  'radiationBlast',
  'windWarning',
  'windWhoosh',
  'gravityShift',
  'debris',
  // round 15: spring legs + crumbling islets
  'springCompress',
  'springBoing',
  'crumbleShake',
  'crumbleBreak',
  // boss
  'bossRoar',
  'bossHurt',
  'bossDefeated',
  // UI / dialogue
  'uiMove',
  'uiConfirm',
  'uiBack',
  'typeBlip',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

export interface SfxOpts {
  /** 0..1 loudness/size scaler (impact speed, damage, ...). Default 0.6. */
  intensity?: number;
  /** Small integer that shifts pitch/variation (beacon index, gun index, ...). */
  variant?: number;
  /** Duration hint in seconds (radiation charge = telegraph time). */
  dur?: number;
}

type Recipe = (d: AudioDriver, t: number, o: Required<Pick<SfxOpts, 'intensity' | 'variant'>> & SfxOpts, r: () => number) => void;

const S = 'sfx' as const;

/** Rising/falling pentatonic helper. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export const SFX: Record<SfxId, Recipe> = {
  // ---------------------------------------------------------------- harpoon
  harpoonFire(d, t, o) {
    const p = 1 + o.variant * 0.08;
    d.noise({ bus: S, start: t, dur: 0.05, gain: 0.35, filter: { type: 'highpass', freq: 2500 } });
    d.tone({ bus: S, wave: 'square', freq: 900 * p, freqEnd: 220 * p, start: t, dur: 0.12, gain: 0.18 });
    // rope paying out: rapid ticks
    for (let i = 0; i < 5; i++) {
      d.tone({ bus: S, wave: 'square', freq: 1500 - i * 120, start: t + 0.06 + i * 0.03, dur: 0.012, gain: 0.07 });
    }
  },
  harpoonHit(d, t) {
    d.tone({ bus: S, wave: 'square', freq: 180, freqEnd: 90, start: t, dur: 0.06, gain: 0.3 });
    d.noise({ bus: S, start: t, dur: 0.04, gain: 0.3, filter: { type: 'bandpass', freq: 1800, q: 2 } });
    d.tone({ bus: S, wave: 'triangle', freq: 1320, start: t + 0.02, dur: 0.08, gain: 0.12, fm: { ratio: 2.7, index: 1.5 } });
  },
  harpoonHitBrittle(d, t, _o, r) {
    SFX.harpoonHit(d, t, _o, r);
    for (let i = 0; i < 4; i++) {
      d.noise({ bus: S, start: t + 0.06 + i * 0.045 + r() * 0.02, dur: 0.015, gain: 0.18, filter: { type: 'highpass', freq: 3000 + r() * 2000 } });
    }
  },
  harpoonReel(d, t, o) {
    // ratchet winding the line (variant 0 = in: rising, 1 = out: falling)
    const out = (o.variant ?? 0) === 1;
    for (let i = 0; i < 8; i++) {
      d.tone({ bus: S, wave: 'square', freq: out ? 800 - i * 40 : 520 + i * 40, start: t + i * 0.035, dur: 0.012, gain: 0.08, filter: { type: 'bandpass', freq: 1200, q: 3 } });
    }
    d.tone({ bus: S, wave: 'triangle', freq: out ? 600 : 300, freqEnd: out ? 300 : 600, start: t, dur: 0.28, gain: 0.08 });
  },
  harpoonMiss(d, t) {
    // the line runs out to full range and goes slack: a dull flap + low thunk
    d.noise({ bus: S, start: t, dur: 0.16, gain: 0.12, filter: { type: 'bandpass', freq: 900, q: 2, freqEnd: 300 } });
    d.tone({ bus: S, wave: 'triangle', freq: 220, freqEnd: 110, start: t + 0.04, dur: 0.12, gain: 0.1 });
  },
  harpoonRelease(d, t) {
    d.tone({ bus: S, wave: 'square', freq: 700, freqEnd: 1400, start: t, dur: 0.05, gain: 0.14 });
    d.noise({ bus: S, start: t, dur: 0.08, gain: 0.12, filter: { type: 'highpass', freq: 4000 } });
  },
  harpoonBreak(d, t) {
    d.noise({ bus: S, start: t, dur: 0.12, gain: 0.4, filter: { type: 'bandpass', freq: 2500, q: 1.5, freqEnd: 600 } });
    d.tone({ bus: S, wave: 'sawtooth', freq: 1100, freqEnd: 90, start: t, dur: 0.25, gain: 0.16, filter: { type: 'lowpass', freq: 3000 } });
    d.tone({ bus: S, wave: 'square', freq: 1600, freqEnd: 400, start: t + 0.02, dur: 0.1, gain: 0.08 });
  },

  // ---------------------------------------------------------------- impacts
  bump(d, t, o) {
    const g = 0.08 + o.intensity * 0.22;
    d.noise({ bus: S, start: t, dur: 0.05 + o.intensity * 0.05, gain: g, filter: { type: 'lowpass', freq: 500 + o.intensity * 1200 } });
    d.tone({ bus: S, wave: 'triangle', freq: 110, freqEnd: 55, start: t, dur: 0.08, gain: g * 0.8 });
  },
  hullHit(d, t, o) {
    const g = 0.2 + o.intensity * 0.25;
    d.tone({ bus: S, wave: 'square', freq: 240, freqEnd: 70, start: t, dur: 0.14, gain: g * 0.6 });
    d.noise({ bus: S, start: t, dur: 0.12, gain: g, filter: { type: 'bandpass', freq: 900, q: 1.2 } });
    // metallic ring
    d.tone({ bus: S, wave: 'sine', freq: 610, start: t, dur: 0.25, gain: g * 0.25, fm: { ratio: 1.41, index: 3 }, release: 0.2 });
  },
  crash(d, t, _o, r) {
    d.noise({ bus: S, start: t, dur: 0.9, gain: 0.6, attack: 0.001, release: 0.6, filter: { type: 'lowpass', freq: 4000, freqEnd: 120 } });
    d.tone({ bus: S, wave: 'square', freq: 150, freqEnd: 30, start: t, dur: 0.7, gain: 0.35, release: 0.3 });
    d.tone({ bus: S, wave: 'triangle', freq: 70, freqEnd: 25, start: t, dur: 1.0, gain: 0.5, release: 0.4 });
    for (let i = 0; i < 6; i++) {
      d.noise({ bus: S, start: t + 0.1 + i * 0.09 + r() * 0.05, dur: 0.04, gain: 0.2 * (1 - i / 7), filter: { type: 'bandpass', freq: 1500 + r() * 2500, q: 2 } });
    }
  },
  softLand(d, t) {
    d.tone({ bus: S, wave: 'triangle', freq: 90, freqEnd: 50, start: t, dur: 0.12, gain: 0.4 });
    d.noise({ bus: S, start: t, dur: 0.1, gain: 0.12, filter: { type: 'lowpass', freq: 400 } });
    // leg struts settling
    d.tone({ bus: S, wave: 'square', freq: 420, start: t + 0.1, dur: 0.02, gain: 0.05 });
    d.tone({ bus: S, wave: 'square', freq: 380, start: t + 0.15, dur: 0.02, gain: 0.04 });
  },

  // ------------------------------------------------- round 15: spring legs
  springCompress(d, t) {
    // coils winding down: a low creak rising in pitch over about a second (the full charge)
    d.tone({ bus: S, wave: 'square', freq: 70, freqEnd: 160, start: t, dur: 0.9, gain: 0.05, filter: { type: 'bandpass', freq: 700, q: 4, freqEnd: 1400 } });
    for (let i = 0; i < 5; i++) d.tone({ bus: S, wave: 'triangle', freq: 300 + i * 70, start: t + i * 0.16, dur: 0.03, gain: 0.05 });
  },
  springBoing(d, t, o) {
    // the classic boing: a sine sliding up with wobble, brighter / higher with the charge
    const k = 0.4 + 0.6 * o.intensity;
    d.tone({ bus: S, wave: 'sine', freq: 140 * k + 60, freqEnd: 420 * k + 120, start: t, dur: 0.22, gain: 0.22, vibrato: { rate: 22, cents: 90 }, release: 0.12 });
    d.tone({ bus: S, wave: 'triangle', freq: 90, freqEnd: 45, start: t, dur: 0.07, gain: 0.18 });
    d.noise({ bus: S, start: t, dur: 0.04, gain: 0.08, filter: { type: 'lowpass', freq: 900 } });
  },
  crumbleShake(d, t, o, r) {
    // grinding rock over the telegraph time
    const dur = Math.max(0.3, o.dur ?? 0.8);
    d.noise({ bus: S, start: t, dur, gain: 0.1, attack: 0.05, filter: { type: 'lowpass', freq: 380, freqEnd: 700 } });
    for (let i = 0; i < 6; i++) d.noise({ bus: S, start: t + (i / 6) * dur + r() * 0.04, dur: 0.03, gain: 0.08, filter: { type: 'bandpass', freq: 1200 + r() * 1500, q: 2 } });
  },
  crumbleBreak(d, t, _o, r) {
    d.noise({ bus: S, start: t, dur: 0.45, gain: 0.32, release: 0.3, filter: { type: 'lowpass', freq: 2200, freqEnd: 200 } });
    d.tone({ bus: S, wave: 'triangle', freq: 95, freqEnd: 40, start: t, dur: 0.35, gain: 0.25 });
    for (let i = 0; i < 5; i++) d.noise({ bus: S, start: t + 0.05 + i * 0.07 + r() * 0.03, dur: 0.03, gain: 0.12, filter: { type: 'bandpass', freq: 900 + r() * 1800, q: 2 } });
  },

  // ------------------------------------------------------ pickups/objectives
  beaconChime(d, t, o) {
    const base = 72 + PENTA[Math.min(PENTA.length - 4, o.variant)]!;
    [0, 4, 7, 12].forEach((iv, i) => {
      d.tone({
        bus: S, wave: 'sine', freq: mtof(base + iv), start: t + i * 0.09, dur: 0.12, gain: 0.16, release: 0.6,
        fm: { ratio: 3.5, index: 1.2 }, echo: { delay: 0.18, feedback: 0.35, mix: 0.35 },
      });
    });
  },
  orbArp(d, t, o) {
    const base = 76 + (o.variant % 3) * 2;
    [0, 4, 7, 12, 16].forEach((iv, i) => {
      d.tone({ bus: S, wave: 'square', freq: mtof(base + iv), start: t + i * 0.04, dur: 0.035, gain: 0.1, filter: { type: 'lowpass', freq: 6000 } });
    });
    d.tone({ bus: S, wave: 'triangle', freq: mtof(base + 24), start: t + 0.2, dur: 0.15, gain: 0.08, vibrato: { rate: 8, cents: 30 } });
  },
  fuelPickup(d, t) {
    d.tone({ bus: S, wave: 'square', freq: 220, freqEnd: 880, start: t, dur: 0.18, gain: 0.12, filter: { type: 'lowpass', freq: 3000 } });
    d.noise({ bus: S, start: t, dur: 0.2, gain: 0.06, filter: { type: 'bandpass', freq: 1200, q: 4, freqEnd: 3000 } });
    d.tone({ bus: S, wave: 'triangle', freq: 880, start: t + 0.18, dur: 0.08, gain: 0.1 });
  },
  repair(d, t) {
    [0, 7, 12].forEach((iv, i) => d.tone({ bus: S, wave: 'triangle', freq: mtof(60 + iv), start: t + i * 0.07, dur: 0.06, gain: 0.14 }));
  },
  objective(d, t) {
    [0, 4, 7].forEach((iv, i) => d.tone({ bus: S, wave: 'square', freq: mtof(72 + iv), start: t + i * 0.08, dur: 0.07, gain: 0.1 }));
    d.tone({ bus: S, wave: 'square', freq: mtof(84), start: t + 0.24, dur: 0.25, gain: 0.1, vibrato: { rate: 6, cents: 20 } });
  },
  levelComplete(d, t) {
    const mel = [0, 4, 7, 12, 7, 12, 16];
    mel.forEach((iv, i) => {
      d.tone({ bus: S, wave: 'square', freq: mtof(67 + iv), start: t + i * 0.1, dur: i === mel.length - 1 ? 0.5 : 0.08, gain: 0.11, vibrato: i === mel.length - 1 ? { rate: 6, cents: 25 } : undefined });
      d.tone({ bus: S, wave: 'triangle', freq: mtof(43 + (i < 4 ? 0 : 5)), start: t + i * 0.1, dur: 0.09, gain: 0.18 });
    });
  },
  levelFailed(d, t) {
    [0, -1, -3, -6].forEach((iv, i) => d.tone({ bus: S, wave: 'square', freq: mtof(64 + iv), start: t + 0.25 + i * 0.18, dur: 0.16, gain: 0.1, filter: { type: 'lowpass', freq: 2000 } }));
    d.tone({ bus: S, wave: 'triangle', freq: mtof(40), start: t + 0.25, dur: 0.9, gain: 0.2, release: 0.3 });
  },
  modeChange(d, t) {
    // explosive bolts + clunk
    d.noise({ bus: S, start: t, dur: 0.06, gain: 0.4, filter: { type: 'highpass', freq: 1500 } });
    d.noise({ bus: S, start: t + 0.08, dur: 0.06, gain: 0.35, filter: { type: 'highpass', freq: 1200 } });
    d.tone({ bus: S, wave: 'square', freq: 160, freqEnd: 60, start: t + 0.05, dur: 0.2, gain: 0.25 });
    d.tone({ bus: S, wave: 'sawtooth', freq: 400, freqEnd: 1600, start: t + 0.15, dur: 0.3, gain: 0.06, filter: { type: 'lowpass', freq: 2000 } });
  },

  // ---------------------------------------------------------------- hazards
  gooAttach(d, t, _o, r) {
    const f = 260 + r() * 60;
    d.tone({ bus: S, wave: 'sine', freq: f, freqEnd: f * 2.6, start: t, dur: 0.07, gain: 0.3, fm: { ratio: 0.5, index: 2 } });
    d.tone({ bus: S, wave: 'sine', freq: f * 0.7, freqEnd: f * 0.4, start: t + 0.07, dur: 0.09, gain: 0.2 });
    d.noise({ bus: S, start: t, dur: 0.06, gain: 0.08, filter: { type: 'lowpass', freq: 700 } });
  },
  gooBurn(d, t, _o, r) {
    d.noise({ bus: S, start: t, dur: 0.45, gain: 0.25, attack: 0.02, release: 0.2, filter: { type: 'highpass', freq: 3500, freqEnd: 6000 } });
    for (let i = 0; i < 7; i++) {
      d.noise({ bus: S, start: t + r() * 0.4, dur: 0.012, gain: 0.2, filter: { type: 'bandpass', freq: 2000 + r() * 4000, q: 5 } });
    }
    d.tone({ bus: S, wave: 'sine', freq: 500, freqEnd: 90, start: t + 0.05, dur: 0.3, gain: 0.12 });
  },
  radiationCharge(d, t, o) {
    const dur = Math.max(0.3, Math.min(4, o.dur ?? 1.5));
    d.tone({ bus: S, wave: 'sawtooth', freq: 180, freqEnd: 1400, start: t, dur, gain: 0.07, attack: dur * 0.6, filter: { type: 'lowpass', freq: 900, freqEnd: 5000 }, vibrato: { rate: 9, cents: 40 } });
    d.tone({ bus: S, wave: 'square', freq: 90, freqEnd: 700, start: t, dur, gain: 0.05, attack: dur * 0.8 });
    // Geiger ticks accelerating
    let tt = 0;
    let gap = 0.22;
    while (tt < dur) {
      d.noise({ bus: S, start: t + tt, dur: 0.006, gain: 0.18, filter: { type: 'highpass', freq: 5000 } });
      tt += gap;
      gap = Math.max(0.03, gap * 0.85);
    }
  },
  radiationBlast(d, t) {
    d.noise({ bus: S, start: t, dur: 0.6, gain: 0.5, release: 0.4, filter: { type: 'bandpass', freq: 3000, q: 0.8, freqEnd: 300 } });
    d.tone({ bus: S, wave: 'square', freq: 1800, freqEnd: 60, start: t, dur: 0.5, gain: 0.18, fm: { ratio: 1.5, index: 4 } });
    d.tone({ bus: S, wave: 'triangle', freq: 60, start: t, dur: 0.5, gain: 0.35, release: 0.3 });
  },
  windWarning(d, t) {
    d.noise({ bus: S, start: t, dur: 0.8, gain: 0.12, attack: 0.5, release: 0.3, filter: { type: 'bandpass', freq: 300, q: 3, freqEnd: 600 } });
    d.tone({ bus: S, wave: 'triangle', freq: mtof(81), start: t, dur: 0.08, gain: 0.07 });
    d.tone({ bus: S, wave: 'triangle', freq: mtof(81), start: t + 0.16, dur: 0.08, gain: 0.07 });
  },
  windWhoosh(d, t, o) {
    const g = 0.15 + o.intensity * 0.25;
    d.noise({ bus: S, start: t, dur: 1.2, gain: g, attack: 0.25, release: 0.8, filter: { type: 'bandpass', freq: 400, q: 1.5, freqEnd: 2200 }, pan: o.variant < 0 ? -0.6 : 0.6 });
    d.noise({ bus: S, start: t + 0.2, dur: 1.0, gain: g * 0.6, attack: 0.3, release: 0.6, filter: { type: 'bandpass', freq: 1800, q: 4, freqEnd: 700 } });
  },
  gravityShift(d, t) {
    d.tone({ bus: S, wave: 'sine', freq: 220, freqEnd: 110, start: t, dur: 0.4, gain: 0.14, vibrato: { rate: 14, cents: 80 } });
    d.tone({ bus: S, wave: 'triangle', freq: 330, freqEnd: 660, start: t, dur: 0.4, gain: 0.06 });
  },
  debris(d, t, o, r) {
    const n = 3 + Math.round(o.intensity * 4);
    for (let i = 0; i < n; i++) {
      const st = t + i * 0.05 + r() * 0.04;
      d.noise({ bus: S, start: st, dur: 0.03, gain: 0.25 * (1 - i / (n + 1)), filter: { type: 'bandpass', freq: 600 + r() * 1800, q: 3 } });
      d.tone({ bus: S, wave: 'triangle', freq: 120 + r() * 200, start: st, dur: 0.03, gain: 0.1 });
    }
  },

  // ------------------------------------------------------------------- boss
  bossRoar(d, t, o) {
    const p = 1 + o.variant * 0.1;
    d.tone({ bus: S, wave: 'sawtooth', freq: 70 * p, freqEnd: 45 * p, start: t, dur: 1.4, gain: 0.35, attack: 0.15, release: 0.5, fm: { ratio: 0.51, index: 3 }, filter: { type: 'lowpass', freq: 900, freqEnd: 300 }, vibrato: { rate: 5, cents: 60 } });
    d.tone({ bus: S, wave: 'square', freq: 104 * p, freqEnd: 60 * p, start: t + 0.05, dur: 1.2, gain: 0.12, attack: 0.2, filter: { type: 'lowpass', freq: 1200 } });
    d.noise({ bus: S, start: t, dur: 1.3, gain: 0.25, attack: 0.2, release: 0.5, filter: { type: 'bandpass', freq: 500, q: 1, freqEnd: 200 } });
  },
  bossHurt(d, t, o) {
    d.tone({ bus: S, wave: 'square', freq: 300, freqEnd: 120, start: t, dur: 0.25, gain: 0.2 + o.intensity * 0.15, vibrato: { rate: 22, cents: 150 } });
    d.noise({ bus: S, start: t, dur: 0.2, gain: 0.2, filter: { type: 'bandpass', freq: 1200, q: 2, freqEnd: 400 } });
  },
  bossDefeated(d, t, o, r) {
    SFX.bossRoar(d, t, { ...o, variant: -3 }, r);
    for (let i = 0; i < 5; i++) SFX.crash(d, t + 0.4 + i * 0.35, o, r);
  },

  // ------------------------------------------------------------ UI/dialogue
  uiMove(d, t) {
    d.tone({ bus: S, wave: 'square', freq: 880, start: t, dur: 0.025, gain: 0.08 });
  },
  uiConfirm(d, t) {
    d.tone({ bus: S, wave: 'square', freq: 660, start: t, dur: 0.04, gain: 0.1 });
    d.tone({ bus: S, wave: 'square', freq: 1320, start: t + 0.05, dur: 0.07, gain: 0.1 });
  },
  uiBack(d, t) {
    d.tone({ bus: S, wave: 'square', freq: 660, start: t, dur: 0.04, gain: 0.09 });
    d.tone({ bus: S, wave: 'square', freq: 440, start: t + 0.05, dur: 0.06, gain: 0.09 });
  },
  typeBlip(d, t, o) {
    // variant = speaker voice (0 Wren, 1 Io, 2 Commander, ...)
    const base = [1050, 820, 620, 1300, 500][Math.abs(o.variant) % 5]!;
    d.tone({ bus: S, wave: 'square', freq: base * (0.97 + (o.intensity - 0.5) * 0.06), start: t, dur: 0.018, gain: 0.05, filter: { type: 'lowpass', freq: 4000 } });
  },
};

/** Minimum gap (s) between two triggers of the same SFX (prevents pile-ups from event storms). */
export const SFX_MIN_GAP: Partial<Record<SfxId, number>> = {
  bump: 0.08,
  hullHit: 0.1,
  debris: 0.12,
  gooBurn: 0.15,
  typeBlip: 0.03,
  gravityShift: 0.5,
  windWhoosh: 0.4,
  bossHurt: 0.12,
  orbArp: 0.05,
};

export function playSfx(d: AudioDriver, id: SfxId, t: number, opts: SfxOpts = {}, r: () => number = Math.random): void {
  SFX[id](d, t, { intensity: opts.intensity ?? 0.6, variant: opts.variant ?? 0, dur: opts.dur }, r);
}
