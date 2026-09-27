// Generates icons/icon{16,48,128}.png: a white globe outline on a dark rounded square.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 48, 128]) {
  const ss = 4; // supersampling
  const data = png(size, (px, py) => {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = (px + (sx + 0.5) / ss) / size, y = (py + (sy + 0.5) / ss) / size;
      const r = 0.22, dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      bg++;
      const cx = x - 0.5, cy = y - 0.5, d = Math.hypot(cx, cy), w = size < 32 ? 0.07 : 0.045;
      const ring = Math.abs(d - 0.3) < w;
      const eq = Math.abs(cy) < w / 1.3 && d < 0.3;
      const mer = Math.abs(Math.hypot(cx / 0.13, cy / 0.3) - 1) * 0.13 < w / 1.3 && d < 0.3;
      if (ring || eq || mer) fg++;
    }
    const n = ss * ss, a = bg / n, t = bg ? fg / bg : 0;
    const c = (dark, light) => Math.round(dark + (light - dark) * t);
    return [c(11, 232), c(13, 234), c(16, 237), Math.round(a * 255)];
  });
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), data);
}
console.log("icons written");
