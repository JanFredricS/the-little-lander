/**
 * Cutscene playback logic, DOM-free (the player in cutscenePlayer.ts feeds it
 * time + input and draws what it reports).
 *
 * Per shot (CutsceneShot.advance):
 *  - text types out at TYPE_CPS characters/second;
 *  - a press while typing reveals the whole shot;
 *  - `{ kind: 'key' }`: once typed, waits for a press;
 *  - `{ kind: 'duration', seconds }`: advances by itself after `seconds`
 *    AND once typing has finished (so a short duration never cuts text
 *    off); a press after typing skips ahead.
 * Holding skip for SKIP_HOLD_SEC ends the whole script (skipped = true).
 * Wall-clock is fine here: cutscenes are presentation, not simulation.
 */

import type { CutsceneScript, CutsceneShot } from '../contracts';
import { wrapText } from './font';

/** Typewriter speed (characters per second). */
export const TYPE_CPS = 40;
/** How long skip must be held to skip the whole cutscene (s). */
export const SKIP_HOLD_SEC = 0.8;
/** Text box geometry (characters / rows) — the scripts are written to fit. */
export const TEXT_BOX_COLS = 66;
export const TEXT_BOX_ROWS = 2;

/** The rows a shot displays (textLines, word-wrapped to the box). */
export function shotRows(shot: CutsceneShot): string[] {
  return shot.textLines.flatMap((l) => wrapText(l, TEXT_BOX_COLS));
}

export function shotCharCount(shot: CutsceneShot): number {
  return shotRows(shot).reduce((n, r) => n + r.length, 0);
}

export class CutscenePlayback {
  private index = 0;
  private rows: string[] = [];
  private total = 0;
  private typed = 0;
  private shotTime = 0;
  private held = 0;
  private _done = false;
  private _skipped = false;

  constructor(
    readonly script: CutsceneScript,
    private readonly onDone?: (skipped: boolean) => void,
  ) {
    this.enterShot(0);
  }

  get done(): boolean {
    return this._done;
  }
  get skipped(): boolean {
    return this._skipped;
  }
  get shotIndex(): number {
    return this.index;
  }
  get shot(): CutsceneShot | undefined {
    return this.script.shots[this.index];
  }
  /** Characters revealed so far in the current shot. */
  get visibleChars(): number {
    return Math.floor(this.typed);
  }
  get totalChars(): number {
    return this.total;
  }
  get typingDone(): boolean {
    return this.typed >= this.total;
  }
  /** Seconds spent on the current shot. */
  get shotSeconds(): number {
    return this.shotTime;
  }
  /** True when the shot is waiting for a press (show the ▼ prompt). */
  get waitingForKey(): boolean {
    return !this._done && this.typingDone && this.shot?.advance.kind === 'key';
  }
  /** 0..1 progress of the skip hold. */
  get skipProgress(): number {
    return Math.min(1, this.held / SKIP_HOLD_SEC);
  }

  /** Rows of the current shot with the typewriter applied. */
  visibleRows(): string[] {
    let left = this.visibleChars;
    const out: string[] = [];
    for (const r of this.rows) {
      if (left <= 0) break;
      out.push(r.slice(0, left));
      left -= r.length;
    }
    return out;
  }

  /** Advance time. `skipHeld` = skip input currently held. */
  update(dt: number, skipHeld = false): void {
    if (this._done) return;
    const d = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.held = skipHeld ? this.held + d : 0;
    if (this.held >= SKIP_HOLD_SEC) {
      this.skip();
      return;
    }
    this.typed = Math.min(this.total, this.typed + d * TYPE_CPS);
    this.shotTime += d;
    const adv = this.shot?.advance;
    if (adv?.kind === 'duration' && this.typingDone && this.shotTime >= adv.seconds) this.next();
  }

  /** Advance input (key / click / tap). */
  press(): void {
    if (this._done) return;
    if (!this.typingDone) this.typed = this.total;
    else this.next();
  }

  /** Skip the whole cutscene now. */
  skip(): void {
    if (this._done) return;
    this._skipped = true;
    this.finish();
  }

  private next(): void {
    if (this.index + 1 >= this.script.shots.length) this.finish();
    else this.enterShot(this.index + 1);
  }

  private enterShot(i: number): void {
    this.index = i;
    const shot = this.script.shots[i];
    if (!shot) {
      this.finish();
      return;
    }
    this.rows = shotRows(shot);
    this.total = this.rows.reduce((n, r) => n + r.length, 0);
    this.typed = 0;
    this.shotTime = 0;
  }

  private finish(): void {
    if (this._done) return;
    this._done = true;
    this.held = 0;
    this.onDone?.(this._skipped);
  }
}
