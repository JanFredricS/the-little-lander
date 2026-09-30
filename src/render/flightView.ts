/**
 * Rendering of the flight systems. The vessel is S2 pixel art: the mode's
 * sprite at native size, fitted onto the S1 collision geometry
 * (vesselFit.ts), with animated flames on the sprite's engine anchors
 * (getVesselAnchors) driven by VesselState.engines, and harpoon-head
 * sprites on the ropes.
 *
 * S8 visual pass: pickups (obj.orb / obj.fuel), beacon sites and planted
 * beacons (obj.beaconSite / obj.beacon), goo (obj.goo), debris (theme
 * boulders / collapse rubble / obj.debris*), rope (obj.ropeSegment tiled
 * along the sagging polyline), wind (fx.windStreak) are pooled sprites
 * (spritePool.ts: no per-frame allocation). Gravity zones are a faint tint
 * with chevrons drifting along the zone's gravity (culled to the view).
 * Brittle rock is painted as cracks INTO the terrain chunks
 * (terrainTiles.ts), not here. Everything in world px; added to the
 * LevelView's world container.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, GravityZone, LevelSpec, SpriteFrame, SpriteName, ThemeId, Vec2, VesselMode } from '../contracts';
import { getVesselAnchors, type EngineAnchor } from '../art/sprites/vessels';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import type { VesselGeometry } from '../physics/vessel';
import { ropePolyline } from './ropeLine';
import { SpritePool, SpriteTextures } from './spritePool';
import { MODE_SPRITES, vesselArtOffsetY, vesselFrame } from './vesselFit';

/** Flame animation frame period (ms). */
const FLAME_FRAME_MS = 60;
/** Generic sprite animation period (ms) for orbs, goo, beacons. */
const ANIM_MS = 140;
/** Rope segment sprite length (px, obj.ropeSegment is 2x4). */
const ROPE_STEP = 4;
/** Gravity-zone chevron grid spacing (px). */
const CHEVRON_GRID = 48;

function spriteOf(frame: SpriteFrame): Sprite {
  const s = new Sprite(Texture.from(frame.canvas as HTMLCanvasElement));
  s.anchor.set(frame.pivot.x / frame.width, frame.pivot.y / frame.height);
  return s;
}

/** Seconds a radiation pulse line stays visible. */
const PULSE_FLASH = 0.35;

/** Falling-debris sprites per theme: [small (<= 6 px radius), large] with their native diameter. */
const DEBRIS_SPRITES: Partial<Record<ThemeId, { small: [SpriteName, number]; large: [SpriteName, number] }>> = {
  asteroid: { small: ['prop.boulderSmall', 12], large: ['prop.boulderMedium', 24] },
  collapse: { small: ['obj.debrisSmall', 8], large: ['prop.fallingDebris', 16] },
};
const DEFAULT_DEBRIS = { small: ['obj.debrisSmall', 8] as [SpriteName, number], large: ['obj.debrisLarge', 16] as [SpriteName, number] };

export class FlightView {
  /** Behind terrain-level props: zones, markers. */
  readonly under = new Container();
  /** In front: bodies, ropes, vessel, pulses. */
  readonly over = new Container();
  private readonly zones = new Graphics();
  private readonly zoneFx = new Graphics();
  private readonly dynamic = new Graphics();
  private readonly vessel = new Container();
  /** Sprite-space layer (origin = sprite pivot), shifted onto the collision geometry. */
  private readonly vesselArt = new Container();
  private readonly hull = new Sprite(Texture.EMPTY);
  private readonly flames = new Container();
  private flameSprites: { anchor: EngineAnchor; sprite: Sprite }[] = [];
  private readonly heads = new Container();
  private readonly fx = new Graphics();
  private readonly theme: ThemeId;
  private hullKey = '';
  /** Shared texture cache (LevelView / S7LevelFx reuse it). */
  readonly tex: SpriteTextures;
  /** Markers in front of terrain (decor tiles would hide them), behind bodies: beacon sites. */
  private readonly markers: SpritePool;
  /** Bodies in front: pickups, beacons, debris, goo, rope. */
  private readonly bodies: SpritePool;
  private readonly wind: SpritePool;
  private readonly gravityZones: GravityZone[];
  private readonly debrisSprites: { small: [SpriteName, number]; large: [SpriteName, number] };

  constructor(
    private readonly session: LevelSession,
    private readonly art: ArtApi,
  ) {
    this.theme = session.spec.themeId;
    this.tex = new SpriteTextures(art, this.theme);
    this.gravityZones = session.spec.zones.filter((z): z is GravityZone => z.kind === 'gravityZone');
    this.debrisSprites = DEBRIS_SPRITES[this.theme] ?? DEFAULT_DEBRIS;
    this.drawZones(session.spec);
    const markerLayer = new Container();
    const bodyLayer = new Container();
    const windLayer = new Container();
    this.markers = new SpritePool(markerLayer, this.tex);
    this.bodies = new SpritePool(bodyLayer, this.tex);
    this.wind = new SpritePool(windLayer, this.tex);
    this.under.addChild(this.zones, this.zoneFx);
    this.vesselArt.addChild(this.flames, this.hull);
    this.vessel.addChild(this.vesselArt);
    this.over.addChild(markerLayer, bodyLayer, this.dynamic, this.heads, this.vessel, this.fx, windLayer);
  }

  /** `o` = view origin (world px of the view's top-left), for culling. */
  render(alpha: number, nowMs: number, o: Vec2 = { x: -1e9, y: -1e9 }): void {
    const s = this.session;
    const p = s.physics;
    const env = s.env;
    const t = s.simTime;
    const g = this.dynamic.clear();
    const anim = Math.floor(nowMs / ANIM_MS);
    const flicker = Math.floor(nowMs / 60) % 2 === 0;
    const markers = this.markers;
    const bodies = this.bodies;
    markers.begin();
    bodies.begin();

    this.renderGravityZones(o, nowMs);

    // beacon sites (markers) + planted beacons
    for (const site of env.beacons.sites) {
      const e = site.entity;
      const n = Math.max(1, Math.round(e.w / 32));
      const x0 = e.x - (n * 32) / 2 + 16;
      // unplanted: chevrons blink green; planted: dim pad with the beacon on it
      const f = site.planted ? 1 : Math.floor(nowMs / 400) % 2;
      for (let i = 0; i < n; i++) markers.next('obj.beaconSite', f, x0 + i * 32, e.y);
      if (!site.planted) {
        // landing zone: a faint pulsing column with corner brackets
        const zh = env.tuning.beacon.zoneHeight;
        const pulse = 0.5 + 0.5 * Math.sin(nowMs / 350);
        const l = e.x - e.w / 2;
        g.rect(l, e.y - zh, e.w, zh).fill({ color: 0x60ff90, alpha: 0.08 + 0.07 * pulse });
        for (const [x, w] of [
          [l, 6],
          [l + e.w - 6, 6],
        ] as const) {
          g.rect(x, e.y - zh, w, 1).fill({ color: 0x60ff90, alpha: 0.7 });
          g.rect(x === l ? l : l + e.w - 1, e.y - zh, 1, 6).fill({ color: 0x60ff90, alpha: 0.7 });
        }
      }
      if (site.planted) bodies.next('obj.beacon', anim, e.x, e.y);
      else if (site.hold > 0) {
        const k = Math.min(1, site.hold / Math.max(0.01, e.holdSec));
        g.rect(e.x - e.w / 2, e.y - 10, e.w, 3).fill({ color: 0x0c1a10, alpha: 0.8 });
        g.rect(e.x - e.w / 2, e.y - 10, e.w * k, 3).fill(0x60ff90);
      }
    }
    for (const pk of env.pickups.pickups) {
      if (pk.collected) continue;
      const e = pk.entity;
      const bob = Math.round(Math.sin(nowMs / 300 + e.x * 0.01) * 2);
      if (e.kind === 'orb') bodies.next('obj.orb', anim + (e.x | 0), e.x, e.y + bob);
      else {
        const sp = bodies.next('obj.fuel', 0, e.x, e.y + bob);
        sp.scale.set(pk.radius >= 12 ? 2 : 1);
        // a slow glint so canisters read as pickups against busy terrain
        if (Math.floor(nowMs / 90) % 24 === 0) sp.tint = 0xfff4c0;
      }
    }

    // radiation emitters: charge glow (the emitter's sun / core is a level prop)
    for (const em of env.radiation.emitters) {
      const c = env.radiation.charge(em, t);
      if (c <= 0.01) continue;
      const r = 24 + 60 * c;
      g.circle(em.spec.x, em.spec.y, r * 1.6).fill({ color: 0xfff0a0, alpha: 0.12 * c });
      g.circle(em.spec.x, em.spec.y, r).fill({ color: 0xfff0a0, alpha: 0.25 * c });
      const pulse = bodies.next('fx.radiationPulse', Math.floor(c * 3.99), em.spec.x, em.spec.y);
      pulse.scale.set(1 + 2 * c);
      pulse.alpha = 0.4 + 0.5 * c;
    }

    const { small, large } = this.debrisSprites;
    for (const d of env.debris.pieces) {
      if (!p.hasBody(d.body)) continue;
      const tr = p.getInterpolatedTransform(d.body, alpha);
      const x = mToPx(tr.x);
      const y = mToPx(tr.y);
      if (d.burning) {
        const sp = bodies.next('obj.debrisBurning', anim, x, y);
        sp.scale.set(Math.max(0.6, (d.radius * 2) / 12));
        continue;
      }
      const [name, size] = d.radius <= 6 ? small : large;
      const sp = bodies.next(name, 0, x, y);
      sp.rotation = tr.angle;
      sp.scale.set((d.radius * 2) / size);
    }
    for (const b of env.goo.balls) {
      if (!p.hasBody(b.body)) continue;
      const tr = p.getInterpolatedTransform(b.body, alpha);
      const sp = bodies.next('obj.goo', anim + (b.attached ? 2 : 0), mToPx(tr.x), mToPx(tr.y));
      sp.scale.set((env.tuning.goo.radius * 2) / 12);
      if (b.burn > 0) sp.tint = flicker ? 0xffb0a0 : 0xff7060;
      else if (b.attached) sp.tint = 0xd0b0e0;
    }

    // ropes (segment sprites) + harpoon heads (sprite, tip first along the rope)
    let headCount = 0;
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
        const tint = gun.brittleTimeLeft !== undefined ? (flicker ? 0xffa050 : 0xff7030) : gun.phase === 'flying' ? 0xc8c8c8 : 0xffffff;
        // Anchored: sags when reeled out past the chord, straight under tension.
        // Flying: paid out as it goes (taut).
        const len = gun.phase === 'anchored' ? (gun.length ?? 0) : 0;
        const pts = ropePolyline({ x: mx, y: my }, gun.head, len);
        this.rope(pts, tint);
        const head = this.headSprite(headCount++);
        head.position.set(gun.head.x, gun.head.y);
        const prev = pts[pts.length - 2] ?? { x: mx, y: my };
        head.rotation = Math.atan2(gun.head.x - prev.x, -(gun.head.y - prev.y));
      }
    }
    this.heads.children.forEach((h, i) => (h.visible = i < headCount));
    markers.end();
    bodies.end();

    // vessel
    const frame = vesselFrame(s.vessel.mode, vs.landed);
    this.syncHull(s.vessel.mode, frame, geo);
    this.vessel.position.set(mToPx(vt.x), mToPx(vt.y));
    this.vessel.rotation = vt.angle;
    this.vessel.alpha = vs.crashed ? 0.4 : 1;
    const flameFrame = Math.floor(nowMs / FLAME_FRAME_MS);
    for (const { anchor, sprite } of this.flameSprites) {
      sprite.visible = !vs.crashed && !!vs.engines[anchor.engine];
      if (sprite.visible) sprite.texture = this.tex.get(anchor.flame as SpriteName, flameFrame).tex;
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
    const wind = this.wind;
    wind.begin();
    for (const a of env.wind.active) {
      const dir = Math.sign(a.gust.accel.x) || 1;
      const warning = a.phase === 'warning';
      for (let i = 0; i < (warning ? 2 : 5); i++) {
        const y = vs.pos.y - 40 + i * 20;
        const x = vs.pos.x - 60 * dir + (((nowMs / 3) * dir + i * 37) % 120);
        const sp = wind.next('fx.windStreak', Math.floor(nowMs / 90) + i, Math.round(x), Math.round(y));
        sp.scale.x = dir;
        sp.alpha = warning ? 0.6 : 0.9;
        if (warning) sp.tint = 0xffe060;
      }
    }
    wind.end();
  }

  destroy(): void {
    this.under.destroy({ children: true });
    this.over.destroy({ children: true });
  }

  /** Tile obj.ropeSegment along the polyline (one sprite per 4 px). */
  private rope(pts: readonly Vec2[], tint: number): void {
    let carry = 0; // distance into the current segment where the next sprite starts
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      const rot = Math.atan2(-dx, dy);
      let d = carry;
      for (; d < l; d += ROPE_STEP) {
        const sp = this.bodies.next('obj.ropeSegment', 0, a.x + (dx * d) / l, a.y + (dy * d) / l);
        sp.rotation = rot;
        if (tint !== 0xffffff) sp.tint = tint;
      }
      carry = d - l;
    }
  }

  /** Chevrons drifting along each gravity zone's pull, only in zones overlapping the view. */
  private renderGravityZones(o: Vec2, nowMs: number): void {
    const g = this.zoneFx.clear();
    for (const z of this.gravityZones) {
      const r = z.rect;
      const vx0 = Math.max(r.x, o.x);
      const vy0 = Math.max(r.y, o.y);
      const vx1 = Math.min(r.x + r.w, o.x + VIEW_WIDTH);
      const vy1 = Math.min(r.y + r.h, o.y + VIEW_HEIGHT);
      if (vx0 >= vx1 || vy0 >= vy1) continue;
      const gl = Math.hypot(z.gravity.x, z.gravity.y);
      if (gl < 1e-6) continue;
      const ux = z.gravity.x / gl;
      const uy = z.gravity.y / gl;
      const shift = ((nowMs / 1000) * 14 * Math.min(2, gl / 3)) % CHEVRON_GRID;
      const sx = ux * shift;
      const sy = uy * shift;
      const gx0 = Math.floor((vx0 - r.x) / CHEVRON_GRID) - 1;
      const gy0 = Math.floor((vy0 - r.y) / CHEVRON_GRID) - 1;
      for (let gy = gy0; r.y + gy * CHEVRON_GRID < vy1; gy++) {
        for (let gx = gx0; r.x + gx * CHEVRON_GRID < vx1; gx++) {
          const cx = Math.round(r.x + gx * CHEVRON_GRID + CHEVRON_GRID / 2 + sx);
          const cy = Math.round(r.y + gy * CHEVRON_GRID + CHEVRON_GRID / 2 + sy);
          if (cx < r.x + 4 || cx > r.x + r.w - 4 || cy < r.y + 4 || cy > r.y + r.h - 4) continue;
          if (z.polygon && !inPolygon(z.polygon, cx, cy)) continue;
          // a 5 px "V" pointing along the pull (perpendicular = (-uy, ux))
          const px = -uy * 3;
          const py = ux * 3;
          g.moveTo(cx - px - ux * 3, cy - py - uy * 3)
            .lineTo(cx, cy)
            .lineTo(cx + px - ux * 3, cy + py - uy * 3)
            .stroke({ width: 1, color: 0xb8a0ff, alpha: 0.55 });
        }
      }
    }
  }

  /** Swap the hull sprite / flame anchors when the mode or pose changes. */
  private syncHull(mode: VesselMode, frame: number, geo: VesselGeometry): void {
    const key = `${mode}#${frame}`;
    if (key === this.hullKey) return;
    this.hullKey = key;
    const name = MODE_SPRITES[mode];
    const hf = this.art.getSprite(name, frame, this.theme);
    this.hull.texture = Texture.from(hf.canvas as HTMLCanvasElement);
    this.hull.anchor.set(hf.pivot.x / hf.width, hf.pivot.y / hf.height);
    // native size, ground line on the collision bottom (hull / feet)
    this.vesselArt.position.set(0, vesselArtOffsetY(name, geo.h, frame));
    for (const f of this.flameSprites) f.sprite.destroy();
    const anchors = getVesselAnchors(name).engines;
    this.flameSprites = (anchors[frame] ?? anchors[0] ?? []).map((anchor) => {
      const sprite = spriteOf(this.art.getSprite(anchor.flame as SpriteName, 0, this.theme));
      // anchors are px from the sprite's top-left; flames point down (+y) unrotated
      sprite.position.set(anchor.x - hf.pivot.x, anchor.y - hf.pivot.y);
      sprite.rotation = Math.atan2(-anchor.dir.x, anchor.dir.y);
      sprite.visible = false;
      this.flames.addChild(sprite);
      return { anchor, sprite };
    });
  }

  private headSprite(i: number): Sprite {
    const existing = this.heads.children[i];
    if (existing) return existing as Sprite;
    const s = spriteOf(this.art.getSprite('obj.harpoonHead', 0, this.theme));
    this.heads.addChild(s);
    return s;
  }

  /** Static zone art: a faint gravity-zone tint with a 1 px border, goo nests. */
  private drawZones(spec: LevelSpec): void {
    const g = this.zones;
    for (const z of spec.zones) {
      if (z.kind !== 'gravityZone') continue;
      const pts = z.polygon ?? [
        { x: z.rect.x, y: z.rect.y },
        { x: z.rect.x + z.rect.w, y: z.rect.y },
        { x: z.rect.x + z.rect.w, y: z.rect.y + z.rect.h },
        { x: z.rect.x, y: z.rect.y + z.rect.h },
      ];
      const flat = pts.flatMap((p) => [p.x, p.y]);
      g.poly(flat).fill({ color: 0x7040ff, alpha: 0.08 });
      g.poly(flat).stroke({ width: 1, color: 0x9070ff, alpha: 0.3 });
    }
    // goo nests: a cluster of dormant blobs where a spawner sits
    for (const e of spec.entities) {
      if (e.kind !== 'gooSpawner') continue;
      for (const [dx, dy, f] of [
        [-5, 2, 0],
        [5, 3, 2],
        [0, -3, 1],
      ] as const) {
        const sp = this.tex.get('obj.goo', f);
        const s = new Sprite(sp.tex);
        s.anchor.set(sp.ax, sp.ay);
        s.position.set(e.x + dx, e.y + dy);
        s.tint = 0x9a70b0;
        this.under.addChild(s);
      }
    }
  }
}

function inPolygon(poly: readonly Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
