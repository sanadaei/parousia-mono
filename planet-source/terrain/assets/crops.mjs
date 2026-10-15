// Field crops: wheat canopy, vegetable beds, vineyard, haystack, round hay bales.
// Metres, Y up, origin at ground centre, front +Z. Vertex colours only (ART_DIRECTION.md).
// Crops tile over x, z in [0, size]; spacings divide size exactly so repeats join.
// make(seed, p) -> Mesh at LOD0 (within the triangle budget); lod1(seed, p) -> Mesh at about 1/8 of that.

import { Mesh, box, sphere, cylinder, noisy, rng, mat, mixColor, rgb } from './mesh.mjs';
import { createSimplex3 } from '../src/noise.mjs';

const WHEAT_LO = '#7a8540';   // ripe 0
const WHEAT_HI = '#9a8452';   // ripe 1, straw gold (muted: ripe wheat albedo is only ~0.3)
const SOIL_FURROW = '#5e4e3c';
const SOIL_RIDGE = '#6a5a46';
const LEAF = '#4f6b2f';
const CANOPY = '#4b6430';
const TIMBER = '#6b4a2e';
const THATCH = '#9a8150';
const BALE = '#a8935a';

const WHEAT_TOP = 0.9, WHEAT_FURROW = 0.12, WHEAT_WAVE = 0.08, WHEAT_DX = 1, WHEAT_DZ = 0.25; // grid: furrows on every other row of vertices (0.5 m rows)
const VEG_ROW = 0.75;        // m between bed rows
const VEG_PLANTS = 22;       // plants per row (6-triangle leaf shape)
const VINE_ROW = 2.2;        // m between vine rows (rounded to a divisor of size)
const VINE_POST = 4;         // m between posts along a row
const VINE_Y0 = 0.6, VINE_Y1 = 1.5, VINE_HW = 0.25;
const HAY_R = 1.8, HAY_H = 2, HAY_DOME = 1.08;
const BALE_R = 0.75, BALE_L = 1.2;

const withDefaults = (defaults, p = {}) => ({ ...defaults, ...p });
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Brightness variation around a colour (same kind, different individuals; ART_DIRECTION +-8%).
function vary(col, r, amt = 0.16) {
  const k = 1 + (r() - 0.5) * amt;
  return rgb(col).map((v) => clamp01(v * k));
}

// Append points with one colour, normals filled later by recomputeNormals. Returns the first index.
function addVerts(m, pts, col) {
  const base = m.vertexCount;
  for (const [x, y, z] of pts) { m.pos.push(x, y, z); m.nrm.push(0, 1, 0); m.col.push(col[0], col[1], col[2]); }
  return base;
}

// Flat triangles oriented so each normal points away from `centre` (closed shapes).
function outwardTris(m, tris, centre, col) {
  const out = tris.map(([a, b, c]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const g = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    return nx * g[0] + ny * g[1] + nz * g[2] < 0 ? [a, c, b] : [a, b, c];
  });
  return m.flatTris(out, col);
}

// Surface of revolution about +Y. profile: [r, y] from bottom to top; a last point with r = 0 is an apex (fan).
function lathe(prof, seg, col) {
  const m = new Mesh();
  const last = prof[prof.length - 1], apex = last[0] === 0;
  const rings = apex ? prof.slice(0, -1) : prof;
  const pts = [];
  for (const [r, y] of rings) for (let k = 0; k < seg; k++) { const f = 2 * Math.PI * k / seg; pts.push([r * Math.cos(f), y, r * Math.sin(f)]); }
  const base = addVerts(m, pts, col);
  const v = (j, k) => base + j * seg + (k % seg);
  const apexIdx = apex ? addVerts(m, [[0, last[1], 0]], col) : -1;
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < seg; k++) {
    const a = v(j, k), b = v(j, k + 1), c = v(j + 1, k), d = v(j + 1, k + 1);
    m.idx.push(a, c, b, b, c, d);
  }
  if (apex) { const J = rings.length - 1; for (let k = 0; k < seg; k++) m.idx.push(v(J, k), apexIdx, v(J, k + 1)); }
  return m.recomputeNormals();
}

// ---------- wheat: one continuous canopy over the tile with furrow dips, wavy top and skirt walls
function wheatHeight(noise, size, x, z, j) {
  const taper = Math.sin(Math.PI * x / size) * Math.sin(Math.PI * z / size); // undulation fades to 0 at the tile edges
  const wave = WHEAT_WAVE * taper * noise(x * 0.35, 0.5, z * 0.35);
  return WHEAT_TOP + wave - (j % 2 === 0 ? WHEAT_FURROW : 0); // even grid rows are furrow lines (every 0.5 m)
}

function wheat(seed, P, lod) {
  const size = P.size, ripe = clamp01(P.ripe), col = mixColor(WHEAT_LO, WHEAT_HI, ripe);
  if (lod) return new Mesh().add(box(size, 0.85, size, col), mat.translate(size / 2, 0, size / 2));
  const noise = createSimplex3(`${seed}:wheat`), patch = createSimplex3(`${seed}:wheat-patch`);
  const nx = Math.max(1, Math.round(size / WHEAT_DX)), nz = 2 * Math.max(1, Math.round(size / (2 * WHEAT_DZ)));
  const dx = size / nx, dz = size / nz;
  const H = (i, j) => wheatHeight(noise, size, i * dx, j * dz, j);
  const top = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) top.push([i * dx, H(i, j), j * dz]);
  const m = new Mesh(), base = addVerts(m, top, col);
  const v = (i, j) => base + j * (nx + 1) + i;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j), d = v(i + 1, j + 1);
    m.idx.push(a, b, c, c, b, d);
  }
  m.recomputeNormals();
  // Skirt walls down to y = 0 around the four tile edges. Each edge: top-row points, outward horizontal normal.
  const edgePts = (fixed, axis) => {
    const n = axis === 'x' ? nx : nz, p = [];
    for (let t = 0; t <= n; t++) p.push(axis === 'x' ? top[v(t, fixed)] : top[v(fixed, t)]);
    return p;
  };
  const sides = [
    [edgePts(0, 'x'), [0, 0, -1]], [edgePts(nz, 'x'), [0, 0, 1]],
    [edgePts(0, 'z'), [-1, 0, 0]], [edgePts(nx, 'z'), [1, 0, 0]],
  ];
  const walls = [];
  for (const [pts, out] of sides) {
    for (let k = 0; k < pts.length - 1; k++) {
      const T0 = pts[k], T1 = pts[k + 1], B0 = [T0[0], 0, T0[2]], B1 = [T1[0], 0, T1[2]];
      for (const [a, b, c] of [[T0, B0, B1], [T0, B1, T1]]) {
        // Horizontal normal of a wall triangle; flip it if it faces inward.
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const dot = (uy * vz - uz * vy) * out[0] + (ux * vy - uy * vx) * out[2];
        walls.push(dot < 0 ? [a, c, b] : [a, b, c]);
      }
    }
  }
  m.flatTris(walls, col);
  // Light: darker toward the ground, then a slow +-8 % brightness patch field across the tile.
  return m.tint((x, y, z) => (0.6 + 0.4 * clamp01(y / WHEAT_TOP)) * (1 + 0.08 * patch(x * 0.12, 0.7, z * 0.12)));
}

// ---------- vegetables
// Leaf: a triangular bipyramid (6 triangles), randomly turned; outward-oriented.
function leaf(m, cx, cy, cz, w, up, down, rot, col) {
  const top = [cx, cy + up, cz], bot = [cx, cy - down, cz];
  const eq = [0, 1, 2].map((i) => { const a = rot + i * 2 * Math.PI / 3; return [cx + w * Math.cos(a), cy, cz + w * Math.sin(a)]; });
  const tris = [];
  for (let i = 0; i < 3; i++) { const p = eq[i], q = eq[(i + 1) % 3]; tris.push([top, p, q], [bot, q, p]); }
  outwardTris(m, tris, [cx, cy, cz], col);
}

function vegetables(seed, P, lod) {
  const size = P.size, m = new Mesh();
  if (lod) return m.add(box(size, 0.3, size, mixColor(LEAF, SOIL_RIDGE, 0.35)), mat.translate(size / 2, 0, size / 2));
  const r = rng(`${seed}:veg`), n = Math.max(1, Math.round(size / VEG_ROW)), sp = size / n, cell = size / VEG_PLANTS;
  m.add(box(size, 0.01, size, SOIL_FURROW), mat.translate(size / 2, 0, size / 2)); // furrow ground under the beds
  for (let i = 0; i < n; i++) {
    const zc = (i + 0.5) * sp;
    m.add(box(size, 0.2, 0.45, vary(SOIL_RIDGE, r, 0.08)), mat.translate(size / 2, 0, zc)); // ridge
    for (let j = 0; j < VEG_PLANTS; j++) {
      const x = (j + 0.5) * cell + (r() - 0.5) * cell * 0.4, z = zc + (r() - 0.5) * 0.16, k = 0.9 + 0.2 * r();
      leaf(m, x, 0.24, z, 0.16 * k, 0.13 * k, 0.07 * k, r() * 2 * Math.PI, vary(LEAF, r, 0.2));
    }
  }
  return m;
}

// ---------- vineyard
// One continuous hedge-like canopy along +X from 0 to len: a rounded section swept along the row with
// gently varying width, so noise displaces shared vertices (no cracks). The ends are capped.
function hedge(seed, len, col, pstep) {
  const NL = 12, NS = 16, yc = (VINE_Y0 + VINE_Y1) / 2, hh = (VINE_Y1 - VINE_Y0) / 2, hw = VINE_HW;
  const sq = (v) => Math.sign(v) * Math.sqrt(Math.abs(v)); // superellipse exponent 4: rounded corners
  const r = rng(`${seed}:hedge`), p1 = 6.28 * r(), p2 = 6.28 * r();
  const pts = [];
  for (let i = 0; i <= NS; i++) {
    const x = len * i / NS, s = 1 + 0.1 * Math.sin(x * 0.9 + p1) + 0.06 * Math.sin(x * 2.3 + p2); // irregular section
    for (let k = 0; k < NL; k++) {
      const t = 2 * Math.PI * k / NL;
      pts.push([x, yc + hh * s * sq(Math.sin(t)), hw * s * sq(Math.cos(t))]);
    }
  }
  pts.push([0, yc, 0], [len, yc, 0]); // cap centres
  const m = new Mesh(), base = addVerts(m, pts, col);
  const C0 = base + (NS + 1) * NL, CN = C0 + 1;
  const v = (i, k) => base + i * NL + (k % NL);
  for (let i = 0; i < NS; i++) for (let k = 0; k < NL; k++) {
    const a = v(i, k), b = v(i, k + 1), c = v(i + 1, k), d = v(i + 1, k + 1);
    m.idx.push(a, c, b, b, c, d);
  }
  for (let k = 0; k < NL; k++) { m.idx.push(C0, v(0, k), v(0, k + 1)); m.idx.push(CN, v(NS, k + 1), v(NS, k)); }
  m.recomputeNormals();
  noisy(m, `${seed}:hedge-noise`, 0.16, 1.1, 3);
  // Slight sag between posts (zero at each post, 0.06 m midway), strongest on top.
  m.deform((x, y, z) => {
    const sag = 0.06 * Math.sin(Math.PI * (x / pstep - 0.5)) ** 2, wy = clamp01((y - VINE_Y0) / (VINE_Y1 - VINE_Y0));
    return [Math.min(len, Math.max(0, x)), y - sag * wy, z]; // keep the ends on the tile edges
  });
  return m.tint((x, y) => 0.6 + 0.4 * clamp01((y - VINE_Y0) / (VINE_Y1 - VINE_Y0))); // darker underneath
}

function vineyard(seed, P, lod) {
  const size = P.size, m = new Mesh();
  if (lod) return m.add(box(size, VINE_Y1, size, mixColor(CANOPY, SOIL_RIDGE, 0.2)), mat.translate(size / 2, 0, size / 2));
  const r = rng(`${seed}:vine`), n = Math.max(1, Math.round(size / VINE_ROW)), sp = size / n;
  const posts = Math.max(1, Math.round(size / VINE_POST)), pstep = size / posts;
  for (let i = 0; i < n; i++) {
    const zc = (i + 0.5) * sp;
    m.add(hedge(`${seed}:${i}`, size, vary(CANOPY, r, 0.16), pstep), mat.translate(0, 0, zc));
    for (let k = 0; k < posts; k++) m.add(box(0.08, 1.6, 0.08, vary(TIMBER, r)), mat.translate((k + 0.5) * pstep, 0, zc));
  }
  return m;
}

// ---------- haystack: a cylinder of radius 1.8 and height 2 with a dome cap (half-ellipsoid, 1.08 high)
function haystack(seed, lod) {
  const steps = lod ? 2 : 6, prof = [[HAY_R, 0], [HAY_R, HAY_H]];
  for (let i = 1; i < steps; i++) { const f = i / steps * Math.PI / 2; prof.push([HAY_R * Math.cos(f), HAY_H + HAY_DOME * Math.sin(f)]); }
  prof.push([0, HAY_H + HAY_DOME]);
  const r = rng(`${seed}:hay`), m = lathe(prof, lod ? 8 : 16, vary(THATCH, r, 0.12));
  noisy(m, `${seed}:hay`, 0.08, 1.1, 3);
  return m.tint((x, y) => 0.7 + 0.3 * clamp01(y / (HAY_H + HAY_DOME)));
}

// ---------- hay bales: lying on their side (axis along X), scattered over a 10 m square
function bales(seed, P, lod) {
  const n = Math.max(0, Math.round(P.count)), r = rng(`${seed}:bales`), m = new Mesh(), placed = [];
  for (let tries = 0; placed.length < n && tries < 200 * Math.max(1, n); tries++) {
    const x = 1 + 10 * r(), z = 1 + 10 * r();
    if (placed.some(([a, b]) => Math.hypot(a - x, b - z) < 1.8)) continue;
    placed.push([x, z]);
    const yaw = r() * Math.PI, col = vary(BALE, r);
    // Cylinder axis is Y over y 0..1.2; rotZ(90) lays it on X and centres it after the +0.6 shift.
    m.add(cylinder(BALE_R, BALE_R, BALE_L, lod ? 6 : 16, col, { caps: !lod }),
      mat.chain(mat.translate(x, BALE_R, z), mat.rotY(yaw), mat.translate(BALE_L / 2, 0, 0), mat.rotZ(Math.PI / 2)));
  }
  return m.tint((x, y) => 0.7 + 0.3 * clamp01(y / (2 * BALE_R)));
}

export const CROPS = {
  wheat: {
    desc: '穀物（小麦）。一続きの樹冠状の面に、0.5 m間隔の浅い畝溝、緩やかな波、タイル縁の垂直な側壁。ripe 0 で緑、1 で麦藁色。',
    defaults: { size: 12, ripe: 0.8 },
    make: (seed, p) => wheat(seed, withDefaults(CROPS.wheat.defaults, p), false),
    lod1: (seed, p) => wheat(seed, withDefaults(CROPS.wheat.defaults, p), true),
  },
  vegetables: {
    desc: '野菜畑。0.75 m間隔の土の畝（茶色の長い箱）に、三角両錐の葉の茂みを並べる。',
    defaults: { size: 12 },
    make: (seed, p) => vegetables(seed, withDefaults(CROPS.vegetables.defaults, p), false),
    lod1: (seed, p) => vegetables(seed, withDefaults(CROPS.vegetables.defaults, p), true),
  },
  vineyard: {
    desc: 'ブドウ畑。列の間隔は2.4 m（タイルが継ぎ目なく繋がる間隔に調整）。4 m間隔の木の支柱と、ノイズで崩した連続した生垣状の樹冠。',
    defaults: { size: 12 },
    make: (seed, p) => vineyard(seed, withDefaults(CROPS.vineyard.defaults, p), false),
    lod1: (seed, p) => vineyard(seed, withDefaults(CROPS.vineyard.defaults, p), true),
  },
  haystack: {
    desc: '干し草の堆積。半径1.8 m、高さ2 mの円柱に半楕円のドーム屋根を載せ、ノイズで表面を崩す。',
    defaults: {},
    make: (seed) => haystack(seed, false),
    lod1: (seed) => haystack(seed, true),
  },
  hay_bales: {
    desc: '円筒形の干し草ロール（横倒し、直径1.5 m、長さ1.2 m）を約10 m四方に散らす。',
    defaults: { count: 5 },
    make: (seed, p) => bales(seed, withDefaults(CROPS.hay_bales.defaults, p), false),
    lod1: (seed, p) => bales(seed, withDefaults(CROPS.hay_bales.defaults, p), true),
  },
};
