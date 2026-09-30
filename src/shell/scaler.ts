/**
 * Responsive scaling of the 640×360 virtual view.
 *
 * We scale in DEVICE pixels. LANDSCAPE (and square) boxes: the largest
 * integer k with 640k × 360k device px fitting the available box gives
 * crisp, uniform pixels at any DPR. PORTRAIT boxes (h > w, S9): the integer
 * scale left huge side bars on phones (390 CSS px wide at DPR 3 -> k = 1 =
 * 213 CSS px of game), so portrait uses the largest FRACTIONAL scale that
 * fits: the view spans the full width. At phone DPRs (2-3) a fractional
 * device scale is off by at most one device pixel per virtual pixel, and
 * the renderer rounds sprite positions to device px, so it stays crisp
 * enough. If even k = 1 does not fit in landscape, we fall back to the
 * fractional fit as well so nothing is cut off. The view is centred;
 * leftover space is letterbox (portrait = bars top and bottom, where the
 * touch buttons sit). The available box is the safe area (#app is inset by
 * env(safe-area-inset-*)), re-measured on resize / orientationchange /
 * visualViewport resize.
 */

import { VIEW_HEIGHT, VIEW_WIDTH } from '../contracts';

export interface ViewScale {
  /** Device pixels per virtual pixel (integer unless `fractional`). */
  deviceScale: number;
  fractional: boolean;
  /** CSS size of the canvas. */
  cssWidth: number;
  cssHeight: number;
  /** CSS offset of the canvas inside the available box (letterbox). */
  offsetX: number;
  offsetY: number;
  /** CSS px per virtual px (for pointer -> view conversion). */
  cssPerVirtual: number;
}

export function computeViewScale(availCssW: number, availCssH: number, dpr: number, viewW = VIEW_WIDTH, viewH = VIEW_HEIGHT): ViewScale {
  const r = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const w = Math.max(1, availCssW);
  const h = Math.max(1, availCssH);
  const fit = Math.min((w * r) / viewW, (h * r) / viewH);
  const k = Math.floor(fit + 1e-6);
  const portrait = h > w;
  const fractional = k < 1 || (portrait && fit - k > 1e-6);
  const deviceScale = fractional ? fit : k;
  const cssWidth = (viewW * deviceScale) / r;
  const cssHeight = (viewH * deviceScale) / r;
  return {
    deviceScale,
    fractional,
    cssWidth,
    cssHeight,
    offsetX: (w - cssWidth) / 2,
    offsetY: (h - cssHeight) / 2,
    cssPerVirtual: deviceScale / r,
  };
}

/** Client (CSS, viewport) point -> virtual view px, given the canvas rect. */
export function clientToView(clientX: number, clientY: number, canvasRect: { left: number; top: number; width: number; height: number }, viewW = VIEW_WIDTH, viewH = VIEW_HEIGHT): { x: number; y: number } {
  return {
    x: ((clientX - canvasRect.left) / Math.max(1e-6, canvasRect.width)) * viewW,
    y: ((clientY - canvasRect.top) / Math.max(1e-6, canvasRect.height)) * viewH,
  };
}

/** Watch the host box and call `apply` with a fresh ViewScale whenever it changes. */
export function watchViewScale(host: HTMLElement, apply: (s: ViewScale) => void, win: Window = window): () => void {
  let last = '';
  const update = () => {
    const s = computeViewScale(host.clientWidth, host.clientHeight, win.devicePixelRatio || 1);
    const key = `${s.deviceScale}|${s.cssWidth}|${s.cssHeight}`;
    if (key === last) return;
    last = key;
    apply(s);
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
  ro?.observe(host);
  win.addEventListener('resize', update);
  win.addEventListener('orientationchange', update);
  win.visualViewport?.addEventListener('resize', update);
  // DPR changes (browser zoom, moving between monitors)
  let mq: MediaQueryList | null = null;
  const watchDpr = () => {
    mq?.removeEventListener('change', onDpr);
    mq = win.matchMedia?.(`(resolution: ${win.devicePixelRatio || 1}dppx)`) ?? null;
    mq?.addEventListener('change', onDpr);
  };
  const onDpr = () => {
    update();
    watchDpr();
  };
  watchDpr();
  update();
  return () => {
    ro?.disconnect();
    win.removeEventListener('resize', update);
    win.removeEventListener('orientationchange', update);
    win.visualViewport?.removeEventListener('resize', update);
    mq?.removeEventListener('change', onDpr);
  };
}
