/**
 * Seeded randomness. mulberry32: tiny, fast, good enough for art, and fully
 * deterministic across JS engines (pure 32-bit integer maths).
 */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Float in [a, b). */
  range(a: number, b: number): number;
  /** Integer in [a, b] (inclusive). */
  int(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Symmetric jitter in [-a, a). */
  jitter(a: number): number;
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    jitter: (a) => (next() * 2 - 1) * a,
  };
}

/** FNV-1a over strings/numbers -> 32-bit seed. `seedOf('tile', 'caves', 3)`. */
export function seedOf(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? `#${p >>> 0}` : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stateless integer hash of a lattice point (noise, per-pixel sparkle). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
