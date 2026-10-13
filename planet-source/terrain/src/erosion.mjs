// Uplift + fluvial erosion (implicit stream power, Braun & Willett 2013) with
// priority-flood depression handling (Barnes 2014) and light hillslope
// diffusion. Works on any graph given as an 8-slot neighbour table.
//
// Height units are metres, time is years, distances metres.
// fixed[c]=1 marks base-level outlets (ocean, outflow borders); fixed[c]=2 marks
// walls (inflow borders): held at their height but never drained into.

import { MinHeap } from './graph.mjs';

export function createErosionState(n) {
  return {
    filled: new Float32Array(n),
    order: new Int32Array(n),
    orderLen: 0,
    rec: new Int32Array(n),
    recDist: new Float32Array(n),
    discharge: new Float32Array(n),
    heap: new MinHeap(n * 2),
    visited: new Uint8Array(n),
  };
}

/** Priority-flood from fixed cells. Fills order (ascending filled height),
 * receivers (steepest descent on the filled surface) and filled heights. */
export function routeFlow(h, fixed, nbh, distScale, st, eps = Math.max(2e-3, 2e-5 * distScale)) {
  const { nb, dist } = nbh, n = h.length;
  const { filled, order, rec, recDist, heap, visited } = st;
  visited.fill(0); heap.size = 0; st.orderLen = 0;
  for (let c = 0; c < n; c++) {
    if (!fixed[c]) continue;
    visited[c] = 1; filled[c] = h[c]; rec[c] = -1;
    if (fixed[c] !== 1) continue;
    for (let q = 0; q < 8; q++) {
      const m = nb[c * 8 + q];
      if (m < 0) break;
      if (!fixed[m]) { heap.push(h[c], c); break; }
    }
  }
  while (heap.size) {
    const c = heap.pop(), fc = filled[c];
    if (!fixed[c]) order[st.orderLen++] = c;
    for (let q = 0; q < 8; q++) {
      const m = nb[c * 8 + q];
      if (m < 0) break;
      if (visited[m] || fixed[m]) continue;
      visited[m] = 1;
      // Jittered epsilon: flats drain along irregular paths instead of grid lines.
      const r = (Math.imul(m ^ 0x9E3779B9, 0x85EBCA6B) >>> 0) / 4294967296;
      filled[m] = Math.max(h[m], fc + eps * (0.2 + 1.6 * r));
      if (filled[m] <= fc) filled[m] = fc + Math.max(eps, Math.abs(fc) * 2.4e-7); // float32 resolution
      rec[m] = c; recDist[m] = dist[c * 8 + q] * distScale; // fallback receiver: flood parent
      heap.push(filled[m], m);
    }
  }
  // Steepest descent on filled surface. The flood parent guarantees one exists.
  for (let k = 0; k < st.orderLen; k++) {
    const c = order[k];
    let best = rec[c], bestS = -Infinity, bestD = recDist[c];
    for (let q = 0; q < 8; q++) {
      const m = nb[c * 8 + q];
      if (m < 0) break;
      if (fixed[m] === 2) continue;
      const dh = filled[c] - filled[m];
      if (dh <= 0) continue;
      const d = dist[c * 8 + q] * distScale, s = dh / d;
      if (s > bestS) { bestS = s; best = m; bestD = d; }
    }
    rec[c] = best; recDist[c] = bestD;
  }
}

/** Discharge = upstream sum of area*precipitation (m^2 equivalent). */
export function accumulate(cellArea, precip, st, inflow = null) {
  const { order, rec, discharge } = st;
  discharge.set(cellArea);
  if (precip) for (let c = 0; c < discharge.length; c++) discharge[c] *= precip[c];
  if (inflow) for (let c = 0; c < discharge.length; c++) discharge[c] += inflow[c];
  for (let k = st.orderLen - 1; k >= 0; k--) {
    const c = order[k], r = rec[c];
    if (r >= 0) discharge[r] += discharge[c];
  }
}

/**
 * Run `iterations` erosion steps in place on h.
 * params: { K, m, dt, diffusion (0..0.25 per step), maxSlope, lakeFill (0..1) }
 */
export function erode({ h, fixed, uplift, cellArea, precip, inflow = null, nbh, distScale, iterations, params, state, onStep }) {
  const n = h.length, st = state ?? createErosionState(n);
  const { K, m, dt, diffusion = 0, maxSlope = Infinity, lakeFill = 0.1, baseLevel = 0, channelArea = 0 } = params;
  const { nb, dist } = nbh, tmp = new Float32Array(n);
  for (let it = 0; it < iterations; it++) {
    routeFlow(h, fixed, nbh, distScale, st);
    accumulate(cellArea, precip, st, inflow);
    const { order, rec, recDist, discharge, filled } = st;
    for (let k = 0; k < st.orderLen; k++) {
      const c = order[k], r = rec[c];
      const ch = channelArea > 0 ? Math.min(1, discharge[c] / channelArea) ** 2 : 1;
      // Unchannelled hillslopes take little uplift; diffusion rounds them.
      const u = uplift ? uplift[c] * dt * (channelArea > 0 ? Math.max(ch, 0.1) : 1) : 0;
      if (h[c] < filled[c] - 1e-2) { // inside a depression: uplift + sediment infill
        h[c] += u + lakeFill * (filled[c] - h[c]);
        continue;
      }
      const hr = fixed[r] ? Math.max(h[r], baseLevel) : h[r];
      // Above the channel head, hillslopes are diffusive: fade fluvial incision in.
      const f = ch * K * dt * Math.pow(discharge[c], m) / recDist[c];
      let v = (h[c] + u + f * hr) / (1 + f);
      if (v < hr) v = hr + 1e-3; // never invert the drainage tree
      if (maxSlope < Infinity && (v - hr) / recDist[c] > maxSlope) v = hr + maxSlope * recDist[c];
      h[c] = v;
    }
    if (diffusion > 0) {
      tmp.set(h);
      for (let c = 0; c < n; c++) {
        if (fixed[c]) continue;
        let s = 0, w = 0, smax = 0;
        for (let q = 0; q < 8; q++) {
          const mm = nb[c * 8 + q];
          if (mm < 0) break;
          const wq = 1 / dist[c * 8 + q], hm = fixed[mm] === 1 ? Math.max(tmp[mm], baseLevel) : tmp[mm];
          s += wq * hm; w += wq;
          smax = Math.max(smax, Math.abs(hm - tmp[c]) * wq / distScale);
        }
        // Nonlinear (Roering-type) creep: transport grows sharply near the
        // critical slope, which rounds crests instead of leaving facets.
        const r = maxSlope < Infinity ? Math.min(0.9, (smax / maxSlope) ** 2) : 0;
        h[c] = tmp[c] + Math.min(0.5, diffusion / (1 - r)) * (s / w - tmp[c]);
      }
    }
    onStep?.(it, st);
  }
  routeFlow(h, fixed, nbh, distScale, st);
  accumulate(cellArea, precip, st, inflow);
  return st;
}
