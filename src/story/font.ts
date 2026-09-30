/**
 * Tiny 5×7 bitmap font (plus 2-row descenders) for the cutscene text box.
 * Glyphs are drawn pixel-by-pixel onto a native-resolution canvas, so the
 * text scales with the still and keeps the chunky pixel look.
 *
 * Rows are top -> bottom from cap height; '#' = ink. Glyphs with descenders
 * (g j p q y , ;) have 8-9 rows. Unknown characters draw as a hollow box.
 */

import { UI_GLYPH_ROWS } from '../ui/font';

export const GLYPH_W = 5;
/** Horizontal advance per character (px). */
export const GLYPH_ADVANCE = 6;
/** Cap height + descender (px). */
export const GLYPH_H = 9;
/** Baseline-to-baseline distance (px). */
export const LINE_HEIGHT = 11;

/**
 * Upper case, digits and most punctuation come from the UI font (one
 * shared glyph table, S8); this font adds lower case with descenders and
 * its own descender-style ',' ';' plus '/' '*'.
 */
const G: Record<string, string> = {
  ...UI_GLYPH_ROWS,
  a: '..... ..... .###. ....# .#### #...# .####',
  b: '#.... #.... #.##. ##..# #...# #...# ####.',
  c: '..... ..... .###. #.... #.... #...# .###.',
  d: '....# ....# .##.# #..## #...# #...# .####',
  e: '..... ..... .###. #...# ##### #.... .###.',
  f: '..##. .#..# .#... ###.. .#... .#... .#...',
  g: '..... ..... .#### #...# #...# #...# .#### ....# .###.',
  h: '#.... #.... #.##. ##..# #...# #...# #...#',
  i: '..#.. ..... .##.. ..#.. ..#.. ..#.. .###.',
  j: '...#. ..... ..##. ...#. ...#. ...#. ...#. #..#. .##..',
  k: '#.... #.... #..#. #.#.. ##... #.#.. #..#.',
  l: '.##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  m: '..... ..... ##.#. #.#.# #.#.# #.#.# #.#.#',
  n: '..... ..... #.##. ##..# #...# #...# #...#',
  o: '..... ..... .###. #...# #...# #...# .###.',
  p: '..... ..... ####. #...# #...# #...# ####. #.... #....',
  q: '..... ..... .#### #...# #...# #...# .#### ....# ....#',
  r: '..... ..... #.##. ##..# #.... #.... #....',
  s: '..... ..... .###. #.... .###. ....# ####.',
  t: '.#... .#... ###.. .#... .#... .#..# ..##.',
  u: '..... ..... #...# #...# #...# #..## .##.#',
  v: '..... ..... #...# #...# #...# .#.#. ..#..',
  w: '..... ..... #...# #...# #.#.# #.#.# .#.#.',
  x: '..... ..... #...# .#.#. ..#.. .#.#. #...#',
  y: '..... ..... #...# #...# #...# #...# .#### ....# .###.',
  z: '..... ..... ##### ...#. ..#.. .#... #####',
  ',': '..... ..... ..... ..... ..... .##.. .##.. ..#.. .#...',
  ';': '..... .##.. .##.. ..... .##.. .##.. ..#.. .#...',
  '/': '..... ....# ...#. ..#.. .#... #.... .....',
  '*': '..... ..#.. #.#.# .###. #.#.# ..#..',
};

const FALLBACK = '##### #...# #...# #...# #...# #...# #####';

/** Ink pixels per glyph as flat [x0, y0, x1, y1, ...]. */
const cache = new Map<string, Int8Array>();

function glyphPixels(ch: string): Int8Array {
  let px = cache.get(ch);
  if (px) return px;
  const src = G[ch] ?? FALLBACK;
  const out: number[] = [];
  src
    .split(' ')
    .filter((r) => r.length)
    .forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') out.push(x, y);
    });
  px = Int8Array.from(out);
  cache.set(ch, px);
  return px;
}

/** True when the font has a real glyph for `ch`. */
export function hasGlyph(ch: string): boolean {
  return ch in G;
}

/** Width of `text` in px. */
export function textWidth(text: string): number {
  return text.length ? text.length * GLYPH_ADVANCE - 1 : 0;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Draw `text` with its top-left at (x, y). `shadow` = 1px drop shadow colour. */
export function drawText(ctx: Ctx2D, text: string, x: number, y: number, color: string, shadow?: string): void {
  const pass = (ox: number, oy: number, c: string) => {
    ctx.fillStyle = c;
    for (let i = 0; i < text.length; i++) {
      const px = glyphPixels(text[i]!);
      const gx = x + i * GLYPH_ADVANCE + ox;
      for (let j = 0; j < px.length; j += 2) ctx.fillRect(gx + px[j]!, y + px[j + 1]! + oy, 1, 1);
    }
  };
  if (shadow) pass(1, 1, shadow);
  pass(0, 0, color);
}

/** Greedy word wrap to at most `maxChars` per row (long words are hard-split). */
export function wrapText(text: string, maxChars: number): string[] {
  const rows: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > maxChars) {
      if (cur) rows.push(cur);
      rows.push(w.slice(0, maxChars));
      cur = '';
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      rows.push(cur);
      cur = w;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}
