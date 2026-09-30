/**
 * `?audiolab=1` debug page: trigger every SFX, toggle thruster loops per
 * mode, switch every music mood live (crossfade), drive asteroid tension,
 * fire sample GameEvents through the real wiring, and tweak the mixer.
 */

import { VESSEL_MODES, type GameEvent, type VesselMode } from '../contracts';
import { getAudio } from './index';
import { MOOD_IDS, MOODS, moodBpm } from './music';
import { SFX_IDS, type SfxId } from './sfx';
import type { VolumeChannel } from './engine';

const GROUPS: [string, (id: SfxId) => boolean][] = [
  ['Harpoon', (id) => id.startsWith('harpoon')],
  ['Impacts', (id) => ['bump', 'hullHit', 'crash', 'softLand', 'debris'].includes(id)],
  ['Pickups & progress', (id) => ['beaconChime', 'orbArp', 'fuelPickup', 'repair', 'objective', 'levelComplete', 'levelFailed', 'modeChange'].includes(id)],
  ['Hazards', (id) => ['gooAttach', 'gooBurn', 'radiationCharge', 'radiationBlast', 'windWarning', 'windWhoosh', 'gravityShift'].includes(id)],
  ['Boss', (id) => id.startsWith('boss')],
  ['UI & dialogue', (id) => ['uiMove', 'uiConfirm', 'uiBack', 'typeBlip'].includes(id)],
];

const SAMPLE_EVENTS: GameEvent[] = [
  { type: 'softLand', pos: { x: 0, y: 0 } },
  { type: 'impact', pos: { x: 0, y: 0 }, speed: 250, with: 'terrain' },
  { type: 'hullChanged', hull: 0.6, delta: -0.2, reason: 'impact' },
  { type: 'crash', cause: 'impact', pos: { x: 0, y: 0 }, speed: 500 },
  { type: 'beaconPlanted', siteId: 'b', planted: 3, total: 5 },
  { type: 'orbCollected', entityId: 'o', points: 100, fuelRefill: 10 },
  { type: 'fuelChanged', fuel: 100, delta: 25, reason: 'pickup' },
  { type: 'radiationCharging', emitterId: 'sun', inSec: 2 },
  { type: 'radiationHit', emitterId: 'sun', fuelLost: 30 },
  { type: 'windGust', zoneId: 'w', phase: 'warning', accel: { x: 10, y: 0 } },
  { type: 'windGust', zoneId: 'w', phase: 'start', accel: { x: 10, y: 0 } },
  { type: 'gravityChanged', gravity: { x: 0, y: -9.8 } },
  { type: 'gooAttached', gooId: 1, attached: 1 },
  { type: 'gooBurned', gooId: 1, attached: 0 },
  { type: 'harpoonFired', gun: 0, dir: { x: 0, y: -1 } },
  { type: 'harpoonMissed', gun: 0 },
  { type: 'ropeReeling', gun: 0, dir: 'in' },
  { type: 'ropeReeling', gun: 0, dir: 'out' },
  { type: 'ropeAttached', gun: 0, anchor: { x: 0, y: 0 }, brittle: true },
  { type: 'ropeBroken', gun: 0, reason: 'overload' },
  { type: 'ropeReleased', gun: 0 },
  { type: 'vesselModeChanged', from: 'csm', to: 'lander' },
  { type: 'bossPhase', phase: 2, hp: 0.6 },
  { type: 'bossHit', damage: 0.15, hp: 0.4, source: 'exhaust' },
  { type: 'bossDefeated' },
  { type: 'levelComplete', levelId: 'descent', timeSec: 90, orbs: 3, score: 1200 },
];

const CSS = `
.al{box-sizing:border-box;height:100%;overflow:auto;touch-action:pan-y;user-select:text;padding:16px;max-width:980px;margin:0 auto;font:13px/1.4 ui-monospace,Menlo,monospace;color:#d8dce8}
.al h1{font-size:16px;margin:0 0 4px}.al h2{font-size:13px;margin:18px 0 6px;color:#9fb4ff;text-transform:uppercase;letter-spacing:.08em}
.al .row{display:flex;flex-wrap:wrap;gap:6px}
.al button{font:inherit;color:#d8dce8;background:#1b2030;border:1px solid #33405e;border-radius:4px;padding:8px 10px;min-height:40px;cursor:pointer}
.al button:hover{background:#26304a}.al button.on{background:#2f6a4a;border-color:#4fa877}
.al label{display:inline-flex;align-items:center;gap:6px;margin-right:14px}
.al input[type=range]{width:140px}
.al .status{padding:8px 10px;background:#141826;border:1px solid #2a3350;border-radius:4px;margin:8px 0}
.al .warn{color:#ffcc66}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

export async function mountAudioLab(host: HTMLElement): Promise<void> {
  const audio = getAudio();
  host.replaceChildren();
  host.append(el('style', { textContent: CSS }));
  const root = el('div', { className: 'al' });
  host.append(root);
  // main.ts blocks touchmove on #app (game gestures); let this page scroll.
  root.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

  const status = el('div', { className: 'status' });
  root.append(el('h1', { textContent: 'The Little Lander — audio lab' }), status);

  // --- mixer
  const mixer = el('div', { className: 'row' });
  const sliders: Partial<Record<VolumeChannel, HTMLInputElement>> = {};
  for (const ch of ['master', 'music', 'sfx'] as VolumeChannel[]) {
    const s = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(audio.settings[ch]) });
    s.addEventListener('input', () => audio.setVolume(ch, Number(s.value)));
    sliders[ch] = s;
    mixer.append(el('label', {}, ch, s));
  }
  const mute = el('button', { textContent: 'Mute' });
  mute.addEventListener('click', () => audio.toggleMute());
  mixer.append(mute);
  root.append(el('h2', { textContent: 'Mixer (persisted)' }), mixer);

  // --- music
  const moods = el('div', { className: 'row' });
  const moodBtns = new Map<string, HTMLButtonElement>();
  const off = el('button', { textContent: 'stop' });
  off.addEventListener('click', () => audio.setMood(null));
  for (const m of MOOD_IDS) {
    const b = el('button', { textContent: MOODS[m].label });
    b.addEventListener('click', () => audio.setMood(m));
    moodBtns.set(m, b);
    moods.append(b);
  }
  moods.append(off);
  const tension = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
  tension.addEventListener('input', () =>
    audio.handle({ type: 'gravityChanged', gravity: { x: 0, y: 9.8 }, rampProgress: Number(tension.value) }),
  );
  root.append(
    el('h2', { textContent: 'Music moods (crossfade)' }),
    moods,
    el('div', { className: 'row' }, el('label', {}, 'asteroid tension (gravityChanged.rampProgress)', tension)),
  );

  // --- thrusters
  let mode: VesselMode = 'lander';
  const flags = { main: false, left: false, right: false };
  const modeRow = el('div', { className: 'row' });
  const modeBtns = new Map<VesselMode, HTMLButtonElement>();
  for (const m of VESSEL_MODES) {
    const b = el('button', { textContent: m });
    b.addEventListener('click', () => {
      mode = m;
      audio.thrusters.setMode(m);
      refresh();
    });
    modeBtns.set(m, b);
    modeRow.append(b);
  }
  const engRow = el('div', { className: 'row' });
  const engBtns = new Map<keyof typeof flags, HTMLButtonElement>();
  for (const k of ['left', 'main', 'right'] as const) {
    const b = el('button', { textContent: `${k} engine` });
    b.addEventListener('click', () => {
      flags[k] = !flags[k];
      audio.handle({ type: 'enginesChanged', ...flags });
      refresh();
    });
    engBtns.set(k, b);
    engRow.append(b);
  }
  root.append(el('h2', { textContent: 'Thruster loops (enginesChanged)' }), modeRow, engRow);

  // --- sfx
  for (const [name, pick] of GROUPS) {
    const row = el('div', { className: 'row' });
    for (const id of SFX_IDS.filter(pick)) {
      const b = el('button', { textContent: id });
      b.addEventListener('click', () => {
        audio.play(id, id === 'radiationCharge' ? { dur: 2 } : id === 'beaconChime' ? { variant: Math.floor(Math.random() * 5) } : undefined);
      });
      row.append(b);
    }
    root.append(el('h2', { textContent: `SFX — ${name}` }), row);
  }
  // Typewriter demo
  const typeRow = el('div', { className: 'row' });
  ['Wren', 'Io', 'Commander'].forEach((who, v) => {
    const b = el('button', { textContent: `typewriter: ${who}` });
    b.addEventListener('click', () => {
      for (let i = 0; i < 24; i++) setTimeout(() => audio.play('typeBlip', { variant: v, intensity: Math.random() }), i * 40);
    });
    typeRow.append(b);
  });
  root.append(typeRow);

  // --- events
  const evRow = el('div', { className: 'row' });
  for (const ev of SAMPLE_EVENTS) {
    const label = ev.type + ('phase' in ev && typeof ev.phase === 'string' ? `:${ev.phase}` : '');
    const b = el('button', { textContent: label });
    b.addEventListener('click', () => audio.handle(ev));
    evRow.append(b);
  }
  root.append(el('h2', { textContent: 'GameEvents through the real wiring' }), evRow);

  function refresh(): void {
    const s = audio.settings;
    const st = audio.driver.state;
    const mood = audio.currentMood;
    status.replaceChildren(
      st === 'running' ? '' : el('span', { className: 'warn', textContent: 'Click / tap / press any key to enable audio. ' }),
      `context: ${st} · mood: ${mood ?? '—'}${mood ? ` @ ${moodBpm(mood, audio.currentTension).toFixed(0)} bpm` : ''} · tension ${audio.currentTension.toFixed(2)} · ${s.muted ? 'MUTED' : 'unmuted'} · thrusters: ${audio.thrusters.active.join('+') || 'off'}`,
    );
    mute.textContent = s.muted ? 'Unmute' : 'Mute';
    mute.classList.toggle('on', s.muted);
    for (const ch of ['master', 'music', 'sfx'] as VolumeChannel[]) {
      const sl = sliders[ch]!;
      if (document.activeElement !== sl) sl.value = String(s[ch]);
    }
    moodBtns.forEach((b, m) => b.classList.toggle('on', m === mood));
    modeBtns.forEach((b, m) => b.classList.toggle('on', m === mode));
    engBtns.forEach((b, k) => b.classList.toggle('on', flags[k]));
  }
  audio.onChange(refresh);
  setInterval(refresh, 250);
  refresh();
}
