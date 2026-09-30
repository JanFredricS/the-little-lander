/**
 * Scrolling camera. Pure math, stepped once per FIXED step (deterministic,
 * frame-rate independent), interpolated at render time.
 *
 * `position` is the WORLD-PX point at the centre of the virtual view. Each
 * step the camera moves a fixed fraction (`smoothing`) of the way to its
 * target = followed point + look-ahead along velocity, then is clamped so
 * the view never shows outside the world rect (a world smaller than the view
 * on an axis is centred on that axis).
 */

import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { Vec2 } from '../contracts';

export interface CameraOptions {
  /** World size (px). */
  worldW: number;
  worldH: number;
  /** View size (px). Default VIEW_WIDTH × VIEW_HEIGHT. */
  viewW?: number;
  viewH?: number;
  /** Fraction of the remaining distance covered per step (0..1]. Default 0.12. */
  smoothing?: number;
  /** Seconds of velocity to look ahead. Default 0.35. */
  lookAheadTime?: number;
  /** Max look-ahead distance (px). Default 60. */
  lookAheadMax?: number;
  /** Bias the look-ahead toward one axis. Default 'horizontal'. */
  bias?: 'horizontal' | 'vertical';
}

export class Camera {
  readonly worldW: number;
  readonly worldH: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly smoothing: number;
  readonly lookAheadTime: number;
  readonly lookAheadMax: number;
  readonly bias: 'horizontal' | 'vertical';
  private prev: Vec2;
  private curr: Vec2;

  constructor(opts: CameraOptions, start: Vec2 = { x: 0, y: 0 }) {
    this.worldW = opts.worldW;
    this.worldH = opts.worldH;
    this.viewW = opts.viewW ?? VIEW_WIDTH;
    this.viewH = opts.viewH ?? VIEW_HEIGHT;
    this.smoothing = Math.min(1, Math.max(1e-3, opts.smoothing ?? 0.12));
    this.lookAheadTime = opts.lookAheadTime ?? 0.35;
    this.lookAheadMax = opts.lookAheadMax ?? 60;
    this.bias = opts.bias ?? 'horizontal';
    this.curr = this.clamp(start);
    this.prev = { ...this.curr };
  }

  /** Clamp a view centre so the view stays inside the world. */
  clamp(p: Vec2): Vec2 {
    return { x: clampAxis(p.x, this.viewW, this.worldW), y: clampAxis(p.y, this.viewH, this.worldH) };
  }

  /** Target view centre for a followed point with velocity (px, px/s). */
  targetFor(pos: Vec2, vel: Vec2 = { x: 0, y: 0 }): Vec2 {
    const primary = this.lookAheadMax;
    const secondary = this.lookAheadMax * 0.5;
    const maxX = this.bias === 'horizontal' ? primary : secondary;
    const maxY = this.bias === 'vertical' ? primary : secondary;
    const ax = clamp(vel.x * this.lookAheadTime, -maxX, maxX);
    const ay = clamp(vel.y * this.lookAheadTime, -maxY, maxY);
    return this.clamp({ x: pos.x + ax, y: pos.y + ay });
  }

  /** Jump straight to the target (level start / respawn). */
  snap(pos: Vec2, vel?: Vec2): void {
    this.curr = this.targetFor(pos, vel);
    this.prev = { ...this.curr };
  }

  /** One fixed step toward the followed point. null = hold still. */
  step(pos: Vec2 | null, vel?: Vec2): void {
    this.prev = { ...this.curr };
    if (!pos) return;
    const t = this.targetFor(pos, vel);
    this.curr = this.clamp({
      x: this.curr.x + (t.x - this.curr.x) * this.smoothing,
      y: this.curr.y + (t.y - this.curr.y) * this.smoothing,
    });
  }

  get position(): Vec2 {
    return { ...this.curr };
  }

  /** Render-time view centre between the last two steps. */
  interpolated(alpha: number, out?: Vec2): Vec2 {
    const a = clamp(alpha, 0, 1);
    const x = this.prev.x + (this.curr.x - this.prev.x) * a;
    const y = this.prev.y + (this.curr.y - this.prev.y) * a;
    if (!out) return { x, y };
    out.x = x;
    out.y = y;
    return out;
  }

  /** Top-left world px of the view for a given centre, rounded to whole pixels (pixel-art stability). */
  viewOrigin(center: Vec2, out?: Vec2): Vec2 {
    const x = Math.round(center.x - this.viewW / 2);
    const y = Math.round(center.y - this.viewH / 2);
    if (!out) return { x, y };
    out.x = x;
    out.y = y;
    return out;
  }

  /** Virtual-view px (0..viewW, 0..viewH) -> world px, for a given centre. */
  viewToWorld(center: Vec2, p: Vec2): Vec2 {
    const o = this.viewOrigin(center);
    return { x: o.x + p.x, y: o.y + p.y };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampAxis(c: number, view: number, world: number): number {
  if (world <= view) return world / 2;
  return clamp(c, view / 2, world - view / 2);
}
