#!/usr/bin/env node
/**
 * Headless art export: renders the whole generated art set to PNGs without
 * a browser. The generators draw into pure index buffers (src/art/core/pix.ts),
 * so no canvas is needed — this script loads the TypeScript through Vite's
 * SSR module loader and encodes PNGs with node:zlib.
 *
 *   npm run export-art                     # -> art-export/ at 1x
 *   npm run export-art -- --scale 3        # nearest-neighbour upscale for review
 *   npm run export-art -- --out dir --only still   # path substring filter
 *   npm run export-art -- --bg 404858              # fill transparency (review)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const outDir = resolve(root, opt('out', 'art-export'));
const scale = Math.max(1, Math.floor(Number(opt('scale', '1'))));
const only = opt('only', '');
const bg = opt('bg', '');
/** --contact <file>: also pack everything into one review sheet (rows, max width px). */
const contact = opt('contact', '');
const contactW = Number(opt('contact-width', '1400'));

// ------------------------------------------------------------ PNG encoder
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
function upscale(w, h, rgba, k) {
  if (k === 1) return { w, h, rgba };
  const W = w * k,
    H = h * k;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const s = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
      const d = (y * W + x) * 4;
      out[d] = rgba[s];
      out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2];
      out[d + 3] = rgba[s + 3];
    }
  return { w: W, h: H, rgba: out };
}

// ------------------------------------------------------------------ main
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const mod = await server.ssrLoadModule('/src/art/exportSheets.ts');
  const sheets = mod.buildExportSheets(only);
  let n = 0;
  const packed = [];
  for (const s of sheets) {
    if (bg) {
      const c = parseInt(bg, 16);
      for (let i = 0; i < s.rgba.length; i += 4)
        if (s.rgba[i + 3] === 0) {
          s.rgba[i] = (c >> 16) & 255;
          s.rgba[i + 1] = (c >> 8) & 255;
          s.rgba[i + 2] = c & 255;
          s.rgba[i + 3] = 255;
        }
    }
    const u = upscale(s.w, s.h, s.rgba, scale);
    const file = join(outDir, `${s.path}.png`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, encodePng(u.w, u.h, u.rgba));
    n++;
    if (contact) packed.push(u);
  }
  if (contact) {
    const pad = 6;
    let x = pad,
      y = pad,
      rowH = 0,
      W = contactW;
    const pos = packed.map((u) => {
      if (x + u.w + pad > W && x > pad) {
        x = pad;
        y += rowH + pad;
        rowH = 0;
      }
      const p = { x, y };
      x += u.w + pad;
      rowH = Math.max(rowH, u.h);
      return p;
    });
    const H = y + rowH + pad;
    const out = new Uint8ClampedArray(W * H * 4).fill(40);
    packed.forEach((u, i) => {
      const { x: ox, y: oy } = pos[i];
      for (let yy = 0; yy < u.h; yy++)
        for (let xx = 0; xx < Math.min(u.w, W - ox); xx++) {
          const s = (yy * u.w + xx) * 4,
            d = ((oy + yy) * W + ox + xx) * 4;
          if (u.rgba[s + 3] === 0) continue;
          out[d] = u.rgba[s];
          out[d + 1] = u.rgba[s + 1];
          out[d + 2] = u.rgba[s + 2];
          out[d + 3] = 255;
        }
    });
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    writeFileSync(resolve(root, contact), encodePng(W, H, out));
  }
  console.log(`Exported ${n} PNGs to ${outDir} (scale ${scale}x)`);
} finally {
  await server.close();
}
