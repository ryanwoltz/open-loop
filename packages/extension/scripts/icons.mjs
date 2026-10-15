/**
 * Renders the toolbar icons (a white loop arrow on an indigo rounded square)
 * straight to PNG with an analytic, anti-aliased rasterizer, so the build
 * needs no image tooling.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const clamp = (v) => Math.max(0, Math.min(1, v));
const sdRoundBox = (px, py, half, r) => {
  const qx = Math.abs(px) - half + r;
  const qy = Math.abs(py) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
};

const render = (size) => {
  const ss = 4; // supersampling
  const buf = Buffer.alloc(size * size * 4);
  const top = [0x6e, 0x6a, 0xde];
  const bottom = [0x4c, 0x46, 0xc8];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // unit coords in [-1, 1]
          const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
          if (sdRoundBox(u, v, 0.94, 0.42) <= 0) bg++;
          // loop arc: radius .5, open at the upper right, stroke .17
          const ang = Math.atan2(v, u);
          const onArc = !(ang > -1.25 && ang < -0.2);
          const ring = Math.abs(Math.hypot(u, v) - 0.48) <= 0.085 && onArc;
          // arrow head at the gap
          const hx = 0.47, hy = -0.62;
          const head =
            segDist(u, v, hx, hy, hx, hy + 0.36) <= 0.085 || segDist(u, v, hx, hy, hx - 0.36, hy) <= 0.085;
          if (ring || head) fg++;
        }
      }
      const a = bg / (ss * ss);
      const f = fg / (ss * ss);
      const t = y / size;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const base = top[c] * (1 - t) + bottom[c] * t;
        buf[i + c] = Math.round(base * (1 - f) + 255 * f);
      }
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return png(size, buf);
};

export const writeIcons = (dir) => {
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(`${dir}/icon-${size}.png`, render(size));
};
