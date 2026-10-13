// Scale ladder review: planet -> L1 (~400 km) -> L2 (~40 km) -> L3 (~4 km) -> L4 (~0.4 km),
// each a 10x zoom of a box marked on the previous image.
// usage: node terrain/tools/zoom-ladder.mjs [planetTag] [mountain|hills|lat lon]

import { join } from 'node:path';
import { outDir, loadTagged, parseSite, pickCenter, runLadder, colorize } from './ladder.mjs';
import { writePng } from './png.mjs';

const tag = process.argv[2] ?? 'planet-1-N512';
const where = parseSite(process.argv.slice(3)), { site } = where;
const P = loadTagged(tag);
const t0 = Date.now(), log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

const center = pickCenter(P, where);
const latDeg = Math.asin(center[1]) * 180 / Math.PI;
log(`centre lat ${latDeg.toFixed(2)} lon ${(Math.atan2(center[0], center[2]) * 180 / Math.PI).toFixed(2)}`);

function render(R, name, { exaggeration = 1, box = null } = {}) {
  const { W, H, dx, height: h, fixed } = R;
  const col = colorize(R, latDeg), rgb = new Uint8Array(W * H * 3), L = [-0.55, 0.55, 0.63];
  const lightLen = Math.hypot(...L);
  const at = (a, b) => h[Math.min(H - 1, Math.max(0, b)) * W + Math.min(W - 1, Math.max(0, a))];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (fixed[c] && h[c] <= 0) { for (let t = 0; t < 3; t++) rgb[c * 3 + t] = Math.max(0, Math.min(255, col[c * 3 + t])); continue; } // sea: unshaded
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx), gy = (at(i, j - 1) - at(i, j + 1)) / (2 * dx);
    const nx = -gx * exaggeration, ny = -gy * exaggeration, nl = Math.hypot(nx, ny, 1);
    const lam = (nx * L[0] + ny * L[1] + L[2]) / nl / lightLen;
    const shade = Math.max(0.18, 0.2 + 0.95 * lam);
    for (let t = 0; t < 3; t++) rgb[c * 3 + t] = Math.max(0, Math.min(255, col[c * 3 + t] * shade));
  }
  if (box) { // marks the next level
    const [x0, y0, x1, y1] = box;
    for (let i = x0; i <= x1; i++) for (const j of [y0, y1]) for (let t = 0; t < 3; t++) { rgb[(j * W + i) * 3 + t] = 255; }
    for (let j = y0; j <= y1; j++) for (const i of [x0, x1]) for (let t = 0; t < 3; t++) { rgb[(j * W + i) * 3 + t] = 255; }
  }
  writePng(join(outDir, name), W, H, rgb);
}

runLadder(P, { tag, center, log, onLevel(R, L, k, { box }) {
  render(R, `ladder-${tag}-${site}-${L.name}.png`, { exaggeration: L.ex, box });
  let hmin = Infinity, hmax = -Infinity; for (const v of R.height) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
  log(`${L.name}: ${L.sizeM / 1000} km, dx ${R.dx.toFixed(2)} m, height ${hmin.toFixed(1)}..${hmax.toFixed(1)} m`);
} });
