// Near field (< ~50 m): analytic amplification of a simulated region.
// Pure functions of (x, y) so the same maths can move into a GPU shader.
//
//   height = C1 interpolation of the parent
//          + slope-aligned gully noise (stripes run downhill, octaves branch)
//          + river channels traced from the parent's drainage tree
//
// The parent keeps everything coarser than its own cell; detail is zero-mean
// per octave and fades out on flats, so zooming out still shows the parent.

import { hashSeed, createSimplex3 } from './noise.mjs';
import { blur } from './region.mjs';

export const NEAR_FIELD = 'near-field@1';

function hash2(ix, iy, k, s) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(k + 1, 0x9e3779b9) ^ s;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Catmull-Rom bicubic on a W x H grid stored row-major, row 0 = north. */
function bicubic(arr, W, H, fx, fy) {
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const at = (a, b) => arr[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (b) => cr(at(i - 1, b), at(i, b), at(i + 1, b), at(i + 2, b), u);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), v);
}

/**
 * Smoothed river polylines from the parent's receiver tree.
 * Discharge is area*precip in m^2; minArea selects which become channels.
 */
function traceRivers(R, minArea, seed) {
  const { W, H, dx, sizeM, discharge, receiver, fixed } = R;
  const pos = (c) => [((c % W) + 0.5) * dx - sizeM / 2, sizeM / 2 - (Math.floor(c / W) + 0.5) * dx];
  const main = new Int32Array(W * H).fill(-1); // largest upstream tributary
  for (let c = 0; c < W * H; c++) {
    const r = receiver[c];
    if (r < 0 || fixed[c] || discharge[c] < minArea) continue;
    if (main[r] < 0 || discharge[c] > discharge[main[r]]) main[r] = c;
  }
  const segs = []; // [x0,y0,x1,y1,q0,q1]
  const wander = createSimplex3(seed + '/meander');
  // Control point per channel cell: 3-point smoothed and shifted sideways by a
  // smooth noise, so consecutive bends form meanders. Shared by every segment
  // that touches the cell, so confluences stay joined.
  const ctrl = new Map();
  const point = (c) => {
    if (ctrl.has(c)) return ctrl.get(c);
    const p = pos(c), up = main[c], dn = receiver[c];
    let q = p;
    if (up >= 0 && dn >= 0 && !fixed[c]) {
      const a = pos(up), b = pos(dn);
      q = [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const amp = Math.min(0.35 * dx, 3 * channelSize(discharge[c]).width);
      const k = amp * wander.call(null, p[0] / (dx * 3.5), p[1] / (dx * 3.5), 0.7);
      q = [q[0] - ty * k, q[1] + tx * k];
    }
    ctrl.set(c, q);
    return q;
  };
  const isCh = (c) => c >= 0 && !fixed[c] && discharge[c] >= minArea;
  for (let c = 0; c < W * H; c++) {
    const r = receiver[c];
    if (r < 0 || !isCh(c)) continue;
    const p1 = point(c), p2 = point(r);
    const p0 = main[c] >= 0 ? point(main[c]) : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    const rr = isCh(r) ? receiver[r] : -1, p3 = rr >= 0 ? point(rr) : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const SUB = 6;
    let prev = p1;
    for (let k = 1; k <= SUB; k++) { // Catmull-Rom between p1 and p2
      const t = k / SUB, t2 = t * t, t3 = t2 * t;
      const cr = (i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
      const cur = [cr(0), cr(1)];
      const q0 = discharge[c] + (discharge[r] - discharge[c]) * (k - 1) / SUB, q1 = discharge[c] + (discharge[r] - discharge[c]) * k / SUB;
      segs.push([prev[0], prev[1], cur[0], cur[1], Math.min(q0, discharge[c] * 1.0001), Math.min(q1, discharge[c] * 1.0001)]);
      prev = cur;
    }
  }
  // Bucket segments by parent cell for local queries.
  const buckets = new Map(), key = (i, j) => j * W + i;
  segs.forEach((s, k) => {
    const i0 = Math.floor((Math.min(s[0], s[2]) + sizeM / 2) / dx), i1 = Math.floor((Math.max(s[0], s[2]) + sizeM / 2) / dx);
    const j0 = Math.floor((sizeM / 2 - Math.max(s[1], s[3])) / dx), j1 = Math.floor((sizeM / 2 - Math.min(s[1], s[3])) / dx);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const kk = key(i, j); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(k); }
  });
  return { segs, buckets };
}

/** Bankfull hydraulic geometry from catchment (m^2 * precip). */
export function channelSize(area) {
  const Q = Math.max(0.01, area / 1e6 * 0.01 * 3); // m^3/s, mean flow x3 for bankfull
  return { width: Math.max(1.2, 3.2 * Math.sqrt(Q)), depth: Math.max(0.3, 0.35 * Q ** 0.36) };
}

export function createNearField(R, { seed = 'near', minChannelArea = 2e5, octaves = 7, gullyDepth = 0.16 } = {}) {
  const { W, H, dx, sizeM, height, precip } = R, s0 = hashSeed(seed);
  const rivers = traceRivers(R, minChannelArea, seed);
  const toF = (x, y) => [(x + sizeM / 2) / dx - 0.5, (sizeM / 2 - y) / dx - 0.5];
  // D8 routing and talus caps leave grid-aligned facets that a 10x zoom would
  // expose; the near field starts from a lightly smoothed parent instead.
  const smoothH = blur(height, W, H, 1, 1);
  const base = (x, y) => { const [fx, fy] = toF(x, y); return bicubic(smoothH, W, H, fx, fy); };

  function nearestRiver(x, y) {
    const ci = Math.floor((x + sizeM / 2) / dx), cj = Math.floor((sizeM / 2 - y) / dx);
    let best = Infinity, q = 0, bx = 0, by = 0;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      const list = rivers.buckets.get(j * W + i); if (!list) continue;
      for (const k of list) {
        const s = rivers.segs[k], ex = s[2] - s[0], ey = s[3] - s[1];
        const t = Math.max(0, Math.min(1, ((x - s[0]) * ex + (y - s[1]) * ey) / (ex * ex + ey * ey || 1)));
        const px = s[0] + t * ex, py = s[1] + t * ey, d = Math.hypot(x - px, y - py);
        if (d < best) { best = d; q = s[4] + t * (s[5] - s[4]); bx = px; by = py; }
      }
    }
    return { d: best, area: q, x: bx, y: by };
  }

  const nCluster = createSimplex3(seed + '/gully-cluster');
  const cluster = (u, w, k) => nCluster(u, w, k * 1.7);
  /** One gully octave in cell units (cell size 1): trough sum v and dv/d(across). */
  function gullyOctave(u, w, px, py, k) {
    const ix = Math.floor(u), iy = Math.floor(w);
    let v = 0, d = 0;
    // 5x5 cells cover radius 2 around the query; the window taper reaches zero
    // there, so features entering or leaving the window leave no seam.
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const cx = ix + i + hash2(ix + i, iy + j, k, s0), cy = iy + j + hash2(ix + i, iy + j, k + 31, s0);
      const du = u - cx, dw = w - cy, taper = 1 - (du * du + dw * dw) / 4;
      if (taper <= 0) continue;
      const al = du * py - dw * px, ac = du * px + dw * py;
      const hw = 0.3 + 0.45 * hash2(ix + i, iy + j, k + 57, s0); // trough half-width
      if (ac >= hw || ac <= -hw) continue;
      // Clustered presence and random length: gullies bunch and gap like real ones.
      const gx0 = ix + i, gy0 = iy + j;
      if (hash2(gx0, gy0, k + 71, s0) > 0.45 + 0.5 * cluster(gx0 / 6, gy0 / 6, k)) continue;
      const len2 = 1 + 3 * hash2(gx0, gy0, k + 13, s0);
      const a = (0.4 + 1.2 * hash2(gx0, gy0, k + 91, s0)) * taper * taper * Math.exp(-al * al / len2);
      const q = ac / hw, t = 1 - q * q;
      v -= a * t * t; d += a * 4 * q * t / hw;
    }
    return { v, d };
  }
  // Mean of the trough sum (sampled once), removed so each octave is zero-mean
  // and the near field still averages back to the parent.
  const gullyMean = (() => {
    let m = 0; const N = 6000;
    for (let t = 0; t < N; t++) { const r = hash2(t, 7, 3, s0) * 2 * Math.PI; m += gullyOctave(hash2(t, 1, 2, s0) * 97, hash2(t, 3, 4, s0) * 97, Math.cos(r), Math.sin(r), 0).v; }
    return m / N;
  })();

  /** Height (m) and surface info at local metres (x east, y north).
   * footprint: sample spacing in metres; octaves finer than 2x it are skipped (no aliasing). */
  return function sample(x, y, footprint = 0) {
    let h = base(x, y);
    const e = dx * 0.5;
    let gx = (base(x + e, y) - base(x - e, y)) / (2 * e), gy = (base(x, y + e) - base(x, y - e)) / (2 * e);
    const baseSlope = Math.hypot(gx, gy);

    // Meander: displace the query point across the channel, not the channel itself.
    const riv = nearestRiver(x, y);
    const ch = riv.d < Infinity ? channelSize(riv.area) : null;
    const plain = ch ? Math.max(ch.width * 4, Math.min(dx, 12 * ch.width)) : 0; // floodplain half-width
    const floodW = ch ? Math.max(0, 1 - riv.d / plain) : 0;

    // Gully noise: suppressed on floodplains and flats. Each feature point is one
    // V-shaped trough along the slope (random width and depth), so spacing is
    // irregular and sharp spurs form where neighbouring troughs meet.
    let s = dx * 0.5; // the parent already resolves its own cell size
    for (let k = 0; k < octaves; k++, s *= 0.5) {
      const slope = Math.hypot(gx, gy);
      if (slope < 1e-4 || s < 2 * footprint) break;
      const px = -gy / slope, py = gx / slope; // across-slope direction
      const { v, d } = gullyOctave(x / s, y / s, px, py, k);
      const lod = footprint > 0 ? Math.min(1, Math.max(0, (s / footprint - 2) / 2)) : 1; // fade in, no popping
      // Depth follows the parent's slope (not the gullied one, which would feed back),
      // steeper than linearly: gentle soil-mantled hills stay smooth.
      const amp = lod * s * gullyDepth * 0.85 ** k * Math.min(1.5, (baseSlope / 0.3) ** 1.5) * Math.min(1, baseSlope * 40) * (1 - floodW);
      h += amp * (v - gullyMean);
      gx += amp * d / s * px; gy += amp * d / s * py; // later octaves follow the new slope: branching
    }

    let water = 0, waterCover = 0;
    if (ch) {
      // Floodplain: relax towards the bank height; channel: trapezoid below it.
      const bank = base(riv.x, riv.y);
      h = h + (bank + 0.4 - h) * Math.min(1, floodW * 1.6) ** 2 * (h > bank ? 1 : 0.5);
      // A channel narrower than the sampling would alias into beads: widen it to
      // three footprints and keep its cross-section area (shallower).
      const w = Math.max(ch.width, 3 * footprint), depth = ch.depth * ch.width / w, half = w / 2;
      if (riv.d < half * 1.6) {
        const t = Math.max(0, Math.min(1, (riv.d - half * 0.6) / (half)));
        const bed = bank - depth * (1 - t * t);
        if (bed < h) h = bed;
        if (riv.d < half) { water = bank - 0.15 * depth; waterCover = ch.width / w; }
      }
    }
    // waterCover: fraction of the (widened) channel that is really water, for colouring.
    return { h, water: water > h ? water : null, waterCover: water > h ? waterCover : 0, slope: Math.hypot(gx, gy), baseSlope, riverDist: riv.d, precip: precipAt(x, y) };
  };

  function precipAt(x, y) { const [fx, fy] = toF(x, y); return precip[Math.min(H - 1, Math.max(0, Math.round(fy))) * W + Math.min(W - 1, Math.max(0, Math.round(fx)))]; }
}
