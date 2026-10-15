// Procedural landmarks: town wall, wall tower, gatehouse, windmills, watermill.
// Pure (seed, params) -> Mesh; vertex colours only. Metres, Y up, origin at ground centre, front +Z.
// Uses only the mesh.mjs builder API.

import { Mesh, box, cylinder, gableRoof, mat, rng, rgb } from './mesh.mjs';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hash3 = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
const C = { stone: '#9a9284', stoneLt: '#b3ab9b', stoneDk: '#7c766a', slate: '#4b5056', timber: '#6b4a2e', plaster: '#d8cdb8', tile: '#94604a', open: '#252b33', dirt: '#7d6a52', iron: '#2f3338', door: '#4e3b2a' };

// ---------- colour helpers
const shade = (c, k) => rgb(c).map((v) => clamp(v * k, 0, 1));
/** Per-individual colour jitter: +-8 % lightness, a little hue shift. */
function jitter(rnd) {
  const k = 1 + (rnd() * 2 - 1) * 0.08, h = [1 + (rnd() - 0.5) * 0.05, 1, 1 + (rnd() - 0.5) * 0.05];
  return (c) => rgb(c).map((v, i) => clamp(v * k * h[i], 0, 1));
}
/** Colour function: base with small per-vertex variation and optional ambient-occlusion fn(p) -> scalar. */
const surf = (c, amt = 0.06, ao = null) => {
  const b = rgb(c);
  return (p) => { const k = (1 + (hash3(p[0] * 1.3, p[1] * 1.7, p[2] * 1.1) * 2 - 1) * amt) * (ao ? ao(p) : 1); return [clamp(b[0] * k, 0, 1), clamp(b[1] * k, 0, 1), clamp(b[2] * k, 0, 1)]; };
};
const aoBase = (p) => { const y = p[1]; return y < 0.5 ? 0.66 + 0.34 * clamp(y / 0.5, 0, 1) : 1; };

// ---------- vector / geometry helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Triangle; if hint is given, the winding is flipped so the normal faces the hint direction. */
function tri(m, a, b, c, col, hint) {
  const n = cross(sub(b, a), sub(c, a));
  if (len3(n) < 1e-10) return;
  if (hint && dot(n, hint) < 0) { const t = b; b = c; c = t; }
  m.flatTris([[a, b, c]], col);
}
const quad = (m, a, b, c, d, col, hint) => { tri(m, a, b, c, col, hint); tri(m, a, c, d, col, hint); };
/** Double-sided quad (both windings), for thin lattices. */
const quad2 = (m, a, b, c, d, col) => m.flatTris([[a, b, c], [a, c, d], [a, c, b], [a, d, c]], col);
/** nu x nv grid between corners a(0,0) b(1,0) c(1,1) d(0,1). */
function grid(m, a, b, c, d, nu, nv, col, hint) {
  const P = (i, j) => mix3(mix3(a, b, i / nu), mix3(d, c, i / nu), j / nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) quad(m, P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), col, hint);
}
/** Ear-clipping fill of a simple 3D polygon (planar), normal toward hint. */
function fillPoly(m, P, col, hint) {
  const ax = [0, 1, 2].sort((p, q) => Math.abs(hint[q]) - Math.abs(hint[p]))[0], [iu, iv] = [0, 1, 2].filter((i) => i !== ax);
  const Q = P.map((p) => [p[iu], p[iv]]), n = Q.length;
  let area = 0; for (let i = 0; i < n; i++) { const a = Q[i], b = Q[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = [...Array(n).keys()]; if (area < 0) idx.reverse();
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) > 1e-9 && cr(b, c, p) > 1e-9 && cr(c, a, p) > 1e-9;
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let ear = -1;
    for (let i = 0; i < idx.length && ear < 0; i++) {
      const a = Q[idx[(i + idx.length - 1) % idx.length]], b = Q[idx[i]], c = Q[idx[(i + 1) % idx.length]];
      if (cr(a, b, c) <= 1e-9) continue;
      if (idx.some((k) => Q[k] !== a && Q[k] !== b && Q[k] !== c && inside(Q[k], a, b, c))) continue;
      ear = i;
    }
    if (ear < 0) ear = 1;
    const L = idx.length;
    tri(m, P[idx[(ear + L - 1) % L]], P[idx[ear]], P[idx[(ear + 1) % L]], col, hint);
    idx.splice(ear, 1);
  }
  if (idx.length === 3) tri(m, P[idx[0]], P[idx[1]], P[idx[2]], col, hint);
}

// ---------- boxes and beams
function dropFaces(m, faces) { // box faces: 0 +z, 1 -z, 2 +x, 3 -x, 4 top, 5 bottom
  const o = new Mesh();
  for (let t = 0; t < m.idx.length; t += 3) {
    if (faces.includes((t / 3) >> 1)) continue;
    const base = o.vertexCount;
    for (let k = 0; k < 3; k++) { const i = m.idx[t + k] * 3; o.pos.push(m.pos[i], m.pos[i + 1], m.pos[i + 2]); o.nrm.push(m.nrm[i], m.nrm[i + 1], m.nrm[i + 2]); o.col.push(m.col[i], m.col[i + 1], m.col[i + 2]); o.idx.push(base + k); }
  }
  return o;
}
const varyRgb = (base, amt, x, y, z) => { const k = 1 + (hash3(x * 3.7, y * 2.1, z * 5.3) * 2 - 1) * amt; return rgb(base).map((v) => clamp(v * k, 0, 1)); };
/** Box with centre x/z, bottom y, rotated about Y by rot, bottom face dropped by default. */
function bx(m, x, y, z, w, h, d, base, { amt = 0.05, rot = 0, drop = [5] } = {}) {
  m.add(dropFaces(box(w, h, d, varyRgb(base, amt, x, y, z)), drop), mat.chain(mat.translate(x, y, z), mat.rotY(rot)));
}
/** Box along p0->p1 with cross-section wx (local x) by wz (local z). */
function beam(m, p0, p1, wx, wz, base, { amt = 0.05, drop = [] } = {}) {
  const d = sub(p1, p0), L = len3(d), v = unit(d), h = Math.abs(v[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(h, v)), w = cross(u, v);
  const M = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, w[0], w[1], w[2], 0, p0[0], p0[1], p0[2], 1];
  m.add(dropFaces(box(wx, L, wz, varyRgb(base, amt, p0[0] + p1[0], p0[1] + p1[1], p0[2] + p1[2])), drop), M);
}

// ---------- surfaces of revolution about Y with n-sided facets (n = 4 gives square towers)
/** prof: [[apothem, y], ...] bottom to top / outside to inside; colAt(i) -> colour of strip i. Face centres sit at angles j * 2pi/seg (j = seg/4 faces +Z). */
function lathe(m, prof, seg, colAt) {
  const step = 2 * Math.PI / seg, k = 1 / Math.cos(Math.PI / seg), P = (r, y, t) => [r * Math.cos(t), y, r * Math.sin(t)];
  for (let i = 0; i < prof.length - 1; i++) {
    const [a0, y0] = prof[i], [a1, y1] = prof[i + 1], tr = a1 - a0, ty = y1 - y0, l = Math.hypot(tr, ty);
    if (l < 1e-9) continue;
    const nr = ty / l, ny = -tr / l, col = colAt(i);
    for (let s = 0; s < seg; s++) {
      const t0 = (s - 0.5) * step, t1 = (s + 0.5) * step, tm = s * step, hint = [nr * Math.cos(tm), ny, nr * Math.sin(tm)];
      const A0 = P(a0 * k, y0, t0), A1 = P(a0 * k, y0, t1), B1 = P(a1 * k, y1, t1), B0 = P(a1 * k, y1, t0);
      if (a1 < 1e-6) tri(m, A0, A1, B0, col, hint); else if (a0 < 1e-6) tri(m, A0, B1, B0, col, hint); else quad(m, A0, A1, B1, B0, col, hint);
    }
  }
}
const dirOf = (j, seg) => { const t = j * 2 * Math.PI / seg; return [Math.cos(t), Math.sin(t)]; }; // (x, z)
/** Flat polygon in the vertical plane facing dir (x,z) at distance d from the axis; pts2: [u (along tangent), y]. */
function polyOnPlane(m, dir, d, pts2, col, off = 0.05) {
  const t = [dir[1], -dir[0]], P = pts2.map(([u, y]) => [dir[0] * (d + off) + t[0] * u, y, dir[1] * (d + off) + t[1] * u]);
  fillPoly(m, P, col, [dir[0], 0, dir[1]]);
}
const rectPts = (u, y0, w, h) => [[u - w / 2, y0], [u + w / 2, y0], [u + w / 2, y0 + h], [u - w / 2, y0 + h]];
const archPts = (u, y0, w, h, K = 6) => { // rectangle with semicircular head, total height h
  const r = w / 2, ys = y0 + h - r, pts = [[u - r, y0], [u + r, y0], [u + r, ys]];
  for (let i = 1; i < K; i++) { const a = (i / K) * Math.PI; pts.push([u + r * Math.cos(a), ys + r * Math.sin(a)]); }
  pts.push([u - r, ys]); return pts;
};

/** Crenellated parapet along A->B (x,z) at height y, outward normal `out` (x,z); the line is the outer edge. */
function parapetLine(m, A, B, y, out, o) {
  const { th = 0.45, baseH = 0.5, merH = 0.7, pitch = 2.0, ratio = 0.6, col, lod = false } = o;
  const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, rot = Math.atan2(out[0], out[1]);
  const at = (s) => [A[0] + ux * s - out[0] * th / 2, A[1] + uz * s - out[1] * th / 2];
  const mid = at(L / 2);
  bx(m, mid[0], y, mid[1], L, baseH, th, col, { rot, drop: [1, 5] });
  const n = Math.max(1, Math.round(L / pitch)), p = L / n, mw = p * ratio;
  for (let k = 0; k < n; k++) { const c = at((k + 0.5) * p); bx(m, c[0], y + baseH, c[1], mw, merH, th, col, { rot, drop: [5], amt: lod ? 0.02 : 0.06 }); }
}

// ---------- registry plumbing
const mk = (defaults, fn) => ({
  defaults,
  make: (seed, p) => fn(seed, { ...defaults, ...(p || {}) }, false),
  lod1: (seed, p) => fn(seed, { ...defaults, ...(p || {}) }, true),
});
const dims = (rnd) => () => 0.9 + 0.2 * rnd();

// =====================================================================================
// wall_segment
// =====================================================================================
function wallSegment(seed, p, lod) {
  const rnd = rng(`wall|${seed}`), J = jitter(rnd), k = dims(rnd);
  const L = p.length, H = p.height * k(), t0 = 1.25 * k(), t1 = 0.95 * k(); // half thickness at base / at the walk
  const half = (y) => lerp(t0, t1, clamp(y / H, 0, 1));
  const stone = J(C.stone), cap = J(C.stoneLt), plinthC = J(C.stoneDk);
  const m = new Mesh();
  const aoO = (p2) => { const y = p2[1]; let a = aoBase(p2); if (y > H - 0.9 && y < H - 0.3) a *= 0.8 + 0.2 * clamp((H - 0.3 - y) / 0.6, 0, 1); return a; };
  const aoI = (p2) => aoBase(p2) * (p2[1] > H - 0.2 ? 0.9 : 1);
  const cell = Math.max(1.6, L / 20), nu = lod ? 1 : Math.max(1, Math.round(L / cell));
  const rows = lod ? [-0.3, H] : [-0.3, 0, ...Array.from({ length: Math.max(2, Math.round(H / 1.8)) }, (_, i) => ((i + 1) * H) / Math.max(2, Math.round(H / 1.8)))];
  const zo = (y) => half(Math.max(0, y));
  for (let j = 0; j < rows.length - 1; j++) {
    const y0 = rows[j], y1 = rows[j + 1];
    grid(m, [0, y0, zo(y0)], [L, y0, zo(y0)], [L, y1, zo(y1)], [0, y1, zo(y1)], nu, 1, surf(stone, 0.06, aoO), [0, 0.15, 1]);
    grid(m, [L, y0, -zo(y0)], [0, y0, -zo(y0)], [0, y1, -zo(y1)], [L, y1, -zo(y1)], nu, 1, surf(stone, 0.05, aoI), [0, 0.15, -1]);
  }
  // wall walk (inner edge to the parapet) and end caps
  const zp = zo(H) - 0.45;
  grid(m, [0, H, -zo(H)], [L, H, -zo(H)], [L, H, zp], [0, H, zp], nu, 1, surf(C.dirt, 0.06, null), [0, 1, 0]);
  for (const [x, s] of [[0, -1], [L, 1]]) fillPoly(m, [[x, -0.3, -t0], [x, -0.3, t0], [x, H, zo(H)], [x, H, -zo(H)]], surf(stone, 0.04), [s, 0, 0]);
  // outer plinth and string course under the parapet
  bx(m, L / 2, -0.3, t0 + 0.02, L, 0.9, 0.3, plinthC);
  bx(m, L / 2, H - 0.35, zo(H) + 0.03, L, 0.22, 0.3, cap, { drop: [5] });
  parapetLine(m, [0, zo(H) + 0.03], [L, zo(H) + 0.03], H, [0, 1], { th: 0.48, baseH: 0.5, merH: 0.72, pitch: lod ? 4.0 : 2.0, ratio: lod ? 0.6 : 0.62, col: cap, lod });
  if (!lod) { // putlog holes on the plain inner face
    const dark = rgb(C.open);
    for (const [y, off] of [[H - 2.1, 0.5], [H - 4.2, 1.7]]) {
      if (y < 1.2) continue;
      for (let x = 1.0 + off; x < L - 0.5; x += 2.4) {
        const z = -zo(y) - 0.02;
        quad(m, [x - 0.08, y - 0.08, z], [x + 0.08, y - 0.08, z], [x + 0.08, y + 0.08, z], [x - 0.08, y + 0.08, z], dark, [0, 0, -1]);
      }
    }
  }
  return m;
}

// =====================================================================================
// wall_tower
// =====================================================================================
/** Arrow slits / windows / door on the facets of a lathe tower. ap(y) = apothem at y. */
function towerOpenings(m, seg, ap, H, square, rnd) {
  const dark = rgb(C.open);
  const faces = (lvl) => Array.from({ length: 4 }, (_, q) => q * seg / 4 + (square ? 0 : (lvl % 2) * seg / 8));
  const levels = H > 9 ? [3.2, 6.4, H - 3.4] : [3.0, H - 3.0];
  levels.forEach((y, lvl) => {
    for (const j of faces(lvl)) {
      const dir = dirOf(j, seg);
      if (square && lvl === levels.length - 1) { for (const u of [-1.3, 1.3]) { polyOnPlane(m, dir, ap(y), rectPts(u, y - 0.5, 0.7, 1.15), dark, 0.07); polyOnPlane(m, dir, ap(y), rectPts(u, y + 0.65, 0.9, 0.12), shade(C.stoneLt, 0.9), 0.05); } }
      else polyOnPlane(m, dir, ap(y), rectPts(0, y - 0.55, 0.14, 1.15), dark, 0.07);
    }
  });
  // raised door facing +Z
  const j = seg / 4, dir = dirOf(j, seg), d = ap(1.7);
  polyOnPlane(m, dir, d, archPts(0, 0.6, 1.5, 2.4), rgb(C.door), 0.07);
  polyOnPlane(m, dir, d, archPts(0, 0.6, 1.8, 2.7), shade(C.stoneLt, 0.9), 0.04);
  void rnd;
}

function wallTower(seed, p, lod) {
  const rnd = rng(`tower|${seed}`), J = jitter(rnd), k = dims(rnd);
  const square = p.shape === 'square', H = p.height * k(), A0 = (square ? 3.9 : 4.1) * k();
  const seg = square ? 4 : lod ? 8 : 16, bat = 0.4;
  const ap = (y) => A0 - bat * clamp((y - 0.6) / (H - 2.0), 0, 1);
  const stone = J(C.stone), plinthC = J(C.stoneDk), roofC = J(square ? C.tile : C.slate), capC = J(C.stoneLt);
  const aoS = (p2) => { const y = p2[1]; let a = aoBase(p2); if (y > H - 2.2 && y < H - 1.35) a *= 0.82; return a; };
  const prof = [], cl = [];
  const pt = (a, y, c) => { if (prof.length) cl.push(c); prof.push([a, y]); };
  const stoneC = surf(stone, 0.06, aoS), underC = surf(shade(stone, 0.6), 0.04), bandC = surf(capC, 0.05);
  const ac = ap(H - 1.4);
  pt(A0 + 0.25, -0.3, null);
  pt(A0 + 0.25, 0.6, surf(plinthC, 0.06, aoBase));
  pt(A0, 0.6, surf(plinthC, 0.04));
  const nShaft = lod ? 1 : 3;
  for (let i = 1; i <= nShaft; i++) { const y = lerp(0.6, H - 1.4, i / nShaft); pt(ap(y), y, stoneC); }
  pt(ac + 0.25, H - 1.4, underC);
  pt(ac + 0.25, H - 1.1, bandC);
  pt(ac + 0.5, H - 1.1, underC);
  pt(ac + 0.5, H, bandC);
  const Ar = ac + 0.95, rh = Ar * (square ? 1.15 : 1.7);
  pt(Ar, H, surf(shade(roofC, 0.5), 0.03)); // soffit
  if (lod) pt(0, H + rh, surf(roofC, 0.05));
  else {
    pt(Ar * 0.9, H + rh * 0.1, surf(shade(roofC, 0.92), 0.05));
    pt(Ar * 0.58, H + rh * 0.55, surf(roofC, 0.06));
    pt(Ar * 0.28, H + rh * 0.86, surf(shade(roofC, 1.05), 0.05));
    pt(0.06, H + rh, surf(roofC, 0.05));
    pt(0, H + rh + (square ? 1.2 : 1.0), surf(C.iron, 0.04));
  }
  const m = new Mesh();
  lathe(m, prof, seg, (i) => cl[i]);
  if (!lod) towerOpenings(m, seg, ap, H, square, rnd);
  else polyOnPlane(m, dirOf(seg / 4, seg), ap(1.7), archPts(0, 0.6, 1.5, 2.4), rgb(C.door), 0.07);
  return m;
}

// =====================================================================================
// gatehouse
// =====================================================================================
const PW = 3.5, PH = 4.5, PR = PW / 2, SP = PH - PR; // passage width, height, arch radius, springline

function gateFaces(m, W, Ht, D, stone, lod, ring) {
  const hw = PW / 2, K = lod ? 4 : 10, half = W / 2;
  const aoF = (p) => { const y = p[1]; let a = aoBase(p); if (y > Ht - 1.0 && y < Ht - 0.3) a *= 0.85; return a; };
  const col = surf(stone, 0.06, aoF);
  const arch = []; for (let i = 0; i <= K; i++) { const a = Math.PI - (i / K) * Math.PI; arch.push([hw * Math.cos(a), SP + PR * Math.sin(a)]); }
  for (const s of [1, -1]) {
    const z = s * D / 2, Pz = (x, y) => [x, y, z], hint = [0, 0.1, s];
    const nu = lod ? 1 : 3, nv = lod ? 1 : Math.max(2, Math.round(Ht / 2.2));
    const fl = (a, b, c, d, nu2, nv2) => (s > 0 ? grid(m, a, b, c, d, nu2, nv2, col, hint) : grid(m, b, a, d, c, nu2, nv2, col, hint));
    fl(Pz(-half, -0.3), Pz(-hw, -0.3), Pz(-hw, Ht), Pz(-half, Ht), nu, nv);
    fl(Pz(hw, -0.3), Pz(half, -0.3), Pz(half, Ht), Pz(hw, Ht), nu, nv);
    quad(m, Pz(-hw, -0.3), Pz(hw, -0.3), Pz(hw, 0), Pz(-hw, 0), col, hint);
    fillPoly(m, [...arch.map(([x, y]) => Pz(x, y)), Pz(hw, Ht), Pz(-hw, Ht)], col, hint);
    if (!lod) { // voussoir ring and string course
      const rc = surf(ring, 0.05);
      for (let i = 0; i < K; i++) {
        const a0 = Math.PI - (i / K) * Math.PI, a1 = Math.PI - ((i + 1) / K) * Math.PI, o = s * 0.05;
        const f = (r, a) => [r * Math.cos(a), SP + r * Math.sin(a), z + o];
        quad(m, f(PR, a0), f(PR, a1), f(PR + 0.45, a1), f(PR + 0.45, a0), rc, [0, 0, s]);
      }
      bx(m, 0, Ht - 0.9, z + s * 0.03, W, 0.2, 0.2, ring, { drop: [5] });
    }
  }
  // side faces
  const ss = surf(stone, 0.05, aoBase);
  for (const s of [1, -1]) {
    const x = s * half;
    const a = [x, -0.3, -D / 2], b = [x, -0.3, D / 2], c = [x, Ht, D / 2], d = [x, Ht, -D / 2];
    grid(m, a, b, c, d, lod ? 1 : 3, lod ? 1 : 3, ss, [s, 0, 0]);
  }
  // passage: vault, jambs, floor (dark towards the middle)
  const dk = (b) => (q) => { const e = 1 - Math.abs(q[2]) / (D / 2), k = 0.8 - 0.5 * clamp(e * 1.4, 0, 1); return rgb(b).map((v) => v * k); };
  const nz = lod ? 2 : 4;
  for (let n = 0; n < nz; n++) {
    const z0 = -D / 2 + (n / nz) * D, z1 = -D / 2 + ((n + 1) / nz) * D;
    for (let i = 0; i < K; i++) {
      const A = arch[i], B = arch[i + 1];
      quad(m, [A[0], A[1], z0], [B[0], B[1], z0], [B[0], B[1], z1], [A[0], A[1], z1], dk(stone), [-(A[0] + B[0]) / 2, SP - (A[1] + B[1]) / 2, 0]);
    }
    for (const s of [1, -1]) quad(m, [s * hw, 0, z0], [s * hw, SP, z0], [s * hw, SP, z1], [s * hw, 0, z1], dk(shade(stone, 0.9)), [-s, 0, 0]);
    quad(m, [-hw, 0.01, z0], [hw, 0.01, z0], [hw, 0.01, z1], [-hw, 0.01, z1], dk(C.dirt), [0, 1, 0]);
  }
  // raised portcullis, bars hanging in the front arch
  if (!lod) {
    const z = D / 2 - 0.8;
    for (let i = -2; i <= 2; i++) { const x = i * 0.55, top = SP + Math.sqrt(Math.max(0.01, PR * PR - x * x)) - 0.05; beam(m, [x, top - 1.0, z], [x, top, z], 0.07, 0.07, C.iron, { amt: 0.03 }); }
    beam(m, [-1.5, SP + 1.0, z], [1.5, SP + 1.0, z], 0.07, 0.07, C.iron, { amt: 0.03 });
    beam(m, [-1.6, SP + 0.35, z], [1.6, SP + 0.35, z], 0.07, 0.07, C.iron, { amt: 0.03 });
  }
}

function drumTower(m, cx, cz, A0, H, stone, roofC, capC, lod, rot0) {
  const seg = lod ? 8 : 12, bat = 0.35, ap = (y) => A0 - bat * clamp((y - 0.6) / (H - 2.0), 0, 1), ac = ap(H - 1.4);
  const aoS = (q) => { const y = q[1]; let a = aoBase(q); if (y > H - 2.2 && y < H - 1.35) a *= 0.82; return a; };
  const prof = [], cl = [];
  const pt = (a, y, c) => { if (prof.length) cl.push(c); prof.push([a, y]); };
  const stoneC = surf(stone, 0.06, aoS), underC = surf(shade(stone, 0.6), 0.04), bandC = surf(capC, 0.05);
  if (lod) { pt(A0 + 0.1, -0.3, null); pt(ap(H - 1.4), H - 1.4, stoneC); pt(ac + 0.5, H - 1.4, underC); pt(ac + 0.5, H + 0.5, bandC); }
  else {
    pt(A0 + 0.25, -0.3, null); pt(A0 + 0.25, 0.6, surf(shade(stone, 0.8), 0.06, aoBase)); pt(A0, 0.6, surf(shade(stone, 0.8), 0.04));
    for (let i = 1; i <= 3; i++) { const y = lerp(0.6, H - 1.4, i / 3); pt(ap(y), y, stoneC); }
    pt(ac + 0.25, H - 1.4, underC); pt(ac + 0.25, H - 1.1, bandC); pt(ac + 0.5, H - 1.1, underC); pt(ac + 0.5, H, bandC);
  }
  const Ab = ac + 0.5, Ar = Ab - 1.0, rh = Ar * 1.55;
  if (lod) pt(Ar, H + 0.5, surf(C.dirt, 0.06));
  else { pt(Ab, H + 0.5, bandC); pt(Ab - 0.45, H + 0.5, bandC); pt(Ab - 0.45, H, surf(shade(stone, 0.85), 0.05)); pt(Ar, H, surf(C.dirt, 0.06)); }
  if (lod) pt(0, H + 0.5 + rh, surf(roofC, 0.05));
  else { pt(Ar * 0.55, H + rh * 0.55, surf(roofC, 0.05)); pt(Ar * 0.1, H + rh * 0.95, surf(shade(roofC, 1.05), 0.05)); pt(0, H + rh + 0.8, surf(C.iron, 0.03)); }
  const g = new Mesh();
  lathe(g, prof, seg, (i) => cl[i]);
  // merlons on the ring
  const nm = lod ? 5 : 12;
  for (let i = 0; i < nm; i++) {
    const t = (i + 0.5) * 2 * Math.PI / nm + (rot0 || 0), r = Ab - 0.225, mwid = 2 * Math.PI * Ab / nm * 0.6;
    bx(g, r * Math.cos(t), H + 0.5, r * Math.sin(t), mwid, 0.7, 0.45, capC, { rot: Math.PI / 2 - t, amt: lod ? 0.02 : 0.06, drop: lod ? [1, 5] : [5] });
  }
  if (!lod) for (const j of [0, 3, 6, 9]) {
    const dir = dirOf(j, seg), y = j % 6 === 0 ? 4.6 : 7.4;
    polyOnPlane(g, dir, ap(y), rectPts(0, y - 0.55, 0.14, 1.15), rgb(C.open), 0.07);
    polyOnPlane(g, dir, ap(H - 3.4), rectPts(0, H - 3.95, 0.14, 1.15), rgb(C.open), 0.07);
  }
  m.add(g, mat.translate(cx, 0, cz));
}

function gatehouse(seed, p, lod) {
  const rnd = rng(`gate|${seed}`), J = jitter(rnd), k = dims(rnd);
  const type = p.type || (rng(`gatetype|${seed}`)() < 0.5 ? 'twin' : 'block');
  const H = Math.max(p.height * k(), PH + 4), stone = J(C.stone), capC = J(C.stoneLt), roofC = J(C.slate), tileC = J(C.tile);
  const m = new Mesh();
  if (type === 'twin') {
    const W = 11.2 * k(), D = 6.6 * k(), A0 = 3.3 * k(), Hb = Math.max(H - 3, PH + 2.2), dz = 0.4;
    gateFaces(m, W, Hb, D, stone, lod, J(C.stoneLt));
    // flat leads between the drums, parapet front and back
    quad(m, [-W / 2, Hb, -D / 2], [W / 2, Hb, -D / 2], [W / 2, Hb, D / 2], [-W / 2, Hb, D / 2], surf(shade(C.slate, 0.9), 0.04), [0, 1, 0]);
    const xe = Math.min(W / 2 - 1.5, 3.9);
    for (const s of [1, -1]) parapetLine(m, [-xe, s * (D / 2 + 0.03)], [xe, s * (D / 2 + 0.03)], Hb, [0, s], { th: 0.45, merH: 0.7, col: capC, lod, pitch: lod ? 3.0 : 2.0 });
    for (const s of [-1, 1]) drumTower(m, s * W / 2, dz, A0, H, stone, roofC, capC, lod, 0);
    if (!lod) { // front windows between drum and passage
      for (const s of [1, -1]) for (const x of [-1, 1]) {
        const xw = x * (PW / 2 + 0.6);
        if (Math.abs(xw) < W / 2 - A0 - 0.2) continue;
        void xw;
      }
      for (const s of [1, -1]) { const z = s * (D / 2 + 0.04); quad(m, [-0.35 * s, SP + PR + 1.2, z], [0.35 * s, SP + PR + 1.2, z], [0.35 * s, SP + PR + 2.8, z], [-0.35 * s, SP + PR + 2.8, z], rgb(C.open), [0, 0, s]); }
    }
  } else {
    const W = 12.4 * k(), D = 8.6 * k();
    gateFaces(m, W, H, D, stone, lod, J(C.stoneLt));
    quad(m, [-W / 2, H, -D / 2], [W / 2, H, -D / 2], [W / 2, H, D / 2], [-W / 2, H, D / 2], surf(shade(C.slate, 0.9), 0.04), [0, 1, 0]);
    // machicolation: corbelled parapet on the long sides
    const pz = D / 2 + 0.45;
    for (const s of [1, -1]) {
      bx(m, 0, H - 0.25, s * (D / 2 + 0.2), W + 0.3, 0.25, 0.65, capC, { drop: [5] });
      if (!lod) for (let x = -W / 2 + 0.8; x <= W / 2 - 0.7; x += 1.2) bx(m, x, H - 1.1, s * (D / 2 + 0.17), 0.4, 0.85, 0.34, shade(capC, 0.85), { amt: 0.05 });
      parapetLine(m, [-W / 2 - 0.15, s * pz], [W / 2 + 0.15, s * pz], H, [0, s], { th: 0.45, merH: 0.75, col: capC, lod, pitch: lod ? 3.2 : 2.0 });
      parapetLine(m, [s * W / 2, -D / 2], [s * W / 2, D / 2], H, [s, 0], { th: 0.45, merH: 0.75, col: capC, lod, pitch: lod ? 3.2 : 2.0 });
    }
    // central slate roof
    const rw = W - 4.0, rd = D - 3.6, rh = rd / 2 * 0.8;
    m.add(gableRoof(rw, rd, rh, surf(roofC, 0.05), 0.3, surf(stone, 0.05)), mat.translate(0, H + 0.2, 0));
    // stair turrets on the front corners
    for (const sx of [-1, 1]) {
      const t = new Mesh(), Ta = 1.7, Ht2 = H + 2.8, ap = () => Ta;
      void ap;
      lathe(t, [[Ta + 0.15, -0.3], [Ta + 0.15, 0.5], [Ta, 0.5], [Ta, Ht2], [Ta + 0.4, Ht2], [Ta + 0.4, Ht2 + 0.01], [0, Ht2 + 2.4]], 4,
        (i) => [surf(shade(stone, 0.85), 0.05, aoBase), surf(stone, 0.05), surf(stone, 0.05, aoBase), surf(shade(stone, 0.5), 0.03), surf(shade(tileC, 0.9), 0.05), surf(tileC, 0.05)][i] || surf(tileC, 0.05));
      m.add(t, mat.translate(sx * (W / 2 - 0.1), 0, D / 2 - 0.1));
    }
    if (!lod) {
      for (const s of [1, -1]) {
        const z = s * (D / 2 + 0.04), dk = rgb(C.open);
        for (const x of [-4.3, -2.7, 2.7, 4.3]) for (const y of [H * 0.45, H * 0.72]) {
          quad(m, [x - 0.4, y, z], [x + 0.4, y, z], [x + 0.4, y + 1.35, z], [x - 0.4, y + 1.35, z], dk, [0, 0, s]);
          bx(m, x, y - 0.1, z + s * 0.06, 1.0, 0.1, 0.18, capC);
        }
      }
    }
  }
  return m;
}

// =====================================================================================
// windmills
// =====================================================================================
/** One sail in the local frame: axle along +Z through the origin, stock along +Y, lattice on the +X side with weather twist. */
function sailMesh(Rs, lod, woodC, stockC) {
  const m = new Mesh(), r1 = Rs * 0.26, w = (y) => lerp(1.5, 2.1, clamp((y - r1) / (Rs - r1), 0, 1));
  const alpha = (y) => lerp(0.3, 0.08, clamp((y - r1) / (Rs - r1), 0, 1));
  const S = (x, y) => [x, y, 0.14 + x * Math.tan(alpha(y))];
  bx(m, 0, 0.5, 0, 0.26, Rs - 0.5, 0.22, stockC, { drop: [] });
  const n = lod ? 3 : Math.max(4, Math.round((Rs - r1) / 0.62)), col = rgb(woodC);
  const ys = Array.from({ length: n + 1 }, (_, i) => lerp(r1, Rs, i / n));
  for (let i = 0; i <= n; i++) {
    const y = ys[i], hh = i === n || i === 0 ? 0.07 : 0.045;
    quad2(m, S(0.13, y - hh), S(w(y), y - hh), S(w(y), y + hh), S(0.13, y + hh), col);
    if (i < n) quad2(m, S(w(y) - 0.1, y), S(w(ys[i + 1]) - 0.1, ys[i + 1]), S(w(ys[i + 1]), ys[i + 1]), S(w(y), y), col);
  }
  return m;
}
function addSails(m, Rs, lod, hub, tilt, phase, woodC, stockC) {
  const sail = sailMesh(Rs, lod, woodC, stockC);
  for (let i = 0; i < 4; i++) m.add(sail, mat.chain(mat.translate(hub[0], hub[1], hub[2]), mat.rotX(tilt), mat.rotZ(phase + i * Math.PI / 2)));
  // hub
  m.add(cylinder(0.42, 0.42, 1.0, lod ? 6 : 8, surf(C.timber, 0.05)), mat.chain(mat.translate(hub[0], hub[1], hub[2] - 0.4), mat.rotX(tilt), mat.rotX(Math.PI / 2)));
}

function windmill(seed, p, lod) {
  const post = p.type === 'post', rnd = rng(`windmill|${p.type}|${seed}`), J = jitter(rnd), k = dims(rnd);
  const tilt = -8 * Math.PI / 180, phase = (14 + rnd() * 18) * Math.PI / 180;
  const wood = J(C.timber), stockC = shade(wood, 0.7), m = new Mesh();
  if (!post) {
    const H = 11 * k(), A0 = 3.6 * k(), A1 = 2.35 * k(), Rs = 9 * k();
    const ap = (y) => lerp(A0, A1, clamp((y - 0.6) / (H - 0.6), 0, 1)), stone = J(C.stone), plinthC = J(C.stoneDk);
    const capC = J(C.timber), seg = lod ? 8 : 12;
    const aoS = (q) => { const y = q[1]; let a = aoBase(q); if (y > H - 0.9) a *= 0.85; return a; };
    const prof = [[A0 + 0.25, -0.3], [A0 + 0.25, 0.6], [A0, 0.6]], cl = [surf(plinthC, 0.06, aoBase), surf(plinthC, 0.04)];
    for (let i = 1; i <= (lod ? 1 : 4); i++) { const y = lerp(0.6, H, i / (lod ? 1 : 4)); prof.push([ap(y), y]); cl.push(surf(stone, 0.06, aoS)); }
    // rotating cap: eave soffit, dome rings
    prof.push([A1 + 0.4, H]); cl.push(surf(shade(capC, 0.55), 0.03));
    if (lod) { prof.push([0, H + 2.4]); cl.push(surf(capC, 0.05)); }
    else {
      prof.push([A1 + 0.3, H + 0.55]); cl.push(surf(capC, 0.05));
      prof.push([A1 - 0.4, H + 1.5]); cl.push(surf(shade(capC, 1.05), 0.05));
      prof.push([0.9, H + 2.2]); cl.push(surf(capC, 0.05));
      prof.push([0, H + 2.5]); cl.push(surf(shade(capC, 0.95), 0.05));
    }
    lathe(m, prof, seg, (i) => cl[i]);
    // stage (timber gallery ring) and openings
    if (!lod) {
      const ys = 3.8, ar = ap(ys);
      lathe(m, [[ar, ys - 0.05], [ar + 0.9, ys - 0.05], [ar + 0.9, ys + 0.1], [ar, ys + 0.1]], seg, () => surf(wood, 0.05));
      polyOnPlane(m, dirOf(0, seg), ap(1.7), archPts(0, 0.6, 1.4, 2.3), rgb(C.door), 0.07);
      polyOnPlane(m, dirOf(0, seg), ap(1.7), archPts(0, 0.6, 1.7, 2.6), shade(C.stoneLt, 0.9), 0.04);
      for (const [j, y] of [[3, 5.6], [6, 5.6], [9, 5.6], [2, 8.4], [4, 8.4], [8, 8.4], [10, 8.4]]) polyOnPlane(m, dirOf(j, seg), ap(y), rectPts(0, y, 0.55, 0.9), rgb(C.open), 0.07);
    } else polyOnPlane(m, dirOf(0, seg), ap(1.7), archPts(0, 0.6, 1.4, 2.3), rgb(C.door), 0.07);
    // wind shaft and sails
    const hubY = H + 1.25, hubZ = 3.7, dir = [0, -Math.sin(tilt), Math.cos(tilt)], hub = [0, hubY, hubZ];
    beam(m, [0, hubY - dir[1] * 3.2, hubZ - dir[2] * 3.2], [0, hubY, hubZ], 0.38, 0.38, wood, { drop: [] });
    addSails(m, Rs, lod, hub, tilt, phase, wood, stockC);
    return m;
  }
  // ----- post mill: timber body on a trestle
  const Rs = 5.6 * k(), bw = 3.8 * k(), bd = 4.8 * k(), yF = 3.9, wh = 3.5, hubY = Rs + 0.9, hubZ = bd / 2 + 0.9;
  const board = J('#6f5237'), roofC = J(C.timber), stone = J(C.stone);
  const aoB = (q) => { const y = q[1]; return y > yF + wh - 0.4 ? 0.82 : 1; };
  // footings, cross-trees, post, quarter bars
  if (lod) bx(m, 0, -0.3, 0, 4.4, 0.35, 4.4, stone, { amt: 0.04 });
  else {
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bx(m, x * 1.9, -0.3, z * 1.9, 0.8, 0.65, 0.8, stone, { amt: 0.07 });
    beam(m, [-2.1, 0.45, 0], [2.1, 0.45, 0], 0.3, 0.3, wood, { drop: [] });
    beam(m, [0, 0.45, -2.1], [0, 0.45, 2.1], 0.3, 0.3, wood, { drop: [] });
  }
  bx(m, 0, 0.3, 0, 0.62, yF - 0.3, 0.62, wood, { drop: [] });
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(m, [x * 1.9, 0.0, z * 1.9], [x * 0.3, 2.9, z * 0.3], 0.2, 0.2, shade(wood, 0.9));
  if (!lod) for (const s of [-1, 1]) { beam(m, [s * 1.9, 0.5, -1.9], [s * 1.9, 0.5, 1.9], 0.18, 0.18, shade(wood, 0.95), { drop: [] }); }
  // floor frame, body walls, roof
  bx(m, 0, yF - 0.35, 0, bw + 0.4, 0.35, bd + 0.4, shade(wood, 0.8), { drop: [] });
  m.add(dropFaces(box(bw, wh, bd, surf(board, 0.05, aoB)), [5]), mat.translate(0, yF, 0));
  if (!lod) {
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bx(m, x * bw / 2, yF, z * bd / 2, 0.16, wh, 0.16, wood, { drop: [] });
    bx(m, 0, yF + wh - 0.14, 0, bw + 0.12, 0.14, bd + 0.12, wood, { drop: [] });
    // small windows and the door at the back
    for (const s of [-1, 1]) quad(m, [s * (bw / 2 + 0.03), yF + 1.5, -0.4], [s * (bw / 2 + 0.03), yF + 1.5, 0.4], [s * (bw / 2 + 0.03), yF + 2.5, 0.4], [s * (bw / 2 + 0.03), yF + 2.5, -0.4], rgb(C.open), [s, 0, 0]);
    quad(m, [-0.45, yF + 0.2, -bd / 2 - 0.03], [0.45, yF + 0.2, -bd / 2 - 0.03], [0.45, yF + 2.1, -bd / 2 - 0.03], [-0.45, yF + 2.1, -bd / 2 - 0.03], rgb(C.door), [0, 0, -1]);
  }
  m.add(gableRoof(bd, bw, bw * 0.5 * 0.85, surf(roofC, 0.05), 0.2, surf(board, 0.05)), mat.chain(mat.translate(0, yF + wh, 0), mat.rotY(Math.PI / 2)));
  // tail pole and ladder at the back
  const tb = [0, yF + 0.3, -bd / 2 - 0.1], te = [0, 0.7, -bd / 2 - 3.9];
  beam(m, tb, te, 0.22, 0.22, wood, { drop: [] });
  if (!lod) {
    for (const s of [-1, 1]) beam(m, [s * 0.4, 0, -bd / 2 - 3.2], [s * 0.4, yF, -bd / 2 - 0.35], 0.1, 0.1, shade(wood, 0.9), { drop: [] });
    for (let i = 1; i <= 6; i++) { const t = i / 7, y = yF * t, z = lerp(-bd / 2 - 3.2, -bd / 2 - 0.35, t); beam(m, [-0.4, y, z], [0.4, y, z], 0.08, 0.08, wood, { drop: [] }); }
  }
  // shaft and sails
  const dir = [0, -Math.sin(tilt), Math.cos(tilt)], hub = [0, hubY, hubZ];
  if (!lod) beam(m, [0, hubY - dir[1] * 2.8, hubZ - dir[2] * 2.8], [0, hubY, hubZ], 0.34, 0.34, wood, { drop: [] });
  addSails(m, Rs, lod, hub, tilt, phase, wood, stockC);
  return m;
}

// =====================================================================================
// watermill
// =====================================================================================
function waterWheel(m, xc, yc, Rw, ww, lod, over, wood, dark) {
  const g = new Mesh(), nRim = lod ? 10 : 16, Rr = Rw - 0.28;
  const rimAt = (i, z) => { const a = (i / nRim) * 2 * Math.PI; return [Rr * Math.cos(a), Rr * Math.sin(a), z]; };
  if (lod) { // open drum: outer and inner rim surfaces, two cross beams
    for (let i = 0; i < nRim; i++) {
      const a0 = (i / nRim) * 2 * Math.PI, a1 = ((i + 1) / nRim) * 2 * Math.PI, am = (a0 + a1) / 2, c = surf(wood, 0.06);
      const P = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z];
      quad(g, P(Rw, a0, -ww / 2), P(Rw, a1, -ww / 2), P(Rw, a1, ww / 2), P(Rw, a0, ww / 2), c, [Math.cos(am), Math.sin(am), 0]);
      quad(g, P(Rr, a0, -ww / 2), P(Rr, a1, -ww / 2), P(Rr, a1, ww / 2), P(Rr, a0, ww / 2), c, [-Math.cos(am), -Math.sin(am), 0]);
    }
    beam(g, [-Rr, 0, 0], [Rr, 0, 0], 0.2, 0.2, wood, { drop: [] });
    beam(g, [0, -Rr, 0], [0, Rr, 0], 0.2, 0.2, wood, { drop: [] });
  } else {
    for (const z of [-ww / 2 + 0.07, ww / 2 - 0.07]) for (let i = 0; i < nRim; i++) beam(g, rimAt(i, z), rimAt(i + 1, z), 0.13, 0.12, wood, { drop: [] });
    for (const z of [-ww / 2 + 0.2, ww / 2 - 0.2]) for (let i = 0; i < 8; i++) { const a = (i / 8) * 2 * Math.PI + 0.2; beam(g, [0.3 * Math.cos(a), 0.3 * Math.sin(a), z], [Rr * Math.cos(a), Rr * Math.sin(a), z], 0.14, 0.12, shade(wood, 0.9), { drop: [] }); }
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 2 * Math.PI, b = a + 0.14; beam(g, [Rr * Math.cos(a), Rr * Math.sin(a), 0], [Rw * Math.cos(b), Rw * Math.sin(b), 0], ww - 0.1, 0.05, shade(wood, 1.05), { drop: [] }); }
  }
  g.add(cylinder(0.38, 0.38, ww + 0.2, lod ? 6 : 8, surf(wood, 0.04)), mat.chain(mat.translate(0, 0, -ww / 2 - 0.1), mat.rotX(Math.PI / 2)));
  void over; void dark;
  m.add(g, mat.chain(mat.translate(xc, yc, 0), mat.rotY(Math.PI / 2)));
}

function watermill(seed, p, lod) {
  const rnd = rng(`watermill|${seed}`), J = jitter(rnd), k = dims(rnd), pr = rng(`watermillopt|${seed}`);
  const style = p.style || (pr() < 0.5 ? 'stone' : 'timber'), over = (p.wheel || (pr() < 0.5 ? 'overshot' : 'undershot')) === 'overshot';
  const W = 8 * k(), D = 6.4 * k(), fh = 2.9, H = fh * 2, Rw = 2.5, ww = 1.3;
  const wall = J(style === 'stone' ? C.stone : C.plaster), plinthC = J(C.stoneDk), roofC = J(style === 'stone' ? C.slate : C.tile), wood = J(C.timber), stone = J(C.stone);
  const aoW = (q) => { const y = q[1]; let a = aoBase(q); if (y > H - 0.5) a *= 0.78; else if (y > fh - 0.1 && y < fh + 0.1) a *= 0.92; return a; };
  const m = new Mesh();
  // walls: plinth, wall stacks, eave band
  bx(m, 0, -0.3, 0, W + 0.12, 0.9, D + 0.12, plinthC, { amt: 0.06 });
  m.add(dropFaces(box(W, fh - 0.6, D, surf(wall, 0.04, aoW)), [5]), mat.translate(0, 0.6, 0));
  m.add(dropFaces(box(W, fh, D, surf(wall, 0.04, aoW)), [5]), mat.translate(0, fh, 0));
  if (style === 'timber') {
    const posts = lod ? [] : [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [x, z] of posts) bx(m, x * (W / 2), 0.6, z * (D / 2), 0.2, H - 0.6, 0.2, wood, { drop: [5] });
    if (!lod) {
      for (const z of [-1, 1]) {
        bx(m, 0, fh - 0.12, z * (D / 2 + 0.01), W + 0.1, 0.24, 0.1, wood, { drop: [1, 5] });
        for (let x = -W / 2 + 1.4; x < W / 2 - 0.5; x += 1.4) bx(m, x, 0.6, z * (D / 2 + 0.01), 0.12, H - 0.6, 0.08, wood, { drop: [5] });
      }
    }
  } else if (!lod) bx(m, 0, fh - 0.08, 0, W + 0.1, 0.2, D + 0.1, C.stoneLt, { drop: [5] });
  // roof, ridge along X
  const rh = D / 2 * Math.tan(38 * Math.PI / 180);
  m.add(gableRoof(W, D, rh, surf(roofC, 0.05), 0.4, surf(wall, 0.05)), mat.translate(0, H, 0));
  if (!lod) bx(m, -W / 2 + 1.0, H, -D / 4, 0.9, rh + 0.9, 0.9, style === 'stone' ? C.stoneDk : C.tile, { amt: 0.06 });
  else bx(m, -W / 2 + 1.0, H, -D / 4, 0.9, rh + 0.9, 0.9, C.stoneDk);
  // openings
  const dk = rgb(C.open);
  const win = (x, y, z, s, w, h) => { const zz = z + s * 0.03; quad(m, [x - w / 2, y, zz], [x + w / 2, y, zz], [x + w / 2, y + h, zz], [x - w / 2, y + h, zz], dk, [0, 0, s]); if (!lod) bx(m, x, y - 0.1, z + s * 0.07, w + 0.24, 0.1, 0.16, C.stoneLt); };
  quad(m, [-1.9, 0.6, D / 2 + 0.04], [-0.7, 0.6, D / 2 + 0.04], [-0.7, 2.6, D / 2 + 0.04], [-1.9, 2.6, D / 2 + 0.04], rgb(C.door), [0, 0, 1]);
  if (!lod) {
    bx(m, -1.3, 2.6, D / 2 + 0.05, 1.5, 0.14, 0.2, C.stoneLt);
    win(1.3, 1.2, D / 2, 1, 0.9, 1.0);
    for (const x of [-2.6, 0, 2.6]) win(x, fh + 0.9, D / 2, 1, 0.8, 1.1);
    for (const x of [-2.2, 0.6, 2.4]) win(x, 1.2, -D / 2, -1, 0.8, 1.0);
    for (const x of [-2.2, 0.6, 2.4]) win(x, fh + 0.9, -D / 2, -1, 0.8, 1.1);
    for (const z of [-1.4, 1.4]) { const xx = -W / 2 - 0.03; quad(m, [xx, fh + 0.9, z - 0.4], [xx, fh + 0.9, z + 0.4], [xx, fh + 2.0, z + 0.4], [xx, fh + 2.0, z - 0.4], dk, [-1, 0, 0]); }
  }
  // wheel, axle, pit walls
  const xc = W / 2 + 0.25 + ww / 2, yc = Rw - 0.8;
  waterWheel(m, xc, yc, Rw, ww, lod, over, wood, dk);
  beam(m, [W / 2 - 0.15, yc, 0], [xc + ww / 2 + 0.25, yc, 0], 0.26, 0.26, shade(wood, 0.8), { drop: [] });
  for (const s of [-1, 1]) bx(m, xc + 0.1, -0.85, s * (Rw + 0.6), ww + 1.5, 1.35, 0.5, stone, { amt: 0.06 });
  // flume (overshot) or sluice apron (undershot)
  if (over) {
    const yT = yc + Rw + 0.28, x0 = xc - 0.35, x1 = xc + 5.2, y1 = yT + 0.4, tw = 0.85;
    const c0 = [x0, yT, 0.15], c1 = [x1, y1, 0.15];
    beam(m, c0, c1, tw, 0.07, wood, { drop: [] }); // floor board (width along z, thickness vertical)
    for (const s of [-1, 1]) beam(m, [x0, yT + 0.2, 0.15 + s * tw / 2], [x1, y1 + 0.2, 0.15 + s * tw / 2], 0.06, 0.4, shade(wood, 0.9), { drop: [] });
    const bents = lod ? [x1 - 0.4] : [xc + 1.8, x1 - 0.4];
    for (const bxp of bents) {
      const yb = lerp(yT, y1, (bxp - x0) / (x1 - x0)) - 0.05;
      for (const s of [-1, 1]) bx(m, bxp, -0.3, 0.15 + s * (tw / 2 - 0.05), 0.16, yb + 0.3, 0.16, wood, { drop: [] });
      beam(m, [bxp, yb, -0.6], [bxp, yb, 0.9], 0.14, 0.12, wood, { drop: [] });
    }
  } else {
    beam(m, [xc, 0.15, -Rw - 1.9], [xc, -0.75, -Rw + 0.25], 1.2, 0.07, wood, { drop: [] });
    if (!lod) for (const s of [-1, 1]) bx(m, xc + s * 0.62, -0.3, -Rw - 1.0, 0.14, 1.2, 0.14, wood, { drop: [] });
  }
  return m;
}

// =====================================================================================
export const LANDMARKS = {
  wall_segment: { desc: 'Town wall segment along +X from x=0 to x=length: battered stone curtain (~2.5 m thick at the foot, ~1.9 m at the walk), wall walk at y=height with a crenellated parapet (merlons and embrasures) on the outer (+Z) side, plain inner (-Z) side with putlog holes. Foundation to y=-0.3. height varies +-10 % with the seed; length is exact so segments butt cleanly.', ...mk({ length: 12, height: 7 }, wallSegment) },
  wall_tower: { desc: 'Wall tower centred on the origin (walls butt into it along +-X), slightly wider than the wall: shape round (16-sided, conical slate roof) or square (pyramid tile roof), battered stone shaft, corbelled eaves, arrow slits (windows on the square tower) and a raised door on +Z. height = masonry top (eaves); the roof rises another ~7 m (round) or ~5 m (square).', ...mk({ shape: 'round', height: 13 }, wallTower) },
  gatehouse: { desc: 'Town gatehouse with an arched passage (3.5 m wide, 4.5 m high) along Z, voussoir rings, dark vault and a raised portcullis. type "twin" (two drum towers with crenellations and conical slate roofs flanking a low block) or "block" (single massive block, corbelled machicolation, crenellations, slate roof and two corner turrets); chosen by seed when type is omitted. height = tower / block top (the twin block is ~3 m lower).', ...mk({ height: 14 }, gatehouse) },
  windmill: { desc: 'Windmill facing +Z. type "tower": tapered stone tower ~11 m with a timber gallery, rotating dome cap and four lattice sails ~18 m across (hub at ~12 m, tilted back 8 deg, no sail exactly vertical). type "post": timber body on a trestle, with the tail pole and ladder at the back and ~11 m sails. Sails are double-sided lattices.', ...mk({ type: 'tower' }, windmill) },
  watermill: { desc: 'Two-storey mill house (stone with slate or plastered timber-frame with tile; ridge along X, door on +Z) with a ~5 m waterwheel on its +X gable, axle at y=1.7 and lowest paddle at y=-0.8 between stone pit walls. Overshot wheel with a short timber flume on trestles, or undershot with a sluice apron; style (stone | timber) and wheel (overshot | undershot) can be forced via params, otherwise they follow the seed.', ...mk({}, watermill) },
};
