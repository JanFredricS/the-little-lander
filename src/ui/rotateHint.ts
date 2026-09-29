/**
 * Portrait "rotate your device" hint. The scaler (src/shell/scaler.ts)
 * already letterboxes the 640×360 view in portrait; this overlay sits on
 * top and asks the player to turn the device. Tapping it dismisses it until
 * the device next goes landscape and back to portrait.
 */

import { rasterText } from './font';

/** Show the hint for a portrait box on a touch device (pure; tested). */
export function shouldShowRotateHint(w: number, h: number, touch: boolean, dismissed: boolean): boolean {
  return touch && !dismissed && h > w;
}

export class RotateHint {
  readonly el: HTMLDivElement;
  private dismissed = false;
  private wasPortrait = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly isTouch: () => boolean,
  ) {
    const el = document.createElement('div');
    el.dataset.testid = 'rotate-hint';
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '10',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '24px',
      background: 'rgba(11,13,20,0.88)',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const icon = rasterText('↻', { color: 0xf0b030 });
    const title = rasterText('ROTATE YOUR DEVICE', { color: 0xf0f2f8, shadow: 0x0b0d14 });
    const sub = rasterText('LANDSCAPE PLAYS BEST\nTAP TO CONTINUE ANYWAY', { color: 0x9aa4b8, align: 'center' });
    for (const [cv, s] of [
      [icon, 8],
      [title, 2],
      [sub, 2],
    ] as const) {
      cv.style.width = `${cv.width * s}px`;
      cv.style.height = `${cv.height * s}px`;
      cv.style.imageRendering = 'pixelated';
      el.appendChild(cv);
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dismissed = true;
      this.update();
    });
    host.appendChild(el);
    this.el = el;
    window.addEventListener('resize', this.update);
    window.addEventListener('orientationchange', this.update);
    this.update();
  }

  readonly update = (): void => {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const portrait = h > w;
    if (!portrait && this.wasPortrait) this.dismissed = false;
    this.wasPortrait = portrait;
    this.el.style.display = shouldShowRotateHint(w, h, this.isTouch(), this.dismissed) ? 'flex' : 'none';
  };

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  dispose(): void {
    window.removeEventListener('resize', this.update);
    window.removeEventListener('orientationchange', this.update);
    this.el.remove();
  }
}
