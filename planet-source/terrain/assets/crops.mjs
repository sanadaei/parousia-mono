// Field crops: wheat rows, vegetable beds, vineyard, haystack, round hay bales.
// Metres, Y up, origin at ground centre, front +Z. Vertex colours only (ART_DIRECTION.md).
// Row crops run along +X and tile over x, z in [0, size]; the row spacing divides size exactly so repeats join.
// make(seed, p) -> Mesh at LOD0 (within the triangle budget); lod1(seed, p) -> Mesh at about 1/8 of that.

import { Mesh, box, sphere, cylinder, extrude, noisy, rng, mat, mixColor, rgb } from './mesh.mjs';

const WHEAT_GREEN = '#7d8a3c';
const WHEAT_GOLD = '#c2a55c';
const SOIL = '#7d6a52';
const LEAF = '#4f6b2f';
const CANOPY = '#56702f';
const TIMBER = '#6b4a2e';
const THATCH = '#9a8150';
const BALE = '#a8935a';

const WHEAT_ROW = 0.5;       // m between rows
const WHEAT_SEG = 6;         // height-jittered blade segments per row (along X)
const VEG_ROW = 0.75;        // m between bed rows
const VEG_PLANTS = 7;        // plants per row
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

// ---------- wheat
const wheatColor = (ripe) => mixColor(WHEAT_GREEN, WHEAT_GOLD, clamp01(ripe));

function wheat(seed, P, lod) {
  const size = P.size, ripe = clamp01(P.ripe), m = new Mesh();
  if (lod) return m.add(box(size, 0.85, size, wheatColor(ripe)), mat.translate(size / 2, 0, size / 2));
  const r = rng(`${seed}:wheat`), n = Math.max(1, Math.round(size / WHEAT_ROW)), sp = size / n, L = size / WHEAT_SEG;
  for (let i = 0; i < n; i++) {
    const zc = (i + 0.5) * sp;
    const col = vary(mixColor(WHEAT_GREEN, WHEAT_GOLD, clamp01(ripe + (r() - 0.5) * 0.2)), r, 0.1); // per-row ripeness and tone
    for (let s = 0; s < WHEAT_SEG; s++) {
      const H = 0.9 * (0.8 + 0.4 * r()), w = 0.125 * (0.9 + 0.2 * r()); // jittered top, ~0.25 m wide
      // extrude() lays the triangle in (x, z) with height along Y; rotZ(-90) turns that Y into +X and
      // the profile's x into -Y, so the apex (x = -H) ends up at height H.
      const blade = extrude([[-H, 0], [0, -w], [0, w]], L, col, { top: true, bottom: true });
      m.add(blade, mat.chain(mat.translate(s * L, 0, zc), mat.rotZ(-Math.PI / 2)));
    }
  }
  return m;
}

// ---------- vegetables
function vegetables(seed, P, lod) {
  const size = P.size, m = new Mesh();
  if (lod) return m.add(box(size, 0.3, size, mixColor(LEAF, SOIL, 0.35)), mat.translate(size / 2, 0, size / 2));
  const r = rng(`${seed}:veg`), n = Math.max(1, Math.round(size / VEG_ROW)), sp = size / n, cell = size / VEG_PLANTS;
  for (let i = 0; i < n; i++) {
    const zc = (i + 0.5) * sp;
    m.add(box(size, 0.2, 0.45, vary(SOIL, r)), mat.translate(size / 2, 0, zc)); // soil ridge
    for (let j = 0; j < VEG_PLANTS; j++) {
      const x = (j + 0.5) * cell + (r() - 0.5) * cell * 0.4, z = zc + (r() - 0.5) * 0.16, k = 0.9 + 0.3 * r();
      m.add(sphere(0.18, 0, vary(LEAF, r)), mat.chain(mat.translate(x, 0.2, z), mat.scale(k, 0.6 * k, k)));
    }
  }
  return m;
}

// ---------- vineyard
// One continuous hedge-like canopy along +X from 0 to len: a rounded-rectangle section swept along the
// row, so noise displaces shared vertices (no cracks) and the ends are capped.
function hedge(seed, len, col) {
  const NL = 10, NS = 16, yc = (VINE_Y0 + VINE_Y1) / 2, hh = (VINE_Y1 - VINE_Y0) / 2, hw = VINE_HW;
  const sq = (v) => Math.sign(v) * Math.sqrt(Math.abs(v)); // superellipse exponent 4: rounded corners
  const pts = [];
  for (let i = 0; i <= NS; i++) for (let k = 0; k < NL; k++) {
    const t = 2 * Math.PI * k / NL;
    pts.push([len * i / NS, yc + hh * sq(Math.sin(t)), hw * sq(Math.cos(t))]);
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
  noisy(m, `${seed}:hedge`, 0.1, 0.9, 3);
  m.deform((x, y, z) => [Math.min(len, Math.max(0, x)), y, z]); // keep the ends on the tile edges
  return m.tint((x, y) => 0.6 + 0.4 * clamp01((y - VINE_Y0) / (VINE_Y1 - VINE_Y0)));
}

function vineyard(seed, P, lod) {
  const size = P.size, m = new Mesh();
  if (lod) return m.add(box(size, VINE_Y1, size, mixColor(CANOPY, SOIL, 0.2)), mat.translate(size / 2, 0, size / 2));
  const r = rng(`${seed}:vine`), n = Math.max(1, Math.round(size / VINE_ROW)), sp = size / n;
  const posts = Math.max(1, Math.round(size / VINE_POST)), pstep = size / posts;
  for (let i = 0; i < n; i++) {
    const zc = (i + 0.5) * sp;
    m.add(hedge(`${seed}:${i}`, size, vary(CANOPY, r)), mat.translate(0, 0, zc));
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
    desc: '穀物（小麦）。0.5 m間隔の列（+X方向）に、三角断面の低い細長い角柱を並べ、頂部の高さをずらす。ripe 0 で緑、1 で黄金色。',
    defaults: { size: 12, ripe: 1 },
    make: (seed, p) => wheat(seed, withDefaults(CROPS.wheat.defaults, p), false),
    lod1: (seed, p) => wheat(seed, withDefaults(CROPS.wheat.defaults, p), true),
  },
  vegetables: {
    desc: '野菜畑。0.75 m間隔の土の畝（茶色の長い箱）に、葉の茂みを模した低い扁平球を並べる。',
    defaults: { size: 12 },
    make: (seed, p) => vegetables(seed, withDefaults(CROPS.vegetables.defaults, p), false),
    lod1: (seed, p) => vegetables(seed, withDefaults(CROPS.vegetables.defaults, p), true),
  },
  vineyard: {
    desc: 'ブドウ畑。列の間隔は2.2 m前後（タイルが継ぎ目なく繋がる間隔に調整）。4 m間隔の木の支柱と、ノイズで崩した連続した生垣状の樹冠。',
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
