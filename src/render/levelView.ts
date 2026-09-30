/**
 * Level renderer: the theme's palette background + parallax backdrop layers
 * (S2 ArtApi), flat-colour terrain polygons (TODO(S8): S2 terrain tiles),
 * prop sprites, the flight systems (src/render/flightView.ts: pixel-art
 * vessel per mode with anchored flames and harpoon heads; zones, goo,
 * debris, pickups, beacons, radiation still placeholder shapes) and a dim
 * debug telemetry line (the player HUD is src/ui, S4). Everything is in
 * virtual px; the world container is offset by the interpolated camera.
 */

import { Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';
import type { ArtApi, BackdropLayer, LevelSpec, TerrainPiece } from '../contracts';
import type { LevelSession } from '../game/session';
import { mToPx } from '../physics/units';
import { FlightView } from './flightView';
import { S7LevelFx } from './s7LevelFx';

const TERRAIN_COLORS: Record<string, number> = {
  metal: 0x4a5064,
  rock: 0x6a5a4a,
  soil: 0x5a4a30,
  crystal: 0x4a8aa0,
  organic: 0x3a7a4a,
  ruin: 0x6a6a70,
};

export class LevelView {
  readonly root = new Container();
  private readonly world = new Container();
  private readonly flight: FlightView;
  /** S7 hook: level-owned systems (boss, rocks, ledges, collapse front, S7 gates). */
  private readonly s7: S7LevelFx | null;
  private readonly backdrop: { layer: BackdropLayer; view: Sprite | TilingSprite }[] = [];
  private readonly props = new Map<string, Sprite>();
  private readonly hud: Text;
  private fpsFrames = 0;
  private fpsLastMs = 0;
  private fps = 0;

  constructor(
    private readonly session: LevelSession,
    private readonly art: ArtApi,
  ) {
    const spec = session.spec;
    const bg = new Graphics().rect(0, 0, VIEW_WIDTH, VIEW_HEIGHT).fill(art.palettes[spec.themeId].background);
    this.root.addChild(bg);
    for (const layer of art.getBackdropLayers(spec.themeId)) {
      const texture = Texture.from(layer.canvas as HTMLCanvasElement);
      const view =
        layer.repeatX || layer.repeatY
          ? new TilingSprite({ texture, width: layer.repeatX ? VIEW_WIDTH : layer.width, height: layer.repeatY ? VIEW_HEIGHT : layer.height })
          : new Sprite(texture);
      this.backdrop.push({ layer, view });
      this.root.addChild(view);
    }
    this.root.addChild(this.world);

    this.flight = new FlightView(session, art);
    this.world.addChild(this.flight.under);
    this.world.addChild(this.drawTerrain(spec));
    this.world.addChild(this.drawExits(spec));

    for (const e of spec.entities) {
      if (e.kind !== 'staticProp') continue;
      const s = new Sprite(Texture.from(art.getSprite(e.sprite, 0, spec.themeId).canvas as HTMLCanvasElement));
      s.anchor.set(0.5);
      s.width = e.w;
      s.height = e.h;
      s.position.set(e.x, e.y);
      s.rotation = e.angle ?? 0;
      this.props.set(e.id, s);
      this.world.addChild(s);
    }

    this.world.addChild(this.flight.over);
    this.s7 = S7LevelFx.wanted(session) ? new S7LevelFx(session, art) : null;
    if (this.s7) {
      this.world.addChildAt(this.s7.under, 0);
      this.world.addChild(this.s7.over);
    }

    // S0 debug line; the player HUD is src/ui (S4), so this sits at the bottom, dimmed.
    this.hud = new Text({ text: '', style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 8, fill: 0x8a92a8 } });
    this.hud.alpha = 0.7;
    this.hud.position.set(4, spec.debug ? 338 : 348);
    this.root.addChild(this.hud);
  }

  render(alpha: number, nowMs: number, paused: boolean): void {
    const s = this.session;
    const cam = s.camera.interpolated(alpha);
    const o = s.camera.viewOrigin(cam);
    this.world.position.set(-o.x, -o.y);
    // parallax: 0 = fixed to the screen, 1 = moves with the world
    for (const { layer, view } of this.backdrop) {
      const dx = -o.x * layer.parallax;
      const dy = layer.offsetY - o.y * layer.parallax;
      if (view instanceof TilingSprite) {
        view.position.set(layer.repeatX ? 0 : dx, layer.repeatY ? 0 : dy);
        view.tilePosition.set(layer.repeatX ? dx : 0, layer.repeatY ? dy : 0);
      } else view.position.set(dx, dy);
    }

    for (const [id, { body }] of s.built.props) {
      const sprite = this.props.get(id);
      if (!sprite || !s.physics.hasBody(body)) continue;
      const t = s.physics.getInterpolatedTransform(body, alpha);
      sprite.position.set(mToPx(t.x), mToPx(t.y));
      sprite.rotation = t.angle;
    }

    this.flight.render(alpha, nowMs);
    this.s7?.render(alpha, nowMs);
    const st = s.state;

    this.fpsFrames++;
    if (nowMs - this.fpsLastMs >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / Math.max(1, nowMs - this.fpsLastMs));
      this.fpsFrames = 0;
      this.fpsLastMs = nowMs;
    }
    const speed = Math.hypot(st.vel.x, st.vel.y);
    const status = st.crashed ? 'CRASHED' : st.landed ? 'landed' : 'flying';
    // Mode, goo, orbs and beacons are on the S4 HUD (fed by GameEvents); this line is debug-only telemetry.
    this.hud.text =
      (s.spec.debug ? `1-4 / M: switch mode (csm · lander · harpoon · harpoon+thrust) · now ${st.mode}\n` : '') +
      `${s.spec.id} · t ${s.simTime.toFixed(1)}s · fuel ${Math.round(st.fuel * 100)}% · hull ${Math.round(st.hull * 100)}%` +
      ` · v ${speed.toFixed(0)}px/s · ${status} · ${this.fps}fps${paused ? ' · PAUSED' : ''}`;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private drawTerrain(spec: LevelSpec): Graphics {
    const g = new Graphics();
    for (const piece of spec.terrain.pieces) {
      g.poly(fillOutline(piece, spec.worldSize.h).flatMap((p) => [p.x, p.y])).fill(TERRAIN_COLORS[piece.style.material] ?? 0x4a5064);
      // 1px surface line
      const pts = piece.points.flatMap((p) => [p.x, p.y]);
      g.poly(pts, piece.kind === 'polygon').stroke({ width: 1, color: 0x9aa4b8, alignment: 0.5 });
    }
    return g;
  }

  private drawExits(spec: LevelSpec): Graphics {
    const g = new Graphics();
    for (const e of spec.entities) {
      if (e.kind !== 'exitDock') continue;
      g.rect(e.x - e.w / 2, e.y - e.h, e.w, e.h).fill({ color: 0x40d080, alpha: 0.18 });
      g.rect(e.x - e.w / 2, e.y - 3, e.w, 3).fill(0x40d080);
    }
    return g;
  }
}

/** Closed fill outline for a terrain piece (ground fills down, ceiling fills up). */
function fillOutline(piece: TerrainPiece, worldH: number): { x: number; y: number }[] {
  const pts = piece.points.map((p) => ({ x: p.x, y: p.y }));
  if (piece.kind === 'polygon') return pts;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const edgeY = piece.kind === 'ground' ? worldH : 0;
  return [...pts, { x: last.x, y: edgeY }, { x: first.x, y: edgeY }];
}
