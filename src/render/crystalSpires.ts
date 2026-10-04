/**
 * Round 20 (user: "the white stalactites ... visually dont look very nice"): The Hollow's
 * roof crystal (terrain pieces with style.look 'crystalSpire') is drawn here instead of by
 * the tile painter (which tiled a flat pale 16 px fill over a ~250 x 900 px spire). Visual
 * only: the outline, physics and sun transparency are the piece's, untouched.
 *
 * Each spire is cut into facets along its length (s7SpirePoints order: base corner, the
 * left flank, the blunt tip's two points, the right flank, the other base corner):
 *  - a translucent body (the cave shows through - it is the sun-transparent rock): four
 *    facet columns, lit side (west) to shade side, tinted violet at the crust and pale ice
 *    at the tip;
 *  - facet lines: a bright ridge, a soft lit seam and a dark shade seam, plus a few seeded
 *    fracture planes inside;
 *  - edges: the theme outline, a glinting highlight down the lit flank, a cool rim on the
 *    shade flank;
 *  - an additive core glow along the ridge - light passing through - that swells while the
 *    sun charges, and a few twinkling glints (static under reduced motion).
 * Static geometry per spire (culled to the view); the glow alpha and the glints are per frame.
 */

import { Container, Graphics } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { LevelSpec, TerrainPiece, Vec2 } from '../contracts';

/** Facet column colours, lit (west) -> shade. */
const COLUMN = [0x86d4f4, 0x3a92c8, 0x285c98, 0x142a5c] as const;
/** Lengthwise tints: at the crust (base) and at the tip. */
const BASE_TINT = 0x4a2a96;
const TIP_TINT = 0xeefeff;
const RIDGE = 0xf2fcff;
const SEAM_LIT = 0xdaf2ff;
const SEAM_DARK = 0x14284e;
const RIM = 0xa8dcff;
const GLOW = 0x9fe8ff;
const GLINT = 0xffffff;
/** Body alpha at the base and at the tip. */
const ALPHA_BASE = 0.92;
const ALPHA_TIP = 0.8;

export interface CrystalQuad {
  pts: number[];
  color: number;
  alpha: number;
}
export interface CrystalLine {
  pts: number[];
  color: number;
  alpha: number;
  width: number;
}
export interface CrystalGeometry {
  quads: CrystalQuad[];
  lines: CrystalLine[];
  /** Ridge glow strip (additive). */
  glow: number[];
  /** Glint spots (world px) with a twinkle phase. */
  glints: { x: number; y: number; phase: number; size: number }[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
function mix(c0: number, c1: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => Math.round(lerp((c0 >> s) & 255, (c1 >> s) & 255, k));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
function hash01(s: string, i: number): number {
  let h = 0x811c9dc5 ^ i;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 13;
  return ((h >>> 0) % 10007) / 10007;
}

/** Whether a piece is drawn by this layer (and skipped by the tile painter). */
export const isCrystalSpire = (p: Pick<TerrainPiece, 'kind' | 'points' | 'style'>): boolean =>
  p.style.look === 'crystalSpire' && p.kind === 'polygon' && p.points.length >= 6 && p.points.length % 2 === 0;

/**
 * Facets, lines, glow strip and glints of one spire outline (s7SpirePoints order). Pure:
 * the same outline gives the same geometry.
 */
export function crystalGeometry(id: string, points: readonly Vec2[]): CrystalGeometry {
  const n = points.length;
  const k = n / 2 - 1;
  // both flanks from the base corner to the tip, same length
  const L = points.slice(0, k + 1);
  const R = points.slice(k + 1).reverse();
  /** Meridians across the spire at chain index i: lit edge, lit seam, ridge, shade seam, shade edge. */
  const ridgeAt = 0.42;
  const mer = (i: number): Vec2[] => {
    const a = L[i]!;
    const b = R[i]!;
    const m = lerpP(a, b, ridgeAt);
    return [a, lerpP(a, m, 0.5), m, lerpP(m, b, 0.55), b];
  };
  const rows = Array.from({ length: k + 1 }, (_, i) => mer(i));
  const quads: CrystalQuad[] = [];
  for (let i = 0; i < k; i++) {
    const t = (i + 0.5) / k; // 0 base .. 1 tip
    for (let c = 0; c < 4; c++) {
      const p0 = rows[i]![c]!;
      const p1 = rows[i]![c + 1]!;
      const p2 = rows[i + 1]![c + 1]!;
      const p3 = rows[i + 1]![c]!;
      let color = mix(COLUMN[c]!, BASE_TINT, 0.55 * (1 - t) ** 1.3);
      color = mix(color, TIP_TINT, 0.22 * t ** 2);
      // alternate rows a touch for growth bands
      if (i % 2 === 1) color = mix(color, c < 2 ? 0xffffff : 0x20245a, 0.06);
      quads.push({ pts: [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y], color, alpha: lerp(ALPHA_BASE, ALPHA_TIP, t) });
    }
  }
  const lines: CrystalLine[] = [];
  const along = (c: number) => rows.flatMap((r) => [r[c]!.x, r[c]!.y]);
  lines.push({ pts: along(1), color: SEAM_LIT, alpha: 0.35, width: 1 });
  lines.push({ pts: along(3), color: SEAM_DARK, alpha: 0.4, width: 1 });
  lines.push({ pts: along(2), color: RIDGE, alpha: 0.75, width: 1 });
  // growth steps: a chevron across the spire at every inner row, dipping toward the tip at the ridge
  for (let i = 1; i < k; i++) {
    const r = rows[i]!;
    const dip = Math.sign(rows[k]![2]!.y - rows[0]![2]!.y) * 10;
    lines.push({ pts: [r[0]!.x, r[0]!.y, r[2]!.x, r[2]!.y + dip], color: SEAM_LIT, alpha: 0.4, width: 1 });
    lines.push({ pts: [r[2]!.x, r[2]!.y + dip, r[4]!.x, r[4]!.y], color: SEAM_DARK, alpha: 0.45, width: 1 });
  }
  // fracture planes: short slanted cuts across the lit facets, seeded per spire
  for (let f = 0; f < 3; f++) {
    const t = 0.2 + 0.6 * hash01(id, f);
    const i = Math.min(k - 1, Math.floor(t * k));
    const u = t * k - i;
    const a = lerpP(rows[i]![0]!, rows[i + 1]![0]!, u);
    const m = lerpP(rows[i]![2]!, rows[i + 1]![2]!, u);
    const p0 = lerpP(a, m, 0.15);
    const p1 = lerpP(a, m, 0.85);
    const slant = (hash01(id, f + 10) - 0.5) * 40 + 18;
    lines.push({ pts: [p0.x, p0.y - slant / 2, p1.x, p1.y + slant / 2], color: RIDGE, alpha: 0.22, width: 1 });
  }
  // edges: outline drawn by the view; a bright lit flank and a cool rim on the shade flank
  lines.push({ pts: L.flatMap((p) => [p.x + 1, p.y]), color: RIDGE, alpha: 0.9, width: 1.5 });
  lines.push({ pts: R.flatMap((p) => [p.x - 1, p.y]), color: RIM, alpha: 0.4, width: 1 });
  // glow strip hugging the ridge (narrow at the base, widening, then to the tip)
  const glowL: number[] = [];
  const glowR: number[] = [];
  for (let i = 0; i <= k; i++) {
    const r = rows[i]!;
    const w = 0.16;
    const a = lerpP(r[2]!, r[1]!, w);
    const b = lerpP(r[2]!, r[3]!, w);
    glowL.push(a.x, a.y);
    glowR.unshift(b.x, b.y);
  }
  const glow = [...glowL, ...glowR];
  // glints: the tip, and two seeded spots on the lit flank / ridge
  const tip = lerpP(points[k]!, points[k + 1]!, 0.5);
  const glints = [{ x: tip.x, y: tip.y, phase: hash01(id, 20) * Math.PI * 2, size: 3 }];
  for (let g = 0; g < 2; g++) {
    const t = 0.35 + 0.5 * hash01(id, 21 + g);
    const i = Math.min(k - 1, Math.floor(t * k));
    const c = g === 0 ? 0 : 2;
    const p = lerpP(rows[i]![c]!, rows[i + 1]![c]!, t * k - i);
    glints.push({ x: p.x + (c === 0 ? 2 : 0), y: p.y, phase: hash01(id, 30 + g) * Math.PI * 2, size: 2 });
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { quads, lines, glow, glints, bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
}

export interface CrystalGlowState {
  /** Current glow alpha (-1 = not started). */
  level: number;
  lastMs: number;
}
/** Under reduced motion the glow tops out here (normal: 1.0) ... */
export const CRYSTAL_GLOW_RM_MAX = 0.5;
/** ... and falls back to rest with this time constant (s) instead of snapping at each pulse's end. */
export const CRYSTAL_GLOW_RM_FALL_SEC = 1.5;

/**
 * Round-20 audit LOW-1: the ridge glow follows the sun's charge (0.2 at rest, telegraphing
 * a pulse as it charges). Normal motion: 0.2 + 0.8 x charge, as before. Reduced motion:
 * the telegraph stays but is capped at CRYSTAL_GLOW_RM_MAX, and when the charge drops
 * (the pulse fires and resets) the glow eases down instead of snapping off.
 */
export function crystalGlowAlpha(st: CrystalGlowState, nowMs: number, sunCharge: number, reducedMotion: boolean): number {
  const c = Math.min(1, Math.max(0, sunCharge));
  if (!reducedMotion) return 0.2 + 0.8 * c;
  const target = 0.2 + (CRYSTAL_GLOW_RM_MAX - 0.2) * c;
  const dt = st.lastMs < 0 ? 0 : Math.max(0, Math.min(0.25, (nowMs - st.lastMs) / 1000));
  st.lastMs = nowMs;
  if (st.level < 0 || target >= st.level) st.level = target;
  else st.level = target + (st.level - target) * Math.exp(-dt / CRYSTAL_GLOW_RM_FALL_SEC);
  return st.level;
}

interface SpireDraw {
  body: Graphics;
  glow: Graphics;
  geo: CrystalGeometry;
}

export class CrystalSpireView {
  readonly root = new Container();
  private readonly glowLayer = new Container();
  private readonly glints = new Graphics();
  private readonly spires: SpireDraw[] = [];

  static wanted(spec: LevelSpec): boolean {
    return spec.terrain.pieces.some(isCrystalSpire);
  }

  constructor(
    spec: LevelSpec,
    outline: number,
    private readonly opts: { reducedMotion?: boolean } = {},
  ) {
    for (const p of spec.terrain.pieces) {
      if (!isCrystalSpire(p)) continue;
      const geo = crystalGeometry(p.id, p.points);
      const body = new Graphics();
      for (const q of geo.quads) body.poly(q.pts).fill({ color: q.color, alpha: q.alpha });
      for (const l of geo.lines) {
        body.moveTo(l.pts[0]!, l.pts[1]!);
        for (let i = 2; i < l.pts.length; i += 2) body.lineTo(l.pts[i]!, l.pts[i + 1]!);
        body.stroke({ width: l.width, color: l.color, alpha: l.alpha });
      }
      body.poly(p.points.flatMap((q) => [q.x, q.y])).stroke({ width: 1, color: outline, alpha: 0.95 });
      const glow = new Graphics();
      glow.poly(geo.glow).fill({ color: GLOW, alpha: 0.35 });
      glow.blendMode = 'add';
      this.root.addChild(body);
      this.glowLayer.addChild(glow);
      this.spires.push({ body, glow, geo });
    }
    this.glints.blendMode = 'add';
    this.root.addChild(this.glowLayer, this.glints);
  }

  private readonly glowState: CrystalGlowState = { level: -1, lastMs: -1 };

  /** Per frame: cull to the view at origin `o`, glow by the sun's charge (0..1), twinkle. */
  update(o: Vec2, nowMs: number, sunCharge: number): void {
    const x1 = o.x + VIEW_WIDTH;
    const y1 = o.y + VIEW_HEIGHT;
    const glowAlpha = crystalGlowAlpha(this.glowState, nowMs, sunCharge, this.opts.reducedMotion === true);
    const g = this.glints;
    g.clear();
    const t = nowMs / 1000;
    for (const s of this.spires) {
      const b = s.geo.bbox;
      const vis = b.x1 + 4 > o.x && b.x0 - 4 < x1 && b.y1 + 4 > o.y && b.y0 - 4 < y1;
      s.body.visible = vis;
      s.glow.visible = vis;
      if (!vis) continue;
      s.glow.alpha = glowAlpha;
      for (const p of s.geo.glints) {
        // brief sparkles: sharp peaks of a slow wave, brighter while the sun charges
        const w = this.opts.reducedMotion ? 0.35 : Math.max(0, Math.sin(t * 1.3 + p.phase)) ** 12;
        const a = Math.min(1, w * (0.7 + 0.5 * sunCharge));
        if (a < 0.04) continue;
        const r = p.size + 2 * w;
        g.rect(Math.round(p.x) - 1, Math.round(p.y - r), 1, Math.round(2 * r) + 1).fill({ color: GLINT, alpha: a });
        g.rect(Math.round(p.x - r) - 1, Math.round(p.y), Math.round(2 * r) + 1, 1).fill({ color: GLINT, alpha: a });
        g.rect(Math.round(p.x) - 2, Math.round(p.y) - 1, 3, 3).fill({ color: GLINT, alpha: a * 0.5 });
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
