// Generate an L0 planet, save its fields, and render an equirectangular
// review map (hillshade + biome + rivers).
// usage: node terrain/tools/build-planet.mjs [seed] [N] [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePlanet } from '../src/planet.mjs';
import { dirFace } from '../src/cubesphere.mjs';
import { landColor, oceanColor } from '../src/shading.mjs';
import { writePng } from './png.mjs';

const seed = process.argv[2] ?? 'planet-1', N = Number(process.argv[3] ?? 256);
const outDir = process.argv[4] ?? new URL('../out/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
mkdirSync(outDir, { recursive: true });

const P = generatePlanet({ seed, N, log: (s) => console.log(s) });
const { n, grid, nbh, radiusM: R } = P, { height: h, land, precip, discharge, lakeDepth } = P.fields, dirs = grid.dirs;

// Tangent-plane gradient per cell (least squares over neighbours).
const gx = new Float32Array(n), gy = new Float32Array(n), gz = new Float32Array(n);
for (let c = 0; c < n; c++) {
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  const px = dirs[c * 3], py = dirs[c * 3 + 1], pz = dirs[c * 3 + 2];
  // tangent basis: east, north
  let ex = -pz, ey = 0, ez = px; let el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nx = py * ez - pz * ey, ny = pz * ex - px * ez, nz = px * ey - py * ex;
  for (let q = 0; q < 8; q++) {
    const m = nbh.nb[c * 8 + q]; if (m < 0) break;
    const dx = (dirs[m * 3] - px) * R, dy = (dirs[m * 3 + 1] - py) * R, dz = (dirs[m * 3 + 2] - pz) * R;
    const u = dx * ex + dy * ey + dz * ez, v = dx * nx + dy * ny + dz * nz;
    const dh = Math.max(h[m], land[m] ? h[m] : 0) - Math.max(h[c], land[c] ? h[c] : 0);
    a11 += u * u; a12 += u * v; a22 += v * v; b1 += u * dh; b2 += v * dh;
  }
  const det = a11 * a22 - a12 * a12 || 1;
  gx[c] = (a22 * b1 - a12 * b2) / det; gy[c] = (a11 * b2 - a12 * b1) / det;
}

const W = 2048, H = 1024, rgb = new Uint8Array(W * H * 3);
const sample = (arr, f, s, t) => { // bilinear within face, clamped
  const fx = Math.min(N - 1, Math.max(0, (s + 1) * 0.5 * N - 0.5)), fy = Math.min(N - 1, Math.max(0, (t + 1) * 0.5 * N - 0.5));
  const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fy)), u = fx - i, v = fy - j, b = f * N * N;
  return (arr[b + j * N + i] * (1 - u) + arr[b + j * N + i + 1] * u) * (1 - v) + (arr[b + (j + 1) * N + i] * (1 - u) + arr[b + (j + 1) * N + i + 1] * u) * v;
};
const L = [-0.6, 0.6, 0.53], EX = 25;
let maxH = -Infinity, landArea = 0, riverCells = 0;
for (let c = 0; c < n; c++) { if (land[c]) { maxH = Math.max(maxH, h[c]); landArea++; } }
const riverQ = 1e11 * (256 / N) ** 0; // m^2 equivalent discharge for a drawn river at this scale
for (let y = 0; y < H; y++) {
  const lat = 90 - (y + 0.5) * 180 / H, cl = Math.cos(lat * Math.PI / 180), sl = Math.sin(lat * Math.PI / 180);
  for (let x = 0; x < W; x++) {
    const lon = (x + 0.5) * 360 / W - 180, lr = lon * Math.PI / 180;
    const dx = cl * Math.sin(lr), dy = sl, dz = cl * Math.cos(lr);
    const c = grid.cellOf(dx, dy, dz), { f, s, t } = dirFace(dx, dy, dz);
    const hh = sample(h, f, s, t), isLand = land[c];
    let col;
    const gxv = sample(gx, f, s, t), gyv = sample(gy, f, s, t), slope = Math.hypot(gxv, gyv);
    if (isLand) {
      col = landColor(lat, hh, precip[c], slope * 4);
      if (lakeDepth[c] > 5) col = [40, 90, 130];
      if (discharge[c] > riverQ) { const k = Math.min(1, Math.log10(discharge[c] / riverQ) / 1.5 + 0.35); col = col.map((v, i) => v + ([40, 95, 150][i] - v) * k); riverCells++; }
    } else col = oceanColor(hh);
    const nxv = -gxv * EX, nyv = -gyv * EX, nl = Math.hypot(nxv, nyv, 1);
    const shade = isLand ? Math.max(0.25, (nxv * L[0] + nyv * L[1] + L[2]) / nl / 0.53 * 0.85 + 0.15) : 1;
    const o = (y * W + x) * 3;
    rgb[o] = Math.min(255, col[0] * shade); rgb[o + 1] = Math.min(255, col[1] * shade); rgb[o + 2] = Math.min(255, col[2] * shade);
  }
}
const tag = `${seed}-N${N}`;
writePng(join(outDir, `map-${tag}.png`), W, H, rgb);
const meta = { generator: P.generator, seed, N, radiusM: R, cells: n, layout: 'face*N*N + j*N + i (equal-angle cube sphere, see src/cubesphere.mjs)',
  fields: ['height:f32', 'discharge:f32', 'precip:f32', 'lakeDepth:f32', 'land:u8'],
  stats: { maxLandHeightM: Math.round(maxH), landFraction: +(landArea / n).toFixed(3) } };
const buf = Buffer.concat([h, discharge, precip, lakeDepth].map((a) => Buffer.from(a.buffer)).concat([Buffer.from(land.buffer)]));
writeFileSync(join(outDir, `planet-${tag}.bin`), buf);
writeFileSync(join(outDir, `planet-${tag}.json`), JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta.stats), `map-${tag}.png`);
