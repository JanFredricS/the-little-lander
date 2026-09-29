/**
 * `?gallery=1` — every generated asset, labelled, grouped by section.
 * Each item has a PNG export button; the header has "Download all as PNGs"
 * (sequential anchor downloads, no zip). Items render lazily as they scroll
 * into view. Vessel items overlay their engine / gun / foot anchors.
 */

import { toRGBA } from './core/canvas';
import type { Pix } from './core/pix';
import { artCatalog, type CatalogItem, type CatalogRender } from './catalog';
import { stripOf } from './exportSheets';
import { getVesselAnchors, VESSEL_SIZES, type VesselSpriteName } from './sprites/vessels';

const CSS = `
html, body, #app { overflow: auto !important; height: auto !important; touch-action: auto !important; }
#app { position: static !important; inset: auto !important; width: auto !important; }
body { margin: 0; background: #11131c; color: #d8dcea; font: 13px/1.4 ui-monospace, Menlo, monospace; }
.gal-head { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center;
  padding: 10px 16px; background: #181b28ee; border-bottom: 1px solid #2c3148; }
.gal-head h1 { font-size: 15px; margin: 0 8px 0 0; color: #ffd68a; }
.gal-head input, .gal-head select, .gal button { background: #232840; color: #d8dcea; border: 1px solid #3c4468; border-radius: 4px; padding: 4px 8px; font: inherit; }
.gal button { cursor: pointer; }
.gal button:hover { background: #2f365a; }
.gal-toc { display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 8px 16px; }
.gal-toc a { color: #8ab8ff; }
.gal section { padding: 4px 16px 20px; }
.gal h2 { font-size: 14px; color: #ffd68a; border-bottom: 1px solid #2c3148; padding-bottom: 4px; }
.gal-grid { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
.gal-item { background: #191c2a; border: 1px solid #2a2f46; border-radius: 6px; padding: 8px; max-width: 100%; box-sizing: border-box; }
.gal-item .lbl { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.gal-item .lbl b { color: #fff; font-weight: 600; }
.gal-item .note { color: #8a90a8; font-size: 11px; max-width: 520px; margin-top: 4px; }
.gal-item .view { position: relative; max-width: 100%; overflow-x: auto; }
.gal-item canvas { image-rendering: pixelated; display: block; background: repeating-conic-gradient(#262a3c 0 25%, #1e2232 0 50%) 0 0 / 16px 16px; }
.gal-item .anim { margin-top: 6px; }
.gal-status { color: #8a90a8; }
`;

const fileName = (id: string) => `${id.replace(/[/\\]+/g, '__')}.png`;

function renderCanvas(r: CatalogRender, scale: number): HTMLCanvasElement {
  const strip = stripOf(r.frames);
  return pixCanvas(strip, r, scale);
}

function pixCanvas(pix: Pix, r: CatalogRender, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = pix.w;
  c.height = pix.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(pix.w, pix.h);
  img.data.set(toRGBA(pix, r.palette, r.background));
  ctx.putImageData(img, 0, 0);
  if (scale === 1) return c;
  const s = document.createElement('canvas');
  s.width = pix.w * scale;
  s.height = pix.h * scale;
  const sctx = s.getContext('2d')!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(c, 0, 0, s.width, s.height);
  return s;
}

async function download(item: CatalogItem, scale: number): Promise<void> {
  const c = renderCanvas(item.render(), scale);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  const url = blob ? URL.createObjectURL(blob) : c.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(item.id);
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Overlay vessel anchors (engines = orange, guns = red, feet = green) at display scale. */
function drawAnchors(view: HTMLCanvasElement, name: VesselSpriteName, frames: number, scale: number, frameW: number): void {
  const ctx = view.getContext('2d')!;
  const a = getVesselAnchors(name);
  const mark = (fx: number, x: number, y: number, col: string) => {
    const px = (fx * (frameW + (frames > 1 ? 2 : 0)) + x) * scale;
    const py = y * scale;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 4, py);
    ctx.lineTo(px + 4, py);
    ctx.moveTo(px, py - 4);
    ctx.lineTo(px, py + 4);
    ctx.stroke();
  };
  for (let f = 0; f < frames; f++) {
    for (const e of a.engines[Math.min(f, a.engines.length - 1)] ?? []) {
      mark(f, e.x, e.y, '#ffa040');
      ctx.strokeStyle = '#ffa040';
      ctx.beginPath();
      const px = (f * (frameW + (frames > 1 ? 2 : 0)) + e.x) * scale;
      ctx.moveTo(px, e.y * scale);
      ctx.lineTo(px + e.dir.x * 10, e.y * scale + e.dir.y * 10);
      ctx.stroke();
    }
    for (const g of a.guns) mark(f, g.x, g.y, '#ff4060');
    for (const ft of a.feet) mark(f, ft.x, ft.y, '#60ff90');
  }
}

export async function mountGallery(host: HTMLElement, _value: string): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = 'Art gallery · The Little Lander';
  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'gal';
  host.appendChild(root);

  const items = artCatalog();
  const sections = [...new Set(items.map((i) => i.section))];

  const head = document.createElement('div');
  head.className = 'gal-head';
  head.innerHTML = `<h1>The Little Lander — generated art</h1>`;
  const filter = document.createElement('input');
  filter.placeholder = 'filter (e.g. vessel, stills/, caves)';
  const scaleSel = document.createElement('select');
  for (const s of [1, 2, 4]) scaleSel.add(new Option(`export ${s}x`, String(s)));
  const anchors = document.createElement('label');
  anchors.innerHTML = `<input type="checkbox" checked> anchors`;
  const all = document.createElement('button');
  all.textContent = 'Download all as PNGs';
  const status = document.createElement('span');
  status.className = 'gal-status';
  status.textContent = `${items.length} items`;
  head.append(filter, scaleSel, anchors, all, status);
  root.appendChild(head);

  const toc = document.createElement('div');
  toc.className = 'gal-toc';
  root.appendChild(toc);

  const exportScale = () => Number(scaleSel.value) || 1;
  const showAnchors = () => (anchors.querySelector('input') as HTMLInputElement).checked;
  const cards: { item: CatalogItem; el: HTMLElement; paint: () => void }[] = [];
  const timers: number[] = [];

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        cards.find((c) => c.el === e.target)?.paint();
      }
    },
    { rootMargin: '400px' },
  );

  sections.forEach((sec, si) => {
    const a = document.createElement('a');
    a.href = `#sec${si}`;
    a.textContent = sec;
    toc.appendChild(a);
    const s = document.createElement('section');
    s.id = `sec${si}`;
    s.innerHTML = `<h2>${sec}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'gal-grid';
    s.appendChild(grid);
    root.appendChild(s);
    for (const item of items.filter((i) => i.section === sec)) {
      const el = document.createElement('div');
      el.className = 'gal-item';
      el.dataset.id = item.id;
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.innerHTML = `<b>${item.label}</b>`;
      const btn = document.createElement('button');
      btn.textContent = 'PNG';
      btn.title = `Download ${fileName(item.id)}`;
      btn.onclick = () => void download(item, exportScale());
      lbl.appendChild(btn);
      const view = document.createElement('div');
      view.className = 'view';
      view.textContent = '…';
      el.append(lbl, view);
      if (item.note) {
        const n = document.createElement('div');
        n.className = 'note';
        n.textContent = item.note;
        el.appendChild(n);
      }
      grid.appendChild(el);
      const paint = () => {
        const r = item.render();
        view.textContent = '';
        if (r.frames.length === 0) return;
        const strip = stripOf(r.frames);
        const scale = Math.max(1, Math.min(6, Math.floor(860 / strip.w), Math.floor(480 / strip.h)));
        const c = pixCanvas(strip, r, scale);
        const vessel = item.label as VesselSpriteName;
        if (item.label in VESSEL_SIZES && showAnchors()) drawAnchors(c, vessel, r.frames.length, scale, r.frames[0]!.w);
        view.appendChild(c);
        if (r.frames.length > 1 && r.frames[0]!.w <= 128) {
          // looping preview
          const frames = r.frames.map((f) => pixCanvas(f, r, scale));
          const anim = document.createElement('canvas');
          anim.className = 'anim';
          anim.width = frames[0]!.width;
          anim.height = frames[0]!.height;
          const actx = anim.getContext('2d')!;
          let i = 0;
          const tick = () => {
            actx.clearRect(0, 0, anim.width, anim.height);
            actx.drawImage(frames[i % frames.length]!, 0, 0);
            i++;
          };
          tick();
          timers.push(window.setInterval(tick, 140));
          view.appendChild(anim);
        }
      };
      cards.push({ item, el, paint });
      io.observe(el);
    }
  });

  const apply = () => {
    const q = filter.value.trim().toLowerCase();
    for (const c of cards) c.el.style.display = !q || c.item.id.toLowerCase().includes(q) || c.item.section.toLowerCase().includes(q) ? '' : 'none';
  };
  filter.oninput = apply;
  anchors.onchange = () => {
    for (const c of cards) if (c.item.label in VESSEL_SIZES && !c.el.querySelector('.view')!.textContent) c.paint();
  };

  all.onclick = async () => {
    const visible = cards.filter((c) => c.el.style.display !== 'none');
    all.disabled = true;
    for (let i = 0; i < visible.length; i++) {
      status.textContent = `downloading ${i + 1}/${visible.length}…`;
      await download(visible[i]!.item, exportScale());
      await new Promise((r) => setTimeout(r, 180));
    }
    status.textContent = `downloaded ${visible.length} PNGs`;
    all.disabled = false;
  };
}
