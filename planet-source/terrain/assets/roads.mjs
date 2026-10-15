// Road surfaces as ribbons draped on the ground (ditches below the ground stay hidden until
// the terrain edit layer cuts them, ROADMAP T4): a cross-section profile swept
// along a smoothed polyline. The centreline height is the ground smoothed
// along the path (roads are graded, not bumpy); the outermost profile points
// sit on the ground, so verges and ditches blend into the terrain.
//
// Asset convention (Y up, metres): path is [[x, z], ...] on the ground plane,
// ground(x, z) -> y. The ribbon floats 3 cm above the ground to avoid z-fighting.

import { Mesh, rgb, rng } from './mesh.mjs';

/** Cross-sections: [offset from centre m (left -, right +), height above graded centre m, colour, onGround]. */
const PROFILES = {
  // Farm track: two wheel ruts with a grassy crown, no ditches.
  track: (r) => [
    [-2.0, 0, '#4f5a2c', true], [-1.35, 0, '#6e5d48'], [-1.0, -0.06, '#5e4e3c'], [-0.65, 0, '#6e5d48'],
    [-0.35, 0.03, '#55602f'], [0.35, 0.03, '#55602f'], [0.65, 0, '#6e5d48'], [1.0, -0.06, '#5e4e3c'], [1.35, 0, '#6e5d48'], [2.0, 0, '#4f5a2c', true],
  ],
  // Gravel lane: cambered, narrow grass verges and shallow ditches.
  lane: (r) => [
    [-3.8, 0, '#4f5a2c', true], [-3.0, -0.35, '#4a5429'], [-2.4, -0.05, '#5d6036'], [-2.0, 0, '#7c7466'],
    [0, 0.06, '#857c6d'], [2.0, 0, '#7c7466'], [2.4, -0.05, '#5d6036'], [3.0, -0.35, '#4a5429'], [3.8, 0, '#4f5a2c', true],
  ],
  // Paved road (setts / cobbles): kerbs, 2 % camber, verges and ditches.
  road: (r) => [
    [-5.4, 0, '#4f5a2c', true], [-4.5, -0.5, '#4a5429'], [-3.8, -0.05, '#5d6036'], [-3.3, 0.04, '#7e7a73'], [-3.15, -0.02, '#64615b'],
    [0, 0.06, '#6c6862'], [3.15, -0.02, '#64615b'], [3.3, 0.04, '#7e7a73'], [3.8, -0.05, '#5d6036'], [4.5, -0.5, '#4a5429'], [5.4, 0, '#4f5a2c', true],
  ],
};
export const ROAD_CLASSES = Object.keys(PROFILES);

/** Catmull-Rom resample of a polyline at roughly `step` metres. */
function resample(path, step) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[Math.max(0, i - 1)], p1 = path[i], p2 = path[i + 1], p3 = path[Math.min(path.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const cr = (a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3);
      out.push([cr(0), cr(1)]);
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/**
 * Build a road ribbon.
 * opts: { kind: 'track'|'lane'|'road', ground: (x,z)=>y, step: 2, grade: 12 (m, centreline smoothing radius), seed }
 */
export function roadRibbon(path, { kind = 'lane', ground = () => 0, step = 2, grade = 12, seed = 1 } = {}) {
  const prof = PROFILES[kind](rng(seed)), P = resample(path, step), n = P.length, rand = rng(`${seed}/wear`);
  // Graded centreline: moving average of ground height along the path.
  const g = P.map(([x, z]) => ground(x, z)), win = Math.max(1, Math.round(grade / step));
  const yc = g.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { s += g[k]; c++; } return s / c; });
  const m = new Mesh(), W = prof.length;
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx; // right-hand side (looking along +t, Y up)
    const wear = 0.94 + 0.12 * rand(); // patchy wear along the road
    for (const [off, dy, col, onGround] of prof) {
      const x = P[i][0] + rx * off, z = P[i][1] + rz * off;
      const y = onGround ? ground(x, z) : yc[i] + dy;
      m.pos.push(x, y + 0.03, z); m.nrm.push(0, 1, 0);
      m.col.push(...rgb(col).map((v) => Math.min(1, v * wear)));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < W - 1; k++) {
    const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
    m.idx.push(a, b, c, b, d, c); // CCW seen from above (Y up)
  }
  return m.recomputeNormals();
}

// Gallery samples: an S-bend for each class (flat ground, like the gallery floor).
const sampleGround = () => 0;
const sPath = (len) => Array.from({ length: 7 }, (_, i) => [8 * Math.sin(i / 6 * Math.PI * 1.5), i / 6 * len - len / 2]);
export const ROADS = Object.fromEntries(ROAD_CLASSES.map((kind) => [`road_${kind}`, {
  desc: `${kind} の道路の見本（S字の帯）。実際の配置では roadRibbon(path, { kind, ground }) を使う`,
  defaults: { length: 40 },
  make: (seed, p = {}) => roadRibbon(sPath(p.length ?? 40), { kind, ground: sampleGround, seed }),
  lod1: (seed, p = {}) => roadRibbon(sPath(p.length ?? 40), { kind, ground: sampleGround, seed, step: 6 }),
}]));
