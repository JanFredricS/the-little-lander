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
 * with chevrons drifting along the zone's gravity. Every per-frame element
 * (chevrons, beacon sites, pickups, radiation glow + pulse lines, debris,
 * goo, rope segments) is culled to the view rect (+CULL_MARGIN) before it
 * touches a pool or Graphics; the rope polyline is a reused scratch array.
 * Static-shaped vector fx are built ONCE per entity and only moved /
 * faded per frame: beacon landing columns + hold bars (per site),
 * radiation charge glows (per emitter, scaled), gravity chevron patterns
 * (per zone, drifted under a static zone mask). Only the radiation pulse
 * lines (moving endpoints) are rebuilt per frame, with constant styles.
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
import { ropePolylineInto } from './ropeLine';
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
/** Dark outline behind the beacon landing column + brackets. */
const BEACON_OUTLINE = 0x0c2a16;
const BEACON_GREEN = 0x60ff90;
const RADIATION_GLOW = 0xfff0a0;
/** Radiation glow Graphics are built at this radius and scaled down (smooth circles). */
const RADIATION_REF_R = 84;
// Style objects (Pixi normalises them on use): hoisted, never allocated per frame.
const S_COLUMN = { color: BEACON_GREEN, alpha: 1 } as const;
const S_EDGE = { color: BEACON_OUTLINE, alpha: 0.35 } as const;
const S_OUTLINE = { color: BEACON_OUTLINE, alpha: 0.8 } as const;
const S_BRACKET = { color: BEACON_GREEN, alpha: 0.7 } as const;
const S_BAR_BG = { color: 0x0c1a10, alpha: 0.8 } as const;
const S_GLOW_OUTER = { color: RADIATION_GLOW, alpha: 0.12 } as const;
const S_GLOW_INNER = { color: RADIATION_GLOW, alpha: 0.25 } as const;
const S_PULSE_HIT = { width: 3, color: 0xff4040 } as const;
const S_PULSE_MISS = { width: 1, color: 0x909090 } as const;
const S_CHEVRON = { width: 1, color: 0xb8a0ff, alpha: 0.55 } as const;

/** Pre-built beacon-site fx: the pulsing landing column (+ frame) and the hold bar. */
interface SiteFx {
  column: Graphics;
  frame: Graphics;
  barBg: Graphics;
  bar: Graphics;
}

/** Pre-built chevron pattern for one gravity zone, clipped by a static mask. */
interface ZoneFx {
  zone: GravityZone;
  pattern: Graphics;
  /** Unit drift direction (px per px of shift). */
  ux: number;
  uy: number;
  speed: number;
}
/** Off-view margin (px) kept when culling bodies, markers and rope. */
const CULL_MARGIN = 32;

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
  private readonly zoneFx = new Container();
  /** Per-entity vector fx in front of bodies: beacon columns + bars, radiation glows. */
  private readonly overFx = new Container();
  private readonly siteFx: SiteFx[] = [];
  private readonly glowFx: Graphics[] = [];
  private readonly zonePatterns: ZoneFx[] = [];
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
  /** Hull hit tint on (set per frame by LevelView from FeelFx, S8). */
  hitFlash = false;
  /** Shared texture cache (LevelView / S7LevelFx reuse it). */
  readonly tex: SpriteTextures;
  /** Markers in front of terrain (decor tiles would hide them), behind bodies: beacon sites. */
  private readonly markers: SpritePool;
  /** Bodies in front: pickups, beacons, debris, goo, rope. */
  private readonly bodies: SpritePool;
  private readonly wind: SpritePool;
  private readonly gravityZones: GravityZone[];
  private readonly debrisSprites: { small: [SpriteName, number]; large: [SpriteName, number] };
  /** Rope polyline scratch (reused every frame). */
  private readonly ropePts: Vec2[] = [];
  /** This frame's cull rect in world px (view + CULL_MARGIN; infinite without a view origin). */
  private cx0 = -Infinity;
  private cy0 = -Infinity;
  private cx1 = Infinity;
  private cy1 = Infinity;

  constructor(
    private readonly session: LevelSession,
    private readonly art: ArtApi,
  ) {
    this.theme = session.spec.themeId;
    this.tex = new SpriteTextures(art, this.theme);
    this.gravityZones = session.spec.zones.filter((z): z is GravityZone => z.kind === 'gravityZone');
    this.debrisSprites = DEBRIS_SPRITES[this.theme] ?? DEFAULT_DEBRIS;
    this.drawZones(session.spec);
    this.buildSiteFx();
    this.buildGlowFx();
    this.buildZonePatterns();
    const markerLayer = new Container();
    const bodyLayer = new Container();
    const windLayer = new Container();
    this.markers = new SpritePool(markerLayer, this.tex);
    this.bodies = new SpritePool(bodyLayer, this.tex);
    this.wind = new SpritePool(windLayer, this.tex);
    this.under.addChild(this.zones, this.zoneFx);
    this.vesselArt.addChild(this.flames, this.hull);
    this.vessel.addChild(this.vesselArt);
    this.over.addChild(markerLayer, bodyLayer, this.overFx, this.heads, this.vessel, this.fx, windLayer);
  }

  /** `o` = view origin (world px of the view's top-left), for culling; null draws everything. */
  render(alpha: number, nowMs: number, o: Vec2 | null = null): void {
    if (o) {
      this.cx0 = o.x - CULL_MARGIN;
      this.cy0 = o.y - CULL_MARGIN;
      this.cx1 = o.x + VIEW_WIDTH + CULL_MARGIN;
      this.cy1 = o.y + VIEW_HEIGHT + CULL_MARGIN;
    } else {
      this.cx0 = this.cy0 = -Infinity;
      this.cx1 = this.cy1 = Infinity;
    }
    const s = this.session;
    const p = s.physics;
    const env = s.env;
    const t = s.simTime;
    const anim = Math.floor(nowMs / ANIM_MS);
    const flicker = Math.floor(nowMs / 60) % 2 === 0;
    const markers = this.markers;
    const bodies = this.bodies;
    markers.begin();
    bodies.begin();

    this.renderGravityZones(nowMs);

    // beacon sites (markers) + planted beacons; column + bar are pre-built (buildSiteFx)
    const zh = env.tuning.beacon.zoneHeight;
    const sites = env.beacons.sites;
    const columnAlpha = 0.08 + 0.07 * (0.5 + 0.5 * Math.sin(nowMs / 350));
    for (let si = 0; si < sites.length; si++) {
      const site = sites[si]!;
      const e = site.entity;
      const sfx = this.siteFx[si]!;
      const shown = this.boxVisible(e.x - e.w / 2 - 16, e.y - zh - 12, e.x + e.w / 2 + 16, e.y + 16);
      sfx.column.visible = sfx.frame.visible = shown && !site.planted;
      sfx.barBg.visible = sfx.bar.visible = shown && !site.planted && site.hold > 0;
      if (!shown) continue;
      const n = Math.max(1, Math.round(e.w / 32));
      const x0 = e.x - (n * 32) / 2 + 16;
      // unplanted: chevrons blink green; planted: dim pad with the beacon on it
      const f = site.planted ? 1 : Math.floor(nowMs / 400) % 2;
      for (let i = 0; i < n; i++) markers.next('obj.beaconSite', f, x0 + i * 32, e.y);
      if (site.planted) bodies.next('obj.beacon', anim, e.x, e.y);
      else {
        sfx.column.alpha = columnAlpha;
        if (site.hold > 0) sfx.bar.scale.x = Math.min(1, site.hold / Math.max(0.01, e.holdSec));
      }
    }
    for (const pk of env.pickups.pickups) {
      if (pk.collected) continue;
      const e = pk.entity;
      if (!this.visible(e.x, e.y, 24)) continue;
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
    const emitters = env.radiation.emitters;
    for (let ei = 0; ei < emitters.length; ei++) {
      const em = emitters[ei]!;
      const glow = this.glowFx[ei]!;
      const c = env.radiation.charge(em, t);
      const r = 24 + 60 * c;
      glow.visible = c > 0.01 && this.visible(em.spec.x, em.spec.y, r * 1.6 + 4);
      if (!glow.visible) continue;
      glow.scale.set(r / RADIATION_REF_R);
      glow.alpha = c;
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
      if (!this.visible(x, y, d.radius * 2 + 4)) continue;
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
      const gx = mToPx(tr.x);
      const gy = mToPx(tr.y);
      if (!this.visible(gx, gy, env.tuning.goo.radius * 2 + 4)) continue;
      const sp = bodies.next('obj.goo', anim + (b.attached ? 2 : 0), gx, gy);
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
        const pts = ropePolylineInto(this.ropePts, mx, my, gun.head, len);
        this.rope(pts, tint);
        const head = this.headSprite(headCount++);
        head.position.set(gun.head.x, gun.head.y);
        const prev = pts[pts.length - 2]!; // ROPE_SEGMENTS + 1 >= 2 points
        head.rotation = Math.atan2(gun.head.x - prev.x, -(gun.head.y - prev.y));
      }
    }
    const heads = this.heads.children;
    for (let i = 0; i < heads.length; i++) heads[i]!.visible = i < headCount;
    markers.end();
    bodies.end();

    // vessel
    const frame = vesselFrame(s.vessel.mode, vs.landed);
    this.syncHull(s.vessel.mode, frame, geo);
    this.vessel.position.set(mToPx(vt.x), mToPx(vt.y));
    this.vessel.rotation = vt.angle;
    this.vessel.alpha = vs.crashed ? 0.4 : 1;
    this.hull.tint = this.hitFlash && !vs.crashed ? 0xff9a8a : 0xffffff;
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
      const ex = em.spec.x;
      const ey = em.spec.y;
      if (!this.boxVisible(Math.min(ex, end.x), Math.min(ey, end.y), Math.max(ex, end.x), Math.max(ey, end.y))) continue;
      fx.moveTo(ex, ey).lineTo(end.x, end.y).stroke(last.hit ? S_PULSE_HIT : S_PULSE_MISS);
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

  /** Is the circle (x, y, r) inside this frame's cull rect? */
  private visible(x: number, y: number, r: number): boolean {
    return x + r >= this.cx0 && x - r <= this.cx1 && y + r >= this.cy0 && y - r <= this.cy1;
  }

  /** Does the box [x0, x1] x [y0, y1] overlap this frame's cull rect? */
  private boxVisible(x0: number, y0: number, x1: number, y1: number): boolean {
    return x1 >= this.cx0 && x0 <= this.cx1 && y1 >= this.cy0 && y0 <= this.cy1;
  }

  /**
   * Tile obj.ropeSegment along the polyline (one sprite per 4 px). Segments
   * fully outside the cull rect are skipped (the sprite spacing carries on,
   * so the visible part never shifts).
   */
  private rope(pts: readonly Vec2[], tint: number): void {
    let carry = 0; // distance into the current segment where the next sprite starts
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      if (!this.boxVisible(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) {
        carry = carry < l ? carry + Math.ceil((l - carry) / ROPE_STEP) * ROPE_STEP - l : carry - l;
        continue;
      }
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

  /**
   * Chevrons drifting along each gravity zone's pull: the zone's pre-built
   * pattern moves by the drift (mod one grid cell) under its static mask;
   * zones off the cull rect are hidden.
   */
  private renderGravityZones(nowMs: number): void {
    for (const zf of this.zonePatterns) {
      const r = zf.zone.rect;
      zf.pattern.visible = r.x + r.w >= this.cx0 && r.x <= this.cx1 && r.y + r.h >= this.cy0 && r.y <= this.cy1;
      if (!zf.pattern.visible) continue;
      const shift = ((nowMs / 1000) * zf.speed) % CHEVRON_GRID;
      zf.pattern.position.set(Math.round(zf.ux * shift), Math.round(zf.uy * shift));
    }
  }

  /** One column + frame + hold bar per beacon site, built once (world px). */
  private buildSiteFx(): void {
    const zh = this.session.env.tuning.beacon.zoneHeight;
    for (const site of this.session.env.beacons.sites) {
      const e = site.entity;
      const l = e.x - e.w / 2;
      const r = l + e.w;
      const top = e.y - zh;
      const column = new Graphics().rect(l, top, e.w, zh).fill(S_COLUMN);
      // dark 1 px edges + bracket outlines so the column reads against pale skies (floating isles)
      const frame = new Graphics()
        .rect(l, top, 1, zh)
        .fill(S_EDGE)
        .rect(r - 1, top, 1, zh)
        .fill(S_EDGE)
        .rect(l - 1, top - 1, 8, 3)
        .fill(S_OUTLINE)
        .rect(l - 1, top - 1, 3, 8)
        .fill(S_OUTLINE)
        .rect(r - 7, top - 1, 8, 3)
        .fill(S_OUTLINE)
        .rect(r - 2, top - 1, 3, 8)
        .fill(S_OUTLINE)
        // corner brackets (left, right)
        .rect(l, top, 6, 1)
        .fill(S_BRACKET)
        .rect(l, top, 1, 6)
        .fill(S_BRACKET)
        .rect(r - 6, top, 6, 1)
        .fill(S_BRACKET)
        .rect(r - 1, top, 1, 6)
        .fill(S_BRACKET);
      const barBg = new Graphics().rect(l, e.y - 10, e.w, 3).fill(S_BAR_BG);
      const bar = new Graphics().rect(0, 0, e.w, 3).fill(BEACON_GREEN);
      bar.position.set(l, e.y - 10);
      for (const g of [column, frame, barBg, bar]) {
        g.visible = false;
        this.overFx.addChild(g);
      }
      this.siteFx.push({ column, frame, barBg, bar });
    }
  }

  /** One charge glow per radiation emitter (two circles at RADIATION_REF_R), built once. */
  private buildGlowFx(): void {
    for (const em of this.session.env.radiation.emitters) {
      const g = new Graphics().circle(0, 0, RADIATION_REF_R * 1.6).fill(S_GLOW_OUTER).circle(0, 0, RADIATION_REF_R).fill(S_GLOW_INNER);
      g.position.set(em.spec.x, em.spec.y);
      g.visible = false;
      this.overFx.addChild(g);
      this.glowFx.push(g);
    }
  }

  /**
   * Per gravity zone: the chevron grid (one extra cell on every side, so a
   * drift of up to one cell never uncovers an edge) as one Graphics, clipped
   * by a static mask of the zone inset 4 px (polygon zones: the polygon).
   */
  private buildZonePatterns(): void {
    for (const z of this.gravityZones) {
      const gl = Math.hypot(z.gravity.x, z.gravity.y);
      if (gl < 1e-6) continue;
      const ux = z.gravity.x / gl;
      const uy = z.gravity.y / gl;
      const r = z.rect;
      const pattern = new Graphics();
      // a 5 px "V" pointing along the pull (perpendicular = (-uy, ux))
      const px = -uy * 3;
      const py = ux * 3;
      for (let cy = r.y - CHEVRON_GRID / 2; cy < r.y + r.h + CHEVRON_GRID; cy += CHEVRON_GRID) {
        for (let cx = r.x - CHEVRON_GRID / 2; cx < r.x + r.w + CHEVRON_GRID; cx += CHEVRON_GRID) {
          pattern
            .moveTo(cx - px - ux * 3, cy - py - uy * 3)
            .lineTo(cx, cy)
            .lineTo(cx + px - ux * 3, cy + py - uy * 3);
        }
      }
      pattern.stroke(S_CHEVRON);
      const mask = new Graphics();
      if (z.polygon) mask.poly(z.polygon.flatMap((q) => [q.x, q.y])).fill(0xffffff);
      else mask.rect(r.x + 4, r.y + 4, Math.max(0, r.w - 8), Math.max(0, r.h - 8)).fill(0xffffff);
      pattern.mask = mask;
      pattern.visible = false;
      this.zoneFx.addChild(mask, pattern);
      this.zonePatterns.push({ zone: z, pattern, ux, uy, speed: 14 * Math.min(2, gl / 3) });
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
