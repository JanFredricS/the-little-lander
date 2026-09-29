/**
 * Full-screen cutscene player: a DOM canvas at the still's native size
 * (STILL_WIDTH×STILL_HEIGHT) layered over the game, scaled to the window by
 * the largest integer factor that fits (fractional fill when that would be
 * under 2×, see stillScale), letterboxed on black. It does NOT draw into the 640×360 Pixi stage — 426×240 stills
 * don't integer-scale into it (see contracts/constants.ts).
 *
 * Input (desktop + mobile):
 *  - any key / click / tap: reveal text, then advance (CutscenePlayback.press)
 *  - hold Esc, or hold a finger / mouse button, for SKIP_HOLD_SEC: skip all
 *    (a pointer press only counts as "advance" when released before that)
 */

import { STILL_HEIGHT, STILL_WIDTH } from '../contracts';
import type { ArtApi, CutsceneScript, Speaker } from '../contracts';
import { computeViewScale, type ViewScale } from '../shell/scaler';
import { drawText, GLYPH_ADVANCE, LINE_HEIGHT, textWidth } from './font';
import { CutscenePlayback, TEXT_BOX_ROWS } from './playback';

export interface CutscenePlayerOptions {
  art: ArtApi;
  /** Called once when the script ends or is skipped (after the overlay is removed). */
  onDone(skipped: boolean): void;
  win?: Window;
}

export interface CutscenePlayerHandle {
  readonly playback: CutscenePlayback;
  /** Remove the overlay and listeners without calling onDone. */
  destroy(): void;
}

const SPEAKER_STYLE: Record<Speaker, { name: string; color: string } | null> = {
  wren: { name: 'WREN', color: '#f0b030' },
  io: { name: 'IO', color: '#6ad0c0' },
  commander: { name: 'COMMANDER', color: '#9ab8ff' },
  team: { name: 'RESEARCH TEAM', color: '#a0e070' },
  keeper: { name: 'THE KEEPER', color: '#e05a8a' },
  narrator: null,
};

const INK = '#e8ecf4';
const SHADOW = '#05060a';
const NARRATION_INK = '#c8d0e0';

// Text box layout in native still px.
const BOX_PAD_X = 6;
const BOX_PAD_Y = 5;
const BOX_H = BOX_PAD_Y * 2 + LINE_HEIGHT * TEXT_BOX_ROWS - 2;
const BOX_X = 4;
const BOX_W = STILL_WIDTH - BOX_X * 2;
const BOX_Y = STILL_HEIGHT - BOX_H - 4;

type Ctx2D = CanvasRenderingContext2D;

export function playCutscene(host: HTMLElement, script: CutsceneScript, opts: CutscenePlayerOptions): CutscenePlayerHandle {
  const win = opts.win ?? window;
  const doc = host.ownerDocument;
  const playback = new CutscenePlayback(script);

  const root = doc.createElement('div');
  root.dataset.cutscene = script.id;
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    background: '#000',
    zIndex: '10',
    touchAction: 'none',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  const canvas = doc.createElement('canvas');
  canvas.width = STILL_WIDTH;
  canvas.height = STILL_HEIGHT;
  Object.assign(canvas.style, { position: 'absolute', imageRendering: 'pixelated' });
  root.appendChild(canvas);
  host.appendChild(root);
  const ctx = canvas.getContext('2d') as Ctx2D;
  ctx.imageSmoothingEnabled = false;

  // ------------------------------------------------------------ scaling
  const layout = () => {
    const s = stillScale(root.clientWidth, root.clientHeight, win.devicePixelRatio || 1);
    canvas.style.width = `${s.cssWidth}px`;
    canvas.style.height = `${s.cssHeight}px`;
    canvas.style.left = `${s.offsetX}px`;
    canvas.style.top = `${s.offsetY}px`;
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  ro?.observe(root);
  win.addEventListener('resize', layout);
  layout();

  // ------------------------------------------------------------ input
  let escHeld = false;
  let pointerId: number | null = null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code) || e.code === 'Tab') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') escHeld = true;
    else if (!e.repeat) playback.press();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Escape') escHeld = false;
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    try {
      root.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic / already-released pointer: capture is only a nicety */
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    // A long hold that skipped leaves playback done; a short one is a tap.
    playback.press();
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) pointerId = null;
  };
  const onBlur = () => {
    escHeld = false;
    pointerId = null;
  };
  // Capture phase so the game's own key handlers never see cutscene keys.
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('keyup', onKeyUp, true);
  win.addEventListener('blur', onBlur);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ------------------------------------------------------------ loop
  let raf = 0;
  let last = -1;
  let alive = true;
  const destroy = () => {
    if (!alive) return;
    alive = false;
    win.cancelAnimationFrame(raf);
    ro?.disconnect();
    win.removeEventListener('resize', layout);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('keyup', onKeyUp, true);
    win.removeEventListener('blur', onBlur);
    root.remove();
  };
  const frame = (now: number) => {
    if (!alive) return;
    const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    playback.update(dt, escHeld || pointerId !== null);
    if (playback.done) {
      const skipped = playback.skipped;
      destroy();
      opts.onDone(skipped);
      return;
    }
    draw(ctx, playback, opts.art, now / 1000);
    raf = win.requestAnimationFrame(frame);
  };
  raf = win.requestAnimationFrame(frame);

  return { playback, destroy };
}

/**
 * Integer device-pixel scale (crisp) when at least 2× fits; below that
 * (portrait phones) fill the width fractionally — a 1× still would leave
 * the 5 px font unreadably small.
 */
export function stillScale(cssW: number, cssH: number, dpr: number): ViewScale {
  const s = computeViewScale(cssW, cssH, dpr, STILL_WIDTH, STILL_HEIGHT);
  if (s.fractional || s.deviceScale >= 2) return s;
  const r = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const fit = Math.min((Math.max(1, cssW) * r) / STILL_WIDTH, (Math.max(1, cssH) * r) / STILL_HEIGHT);
  const cssWidth = (STILL_WIDTH * fit) / r;
  const cssHeight = (STILL_HEIGHT * fit) / r;
  return { deviceScale: fit, fractional: true, cssWidth, cssHeight, offsetX: (cssW - cssWidth) / 2, offsetY: (cssH - cssHeight) / 2, cssPerVirtual: fit / r };
}

// ------------------------------------------------------------------ drawing

function draw(ctx: Ctx2D, pb: CutscenePlayback, art: ArtApi, t: number): void {
  const shot = pb.shot;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, STILL_WIDTH, STILL_HEIGHT);
  if (!shot) return;
  ctx.drawImage(art.getStill(shot.still) as CanvasImageSource, 0, 0, STILL_WIDTH, STILL_HEIGHT);

  // Skip hint (top-right) + hold progress.
  const hint = 'hold to skip';
  const hx = STILL_WIDTH - textWidth(hint) - 5;
  ctx.globalAlpha = pb.skipProgress > 0 ? 1 : 0.55;
  drawText(ctx, hint, hx, 4, INK, SHADOW);
  ctx.globalAlpha = 1;
  if (pb.skipProgress > 0.05) {
    ctx.fillStyle = SHADOW;
    ctx.fillRect(hx, 15, textWidth(hint), 3);
    ctx.fillStyle = '#f0b030';
    ctx.fillRect(hx, 15, Math.round(textWidth(hint) * pb.skipProgress), 2);
  }

  const rows = pb.visibleRows();
  if (!shot.textLines.length) return;

  // Text box.
  ctx.fillStyle = 'rgba(6, 8, 16, 0.84)';
  ctx.fillRect(BOX_X, BOX_Y, BOX_W, BOX_H);
  ctx.fillStyle = 'rgba(216, 220, 232, 0.5)';
  ctx.fillRect(BOX_X, BOX_Y, BOX_W, 1);
  ctx.fillRect(BOX_X, BOX_Y + BOX_H - 1, BOX_W, 1);

  // Name plate.
  const who = shot.speaker ? SPEAKER_STYLE[shot.speaker] : null;
  if (who) {
    const w = textWidth(who.name) + 8;
    ctx.fillStyle = 'rgba(6, 8, 16, 0.84)';
    ctx.fillRect(BOX_X + 4, BOX_Y - 11, w, 11);
    ctx.fillStyle = who.color;
    ctx.fillRect(BOX_X + 4, BOX_Y - 11, w, 1);
    drawText(ctx, who.name, BOX_X + 8, BOX_Y - 9, who.color);
  }

  // Dialogue (last TEXT_BOX_ROWS rows if a shot ever overflows).
  const ink = who ? INK : NARRATION_INK;
  rows.slice(-TEXT_BOX_ROWS).forEach((r, i) => drawText(ctx, r, BOX_X + BOX_PAD_X, BOX_Y + BOX_PAD_Y + i * LINE_HEIGHT, ink, SHADOW));

  // Advance prompt: a blinking ▼ in the corner.
  if (pb.waitingForKey && Math.floor(t * 2.5) % 2 === 0) {
    const x = BOX_X + BOX_W - GLYPH_ADVANCE - 4;
    const y = BOX_Y + BOX_H - 8;
    ctx.fillStyle = INK;
    for (let i = 0; i < 3; i++) ctx.fillRect(x + i, y + i, 5 - i * 2, 1);
  }
}
