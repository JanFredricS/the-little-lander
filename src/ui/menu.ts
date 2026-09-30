/**
 * Menu logic (pure, unit-tested): focus movement, activation, back, and a
 * touch-aware vertical layout. The Pixi views only draw what this returns.
 *
 * Keyboard: ↑/W/← prev · ↓/S/→ next · Enter/Space/NumpadEnter activate ·
 * Escape/Backspace back · Digit1..9 jump-and-activate (level select).
 * (In a level - pause / results - GameUi.shortcut claims Backspace first: RESTART.)
 * Mouse: hover focuses, click activates. Touch: tap activates, vertical drag
 * scrolls long lists.
 */

export interface MenuItem {
  id: string;
  label: string;
  /** Right-hand detail text (best time, lock reason...). */
  detail?: string;
  /** Disabled items can be focused (to read why) but not activated. */
  enabled: boolean;
}

export interface MenuState {
  items: readonly MenuItem[];
  focus: number;
  /** First visible row (scrolling lists). */
  scroll: number;
}

export type MenuCommand = 'prev' | 'next' | 'activate' | 'back' | { jump: number };

export interface MenuResult {
  state: MenuState;
  /** Item id to activate (only enabled items). */
  activate?: string;
  /** Activation was attempted on a disabled item (flash "LOCKED"). */
  rejected?: string;
  back?: boolean;
}

export function createMenu(items: readonly MenuItem[], focus = 0): MenuState {
  const f = items.length ? Math.min(Math.max(0, focus), items.length - 1) : 0;
  return { items, focus: f, scroll: 0 };
}

export function keyToCommand(code: string): MenuCommand | null {
  switch (code) {
    case 'ArrowUp':
    case 'ArrowLeft':
    case 'KeyW':
    case 'KeyA':
      return 'prev';
    case 'ArrowDown':
    case 'ArrowRight':
    case 'KeyS':
    case 'KeyD':
    case 'Tab':
      return 'next';
    case 'Enter':
    case 'NumpadEnter':
    case 'Space':
      return 'activate';
    case 'Escape':
    case 'Backspace':
      return 'back';
    default: {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      return m ? { jump: Number(m[1]) - 1 } : null;
    }
  }
}

export function menuCommand(s: MenuState, cmd: MenuCommand): MenuResult {
  const n = s.items.length;
  if (cmd === 'back') return { state: s, back: true };
  if (n === 0) return { state: s };
  if (cmd === 'prev') return { state: { ...s, focus: (s.focus - 1 + n) % n } };
  if (cmd === 'next') return { state: { ...s, focus: (s.focus + 1) % n } };
  const idx = cmd === 'activate' ? s.focus : cmd.jump;
  const item = s.items[idx];
  if (!item) return { state: s };
  const state = { ...s, focus: idx };
  return item.enabled ? { state, activate: item.id } : { state, rejected: item.id };
}

/** Focus a given index (hover / tap). */
export function menuFocus(s: MenuState, index: number): MenuState {
  if (index < 0 || index >= s.items.length || index === s.focus) return s;
  return { ...s, focus: index };
}

/** Keep `focus` inside the visible window [scroll, scroll + visible). */
export function scrollToFocus(s: MenuState, visible: number): MenuState {
  const v = Math.max(1, visible);
  const maxScroll = Math.max(0, s.items.length - v);
  let scroll = Math.min(Math.max(0, s.scroll), maxScroll);
  if (s.focus < scroll) scroll = s.focus;
  else if (s.focus >= scroll + v) scroll = s.focus - v + 1;
  return scroll === s.scroll ? s : { ...s, scroll };
}

export function scrollBy(s: MenuState, rows: number, visible: number): MenuState {
  const maxScroll = Math.max(0, s.items.length - Math.max(1, visible));
  const scroll = Math.min(maxScroll, Math.max(0, s.scroll + rows));
  return scroll === s.scroll ? s : { ...s, scroll };
}

// ------------------------------------------------------------------ layout

/** Minimum touch target edge in CSS px (contracts/input.ts rule, applied to menus too). */
export const MIN_TOUCH_CSS = 48;

export interface RowLayoutOptions {
  /** Virtual px available for rows (top..bottom). */
  top: number;
  bottom: number;
  /** CSS px per virtual px (PixiHost.scale.cssPerVirtual). */
  cssPerVirtual: number;
  /** Smallest row the art looks right at (virtual px). */
  minRow: number;
  /** Largest row worth drawing (virtual px). */
  maxRow: number;
  gap: number;
}

export interface RowLayout {
  rowH: number;
  /** Rows that fit (a scrolling list shows this many). */
  visible: number;
  /** y of row i (i relative to the first visible row). */
  rowY(i: number): number;
  /** Row height meets the 48 CSS px touch target. */
  touchSized: boolean;
}

/**
 * Row height: the virtual height that is ≥ 48 CSS px (never below minRow).
 * maxRow only caps rows that would be taller for other reasons; it never
 * undercuts the touch size, so at fractional scales (cssPerVirtual < 1)
 * rows grow past maxRow and long lists scroll (visible < n).
 */
export function layoutRows(n: number, o: RowLayoutOptions): RowLayout {
  const cpv = o.cssPerVirtual > 0 ? o.cssPerVirtual : 1;
  const want = Math.ceil(MIN_TOUCH_CSS / cpv);
  const avail = Math.max(1, o.bottom - o.top);
  let rowH = Math.max(o.minRow, want);
  rowH = Math.min(rowH, avail);
  const visible = Math.max(1, Math.min(n, Math.floor((avail + o.gap) / (rowH + o.gap))));
  // Short lists: grow rows toward the touch size when there is room.
  if (visible === n && rowH < want) {
    const grow = Math.floor((avail - o.gap * (n - 1)) / Math.max(1, n));
    rowH = Math.max(rowH, Math.min(want, grow, Math.max(o.maxRow, want)));
  }
  return {
    rowH,
    visible,
    rowY: (i) => o.top + i * (rowH + o.gap),
    touchSized: rowH * cpv >= MIN_TOUCH_CSS - 1e-6,
  };
}

/** Index of the visible row under virtual y (hit rows include half the gap). */
export function rowAt(layout: RowLayout, gap: number, y: number, count: number): number {
  for (let i = 0; i < Math.min(layout.visible, count); i++) {
    const top = layout.rowY(i) - gap / 2;
    if (y >= top && y < top + layout.rowH + gap) return i;
  }
  return -1;
}
