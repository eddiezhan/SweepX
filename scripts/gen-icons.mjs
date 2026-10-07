/**
 * Generates deleteX toolbar/store icons (16/48/128 PNG, RGBA) without any
 * image library: builds raw pixel buffers and encodes PNG by hand (zlib deflate).
 *
 * Usage: node scripts/gen-icons.mjs
 * Output: extension/icons/icon{16,48,128}.png
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// --- Minimal PNG encoder (colortype 6: RGBA, 8-bit) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Icon drawing: rounded tile + thick X, in bright (connected) and dim (disconnected) variants ---

const VARIANTS = {
  bright: { bg: [21, 32, 43, 255], fg: [255, 255, 255, 255] },   // #15202B / white
  dim:    { bg: [58, 68, 76, 255], fg: [136, 153, 166, 255] }    // #3A444C / #8899A6
};
const CORNER = 0.22;              // corner radius as fraction of size
const PAD = 0.28;                 // X bounds inset
const THICK = 0.115;              // X stroke half-thickness as fraction of size

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawIcon(size, BG, FG) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size * CORNER;
  const a = size * PAD, b = size * (1 - PAD), t = size * THICK;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(r, Math.min(size - r, x + 0.5));
      const cy = Math.max(r, Math.min(size - r, y + 0.5));
      const outsideRoundRect = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r
        && (x + 0.5 < r || x + 0.5 > size - r) && (y + 0.5 < r || y + 0.5 > size - r);

      const d = Math.min(
        distToSegment(x + 0.5, y + 0.5, a, a, b, b),
        distToSegment(x + 0.5, y + 0.5, b, a, a, b)
      );
      // 1px feather on edges for smoothness at small sizes
      let color;
      if (outsideRoundRect) color = [0, 0, 0, 0];
      else if (d <= t) color = FG;
      else if (d <= t + 1) color = [...FG.slice(0, 3), Math.round(255 * (t + 1 - d))];
      else color = BG;

      const i = (y * size + x) * 4;
      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = color[3];
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.resolve('extension/icons');
fs.mkdirSync(outDir, { recursive: true });
for (const [variant, { bg, fg }] of Object.entries(VARIANTS)) {
  const suffix = variant === 'bright' ? '' : '-dim';
  for (const size of [16, 48, 128]) {
    fs.writeFileSync(path.join(outDir, `icon${size}${suffix}.png`), drawIcon(size, bg, fg));
    console.log(`wrote extension/icons/icon${size}${suffix}.png`);
  }
}
