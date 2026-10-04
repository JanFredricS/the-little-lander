/**
 * Level renderer: the theme's palette background + parallax backdrop layers
 * (S2 ArtApi), tiled terrain (terrainView.ts: S2 tiles painted into culled
 * chunks), level-runtime entities (entityView.ts: doors, moving islands,
 * vines, creatures), prop sprites, exit docks, the flight systems
 * (src/render/flightView.ts: vessel, flames, rope, pickups, beacons, goo,
 * debris, zones — pooled sprites) and, on debug levels or with ?telemetry
 * in the URL, a dim telemetry line (the player HUD is src/ui, S4).
 * Everything is in virtual px; the world container is offset by the
 * interpolated camera. Static props share cached textures and are culled
 * to the view each frame (maps 5/6 have ~400). Props flagged `foreground`
 * (god rays, drifting spores) go in `propsFront`, just above the vessel /
 * rope layer (flight.over); the rest sit between terrain and the vessel.
 */

import { Container, Graphics, Sprite, Text, Texture, TextureSource, TilingSprite } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, BackdropLayer, BodyHandle, LevelSpec, SpriteName } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import { CrystalSpireView } from './crystalSpires';
import { EntityView } from './entityView';
import { FeelFx, type FeelOptions } from './feelFx';
import { FlightView } from './flightView';
import { S7LevelFx } from './s7LevelFx';
import { TerrainView } from './terrainView';
import type { TerrainDiag } from '../ui/fpsMeter';

export class LevelView {
  readonly root = new Container();
  private readonly world = new Container();
  /** Static props behind the vessel (the default). */
  private readonly propsBack = new Container();
  /** Props with `foreground: true`: drawn in front of the vessel and rope. */
  private readonly propsFront = new Container();
  /** Per-frame camera scratch (interpolated centre, view origin): no allocation per frame. */
  private readonly camScratch = { x: 0, y: 0 };
  private readonly originScratch = { x: 0, y: 0 };
  private readonly flight: FlightView;
  private readonly terrain: TerrainView;
  /** Round 20: The Hollow's roof crystal (terrain the tile painter skips). */
  private readonly crystal: CrystalSpireView | null;
  private readonly entities: EntityView;
  /** S7 hook: level-owned systems (boss, rocks, ledges, collapse front, S7 gates). */
  private readonly s7: S7LevelFx | null;
  /** S8 feel layer: particles, shake, hit flash. */
  private readonly feel: FeelFx;
  private readonly backdrop: { layer: BackdropLayer; view: Sprite | TilingSprite }[] = [];
  private readonly props = new Map<string, Sprite>();
  /** Dynamic props: sprite follows its body. */
  private readonly movers: { sprite: Sprite; body: BodyHandle }[] = [];
  /** Props that never move (decor + static solid props) with their world AABB, for per-frame culling. */
  private readonly staticProps: { sprite: Sprite; x0: number; y0: number; x1: number; y1: number }[] = [];
  /** Round 20: static props that cycle their frames (StaticPropEntity.animFps). */
  private readonly animProps: { sprite: Sprite; name: SpriteName; fps: number; phase: number }[] = [];
  private readonly hud: Text | null;
  private hudNextMs = 0;
  private fpsFrames = 0;
  private fpsLastMs = 0;
  private fps = 0;

  constructor(
    private readonly session: LevelSession,
    private readonly art: ArtApi,
    feel: FeelOptions = {},
  ) {
    const spec = session.spec;
    const layers = art.getBackdropLayers(spec.themeId);
    const bg = new Graphics().rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT).fill(art.palettes[spec.themeId].background);
    // perf: the screen-fixed sky (layer 0, opaque by construction - see test/art.test.ts) covers the
    // whole view, so the solid background under it would be a full-screen fill nobody sees
    bg.visible = !(layers[0] && coversView(layers[0]));
    this.root.addChild(bg);
    for (const layer of layers) {
      const texture = Texture.from(layer.canvas as HTMLCanvasElement);
      // A screen-fixed layer never scrolls: a plain Sprite draws the same pixels as a TilingSprite
      // but batches with the other sprites (no tiling shader / batch break).
      const tiling = (layer.repeatX || layer.repeatY) && !(layer.parallax === 0 && coversView(layer));
      const view = tiling
        ? new TilingSprite({ texture, width: layer.repeatX ? VIEW_WIDTH : layer.width, height: layer.repeatY ? VIEW_HEIGHT : layer.height })
        : new Sprite(texture);
      this.backdrop.push({ layer, view });
      this.root.addChild(view);
    }
    this.root.addChild(this.world);

    this.flight = new FlightView(session, art);
    this.terrain = new TerrainView(spec, art);
    this.entities = new EntityView(session, art);
    this.world.addChild(this.entities.back);
    this.world.addChild(this.flight.under);
    // round 20: the roof crystal just UNDER the terrain - the crust hides its buried base, a
    // rock hanging from a spire hides the tip that ends inside it
    const pal = art.palettes[spec.themeId];
    this.crystal = CrystalSpireView.wanted(spec) ? new CrystalSpireView(spec, pal.colors[pal.outline] ?? 0x000000, { reducedMotion: feel.reducedMotion }) : null;
    if (this.crystal) this.world.addChild(this.crystal.root);
    this.world.addChild(this.terrain.root);
    this.world.addChild(this.entities.mid);
    this.world.addChild(this.drawExits(spec));
    this.world.addChild(this.propsBack);

    for (const e of spec.entities) {
      if (e.kind !== 'staticProp') continue;
      const s = new Sprite(this.flight.tex.get(e.sprite, 0).tex);
      s.anchor.set(0.5);
      s.width = e.w;
      s.height = e.h;
      s.position.set(e.x, e.y);
      s.rotation = e.angle ?? 0;
      if (e.tint !== undefined) s.tint = e.tint;
      if (e.alpha !== undefined) s.alpha = e.alpha;
      if (e.animFps && !feel.reducedMotion && this.flight.tex.frameCount(e.sprite) > 1) this.animProps.push({ sprite: s, name: e.sprite, fps: e.animFps, phase: (e.x * 0.37) % 1 });
      this.props.set(e.id, s);
      (e.foreground ? this.propsFront : this.propsBack).addChild(s);
      if (!e.dynamic) {
        const r = Math.hypot(e.w, e.h) / 2;
        this.staticProps.push({ sprite: s, x0: e.x - r, y0: e.y - r, x1: e.x + r, y1: e.y + r });
      }
    }

    this.world.addChild(this.flight.over);
    this.world.addChild(this.propsFront);
    this.world.addChild(this.entities.front);
    this.s7 = S7LevelFx.wanted(session) ? new S7LevelFx(session, art, this.flight.tex, { reducedMotion: feel.reducedMotion }) : null;
    if (this.s7) {
      this.world.addChildAt(this.s7.under, 0);
      this.world.addChild(this.s7.over);
    }
    this.feel = new FeelFx(session, this.flight.tex, feel);
    this.world.addChild(this.feel.layer);

    for (const [id, { entity, body }] of session.built.props) {
      const sprite = this.props.get(id);
      if (sprite && entity.dynamic) this.movers.push({ sprite, body });
    }

    // Debug telemetry (S0): debug levels, or ?telemetry in the URL. The player HUD is src/ui (S4).
    if (spec.debug || telemetryRequested()) {
      this.hud = new Text({ text: '', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 8, fill: 0x8a92a8 } });
      this.hud.alpha = 0.7;
      this.hud.position.set(4, spec.debug ? 338 : 348);
      this.root.addChild(this.hud);
    } else this.hud = null;
  }

  /** Wall ms the last render() spent in terrain streaming, uploads included (FPS-counter hitch attribution). */
  get terrainPaintMs(): number {
    return this.terrain.msLastUpdate;
  }

  /** Terrain streaming diagnostics (FPS counter terrain line); filled into `out` (no allocation). */
  terrainDiag(out: TerrainDiag): TerrainDiag {
    const t = this.terrain;
    out.jumps = t.jumpUpdates;
    out.late = t.lateChunks;
    out.syncUploads = t.syncUploadsTotal;
    out.ms = t.msLastUpdate;
    out.uploadMs = t.uploadMsLastUpdate;
    return out;
  }

  render(alpha: number, nowMs: number, paused: boolean): void {
    const s = this.session;
    const cam = s.camera.interpolated(alpha, this.camScratch);
    const o = s.camera.viewOrigin(cam, this.originScratch);
    this.feel.update(nowMs, paused);
    const sh = this.feel.shake;
    this.world.position.set(-o.x + sh.x, -o.y + sh.y);
    this.terrain.update(o);
    if (this.crystal) {
      const em = s.env.radiation.emitters;
      let charge = 0;
      for (const e of em) charge = Math.max(charge, s.env.radiation.charge(e, s.simTime));
      this.crystal.update(o, nowMs, charge);
    }
    this.entities.render(alpha, o, nowMs);
    // parallax: 0 = fixed to the screen, 1 = moves with the world
    for (const { layer, view } of this.backdrop) {
      const dx = -o.x * layer.parallax;
      const dy = layer.offsetY - o.y * layer.parallax;
      if (view instanceof TilingSprite) {
        view.position.set(layer.repeatX ? 0 : dx, layer.repeatY ? 0 : dy);
        view.tilePosition.set(layer.repeatX ? dx : 0, layer.repeatY ? dy : 0);
      } else view.position.set(dx, dy);
    }

    for (const { sprite, body } of this.movers) {
      if (!s.physics.hasBody(body)) continue;
      const t = s.physics.getInterpolatedTransform(body, alpha);
      sprite.position.set(mToPx(t.x), mToPx(t.y));
      sprite.rotation = t.angle;
    }
    const vx1 = o.x + VIEW_WIDTH;
    const vy1 = o.y + VIEW_HEIGHT;
    for (const p of this.staticProps) p.sprite.visible = p.x1 > o.x && p.x0 < vx1 && p.y1 > o.y && p.y0 < vy1;
    for (const p of this.animProps) if (p.sprite.visible) p.sprite.texture = this.flight.tex.get(p.name, (nowMs / 1000) * p.fps + p.phase * 4).tex;

    this.flight.hitFlash = this.feel.flashing;
    this.flight.render(alpha, nowMs, o);
    this.s7?.render(alpha, nowMs, o);
    if (!this.hud) return;
    const st = s.state;

    this.fpsFrames++;
    if (nowMs - this.fpsLastMs >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / Math.max(1, nowMs - this.fpsLastMs));
      this.fpsFrames = 0;
      this.fpsLastMs = nowMs;
    }
    if (nowMs < this.hudNextMs) return; // Text re-rasterises on change: 4 Hz is plenty
    this.hudNextMs = nowMs + 250;
    const speed = Math.hypot(st.vel.x, st.vel.y);
    const status = st.crashed ? 'CRASHED' : st.landed ? 'landed' : 'flying';
    // Mode, goo, orbs and beacons are on the S4 HUD (fed by GameEvents); this line is debug-only telemetry.
    this.hud.text =
      (s.spec.debug ? `1-4 / M: switch mode (csm · lander · harpoon · harpoon+thrust) · now ${st.mode}\n` : '') +
      `${s.spec.id} · t ${s.simTime.toFixed(1)}s · fuel ${Math.round(st.fuel * 100)}% · hull ${Math.round(st.hull * 100)}%` +
      ` · v ${speed.toFixed(0)}px/s · ${status} · ${this.fps}fps${paused ? ' · PAUSED' : ''}`;
  }

  /**
   * Hand every texture this level can show to `upload` once, so it reaches
   * the GPU on the loading screen rather than when first seen: the shared
   * sprite cache (pre-warmed flight / particle / S7 rock + Keeper frames),
   * every vessel-pose halo, and every Sprite / TilingSprite in the display
   * tree (backdrops, props, hidden pooled and flame sprites). Terrain chunks
   * are painted and uploaded as the camera streams them (only the ones on
   * screen at load are included).
   */
  /** GPU-initialise terrain chunk surfaces as they are created (renderer.texture.initSource; see TerrainView.setUploader). */
  setTerrainUploader(init: (source: TextureSource) => void): void {
    this.terrain.setUploader(init);
  }

  forEachTextureSource(upload: (source: TextureSource) => void): void {
    const seen = new Set<TextureSource>();
    const add = (t: Texture | undefined) => {
      if (!t || t === Texture.EMPTY || seen.has(t.source)) return;
      seen.add(t.source);
      upload(t.source);
    };
    this.flight.tex.forEachTexture(add);
    this.flight.forEachExtraTexture(add);
    const walk = (c: Container) => {
      if (c instanceof Sprite || c instanceof TilingSprite) add(c.texture);
      for (const child of c.children) walk(child);
    };
    walk(this.root);
  }

  /**
   * Level teardown, including the GPU: every texture source the level
   * pre-uploaded is unloaded now instead of lingering until Pixi's (slow,
   * 5 min) GC. Sources are unloaded, not destroyed: most wrap memoised art
   * canvases that menus or the next level may use again (they simply
   * re-upload). Terrain chunk textures are owned and destroyed by TerrainView.
   */
  destroy(): void {
    const sources: TextureSource[] = [];
    this.forEachTextureSource((src) => sources.push(src));
    this.feel.destroy();
    this.terrain.destroy();
    this.crystal?.destroy();
    this.entities.destroy();
    this.flight.destroy(); // halos + sprite cache teardown (its containers leave the tree)
    this.root.destroy({ children: true });
    for (const src of sources) if (!src.destroyed) src.unload();
  }

  /**
   * Exit docks: the landing strip, bracket markers at both ends of the zone
   * (full zone height, faint) and the obj.exitDock beacon standing on the
   * strip's centre.
   */
  private drawExits(spec: LevelSpec): Container {
    const c = new Container();
    const g = new Graphics();
    c.addChild(g);
    const f = this.art.getSprite('obj.exitDock', 0, spec.themeId);
    for (const e of spec.entities) {
      if (e.kind !== 'exitDock') continue;
      const x0 = e.x - e.w / 2;
      const x1 = e.x + e.w / 2;
      g.rect(x0, e.y - 3, e.w, 3).fill(0x40d080);
      for (let x = x0 + 4; x < x1 - 4; x += 8) g.rect(x, e.y - 3, 4, 1).fill(0xb0ffd0);
      for (const [x, dir] of [
        [x0, 1],
        [x1, -1],
      ] as const) {
        g.rect(x - (dir > 0 ? 0 : 2), e.y - e.h, 2, e.h).fill({ color: 0x40d080, alpha: 0.35 });
        g.rect(x - (dir > 0 ? 0 : 6), e.y - e.h, 6, 2).fill({ color: 0x40d080, alpha: 0.6 });
      }
      const s = new Sprite(Texture.from(f.canvas as HTMLCanvasElement));
      s.anchor.set(f.pivot.x / f.width, 1);
      s.position.set(e.x, e.y - 3);
      c.addChild(s);
    }
    return c;
  }
}

/** A layer whose texture spans the whole virtual view at parallax 0 (the sky). */
function coversView(l: BackdropLayer): boolean {
  return l.parallax === 0 && l.offsetY <= 0 && l.width >= VIEW_WIDTH && l.offsetY + l.height >= VIEW_HEIGHT;
}

/** ?telemetry in the page URL (browser only). */
function telemetryRequested(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('telemetry');
}
