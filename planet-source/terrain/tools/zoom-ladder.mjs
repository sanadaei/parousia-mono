// Scale ladder review: planet -> L1 (~400 km) -> L2 (~40 km) -> L3 (~4 km),
// each a 10x zoom of a box marked on the previous image.
// usage: node terrain/tools/zoom-ladder.mjs [planetTag] [lat lon]

import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlanet, planetSampler } from '../src/planet.mjs';
import { amplifyRegion, regionSampler, blur } from '../src/region.mjs';
import { createNearField } from '../src/detail.mjs';
let prevSim = null;
import { landColor, oceanColor } from '../src/shading.mjs';
import { writePng } from './png.mjs';

const outDir = new URL('../out/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const tag = process.argv[2] ?? 'planet-1-N512';
// site: 'mountain' (wet mid-latitude range) or 'hills' (settled-looking lowland), or lat lon.
const site = process.argv[3] && isNaN(+process.argv[3]) ? process.argv[3] : 'mountain';
const meta = JSON.parse(readFileSync(join(outDir, `planet-${tag}.json`), 'utf8'));
const P = loadPlanet(meta, readFileSync(join(outDir, `planet-${tag}.bin`)));
const { grid, n } = P, { height, land, precip } = P.fields, dirs = grid.dirs;
const t0 = Date.now(), log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

// --- Choose a centre: given lat/lon, or a wet mountain front (most varied scenery).
let center;
if (process.argv[4] !== undefined && !isNaN(+process.argv[3])) {
  const la = +process.argv[3] * Math.PI / 180, lo = +process.argv[4] * Math.PI / 180;
  center = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
} else {
  let best = -1, bs = -Infinity;
  for (let c = 0; c < n; c++) {
    const [lo, hi] = site === 'hills' ? [150, 700] : [800, 3500];
    if (!land[c] || height[c] < lo || height[c] > hi) continue;
    const lat = Math.asin(dirs[c * 3 + 1]) * 180 / Math.PI;
    if (Math.abs(lat) > 52 || Math.abs(lat) < 30) continue;
    const s = Math.min(precip[c], 1.2) * (site === 'hills' ? 1 + (c % 97) / 970 : Math.min(height[c], 2500));
    if (s > bs) { bs = s; best = c; }
  }
  center = [dirs[best * 3], dirs[best * 3 + 1], dirs[best * 3 + 2]];
}
const latDeg = Math.asin(center[1]) * 180 / Math.PI;
log(`centre lat ${latDeg.toFixed(2)} lon ${(Math.atan2(center[0], center[2]) * 180 / Math.PI).toFixed(2)}`);

function render(R, name, { exaggeration = 1, box = null, riverCells = 300 } = {}) {
  const { W, H, dx, height: h, fixed, precip: pr, discharge, lakeDepth } = R;
  const rgb = new Uint8Array(W * H * 3), L = [-0.55, 0.55, 0.63];
  const lightLen = Math.hypot(...L);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i, at = (a, b) => h[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx), gy = (at(i, j - 1) - at(i, j + 1)) / (2 * dx);
    const slope = Math.hypot(gx, gy);
    const sea = fixed[c] && h[c] <= 0;
    let col;
    if (sea) col = oceanColor(h[c]);
    else {
      col = landColor(latDeg, h[c], pr[c], R.colorSlope ? R.colorSlope[c] : slope);
      if (lakeDepth[c] > 0.5) col = [44, 92, 128];
      if (R.water && !Number.isNaN(R.water[c])) col = [52, 88, 104];
      const q = discharge[c] / (dx * dx);
      if (q > riverCells) { const k = Math.min(1, 0.45 + Math.log10(q / riverCells) / 2); col = col.map((v, t) => v + ([44, 92, 140][t] - v) * k); }
    }
    const nx = -gx * exaggeration, ny = -gy * exaggeration, nl = Math.hypot(nx, ny, 1);
    const lam = (nx * L[0] + ny * L[1] + L[2]) / nl / lightLen;
    const shade = sea ? 1 : Math.max(0.18, 0.2 + 0.95 * lam);
    const o = c * 3;
    for (let t = 0; t < 3; t++) rgb[o + t] = Math.max(0, Math.min(255, col[t] * shade));
  }
  if (box) { // marks the next level
    const [x0, y0, x1, y1] = box;
    for (let i = x0; i <= x1; i++) for (const j of [y0, y1]) for (let t = 0; t < 3; t++) { rgb[(j * W + i) * 3 + t] = 255; }
    for (let j = y0; j <= y1; j++) for (const i of [x0, x1]) for (let t = 0; t < 3; t++) { rgb[(j * W + i) * 3 + t] = 255; }
  }
  writePng(join(outDir, name), W, H, rgb);
}

/** Pick the next centre: strongest relief-with-river in the middle half. */
function nextCenter(R) {
  const { W, H, dx, height: h, fixed, discharge } = R;
  const relief = new Float32Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const c = j * W + i;
    relief[c] = fixed[c] ? 0 : Math.abs(h[c + 1] - h[c - 1]) + Math.abs(h[c + W] - h[c - W]);
  }
  const rs = blur(relief, W, H, Math.round(W / 40));
  let best = 0, bs = -Infinity;
  for (let j = H / 4; j < 3 * H / 4; j++) for (let i = W / 4; i < 3 * W / 4; i++) {
    const c = j * W + i; if (fixed[c]) continue;
    const s = rs[c] * Math.log10(10 + discharge[c] / (dx * dx));
    if (s > bs) { bs = s; best = c; }
  }
  return [((best % W) + 0.5) * dx - R.sizeM / 2, R.sizeM / 2 - (Math.floor(best / W) + 0.5) * dx];
}

const res = 512, cellM = Math.PI / 2 / P.N * P.radiusM;
// Simulated levels (erosion) down to ~80 m; near-field levels are analytic.
const levels = [
  { name: 'L1', sizeM: 400e3, ex: 3 }, { name: 'L2', sizeM: 40e3, ex: 1.5 },
  { name: 'L3', sizeM: 4e3, ex: 1, near: true }, { name: 'L4', sizeM: 400, ex: 1, near: true },
];
let parent = planetSampler(P, center), parentDx = cellM, offset = [0, 0], nearOf = null, nearOffset = [0, 0];
for (const [k, L] of levels.entries()) {
  let R;
  if (!L.near) {
    R = amplifyRegion({ parent, parentDx, sizeM: L.sizeM, res, seed: `${tag}/${L.name}/${offset.join(',')}`, log });
  } else {
    if (!nearOf) { nearOf = createNearField(prevSim, { seed: `${tag}/near` }); }
    R = sampleNear(nearOf, nearOffset, L.sizeM, res);
  }
  const next = k < levels.length - 1 ? (L.near ? nextNearCenter(R) : nextCenter(R)) : null;
  let box = null;
  if (next) {
    const half = levels[k + 1].sizeM / 2 / R.dx, ci = (next[0] + R.sizeM / 2) / R.dx, cj = (R.sizeM / 2 - next[1]) / R.dx;
    box = [Math.round(ci - half), Math.round(cj - half), Math.round(ci + half), Math.round(cj + half)];
  }
  render(R, `ladder-${tag}-${site}-${L.name}.png`, { exaggeration: L.ex, box });
  let hmin = Infinity, hmax = -Infinity; for (const v of R.height) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
  log(`${L.name}: ${L.sizeM / 1000} km, dx ${R.dx.toFixed(2)} m, height ${hmin.toFixed(1)}..${hmax.toFixed(1)} m`);
  if (next) {
    if (!L.near) {
      const s = regionSampler(R);
      parent = (x, y) => s(x + next[0], y + next[1]);
      parentDx = R.dx; offset = next.map(Math.round); prevSim = R;
      nearOffset = next;
    } else nearOffset = [nearOffset[0] + next[0], nearOffset[1] + next[1]];
  }
}

/** Grid-sample a near field around a local offset in the simulated region's frame. */
function sampleNear(sample, [ox, oy], sizeM, res) {
  const n = res * res, dx = sizeM / res, height = new Float32Array(n), water = new Float32Array(n).fill(NaN);
  const pr = new Float32Array(n), riverDist = new Float32Array(n), colorSlope = new Float32Array(n);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const c = j * res + i, r = sample(ox + (i + 0.5) * dx - sizeM / 2, oy + sizeM / 2 - (j + 0.5) * dx, dx);
    height[c] = r.h; pr[c] = r.precip; colorSlope[c] = r.baseSlope; riverDist[c] = r.riverDist; if (r.water != null) water[c] = r.water;
  }
  const fixed = new Uint8Array(n); for (let c = 0; c < n; c++) if (height[c] <= 0) fixed[c] = 1;
  return { W: res, H: res, dx, sizeM, height, fixed, precip: pr, water, riverDist, colorSlope, discharge: new Float32Array(n), lakeDepth: new Float32Array(n) };
}

/** Near-field next centre: a hillside close to a channel (where people would build). */
function nextNearCenter(R) {
  const { W, dx, height: h, riverDist } = R;
  let best = 0, bs = -Infinity;
  for (let j = W / 4; j < 3 * W / 4; j++) for (let i = W / 4; i < 3 * W / 4; i++) {
    const c = j * W + i, s = Math.hypot(h[c + 1] - h[c - 1], h[c + W] - h[c - W]) / (2 * dx);
    const score = Math.exp(-riverDist[c] / 60) * (riverDist[c] > 15 ? 1 : 0) * (0.2 + Math.min(s, 0.3));
    if (score > bs) { bs = score; best = c; }
  }
  return [((best % W) + 0.5) * dx - R.sizeM / 2, R.sizeM / 2 - (Math.floor(best / W) + 0.5) * dx];
}
