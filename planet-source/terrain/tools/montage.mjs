import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { writePng } from './png.mjs';

/** Decode 8-bit non-interlaced RGB (2) or RGBA (6) PNG to { w, h, rgb: Uint8Array(w*h*3) }. */
function decode(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${path}: not a PNG`);
  let p = 8, w = 0, h = 0, ct = -1;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9];
      if (data[8] !== 8) throw new Error(`${path}: unsupported bit depth ${data[8]} (need 8)`);
      if (ct !== 2 && ct !== 6) throw new Error(`${path}: unsupported colour type ${ct} (need 2 RGB or 6 RGBA)`);
      if (data[12] !== 0) throw new Error(`${path}: interlaced PNGs not supported`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const bpp = ct === 2 ? 3 : 4, stride = w * bpp, raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * h) throw new Error(`${path}: inflated size ${raw.length} != expected ${(stride + 1) * h}`);
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = i >= bpp && y > 0 ? out[prev + i - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error(`${path}: bad filter type ${f} on row ${y}`);
      }
      out[row + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let k = 0; k < w * h; k++) for (let c = 0; c < 3; c++) rgb[k * 3 + c] = out[k * bpp + c];
  return { w, h, rgb };
}

const [out, colsArg, ...ins] = process.argv.slice(2);
const cols = parseInt(colsArg, 10);
if (!out || !(cols > 0) || !ins.length) {
  console.error('usage: node terrain/tools/montage.mjs out.png cols in1.png in2.png ...');
  process.exit(1);
}
const imgs = ins.map(decode);
const cw = Math.max(...imgs.map(i => i.w)), ch = Math.max(...imgs.map(i => i.h));
const rows = Math.ceil(imgs.length / cols), G = 4;
const W = cols * cw + (cols + 1) * G, H = rows * ch + (rows + 1) * G;
const rgb = new Uint8Array(W * H * 3).fill(40);
imgs.forEach((im, k) => {
  const ox = G + (k % cols) * (cw + G), oy = G + Math.floor(k / cols) * (ch + G);
  for (let y = 0; y < im.h; y++) rgb.set(im.rgb.subarray(y * im.w * 3, (y + 1) * im.w * 3), ((oy + y) * W + ox) * 3);
});
writePng(out, W, H, rgb);
console.log(`${out}: ${W}x${H}, ${imgs.length} images, ${rows}x${cols} grid`);
