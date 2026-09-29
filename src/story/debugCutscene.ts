/**
 * `?cutscene=<id>` debug route: plays one script with the real S2 stills
 * (generated on first draw), then shows a picker for every cutscene. `?cutscene=all` plays the
 * whole arc back to back. Unknown ids go straight to the picker.
 */

import type { ArtApi, CutsceneId } from '../contracts';
import { createArt } from '../art/art';
import { playCutscene } from './cutscenePlayer';
import { CUTSCENE_IDS, getCutscene, isCutsceneId } from './scripts';

export async function mountCutsceneDebug(host: HTMLElement, value: string, art: ArtApi = createArt()): Promise<void> {
  const queue: CutsceneId[] = value === 'all' ? [...CUTSCENE_IDS] : isCutsceneId(value) ? [value] : [];

  const picker = (note: string) => {
    host.replaceChildren();
    const box = document.createElement('div');
    Object.assign(box.style, { padding: '16px', lineHeight: '1.8', overflow: 'auto', height: '100%', boxSizing: 'border-box', touchAction: 'auto' });
    const p = document.createElement('p');
    p.textContent = note;
    box.appendChild(p);
    for (const id of [...CUTSCENE_IDS, 'all']) {
      const a = document.createElement('a');
      a.href = `?cutscene=${id}`;
      a.textContent = id;
      a.style.color = '#f0b030';
      a.style.marginRight = '14px';
      a.style.display = 'inline-block';
      box.appendChild(a);
    }
    host.appendChild(box);
  };

  const playNext = () => {
    const id = queue.shift();
    if (!id) return;
    host.replaceChildren();
    playCutscene(host, getCutscene(id), {
      art,
      onDone: (skipped) => {
        console.info('[cutscene]', { type: 'cutsceneDone', cutsceneId: id, skipped });
        if (queue.length) playNext();
        else picker(`Done: '${id}'${skipped ? ' (skipped)' : ''}. Play another:`);
      },
    });
  };

  if (queue.length) playNext();
  else picker(value ? `Unknown cutscene '${value}'. Pick one:` : 'Pick a cutscene:');
}
