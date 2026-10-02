/**
 * Crumbling platforms (CrumblePlatformEntity, map 8): a static box
 * (centre x, y; w × h) that starts shaking the first time the vessel touches
 * it and collapses `delaySec` later — the body is removed and a few chunks
 * (tagged 'debris': chip damage, rays pass through) fall away. The collapse
 * kill-front also crumbles any platform it overtakes (crumbleNow).
 *
 * Round 15 (spring isles): `platformCrumbling` / `platformCrumbled` events (sound +
 * dust), `oneWay` platforms (a OneWayGate on the box, see oneWay.ts) and `regrowSec`:
 * the platform grows back that long after the collapse, once the vessel is clear of its
 * box, so a fall never strands the climb. Regrowing (islet) platforms shed cosmetic
 * chunks that collide with nothing (no chip damage on the pilot below).
 */

import type { BodyHandle, CrumblePlatformEntity, Vec2 } from '../../contracts';
import { TAG_DEBRIS } from '../../physics/tags';
import { mToPx, pxToM } from '../../physics/units';
import { OneWayGate, VesselCorners } from './oneWay';
import type { LevelSystem, LevelSystemHost } from './types';

export const TAG_CRUMBLE = 'crumblePlatform';

export interface CrumbleState {
  entity: CrumblePlatformEntity;
  body: BodyHandle | null;
  /** Sim time of the first touch (null = untouched). */
  touchedAt: number | null;
  gone: boolean;
  /** Sim time of the collapse (null = standing). Round 15. */
  goneAt: number | null;
  /** One-way gate (oneWay platforms only). Round 15. */
  gate: OneWayGate | null;
}

interface Chunk {
  body: BodyHandle;
  size: number;
  bornAt: number;
}

const CHUNK_LIFE_SEC = 4;
/** Clearance (px) the vessel must have around a platform's box before it regrows. */
export const REGROW_CLEARANCE = 8;
/** Cosmetic chunk filter: collides with nothing. */
const GHOST_CHUNK = { category: 0x8000, mask: 0 } as const;

export class CrumbleSystem implements LevelSystem {
  readonly platforms: CrumbleState[];
  chunks: Chunk[] = [];
  private readonly byBody = new Map<BodyHandle, CrumbleState>();

  constructor(private readonly host: LevelSystemHost) {
    const p = host.physics;
    this.platforms = host.spec.entities
      .filter((e): e is CrumblePlatformEntity => e.kind === 'crumblePlatform')
      .map((entity) => {
        const s: CrumbleState = { entity, body: null, touchedAt: null, gone: false, goneAt: null, gate: null };
        this.build(s, p);
        return s;
      });
  }

  private build(s: CrumbleState, p = this.host.physics): void {
    const e = s.entity;
    const body = p.createBody({ type: 'static', position: { x: pxToM(e.x), y: pxToM(e.y) }, tag: TAG_CRUMBLE });
    p.addBox(body, pxToM(e.w / 2), pxToM(e.h / 2), { friction: 0.8 });
    s.body = body;
    s.gate = e.oneWay ? new OneWayGate(p, body, boxOutline(e)) : null;
    this.byBody.set(body, s);
  }

  /** Round 15: one-way platforms switch on / off for this step. */
  beforeStep(): void {
    let read = false;
    let v: VesselCorners | null = null;
    for (const s of this.platforms) {
      if (!s.gate || s.gone) continue;
      if (!read) {
        read = true;
        v = this.corners.read(this.host.physics, this.host.vessel) ? this.corners : null;
      }
      s.gate.update(v);
    }
  }

  /** Reused vessel corner scratch (round 15 audit L7). */
  private readonly corners = new VesselCorners();

  /** 0..1 progress towards collapse (render shake), 0 when untouched. */
  progress(s: CrumbleState): number {
    if (s.gone) return 1;
    if (s.touchedAt === null) return 0;
    const d = s.entity.delaySec;
    return d <= 0 ? 1 : Math.min(1, (this.host.simTime - s.touchedAt) / d);
  }

  afterStep(): void {
    const p = this.host.physics;
    const t = this.host.simTime;
    const v = this.host.vessel;
    if (this.byBody.size && p.hasBody(v.body)) {
      for (const part of v.parts) {
        if (!p.hasBody(part)) continue;
        for (const c of p.bodyContacts(part)) {
          const s = this.byBody.get(c.other);
          if (s && s.touchedAt === null) {
            s.touchedAt = t;
            this.host.emit({ type: 'platformCrumbling', entityId: s.entity.id, pos: { x: s.entity.x, y: s.entity.y - s.entity.h / 2 }, inSec: s.entity.delaySec });
          }
        }
      }
    }
    for (const s of this.platforms) if (!s.gone && s.touchedAt !== null && t - s.touchedAt >= s.entity.delaySec - 1e-9) this.collapse(s);
    for (const s of this.platforms) if (s.gone && s.entity.regrowSec !== undefined && s.goneAt !== null && t - s.goneAt >= s.entity.regrowSec - 1e-9) this.regrow(s);
    this.chunks = this.chunks.filter((c) => {
      const alive = p.hasBody(c.body) && t - c.bornAt < CHUNK_LIFE_SEC;
      if (!alive && p.hasBody(c.body)) p.destroyBody(c.body);
      return alive;
    });
  }

  /** Collapse immediately (the kill-front overtook it). */
  crumbleNow(id: string): void {
    const s = this.platforms.find((x) => x.entity.id === id);
    if (s && !s.gone) this.collapse(s);
  }

  chunkPoses(): { x: number; y: number; angle: number; size: number }[] {
    const p = this.host.physics;
    return this.chunks.filter((c) => p.hasBody(c.body)).map((c) => {
      const tr = p.getTransform(c.body);
      return { x: mToPx(tr.x), y: mToPx(tr.y), angle: tr.angle, size: c.size };
    });
  }

  destroy(): void {
    const p = this.host.physics;
    for (const c of this.chunks) if (p.hasBody(c.body)) p.destroyBody(c.body);
    for (const s of this.platforms) if (s.body !== null && p.hasBody(s.body)) p.destroyBody(s.body);
    this.chunks = [];
  }

  /** Grow back once the vessel is clear of the box (round 15). */
  private regrow(s: CrumbleState): void {
    const e = s.entity;
    const f = this.corners.read(this.host.physics, this.host.vessel) ? this.corners : null;
    const m = REGROW_CLEARANCE;
    if (f && !(f.x1 < e.x - e.w / 2 - m || f.x0 > e.x + e.w / 2 + m || f.bottom < e.y - e.h / 2 - m || f.top > e.y + e.h / 2 + m)) return;
    s.gone = false;
    s.goneAt = null;
    s.touchedAt = null;
    this.build(s);
  }

  private collapse(s: CrumbleState): void {
    const p = this.host.physics;
    if (s.body !== null && p.hasBody(s.body)) {
      this.byBody.delete(s.body);
      p.destroyBody(s.body);
    }
    s.body = null;
    s.gate = null;
    s.gone = true;
    s.goneAt = this.host.simTime;
    s.touchedAt ??= this.host.simTime;
    const e = s.entity;
    const regrow = e.regrowSec !== undefined;
    this.host.emit({ type: 'platformCrumbled', entityId: e.id, pos: { x: e.x, y: e.y }, regrow });
    const n = Math.max(2, Math.min(4, Math.round(e.w / 30)));
    const size = Math.max(6, Math.min(e.h, e.w / n) * 0.8);
    for (let i = 0; i < n; i++) {
      const x = e.x - e.w / 2 + ((i + 0.5) * e.w) / n;
      const body = p.createBody({ type: 'dynamic', position: { x: pxToM(x), y: pxToM(e.y) }, angularVelocity: (i % 2 ? 1 : -1) * 1.5, tag: TAG_DEBRIS });
      p.addBox(body, pxToM(size / 2), pxToM(size / 2), { density: 1.5, friction: 0.5, sensorEvents: false, ...(regrow ? GHOST_CHUNK : {}) });
      this.chunks.push({ body, size, bornAt: this.host.simTime });
    }
  }
}

function boxOutline(e: CrumblePlatformEntity): Vec2[] {
  const x0 = e.x - e.w / 2;
  const y0 = e.y - e.h / 2;
  return [
    { x: x0, y: y0 },
    { x: x0 + e.w, y: y0 },
    { x: x0 + e.w, y: y0 + e.h },
    { x: x0, y: y0 + e.h },
  ];
}
