/**
 * Rendering of the level-runtime entities (src/levels/runtime): blast doors,
 * moving islands (tiled like terrain), vines, creatures (background
 * parallax creatures, the Map 3 dragon-bird hauling the CSM away).
 * World px; LevelView slots the layers around its terrain.
 */

import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import type { ArtApi, SpriteFrame, SpriteName, Vec2 } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import { paintOutline } from './terrainView';

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

const SPECIES_SPRITES: Partial<Record<string, SpriteName>> = {
  dragonBird: 'creature.dragonBird',
  skyWhale: 'creature.skyWhale',
};

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
  private readonly islands: Sprite[] = [];
  private readonly vines = new Graphics();
  private readonly glow = new Graphics();
  private readonly creatures: { sprite: Sprite | null; frames: Texture[] }[] = [];
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
        this.creatures.push({ sprite: null, frames: [] });
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
      this.creatures.push({ sprite: s, frames });
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
      this.islands.push(s);
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

  /** `o` = view origin (world px of the view's top-left), for parallax. */
  render(alpha: number, o: Vec2, nowMs: number): void {
    const s = this.session;
    const rt = s.runtime;
    const p = s.physics;

    rt.doors.doors.forEach((d, i) => {
      const at = lerp(d.prevPos, d.pos, alpha);
      this.doors[i]!.position.set(at.x, at.y);
    });
    rt.islands.islands.forEach((isl, i) => {
      const at = lerp(isl.prevPos, isl.pos, alpha);
      this.islands[i]!.position.set(Math.round(at.x), Math.round(at.y));
    });

    const g = this.vines.clear();
    for (const v of rt.vines.vines) {
      let prev: Vec2 = { x: v.entity.x, y: v.entity.y };
      v.links.forEach((b, k) => {
        if (!p.hasBody(b)) return;
        const t = p.getInterpolatedTransform(b, alpha);
        const half = v.linkLen / 2;
        const end = { x: mToPx(t.x) - Math.sin(t.angle) * half, y: mToPx(t.y) + Math.cos(t.angle) * half };
        g.moveTo(prev.x, prev.y).lineTo(end.x, end.y).stroke({ width: 3, color: 0x2f6b3a });
        g.moveTo(prev.x, prev.y).lineTo(end.x, end.y).stroke({ width: 1, color: 0x5fae4a });
        if (k % 3 === 1) g.circle(end.x + (k % 2 ? 2 : -2), end.y, 2).fill(0x4f9a3f);
        prev = end;
      });
    }

    const glow = this.glow.clear();
    rt.creatures.ambient.forEach((c, i) => {
      const view = this.creatures[i]!;
      const depth = c.entity.depth ?? 0;
      const at = lerp(c.prevPos, c.pos, alpha);
      const x = at.x + o.x * depth;
      const y = at.y + o.y * depth;
      if (!view.sprite) {
        // species without sprites (glowMoth / caveEel): soft glow motes
        const pulse = 0.5 + 0.5 * Math.sin(nowMs / 300 + i);
        const count = c.entity.species === 'caveEel' ? 6 : 1;
        for (let k = 0; k < count; k++) {
          glow.circle(x - c.facing * k * 5, y + Math.sin(nowMs / 200 + k) * 2, 2 + pulse).fill({ color: 0x7ff0d0, alpha: 0.25 + 0.4 * pulse });
          glow.circle(x - c.facing * k * 5, y + Math.sin(nowMs / 200 + k) * 2, 1).fill({ color: 0xe0fff4, alpha: 0.9 });
        }
        return;
      }
      view.sprite.visible = c.active;
      view.sprite.position.set(Math.round(x), Math.round(y));
      view.sprite.scale.x = Math.abs(view.sprite.scale.x) * (c.facing < 0 ? -1 : 1);
      view.sprite.texture = view.frames[Math.floor(nowMs / 220) % view.frames.length]!;
    });

    rt.creatures.birds.forEach((b, i) => {
      const view = this.birds[i]!;
      const visible = b.phase !== 'dormant' && b.phase !== 'gone';
      view.sprite.visible = visible;
      view.csm.visible = visible && b.carrying;
      if (!visible) return;
      const at = lerp(b.prevPos, b.pos, alpha);
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
