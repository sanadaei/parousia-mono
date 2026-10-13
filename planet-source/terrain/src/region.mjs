// Terrain amplification: one parent sampler -> a finer square region.
//
// Principle: the parent owns the low frequencies, the child only adds the
// band it can resolve. Each child is eroded with the same stream-power model,
// and every few steps its low-pass is re-pinned to the parent's, so zooming
// out from the child always reproduces the parent (no scale drift).

import { createSimplex3, fbm, ridged } from './noise.mjs';
import { erode, createErosionState } from './erosion.mjs';

export const REGION_GENERATOR = 'region-amplify@1';

/** 8-neighbour planar grid in the format used by erosion.mjs (dist in cells). */
export function planarNeighbors(W, H) {
  const n = W * H, nb = new Int32Array(n * 8).fill(-1), dist = new Float32Array(n * 8);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x; let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      nb[c * 8 + k] = Y * W + X; dist[c * 8 + k] = dx && dy ? Math.SQRT2 : 1; k++;
    }
  }
  return { nb, dist };
}

/** Separable box blur repeated (3x ~ Gaussian), radius r cells, clamped edges. */
export function blur(src, W, H, r, passes = 3) {
  if (r < 1) return Float32Array.from(src);
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const pass = (from, to, horiz) => {
    const len = horiz ? W : H, lines = horiz ? H : W, inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const at = (i) => { i = i < 0 ? 0 : i >= len ? len - 1 : i; return horiz ? from[l * W + i] : from[i * W + l]; };
      let s = 0; for (let i = -r; i <= r; i++) s += at(i);
      for (let i = 0; i < len; i++) {
        if (horiz) to[l * W + i] = s * inv; else to[i * W + l] = s * inv;
        s += at(i + r + 1) - at(i - r);
      }
    }
  };
  for (let k = 0; k < passes; k++) { pass(a, b, true); pass(b, a, false); }
  return a;
}

/**
 * parent(x, y) -> { h, slope, gx, gy, precip, q } in local metres around the region centre
 * (x east, y north). Returns fields on a res x res grid with spacing sizeM/res.
 */
export function amplifyRegion({ parent, parentDx, sizeM, res = 512, pad = Math.round(res / 8), ...rest }) {
  const dx = sizeM / res, full = amplifyRaw({ parent, parentDx, sizeM: (res + 2 * pad) * dx, res: res + 2 * pad, ...rest });
  const W = res, n = W * W, FW = full.W, out = { W, H: W, dx, sizeM };
  for (const k of ['height', 'fixed', 'precip', 'discharge', 'lakeDepth']) {
    const src = full[k], dst = new src.constructor(n);
    for (let j = 0; j < W; j++) dst.set(src.subarray((j + pad) * FW + pad, (j + pad) * FW + pad + W), j * W);
    out[k] = dst;
  }
  // Receivers point into the padded grid; remap, -1 where flow leaves the crop.
  out.receiver = new Int32Array(n);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const r = full.receiver[(j + pad) * FW + i + pad];
    if (r < 0) { out.receiver[j * W + i] = -1; continue; }
    const ri = (r % FW) - pad, rj = Math.floor(r / FW) - pad;
    out.receiver[j * W + i] = ri >= 0 && rj >= 0 && ri < W && rj < W ? rj * W + ri : -1;
  }
  return out;
}

function amplifyRaw({ parent, parentDx, sizeM, res, seed = 'r', iterations = 90, pinEvery = 6, seaLevel = 0, log = () => {} }) {
  const W = res, H = res, n = W * H, dx = sizeM / res;
  const nbh = planarNeighbors(W, H);
  const nD = createSimplex3(seed + '/detail'), nU = createSimplex3(seed + '/uplift');
  const ph = new Float32Array(n), pslope = new Float32Array(n), precip = new Float32Array(n);
  const pq = new Float32Array(n), pgx = new Float32Array(n), pgy = new Float32Array(n);
  const xs = (i) => (i + 0.5) * dx - sizeM / 2, ys = (j) => sizeM / 2 - (j + 0.5) * dx;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = parent(xs(i), ys(j)), c = j * W + i;
    ph[c] = p.h; pslope[c] = p.slope; precip[c] = p.precip; pq[c] = p.q; pgx[c] = p.gx; pgy[c] = p.gy;
  }
  // Noise frequencies are expressed in world metres so neighbouring regions agree.
  const fq = 1 / (parentDx * 1.5);
  // Fine scales are hillslope-dominated and mostly inherit their relief:
  // weaker new uplift/noise, more diffusion, gentler talus.
  const fine = Math.min(1, Math.max(0, Math.log10(500 / dx) / 2));
  const h = new Float32Array(n), fixed = new Uint8Array(n), uplift = new Float32Array(n);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i, X = xs(i) * fq, Y = ys(j) * fq;
    const relief = (0.6 * pslope[c] * parentDx + 4) * (1 - 0.6 * fine);          // what the parent could not resolve
    const det = fbm(nD, X, Y, 0.5, 6, 2, 0.5);
    h[c] = ph[c] + relief * det * (ph[c] > seaLevel ? 1 : 0.3);
    // Target headwater steepness follows the parent: steep parent -> steep child.
    const sT = Math.min(0.8, (1.1 * pslope[c] + 0.015) * (0.5 + 1.0 * ridged(nU, X * 1.3, Y * 1.3, 2.1, 4)));
    uplift[c] = sT; // scaled to K*dx below
    if (h[c] <= seaLevel) fixed[c] = 1;
  }
  const inflow = borderConditions({ W, H, dx, parentDx, h, fixed, pq, pgx, pgy, log });
  // Fine levels only cut channels into inherited relief; they must not reach
  // equilibrium, or incision and re-pinning ratchet relief upward.
  const params = { K: 6e-6, m: 0.5, dt: 2.5e5 * (1 - 0.9 * fine), diffusion: 0.03 + 0.2 * fine, lakeFill: 1, maxSlope: 1.2 - 0.35 * fine, baseLevel: seaLevel, channelArea: 4000 };
  // Steady state at a headwater cell: S = U / (K sqrt(A)), A = dx^2 * precip.
  for (let c = 0; c < n; c++) uplift[c] *= params.K * dx * Math.sqrt(precip[c]) * (1 - 0.8 * fine);
  const cellArea = new Float32Array(n).fill(dx * dx);
  const r = Math.max(1, Math.round(parentDx / dx * 0.7));
  const target = blur(ph, W, H, r);
  const state = createErosionState(n);
  const pin = () => {
    const low = blur(h, W, H, r);
    for (let c = 0; c < n; c++) if (!fixed[c]) h[c] += target[c] - low[c];
  };
  for (let done = 0; done < iterations; done += pinEvery) {
    erode({ h, fixed, uplift, cellArea, precip, inflow, nbh, distScale: dx, iterations: Math.min(pinEvery, iterations - done), params, state });
    pin();
  }
  // Settle after the last pin so drainage is consistent; keep only real lakes.
  erode({ h, fixed, uplift: null, cellArea, precip, inflow, nbh, distScale: dx, iterations: 2, params: { ...params, dt: 1 }, state });
  for (let c = 0; c < n; c++) if (!fixed[c] && state.filled[c] - h[c] < 3) h[c] = Math.max(h[c], state.filled[c] - 1e-3);
  const lakeDepth = new Float32Array(n);
  for (let c = 0; c < n; c++) if (!fixed[c]) lakeDepth[c] = Math.max(0, state.filled[c] - h[c]);
  log(`region ${(sizeM / 1000).toFixed(1)} km dx=${dx.toFixed(1)} m pin r=${r}`);
  return { W, H, dx, sizeM, height: h, fixed, precip, discharge: state.discharge, lakeDepth, receiver: state.rec };
}

/** Bilinear sampler over a region result, in its own local metres. */
export function regionSampler(R) {
  const { W, H, dx, sizeM, height, precip } = R;
  const at = (arr, x, y) => {
    const fx = Math.min(W - 1.001, Math.max(0, (x + sizeM / 2) / dx - 0.5)), fy = Math.min(H - 1.001, Math.max(0, (sizeM / 2 - y) / dx - 0.5));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, c = j * W + i;
    return (arr[c] * (1 - u) + arr[c + 1] * u) * (1 - v) + (arr[c + W] * (1 - u) + arr[c + W + 1] * u) * v;
  };
  const peak = (x, y) => { // largest discharge of the 4 surrounding cells: keeps rivers narrow
    const fx = Math.min(W - 1.001, Math.max(0, (x + sizeM / 2) / dx - 0.5)), fy = Math.min(H - 1.001, Math.max(0, (sizeM / 2 - y) / dx - 0.5));
    const c = Math.floor(fy) * W + Math.floor(fx), d = R.discharge;
    return Math.max(d[c], d[c + 1], d[c + W], d[c + W + 1]);
  };
  return (x, y) => {
    const h = at(height, x, y);
    const gx = (at(height, x + dx, y) - at(height, x - dx, y)) / (2 * dx), gy = (at(height, x, y + dx) - at(height, x, y - dx)) / (2 * dx);
    return { h, slope: Math.hypot(gx, gy), gx, gy, precip: at(precip, x, y), q: peak(x, y) };
  };
}

/**
 * Border conditions from the parent's flow. Where the parent drains outward
 * the border is an outlet (fixed=1); where it drains inward it is a wall
 * (fixed=2) and the parent's upstream discharge is injected just inside, at
 * the local discharge peak, so trunk rivers continue through the region.
 */
function borderConditions({ W, H, dx, parentDx, h, fixed, pq, pgx, pgy, log }) {
  const n = W * H, inflow = new Float32Array(n), ring = [];
  // Perimeter in order with inward normals (x east, y north; row j grows southward).
  for (let i = 0; i < W - 1; i++) ring.push([i, 0, 0, -1]);
  for (let j = 0; j < H - 1; j++) ring.push([W - 1, j, -1, 0]);
  for (let i = W - 1; i > 0; i--) ring.push([i, H - 1, 0, 1]);
  for (let j = H - 1; j > 0; j--) ring.push([0, j, 1, 0]);
  let outlets = 0;
  const inward = new Float32Array(ring.length);
  ring.forEach(([i, j, nx, ny], k) => {
    const c = j * W + i;
    inward[k] = -(pgx[c] * nx + pgy[c] * ny); // flow = -grad
    if (fixed[c] === 1) { outlets++; return; }
    fixed[c] = inward[k] > 0 ? 2 : 1;
    if (fixed[c] === 1) outlets++;
  });
  if (!outlets) { // closed parent basin: drain from the lowest border cell
    let low = 0; ring.forEach(([i, j], k) => { if (h[j * W + i] < h[ring[low][1] * W + ring[low][0]]) low = k; });
    fixed[ring[low][1] * W + ring[low][0]] = 1;
  }
  const L = ring.length, win = Math.max(3, Math.round(parentDx / dx));
  const inner = (k) => { const [i, j, nx, ny] = ring[k]; return Math.min(H - 2, Math.max(1, j - ny)) * W + Math.min(W - 2, Math.max(1, i + nx)); };
  const val = (k) => fixed[ring[k][1] * W + ring[k][0]] === 2 ? pq[inner(k)] : 0;
  const minQ = 10 * parentDx * parentDx;
  let rivers = 0;
  for (let k = 0; k < L; k++) {
    const v = val(k); if (v < minQ) continue;
    let isMax = true;
    for (let d = -win; d <= win && isMax; d++) { if (!d) continue; const u = val((k + d + L) % L); if (u > v || (u === v && d < 0)) isMax = false; }
    if (!isMax) continue;
    let best = inner(k);
    for (let d = -(win >> 1); d <= win >> 1; d++) { const c = inner((k + d + L) % L); if (!fixed[c] && h[c] < h[best]) best = c; }
    if (fixed[best]) continue;
    inflow[best] += v; rivers++;
  }
  log(`border: ${outlets} outlet cells, ${rivers} inflowing rivers`);
  return inflow;
}
