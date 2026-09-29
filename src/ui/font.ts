/**
 * Minimal 5×7 bitmap pixel font (no external fonts). Pure data + measuring
 * + a canvas rasteriser; used by the HUD, menus, touch-button labels and the
 * rotate hint. S3 may consume (or duplicate) this until S8 merges them.
 *
 * Glyph cell: 5×7 px, advance 6 px, line height 9 px (at scale 1).
 * Lower-case input is drawn upper-case. Unknown characters draw as '?'.
 */

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const ADVANCE = 6;
export const LINE_HEIGHT = 9;

// Each glyph: 7 rows of 5 chars, '#' = ink.
const RAW: Record<string, string> = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '####. ....# ....# .###. ....# ....# ####.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '..##. .#... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ...#. .##..',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  ';': '..... .##.. .##.. ..... .##.. ..#.. .#...',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  '-': '..... ..... ..... .###. ..... ..... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '/': '....# ...#. ...#. ..#.. .#... .#... #....',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
  '"': '.#.#. .#.#. ..... ..... ..... ..... .....',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '[': '.###. .#... .#... .#... .#... .#... .###.',
  ']': '.###. ...#. ...#. ...#. ...#. ...#. .###.',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '_': '..... ..... ..... ..... ..... ..... #####',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  '|': '..#.. ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...#', // multiplication-style x (use '×')
  '←': '..... ..#.. .#... ##### .#... ..#.. .....',
  '→': '..... ..#.. ...#. ##### ...#. ..#.. .....',
  '↑': '..#.. .###. #.#.# ..#.. ..#.. ..#.. .....',
  '↓': '..... ..#.. ..#.. ..#.. #.#.# .###. ..#..',
  '↻': '.###. #...# ....# ..#.# .#### ..... .....',
  '★': '..#.. ..#.. ##### .###. .#.#. #...# .....',
  '▲': '..... ..#.. .###. ##### ..... ..... .....',
  '▼': '..... ..... ##### .###. ..#.. ..... .....',
  '◀': '...#. ..##. .###. ####. .###. ..##. ...#.',
  '▶': '.#... .##.. .###. .#### .###. .##.. .#...',
  '■': '..... .###. .###. .###. ..... ..... .....',
  '…': '..... ..... ..... ..... ..... ..... #.#.#',
};

/** Parsed glyph bitmaps: 7 rows × 5 booleans. */
const GLYPHS = new Map<string, readonly boolean[][]>();
for (const [ch, rows] of Object.entries(RAW)) {
  GLYPHS.set(
    ch,
    rows.split(' ').map((r) => [...r].map((c) => c === '#')),
  );
}
GLYPHS.set('×', GLYPHS.get('x')!);
GLYPHS.delete('x');

/** Normalise a character to one the font has (upper-case; unknown -> '?'). */
export function glyphFor(ch: string): readonly boolean[][] {
  return GLYPHS.get(ch) ?? GLYPHS.get(ch.toUpperCase()) ?? GLYPHS.get('?')!;
}

export function hasGlyph(ch: string): boolean {
  return GLYPHS.has(ch) || GLYPHS.has(ch.toUpperCase());
}

/** Size in px of `text` (multi-line on '\n') at integer `scale`. */
export function measureText(text: string, scale = 1): { width: number; height: number } {
  const lines = text.split('\n');
  const cols = Math.max(0, ...lines.map((l) => [...l].length));
  const width = cols === 0 ? 0 : (cols * ADVANCE - 1) * scale;
  const height = (lines.length * LINE_HEIGHT - (LINE_HEIGHT - GLYPH_H)) * scale;
  return { width, height };
}

export type TextAlign = 'left' | 'center' | 'right';

/** Calls `plot(x, y)` for every ink pixel (unit scale) of `text`. */
export function forEachInk(text: string, plot: (x: number, y: number) => void, align: TextAlign = 'left'): void {
  const lines = text.split('\n');
  const full = measureText(text).width;
  lines.forEach((line, li) => {
    const chars = [...line];
    const w = chars.length ? chars.length * ADVANCE - 1 : 0;
    const ox = align === 'left' ? 0 : align === 'center' ? Math.floor((full - w) / 2) : full - w;
    chars.forEach((ch, ci) => {
      const g = glyphFor(ch);
      for (let y = 0; y < GLYPH_H; y++) for (let x = 0; x < GLYPH_W; x++) if (g[y]![x]) plot(ox + ci * ADVANCE + x, li * LINE_HEIGHT + y);
    });
  });
}

export interface RasterOptions {
  color?: number;
  scale?: number;
  /** 1px dark outline around the ink (pixel-art readability over busy art). */
  outline?: number | null;
  /** Drop shadow colour (1px down-right), or null. */
  shadow?: number | null;
  align?: TextAlign;
}

function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Draw `text` into a new canvas (native px × scale). Browser-only. */
export function rasterText(text: string, opts: RasterOptions = {}): HTMLCanvasElement {
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const pad = opts.outline != null || opts.shadow != null ? 1 : 0;
  const m = measureText(text, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, (m.width + pad * 2) * scale);
  cv.height = Math.max(1, (m.height + pad * 2) * scale);
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const ink: [number, number][] = [];
  forEachInk(text, (x, y) => ink.push([x + pad, y + pad]), opts.align ?? 'left');
  const fill = (color: number, dx: number, dy: number) => {
    ctx.fillStyle = css(color);
    for (const [x, y] of ink) ctx.fillRect((x + dx) * scale, (y + dy) * scale, scale, scale);
  };
  if (opts.outline != null) {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
    ] as const)
      fill(opts.outline, dx, dy);
  } else if (opts.shadow != null) {
    fill(opts.shadow, 1, 1);
  }
  fill(opts.color ?? 0xd8dce8, 0, 0);
  return cv;
}
