/**
 * Crumbling platforms (CrumblePlatformEntity, map 8): a static box
 * (centre x, y; w × h) that starts shaking the first time the vessel touches
 * it and collapses `delaySec` later — the body is removed and a few chunks
 * (tagged 'debris': chip damage, rays pass through) fall away. The collapse
 * kill-front also crumbles any platform it overtakes (crumbleNow).
 */

import type { BodyHandle, CrumblePlatformEntity } from '../../contracts';
import { TAG_DEBRIS } from '../../physics/tags';
import { mToPx, pxToM } from '../../physics/units';
import type { LevelSystem, LevelSystemHost } from './types';

export const TAG_CRUMBLE = 'crumblePlatform';

export interface CrumbleState {
  entity: CrumblePlatformEntity;
  body: BodyHandle | null;
  /** Sim time of the first touch (null = untouched). */
  touchedAt: number | null;
  gone: boolean;
}

interface Chunk {
  body: BodyHandle;
  size: number;
  bornAt: number;
}

const CHUNK_LIFE_SEC = 4;

export class CrumbleSystem implements LevelSystem {
  readonly platforms: CrumbleState[];
  chunks: Chunk[] = [];
  private readonly byBody = new Map<BodyHandle, CrumbleState>();

  constructor(private readonly host: LevelSystemHost) {
    const p = host.physics;
    this.platforms = host.spec.entities
      .filter((e): e is CrumblePlatformEntity => e.kind === 'crumblePlatform')
      .map((entity) => {
        const body = p.createBody({ type: 'static', position: { x: pxToM(entity.x), y: pxToM(entity.y) }, tag: TAG_CRUMBLE });
        p.addBox(body, pxToM(entity.w / 2), pxToM(entity.h / 2), { friction: 0.8 });
        const s: CrumbleState = { entity, body, touchedAt: null, gone: false };
        this.byBody.set(body, s);
        return s;
      });
  }

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
          if (s && s.touchedAt === null) s.touchedAt = t;
        }
      }
    }
    for (const s of this.platforms) if (!s.gone && s.touchedAt !== null && t - s.touchedAt >= s.entity.delaySec - 1e-9) this.collapse(s);
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

  private collapse(s: CrumbleState): void {
    const p = this.host.physics;
    if (s.body !== null && p.hasBody(s.body)) {
      this.byBody.delete(s.body);
      p.destroyBody(s.body);
    }
    s.body = null;
    s.gone = true;
    s.touchedAt ??= this.host.simTime;
    const e = s.entity;
    const n = Math.max(2, Math.min(4, Math.round(e.w / 30)));
    const size = Math.max(6, Math.min(e.h, e.w / n) * 0.8);
    for (let i = 0; i < n; i++) {
      const x = e.x - e.w / 2 + ((i + 0.5) * e.w) / n;
      const body = p.createBody({ type: 'dynamic', position: { x: pxToM(x), y: pxToM(e.y) }, angularVelocity: (i % 2 ? 1 : -1) * 1.5, tag: TAG_DEBRIS });
      p.addBox(body, pxToM(size / 2), pxToM(size / 2), { density: 1.5, friction: 0.5, sensorEvents: false });
      this.chunks.push({ body, size, bornAt: this.host.simTime });
    }
  }
}
