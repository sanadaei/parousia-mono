// Ground props: boulder, scree, fence, stone wall, signpost.
// Metres, Y up, origin at ground centre, front +Z. Vertex colours only (ART_DIRECTION.md).
// make(seed, p) -> Mesh at LOD0 (within the triangle budget), lod1(seed, p) -> Mesh at about 1/8 of that.

import { Mesh, box, sphere, noisy, rng, mat, mixColor, rgb } from './mesh.mjs';

const GRANITE = '#8c857b';
const GRANITE_DARK = '#5e5a55';
const STONE = '#9a9284';
const STONE_LIGHT = '#d8cdb8';
const TIMBER = '#6b4a2e';
const BARK = '#5a4632';

const withDefaults = (defaults, p = {}) => ({ ...defaults, ...p });

// Per-object brightness variation of +-8% (ART_DIRECTION: same kind, different individuals).
function vary(hex, r) {
  const k = 1 + (r() - 0.5) * 0.16;
  return rgb(hex).map((v) => Math.min(1, v * k));
}

function yRange(m) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < m.pos.length; i += 3) { lo = Math.min(lo, m.pos[i]); hi = Math.max(hi, m.pos[i]); }
  return [lo, hi];
}

// Darken toward the bottom (cheap AO): factor `low` at y0, 1 at y1.
function groundAO(m, y0, y1, low) {
  const span = Math.max(1e-6, y1 - y0);
  return m.tint((x, y) => low + (1 - low) * Math.min(1, Math.max(0, (y - y0) / span)));
}

// One rock: icosphere (sub `sub`), squashed (y 0.6-0.8, z 0.8-1.2 of x), roughened by noise,
// sunk so that min.y = -0.15 * size. Granite colour, darker toward the bottom.
function rock(seed, size, sub) {
  const r = rng(`${seed}:rock`);
  const sy = 0.6 + 0.2 * r(), sz = 0.8 + 0.4 * r();
  const tone = r() * 0.5; // 0 = light granite, 0.5 = dark granite
  const base = sphere(size / 2, sub, mixColor(GRANITE, GRANITE_DARK, tone));
  const m = new Mesh().add(base, mat.scale(1, sy, sz));
  noisy(m, `${seed}:rock`, 0.18 * size, 0.9 / size);
  const [lo, hi] = yRange(m);
  const dy = -0.15 * size - lo;
  m.deform((x, y, z) => [x, y + dy, z]);
  return groundAO(m, -0.15 * size, hi + dy, 0.65);
}

// `count` small rocks scattered in a disc of radius `spread`, each `size` on average.
function scatter(seed, p, count, sub) {
  const r = rng(`${seed}:scree`), out = new Mesh();
  for (let i = 0; i < count; i++) {
    const a = r() * 2 * Math.PI, d = p.spread * Math.sqrt(r());
    const size = p.size * (0.5 + r());
    out.add(rock(`${seed}:${i}`, size, sub), mat.translate(d * Math.cos(a), 0, d * Math.sin(a)));
  }
  return out;
}

// Wooden post-and-rail fence along +X from x=0 to x=length.
function fence(seed, p, lod) {
  const L = p.length, r = rng(`${seed}:fence`), m = new Mesh();
  if (lod) return m.add(box(L, 1.1, 0.14, vary(TIMBER, r)), mat.translate(L / 2, 0, 0));
  const xs = [];
  for (let x = 0; x < L - 1e-6; x += 2) xs.push(x); // a post every 2 m
  xs.push(L);
  for (const x of xs) {
    const lean = (r() - 0.5) * 0.06, lean2 = (r() - 0.5) * 0.06;
    m.add(box(0.12, 1.2, 0.12, vary(TIMBER, r)), mat.chain(mat.translate(x, 0, 0), mat.rotZ(lean), mat.rotX(lean2)));
  }
  for (const y of [0.35, 0.85]) m.add(box(L, 0.1, 0.06, vary(TIMBER, r)), mat.translate(L / 2, y, 0));
  return groundAO(m, 0, 1.2, 0.7);
}

// Dry-stone wall along +X from x=0 to x=length: courses of irregular stones with a taper,
// a row of coping stones on top, then noise roughening.
function stonewall(seed, p, lod) {
  const L = p.length, H = p.height, r = rng(`${seed}:wall`), m = new Mesh();
  if (lod) return m.add(box(L, H, 0.66, vary(STONE, r)), mat.translate(L / 2, 0, 0));
  const bodyH = H - 0.1;
  const nC = Math.max(2, Math.round(bodyH / 0.25)), ch = bodyH / nC;
  for (let c = 0; c < nC; c++) {
    const d = 0.72 - 0.16 * (c / (nC - 1)); // base 0.72 m, top 0.56 m
    let x = 0;
    while (x < L - 1e-6) {
      let w = 0.45 + 0.4 * r();
      if (L - x - w < 0.25) w = L - x; // no sliver at the end
      const dz = (r() - 0.5) * 0.04;
      m.add(box(w, ch * 0.94, d * (0.9 + 0.2 * r()), vary(STONE, r)), mat.translate(x + w / 2, c * ch + ch * 0.03, dz));
      x += w;
    }
  }
  let x = 0;
  const coping = mixColor(STONE, STONE_LIGHT, 0.2);
  while (x < L - 1e-6) {
    let w = 0.4 + 0.3 * r();
    if (L - x - w < 0.2) w = L - x;
    m.add(box(w, 0.1, 0.7 * (0.95 + 0.1 * r()), vary(coping, r)), mat.translate(x + w / 2, bodyH, 0));
    x += w;
  }
  noisy(m, `${seed}:wall`, 0.06, 3.0, 2);
  return groundAO(m, 0, H, 0.7);
}

// Signpost: 2.2 m post with two arm boards.
function signpost(seed, p, lod) {
  const r = rng(`${seed}:sign`), m = new Mesh();
  const bark = vary(BARK, r);
  if (lod) return m.add(box(0.12, 2.2, 0.12, bark));
  const wood = vary(TIMBER, r);
  m.add(box(0.12, 2.2, 0.12, bark));
  const a1 = (r() - 0.5) * 0.3, a2 = (r() - 0.5) * 0.3;
  m.add(box(0.7, 0.16, 0.03, wood), mat.chain(mat.translate(0.41, 1.75, 0), mat.rotY(a1)));
  m.add(box(0.6, 0.16, 0.03, wood), mat.chain(mat.translate(-0.36, 1.95, 0), mat.rotY(a2)));
  return groundAO(m, 0, 2.2, 0.7);
}

export const PROPS = {
  boulder: {
    desc: '花崗岩の転石。球を潰して粗く崩し、地面に半ば埋める。',
    defaults: { size: 2 },
    make: (seed, p) => rock(seed, withDefaults(PROPS.boulder.defaults, p).size, 2),
    lod1: (seed, p) => rock(seed, withDefaults(PROPS.boulder.defaults, p).size, 0),
  },
  scree: {
    desc: '小さな転石の散乱（崖下の岩屑）。',
    defaults: { size: 0.4, count: 12, spread: 3 },
    make: (seed, p) => { const P = withDefaults(PROPS.scree.defaults, p); return scatter(seed, P, P.count, 1); },
    lod1: (seed, p) => { const P = withDefaults(PROPS.scree.defaults, p); return scatter(seed, P, Math.max(1, Math.floor(P.count / 2)), 0); },
  },
  fence: {
    desc: '木製の杭と横木の柵（+X方向、x=0からlength）。',
    defaults: { length: 6 },
    make: (seed, p) => fence(seed, withDefaults(PROPS.fence.defaults, p), false),
    lod1: (seed, p) => fence(seed, withDefaults(PROPS.fence.defaults, p), true),
  },
  stonewall: {
    desc: '空石積みの石垣（+X方向、x=0からlength）と笠石。',
    defaults: { length: 6, height: 1.1 },
    make: (seed, p) => stonewall(seed, withDefaults(PROPS.stonewall.defaults, p), false),
    lod1: (seed, p) => stonewall(seed, withDefaults(PROPS.stonewall.defaults, p), true),
  },
  signpost: {
    desc: '道標。2.2 mの柱と二枚の腕板。',
    defaults: {},
    make: (seed, p) => signpost(seed, withDefaults(PROPS.signpost.defaults, p), false),
    lod1: (seed, p) => signpost(seed, withDefaults(PROPS.signpost.defaults, p), true),
  },
};
