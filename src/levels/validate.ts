/**
 * Structural validation of a LevelSpec against the rules documented in
 * src/contracts/level.ts. Returns a list of human-readable errors (empty =
 * valid). Every shipped LevelSpec must validate (enforced by tests).
 */

import { ENTITY_KINDS, THEME_IDS, VESSEL_MODES } from '../contracts';
import type { EntitySpec, LevelSpec, Rect, TerrainPiece, TriggerSpec, Vec2, ZoneSpec } from '../contracts';
import { signedArea } from '../physics/units';
import { crossingsAt } from './kit';
import { PHYSICS_OVERRIDE_KEYS, overrideRangeError, resolveTuning, tuningConsistencyErrors } from '../physics/tuning';

export function validateLevel(spec: LevelSpec): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);
  const W = spec.worldSize?.w;
  const H = spec.worldSize?.h;

  if (!spec.id) err('id is empty');
  if (!spec.title) err('title is empty');
  if (!THEME_IDS.includes(spec.themeId)) err(`unknown themeId '${String(spec.themeId)}'`);
  if (!VESSEL_MODES.includes(spec.vesselMode)) err(`unknown vesselMode '${String(spec.vesselMode)}'`);
  if (!(pos(W) && pos(H))) {
    err('worldSize must have positive finite w and h');
    return errors; // nothing else can be checked meaningfully
  }

  const inside = (p: Vec2) => fin(p.x) && fin(p.y) && p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
  const rectOk = (r: Rect | undefined, what: string) => {
    if (!r || !(fin(r.x) && fin(r.y) && pos(r.w) && pos(r.h))) return err(`${what}: rect needs finite x/y and positive w/h`);
    if (!inside({ x: r.x, y: r.y }) || !inside({ x: r.x + r.w, y: r.y + r.h })) err(`${what}: rect outside the world`);
  };

  if (!inside(spec.spawn)) err('spawn outside the world');
  if (spec.spawn.angle !== undefined && !fin(spec.spawn.angle)) err('spawn.angle not finite');
  if (spec.startFuel !== undefined && !frac(spec.startFuel)) err('startFuel must be in 0..1');
  if (!vecOk(spec.gravity)) err('gravity must be a finite vector');
  if (spec.harpoonGuns !== undefined && spec.harpoonGuns !== 1 && spec.harpoonGuns !== 2) err('harpoonGuns must be 1 or 2');

  if (spec.gravityRamp) {
    const r = spec.gravityRamp;
    if (!(fin(r.from) && fin(r.to)) || r.from === r.to) err('gravityRamp: from/to must be finite and differ');
    if (!vecOk(r.gravityFrom) || !vecOk(r.gravityTo)) err('gravityRamp: gravities must be finite vectors');
  }

  // terrain
  const pieceIds = new Set<string>();
  for (const piece of spec.terrain?.pieces ?? []) {
    const what = `terrain '${piece.id}'`;
    if (!piece.id) err('terrain piece with empty id');
    else if (pieceIds.has(piece.id)) err(`${what}: duplicate id`);
    pieceIds.add(piece.id);
    checkPiece(piece, what, inside, err);
  }

  // entities
  const entities = new Map<string, EntitySpec>();
  for (const e of spec.entities ?? []) {
    const what = `entity '${e.id}'`;
    if (!e.id) err(`${e.kind} entity with empty id`);
    else if (entities.has(e.id)) err(`${what}: duplicate id`);
    entities.set(e.id, e);
    if (!ENTITY_KINDS.includes(e.kind)) err(`${what}: unknown kind '${String(e.kind)}'`);
    if (!inside(e)) err(`${what}: position outside the world`);
    checkEntity(e, what, err, rectOk);
  }

  // objectives (checked before zones/triggers so triggers can reference them)
  const objectiveIds = new Set<string>();
  if (!spec.objectives || spec.objectives.length === 0) err('level needs at least one objective');
  for (const o of spec.objectives ?? []) {
    const what = `objective '${o.id}'`;
    if (!o.id) err('objective with empty id');
    else if (objectiveIds.has(o.id)) err(`${what}: duplicate id`);
    objectiveIds.add(o.id);
    switch (o.kind) {
      case 'reachExit':
        if (entities.get(o.exitId)?.kind !== 'exitDock') err(`${what}: exitId '${o.exitId}' is not an exitDock entity`);
        break;
      case 'plantBeacons':
        if (!(Number.isInteger(o.count) && o.count >= 1)) err(`${what}: count must be a positive integer`);
        if (o.count > o.siteIds.length) err(`${what}: count exceeds the number of sites`);
        if (new Set(o.siteIds).size !== o.siteIds.length) err(`${what}: duplicate site ids`);
        for (const s of o.siteIds) if (entities.get(s)?.kind !== 'beaconSite') err(`${what}: '${s}' is not a beaconSite entity`);
        break;
      case 'collectOrbs': {
        const orbs = [...entities.values()].filter((e) => e.kind === 'orb').length;
        if (!(Number.isInteger(o.count) && o.count >= 1)) err(`${what}: count must be a positive integer`);
        if (o.count > orbs) err(`${what}: needs ${o.count} orbs but the level has ${orbs}`);
        break;
      }
      case 'surviveBoss':
        if (entities.get(o.bossEntityId)?.kind !== 'bossSpawn') err(`${what}: '${o.bossEntityId}' is not a bossSpawn entity`);
        break;
      default:
        err(`${what}: unknown kind '${String((o as { kind: unknown }).kind)}'`);
    }
  }

  const triggerOk = (t: TriggerSpec | undefined, what: string) => {
    if (!t) return;
    switch (t.kind) {
      case 'start':
        return;
      case 'time':
        if (!(fin(t.atSec) && t.atSec >= 0)) err(`${what}: trigger time must be >= 0`);
        return;
      case 'enterRegion':
        return rectOk(t.rect, `${what} trigger`);
      case 'objective':
        if (!objectiveIds.has(t.objectiveId)) err(`${what}: trigger references unknown objective '${t.objectiveId}'`);
        return;
      default:
        err(`${what}: unknown trigger kind`);
    }
  };

  for (const e of entities.values()) {
    if (e.kind === 'debrisSpawner' || e.kind === 'creature') triggerOk(e.activate, `entity '${e.id}'`);
    if (e.kind === 'blastDoor') triggerOk(e.close, `entity '${e.id}'`);
  }

  // zones
  const zoneIds = new Set<string>();
  for (const z of spec.zones ?? []) {
    const what = `zone '${z.id}'`;
    if (!z.id) err(`${z.kind} zone with empty id`);
    else if (zoneIds.has(z.id) || entities.has(z.id)) err(`${what}: duplicate id`);
    zoneIds.add(z.id);
    checkZone(z, what, err, rectOk, inside, triggerOk);
  }

  if (spec.modeSwitch) {
    if (!VESSEL_MODES.includes(spec.modeSwitch.to)) err(`modeSwitch: unknown mode '${String(spec.modeSwitch.to)}'`);
    if (spec.modeSwitch.to === spec.vesselMode) err('modeSwitch: target mode equals the start mode');
    triggerOk(spec.modeSwitch.trigger, 'modeSwitch');
  }

  // round 12: checkpoints
  const cpIds = new Set<string>();
  for (const c of spec.checkpoints ?? []) {
    const what = `checkpoint '${c.id}'`;
    if (!c.id) err('checkpoint with empty id');
    else if (cpIds.has(c.id)) err(`${what}: duplicate id`);
    cpIds.add(c.id);
    if (c.at === 'modeSwitch') {
      if (!spec.modeSwitch) err(`${what}: at 'modeSwitch' but the level has no modeSwitch`);
    } else if (c.at === 'beaconPlanted') {
      if (!(spec.entities ?? []).some((e) => e.kind === 'beaconSite' && e.id === c.siteId)) err(`${what}: at 'beaconPlanted' needs the siteId of a beaconSite (got '${String(c.siteId)}')`);
      else if ((spec.checkpoints ?? []).some((o) => o !== c && o.at === 'beaconPlanted' && o.siteId === c.siteId)) err(`${what}: another checkpoint already captures at site '${c.siteId}'`);
    } else err(`${what}: unknown 'at' '${String(c.at)}'`);
    if (c.respawn && (!inside(c.respawn) || (c.respawn.angle !== undefined && !fin(c.respawn.angle)))) err(`${what}: respawn outside the world`);
    else if (c.respawn) {
      const why = respawnSpotError(spec, c.respawn);
      if (why) err(`${what}: respawn ${why}`);
    }
  }

  if (spec.physicsOverrides) {
    const known = new Set(PHYSICS_OVERRIDE_KEYS);
    for (const [k, v] of Object.entries(spec.physicsOverrides)) {
      if (!fin(v)) err(`physicsOverrides '${k}' is not finite`);
      if (!known.has(k)) err(`physicsOverrides '${k}' is not a registered tuning key (see src/physics/tuning)`);
      else if (fin(v)) {
        const range = overrideRangeError(k, v);
        if (range) err(`physicsOverrides '${k}' = ${v} ${range}`);
      }
    }
    for (const e of tuningConsistencyErrors(resolveTuning(spec.physicsOverrides))) err(`physicsOverrides: ${e}`);
  }

  return errors;
}

/** Throws with all errors joined (for level registries / tests). */
export function assertValidLevel(spec: LevelSpec): LevelSpec {
  const errors = validateLevel(spec);
  if (errors.length) throw new Error(`Invalid level '${spec.id}':\n  - ${errors.join('\n  - ')}`);
  return spec;
}

// ------------------------------------------------------------------ helpers

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function pos(v: unknown): v is number {
  return fin(v) && v > 0;
}

function frac(v: number): boolean {
  return fin(v) && v >= 0 && v <= 1;
}

function vecOk(v: Vec2 | undefined): boolean {
  return !!v && fin(v.x) && fin(v.y);
}

function checkPolygon(points: readonly Vec2[], what: string, err: (m: string) => void): void {
  if (points.length < 3) return err(`${what}: polygon needs at least 3 points`);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length > 3 && first.x === last.x && first.y === last.y) err(`${what}: do not repeat the first point at the end`);
  if (Math.abs(signedArea(points)) < 1e-6) err(`${what}: polygon has zero area`);
  if (selfIntersects(points)) err(`${what}: polygon edges must not self-intersect`);
}

/** O(n²) check: any two non-adjacent edges touching or crossing. */
function selfIntersects(pts: readonly Vec2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsIntersect(a, b, pts[j]!, pts[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}

function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && onSegment(p1, q1, q2)) ||
    (d2 === 0 && onSegment(p2, q1, q2)) ||
    (d3 === 0 && onSegment(q1, p1, p2)) ||
    (d4 === 0 && onSegment(q2, p1, p2))
  );
}

function checkPiece(piece: TerrainPiece, what: string, inside: (p: Vec2) => boolean, err: (m: string) => void): void {
  if (!['ground', 'ceiling', 'polygon'].includes(piece.kind)) return err(`${what}: unknown kind '${String(piece.kind)}'`);
  const pts = piece.points ?? [];
  if (pts.some((p) => !inside(p))) err(`${what}: point outside the world`);
  if (piece.kind === 'polygon') checkPolygon(pts, what, err);
  else {
    if (pts.length < 2) err(`${what}: needs at least 2 points`);
    for (let i = 1; i < pts.length; i++) {
      if (!(pts[i]!.x > pts[i - 1]!.x)) {
        err(`${what}: ${piece.kind} points must have strictly increasing x (use a polygon for overhangs)`);
        break;
      }
    }
  }
  if (!piece.style?.material) err(`${what}: style.material missing`);
  if (piece.style?.decorDensity !== undefined && !frac(piece.style.decorDensity)) err(`${what}: decorDensity must be in 0..1`);
}

function checkEntity(e: EntitySpec, what: string, err: (m: string) => void, rectOk: (r: Rect | undefined, w: string) => void): void {
  switch (e.kind) {
    case 'staticProp':
      if (!(pos(e.w) && pos(e.h))) err(`${what}: w/h must be positive`);
      if (!e.sprite) err(`${what}: sprite missing`);
      break;
    case 'debrisSpawner':
      rectOk(e.area, what);
      if (!pos(e.ratePerSec)) err(`${what}: ratePerSec must be positive`);
      if (!(pos(e.sizeMin) && pos(e.sizeMax) && e.sizeMin <= e.sizeMax)) err(`${what}: need 0 < sizeMin <= sizeMax`);
      break;
    case 'gooSpawner':
      if (!(pos(e.triggerRadius) && pos(e.intervalSec) && pos(e.homingAccel))) err(`${what}: triggerRadius/intervalSec/homingAccel must be positive`);
      if (!(Number.isInteger(e.maxAlive) && e.maxAlive >= 1)) err(`${what}: maxAlive must be a positive integer`);
      break;
    case 'orb':
      if (!(fin(e.points) && e.points >= 0)) err(`${what}: points must be >= 0`);
      if (!frac(e.fuelRefill)) err(`${what}: fuelRefill must be in 0..1`);
      break;
    case 'beaconSite':
      if (!pos(e.w)) err(`${what}: w must be positive`);
      if (!(fin(e.holdSec) && e.holdSec >= 0)) err(`${what}: holdSec must be >= 0`);
      break;
    case 'movingIsland':
      checkPolygon(e.outline, what, err);
      if (e.path.length < 2) err(`${what}: path needs at least 2 waypoints`);
      if (!pos(e.periodSec)) err(`${what}: periodSec must be positive`);
      break;
    case 'vine':
      if (!pos(e.length)) err(`${what}: length must be positive`);
      if (!(Number.isInteger(e.segments) && e.segments >= 1)) err(`${what}: segments must be a positive integer`);
      break;
    case 'blastDoor':
      if (!(pos(e.w) && pos(e.h) && pos(e.closeDurationSec))) err(`${what}: w/h/closeDurationSec must be positive`);
      break;
    case 'creature':
      if (!(fin(e.speed) && e.speed >= 0)) err(`${what}: speed must be >= 0`);
      break;
    case 'bossSpawn':
      rectOk(e.arena, what);
      break;
    case 'fuelPickup':
      if (!(frac(e.amount) && e.amount > 0)) err(`${what}: amount must be in (0, 1]`);
      break;
    case 'exitDock':
      if (!(pos(e.w) && pos(e.h))) err(`${what}: w/h must be positive`);
      break;
    case 'looseRock':
      if (!(pos(e.radius) && pos(e.breakForce))) err(`${what}: radius/breakForce must be positive`);
      break;
    case 'crumblePlatform':
      if (!(pos(e.w) && pos(e.h))) err(`${what}: w/h must be positive`);
      if (!(fin(e.delaySec) && e.delaySec >= 0)) err(`${what}: delaySec must be >= 0`);
      break;
  }
}

function checkZone(
  z: ZoneSpec,
  what: string,
  err: (m: string) => void,
  rectOk: (r: Rect | undefined, w: string) => void,
  inside: (p: Vec2) => boolean,
  triggerOk: (t: TriggerSpec | undefined, w: string) => void,
): void {
  switch (z.kind) {
    case 'gravityZone':
      rectOk(z.rect, what);
      if (!vecOk(z.gravity)) err(`${what}: gravity must be a finite vector`);
      if (z.polygon) {
        checkPolygon(z.polygon, what, err);
        if (z.polygon.some((p) => !inside(p))) err(`${what}: polygon outside the world`);
      }
      break;
    case 'windGustSchedule':
      if (z.rect) rectOk(z.rect, what);
      if (z.gusts.length === 0) err(`${what}: no gusts`);
      for (const g of z.gusts) {
        if (!(fin(g.atSec) && g.atSec >= 0 && pos(g.durationSec) && vecOk(g.accel))) err(`${what}: gust needs atSec >= 0, durationSec > 0, finite accel`);
        if (g.silent !== undefined && typeof g.silent !== 'boolean') err(`${what}: gust silent must be a boolean`);
        if (g.warnSec !== undefined && !(fin(g.warnSec) && g.warnSec >= 0)) err(`${what}: warnSec must be >= 0`);
      }
      if (z.repeatEverySec !== undefined && !pos(z.repeatEverySec)) err(`${what}: repeatEverySec must be positive`);
      if (z.fade && !(fin(z.fade.y0) && fin(z.fade.y1) && z.fade.y0 !== z.fade.y1)) err(`${what}: fade needs finite y0 !== y1`);
      if (z.turbulence && !(fin(z.turbulence.seed) && fin(z.turbulence.amount) && z.turbulence.amount >= 0 && fin(z.turbulence.lateral) && z.turbulence.lateral >= 0 && pos(z.turbulence.hz)))
        err(`${what}: turbulence needs finite seed, amount >= 0, lateral >= 0, hz > 0`);
      if (z.speedCap !== undefined && !pos(z.speedCap)) err(`${what}: speedCap must be positive`);
      if (z.telegraphMargin !== undefined && !(fin(z.telegraphMargin) && z.telegraphMargin >= 0)) err(`${what}: telegraphMargin must be >= 0`);
      break;
    case 'radiationEmitter':
      if (!inside(z)) err(`${what}: emitter outside the world`);
      if (!(pos(z.range) && pos(z.periodSec))) err(`${what}: range/periodSec must be positive`);
      if (!(fin(z.warnSec) && z.warnSec >= 0 && z.warnSec <= z.periodSec)) err(`${what}: warnSec must be in 0..periodSec`);
      if (!frac(z.fuelLoss)) err(`${what}: fuelLoss must be in 0..1`);
      break;
    case 'brittleRegion':
      rectOk(z.rect, what);
      if (!pos(z.breakAfterSec)) err(`${what}: breakAfterSec must be positive`);
      break;
    case 'killFront':
      if (z.axis !== 'x' && z.axis !== 'y') err(`${what}: axis must be x or y`);
      if (!(fin(z.start) && fin(z.speed))) err(`${what}: start/speed must be finite`);
      triggerOk(z.activate, what);
      break;
    default:
      err(`${what}: unknown zone kind '${String((z as { kind: unknown }).kind)}'`);
  }
}

/** Max fall (px) from a checkpoint respawn point to the terrain below it: a resting spot, not a drop. */
export const RESPAWN_MAX_DROP = 40;

/**
 * Round 12: a checkpoint respawn must be a resting spot - in open air (not inside a
 * terrain piece), with terrain at most RESPAWN_MAX_DROP px below, and clear of every
 * beacon site's landing zone (a respawn must never plant a beacon by itself).
 * Static terrain only (moving islands are not a spot to respawn on).
 */
function respawnSpotError(spec: LevelSpec, p: Vec2): string | null {
  let below = Infinity;
  for (const piece of spec.terrain?.pieces ?? []) {
    if (piece.kind === 'polygon') {
      const ys = crossingsAt(piece.points, p.x);
      if (ys.filter((y) => y <= p.y).length % 2 === 1) return `inside terrain '${piece.id}'`;
      for (const y of ys) if (y > p.y) below = Math.min(below, y - p.y);
      continue;
    }
    // ground: open polyline, solid below it; ceiling: solid above it
    const y = polylineYAt(piece.points, p.x);
    if (y === null) continue;
    if (piece.kind === 'ground' ? p.y >= y : p.y <= y) return `inside terrain '${piece.id}'`;
    if (piece.kind === 'ground') below = Math.min(below, y - p.y);
  }
  if (below > RESPAWN_MAX_DROP) return `has no terrain within ${RESPAWN_MAX_DROP} px below`;
  for (const e of spec.entities) {
    if (e.kind === 'beaconSite' && Math.abs(p.x - e.x) <= e.w / 2 + 20 && Math.abs(p.y - e.y) <= 60) return `is in beacon site '${e.id}'s landing zone`;
  }
  return null;
}

/** y of a left-to-right polyline at x (null outside its x range). */
function polylineYAt(pts: readonly Vec2[], x: number): number | null {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (x >= a.x && x <= b.x) return b.x === a.x ? Math.min(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return null;
}
