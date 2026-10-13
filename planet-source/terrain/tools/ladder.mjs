// Scale ladder shared by the 2D review (zoom-ladder.mjs) and the 3D scene
// export (export-scene.mjs): planet -> L1 (~400 km) -> L2 (~40 km) ->
// L3 (~4 km) -> L4 (~0.4 km), each centred on a point chosen in the previous one.
//
// Every level lives in the same tangent-plane frame around the planet centre
// (x east, y north, metres); `origin` is the level centre in that frame.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPlanet, planetSampler } from '../src/planet.mjs';
import { amplifyRegion, regionSampler, blur } from '../src/region.mjs';
import { createNearField, channelSize } from '../src/detail.mjs';
import { landColor, oceanColor } from '../src/shading.mjs';

export const outDir = new URL('../out/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

// Simulated levels (erosion) down to ~80 m; near-field levels are analytic.
export const LEVELS = [
  { name: 'L1', sizeM: 400e3, ex: 3 }, { name: 'L2', sizeM: 40e3, ex: 1.5 },
  { name: 'L3', sizeM: 4e3, ex: 1, near: true }, { name: 'L4', sizeM: 400, ex: 1, near: true },
];

export function loadTagged(tag) {
  const meta = JSON.parse(readFileSync(join(outDir, `planet-${tag}.json`), 'utf8'));
  return loadPlanet(meta, readFileSync(join(outDir, `planet-${tag}.bin`)));
}

/** Parse CLI args after the tag: [mountain|hills] or [lat lon]. */
export function parseSite(args) {
  if (args[1] !== undefined && !isNaN(+args[0])) return { site: `${args[0]}_${args[1]}`, lat: +args[0], lon: +args[1] };
  return { site: args[0] && isNaN(+args[0]) ? args[0] : 'mountain' };
}

/** Planet-surface centre: given lat/lon, or a wet mountain front / settled-looking lowland. */
export function pickCenter(P, { site, lat, lon }) {
  if (lat !== undefined) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  }
  const { grid, n } = P, { height, land, precip } = P.fields, dirs = grid.dirs;
  const forest = site === 'forest-mountain';
  const [lo, hi] = site === 'hills' ? [150, 700] : forest ? [900, 2600] : [800, 3500];
  const [amin, amax] = forest ? [25, 42] : [30, 52];
  let best = -1, bs = -Infinity;
  for (let c = 0; c < n; c++) {
    if (!land[c] || height[c] < lo || height[c] > hi) continue;
    if (forest && !(precip[c] >= 0.45)) continue;
    const la = Math.asin(dirs[c * 3 + 1]) * 180 / Math.PI;
    if (Math.abs(la) > amax || Math.abs(la) < amin) continue;
    const s = forest ? Math.min(precip[c], 1.5) * Math.min(height[c], 2200)
      : Math.min(precip[c], 1.2) * (site === 'hills' ? 1 + (c % 97) / 970 : Math.min(height[c], 2500));
    if (s > bs) { bs = s; best = c; }
  }
  if (best < 0) throw new Error(`pickCenter: no candidate found for site '${site}'`);
  return [dirs[best * 3], dirs[best * 3 + 1], dirs[best * 3 + 2]];
}

/**
 * Run the ladder. onLevel(R, L, k, { origin, next, box }) is called per level;
 * next is the following level's centre in R's local metres, box its pixel rectangle.
 */
export function runLadder(P, { tag, center, res = 512, levels = LEVELS, log = () => {}, onLevel }) {
  const cellM = Math.PI / 2 / P.N * P.radiusM;
  let parent = planetSampler(P, center), parentDx = cellM, offset = [0, 0];
  let prevSim = null, nearOf = null, nearOffset = [0, 0], origin = [0, 0];
  for (const [k, L] of levels.entries()) {
    let R;
    if (!L.near) {
      R = amplifyRegion({ parent, parentDx, sizeM: L.sizeM, res, seed: `${tag}/${L.name}/${offset.join(',')}`, log });
    } else {
      if (!nearOf) nearOf = createNearField(prevSim, { seed: `${tag}/near` });
      R = sampleNear(nearOf, nearOffset, L.sizeM, res);
    }
    const next = k < levels.length - 1 ? (L.near ? nextNearCenter(R) : nextCenter(R)) : null;
    let box = null;
    if (next) {
      const half = levels[k + 1].sizeM / 2 / R.dx, ci = (next[0] + R.sizeM / 2) / R.dx, cj = (R.sizeM / 2 - next[1]) / R.dx;
      box = [Math.round(ci - half), Math.round(cj - half), Math.round(ci + half), Math.round(cj + half)];
    }
    onLevel(R, L, k, { origin: [...origin], next, box });
    if (next) {
      origin = [origin[0] + next[0], origin[1] + next[1]];
      if (!L.near) {
        const s = regionSampler(R);
        parent = (x, y) => s(x + next[0], y + next[1]);
        parentDx = R.dx; offset = next.map(Math.round); prevSim = R;
        nearOffset = next;
      } else nearOffset = [nearOffset[0] + next[0], nearOffset[1] + next[1]];
    }
  }
}

/**
 * Unshaded surface colour per cell (biome, sea, lakes, rivers), RGB 0..255 as floats.
 * rivers: 'map' paints every cell above riverCells (cartographic, for 2D review);
 * 'coverage' blends by the fraction of the cell the channel really covers (3D).
 */
export function colorize(R, latDeg, { riverCells = 300, rivers = 'map' } = {}) {
  const { W, H, dx, height: h, fixed, precip: pr, discharge, lakeDepth } = R;
  const rgb = new Float64Array(W * H * 3);
  const at = (i, j) => h[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    let col;
    if (fixed[c] && h[c] <= 0) col = oceanColor(h[c]);
    else {
      const slope = R.colorSlope ? R.colorSlope[c] : Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j - 1) - at(i, j + 1)) / (2 * dx);
      col = landColor(latDeg, h[c], pr[c], slope);
      if (lakeDepth[c] > 0.5) col = [44, 92, 128];
      if (R.water && !Number.isNaN(R.water[c])) col = [52, 88, 104];
      else if (R.waterCover && R.waterCover[c] > 0) col = col.map((v, m) => v + ([52, 88, 104][m] - v) * R.waterCover[c]);
      const q = discharge[c] / (dx * dx);
      if (rivers === 'coverage') {
        const t = q > riverCells ? Math.min(1, channelSize(discharge[c]).width / dx) : 0;
        if (t > 0) col = col.map((v, m) => v + ([44, 92, 140][m] - v) * t);
      } else if (q > riverCells) { const t = Math.min(1, 0.45 + Math.log10(q / riverCells) / 2); col = col.map((v, m) => v + ([44, 92, 140][m] - v) * t); }
    }
    for (let m = 0; m < 3; m++) rgb[c * 3 + m] = col[m];
  }
  return rgb;
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

/** Grid-sample a near field around a local offset in the simulated region's frame. */
function sampleNear(sample, [ox, oy], sizeM, res) {
  const n = res * res, dx = sizeM / res, height = new Float32Array(n), water = new Float32Array(n).fill(NaN);
  const pr = new Float32Array(n), riverDist = new Float32Array(n), colorSlope = new Float32Array(n), waterCover = new Float32Array(n);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const c = j * res + i, r = sample(ox + (i + 0.5) * dx - sizeM / 2, oy + sizeM / 2 - (j + 0.5) * dx, dx);
    height[c] = r.h; pr[c] = r.precip; colorSlope[c] = r.baseSlope; riverDist[c] = r.riverDist; waterCover[c] = r.waterCover;
    if (r.water != null && r.waterCover >= 0.5) water[c] = r.water;
  }
  const fixed = new Uint8Array(n); for (let c = 0; c < n; c++) if (height[c] <= 0) fixed[c] = 1;
  return { W: res, H: res, dx, sizeM, height, fixed, precip: pr, water, waterCover, riverDist, colorSlope, discharge: new Float32Array(n), lakeDepth: new Float32Array(n) };
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
