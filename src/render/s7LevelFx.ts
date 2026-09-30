/**
 * S7 render layer for the level-owned systems (src/levels/systems, S7):
 * the Keeper (S2 boss sprites + tendrils + the sweep telegraph line), loose
 * rocks hanging / falling, slam debris, crumbling ledges and their chunks,
 * and the collapse front (map 8), plus map 5's deepening darkness (a
 * darkening pass whose alpha follows the vessel's x-progress through
 * Section B, with an additive glow per bioluminescent prop punching through;
 * tuning in S7_DARKNESS / the vaults.ts header). Terrain and blast doors are
 * NOT drawn here (S6's TerrainView / EntityView own them).
 *
 * Hooked into LevelView with two containers (under / over) and one render
 * call — a minimal S7 hook. Rocks (hanging, falling, keeper slam pieces)
 * are S2 boulder sprites and ledge chunks debris sprites, all from one
 * SpritePool (S8); ledges stay a shaded ruin slab and the front a churning
 * procedural edge, culled to the view.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, BodyHandle, LevelSpec, SpriteName, StaticPropEntity, ThemeId, Vec2 } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import { SpritePool, SpriteTextures } from './spritePool';

const RUIN = 0x6a6a70;
const RUIN_DARK = 0x3e3e46;
const FRONT_DARK = 0x1a0c0a;
const FRONT_EDGE = 0xff7a30;
const TELEGRAPH = 0xffd040;
const TELEGRAPH_LOCKED = 0xff4030;
const TENDRIL = 0x7a3aa8;
const TENDRIL_BURN = 0xff8a30;

/**
 * Progress-driven darkness per level id: alpha ramps (smoothstep) from 0 at
 * x0 to max at x1 and holds. Glow sprites punch through with an additive halo.
 */
export const S7_DARKNESS: Record<string, { x0: number; x1: number; max: number; color: number; glowSprites: SpriteName[] }> = {
  // map 5 (The Vaults): Section B = x 6600..13300; the camp (x ~13650) keeps full darkness
  vaults: {
    x0: 6600,
    x1: 13000,
    max: 0.6,
    color: 0x02040a,
    glowSprites: ['prop.bioParticle', 'prop.glowPlant', 'prop.glowMushroom', 'prop.crystalCluster'],
  },
};

/** Darkness overlay alpha for a vessel at world x (0 when the level has no darkness pass). */
export function s7DarknessAt(spec: LevelSpec, x: number): number {
  const d = S7_DARKNESS[spec.id];
  if (!d) return 0;
  const k = Math.min(1, Math.max(0, (x - d.x0) / (d.x1 - d.x0)));
  return d.max * k * k * (3 - 2 * k);
}

const GLOW = 0x8affd8;
/** Glow halos are drawn only for props within this distance of the vessel. */
const GLOW_RANGE = 1400;

/** Keeper body frame period (ms) while idle. */
const IDLE_FRAME_MS = 320;

/** Off-view margin (px) kept when culling rocks, chunks and ledges. */
const CULL_MARGIN = 32;

interface BoulderSprite {
  readonly name: SpriteName;
  readonly size: number;
}
const BOULDER_SMALL: BoulderSprite = { name: 'prop.boulderSmall', size: 12 };
const BOULDER_MEDIUM: BoulderSprite = { name: 'prop.boulderMedium', size: 24 };
const BOULDER_LARGE: BoulderSprite = { name: 'prop.boulderLarge', size: 48 };

/** Boulder sprite for a rock of radius r (px), by nearest size (shared constants: no allocation). */
function boulderFor(r: number): BoulderSprite {
  return r <= 8 ? BOULDER_SMALL : r <= 16 ? BOULDER_MEDIUM : BOULDER_LARGE;
}

/** Scratch pose (px) reused by S7LevelFx.at(): no per-body allocation per frame. */
interface PxPose {
  x: number;
  y: number;
  angle: number;
}

export class S7LevelFx {
  /** Behind terrain (reserved: nothing yet). */
  readonly under = new Container();
  /** In front: rocks, ledges, boss, and on top the collapse front (it swallows everything). */
  readonly over = new Container();
  private readonly g = new Graphics();
  private readonly front = new Graphics();
  private readonly keeper = new Container();
  private readonly body = new Sprite(Texture.EMPTY);
  private readonly eye = new Sprite(Texture.EMPTY);
  private readonly tex: SpriteTextures;
  private readonly pool: SpritePool;
  private readonly pose: PxPose = { x: 0, y: 0, angle: 0 };
  private readonly theme: ThemeId;
  private readonly dark = new Graphics();
  private readonly glow = new Graphics();
  private readonly glowProps: StaticPropEntity[];
  /** Current darkness overlay alpha (0 = none). */
  darkness = 0;
  /** This frame's cull rect in world px (view + CULL_MARGIN; infinite without a view origin). */
  private cx0 = -Infinity;
  private cy0 = -Infinity;
  private cx1 = Infinity;
  private cy1 = Infinity;
  /** Wall-clock ms of the frame being drawn (drives shake()). */
  private nowMs = 0;

  constructor(
    private readonly session: LevelSession,
    art: ArtApi,
    tex?: SpriteTextures,
    /** Settings.reducedMotion: no rumble on the keeper, straining rocks or crumbling ledges. */
    private readonly opts: { reducedMotion?: boolean } = {},
  ) {
    this.theme = session.spec.themeId;
    this.tex = tex ?? new SpriteTextures(art, this.theme);
    const rocks = new Container();
    this.pool = new SpritePool(rocks, this.tex);
    this.keeper.addChild(this.body, this.eye);
    this.keeper.visible = false;
    this.glow.blendMode = 'add';
    this.over.addChild(this.dark, this.glow, this.g, rocks, this.keeper, this.front);
    const d = S7_DARKNESS[session.spec.id];
    this.glowProps = d
      ? session.spec.entities.filter((e): e is StaticPropEntity => e.kind === 'staticProp' && d.glowSprites.includes(e.sprite))
      : [];
  }

  /** Does this level have anything for this layer to draw? */
  static wanted(session: LevelSession): boolean {
    const s = session.systems;
    return !!(s.rocks || s.crumble || s.killFront || s.keeper || S7_DARKNESS[session.spec.id]);
  }

  /** `o` = view origin (world px of the view's top-left), for culling; null draws everything. */
  render(alpha: number, nowMs: number, o: Vec2 | null = null): void {
    const s = this.session;
    const sys = s.systems;
    const p = s.physics;
    const g = this.g.clear();
    this.pool.begin();
    this.nowMs = nowMs;
    if (o) {
      this.cx0 = o.x - CULL_MARGIN;
      this.cy0 = o.y - CULL_MARGIN;
      this.cx1 = o.x + VIEW_WIDTH + CULL_MARGIN;
      this.cy1 = o.y + VIEW_HEIGHT + CULL_MARGIN;
    } else {
      this.cx0 = this.cy0 = -Infinity;
      this.cx1 = this.cy1 = Infinity;
    }
    const ox = this.cx0 + CULL_MARGIN; // view left / top (for the collapse-front teeth + embers)
    const oy = this.cy0 + CULL_MARGIN;

    this.renderDarkness(nowMs);

    // ---- crumbling ledges + chunks
    if (sys.crumble) {
      for (const c of sys.crumble.platforms) {
        if (c.gone || !c.body || !p.hasBody(c.body)) continue;
        const e = c.entity;
        if (!this.boxVisible(e.x - e.w / 2 - 4, e.y - e.h / 2, e.x + e.w / 2 + 4, e.y + e.h / 2)) continue;
        const touched = c.touchedAt !== null;
        const k = touched ? Math.min(1, (s.simTime - c.touchedAt!) / Math.max(0.05, e.delaySec)) : 0;
        const dx = touched ? this.shake(1 + 2 * k) : 0;
        const x = e.x - e.w / 2 + dx;
        const y = e.y - e.h / 2;
        g.rect(x, y, e.w, e.h).fill(RUIN);
        g.rect(x, y, e.w, 2).fill(0x9a9aa4);
        g.rect(x, y + e.h - 3, e.w, 3).fill(RUIN_DARK);
        // cracks: always a hint, spreading as it goes
        const cracks = 2 + Math.floor(k * 4);
        for (let i = 0; i < cracks; i++) {
          const cx = x + ((i + 1) * e.w) / (cracks + 1);
          g.moveTo(cx, y + 2).lineTo(cx + (i % 2 ? 3 : -3), y + e.h * 0.6).stroke({ width: 1, color: RUIN_DARK });
        }
      }
      for (const ch of sys.crumble.chunks) {
        if (!p.hasBody(ch.body)) continue;
        const t = this.at(ch.body, alpha);
        if (!this.visible(t.x, t.y, ch.size)) continue;
        const big = ch.size > 10;
        const sp = this.pool.next(big ? 'obj.debrisLarge' : 'obj.debrisSmall', 0, t.x, t.y);
        sp.scale.set(ch.size / (big ? 16 : 8));
        sp.rotation = t.angle;
      }
    }

    // ---- loose rocks (hanging, straining under the winch) and falling rocks
    if (sys.rocks) {
      for (const r of sys.rocks.rocks) {
        if (!r.body || !p.hasBody(r.body)) continue;
        const e = r.entity;
        const strain = Math.min(1, r.pull / Math.max(0.01, e.breakForce));
        const t = this.at(r.body, alpha);
        if (!this.visible(t.x, t.y, e.radius + 4)) continue;
        const x = t.x + (strain > 0.3 ? this.shake(2 * strain) : 0);
        this.rock(x, t.y, e.radius, t.angle);
        if (strain > 0.5) g.moveTo(x - e.radius * 0.6, t.y - e.radius).lineTo(x + e.radius * 0.6, t.y - e.radius).stroke({ width: 1, color: 0xffe0a0, alpha: strain - 0.4 });
      }
      for (const f of sys.rocks.falling) {
        if (!p.hasBody(f.body)) continue;
        const t = this.at(f.body, alpha);
        if (!this.visible(t.x, t.y, f.radius)) continue;
        this.rock(t.x, t.y, f.radius, t.angle);
      }
    }

    // ---- the Keeper
    const kp = sys.keeper;
    if (kp) {
      const b = kp.brain;
      for (const piece of kp.pieces) {
        if (!p.hasBody(piece.body)) continue;
        const t = this.at(piece.body, alpha);
        if (!this.visible(t.x, t.y, piece.radius)) continue;
        this.rock(t.x, t.y, piece.radius, t.angle);
      }
      const dead = b.mode === 'dead';
      this.keeper.visible = !dead && b.mode !== 'intro';
      if (this.keeper.visible) {
        // sweep telegraph: tracks while yellow, locks red, then the lunge follows it
        if (b.mode === 'sweepWindup') {
          const len = b.t.sweepDistance;
          const col = b.sweepLocked ? TELEGRAPH_LOCKED : TELEGRAPH;
          const blink = b.sweepLocked ? Math.floor(nowMs / 90) % 2 === 0 : true;
          const dash = 18;
          for (let d = b.t.bodyRadius; d < len; d += dash * 2) {
            const d2 = Math.min(len, d + dash);
            g.moveTo(b.pos.x + b.sweepDir.x * d, b.pos.y + b.sweepDir.y * d)
              .lineTo(b.pos.x + b.sweepDir.x * d2, b.pos.y + b.sweepDir.y * d2)
              .stroke({ width: b.sweepLocked ? 3 : 2, color: col, alpha: blink ? 0.85 : 0.35 });
          }
        }
        // tendrils: root on the body edge -> tip, glowing where the exhaust burns them
        for (const d of b.tendrils) {
          const root = b.root(d.rootAngle);
          if (!this.boxVisible(Math.min(root.x, d.tip.x) - 8, Math.min(root.y, d.tip.y) - 8, Math.max(root.x, d.tip.x) + 8, Math.max(root.y, d.tip.y) + 8)) continue;
          const burn = Math.min(1, d.burn / Math.max(0.01, b.t.burnToBreak));
          const col = burn > 0.05 ? lerpColor(TENDRIL, TENDRIL_BURN, burn) : TENDRIL;
          const n = 8;
          let px = root.x;
          let py = root.y;
          for (let i = 1; i <= n; i++) {
            const k = i / n;
            const wob = Math.sin(nowMs * 0.012 + i * 1.3) * 4 * Math.sin(Math.PI * k);
            const nx = root.x + (d.tip.x - root.x) * k;
            const ny = root.y + (d.tip.y - root.y) * k;
            const len = Math.hypot(d.tip.x - root.x, d.tip.y - root.y) || 1;
            const qx = nx + (-(d.tip.y - root.y) / len) * wob;
            const qy = ny + ((d.tip.x - root.x) / len) * wob;
            g.moveTo(px, py).lineTo(qx, qy).stroke({ width: 5 - 3 * k, color: col });
            px = qx;
            py = qy;
          }
          g.circle(d.tip.x, d.tip.y, d.state === 'holding' ? 5 : 3).fill(col);
        }
        // body + eye
        const frame = b.hurtFlash > 0 ? 2 : Math.floor(nowMs / IDLE_FRAME_MS) % 2;
        this.setSprite(this.body, 'boss.keeperBody', frame);
        const winding = b.mode === 'sweepWindup' || b.mode === 'slamWindup';
        this.setSprite(this.eye, 'boss.keeperEye', winding ? 1 : 0);
        this.eye.position.set(0, 3);
        const dying = b.mode === 'dying';
        this.keeper.position.set(b.pos.x + (dying ? this.shake(4) : 0), b.pos.y + (b.mode === 'stagger' ? this.shake(3) : 0));
        this.keeper.alpha = dying ? Math.max(0.15, 1 - b.modeTime / 3) : 1;
      }
    }

    this.pool.end();

    // ---- collapse front: a dark churning mass with a burning edge (teeth + embers culled to the view)
    const fg = this.front.clear();
    if (sys.killFront) {
      const { w, h } = s.spec.worldSize;
      for (const f of sys.killFront.fronts) {
        if (!f.active) continue;
        const z = f.spec;
        const depth = 900;
        if (z.axis === 'y') {
          const edge = f.pos;
          const dir = z.speed < 0 ? 1 : -1; // the kill side extends this way from the edge
          const y0 = dir > 0 ? edge : edge - depth;
          fg.rect(0, y0, w, depth).fill({ color: FRONT_DARK, alpha: 0.92 });
          if (edge < oy - 140 || edge > oy + VIEW_HEIGHT + 140) continue; // edge off-screen: the fill is enough
          const tx0 = Math.max(0, Math.floor((ox - 16) / 16) * 16);
          const tx1 = Math.min(w, ox + VIEW_WIDTH + 16);
          for (let x = tx0; x < tx1; x += 16) {
            const tooth = 6 + 6 * Math.abs(Math.sin(x * 0.07 + nowMs * 0.004));
            fg.rect(x, edge - (dir > 0 ? tooth : 0), 16, tooth).fill({ color: FRONT_DARK, alpha: 0.92 });
            fg.rect(x, edge - dir * tooth - 1, 16, 2).fill({ color: FRONT_EDGE, alpha: 0.8 });
          }
          // embers rising off it
          for (let i = 0; i < 24; i++) {
            const ex = (i * 173 + nowMs * 0.03 * (1 + (i % 3))) % w;
            if (ex < ox - 2 || ex > ox + VIEW_WIDTH) continue;
            const ey = edge - dir * (((nowMs * 0.05 + i * 37) % 120) + 4);
            fg.rect(ex, ey, 2, 2).fill({ color: FRONT_EDGE, alpha: 0.7 });
          }
        } else {
          const edge = f.pos;
          const dir = z.speed > 0 ? -1 : 1;
          const x0 = dir > 0 ? edge : edge - depth;
          fg.rect(x0, 0, depth, h).fill({ color: FRONT_DARK, alpha: 0.92 });
          fg.rect(edge - 1, 0, 2, h).fill({ color: FRONT_EDGE, alpha: 0.8 });
        }
      }
    }
  }

  /**
   * Deepening darkness: one world-covering dark rect (cheap, camera-proof)
   * whose alpha follows the vessel's x-progress, then an additive halo per
   * nearby glow prop so the bioluminescence reads brighter as it gets darker.
   */
  private renderDarkness(nowMs: number): void {
    const dk = this.dark.clear();
    const gl = this.glow.clear();
    const d = S7_DARKNESS[this.session.spec.id];
    if (!d) return;
    const vx = this.session.state.pos.x;
    this.darkness = s7DarknessAt(this.session.spec, vx);
    if (this.darkness <= 0.001) return;
    const { w, h } = this.session.spec.worldSize;
    dk.rect(-2000, -2000, w + 4000, h + 4000).fill({ color: d.color, alpha: this.darkness });
    const k = this.darkness / d.max;
    for (const e of this.glowProps) {
      if (Math.abs(e.x - vx) > GLOW_RANGE) continue;
      const r = Math.max(e.w, e.h) * (e.sprite === 'prop.bioParticle' ? 1.5 : 1.4);
      const pulse = 0.8 + 0.2 * Math.sin(nowMs * 0.003 + e.x * 0.05);
      gl.circle(e.x, e.y, r).fill({ color: GLOW, alpha: 0.10 * k * pulse });
      gl.circle(e.x, e.y, r * 0.5).fill({ color: GLOW, alpha: 0.22 * k * pulse });
    }
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

  /** Rumble offset (px) of amplitude `amp` for the frame being drawn (0 with reduced motion). */
  private shake(amp: number): number {
    if (this.opts.reducedMotion) return 0;
    return (Math.sin(this.nowMs * 0.09) + Math.sin(this.nowMs * 0.057)) * 0.5 * amp;
  }

  /** Interpolated pose of `body` in px, written into one reused scratch object. */
  private at(body: BodyHandle, alpha: number): PxPose {
    const t = this.session.physics.getInterpolatedTransform(body, alpha);
    const q = this.pose;
    q.x = mToPx(t.x);
    q.y = mToPx(t.y);
    q.angle = t.angle;
    return q;
  }

  /** A boulder sprite scaled to the rock's collision diameter, rolling with its body. */
  private rock(x: number, y: number, r: number, angle: number): void {
    const b = boulderFor(r);
    const sp = this.pool.next(b.name, 0, x, y);
    sp.scale.set((2 * r) / b.size);
    sp.rotation = angle;
  }

  private setSprite(sprite: Sprite, name: SpriteName, frame: number): void {
    const f = this.tex.get(name, frame);
    if (sprite.texture !== f.tex) sprite.texture = f.tex;
    sprite.anchor.set(f.ax, f.ay);
  }
}

function lerpColor(a: number, b: number, k: number): number {
  return mixChannel(a, b, k, 16) | mixChannel(a, b, k, 8) | mixChannel(a, b, k, 0);
}

function mixChannel(a: number, b: number, k: number, s: number): number {
  const ca = (a >> s) & 0xff;
  const cb = (b >> s) & 0xff;
  return Math.round(ca + (cb - ca) * k) << s;
}
