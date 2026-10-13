// L0 planet: plate-driven uplift + fluvial erosion on a cube-sphere.
// Output is engine-agnostic typed arrays; see writePlanet in tools/.

import { createGrid, buildNeighbors } from './cubesphere.mjs';
import { createSimplex3, fbm, ridged, mulberry32 } from './noise.mjs';
import { distanceField } from './graph.mjs';
import { erode } from './erosion.mjs';

export const PLANET_GENERATOR = 'planet-l0@1';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KM = 1000;

export function generatePlanet({
  seed = 'planet-1', N = 256, radiusM = 6371000, plates = 14, landFraction = 0.3,
  iterations = 120, erosion = {}, log = () => {},
} = {}) {
  const t0 = Date.now();
  const grid = createGrid(N), nbh = buildNeighbors(grid), { n, dirs } = grid;
  log(`grid N=${N} cells=${n} (${(2 * Math.PI * radiusM / 4 / N / KM).toFixed(1)} km) ${Date.now() - t0}ms`);
  const R = radiusM, rand = mulberry32(seed + '/plates');
  const nA = createSimplex3(seed + '/a'), nB = createSimplex3(seed + '/b'), nC = createSimplex3(seed + '/c'), nW = createSimplex3(seed + '/warp');

  // Cell areas from neighbour spacing (unit sphere radians -> m^2).
  const cellArea = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const d = []; for (let q = 0; q < 8; q++) { if (nbh.nb[c * 8 + q] < 0) break; d.push(nbh.dist[c * 8 + q]); }
    d.sort((a, b) => a - b);
    const s = (d[0] + d[1] + d[2] + d[3]) / 4 * R; cellArea[c] = s * s;
  }

  // --- Plates: warped Voronoi on the sphere, each with an Euler pole.
  const seeds = [], poles = [];
  for (let p = 0; p < plates; p++) {
    const z = rand() * 2 - 1, a = rand() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
    seeds.push([r * Math.cos(a), r * Math.sin(a), z]);
    const pz = rand() * 2 - 1, pa = rand() * 2 * Math.PI, pr = Math.sqrt(1 - pz * pz), w = 0.4 + rand();
    poles.push([pr * Math.cos(pa) * w, pr * Math.sin(pa) * w, pz * w]);
  }
  const plate = new Int16Array(n);
  for (let c = 0; c < n; c++) {
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];
    const wx = x + 0.25 * fbm(nW, x * 2, y * 2, z * 2, 4), wy = y + 0.25 * fbm(nW, x * 2 + 31, y * 2, z * 2, 4), wz = z + 0.25 * fbm(nW, x * 2, y * 2 - 17, z * 2, 4);
    let best = 0, bd = -Infinity;
    for (let p = 0; p < plates; p++) { const d = wx * seeds[p][0] + wy * seeds[p][1] + wz * seeds[p][2]; if (d > bd) { bd = d; best = p; } }
    plate[c] = best;
  }

  // --- Continental crust field; per-plate bias makes some plates oceanic.
  const plateBias = Array.from({ length: plates }, () => (rand() - 0.55) * 0.5);
  const crust = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];
    crust[c] = fbm(nA, x * 1.3, y * 1.3, z * 1.3, 6, 2.1, 0.55) + plateBias[plate[c]];
  }

  // --- Boundaries: convergence = relative plate velocity along the boundary normal.
  const boundary = [], conv = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    let sum = 0, cnt = 0;
    const px = dirs[c * 3], py = dirs[c * 3 + 1], pz = dirs[c * 3 + 2], a = plate[c];
    for (let q = 0; q < 8; q++) {
      const m = nbh.nb[c * 8 + q]; if (m < 0) break;
      const b = plate[m]; if (b === a) continue;
      const wa = poles[a], wb = poles[b];
      // v = w x p ; relative velocity of a w.r.t. b
      const rx = (wa[1] - wb[1]) * pz - (wa[2] - wb[2]) * py, ry = (wa[2] - wb[2]) * px - (wa[0] - wb[0]) * pz, rz = (wa[0] - wb[0]) * py - (wa[1] - wb[1]) * px;
      let nx = dirs[m * 3] - px, ny = dirs[m * 3 + 1] - py, nz = dirs[m * 3 + 2] - pz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      sum += rx * nx + ry * ny + rz * nz; cnt++;
    }
    if (cnt) { boundary.push(c); conv[c] = sum / cnt; }
  }
  const bdf = distanceField(nbh, n, boundary);
  log(`plates=${plates} boundary cells=${boundary.length} ${Date.now() - t0}ms`);

  // --- Land mask: crust plus convergent belts (cordilleras, island arcs).
  const landScore = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const s = bdf.src[c], k = conv[s], dKm = bdf.d[c] * R / KM;
    const belt = k > 0 ? k * Math.exp(-((dKm / 350) ** 2)) : 0;
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];
    landScore[c] = crust[c] + 0.35 * belt + 0.06 * fbm(nC, x * 9, y * 9, z * 9, 4);
  }
  const sorted = Float32Array.from(landScore).sort();
  const threshold = sorted[Math.floor((1 - landFraction) * n)];
  const land = new Uint8Array(n); for (let c = 0; c < n; c++) land[c] = landScore[c] > threshold ? 1 : 0;

  // --- Distance to coast (both sides), for shelves and continentality.
  const coast = [];
  for (let c = 0; c < n; c++) for (let q = 0; q < 8; q++) { const m = nbh.nb[c * 8 + q]; if (m < 0) break; if (land[m] !== land[c]) { coast.push(c); break; } }
  const cdf = distanceField(nbh, n, coast);

  // --- Uplift (m/yr) on land, fixed bathymetry in the ocean.
  const uplift = new Float32Array(n), h = new Float32Array(n), fixed = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];
    const s = bdf.src[c], k = conv[s], dKm = bdf.d[c] * R / KM, coastKm = cdf.d[c] * R / KM;
    if (land[c]) {
      const continental = crust[s] > threshold - 0.05; // other side also continent-ish: wider orogen
      const w = continental ? 420 : 260;
      const belt = k > 0 ? Math.min(1.5, k) * Math.exp(-((dKm / w) ** 2)) : 0;
      const rift = k < 0 ? Math.min(1, -k) * Math.exp(-((dKm / 120) ** 2)) : 0;
      const massif = 0.35 + 0.9 * ridged(nB, x * 6, y * 6, z * 6, 5);
      const epeiro = Math.max(0, fbm(nC, x * 2.2, y * 2.2, z * 2.2, 4) + 0.15);
      // Old, worn orogens: narrow ridged bands of weak uplift in continental interiors.
      const oldBelt = Math.max(0, ridged(nA, x * 3.1 + 7, y * 3.1, z * 3.1, 4) - 0.55) / 0.45;
      uplift[c] = 3.2e-3 * belt * massif + 7e-4 * epeiro * smooth(0, 400, coastKm) + 9e-4 * oldBelt * smooth(50, 500, coastKm) - 4e-4 * rift;
      if (uplift[c] < 0) uplift[c] *= 0.25;
      h[c] = 20 + 150 * smooth(0, 600, coastKm) * (0.5 + 0.5 * fbm(nA, x * 5, y * 5, z * 5, 4));
    } else {
      fixed[c] = 1;
      const shelfW = (k > 0 && dKm < 500 ? 30 : 110) * (0.6 + 0.8 * Math.abs(fbm(nC, x * 4, y * 4, z * 4, 3)));
      let d = -40 - 100 * smooth(0, shelfW, coastKm);
      d += -3700 * smooth(shelfW, shelfW + 180, coastKm);
      d += -900 * smooth(300, 1500, coastKm) - 400 * fbm(nB, x * 8, y * 8, z * 8, 4);
      if (k < 0) d += 2200 * Math.min(1, -k * 1.5) * Math.exp(-((dKm / 350) ** 2)); // mid-ocean ridge
      if (k > 0) d -= 3500 * Math.min(1, k) * Math.exp(-((dKm / 90) ** 2)); // trench
      h[c] = Math.min(-15, d);
    }
  }

  // --- Precipitation factor: latitude bands, continentality, noise.
  const precip = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    const x = dirs[c * 3], y = dirs[c * 3 + 1], z = dirs[c * 3 + 2];
    const lat = Math.asin(y) * 180 / Math.PI, al = Math.abs(lat);
    const band = 0.25 + 1.1 * Math.exp(-((lat / 11) ** 2)) + 0.75 * Math.exp(-(((al - 52) / 13) ** 2)) - 0.2 * Math.exp(-(((al - 26) / 8) ** 2));
    const inland = Math.exp(-(cdf.d[c] * R / KM) / 1800);
    precip[c] = Math.max(0.05, band * (0.35 + 0.65 * inland) * (1 + 0.45 * fbm(nW, x * 3, y * 3, z * 3, 4)));
  }
  log(`fields ready ${Date.now() - t0}ms`);

  const params = { K: 6e-6, m: 0.5, dt: 2.5e5, diffusion: 0.04, lakeFill: 0.15, ...erosion };
  const st = erode({ h, fixed, uplift, cellArea, precip, nbh, distScale: R, iterations, params,
    onStep: (it) => { if (it % 20 === 0) log(`erosion ${it}/${iterations} ${Date.now() - t0}ms`); } });
  const lakeDepth = new Float32Array(n);
  for (let c = 0; c < n; c++) if (!fixed[c]) lakeDepth[c] = Math.max(0, st.filled[c] - h[c]);
  log(`done ${Date.now() - t0}ms`);

  return {
    generator: PLANET_GENERATOR, seed, N, radiusM, n, grid, nbh,
    fields: { height: h, land, uplift, precip, discharge: st.discharge, receiver: st.rec, lakeDepth, plate, cellArea },
  };
}

/**
 * Local tangent-plane sampler around a direction: (x east, y north) metres ->
 * { h, slope, precip }. Gaussian-weighted over the cell neighbourhood, so it is
 * smooth across cube face seams.
 */
export function planetSampler(P, center) {
  const { grid, nbh, radiusM: R, N } = P, { height, precip, land, discharge } = P.fields, dirs = grid.dirs;
  const [cx, cy, cz] = center;
  let ex = -cz, ey = 0, ez = cx; const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nx = cy * ez - cz * ey, ny = cz * ex - cx * ez, nz = cx * ey - cy * ex;
  const sigma = (Math.PI / 2 / N) * 0.75;
  const hAt = (x, y, out) => {
    let px = cx + (ex * x + nx * y) / R, py = cy + (ey * x + ny * y) / R, pz = cz + (ez * x + nz * y) / R;
    const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l;
    const c0 = grid.cellOf(px, py, pz);
    let sw = 0, sh = 0, sp = 0;
    const add = (c) => {
      const d = Math.acos(Math.min(1, px * dirs[c * 3] + py * dirs[c * 3 + 1] + pz * dirs[c * 3 + 2]));
      const w = Math.exp(-((d / sigma) ** 2));
      sw += w; sh += w * (land[c] ? height[c] : Math.min(height[c], -1)); sp += w * precip[c];
    };
    add(c0);
    for (let q = 0; q < 8; q++) { const m = nbh.nb[c0 * 8 + q]; if (m < 0) break; add(m); }
    if (out) {
      out.precip = sp / sw;
      let q = discharge[c0]; // peak discharge nearby: rivers stay narrow
      for (let k = 0; k < 8; k++) { const m = nbh.nb[c0 * 8 + k]; if (m < 0) break; if (land[m]) q = Math.max(q, discharge[m] * 0.5); }
      out.q = land[c0] ? q : 0;
    }
    return sh / sw;
  };
  const e = (Math.PI / 2 / N) * R * 0.5, o = {};
  return (x, y) => {
    const h = hAt(x, y, o);
    const gx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e), gy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e);
    return { h, slope: Math.hypot(gx, gy), gx, gy, precip: o.precip, q: o.q };
  };
}

/** Rebuild a planet object from saved fields (see tools/build-planet.mjs). */
export function loadPlanet(meta, buf) {
  const { N, radiusM } = meta, grid = createGrid(N), nbh = buildNeighbors(grid), n = grid.n;
  const f32 = (k) => new Float32Array(buf.buffer, buf.byteOffset + k * n * 4, n).slice();
  const land = new Uint8Array(buf.buffer, buf.byteOffset + 4 * n * 4, n).slice();
  return { ...meta, n, grid, nbh, fields: { height: f32(0), discharge: f32(1), precip: f32(2), lakeDepth: f32(3), land } };
}
