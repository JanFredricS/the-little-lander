/** UI colours (theme-tinted where a level theme is known). */

import type { ArtApi, ThemeId } from '../contracts';

export const UI = {
  ink: 0xd8dce8,
  dim: 0x6a7288,
  bg: 0x0b0d14,
  panel: 0x141826,
  outline: 0x05060a,
  accent: 0xf0b030,
  light: 0xfff0c0,
  ok: 0x40d080,
  danger: 0xe04848,
  goo: 0xb060e0,
  fuel: 0xf0b030,
  hull: 0x58b0f0,
  wind: 0x9ad8f0,
  radiation: 0xc8f040,
} as const;

/** Theme tint for panel borders: the lightest shade of the theme's primary ramp. */
export function themeTint(art: ArtApi | null, theme: ThemeId | null): number {
  if (!art || !theme) return UI.ink;
  const p = art.palettes[theme];
  const ramp = p?.ramps.primary;
  const idx = ramp?.[ramp.length - 1];
  return idx !== undefined ? (p.colors[idx] ?? UI.ink) : UI.ink;
}
