import { describe, expect, it } from 'vitest';
import { enterFullscreen, isFullscreen, isIphoneBrowser, TOOLBAR_SLACK_PX, toolbarShowingInLandscape } from '../src/ui/fullscreen';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('S9 fullscreen: iPhone detection', () => {
  it('iPhone Safari tab yes; installed home-screen app, iPad, Android no', () => {
    expect(isIphoneBrowser(IPHONE, undefined)).toBe(true);
    expect(isIphoneBrowser(IPHONE, false)).toBe(true);
    expect(isIphoneBrowser(IPHONE, true)).toBe(false);
    expect(isIphoneBrowser(IPAD, undefined)).toBe(false);
    expect(isIphoneBrowser(ANDROID, undefined)).toBe(false);
  });
});

describe('S9 fullscreen: toolbarShowingInLandscape', () => {
  // iPhone 14: screen 390x844 (reported portrait on iOS), landscape viewport with toolbar ~ 844x340
  const screen = { screenWidth: 390, screenHeight: 844 };
  it('landscape with the toolbar showing -> true', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 750, innerHeight: 340, ...screen })).toBe(true);
  });
  it('landscape with the toolbar collapsed -> false', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 844, innerHeight: 390, ...screen })).toBe(false);
    // within the slack (status/home indicator jitter)
    expect(toolbarShowingInLandscape({ innerWidth: 844, innerHeight: 390 - TOOLBAR_SLACK_PX + 1, ...screen })).toBe(false);
  });
  it('portrait never shows the hint (the rotate hint owns portrait)', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 390, innerHeight: 660, ...screen })).toBe(false);
    expect(toolbarShowingInLandscape({ innerWidth: 390, innerHeight: 390, ...screen })).toBe(false);
  });
  it('works whichever way the screen reports its size', () => {
    expect(toolbarShowingInLandscape({ innerWidth: 750, innerHeight: 340, screenWidth: 844, screenHeight: 390 })).toBe(true);
  });
});

describe('S9 fullscreen: enterFullscreen', () => {
  const fakeDoc = (el: Record<string, unknown>, fsEl: unknown = null) => ({ fullscreenElement: fsEl, documentElement: el }) as unknown as Document;

  it('requests fullscreen with the navigation UI hidden', () => {
    const calls: unknown[] = [];
    const doc = fakeDoc({ requestFullscreen: (o: unknown) => (calls.push(o), Promise.resolve()) });
    enterFullscreen(doc);
    expect(calls).toEqual([{ navigationUI: 'hide' }]);
  });
  it('falls back to webkitRequestFullscreen; no-op when already fullscreen or unsupported', () => {
    let wk = 0;
    enterFullscreen(fakeDoc({ webkitRequestFullscreen: () => void wk++ }));
    expect(wk).toBe(1);
    let n = 0;
    const already = fakeDoc({ requestFullscreen: () => (n++, Promise.resolve()) }, {});
    expect(isFullscreen(already)).toBe(true);
    enterFullscreen(already);
    expect(n).toBe(0);
    expect(() => enterFullscreen(fakeDoc({}))).not.toThrow();
  });
  it('a rejected request (no gesture / denied) is swallowed', async () => {
    enterFullscreen(fakeDoc({ requestFullscreen: () => Promise.reject(new Error('denied')) }));
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
  });
});
