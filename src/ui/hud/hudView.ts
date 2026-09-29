/**
 * HUD renderer (Pixi, 640×360 virtual px): fuel bar (flashes under 25%),
 * hull bar, goo count, orbs, mode badge, objective tracker, wind-gust
 * warning arrow, radiation-charge warning, banners, boss hp, and the
 * per-mode controls help card. Reads HudState only.
 */

import { Container, Graphics } from 'pixi.js';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../../contracts';
import type { VesselMode } from '../../contracts';
import { helpCard, helpCardKey } from '../controlsHelp';
import { arrow, bar, panel } from '../draw';
import { PixelText } from '../pixelText';
import { UI } from '../uiTheme';
import { fuelLow, HULL_LOW, MODE_LABEL, objectiveLines, windArrow, type HudState } from './hudState';

const MAX_OBJECTIVE_LINES = 5;

export class HudView {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly fuelLabel = new PixelText('FUEL', { color: UI.ink, shadow: UI.outline });
  private readonly hullLabel = new PixelText('HULL', { color: UI.ink, shadow: UI.outline });
  private readonly extra = new PixelText('', { color: UI.goo, shadow: UI.outline });
  private readonly modeText = new PixelText('', { color: UI.bg });
  private readonly objTexts: PixelText[] = [];
  private readonly warnText = new PixelText('', { color: UI.wind, outline: UI.outline });
  private readonly radText = new PixelText('', { color: UI.radiation, outline: UI.outline });
  private readonly bannerText = new PixelText('', { color: UI.light, outline: UI.outline, scale: 2 });
  private readonly bossLabel = new PixelText('THE KEEPER', { color: UI.ink, shadow: UI.outline });
  // help card
  private readonly help = new Container();
  private readonly helpG = new Graphics();
  private readonly helpTitle = new PixelText('', { color: UI.accent, shadow: UI.outline, scale: 2 });
  private readonly helpBody = new PixelText('', { color: UI.ink });
  private readonly helpHint = new PixelText('', { color: UI.dim });
  private helpKey = '';
  border: number = UI.ink;

  constructor() {
    for (let i = 0; i < MAX_OBJECTIVE_LINES; i++) this.objTexts.push(new PixelText('', { color: UI.ink, shadow: UI.outline }));
    this.fuelLabel.position.set(9, 8);
    this.hullLabel.position.set(9, 20);
    this.extra.position.set(9, 34);
    this.root.addChild(this.g, this.fuelLabel, this.hullLabel, this.extra, this.modeText, ...this.objTexts, this.warnText, this.radText, this.bannerText, this.bossLabel);
    this.help.addChild(this.helpG, this.helpTitle, this.helpBody, this.helpHint);
    this.help.visible = false;
    this.root.addChild(this.help);
  }

  /** Show (mode) or hide (null) the controls help card. */
  setHelp(mode: VesselMode | null, touch: boolean, start = true): void {
    if (mode === null) {
      this.help.visible = false;
      this.helpKey = '';
      return;
    }
    const key = helpCardKey(mode, touch, start, this.border);
    this.help.visible = true;
    if (key === this.helpKey) return;
    this.helpKey = key;
    const card = helpCard(mode, touch, start);
    this.helpTitle.setText(card.title);
    this.helpBody.setText(card.lines.join('\n'));
    this.helpHint.setText(card.hint);
    const w = Math.max(this.helpTitle.width, this.helpBody.width, this.helpHint.width) + 24;
    const h = this.helpTitle.height + this.helpBody.height + this.helpHint.height + 36;
    const x = Math.round((VIEW_WIDTH - w) / 2);
    const y = Math.round((VIEW_HEIGHT - h) / 2) + 10;
    this.helpG.clear();
    panel(this.helpG, x, y, w, h, this.border, 0.9);
    this.helpTitle.position.set(Math.round(VIEW_WIDTH / 2 - this.helpTitle.width / 2), y + 8);
    this.helpBody.position.set(x + 12, y + 14 + this.helpTitle.height);
    this.helpHint.position.set(Math.round(VIEW_WIDTH / 2 - this.helpHint.width / 2), y + h - 8 - this.helpHint.height);
  }

  get helpVisible(): boolean {
    return this.help.visible;
  }

  render(s: HudState, nowMs: number): void {
    const blink = Math.floor(nowMs / 250) % 2 === 0;
    const g = this.g.clear();

    // --- fuel / hull panel (top-left)
    const extras: string[] = [];
    if (s.attachedGoo > 0) extras.push(`GOO ×${s.attachedGoo}`);
    if (s.orbTarget > 0 || s.orbs > 0) extras.push(`ORBS ${s.orbs}${s.orbTarget > 0 ? `/${s.orbTarget}` : ''}`);
    this.extra.setText(extras.join('  '), { color: s.attachedGoo > 0 ? UI.goo : UI.accent });
    panel(g, 3, 3, 116, extras.length ? 43 : 30, this.border, 0.7);
    const low = fuelLow(s);
    const fuelColor = low ? (blink ? UI.danger : UI.light) : UI.fuel;
    bar(g, 37, 9, 76, 6, s.fuel, fuelColor);
    if (low && blink) this.fuelLabel.setText('FUEL', { color: UI.danger });
    else this.fuelLabel.setText('FUEL', { color: UI.ink });
    bar(g, 37, 21, 76, 6, s.hull, s.hull < HULL_LOW ? UI.danger : UI.hull);

    // --- mode badge + objectives (top-right)
    this.modeText.setText(MODE_LABEL[s.mode]);
    const bw = this.modeText.width + 10;
    const bx = VIEW_WIDTH - 4 - bw;
    g.rect(bx - 1, 3, bw + 2, 14).fill(UI.outline);
    g.rect(bx, 4, bw, 12).fill(UI.accent);
    this.modeText.position.set(bx + 5, 7);
    const lines = objectiveLines(s).slice(0, MAX_OBJECTIVE_LINES);
    this.objTexts.forEach((t, i) => {
      const l = lines[i];
      t.visible = !!l;
      if (!l) return;
      t.setText(`${l.done ? '*' : '■'} ${l.text}`, { color: l.done ? UI.ok : UI.ink });
      t.position.set(VIEW_WIDTH - 5 - t.width, 22 + i * 10);
    });

    // --- warnings (top centre, below the touch pause button)
    const wy = 62;
    if (s.wind && !s.crashed) {
      const dir = windArrow(s.wind.accel);
      const warning = s.wind.phase === 'warning';
      const visible = !warning || blink;
      this.warnText.visible = visible;
      this.warnText.setText(warning ? 'GUST INCOMING!' : 'WIND GUST');
      const tw = this.warnText.width;
      const total = tw + 30;
      const x0 = Math.round(VIEW_WIDTH / 2 - total / 2);
      this.warnText.position.set(x0 + 30, wy - 4);
      if (visible && dir) arrow(g, x0 + 11, wy, Math.atan2(s.wind.accel.y, s.wind.accel.x), 18, UI.wind);
    } else this.warnText.visible = false;

    const ry = wy + 16;
    if (s.radiationHit > 0) {
      this.radText.visible = true;
      this.radText.setText(`RADIATION HIT! -${Math.round(s.radiationFuelLost * 100)}% FUEL`, { color: UI.danger });
    } else if (s.radiation && !s.crashed) {
      const urgent = s.radiation.inSec < 1.5;
      this.radText.visible = !urgent || blink;
      this.radText.setText(`RADIATION IN ${s.radiation.inSec.toFixed(1)}S - TAKE COVER`, { color: UI.radiation });
    } else this.radText.visible = false;
    this.radText.position.set(Math.round(VIEW_WIDTH / 2 - this.radText.width / 2), ry);

    // --- banner
    if (s.banner) {
      this.bannerText.visible = true;
      this.bannerText.setText(s.banner.text);
      this.bannerText.position.set(Math.round(VIEW_WIDTH / 2 - this.bannerText.width / 2), 104);
    } else this.bannerText.visible = false;

    // --- boss hp (bottom centre)
    this.bossLabel.visible = s.bossHp !== null;
    if (s.bossHp !== null) {
      const w = 200;
      const x = Math.round(VIEW_WIDTH / 2 - w / 2);
      this.bossLabel.position.set(x, VIEW_HEIGHT - 22);
      bar(g, x, VIEW_HEIGHT - 12, w, 5, s.bossHp, UI.danger);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
