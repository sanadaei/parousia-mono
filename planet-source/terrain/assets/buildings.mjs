// Procedural buildings and bridges. Pure (seed, params) -> Mesh; vertex colours only.
// Metres, Y up, origin at ground centre of the footprint, main entrance faces +Z.
// Uses only the mesh.mjs builder API.

import { Mesh, box, cylinder, mat, rng, mixColor, rgb } from './mesh.mjs';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const GLASS = '#252b33';
const hash3 = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
const vary = (c, amt = 0.05) => {
  const b = rgb(c);
  return (p) => { const k = 1 + (hash3(p[0], p[1], p[2]) * 2 - 1) * amt; return [clamp(b[0] * k, 0, 1), clamp(b[1] * k, 0, 1), clamp(b[2] * k, 0, 1)]; };
};
const shade = (c, k) => rgb(c).map((v) => clamp(v * k, 0, 1));
function jitter(rnd) {
  const k = 1 + (rnd() * 2 - 1) * 0.08, h = [1 + (rnd() - 0.5) * 0.05, 1, 1 + (rnd() - 0.5) * 0.05];
  return (c) => rgb(c).map((v, i) => clamp(v * k * h[i], 0, 1));
}

// ---------- palettes
function pick(style, rnd) {
  const J = jitter(rnd), roll = rnd();
  const base = { glass: GLASS, shut: null, hip: false, frame: 'quoin', lodTrim: 0.04 };
  switch (style) {
    case 'stone': return { ...base, wall: J('#9a9284'), trim: J('#b3ab9b'), plinth: J('#7c766a'), roof: J('#4b5056'), pitch: 33 + roll * 8, win: [0.85, 1.15], chim: J('#8a8274'), door: J('#4e3b2a'), barn: J('#9a9284') };
    case 'mediterranean': {
      const wall = J(['#e6dcc4', '#dccfae', '#d9c3a0'][Math.floor(roll * 2.999)]);
      return { ...base, wall, trim: J('#efe8d8'), plinth: J('#b9ad98'), roof: J('#94604a'), pitch: 20 + rnd() * 5, hip: true, win: [0.7, 1.0], frame: 'none', shut: J(['#5d7266', '#4f6579', '#7a4f3a'][Math.floor(rnd() * 2.999)]), chim: J('#c9b99a'), door: J('#5b4630'), barn: wall };
    }
    case 'nordic': {
      const wall = roll < 0.65 ? J('#7a3b2e') : J('#5e432c');
      return { ...base, wall, trim: J('#d8d2c4'), plinth: J('#6e6a62'), roof: rnd() < 0.5 ? J('#3b3a38') : J('#4f5a34'), pitch: 44 + rnd() * 6, win: [0.8, 1.1], chim: J('#6a5a50'), door: J('#3f3328'), barn: wall };
    }
    default: return { ...base, wall: J('#d8cdb8'), trim: J('#6b4a2e'), plinth: J('#8d867a'), roof: roll < 0.5 ? J('#4b5056') : J('#94604a'), pitch: 36 + rnd() * 8, win: [0.9, 1.2], frame: 'frame', lodTrim: 0.14, chim: J('#8a5a46'), door: J('#5a3a24'), barn: J('#86694a') };
  }
}

// ---------- mesh helpers
function dropFaces(m, faces) { // box faces: 0 +z, 1 -z, 2 +x, 3 -x, 4 top, 5 bottom
  const o = new Mesh();
  for (let t = 0; t < m.idx.length; t += 3) {
    if (faces.includes((t / 3) >> 1)) continue;
    const base = o.vertexCount;
    for (let k = 0; k < 3; k++) { const i = m.idx[t + k] * 3; o.pos.push(m.pos[i], m.pos[i + 1], m.pos[i + 2]); o.nrm.push(m.nrm[i], m.nrm[i + 1], m.nrm[i + 2]); o.col.push(m.col[i], m.col[i + 1], m.col[i + 2]); o.idx.push(base + k); }
  }
  return o;
}
const panel = (w, h, t, col, lite = true) => dropFaces(box(w, h, t, col), lite ? [1, 4, 5] : [1, 5]);
const FACE = (W, D) => ({
  front: { a: 0, len: W, dist: D / 2 }, back: { a: Math.PI, len: W, dist: D / 2 },
  right: { a: Math.PI / 2, len: D, dist: W / 2 }, left: { a: -Math.PI / 2, len: D, dist: W / 2 },
});
/** Thin panel mounted on a wall face; t = thickness, protrudes t-0.01 from the wall. */
function put(m, f, u, y, w, h, t, col, lite = true) {
  m.add(panel(w, h, t, col, lite), mat.chain(mat.rotY(f.a), mat.translate(u, y, f.dist + t / 2 - 0.01)));
}
function putTri(m, f, u, y, w, hh, col, front) {
  m.add(new Mesh().flatTris([[[-w / 2, 0, 0], [w / 2, 0, 0], [0, hh, 0]]], col), mat.chain(mat.rotY(f.a), mat.translate(u, y, f.dist + front)));
}
const ao = (H) => (x, y) => {
  let k = 1;
  if (y < 0.5) k *= 0.66 + 0.34 * clamp(y / 0.5, 0, 1);
  if (y > H - 0.45 && y <= H + 0.001) k *= 1 - 0.24 * clamp((y - (H - 0.45)) / 0.45, 0, 1);
  return k;
};

/** Walls as stacked boxes (plinth, wall, eave band) so AO gradients have vertices to live on. */
function wallBlock(W, D, H, pal, party = false) {
  const m = new Mesh(), sx = party ? 0 : 0.06, sz = 0.06;
  m.add(box(W + 2 * sx, 0.7, D + 2 * sz, vary(pal.plinth, 0.06)), mat.translate(0, -0.3, 0));
  m.add(box(W, H - 0.85, D, vary(pal.wall, 0.04)), mat.translate(0, 0.4, 0));
  m.add(box(W, 0.45, D, vary(pal.wall, 0.04)), mat.translate(0, H - 0.45, 0));
  return m;
}

/** Roof over a W (across ridge) by L (along ridge) footprint, y=0 at the wall top plane, ridge along x ('z' rotates it). */
function roofMesh({ ax = 'x', L, W, theta, oL, oW, hip = false, col, gcol = null, flat = false }) {
  const t = Math.tan(theta), rh = (W / 2) * t, d = oW * t, b = L / 2 + oL, a = W / 2 + oW;
  const c = flat ? col : vary(col, 0.05), m = new Mesh();
  if (hip) {
    const rx = Math.max(0, L / 2 - W / 2), r0 = [-rx, rh, 0], r1 = [rx, rh, 0];
    m.flatTris([[[-b, -d, a], [b, -d, a], r1]], c).flatTris([[[b, -d, -a], [-b, -d, -a], r0]], c)
      .flatTris([[[b, -d, a], [b, -d, -a], r1]], c).flatTris([[[-b, -d, -a], [-b, -d, a], r0]], c);
    if (rx > 1e-3) m.flatTris([[[-b, -d, a], r1, r0]], c).flatTris([[[b, -d, -a], r0, r1]], c);
  } else {
    m.flatTris([[[-b, -d, a], [b, -d, a], [b, rh, 0]], [[-b, -d, a], [b, rh, 0], [-b, rh, 0]],
      [[b, -d, -a], [-b, -d, -a], [-b, rh, 0]], [[b, -d, -a], [-b, rh, 0], [b, rh, 0]]], c);
    if (gcol) {
      const g = L / 2, h = W / 2;
      m.flatTris([[[g, 0, h], [g, 0, -h], [g, rh, 0]], [[-g, 0, -h], [-g, 0, h], [-g, rh, 0]]], gcol);
    }
  }
  return ax === 'z' ? new Mesh().add(m, mat.rotY(Math.PI / 2)) : m;
}

function chimney(m, x, z, y0, y1, w, col) {
  m.add(box(w, y1 - y0, w, vary(col, 0.06)), mat.translate(x, y0, z));
  m.add(box(w + 0.14, 0.12, w + 0.14, shade(col, 0.8)), mat.translate(x, y1, z));
  m.add(box(w * 0.5, 0.03, w * 0.5, '#2a2623'), mat.translate(x, y1 + 0.12, z));
}

function addWindow(m, f, u, y, w, h, pal) {
  const s = 0.07;
  put(m, f, u, y - s, w + 2 * s, h + 2 * s, 0.04, pal.trim);
  put(m, f, u, y, w, h, 0.07, pal.glass);
  if (pal.shut) {
    const sw = w * 0.5 - 0.02;
    for (const sg of [-1, 1]) put(m, f, u + sg * (w / 2 + s + sw / 2), y - s, sw, h + 2 * s, 0.05, pal.shut);
  }
}
function addDoor(m, f, u, y, w, h, pal, wood) {
  put(m, f, u, y, w + 0.22, h + 0.11, 0.05, pal.trim);
  put(m, f, u, y, w, h, 0.09, wood);
}
function layout(len, ww, gap, margin, avoid, rnd, skipP) {
  const n = Math.max(1, Math.round((len - 2 * margin + gap) / (ww + gap))), step = (len - 2 * margin) / n, out = [];
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + margin + step * (i + 0.5), r = rnd();
    if (avoid.some((a) => Math.abs(u - a.u) < (ww + a.w) / 2 + 0.35)) continue;
    if (skipP && r < skipP) continue;
    out.push(u);
  }
  return out;
}

function frameFace(m, f, W, D, H, floors, fh, opens, rnd, col) {
  const len = f.len;
  put(m, f, 0, 0.4, len, 0.16, 0.06, col);
  for (let i = 1; i < floors; i++) put(m, f, 0, 0.4 + i * fh - 0.12, len, 0.24, 0.08, col);
  put(m, f, 0, H - 0.2, len, 0.2, 0.07, col);
  const n = Math.max(2, Math.round(len / 1.8));
  for (let i = 0; i < floors; i++) {
    const y0 = 0.4 + i * fh + (i === 0 ? 0.16 : 0.12), y1 = 0.4 + (i + 1) * fh - (i === floors - 1 ? 0.2 : 0.12);
    const os = opens.filter((o) => o.floor === i);
    for (let k = 0; k < n; k++) {
      const u0 = -len / 2 + (len * k) / n, u1 = -len / 2 + (len * (k + 1)) / n;
      const hit = (a, b) => os.some((o) => o.u + o.w / 2 + 0.2 > a && o.u - o.w / 2 - 0.2 < b);
      const r = rnd(), dir = rnd() < 0.5 ? 1 : -1;
      if (k < n - 1 && !hit(u1 - 0.07, u1 + 0.07)) put(m, f, u1, y0, 0.13, y1 - y0, 0.07, col);
      if (!hit(u0, u1) && r < 0.45) {
        const dx = u1 - u0 - 0.25, dy = y1 - y0 - 0.15, ang = Math.atan2(dx, dy);
        const us = dir > 0 ? u0 + 0.12 : u1 - 0.12;
        m.add(panel(0.1, Math.hypot(dx, dy), 0.06, col), mat.chain(mat.rotY(f.a), mat.translate(us, y0 + 0.07, f.dist + 0.02), mat.rotZ(dir > 0 ? -ang : ang)));
      }
    }
  }
}
function corners(m, W, D, H, col, party, wd = 0.2) {
  const f = FACE(W, D), e = party ? 0 : 0.06;
  for (const sx of [-1, 1]) {
    for (const fn of ['front', 'back']) put(m, f[fn], sx * (W / 2 - wd / 2 + e / 2), 0.4, wd + e, H - 0.4, 0.07, col);
    if (!party) for (const fn of ['right', 'left']) put(m, f[fn], sx * (D / 2 - wd / 2), 0.4, wd, H - 0.4, 0.07, col);
  }
}
function quoins(m, W, D, H, col, party) {
  const f = FACE(W, D), ext = party ? 0 : 0.03;
  let j = 0;
  for (let y = 0.4; y < H - 0.8; y += 0.75, j++) {
    const hh = 0.7, wf = j % 2 ? 0.5 : 0.3, ws = j % 2 ? 0.3 : 0.5;
    for (const sx of [-1, 1]) {
      for (const fn of ['front', 'back']) put(m, f[fn], sx * (W / 2 - wf / 2 + ext), y, wf + 2 * ext, hh, 0.08, col);
      if (!party) for (const fn of ['right', 'left']) put(m, f[fn], sx * (D / 2 - ws / 2), y, ws, hh, 0.08, col);
    }
  }
}

// ---------- houses (cottage, farmhouse, townhouse)
const HOUSE = {
  cottage: { fh: [2.65, 2.9], oL: 0.25, oW: 0.4, pChim: 0.75, nChim: 1, gap: 1.3 },
  farmhouse: { fh: [2.9, 3.2], oL: 0.3, oW: 0.5, pChim: 1, nChim: 2, gap: 1.4, porch: 0.6 },
  townhouse: { fh: [2.9, 3.2], oL: 0.35, oW: 0, pChim: 0.6, nChim: 1, gap: 1.2, party: true, ridge: 'z' },
};

function buildHouse(kind, seed, p, lod) {
  const cfg = HOUSE[kind], rnd = rng(`${kind}|${seed}|${p.style}`), pal = pick(p.style, rnd);
  const party = !!cfg.party, ridgeZ = cfg.ridge === 'z';
  const W = p.width * (0.9 + 0.2 * rnd()), D = p.depth * (0.9 + 0.2 * rnd());
  const floors = Math.max(1, Math.round(p.floors)), fh = lerp(cfg.fh[0], cfg.fh[1], rnd()), H = 0.4 + floors * fh;
  const theta = pal.pitch * DEG, hip = pal.hip && !ridgeZ;
  const L = ridgeZ ? D : W, Wr = ridgeZ ? W : D;
  const oW = cfg.oW, oL = hip ? oW : cfg.oL, rh = (Wr / 2) * Math.tan(theta);
  const cw = party ? 0.6 : 0.7, chims = [], side = rnd() < 0.5 ? -1 : 1;
  for (let i = 0; i < cfg.nChim; i++) {
    const s = i === 0 ? side : -side, r = rnd();
    if (r >= cfg.pChim) continue;
    const rx = hip ? Math.max(0, L / 2 - Wr / 2) : L / 2, t = s * clamp(L / 2 - 0.8, 0, Math.max(0, rx - 0.4));
    if (chims.some((c) => Math.abs((ridgeZ ? c.z : c.x) - t) < 0.5)) continue;
    chims.push(ridgeZ ? { x: 0, z: t } : { x: t, z: 0 });
  }
  const doorW = 1.0, doorH = 2.1;
  const doorU = kind === 'cottage' ? (rnd() - 0.5) * W * 0.3 : kind === 'farmhouse' ? (rnd() - 0.5) * 0.6 : (rnd() < 0.5 ? -1 : 1) * (W / 2 - 1.15);
  const ww = pal.win[0] * (0.95 + 0.1 * rnd()), wh = pal.win[1] * (0.95 + 0.1 * rnd());
  const porch = !!cfg.porch && rnd() < cfg.porch;

  if (lod) {
    const m = new Mesh();
    const wallAvg = mixColor(mixColor(pal.wall, pal.trim, pal.lodTrim), pal.glass, 0.06);
    m.add(box(W, H, D, wallAvg));
    m.add(roofMesh({ ax: ridgeZ ? 'z' : 'x', L, W: Wr, theta, oL, oW, hip, col: pal.roof, gcol: pal.wall, flat: true }), mat.translate(0, H, 0));
    for (const c of chims) m.add(box(cw, rh + 1.0, cw, pal.chim), mat.translate(c.x, H, c.z));
    return m;
  }

  const F = FACE(W, D), opens = { front: [], back: [], right: [], left: [] };
  const base = (i) => 0.4 + i * fh;
  const mg = party ? 0.8 : 1.0;
  for (let i = 0; i < floors; i++) {
    const avoid = i === 0 ? [{ u: doorU, w: doorW + 0.2 }] : [];
    for (const u of layout(W, ww, cfg.gap, mg, avoid, rnd, 0)) opens.front.push({ u, w: ww, h: wh, y: base(i) + 0.85, floor: i });
    for (const u of layout(W, ww, cfg.gap, mg, [], rnd, 0.2)) opens.back.push({ u, w: ww, h: wh, y: base(i) + 0.85, floor: i });
    if (!party && D >= 4) for (const fn of ['right', 'left']) for (const u of layout(D, ww, 1.6, 1.2, [], rnd, 0.35)) opens[fn].push({ u, w: ww, h: wh, y: base(i) + 0.85, floor: i });
  }
  if (rh >= 1.9) { // attic window in the gable triangle
    const gw = Math.min(0.7, ww), gh = 0.9;
    if (ridgeZ) { for (const fn of ['front', 'back']) opens[fn].push({ u: 0, w: gw, h: gh, y: H + 0.45, floor: -1 }); }
    else if (!party && rnd() < 0.7) for (const fn of ['right', 'left']) opens[fn].push({ u: 0, w: gw, h: gh, y: H + 0.35, floor: -1 });
  }

  const body = wallBlock(W, D, H, pal, party);
  const faces = party ? ['front', 'back'] : ['front', 'back', 'right', 'left'];
  if (pal.frame === 'frame') { for (const fn of faces) frameFace(body, F[fn], W, D, H, floors, fh, opens[fn], rnd, pal.trim); corners(body, W, D, H, pal.trim, party); }
  else if (pal.frame === 'quoin') { if (p.style === 'stone') quoins(body, W, D, H, pal.trim, party); else corners(body, W, D, H, pal.trim, party, 0.16); }
  for (const fn of faces) for (const o of opens[fn]) addWindow(body, F[fn], o.u, o.y, o.w, o.h, pal);
  addDoor(body, F.front, doorU, 0.4, doorW, doorH, pal, pal.door);
  body.add(box(1.7, 0.4, 0.8, pal.plinth), mat.translate(doorU, 0, D / 2 + 0.4));
  body.tint(ao(H));

  const m = new Mesh().add(body);
  m.add(roofMesh({ ax: ridgeZ ? 'z' : 'x', L, W: Wr, theta, oL, oW, hip, col: pal.roof, gcol: pal.wall }), mat.translate(0, H, 0));
  for (const c of chims) chimney(m, c.x, c.z, H, H + rh + 0.95, cw, pal.chim);
  if (porch) {
    const pz = D / 2 + 1.3, pb = 2.75;
    for (const sg of [-1, 1]) m.add(box(0.14, pb, 0.14, pal.trim), mat.translate(doorU + sg * 1.15, 0, pz));
    m.add(roofMesh({ ax: 'z', L: 1.4, W: 2.8, theta: 30 * DEG, oL: 0.15, oW: 0.2, col: pal.roof, gcol: pal.wall }), mat.translate(doorU, pb, D / 2 + 0.7));
  }
  return m;
}

// ---------- barn
function buildBarn(seed, p, lod) {
  const rnd = rng(`barn|${seed}|${p.style}`), pal = pick(p.style, rnd);
  const W = p.width * (0.9 + 0.2 * rnd()), D = p.depth * (0.9 + 0.2 * rnd());
  const H = 0.4 + 4.2 + (Math.max(1, p.floors) - 1) * 2.4, theta = clamp(pal.pitch * 0.88, 28, 42) * DEG;
  const rh = (W / 2) * Math.tan(theta), wallC = pal.barn, stripe = shade(wallC, 0.78);
  const wp = { ...pal, wall: wallC };
  const roofM = (flat) => roofMesh({ ax: 'z', L: D, W, theta, oL: 0.3, oW: 0.45, col: pal.roof, gcol: wallC, flat });
  if (lod) {
    return new Mesh().add(box(W, H, D, shade(wallC, 0.95))).add(roofM(true), mat.translate(0, H, 0));
  }
  const F = FACE(W, D), body = wallBlock(W, D, H, wp);
  const dw = 3.6, dh = 3.7, wood = shade(wallC, 0.62);
  put(body, F.front, 0, 0.4, dw + 0.4, dh + 0.2, 0.05, stripe);
  for (const sg of [-1, 1]) {
    put(body, F.front, sg * dw / 4, 0.4, dw / 2 - 0.04, dh, 0.09, wood);
    const ang = Math.atan2(dw / 2 - 0.3, dh - 0.3);
    for (const d2 of [1, -1]) body.add(panel(0.12, Math.hypot(dw / 2 - 0.3, dh - 0.3), 0.04, stripe), mat.chain(mat.rotY(0), mat.translate(sg * dw / 4 - d2 * (dw / 4 - 0.15), 0.55, D / 2 + 0.1), mat.rotZ(d2 * ang)));
  }
  put(body, F.front, 0, H + 0.45, 1.1, 1.0, 0.04, stripe);
  put(body, F.front, 0, H + 0.5, 0.95, 0.9, 0.07, wood);
  put(body, F.front, 0, H + 1.55, 0.2, 0.2, 0.12, stripe);
  // vertical battens
  for (const fn of ['front', 'back', 'right', 'left']) {
    const f = F[fn], n = Math.round(f.len / 1.15);
    for (let k = 1; k < n; k++) {
      const u = -f.len / 2 + (f.len * k) / n;
      if (fn === 'front' && Math.abs(u) < dw / 2 + 0.4) continue;
      put(body, f, u, 0.4, 0.1, H - 0.4, 0.04, stripe);
    }
  }
  corners(body, W, D, H, stripe, false, 0.2);
  for (const sg of [-1, 1]) for (const fn of ['right', 'left']) for (const u of [-D / 5, D / 5]) put(body, F[fn], u + sg * 0.0, 2.6, 0.14, 0.9, 0.06, pal.glass);
  body.add(box(dw + 1.2, 0.4, 1.0, pal.plinth), mat.translate(0, 0, D / 2 + 0.5));
  body.tint(ao(H));
  return new Mesh().add(body).add(roofM(false), mat.translate(0, H, 0));
}

// ---------- warehouse
function buildWarehouse(seed, p, lod) {
  const rnd = rng(`warehouse|${seed}|${p.style}`), pal = pick(p.style, rnd);
  const W = p.width * (0.9 + 0.2 * rnd()), D = p.depth * (0.9 + 0.2 * rnd()), H = 0.4 + 4.6 + (Math.max(1, p.floors) - 1) * 2.4;
  const theta = clamp(pal.pitch * 0.62, 20, 30) * DEG, rh = (D / 2) * Math.tan(theta), wallC = pal.barn, stripe = shade(wallC, 0.78);
  const roofM = (flat) => roofMesh({ ax: 'x', L: W, W: D, theta, oL: 0.35, oW: 0.45, col: pal.roof, gcol: wallC, flat });
  if (lod) return new Mesh().add(box(W, H, D, shade(wallC, 0.95))).add(roofM(true), mat.translate(0, H, 0));
  const F = FACE(W, D), body = wallBlock(W, D, H, { ...pal, wall: wallC }), wp = { ...pal, wall: wallC };
  const nd = Math.max(2, Math.round(W / 8)), bay = W / nd, wood = shade(wallC, 0.6), dw = 3.0, dh = 3.6;
  for (let k = 0; k < nd; k++) {
    const u = -W / 2 + (k + 0.5) * bay;
    put(body, F.front, u, 0.4, dw + 0.4, dh + 0.2, 0.05, stripe);
    put(body, F.front, u, 0.4, dw, dh, 0.09, wood);
    put(body, F.front, u, 0.4, 0.08, dh, 0.11, stripe);
    if (k === 0) put(body, F.back, u, 0.4, dw, dh, 0.09, wood);
  }
  for (let k = 1; k < nd; k++) for (const fn of ['front', 'back']) put(body, F[fn], -W / 2 + k * bay, 0.4, 0.35, H - 0.4, 0.12, stripe);
  const nw = Math.round(W / 2.6);
  for (const fn of ['front', 'back']) for (let k = 0; k < nw; k++) {
    const u = -W / 2 + (k + 0.5) * (W / nw);
    if (fn === 'back' && k % 2) continue;
    addWindow(body, F[fn], u, 4.15, 1.1, 0.7, wp);
  }
  put(body, F.right, 0, 0.4, 2.6, 3.2, 0.05, stripe); put(body, F.right, 0, 0.4, 2.4, 3.0, 0.09, wood);
  put(body, F.right, 0, H + 0.4, 1.0, 0.9, 0.09, wood);
  corners(body, W, D, H, stripe, false, 0.22);
  body.add(box(W - 1, 0.4, 1.4, pal.plinth), mat.translate(0, 0, D / 2 + 0.7));
  body.tint(ao(H));
  const m = new Mesh().add(body).add(roofM(false), mat.translate(0, H, 0));
  m.add(box(0.6, 0.5, 0.6, shade(pal.roof, 0.9)), mat.translate(W / 4, H + rh - 0.1, 0));
  return m;
}

// ---------- church
function buildChurch(seed, p, lod) {
  const rnd = rng(`church|${seed}|${p.style}`), pal = pick(p.style, rnd);
  const Wn = p.width * (0.92 + 0.16 * rnd()), Dtot = p.depth * (0.92 + 0.16 * rnd());
  const Wt = Wn * 0.7 + 0.4, Ht = p.tower * (0.92 + 0.16 * rnd()), hs = 8 + 2 * rnd();
  const Wc = Wn * 0.65, Lc = 5 + rnd(), Hn = 7 + rnd() * 0.6, Hc = Hn - 1.2, Dn = Dtot - Wt - Lc;
  const theta = clamp(pal.pitch, 40, 48) * DEG, z0 = Dtot / 2;
  const zt = z0 - Wt / 2, zn = z0 - Wt - Dn / 2, zc = -z0 + Lc / 2;
  const roofM = (L, Wr, flat) => roofMesh({ ax: 'z', L, W: Wr, theta, oL: 0.2, oW: 0.4, col: pal.roof, gcol: pal.wall, flat });
  const spire = (flat) => new Mesh().add(cylinder((Wt / 2 + 0.3) * Math.SQRT2, 0, hs, 4, flat ? pal.roof : vary(pal.roof, 0.05), { flat: true, caps: false }), mat.rotY(Math.PI / 4));
  if (lod) {
    const m = new Mesh(), wc = mixColor(pal.wall, pal.glass, 0.05);
    m.add(box(Wn, Hn, Dn, wc), mat.translate(0, 0, zn)).add(box(Wc, Hc, Lc, wc), mat.translate(0, 0, zc)).add(box(Wt, Ht, Wt, wc), mat.translate(0, 0, zt));
    m.add(roofM(Dn, Wn, true), mat.translate(0, Hn, zn)).add(roofM(Lc, Wc, true), mat.translate(0, Hc, zc)).add(spire(true), mat.translate(0, Ht, zt));
    return m;
  }
  const lancet = (m, f, u, y, w, h) => {
    putTri(m, f, u, y + h, w + 0.16, (w + 0.16) * 0.55, pal.trim, 0.03);
    putTri(m, f, u, y + h, w, w * 0.55, pal.glass, 0.06);
    put(m, f, u, y - 0.08, w + 0.16, h + 0.08, 0.04, pal.trim);
    put(m, f, u, y, w, h, 0.07, pal.glass);
  };
  const out = new Mesh();
  // nave
  { const F = FACE(Wn, Dn), m = wallBlock(Wn, Dn, Hn, pal), nb = Math.max(2, Math.round(Dn / 3.2));
    for (const fn of ['right', 'left']) {
      for (let k = 0; k < nb; k++) lancet(m, F[fn], -Dn / 2 + (k + 0.5) * Dn / nb, 2.0, 0.9, 2.8);
      for (let k = 1; k < nb; k++) put(m, F[fn], -Dn / 2 + k * Dn / nb, 0.4, 0.55, 5.2, 0.5, pal.trim, false);
    }
    m.tint(ao(Hn)); out.add(m, mat.translate(0, 0, zn)); }
  // chancel
  { const F = FACE(Wc, Lc), m = wallBlock(Wc, Lc, Hc, pal);
    for (const fn of ['right', 'left']) lancet(m, F[fn], 0, 2.0, 0.9, 2.6);
    for (const u of [-0.9, 0.9]) lancet(m, F.back, u, 1.8, 0.9, 2.8);
    m.tint(ao(Hc)); out.add(m, mat.translate(0, 0, zc)); }
  // tower
  { const F = FACE(Wt, Wt), m = wallBlock(Wt, Wt, Ht, pal);
    put(m, F.front, 0, 0.4, 1.9, 2.8, 0.05, pal.trim, false); putTri(m, F.front, 0, 3.2, 1.9, 1.0, pal.trim, 0.03);
    put(m, F.front, 0, 0.4, 1.5, 2.6, 0.09, pal.door); putTri(m, F.front, 0, 3.0, 1.5, 0.6, pal.door, 0.08);
    lancet(m, F.front, 0, 6.0, 0.8, 2.2);
    for (const fn of ['back', 'right', 'left']) lancet(m, F[fn], 0, 6.0, 0.5, 1.8);
    for (const fn of ['front', 'back', 'right', 'left']) lancet(m, F[fn], 0, Ht - 6.4, 1.3, 2.6);
    for (const y of [9.5, Ht - 8.2]) m.add(box(Wt + 0.24, 0.3, Wt + 0.24, shade(pal.trim, 0.95)), mat.translate(0, y, 0));
    corners(m, Wt, Wt, Ht, pal.trim, false, 0.3);
    m.tint(ao(Ht)); out.add(m, mat.translate(0, 0, zt)); }
  out.add(roofM(Dn, Wn), mat.translate(0, Hn, zn)).add(roofM(Lc, Wc), mat.translate(0, Hc, zc)).add(spire(false), mat.translate(0, Ht, zt));
  const gold = '#b09a58';
  out.add(box(0.1, 1.5, 0.1, gold), mat.translate(0, Ht + hs - 0.2, zt)).add(box(0.7, 0.1, 0.1, gold), mat.translate(0, Ht + hs + 0.8, zt));
  return out;
}

// ---------- well
function buildWell(seed, p, lod) {
  const rnd = rng(`well|${seed}|${p.style}`), J = jitter(rnd), pal = pick(p.style, rnd);
  const r = 0.9 * (0.9 + 0.2 * rnd()), rin = r * 0.68, h = 0.95, stone = J('#9a9284'), wood = J('#6b4a2e');
  const m = new Mesh(), seg = lod ? 8 : 12, theta = 36 * DEG;
  m.add(cylinder(r + 0.04, r, h + 0.2, seg, vary(stone, 0.06), { caps: false }), mat.translate(0, -0.2, 0));
  if (!lod) {
    m.add(cylinder(r + 0.1, r + 0.1, 0.3, seg, vary(shade(stone, 0.9), 0.06), { caps: false }), mat.translate(0, -0.2, 0));
    const A = (rad, y, a) => [rad * Math.cos(a), y, rad * Math.sin(a)], tris = [];
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * 2 * Math.PI, a1 = ((s + 1) / seg) * 2 * Math.PI;
      tris.push([A(rin, h, a0), A(r, h, a1), A(r, h, a0)], [A(rin, h, a0), A(rin, h, a1), A(r, h, a1)]);
    }
    m.flatTris(tris, shade(stone, 1.05));
    m.add(cylinder(rin, rin, 0.01, seg, '#1c2530'), mat.translate(0, h - 0.12, 0));
  } else m.add(cylinder(rin, rin, 0.01, seg, '#1c2530'), mat.translate(0, h - 0.02, 0));
  const px = r - 0.05;
  for (const sg of [-1, 1]) m.add(box(0.14, 2.2, 0.14, wood), mat.translate(sg * px, 0.45, 0));
  m.add(roofMesh({ ax: 'x', L: 2 * px, W: 1.6, theta, oL: 0.25, oW: 0.25, col: pal.roof, gcol: shade(wood, 1.1), flat: lod }), mat.translate(0, 2.65, 0));
  if (!lod) {
    m.add(cylinder(0.07, 0.07, 2 * px, 6, shade(wood, 0.9)), mat.chain(mat.translate(px, 1.7, 0), mat.rotZ(Math.PI / 2)));
    m.add(box(0.02, 0.5, 0.02, '#8a7a5a'), mat.translate(0, 1.2, 0));
    m.add(cylinder(0.13, 0.1, 0.22, 6, shade(wood, 0.8)), mat.translate(0, 0.98, 0));
  }
  m.tint((x, y) => (y < 0.5 ? 0.7 + 0.3 * clamp((y + 0.2) / 0.7, 0, 1) : 1));
  return m;
}

// ---------- bridges (axis along Z, deck top surface y=0, centre of span at z=0, x=0 on the centreline)
function stoneBridge(seed, p, lod) {
  const rnd = rng(`bridge_stone|${seed}`), J = jitter(rnd);
  const span = p.span * (0.9 + 0.2 * rnd()), width = p.width * (0.9 + 0.2 * rnd());
  const stone = J('#9a9284'), ringC = J('#aaa294'), copC = J('#a8a091'), roadC = J('#7d6a52');
  const n = clamp(Math.round(span / 9), 1, 5), t = 1.3, s = (span - (n - 1) * t) / n, rise = s * (0.2 + 0.06 * rnd());
  const crown = -0.55, R = (s * s / 4 + rise * rise) / (2 * rise), yc = crown - R, ys = crown - rise, bed = ys - 1.8;
  const app = 1.5, Lt = span + 2 * app, hw = width / 2, phi = Math.asin(s / (2 * R)), K = lod ? 3 : 10;
  const m = new Mesh(), Q = (a, b, c, d, col) => m.flatTris([[a, b, c], [a, c, d]], col);
  const sp = (pt) => { const k = (1 - 0.3 * clamp(pt[1] / bed, 0, 1)) * (1 + (hash3(pt[0], pt[1], pt[2]) * 2 - 1) * 0.05); return stone.map((v) => clamp(v * k, 0, 1)); };
  const dark = vary(shade(stone, 0.62), 0.05), pierC = vary(shade(stone, 0.7), 0.05);
  const solid = (zl, zh) => { Q([hw, bed, zh], [hw, bed, zl], [hw, 0, zl], [hw, 0, zh], sp); Q([-hw, bed, zl], [-hw, bed, zh], [-hw, 0, zh], [-hw, 0, zl], sp); };
  const zcs = Array.from({ length: n }, (_, k) => -span / 2 + s / 2 + k * (s + t));
  solid(-Lt / 2, -span / 2);
  for (let k = 0; k < n - 1; k++) solid(zcs[k] + s / 2, zcs[k + 1] - s / 2);
  solid(zcs[n - 1] + s / 2, Lt / 2);
  Q([-hw, bed, Lt / 2], [hw, bed, Lt / 2], [hw, 0, Lt / 2], [-hw, 0, Lt / 2], sp);
  Q([hw, bed, -Lt / 2], [-hw, bed, -Lt / 2], [-hw, 0, -Lt / 2], [hw, 0, -Lt / 2], sp);
  for (const zc of zcs) {
    const zA = zc - s / 2, zB = zc + s / 2;
    Q([-hw, bed, zA], [hw, bed, zA], [hw, ys, zA], [-hw, ys, zA], pierC);
    Q([hw, bed, zB], [-hw, bed, zB], [-hw, ys, zB], [hw, ys, zB], pierC);
    for (let i = 0; i < K; i++) {
      const a0 = -phi + (i * 2 * phi) / K, a1 = -phi + ((i + 1) * 2 * phi) / K;
      const zl = zc + R * Math.sin(a0), zh = zc + R * Math.sin(a1), yl = yc + R * Math.cos(a0), yh = yc + R * Math.cos(a1);
      m.flatTris([[[-hw, yh, zh], [hw, yl, zl], [hw, yh, zh]], [[-hw, yh, zh], [-hw, yl, zl], [hw, yl, zl]]], dark);
      Q([hw, yh, zh], [hw, yl, zl], [hw, 0, zl], [hw, 0, zh], sp);
      Q([-hw, yl, zl], [-hw, yh, zh], [-hw, 0, zh], [-hw, 0, zl], sp);
      if (!lod) {
        const Ro = R + 0.5, o = 0.04;
        const Bl = [hw + o, yl, zl], Bh = [hw + o, yh, zh];
        const Tl = [hw + o, yc + Ro * Math.cos(a0), zc + Ro * Math.sin(a0)], Th = [hw + o, yc + Ro * Math.cos(a1), zc + Ro * Math.sin(a1)];
        Q(Bh, Bl, Tl, Th, ringC);
        const f = (v) => [-v[0], v[1], v[2]];
        Q(f(Bl), f(Bh), f(Th), f(Tl), ringC);
      }
    }
  }
  const ra = hw - 0.5;
  Q([-ra, 0.003, Lt / 2], [ra, 0.003, Lt / 2], [ra, 0.003, -Lt / 2], [-ra, 0.003, -Lt / 2], vary(roadC, 0.06));
  const segs = lod ? 1 : Math.ceil(Lt / 1.6), sl = Lt / segs;
  for (const sg of [-1, 1]) for (let i = 0; i < segs; i++) {
    const zc = -Lt / 2 + (i + 0.5) * sl, hgt = lod ? 0.95 : 0.9 + (hash3(sg, i, 1) - 0.5) * 0.03;
    m.add(box(0.5, hgt, sl, vary(stone, 0.05)), mat.translate(sg * (hw - 0.25), 0, zc));
    if (!lod) m.add(box(0.64, 0.12, sl + 0.02, copC), mat.translate(sg * (hw - 0.25), hgt, zc));
  }
  if (!lod) for (const sg of [-1, 1]) for (const e of [-1, 1]) m.add(box(0.7, 1.15, 0.7, vary(copC, 0.04)), mat.translate(sg * (hw - 0.35), 0, e * (Lt / 2 - 0.35)));
  return m;
}

function timberBridge(seed, p, lod) {
  const rnd = rng(`bridge_timber|${seed}`), J = jitter(rnd);
  const L = p.span * (0.9 + 0.2 * rnd()), w = p.width * (0.9 + 0.2 * rnd());
  const deckC = J('#7a6548'), beamC = J('#5e4630'), railC = J('#6f5a40');
  const nb = Math.max(1, Math.ceil(L / 5)), xp = w / 2 - 0.45, m = new Mesh();
  const bedAt = (z) => -(1.2 + 2.4 * Math.max(0, 1 - (2 * z / L) ** 2));
  for (let i = 0; i <= nb; i++) {
    const z = -L / 2 + (i * L) / nb, bed = bedAt(z), dep = -0.87 - bed;
    for (const sg of [-1, 1]) m.add(box(0.3, dep + 0.15, 0.3, vary(beamC, 0.06)), mat.translate(sg * xp, bed - 0.15, z));
    if (!lod) {
      m.add(box(w + 0.2, 0.32, 0.42, beamC), mat.translate(0, -0.87, z));
      if (dep > 1.8) for (const sg of [-1, 1]) {
        const x0 = -sg * xp, y0 = bed + 0.4, x1 = sg * xp, y1 = -1.2, dx = x1 - x0, dy = y1 - y0;
        m.add(box(0.12, Math.hypot(dx, dy), 0.12, beamC), mat.chain(mat.translate(x0, y0, z + sg * 0.12), mat.rotZ(Math.atan2(-dx, dy))));
      }
    }
  }
  if (lod) {
    m.add(box(w, 0.55, L + 0.4, deckC), mat.translate(0, -0.55, 0));
    for (const sg of [-1, 1]) { m.add(box(0.1, 0.12, L, railC), mat.translate(sg * (w / 2 - 0.1), 0.9, 0)); for (const e of [-1, 1]) m.add(box(0.12, 0.95, 0.12, railC), mat.translate(sg * (w / 2 - 0.1), 0, e * (L / 2 - 0.1))); }
    return m;
  }
  const xs = w / 2 - 0.3;
  for (const x of [-xs, 0, xs]) m.add(box(0.26, 0.45, L + 0.6, vary(beamC, 0.05)), mat.translate(x, -0.55, 0));
  m.add(box(w, 0.1, L + 0.4, shade(deckC, 0.5)), mat.translate(0, -0.1, 0));
  const np = Math.round(L / 0.25), pw = L / np;
  for (let i = 0; i < np; i++) {
    const zl = -L / 2 + i * pw + 0.012, zh = -L / 2 + (i + 1) * pw - 0.012, k = 0.88 + 0.24 * hash3(i, 3, 7), c = shade(deckC, k);
    m.flatTris([[[-w / 2, 0.004, zh], [w / 2, 0.004, zh], [w / 2, 0.004, zl]], [[-w / 2, 0.004, zh], [w / 2, 0.004, zl], [-w / 2, 0.004, zl]]], c);
  }
  const nps = Math.ceil(L / 2);
  for (const sg of [-1, 1]) {
    const x = sg * (w / 2 - 0.1);
    for (let j = 0; j <= nps; j++) m.add(box(0.12, 1.0, 0.12, vary(railC, 0.05)), mat.translate(x, 0, -L / 2 + (j * L) / nps));
    m.add(box(0.1, 0.12, L + 0.12, railC), mat.translate(x, 0.93, 0));
    m.add(box(0.08, 0.1, L, railC), mat.translate(x, 0.48, 0));
    m.add(box(0.12, 0.2, L, shade(railC, 0.9)), mat.translate(sg * (w / 2 - 0.06), 0, 0));
  }
  return m;
}

// ---------- registry
const merge = (def) => (seed, p) => ({ ...def, ...(p || {}) });
const mk = (defaults, fn) => ({
  defaults,
  make: (seed, p) => fn(seed, { ...defaults, ...(p || {}) }, false),
  lod1: (seed, p) => fn(seed, { ...defaults, ...(p || {}) }, true),
});
void merge;

export const BUILDINGS = {
  cottage: { desc: 'Small rural cottage, gable (hip for mediterranean) roof, ridge along X, door on the +Z long side, optional gable chimney. Origin at footprint centre on the ground; plinth sinks to y=-0.3.', ...mk({ style: 'timber', width: 8, depth: 6, floors: 1 }, (s, p, l) => buildHouse('cottage', s, p, l)) },
  farmhouse: { desc: 'Larger two-storey farmhouse, ridge along X, centred door (optional porch) on +Z, two end chimneys.', ...mk({ style: 'timber', width: 12, depth: 8, floors: 2 }, (s, p, l) => buildHouse('farmhouse', s, p, l)) },
  barn: { desc: 'Big gable barn, ridge along Z, double doors with cross bracing and hayloft hatch on the +Z gable end, plank walls. width = gable span (X), depth = length (Z).', ...mk({ style: 'timber', width: 10, depth: 16, floors: 1 }, (s, p, l) => buildBarn(s, p, l)) },
  townhouse: { desc: 'Narrow deep terrace house, 2-4 floors, gable-fronted (ridge along Z), plain party walls at +-X with no overhang so rows abut; facade on +Z. width = frontage (X).', ...mk({ style: 'timber', width: 5.5, depth: 10, floors: 3 }, (s, p, l) => buildHouse('townhouse', s, p, l)) },
  church: { desc: 'Parish church: nave + chancel (ridge along Z) with a square west tower on +Z (entrance in tower) and pyramid spire; tower wall height `tower` (~22 m) + spire ~9 m. depth = total length incl. tower.', ...mk({ style: 'stone', width: 9, depth: 24, floors: 1, tower: 22 }, (s, p, l) => buildChurch(s, p, l)) },
  warehouse: { desc: 'Long low hall, ridge along X (width = long axis), several loading doors and a clerestory window row on +Z, loading platform.', ...mk({ style: 'timber', width: 24, depth: 10, floors: 1 }, (s, p, l) => buildWarehouse(s, p, l)) },
  well: { desc: 'Small round stone well with two posts, windlass and a gable roof; about 2.9 m tall, footprint radius ~1 m.', ...mk({ style: 'timber' }, (s, p, l) => buildWell(s, p, l)) },
  bridge_stone: { desc: 'Stone arch bridge (1-5 segmental arches, n=round(span/9)), parapets with coping. Travel axis along Z, centre of span at z=0. VERTICAL CONVENTION: the road surface is y=0 over the whole length (place it at road level); parapets rise to y~+1.0; arches, piers and abutment faces extend below to the stream bed at about y=-(rise+2.4) (min.y negative). span = clear length between abutments, total length = span+3; width = outside width.', ...mk({ span: 12, width: 4 }, (s, p, l) => stoneBridge(s, p, l)) },
  bridge_timber: { desc: 'Timber beam bridge on trestle bents every <=5 m, plank deck, handrails. Travel axis along Z, centre at z=0. VERTICAL CONVENTION: deck top surface is y=0 over the whole length; stringers and bents extend below to a parabolic stream bed (-1.2 m at the ends, -3.6 m mid span), so min.y is negative.', ...mk({ span: 10, width: 3 }, (s, p, l) => timberBridge(s, p, l)) },
};
