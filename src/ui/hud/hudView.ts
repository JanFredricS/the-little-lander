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
/** Slots of the vector-layer redraw key (see render()). */
const KEY_SLOTS = 11;

/** Bar fill fraction as bar() clamps it (NaN -> 0). */
function clampFrac(v: number): number {
  return Math.max(0, Math.min(1, v || 0));
}

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
  /** Round 8: inside the exit rect but a gate holds the vessel back (HudState.exitHint). */
  private readonly exitText = new PixelText('', { color: UI.danger, outline: UI.outline, scale: 2 });
  private readonly bossLabel = new PixelText('THE KEEPER', { color: UI.ink, shadow: UI.outline });
  // help card
  private readonly help = new Container();
  private readonly helpG = new Graphics();
  private readonly helpTitle = new PixelText('', { color: UI.accent, shadow: UI.outline, scale: 2 });
  /** Round 10 (G): the mission line(s) on the level-start card. */
  private readonly helpMission = new PixelText('', { color: UI.light, shadow: UI.outline });
  private readonly helpBody = new PixelText('', { color: UI.ink });
  private readonly helpHint = new PixelText('', { color: UI.dim });
  private helpKey = '';
  private missionShown = '';
  /**
   * Inputs of the last vector redraw. Pixi rebuilds a Graphics' geometry (and
   * the JS garbage that goes with it) on every clear(), so the bars / panel /
   * badge are only redrawn when something they show changed, not every frame.
   */
  private readonly drawKey = new Float64Array(KEY_SLOTS).fill(NaN);
  private keyChanged = false;
  // text inputs of the last frame (strings are only rebuilt when these change)
  private extrasFor = [-1, -1, -1];
  private objectivesFor: HudState['objectives'] | null = null;
  private objectiveCount = 0;
  private radFor = NaN;
  border: number = UI.ink;
  /** Virtual px the fuel/hull panel shifts right to clear the touch RESTART button (0 without touch controls). */
  leftInset = 0;
  /** Left edge (virtual px) of the top-right mode badge after the last render (the FPS readout sits left of it). */
  badgeLeft: number = VIEW_WIDTH;

  constructor() {
    for (let i = 0; i < MAX_OBJECTIVE_LINES; i++) this.objTexts.push(new PixelText('', { color: UI.ink, shadow: UI.outline }));
    this.root.addChild(this.g, this.fuelLabel, this.hullLabel, this.extra, this.modeText, ...this.objTexts, this.warnText, this.radText, this.bannerText, this.exitText, this.bossLabel);
    this.help.addChild(this.helpG, this.helpTitle, this.helpMission, this.helpBody, this.helpHint);
    this.help.visible = false;
    this.root.addChild(this.help);
  }

  /** Show (mode) or hide (null) the controls help card. */
  /** `mission`: the level-start card's mission line(s) ('' = none: mid-level cards, the pause card). */
  setHelp(mode: VesselMode | null, touch: boolean, start = true, swap = false, direct = false, joystick = false, mission = '', stickRight = false): void {
    if (mode === null) {
      this.help.visible = false;
      this.helpKey = '';
      return;
    }
    const key = `${helpCardKey(mode, touch, start, this.border, swap, direct, joystick, stickRight)}|${mission}`;
    this.help.visible = true;
    if (key === this.helpKey) return;
    this.helpKey = key;
    const card = helpCard(mode, touch, start, swap, direct, joystick, stickRight);
    this.helpTitle.setText(card.title);
    this.missionShown = mission;
    this.helpMission.setText(mission);
    this.helpMission.visible = mission !== '';
    this.helpBody.setText(card.lines.join('\n'));
    this.helpHint.setText(card.hint);
    const mh = mission ? this.helpMission.height + 8 : 0;
    const w = Math.max(this.helpTitle.width, mission ? this.helpMission.width : 0, this.helpBody.width, this.helpHint.width) + 24;
    const h = this.helpTitle.height + mh + this.helpBody.height + this.helpHint.height + 36;
    const x = Math.round((VIEW_WIDTH - w) / 2);
    const y = Math.round((VIEW_HEIGHT - h) / 2) + 10;
    this.helpG.clear();
    panel(this.helpG, x, y, w, h, this.border, 0.9);
    this.helpTitle.position.set(Math.round(VIEW_WIDTH / 2 - this.helpTitle.width / 2), y + 8);
    this.helpMission.position.set(Math.round(VIEW_WIDTH / 2 - this.helpMission.width / 2), y + 14 + this.helpTitle.height);
    this.helpBody.position.set(x + 12, y + 14 + this.helpTitle.height + mh);
    this.helpHint.position.set(Math.round(VIEW_WIDTH / 2 - this.helpHint.width / 2), y + h - 8 - this.helpHint.height);
  }

  /** The mission text on the shown card ('' if none / hidden). */
  get helpMissionText(): string {
    return this.help.visible ? this.missionShown : '';
  }

  get helpVisible(): boolean {
    return this.help.visible;
  }

  render(s: HudState, nowMs: number): void {
    const blink = Math.floor(nowMs / 250) % 2 === 0;
    this.keyChanged = false;

    // --- fuel / hull panel (top-left; right of the touch RESTART button when shown)
    const hasExtras = s.attachedGoo > 0 || s.orbTarget > 0 || s.orbs > 0;
    const ef = this.extrasFor;
    if (ef[0] !== s.attachedGoo || ef[1] !== s.orbs || ef[2] !== s.orbTarget) {
      ef[0] = s.attachedGoo;
      ef[1] = s.orbs;
      ef[2] = s.orbTarget;
      const extras: string[] = [];
      if (s.attachedGoo > 0) extras.push(`GOO ×${s.attachedGoo}`);
      if (s.orbTarget > 0 || s.orbs > 0) extras.push(`ORBS ${s.orbs}${s.orbTarget > 0 ? `/${s.orbTarget}` : ''}`);
      this.extra.setText(extras.join('  '), { color: s.attachedGoo > 0 ? UI.goo : UI.accent });
    }
    const lx = Math.max(0, Math.round(this.leftInset));
    this.fuelLabel.position.set(lx + 9, 8);
    this.hullLabel.position.set(lx + 9, 20);
    this.extra.position.set(lx + 9, 34);
    const low = fuelLow(s);
    const fuelColor = low ? (blink ? UI.danger : UI.light) : UI.fuel;
    this.fuelLabel.setText('FUEL', { color: low && blink ? UI.danger : UI.ink });
    const hullColor = s.hull < HULL_LOW ? UI.danger : UI.hull;

    // --- mode badge (top-right)
    this.modeText.setText(MODE_LABEL[s.mode]);
    const bw = this.modeText.width + 10;
    const bx = VIEW_WIDTH - 4 - bw;
    this.modeText.position.set(bx + 5, 7);
    this.badgeLeft = bx - 1;

    // --- warnings (top centre, below the touch pause button)
    const wy = 62;
    let arrowX = NaN;
    let arrowAngle = 0;
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
      if (visible && dir) {
        arrowX = x0 + 11;
        arrowAngle = Math.atan2(s.wind.accel.y, s.wind.accel.x);
      }
    } else this.warnText.visible = false;

    // --- vector layer: redraw only when one of its inputs changed
    this.put(0, lx);
    this.put(1, hasExtras ? 1 : 0);
    this.put(2, Math.round(76 * clampFrac(s.fuel)));
    this.put(3, fuelColor);
    this.put(4, Math.round(76 * clampFrac(s.hull)));
    this.put(5, hullColor);
    this.put(6, bw);
    this.put(7, arrowX);
    this.put(8, arrowAngle);
    this.put(9, s.bossHp === null ? -1 : Math.round(200 * clampFrac(s.bossHp)));
    this.put(10, this.border);
    if (this.keyChanged) {
      const g = this.g.clear();
      panel(g, lx + 3, 3, 116, hasExtras ? 43 : 30, this.border, 0.7);
      bar(g, lx + 37, 9, 76, 6, s.fuel, fuelColor);
      bar(g, lx + 37, 21, 76, 6, s.hull, hullColor);
      g.rect(bx - 1, 3, bw + 2, 14).fill(UI.outline);
      g.rect(bx, 4, bw, 12).fill(UI.accent);
      if (!Number.isNaN(arrowX)) arrow(g, arrowX, wy, arrowAngle, 18, UI.wind);
      if (s.bossHp !== null) bar(g, Math.round(VIEW_WIDTH / 2 - 100), VIEW_HEIGHT - 12, 200, 5, s.bossHp, UI.danger);
    }

    // --- objectives (top-right, under the badge); the lines only change with the objectives array
    if (s.objectives !== this.objectivesFor) {
      this.objectivesFor = s.objectives;
      const lines = objectiveLines(s).slice(0, MAX_OBJECTIVE_LINES);
      this.objectiveCount = lines.length;
      this.objTexts.forEach((t, i) => {
        const l = lines[i];
        t.visible = !!l;
        if (l) t.setText(`${l.done ? '*' : '■'} ${l.text}`, { color: l.done ? UI.ok : UI.ink });
      });
    }
    for (let i = 0; i < this.objectiveCount; i++) {
      const t = this.objTexts[i]!;
      t.position.set(VIEW_WIDTH - 5 - t.width, 22 + i * 10);
    }

    const ry = wy + 16;
    if (s.radiationHit > 0) {
      this.radText.visible = true;
      const lost = -1 - Math.round(s.radiationFuelLost * 100); // negative: never equals a countdown key
      if (lost !== this.radFor) {
        this.radFor = lost;
        this.radText.setText(`RADIATION HIT! -${-1 - lost}% FUEL`, { color: UI.danger });
      }
    } else if (s.radiation && !s.crashed) {
      const urgent = s.radiation.inSec < 1.5;
      this.radText.visible = !urgent || blink;
      const tenths = Math.round(s.radiation.inSec * 10);
      if (tenths !== this.radFor) {
        this.radFor = tenths;
        this.radText.setText(`RADIATION IN ${(tenths / 10).toFixed(1)}S - TAKE COVER`, { color: UI.radiation });
      }
    } else this.radText.visible = false;
    this.radText.position.set(Math.round(VIEW_WIDTH / 2 - this.radText.width / 2), ry);

    // --- banner
    if (s.banner) {
      this.bannerText.visible = true;
      this.bannerText.setText(s.banner.text);
      this.bannerText.position.set(Math.round(VIEW_WIDTH / 2 - this.bannerText.width / 2), 104);
    } else this.bannerText.visible = false;

    // --- exit gate hint (under the banner): never a silent failure inside the exit
    if (s.exitHint) {
      this.exitText.visible = true;
      this.exitText.setText(s.exitHint);
      this.exitText.position.set(Math.round(VIEW_WIDTH / 2 - this.exitText.width / 2), 128);
    } else this.exitText.visible = false;

    // --- boss hp (bottom centre)
    this.bossLabel.visible = s.bossHp !== null;
    if (s.bossHp !== null) this.bossLabel.position.set(Math.round(VIEW_WIDTH / 2 - 100), VIEW_HEIGHT - 22);
  }

  /** Record redraw-key slot `i`; flags a redraw when it changed. */
  private put(i: number, v: number): void {
    const k = this.drawKey;
    if (k[i] === v || (Number.isNaN(v) && Number.isNaN(k[i]!))) return;
    k[i] = v;
    this.keyChanged = true;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
