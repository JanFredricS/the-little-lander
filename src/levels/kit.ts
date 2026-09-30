/**
 * Level-authoring kit (shared by the S6/S7 map modules): small, pure helpers
 * that turn a few design numbers into contract-shaped terrain pieces. All
 * output is plain LevelSpec data (world px, y-down); nothing here touches
 * physics or rendering. Everything seeded is deterministic.
 *
 *  - box / slab            axis-aligned rectangular polygons (beams, walls, pads)
 *  - blob / island         star-shaped rock / floating-island outlines
 *  - ground / ceiling      open polylines, with optional seeded roughness
 *  - tube                  a winding cave passage: the two solid side regions
 *                          left and right of a centre line with per-point widths
 *  - roughen               jitter a polyline between fixed endpoints
 */

import type { TerrainMaterial, TerrainPiece, TerrainStyle, Vec2 } from '../contracts';
import { mulberry32 } from '../art/core/rng';

export const P = (x: number, y: number): Vec2 => ({ x, y });

type PieceOpts = Partial<Pick<TerrainPiece, 'friction' | 'restitution' | 'anchorable'>> & Partial<Omit<TerrainStyle, 'material'>>;

function style(material: TerrainMaterial, o: PieceOpts): TerrainStyle {
  const s: TerrainStyle = { material };
  if (o.surface !== undefined) s.surface = o.surface;
  if (o.decorDensity !== undefined) s.decorDensity = o.decorDensity;
  if (o.variantSeed !== undefined) s.variantSeed = o.variantSeed;
  return s;
}

function piece(id: string, kind: TerrainPiece['kind'], points: Vec2[], material: TerrainMaterial, o: PieceOpts = {}): TerrainPiece {
  const p: TerrainPiece = { id, kind, points: points.map(round), style: style(material, o) };
  if (o.friction !== undefined) p.friction = o.friction;
  if (o.restitution !== undefined) p.restitution = o.restitution;
  if (o.anchorable !== undefined) p.anchorable = o.anchorable;
  return p;
}

const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Axis-aligned rectangle outline, top-left (x, y), size w×h (clockwise in y-down). */
export function rectPoints(x: number, y: number, w: number, h: number): Vec2[] {
  return [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
}

/** Rectangle polygon, top-left (x, y), size w×h. */
export function box(id: string, x: number, y: number, w: number, h: number, material: TerrainMaterial, o: PieceOpts = {}): TerrainPiece {
  return piece(id, 'polygon', rectPoints(x, y, w, h), material, o);
}

/** Open ground polyline (solid below). Points must have increasing x. */
export function ground(id: string, points: Vec2[], material: TerrainMaterial, o: PieceOpts = {}): TerrainPiece {
  return piece(id, 'ground', points, material, o);
}

/** Open ceiling polyline (solid above). Points must have increasing x. */
export function ceiling(id: string, points: Vec2[], material: TerrainMaterial, o: PieceOpts = {}): TerrainPiece {
  return piece(id, 'ceiling', points, material, o);
}

export function polygon(id: string, points: Vec2[], material: TerrainMaterial, o: PieceOpts = {}): TerrainPiece {
  return piece(id, 'polygon', points, material, o);
}

/**
 * Subdivide each segment of a polyline into ~`step` px pieces and jitter the
 * inner points perpendicular to... simply in y by ±amp (x stays monotonic),
 * keeping the original vertices fixed. For ground / ceiling roughness.
 */
export function roughen(points: readonly Vec2[], step: number, amp: number, seed: number): Vec2[] {
  const rng = mulberry32(seed);
  const out: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push(a);
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    const flat = Math.abs(b.y - a.y) < 1; // keep deliberately flat pads flat
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push(P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + (flat ? 0 : rng.jitter(amp))));
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * Star-shaped rock outline around (cx, cy): `n` vertices at increasing
 * angles, radius rx/ry scaled by 1 ± rough. Always a simple polygon.
 * `flatTop` flattens the upper arc into a landable plateau at cy - ry·flatTop.
 */
export function blobPoints(cx: number, cy: number, rx: number, ry: number, seed: number, o: { n?: number; rough?: number; flatTop?: number } = {}): Vec2[] {
  const rng = mulberry32(seed);
  const n = o.n ?? 12;
  const rough = o.rough ?? 0.22;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.jitter(0.25 / n);
    const k = 1 + rng.jitter(rough);
    let x = cx + Math.cos(a) * rx * k;
    let y = cy + Math.sin(a) * ry * k;
    if (o.flatTop !== undefined && y < cy - ry * o.flatTop) y = cy - ry * o.flatTop;
    pts.push(P(x, y));
  }
  return dedupe(pts);
}

export function blob(id: string, cx: number, cy: number, rx: number, ry: number, material: TerrainMaterial, seed: number, o: { n?: number; rough?: number; flatTop?: number } & PieceOpts = {}): TerrainPiece {
  return piece(id, 'polygon', blobPoints(cx, cy, rx, ry, seed, o), material, o);
}

/**
 * Floating-island outline: a flat(ish) landable top from (x0, top) to
 * (x1, top) and a jagged hanging underside reaching `depth` px below the
 * top. The top is exactly flat across `pad` (fraction 0..1 of the width,
 * centred) so beacon sites / pads sit on a level surface.
 */
export function islandPoints(x0: number, x1: number, top: number, depth: number, seed: number, o: { pad?: number; bumps?: number } = {}): Vec2[] {
  const rng = mulberry32(seed);
  const w = x1 - x0;
  const pad = o.pad ?? 0.6;
  const bumps = o.bumps ?? 4;
  const cx = (x0 + x1) / 2;
  const pts: Vec2[] = [];
  // top edge, left -> right
  const nTop = Math.max(4, Math.round(w / 40));
  for (let i = 0; i <= nTop; i++) {
    const x = x0 + (w * i) / nTop;
    const inPad = Math.abs(x - cx) <= (w * pad) / 2;
    const edge = i === 0 || i === nTop;
    pts.push(P(x, top + (inPad ? 0 : edge ? 6 : rng.range(-bumps, bumps))));
  }
  // underside, right -> left: rounded shoulders then a hanging point
  const nBot = Math.max(6, Math.round(w / 30));
  for (let i = 1; i < nBot; i++) {
    const t = i / nBot; // 0 right .. 1 left
    const x = x1 - w * t;
    const s = Math.sin(Math.PI * t); // 0 at the ends, 1 in the middle
    const y = top + 10 + depth * Math.pow(s, 1.6) * (0.75 + rng.next() * 0.35);
    pts.push(P(x + rng.jitter(w / nBot / 3), y));
  }
  return dedupe(pts);
}

export function island(id: string, x0: number, x1: number, top: number, depth: number, material: TerrainMaterial, seed: number, o: { pad?: number; bumps?: number } & PieceOpts = {}): TerrainPiece {
  return piece(id, 'polygon', islandPoints(x0, x1, top, depth, seed, o), material, o);
}

export interface TubeNode {
  x: number;
  y: number;
  /** Passage width (px) at this node. */
  w: number;
}

/**
 * A winding passage through solid rock, entering at the world top edge
 * (first node y should be 0) and leaving at the bottom edge (last node y =
 * world height), or at any node when `open` ends are closed by the caller.
 * Returns the two solid regions as simple polygons: everything left of the
 * passage (closed along x = 0) and everything right of it (closed along
 * x = worldW). Boundary points get ±rough px of seeded jitter every ~step px.
 * The centre line must turn gently relative to the width (the offset curves
 * must not fold); the level validator checks the result.
 */
export function tube(idPrefix: string, nodes: readonly TubeNode[], worldW: number, material: TerrainMaterial, seed: number, o: { step?: number; rough?: number } & PieceOpts = {}): TerrainPiece[] {
  const { left, right } = tubeWalls(nodes, seed, o.step ?? 36, o.rough ?? 6);
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const leftPoly = [P(0, first.y), ...left, P(0, last.y)];
  const rightPoly = [...right, P(worldW, last.y), P(worldW, first.y)];
  return [piece(`${idPrefix}L`, 'polygon', leftPoly, material, o), piece(`${idPrefix}R`, 'polygon', rightPoly, material, o)];
}

/** Left / right boundary polylines of a tube (see tube()). */
export function tubeWalls(nodes: readonly TubeNode[], seed: number, step: number, rough: number): { left: Vec2[]; right: Vec2[] } {
  const rng = mulberry32(seed);
  // resample the centre line every ~step px, interpolating widths
  const c: TubeNode[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      c.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t });
    }
  }
  c.push(nodes[nodes.length - 1]!);
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < c.length; i++) {
    const p = c[i]!;
    const prev = c[Math.max(0, i - 1)]!;
    const next = c[Math.min(c.length - 1, i + 1)]!;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // travel direction (tx, ty); "left" of travel in y-down screen space is (ty, -tx)
    const nx = ty;
    const ny = -tx;
    const end = i === 0 || i === c.length - 1;
    const jl = end ? 0 : rng.jitter(rough);
    const jr = end ? 0 : rng.jitter(rough);
    // walking downward (ty > 0): travel-left is +x, so the WORLD-left wall is on the travel-right side
    left.push(round(P(p.x - nx * (p.w / 2 + jl), p.y - ny * (p.w / 2 + jl))));
    right.push(round(P(p.x + nx * (p.w / 2 + jr), p.y + ny * (p.w / 2 + jr))));
  }
  // walls of a vertical passage are functions x(y): dropping any point that
  // does not go strictly down removes the folds a tight turn or a fast width
  // change would put on the inner side (keeps the polygons simple)
  return { left: monotoneY(dedupe(left)), right: monotoneY(dedupe(right)) };
}

function monotoneY(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || p.y > q.y) out.push(p);
  }
  return out;
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q.x !== p.x || q.y !== p.y) out.push(p);
  }
  const a = out[0];
  const b = out[out.length - 1];
  if (out.length > 1 && a && b && a.x === b.x && a.y === b.y) out.pop();
  return out;
}

/** Surface y of an open polyline at x (linear interpolation; clamps outside). */
export function surfaceY(points: readonly Vec2[], x: number): number {
  if (x <= points[0]!.x) return points[0]!.y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
  }
  return points[points.length - 1]!.y;
}

/** Centre x and width of a vertical tube (nodes with increasing y) at world y. */
export function tubeAt(nodes: readonly TubeNode[], y: number): { x: number; w: number } {
  if (y <= nodes[0]!.y) return { x: nodes[0]!.x, w: nodes[0]!.w };
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!;
    const b = nodes[i]!;
    if (y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1);
      return { x: a.x + (b.x - a.x) * t, w: a.w + (b.w - a.w) * t };
    }
  }
  const l = nodes[nodes.length - 1]!;
  return { x: l.x, w: l.w };
}

/** Distance from p to an open polyline. */
export function distToPolyline(p: Vec2, line: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const lx = b.x - a.x;
    const ly = b.y - a.y;
    const l2 = lx * lx + ly * ly || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + lx * t), p.y - (a.y + ly * t)));
  }
  return best;
}

export interface ScatterOpts {
  /** y range to fill. */
  y0: number;
  y1: number;
  /** Rock radius range (px). */
  rMin: number;
  rMax: number;
  /** Placement attempts (the field's density knob). */
  tries: number;
  /** Min free gap between rocks and between a rock and the tube wall (px). */
  gap: number;
  /** Keep this clear radius around `line` (the designed flight line). */
  line?: readonly Vec2[];
  lineClear?: number;
  /** Already-placed circles to keep clear of. */
  avoid?: readonly { x: number; y: number; r: number }[];
  /** ry = r · aspect (default 0.75). */
  aspect?: number;
}

/**
 * Seeded rock field inside a vertical tube: circles placed by rejection
 * sampling (clear of each other, of the tube walls and of the designed
 * flight line), returned as centre + radii for blob(). Deterministic.
 */
export function scatterRocks(nodes: readonly TubeNode[], seed: number, o: ScatterOpts): { x: number; y: number; rx: number; ry: number }[] {
  const rng = mulberry32(seed);
  const placed: { x: number; y: number; r: number }[] = [...(o.avoid ?? [])];
  const out: { x: number; y: number; rx: number; ry: number }[] = [];
  const aspect = o.aspect ?? 0.75;
  for (let k = 0; k < o.tries; k++) {
    const y = rng.range(o.y0, o.y1);
    const r = rng.range(o.rMin, o.rMax);
    const t = tubeAt(nodes, y);
    const x = t.x + rng.jitter(t.w / 2);
    const bound = r * 1.25; // blobPoints rough 0.22 + margin
    if (Math.abs(x - t.x) + bound + o.gap > t.w / 2) continue;
    if (o.line && distToPolyline({ x, y }, o.line) < bound + (o.lineClear ?? 60)) continue;
    if (placed.some((c) => Math.hypot(c.x - x, c.y - y) < c.r + bound + o.gap)) continue;
    placed.push({ x, y, r: bound });
    out.push({ x: Math.round(x), y: Math.round(y), rx: Math.round(r), ry: Math.round(r * aspect) });
  }
  return out;
}

/** All y where a closed polygon's edges cross the vertical line at x (sorted). */
export function crossingsAt(points: readonly Vec2[], x: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) ys.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
  }
  return ys.sort((p, q) => p - q);
}

/** Top / bottom surface of a polygon piece at x (NaN when x misses it). */
export function topAt(points: readonly Vec2[], x: number): number {
  const ys = crossingsAt(points, x);
  return ys.length ? ys[0]! : NaN;
}
export function bottomAt(points: readonly Vec2[], x: number): number {
  const ys = crossingsAt(points, x);
  return ys.length ? ys[ys.length - 1]! : NaN;
}
