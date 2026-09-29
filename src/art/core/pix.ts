/**
 * Indexed pixel buffer: the one surface every generator draws into.
 *
 * Pixels are PALETTE INDICES (0 = transparent), never colours — the
 * palette-first rule is enforced by construction. Conversion to a canvas
 * happens only at the ArtApi boundary (canvas.ts). Pure data, so it runs in
 * Node (tests, export script) as well as the browser.
 */

export type Pt = readonly [number, number];

export class Pix {
  readonly data: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x]!;
  }

  set(x: number, y: number, c: number): this {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    this.data[y * this.w + x] = c;
    return this;
  }

  /** Set only where the pixel is currently opaque. */
  setIfOpaque(x: number, y: number, c: number): void {
    if (this.get(x, y) !== 0) this.set(x, y, c);
  }

  fill(c: number): this {
    this.data.fill(c);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: number): this {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w));
    const y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) this.data.fill(c, yy * this.w + x0, yy * this.w + Math.max(x0, x1));
    return this;
  }

  hline(x0: number, x1: number, y: number, c: number): this {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) this.set(x, y, c);
    return this;
  }

  vline(x: number, y0: number, y1: number, c: number): this {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) this.set(x, y, c);
    return this;
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): this {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Filled ellipse centred at (cx, cy) (pixel-centre sampling). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number | ((x: number, y: number, nx: number, ny: number) => number)): this {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / Math.max(0.5, rx);
        const ny = (y + 0.5 - cy) / Math.max(0.5, ry);
        if (nx * nx + ny * ny <= 1) {
          const v = typeof c === 'number' ? c : c(x, y, nx, ny);
          if (v >= 0) this.set(x, y, v);
        }
      }
    }
    return this;
  }

  /** Filled polygon (even-odd, pixel-centre sampling). */
  poly(pts: readonly Pt[], c: number | ((x: number, y: number) => number)): this {
    if (pts.length < 3) return this;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const ys = Math.max(0, Math.floor(minY));
    const ye = Math.min(this.h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = ys; y <= ye; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]! - 0.5));
        for (let x = xa; x <= xb; x++) {
          const v = typeof c === 'number' ? c : c(x, y);
          if (v >= 0) this.set(x, y, v);
        }
      }
    }
    return this;
  }

  /** Polyline through points. */
  path(pts: readonly Pt[], c: number): this {
    for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], c);
    return this;
  }

  /** Apply fn to every pixel in a rect (fn returns the new index, or -1 to keep). */
  apply(fn: (x: number, y: number, cur: number) => number, x = 0, y = 0, w = this.w, h = this.h): this {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w));
    const y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * this.w + xx;
        const v = fn(xx, yy, this.data[i]!);
        if (v >= 0) this.data[i] = v;
      }
    }
    return this;
  }

  /** Remap opaque pixels through a table (index -> index) where `mask(x,y)` is true. */
  remap(table: ArrayLike<number>, mask?: (x: number, y: number) => boolean, x = 0, y = 0, w = this.w, h = this.h): this {
    return this.apply((xx, yy, cur) => (cur !== 0 && (!mask || mask(xx, yy)) ? (table[cur] ?? cur) : -1), x, y, w, h);
  }

  /** Draw another buffer on top (index 0 = transparent). */
  blit(
    src: Pix,
    dx: number,
    dy: number,
    opts: { flipX?: boolean; flipY?: boolean; map?: ArrayLike<number> | ((i: number, x: number, y: number) => number) } = {},
  ): this {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = opts.flipX ? src.w - 1 - x : x;
        const sy = opts.flipY ? src.h - 1 - y : y;
        let c = src.data[sy * src.w + sx]!;
        if (c === 0) continue;
        if (opts.map) c = typeof opts.map === 'function' ? opts.map(c, dx + x, dy + y) : (opts.map[c] ?? c);
        if (c > 0) this.set(dx + x, dy + y, c);
      }
    }
    return this;
  }

  clone(): Pix {
    const p = new Pix(this.w, this.h);
    p.data.set(this.data);
    return p;
  }

  /** Copy a sub-rectangle into a new buffer. */
  crop(x: number, y: number, w: number, h: number): Pix {
    const p = new Pix(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) p.set(xx, yy, this.get(x + xx, y + yy));
    return p;
  }

  /** Mirror the left half onto the right half (symmetry stamping). */
  mirrorX(): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < Math.floor(this.w / 2); x++) this.data[y * this.w + (this.w - 1 - x)] = this.data[y * this.w + x]!;
    }
    return this;
  }

  /**
   * 1px outline: every transparent pixel 4-adjacent (or 8-adjacent when
   * `diagonal`) to an opaque pixel becomes `c`. Pixels listed in `skip` do not
   * count as opaque (e.g. glow colours that should stay soft).
   */
  outline(c: number, opts: { diagonal?: boolean; skip?: ReadonlySet<number> } = {}): this {
    const src = this.data.slice();
    const W = this.w;
    const solid = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= this.h) return false;
      const v = src[y * W + x]!;
      return v !== 0 && !(opts.skip?.has(v) ?? false);
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < W; x++) {
        if (src[y * W + x] !== 0) continue;
        let hit = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
        if (!hit && opts.diagonal) hit = solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1);
        if (hit) this.data[y * W + x] = c;
      }
    }
    return this;
  }

  /**
   * Rim light: opaque pixels whose neighbour in direction (dx, dy) is
   * transparent or outline get remapped through `table` (usually "one shade
   * lighter"). Default direction = from above (top rim light).
   */
  rim(table: ArrayLike<number>, outlineIdx: number, dx = 0, dy = -1): this {
    const src = this.data.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = src[y * this.w + x]!;
        if (v === 0 || v === outlineIdx) continue;
        const nx = x + dx;
        const ny = y + dy;
        const n = nx < 0 || ny < 0 || nx >= this.w || ny >= this.h ? 0 : src[ny * this.w + nx]!;
        if (n === 0 || n === outlineIdx) this.data[y * this.w + x] = table[v] ?? v;
      }
    }
    return this;
  }

  /** Count of opaque pixels. */
  opaqueCount(): number {
    let n = 0;
    for (const v of this.data) if (v !== 0) n++;
    return n;
  }

  /** Bounding box of opaque pixels (null if empty). */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.data[y * this.w + x] === 0) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  /** FNV-1a hash of size + pixels (determinism tests). */
  hash(): number {
    let h = 0x811c9dc5;
    const mix = (b: number) => {
      h ^= b & 255;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.w);
    mix(this.w >> 8);
    mix(this.h);
    mix(this.h >> 8);
    for (const v of this.data) mix(v);
    return h >>> 0;
  }
}
