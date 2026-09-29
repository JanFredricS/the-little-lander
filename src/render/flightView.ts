/**
 * S1 placeholder rendering of the flight systems (rectangles and circles —
 * art is S2's job): the vessel per mode with engine flames, harpoon ropes,
 * gravity / brittle / wind zones, radiation emitters + pulses, debris, goo,
 * orbs, fuel pickups and beacon sites. Everything in world px; added to the
 * LevelView's world container.
 */

import { Container, Graphics } from 'pixi.js';
import type { LevelSpec, VesselMode } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import type { VesselGeometry } from '../physics/vessel';
import { ropePolyline } from './ropeLine';

const HULL_COLORS: Record<VesselMode, number> = {
  csm: 0xc8ccd8,
  lander: 0xd8c080,
  harpoon: 0xa8c8e0,
  harpoonThrust: 0x90d0b0,
};

/** Seconds a radiation pulse line stays visible. */
const PULSE_FLASH = 0.35;

export class FlightView {
  /** Behind terrain-level props: zones, markers. */
  readonly under = new Container();
  /** In front: bodies, ropes, vessel, pulses. */
  readonly over = new Container();
  private readonly zones = new Graphics();
  private readonly dynamic = new Graphics();
  private readonly vessel = new Container();
  private readonly hull = new Graphics();
  private readonly flames = new Graphics();
  private readonly fx = new Graphics();
  private hullMode: VesselMode | null = null;

  constructor(private readonly session: LevelSession) {
    this.drawZones(session.spec);
    this.under.addChild(this.zones);
    this.vessel.addChild(this.flames, this.hull);
    this.over.addChild(this.dynamic, this.vessel, this.fx);
  }

  render(alpha: number, nowMs: number): void {
    const s = this.session;
    const p = s.physics;
    const env = s.env;
    const t = s.simTime;
    const g = this.dynamic.clear();
    const flicker = Math.floor(nowMs / 60) % 2 === 0;

    // gravity zone indicator is static; beacon sites + pickups dynamic
    for (const site of env.beacons.sites) {
      const e = site.entity;
      g.rect(e.x - e.w / 2, e.y - 3, e.w, 3).fill(site.planted ? 0x60ff90 : 0x3090ff);
      if (site.planted) {
        g.rect(e.x - 1, e.y - 26, 2, 23).fill(0xd0d0d0);
        g.circle(e.x, e.y - 28, 3).fill(flicker ? 0x60ff90 : 0x30a060);
      } else if (site.hold > 0) {
        g.rect(e.x - e.w / 2, e.y - 8, e.w * Math.min(1, site.hold / Math.max(0.01, e.holdSec)), 3).fill(0x60ff90);
      }
    }
    for (const pk of env.pickups.pickups) {
      if (pk.collected) continue;
      const e = pk.entity;
      if (e.kind === 'orb') g.circle(e.x, e.y, pk.radius * (0.7 + 0.15 * Math.sin(nowMs / 200))).fill(0x60f0ff);
      else g.rect(e.x - pk.radius * 0.6, e.y - pk.radius * 0.8, pk.radius * 1.2, pk.radius * 1.6).fill(0xf0c040);
    }

    // radiation emitters: charge glow
    for (const em of env.radiation.emitters) {
      const c = env.radiation.charge(em, t);
      g.circle(em.spec.x, em.spec.y, 10 + 14 * c).fill({ color: 0xfff0a0, alpha: 0.25 + 0.6 * c });
      g.circle(em.spec.x, em.spec.y, 8).fill(0xfffff0);
    }

    for (const d of env.debris.pieces) {
      if (!p.hasBody(d.body)) continue;
      const tr = p.getInterpolatedTransform(d.body, alpha);
      g.circle(mToPx(tr.x), mToPx(tr.y), d.radius).fill(d.burning ? (flicker ? 0xff8030 : 0xffc040) : 0x807870);
    }
    for (const b of env.goo.balls) {
      if (!p.hasBody(b.body)) continue;
      const tr = p.getInterpolatedTransform(b.body, alpha);
      const r = env.tuning.goo.radius;
      g.circle(mToPx(tr.x), mToPx(tr.y), r).fill(b.burn > 0 ? 0xff60c0 : b.attached ? 0x8030a0 : 0xb050e0);
    }

    // ropes
    const vs = s.state;
    const vt = p.getInterpolatedTransform(s.vessel.body, alpha);
    const geo = s.vessel.geometry;
    if (vs.ropeState && geo.mount) {
      const c = Math.cos(vt.angle);
      const sn = Math.sin(vt.angle);
      const mx = mToPx(vt.x) + c * geo.mount.x - sn * geo.mount.y;
      const my = mToPx(vt.y) + sn * geo.mount.x + c * geo.mount.y;
      for (const gun of vs.ropeState.guns) {
        if (gun.phase === 'idle' || !gun.head) continue;
        const color = gun.brittleTimeLeft !== undefined ? 0xff9040 : gun.phase === 'flying' ? 0xa0a0a0 : 0xe0d0b0;
        // Anchored: sags when reeled out past the chord, straight under tension.
        // Flying: paid out as it goes (taut).
        const len = gun.phase === 'anchored' ? (gun.length ?? 0) : 0;
        const pts = ropePolyline({ x: mx, y: my }, gun.head, len);
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.stroke({ width: 1, color });
        g.rect(gun.head.x - 2, gun.head.y - 2, 4, 4).fill(color);
      }
    }

    // vessel
    if (this.hullMode !== s.vessel.mode) this.drawHull(s.vessel.mode, geo);
    this.vessel.position.set(mToPx(vt.x), mToPx(vt.y));
    this.vessel.rotation = vt.angle;
    this.vessel.alpha = vs.crashed ? 0.4 : 1;
    const f = this.flames.clear();
    for (const n of geo.nozzles) {
      if (!vs.engines[n.engine] || !flicker) continue;
      const big = n.engine === 'main';
      const w = big ? 8 : 5;
      const h = big ? 16 + ((nowMs / 40) % 6) : 10 + ((nowMs / 40) % 4);
      f.poly([n.x - w / 2, n.y, n.x + w / 2, n.y, n.x, n.y + h]).fill(0xffb040);
    }

    // radiation pulse flash
    const fx = this.fx.clear();
    for (const em of env.radiation.emitters) {
      const last = em.last;
      if (!last || t - last.at > PULSE_FLASH || !last.inRange) continue;
      const end = last.blockedAt ?? last.target;
      fx.moveTo(em.spec.x, em.spec.y).lineTo(end.x, end.y).stroke({ width: last.hit ? 3 : 1, color: last.hit ? 0xff4040 : 0x909090 });
    }
    // wind telegraph / gust streaks around the vessel
    for (const a of env.wind.active) {
      const dir = Math.sign(a.gust.accel.x) || 1;
      const color = a.phase === 'warning' ? 0xffe060 : 0xffffff;
      for (let i = 0; i < (a.phase === 'warning' ? 2 : 5); i++) {
        const y = vs.pos.y - 40 + i * 20;
        const x = vs.pos.x - 60 * dir + (((nowMs / 3) * dir + i * 37) % 120);
        fx.moveTo(x, y).lineTo(x + 18 * dir, y).stroke({ width: 1, color, alpha: a.phase === 'warning' ? 0.6 : 0.9 });
      }
    }
  }

  destroy(): void {
    this.under.destroy({ children: true });
    this.over.destroy({ children: true });
  }

  private drawHull(mode: VesselMode, geo: VesselGeometry): void {
    this.hullMode = mode;
    const h = this.hull.clear();
    geo.boxes.forEach((b, i) => {
      h.rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h).fill(i === 0 ? HULL_COLORS[mode] : 0x909090);
    });
    // nose marker
    const top = geo.boxes[0]!;
    h.rect(-2, top.y - top.h / 2, 4, 4).fill(0xf0b030);
    for (const n of geo.nozzles) h.rect(n.x - 2, n.y - 2, 4, 3).fill(0x505050);
    if (geo.mount) h.circle(geo.mount.x, geo.mount.y, 2).fill(0x303030);
  }

  private drawZones(spec: LevelSpec): void {
    const g = this.zones;
    for (const z of spec.zones) {
      switch (z.kind) {
        case 'gravityZone': {
          const pts = z.polygon ?? [
            { x: z.rect.x, y: z.rect.y },
            { x: z.rect.x + z.rect.w, y: z.rect.y },
            { x: z.rect.x + z.rect.w, y: z.rect.y + z.rect.h },
            { x: z.rect.x, y: z.rect.y + z.rect.h },
          ];
          g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: 0x7040ff, alpha: 0.12 });
          const gl = Math.hypot(z.gravity.x, z.gravity.y) || 1;
          const ux = z.gravity.x / gl;
          const uy = z.gravity.y / gl;
          for (let x = z.rect.x + 40; x < z.rect.x + z.rect.w; x += 80) {
            for (let y = z.rect.y + 40; y < z.rect.y + z.rect.h; y += 80) {
              g.moveTo(x, y).lineTo(x + ux * 16, y + uy * 16).stroke({ width: 2, color: 0x9070ff, alpha: 0.5 });
              g.circle(x + ux * 16, y + uy * 16, 2).fill({ color: 0x9070ff, alpha: 0.6 });
            }
          }
          break;
        }
        case 'brittleRegion':
          g.rect(z.rect.x, z.rect.y, z.rect.w, z.rect.h).fill({ color: 0xff8030, alpha: 0.15 });
          break;
        case 'windGustSchedule':
          if (z.rect) g.rect(z.rect.x, z.rect.y, z.rect.w, z.rect.h).stroke({ width: 1, color: 0xe0e0ff, alpha: 0.25 });
          break;
        case 'radiationEmitter':
          g.circle(z.x, z.y, z.range).stroke({ width: 1, color: 0xfff0a0, alpha: 0.2 });
          break;
        default:
          break;
      }
    }
    for (const e of spec.entities) {
      if (e.kind === 'debrisSpawner') g.rect(e.area.x, e.area.y, e.area.w, e.area.h).fill({ color: 0xa08060, alpha: 0.1 });
      if (e.kind === 'gooSpawner') {
        g.circle(e.x, e.y, e.triggerRadius).stroke({ width: 1, color: 0xb050e0, alpha: 0.2 });
        g.circle(e.x, e.y, 10).fill({ color: 0x602080, alpha: 0.8 });
      }
    }
  }
}
