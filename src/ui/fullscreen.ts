/**
 * Get rid of the browser toolbar on landscape phones (port of pineapple-run FS1).
 *
 * - Where the Fullscreen API works (Android, iPad, desktop) the title-screen
 *   START / CONTINUE press, and the first touch tap of a session, call
 *   `enterFullscreen()` from their user gesture (GameUi).
 * - iPhone Safari has no element fullscreen. Its landscape toolbar only
 *   collapses when the user scrolls the page, and the game page never
 *   scrolls (html/body are touch-action:none, overflow:hidden). So on iPhone
 *   (outside an installed home-screen app) `html.tll-ios-scroll` makes the
 *   document a little taller than the viewport and lets it pan vertically;
 *   #app stays position:fixed over it. While the toolbar is showing in
 *   landscape, a "SWIPE UP FOR FULLSCREEN" overlay (touch-action:pan-y, on
 *   <body>, outside #app whose touchmove is cancelled) covers the game so the
 *   swipe scrolls the page and Safari hides its bars. Game surfaces keep
 *   touch-action:none, so play never scrolls the page.
 */

import { rasterText } from './font';

/** Landscape toolbar is "showing" when the viewport is this much shorter than the screen. */
export const TOOLBAR_SLACK_PX = 24;

export interface ViewportInfo {
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
}

/** iPhone / iPod browser tab (not the installed home-screen app). */
export function isIphoneBrowser(userAgent: string, standalone: boolean | undefined): boolean {
  return /iPhone|iPod/.test(userAgent) && standalone !== true;
}

/** Pure rule: landscape, and the viewport is noticeably shorter than the screen's short side. */
export function toolbarShowingInLandscape(v: ViewportInfo): boolean {
  if (v.innerWidth <= v.innerHeight) return false;
  const shortSide = Math.min(v.screenWidth, v.screenHeight);
  return v.innerHeight < shortSide - TOOLBAR_SLACK_PX;
}

type FsDoc = Document & { webkitFullscreenElement?: Element | null };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function isFullscreen(doc: Document = document): boolean {
  const d = doc as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Best-effort fullscreen from a user gesture; silently ignored where unsupported (iPhone). */
export function enterFullscreen(doc: Document = document): void {
  if (isFullscreen(doc)) return;
  const root = doc.documentElement as FsEl;
  try {
    if (typeof root.requestFullscreen === 'function') {
      root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } else if (typeof root.webkitRequestFullscreen === 'function') {
      void Promise.resolve(root.webkitRequestFullscreen()).catch(() => {});
    }
  } catch {
    /* unsupported: nothing to do */
  }
}

const STYLE_ID = 'tll-fs-style';
const CSS = `
html.tll-ios-scroll,html.tll-ios-scroll body{overflow:visible;height:auto;touch-action:pan-y}
html.tll-ios-scroll body{min-height:calc(100vh + 160px)}
.tll-swipe-fs{position:fixed;inset:0;z-index:1900;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  padding:24px;background:rgba(11,13,20,.86);touch-action:pan-y}
.tll-swipe-fs[hidden]{display:none}
.tll-swipe-fs canvas{image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none}
.tll-swipe-fs__arrow{animation:tll-swipe-up 1.4s ease-in-out infinite}
.tll-swipe-fs__skip{min-width:120px;min-height:48px;display:flex;align-items:center;justify-content:center;background:rgba(11,13,20,.5);
  border:3px solid rgba(216,220,232,.55);touch-action:manipulation}
@keyframes tll-swipe-up{0%,100%{transform:translateY(8px)}50%{transform:translateY(-8px)}}
`;

function pixelLabel(text: string, scale: number, color: number, cls?: string): HTMLCanvasElement {
  const cv = rasterText(text, { color, shadow: 0x0b0d14, align: 'center' });
  cv.style.width = `${cv.width * scale}px`;
  cv.style.height = `${cv.height * scale}px`;
  if (cls) cv.className = cls;
  return cv;
}

let dismissed = false;

/**
 * Install the iPhone swipe-up helper (no-op elsewhere). Returns an idempotent
 * uninstall that removes the overlay, listeners and the html class.
 */
export function installSwipeToFullscreen(): () => void {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (!isIphoneBrowser(nav.userAgent ?? '', nav.standalone)) return () => {};

  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const html = document.documentElement;
  html.classList.add('tll-ios-scroll');
  const overlay = document.createElement('div');
  overlay.className = 'tll-swipe-fs';
  overlay.dataset.testid = 'swipe-fullscreen';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Swipe up for fullscreen');
  overlay.hidden = true;
  overlay.append(
    pixelLabel('↑', 8, 0xf0b030, 'tll-swipe-fs__arrow'),
    pixelLabel('SWIPE UP FOR FULLSCREEN', 3, 0xf0f2f8),
    pixelLabel('OR SHARE → ADD TO HOME SCREEN\nTO ALWAYS PLAY FULLSCREEN', 2, 0x9aa4b8),
  );
  const notNow = document.createElement('div');
  notNow.className = 'tll-swipe-fs__skip';
  notNow.setAttribute('role', 'button');
  notNow.setAttribute('aria-label', 'Not now');
  notNow.appendChild(pixelLabel('NOT NOW', 2, 0xf0f2f8));
  notNow.addEventListener('click', () => {
    dismissed = true;
    update();
  });
  overlay.appendChild(notNow);
  document.body.appendChild(overlay);

  function update(): void {
    const show =
      !dismissed &&
      toolbarShowingInLandscape({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: screen.width,
        screenHeight: screen.height,
      });
    overlay.hidden = !show;
  }
  // iOS reports the new size a beat after rotating / the bars animating
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (): void => {
    update();
    clearTimeout(timer);
    timer = setTimeout(update, 350);
  };
  window.addEventListener('resize', settle);
  window.addEventListener('orientationchange', settle);
  window.addEventListener('scroll', update, { passive: true });
  window.visualViewport?.addEventListener('resize', settle);
  update();

  let done = false;
  return () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    window.removeEventListener('resize', settle);
    window.removeEventListener('orientationchange', settle);
    window.removeEventListener('scroll', update);
    window.visualViewport?.removeEventListener('resize', settle);
    overlay.remove();
    html.classList.remove('tll-ios-scroll');
  };
}
