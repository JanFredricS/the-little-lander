#!/usr/bin/env node
/**
 * Generates the app icons (favicon, apple-touch, PWA) from the in-game
 * lander sprite — same headless pipeline as export-art.mjs.
 *
 *   npm run make-icons        # writes public/icons/*.png
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- PNG encoder (same as export-art.mjs) ----
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- simple RGBA canvas ----
class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = r;
    this.d[i + 1] = g;
    this.d[i + 2] = b;
    this.d[i + 3] = a;
  }
  fillRounded(r, g, b, radius) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = Math.max(0, Math.max(radius - x, x - (this.w - 1 - radius)));
        const dy = Math.max(0, Math.max(radius - y, y - (this.h - 1 - radius)));
        if (dx * dx + dy * dy <= radius * radius) this.set(x, y, r, g, b);
      }
  }
  blitScaled(sw, sh, srgba, k, ox, oy) {
    for (let y = 0; y < sh * k; y++)
      for (let x = 0; x < sw * k; x++) {
        const s = (Math.floor(y / k) * sw + Math.floor(x / k)) * 4;
        if (srgba[s + 3] === 0) continue;
        this.set(ox + x, oy + y, srgba[s], srgba[s + 1], srgba[s + 2], srgba[s + 3]);
      }
  }
}

// ---- main ----
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const sheets = await server.ssrLoadModule('/src/art/exportSheets.ts');
  const catalog = await server.ssrLoadModule('/src/art/catalog.ts');
  const { toRGBA } = await server.ssrLoadModule('/src/art/core/canvas.ts');
  const item = catalog.artCatalog().find((it) => it.id.includes('vessel.lander'));
  if (!item) throw new Error('vessel.lander not in art catalog');
  const r = item.render();
  const frame = r.frames[0]; // first frame only
  const rgba = toRGBA(frame, r.palette, r.background);
  const sw = frame.w,
    sh = frame.h;

  // Deep-space navy from the hangar palette, with a soft rounded corner.
  const BG = [10, 12, 24];
  const STARS = [
    [0.14, 0.18], [0.82, 0.12], [0.68, 0.3], [0.22, 0.62], [0.9, 0.55],
    [0.4, 0.1], [0.12, 0.86], [0.75, 0.83], [0.55, 0.68], [0.31, 0.36],
  ];
  const outDir = join(root, 'public', 'icons');
  mkdirSync(outDir, { recursive: true });

  /** opaque icon: navy space + stars + centered lander at the biggest integer scale that fits pad */
  function opaqueIcon(size, padFrac) {
    const img = new Img(size, size);
    img.fillRounded(BG[0], BG[1], BG[2], Math.round(size * 0.18));
    const starSize = Math.max(1, Math.round(size / 64));
    for (const [fx, fy] of STARS)
      for (let dy = 0; dy < starSize; dy++)
        for (let dx = 0; dx < starSize; dx++)
          img.set(Math.round(fx * size) + dx, Math.round(fy * size) + dy, 200, 210, 230, 180);
    const pad = Math.round(size * padFrac);
    const k = Math.max(1, Math.floor((size - 2 * pad) / Math.max(sw, sh)));
    const ox = Math.round((size - sw * k) / 2);
    const oy = Math.round((size - sh * k) / 2);
    img.blitScaled(sw, sh, rgba, k, ox, oy);
    return img;
  }
  /** transparent favicon: just the lander, integer-scaled */
  function transparentIcon(size) {
    const img = new Img(size, size);
    const k = Math.max(1, Math.floor(size / Math.max(sw, sh)));
    img.blitScaled(sw, sh, rgba, k, Math.round((size - sw * k) / 2), Math.round((size - sh * k) / 2));
    return img;
  }

  const out = [
    ['favicon-32.png', transparentIcon(32)],
    ['favicon-64.png', transparentIcon(64)],
    ['apple-touch-icon.png', opaqueIcon(180, 0.16)],
    ['icon-192.png', opaqueIcon(192, 0.16)],
    ['icon-512.png', opaqueIcon(512, 0.16)],
    ['icon-maskable-512.png', opaqueIcon(512, 0.24)], // extra safe-zone padding
  ];
  for (const [name, img] of out) writeFileSync(join(outDir, name), encodePng(img.w, img.h, img.d));
  console.log(`Wrote ${out.length} icons to public/icons/ (lander frame ${sw}x${sh})`);
} finally {
  await server.close();
}
