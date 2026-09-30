/**
 * S7 render layer for the level-owned systems (src/levels/systems, S7):
 * the Keeper (S2 boss sprites + tendrils + the sweep telegraph line), loose
 * rocks hanging / falling, slam debris, crumbling ledges and their chunks,
 * the collapse front (map 8) and S7's closing gates. Terrain is NOT drawn
 * here (LevelView owns terrain; S6 owns the terrain-tile renderer).
 *
 * Hooked into LevelView with two containers (under / over) and one render
 * call — a minimal S7 hook. NOTE(S8): gates move to S6's door renderer when
 * its LevelRuntime lands (with s7Doors); rocks / ledges / front are
 * placeholder shapes in the theme's spirit until S2 draws obj.* sprites.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ArtApi, SpriteName, ThemeId } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';

const ROCK = 0x7a6a58;
const ROCK_DARK = 0x4a3e34;
const RUIN = 0x6a6a70;
const RUIN_DARK = 0x3e3e46;
const FRONT_DARK = 0x1a0c0a;
const FRONT_EDGE = 0xff7a30;
const TELEGRAPH = 0xffd040;
const TELEGRAPH_LOCKED = 0xff4030;
const TENDRIL = 0x7a3aa8;
const TENDRIL_BURN = 0xff8a30;
const DOOR = 0x5a6070;
const DOOR_STRIPE = 0xe0b030;

/** Keeper body frame period (ms) while idle. */
const IDLE_FRAME_MS = 320;

export class S7LevelFx {
  /** Behind terrain (reserved: nothing yet). */
  readonly under = new Container();
  /** In front: rocks, ledges, boss, gates, and on top the collapse front (it swallows everything). */
  readonly over = new Container();
  private readonly g = new Graphics();
  private readonly front = new Graphics();
  private readonly keeper = new Container();
  private readonly body = new Sprite(Texture.EMPTY);
  private readonly eye = new Sprite(Texture.EMPTY);
  private readonly textures = new Map<string, Texture>();
  private readonly theme: ThemeId;

  constructor(
    private readonly session: LevelSession,
    private readonly art: ArtApi,
  ) {
    this.theme = session.spec.themeId;
    this.keeper.addChild(this.body, this.eye);
    this.keeper.visible = false;
    this.over.addChild(this.g, this.keeper, this.front);
  }

  /** Does this level have anything for this layer to draw? */
  static wanted(session: LevelSession): boolean {
    const s = session.systems;
    return !!(s.rocks || s.crumble || s.killFront || s.keeper || s.doors);
  }

  render(alpha: number, nowMs: number): void {
    const s = this.session;
    const sys = s.systems;
    const p = s.physics;
    const g = this.g.clear();
    const at = (body: Parameters<typeof p.getInterpolatedTransform>[0]) => {
      const t = p.getInterpolatedTransform(body, alpha);
      return { x: mToPx(t.x), y: mToPx(t.y), angle: t.angle };
    };
    const shake = (amp: number) => (Math.sin(nowMs * 0.09) + Math.sin(nowMs * 0.057)) * 0.5 * amp;

    // ---- crumbling ledges + chunks
    if (sys.crumble) {
      for (const c of sys.crumble.platforms) {
        if (c.gone || !c.body || !p.hasBody(c.body)) continue;
        const e = c.entity;
        const touched = c.touchedAt !== null;
        const k = touched ? Math.min(1, (s.simTime - c.touchedAt!) / Math.max(0.05, e.delaySec)) : 0;
        const dx = touched ? shake(1 + 2 * k) : 0;
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
        const t = at(ch.body);
        g.rect(t.x - ch.size / 2, t.y - ch.size / 2, ch.size, ch.size).fill(RUIN);
      }
    }

    // ---- loose rocks (hanging, straining under the winch) and falling rocks
    if (sys.rocks) {
      for (const r of sys.rocks.rocks) {
        if (!r.body || !p.hasBody(r.body)) continue;
        const e = r.entity;
        const strain = Math.min(1, r.pull / Math.max(0.01, e.breakForce));
        const t = at(r.body);
        const x = t.x + (strain > 0.3 ? shake(2 * strain) : 0);
        this.rock(g, x, t.y, e.radius);
        if (strain > 0.5) g.moveTo(x - e.radius * 0.6, t.y - e.radius).lineTo(x + e.radius * 0.6, t.y - e.radius).stroke({ width: 1, color: 0xffe0a0, alpha: strain - 0.4 });
      }
      for (const f of sys.rocks.falling) {
        if (!p.hasBody(f.body)) continue;
        const t = at(f.body);
        this.rock(g, t.x, t.y, f.radius);
      }
    }

    // ---- the Keeper
    const kp = sys.keeper;
    if (kp) {
      const b = kp.brain;
      for (const piece of kp.pieces) {
        if (!p.hasBody(piece.body)) continue;
        const t = at(piece.body);
        this.rock(g, t.x, t.y, piece.radius);
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
        this.keeper.position.set(b.pos.x + (dying ? shake(4) : 0), b.pos.y + (b.mode === 'stagger' ? shake(3) : 0));
        this.keeper.alpha = dying ? Math.max(0.15, 1 - b.modeTime / 3) : 1;
      }
    }

    // ---- S7 closing gates
    if (sys.doors) {
      for (const d of sys.doors.doors) {
        const e = d.entity;
        const t = p.hasBody(d.body) ? at(d.body) : d.pos;
        const x = t.x - e.w / 2;
        const y = t.y - e.h / 2;
        g.rect(x, y, e.w, e.h).fill(DOOR);
        // hazard stripes on the leading edge
        const vertical = e.from === 'top' || e.from === 'bottom';
        const lead = e.from === 'left' ? x + e.w - 14 : e.from === 'right' ? x : x;
        if (!vertical) {
          for (let i = 0; i < e.h; i += 8) g.rect(lead, y + i, 14, 4).fill(DOOR_STRIPE);
        } else {
          const ly = e.from === 'top' ? y + e.h - 10 : y;
          for (let i = 0; i < e.w; i += 12) g.rect(x + i, ly, 6, 10).fill(DOOR_STRIPE);
        }
        g.rect(x, y, e.w, 1).fill(0xa0a8b8);
        if (d.phase === 'closing') g.circle(e.x, e.y - e.h / 2 - 8, 3).fill(Math.floor(nowMs / 150) % 2 ? 0xff4030 : 0x602010);
      }
    }

    // ---- collapse front: a dark churning mass with a burning edge
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
          for (let x = 0; x < w; x += 16) {
            const tooth = 6 + 6 * Math.abs(Math.sin(x * 0.07 + nowMs * 0.004));
            fg.rect(x, edge - (dir > 0 ? tooth : 0), 16, tooth).fill({ color: FRONT_DARK, alpha: 0.92 });
            fg.rect(x, edge - dir * tooth - 1, 16, 2).fill({ color: FRONT_EDGE, alpha: 0.8 });
          }
          // embers rising off it
          for (let i = 0; i < 24; i++) {
            const ex = (i * 173 + nowMs * 0.03 * (1 + (i % 3))) % w;
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

  destroy(): void {
    this.under.destroy({ children: true });
    this.over.destroy({ children: true });
  }

  private rock(g: Graphics, x: number, y: number, r: number): void {
    g.circle(x, y, r).fill(ROCK);
    g.circle(x + r * 0.25, y + r * 0.25, r * 0.55).fill(ROCK_DARK);
    g.circle(x - r * 0.3, y - r * 0.3, r * 0.3).fill(0x9a8a74);
  }

  private setSprite(sprite: Sprite, name: SpriteName, frame: number): void {
    const key = `${name}#${frame}`;
    let tex = this.textures.get(key);
    const f = this.art.getSprite(name, frame, this.theme);
    if (!tex) {
      tex = Texture.from(f.canvas as HTMLCanvasElement);
      this.textures.set(key, tex);
    }
    if (sprite.texture !== tex) sprite.texture = tex;
    sprite.anchor.set(f.pivot.x / f.width, f.pivot.y / f.height);
  }
}

function lerpColor(a: number, b: number, k: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k) << s;
  return mix(16) | mix(8) | mix(0);
}
