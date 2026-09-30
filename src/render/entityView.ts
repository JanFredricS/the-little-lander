/**
 * Rendering of the level-runtime entities (src/levels/runtime): blast doors,
 * moving islands (tiled like terrain), vines, creatures (background
 * parallax creatures, the Map 3 dragon-bird hauling the CSM away).
 * World px; LevelView slots the layers around its terrain.
 *
 * Drawing is culled to the view rect (+ CULL_MARGIN): doors, islands and
 * creatures outside it are hidden, and a vine whose reach (anchor ± length)
 * misses the view is not rebuilt at all. Simulation state lives in the level
 * runtime / physics and is untouched by culling.
 */

import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, SpriteFrame, SpriteName, Vec2 } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import { paintOutline } from './terrainView';

/** Interpolate a→b into `out` (render-path scratch: no per-entity allocation). */
const lerpInto = (out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
};

/** World px beyond the view edge that still counts as visible. */
const CULL_MARGIN = 32;
/** Half-extent of the soft glow-mote trail drawn for sprite-less species. */
const GLOW_REACH = 40;

const SPECIES_SPRITES: Partial<Record<string, SpriteName>> = {
  dragonBird: 'creature.dragonBird',
  skyWhale: 'creature.skyWhale',
};

const VINE_DARK = { width: 3, color: 0x2f6b3a };
const VINE_LIGHT = { width: 1, color: 0x5fae4a };

function tex(f: SpriteFrame): Texture {
  return Texture.from(f.canvas as HTMLCanvasElement);
}

export class EntityView {
  /** Behind terrain: parallax creatures, door leaves (they park inside terrain). */
  readonly back = new Container();
  /** Above terrain, below the vessel: islands, vines. */
  readonly mid = new Container();
  /** In front of the vessel: the dragon-bird. */
  readonly front = new Container();

  private readonly doors: TilingSprite[] = [];
  /** Island sprites + their local bounds (sprite position = island pos; drawn at pos + offset). */
  private readonly islands: { sprite: Sprite; ox: number; oy: number; w: number; h: number }[] = [];
  private readonly vines = new Graphics();
  private readonly glow = new Graphics();
  /** `reach` = half-extent of the drawn creature (px), for culling. */
  private readonly creatures: { sprite: Sprite | null; frames: Texture[]; reach: number }[] = [];
  /** Render-path scratch points. */
  private readonly at: Vec2 = { x: 0, y: 0 };
  private readonly prev: Vec2 = { x: 0, y: 0 };
  private readonly birds: { sprite: Sprite; frames: Texture[]; csm: Sprite }[] = [];

  constructor(
    private readonly session: LevelSession,
    art: ArtApi,
  ) {
    const spec = session.spec;
    const theme = spec.themeId;
    const rt = session.runtime;

    for (const c of rt.creatures.ambient) {
      const name = SPECIES_SPRITES[c.entity.species];
      if (!name) {
        this.creatures.push({ sprite: null, frames: [], reach: GLOW_REACH });
        continue;
      }
      const n = art.getSpriteFrameCount(name);
      const frames = Array.from({ length: n }, (_, i) => tex(art.getSprite(name, i, theme)));
      const f0 = art.getSprite(name, 0, theme);
      const s = new Sprite(frames[0]);
      s.anchor.set(f0.pivot.x / f0.width, f0.pivot.y / f0.height);
      const depth = c.entity.depth ?? 0;
      s.scale.set(c.entity.scale ?? 1);
      // distant creatures fade into the sky
      s.alpha = depth > 0 ? Math.max(0.35, 1 - depth * 0.6) : 1;
      this.back.addChild(s);
      this.creatures.push({ sprite: s, frames, reach: Math.max(f0.width, f0.height) * Math.abs(c.entity.scale ?? 1) });
    }
    this.back.addChild(this.glow);

    const doorTex = tex(art.getSprite('obj.blastDoor', 0, theme));
    for (const d of rt.doors.doors) {
      const s = new TilingSprite({ texture: doorTex, width: d.entity.w, height: d.entity.h });
      s.anchor.set(0.5);
      this.back.addChild(s);
      this.doors.push(s);
    }

    for (const isl of rt.islands.islands) {
      const { canvas, offset } = paintOutline(art, spec, isl.entity.id, isl.entity.outline, isl.entity.style);
      const s = new Sprite(Texture.from(canvas as HTMLCanvasElement));
      s.pivot.set(-offset.x, -offset.y);
      this.mid.addChild(s);
      this.islands.push({ sprite: s, ox: offset.x, oy: offset.y, w: canvas.width, h: canvas.height });
    }
    this.mid.addChild(this.vines);

    for (const _b of rt.creatures.birds) {
      const name: SpriteName = 'creature.dragonBird';
      const n = art.getSpriteFrameCount(name);
      const frames = Array.from({ length: n }, (_, i) => tex(art.getSprite(name, i, theme)));
      const f0 = art.getSprite(name, 0, theme);
      const sprite = new Sprite(frames[0]);
      sprite.anchor.set(f0.pivot.x / f0.width, f0.pivot.y / f0.height);
      const cf = art.getSprite('vessel.csm', 0, theme);
      const csm = new Sprite(tex(cf));
      csm.anchor.set(cf.pivot.x / cf.width, cf.pivot.y / cf.height);
      csm.visible = false;
      sprite.visible = false;
      this.front.addChild(csm, sprite);
      this.birds.push({ sprite, frames, csm });
    }
  }

  /** `o` = view origin (world px of the view's top-left), for parallax and culling. */
  render(alpha: number, o: Vec2, nowMs: number): void {
    const s = this.session;
    const rt = s.runtime;
    const p = s.physics;
    const at = this.at;
    const vx0 = o.x - CULL_MARGIN;
    const vy0 = o.y - CULL_MARGIN;
    const vx1 = o.x + VIEW_WIDTH + CULL_MARGIN;
    const vy1 = o.y + VIEW_HEIGHT + CULL_MARGIN;
    const inView = (x0: number, y0: number, x1: number, y1: number): boolean => x1 > vx0 && x0 < vx1 && y1 > vy0 && y0 < vy1;

    // door bodies are driven by the runtime / physics; only the drawing is culled
    const doors = rt.doors.doors;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i]!;
      const view = this.doors[i]!;
      lerpInto(at, d.prevPos, d.pos, alpha);
      const hw = d.entity.w / 2;
      const hh = d.entity.h / 2;
      view.visible = inView(at.x - hw, at.y - hh, at.x + hw, at.y + hh);
      if (view.visible) view.position.set(at.x, at.y);
    }
    const islands = rt.islands.islands;
    for (let i = 0; i < islands.length; i++) {
      const isl = islands[i]!;
      const view = this.islands[i]!;
      lerpInto(at, isl.prevPos, isl.pos, alpha);
      const x = Math.round(at.x);
      const y = Math.round(at.y);
      view.sprite.visible = inView(x + view.ox, y + view.oy, x + view.ox + view.w, y + view.oy + view.h);
      if (view.sprite.visible) view.sprite.position.set(x, y);
    }

    const g = this.vines.clear();
    for (const v of rt.vines.vines) {
      // a vine hangs from its anchor and can swing at most its length away
      const ax = v.entity.x;
      const ay = v.entity.y;
      const len = v.entity.length;
      if (!inView(ax - len, ay - len, ax + len, ay + len)) continue;
      const prev = this.prev;
      prev.x = ax;
      prev.y = ay;
      const half = v.linkLen / 2;
      for (let k = 0; k < v.links.length; k++) {
        const b = v.links[k]!;
        if (!p.hasBody(b)) continue;
        const t = p.getInterpolatedTransform(b, alpha);
        const ex = mToPx(t.x) - Math.sin(t.angle) * half;
        const ey = mToPx(t.y) + Math.cos(t.angle) * half;
        g.moveTo(prev.x, prev.y).lineTo(ex, ey).stroke(VINE_DARK);
        g.moveTo(prev.x, prev.y).lineTo(ex, ey).stroke(VINE_LIGHT);
        if (k % 3 === 1) g.circle(ex + (k % 2 ? 2 : -2), ey, 2).fill(0x4f9a3f);
        prev.x = ex;
        prev.y = ey;
      }
    }

    const glow = this.glow.clear();
    const ambient = rt.creatures.ambient;
    for (let i = 0; i < ambient.length; i++) {
      const c = ambient[i]!;
      const view = this.creatures[i]!;
      const depth = c.entity.depth ?? 0;
      lerpInto(at, c.prevPos, c.pos, alpha);
      const x = at.x + o.x * depth;
      const y = at.y + o.y * depth;
      const r = view.reach;
      const visible = inView(x - r, y - r, x + r, y + r);
      if (!view.sprite) {
        if (!visible) continue;
        // species without sprites (glowMoth / caveEel): soft glow motes
        const pulse = 0.5 + 0.5 * Math.sin(nowMs / 300 + i);
        const count = c.entity.species === 'caveEel' ? 6 : 1;
        for (let k = 0; k < count; k++) {
          glow.circle(x - c.facing * k * 5, y + Math.sin(nowMs / 200 + k) * 2, 2 + pulse).fill({ color: 0x7ff0d0, alpha: 0.25 + 0.4 * pulse });
          glow.circle(x - c.facing * k * 5, y + Math.sin(nowMs / 200 + k) * 2, 1).fill({ color: 0xe0fff4, alpha: 0.9 });
        }
        continue;
      }
      view.sprite.visible = c.active && visible;
      if (!view.sprite.visible) continue;
      view.sprite.position.set(Math.round(x), Math.round(y));
      view.sprite.scale.x = Math.abs(view.sprite.scale.x) * (c.facing < 0 ? -1 : 1);
      view.sprite.texture = view.frames[Math.floor(nowMs / 220) % view.frames.length]!;
    }

    rt.creatures.birds.forEach((b, i) => {
      const view = this.birds[i]!;
      const visible = b.phase !== 'dormant' && b.phase !== 'gone';
      view.sprite.visible = visible;
      view.csm.visible = visible && b.carrying;
      if (!visible) return;
      lerpInto(at, b.prevPos, b.pos, alpha);
      view.sprite.position.set(Math.round(at.x), Math.round(at.y));
      view.sprite.scale.x = b.facing < 0 ? -1 : 1;
      view.sprite.texture = view.frames[Math.floor(nowMs / 110) % view.frames.length]!;
      view.csm.position.set(Math.round(at.x), Math.round(at.y) + 30);
      view.csm.rotation = Math.sin(nowMs / 400) * 0.25;
    });
  }

  destroy(): void {
    this.back.destroy({ children: true });
    this.mid.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
