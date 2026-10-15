// Procedural waterfront: timber jetty, stone quay, rowboat, fishing boat, medieval cog.
// Pure (seed, params) -> Mesh; vertex colours only. Metres, Y up, front +Z.
// WATER CONVENTION: y = 0 is the water surface for everything here. Quays / jetties
// rise above it and their foundations reach down to y ~ -2.5 (sea bed). Boats float:
// hull waterline at y = 0 (draft below, freeboard above), bow toward +Z, centred on x = 0, z = 0.
// Uses only the mesh.mjs builder API.

import { Mesh, mat, rng, rgb } from './mesh.mjs';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const GLASS = '#252b33';
const hash3 = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
const shade = (c, k) => rgb(c).map((v) => clamp(v * k, 0, 1));
const mix = (a, b, t) => { a = rgb(a); b = rgb(b); return a.map((v, i) => v + (b[i] - v) * t); };
const vary = (c, amt = 0.05) => {
  const b = rgb(c);
  return (p) => { const k = 1 + (hash3(p[0], p[1], p[2]) * 2 - 1) * amt; return [clamp(b[0] * k, 0, 1), clamp(b[1] * k, 0, 1), clamp(b[2] * k, 0, 1)]; };
};
function jitter(rnd) { // +-8 % lightness, slight hue shift per individual
  const k = 1 + (rnd() * 2 - 1) * 0.08, h = [1 + (rnd() - 0.5) * 0.05, 1, 1 + (rnd() - 0.5) * 0.05];
  return (c) => rgb(c).map((v, i) => clamp(v * k * h[i], 0, 1));
}
/** Seeded rng; the first draws of consecutive small seeds are correlated, so burn a few. */
function srng(name, seed) { const r = rng(`${name}|${seed}`); for (let i = 0; i < 4; i++) r(); return r; }
const ACCENTS = ['#6b2e2a', '#2f4a5c', '#5d6b3a'];

// ---------- vectors
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------- shape helpers (all flat shaded unless noted)
/** Axis-aligned box with selectable faces. skip: names of faces to leave out (px,nx,py,ny,pz,nz). */
function aabb(x0, y0, z0, x1, y1, z1, color, skip = []) {
  const f = {
    pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    py: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
  };
  const tris = [];
  for (const k of Object.keys(f)) if (!skip.includes(k)) { const [a, b, c, d] = f[k]; tris.push([a, b, c], [a, c, d]); }
  return new Mesh().flatTris(tris, color);
}
const ngon = (r, n, ph = 0) => Array.from({ length: n }, (_, k) => [r * Math.cos(ph + 2 * Math.PI * k / n), r * Math.sin(ph + 2 * Math.PI * k / n)]);
const rect = (w, h) => [[w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2]];
function frame(d, up = [0, 1, 0]) { // e1 x e2 = d
  let e2 = sub(up, mul(d, dot(up, d)));
  if (vlen(e2) < 1e-3) { up = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]; e2 = sub(up, mul(d, dot(up, d))); }
  e2 = nrm(e2); return [cross(e2, d), e2];
}
/** Prism from point a to point b; cross-section polygons (CCW in the (e1,e2) frame) may differ at the two ends. */
function prism(a, b, poly0, poly1, color, { caps = true, capA = caps, capB = caps, up = [0, 1, 0] } = {}) {
  const d = nrm(sub(b, a)), [e1, e2] = frame(d, up), n = poly0.length;
  const ring = (p, poly) => poly.map(([s, t]) => [p[0] + e1[0] * s + e2[0] * t, p[1] + e1[1] * s + e2[1] * t, p[2] + e1[2] * s + e2[2] * t]);
  const ra = ring(a, poly0), rb = ring(b, poly1), tris = [];
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; tris.push([ra[k], ra[k1], rb[k1]], [ra[k], rb[k1], rb[k]]); }
  if (capB) for (let i = 1; i < n - 1; i++) tris.push([rb[0], rb[i], rb[i + 1]]);
  if (capA) for (let i = 1; i < n - 1; i++) tris.push([ra[0], ra[i + 1], ra[i]]);
  return new Mesh().flatTris(tris, color);
}
const strut = (a, b, w, h, color, o) => prism(a, b, rect(w, h), rect(w, h), color, o);
const tube = (a, b, r0, r1, n, color, o) => prism(a, b, ngon(r0, n), ngon(r1, n), color, o);

/** Shared-vertex grid P[row][col] of [x,y,z,...]; smooth normals. flip reverses winding; hint auto-orients. */
function gridMesh(P, colFn, { flip = false, wrap = false, hint = null } = {}) {
  const m = new Mesh(), R = P.length, C = P[0].length;
  for (const row of P) for (const q of row) { m.pos.push(q[0], q[1], q[2]); m.nrm.push(0, 0, 1); m.col.push(...rgb(colFn ? colFn(q) : '#808080')); }
  const tris = [], cc = wrap ? C : C - 1;
  for (let r = 0; r < R - 1; r++) for (let k = 0; k < cc; k++) {
    const A = r * C + k, B = r * C + (k + 1) % C, Cc = (r + 1) * C + (k + 1) % C, D = (r + 1) * C + k;
    const onAxis = (i) => Math.abs(m.pos[i * 3]) < 1e-9; // keep slivers lying in the x=0 plane out of the triangulation
    if ((onAxis(A) && onAxis(Cc) && onAxis(D)) || (onAxis(A) && onAxis(B) && onAxis(Cc))) tris.push([A, B, D], [B, Cc, D]);
    else tris.push([A, B, Cc], [A, Cc, D]);
  }
  const nOf = (t) => { const [a, b, c] = t.map((i) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]); return cross(sub(b, a), sub(c, a)); };
  if (hint) { let s = 0; for (const t of tris) s += dot(nOf(t), hint); flip = s < 0; }
  for (const t of tris) {
    if (vlen(nOf(t)) < 1e-10) continue;
    m.idx.push(...(flip ? [t[0], t[2], t[1]] : t));
  }
  return m.recomputeNormals();
}
/** Surface of revolution about +Y. profile: [[r, y], ...] bottom to top. Smooth. */
function lathe(profile, n, color) {
  const P = profile.map(([r, y]) => Array.from({ length: n }, (_, j) => { const a = 2 * Math.PI * j / n; return [r * Math.cos(a), y, -r * Math.sin(a)]; }));
  return gridMesh(P, typeof color === 'function' ? color : () => color, { wrap: true, flip: false });
}
/** Torus-like ring (axis +Z) of centre-line radius R and square-ish tube radius r. */
function ring(R, r, nA, nT, color) {
  const P = [];
  for (let i = 0; i < nA; i++) {
    const a = 2 * Math.PI * i / nA, row = [];
    for (let j = 0; j < nT; j++) { const b = 2 * Math.PI * j / nT + Math.PI / nT, rr = R + r * Math.cos(b); row.push([rr * Math.cos(a), rr * Math.sin(a), r * Math.sin(b)]); }
    P.push(row);
  }
  P.push(P[0]);
  return gridMesh(P, () => color, { wrap: true, hint: null, flip: true });
}
// oriented single triangle / quad
function triH(m, a, b, c, color, hint) { if (dot(cross(sub(b, a), sub(c, a)), hint) < 0) [b, c] = [c, b]; m.flatTris([[a, b, c]], color); }
function quadH(m, a, b, c, d, color, hint) { if (dot(cross(sub(b, a), sub(c, a)), hint) < 0) { [b, d] = [d, b]; } m.flatTris([[a, b, c], [a, c, d]], color); }
function fanH(m, pts, center, color, hint) { for (let i = 0; i < pts.length - 1; i++) triH(m, center, pts[i], pts[i + 1], color, hint); }
/** Copy of a one-sided surface mesh with reversed winding and negated normals, pushed `off` behind. */
function backSide(src, off = 0.006) {
  const m = new Mesh();
  for (let i = 0; i < src.pos.length; i += 3) {
    m.pos.push(src.pos[i] - src.nrm[i] * off, src.pos[i + 1] - src.nrm[i + 1] * off, src.pos[i + 2] - src.nrm[i + 2] * off);
    m.nrm.push(-src.nrm[i], -src.nrm[i + 1], -src.nrm[i + 2]); m.col.push(src.col[i], src.col[i + 1], src.col[i + 2]);
  }
  for (let t = 0; t < src.idx.length; t += 3) m.idx.push(src.idx[t], src.idx[t + 2], src.idx[t + 1]);
  return m;
}
const twoSided = (m, off) => m.add(backSide(m, off));
/** Thin rope: two crossed double-sided ribbons (8 tris) from a to b. */
function rope(m, a, b, w, color) {
  const d = nrm(sub(b, a));
  for (const up of [[0, 1, 0], [1, 0, 0], [0, 0, 1]]) { // pick a width axis not parallel to the rope
    if (Math.abs(dot(up, d)) < 0.9) { var ax = up; break; } // eslint-disable-line no-var
  }
  const w1 = nrm(cross(d, ax)), w2 = nrm(cross(d, w1));
  for (const wd of [w1, w2]) {
    const p = [add(a, mul(wd, -w / 2)), add(a, mul(wd, w / 2)), add(b, mul(wd, w / 2)), add(b, mul(wd, -w / 2))];
    m.flatTris([[p[0], p[1], p[2]], [p[0], p[2], p[3]], [p[0], p[2], p[1]], [p[0], p[3], p[2]]], color);
  }
}

// =====================================================================================
// JETTY
// =====================================================================================
function jetty(seed, p, lod) {
  const rnd = srng('jetty', seed), J = jitter(rnd);
  const L = p.length * (0.9 + 0.2 * rnd()), W = p.width * (0.9 + 0.2 * rnd());
  const rail = rnd() < 0.6, railSide = rnd() < 0.5 ? -1 : 1;
  const plankC = J('#74644c'), pileC = J('#4f3d2b'), beamC = J('#5e4630'), railC = J('#6f5a40'), ironC = '#2e2d2b';
  const m = new Mesh(), nb = Math.max(2, Math.round(L / 3)) + 1, xp = W / 2 - 0.2;
  const bentZ = (i) => 0.3 + (i * (L - 0.6)) / (nb - 1);
  const algae = (_x, y) => (y < -0.3 ? [0.6, 0.66, 0.58] : y < 0.7 ? [0.76, 0.86, 0.66] : 1);
  const piles = new Mesh();
  const bentStep = lod ? 2 : 1;
  for (let i = 0; i < nb; i += bentStep) {
    const z = bentZ(i), last = i >= nb - 1 - (nb - 1) % bentStep && i >= nb - bentStep;
    const xs = lod ? [-xp, xp] : (i % 2 ? [-xp, 0, xp] : [-xp, xp]);
    for (const x of xs) {
      const lean = (hash3(i, x, 3) - 0.5) * 0.06, top = (i === nb - 1 && x !== 0) ? 1.8 : 0.9;
      const a = [x + lean, -2.5, z], b = [x, top, z];
      piles.add(lod ? tube(a, b, 0.14, 0.12, 4, pileC, { caps: false, capB: top > 1 }) : tube(a, b, 0.14, 0.12, 6, vary(pileC, 0.07), { capA: false, capB: top > 1 }));
    }
    if (!lod) {
      m.add(aabb(-W / 2 - 0.1, 0.62, z - 0.14, W / 2 + 0.1, 0.9, z + 0.14, vary(beamC, 0.05)));
      m.add(strut([-xp, -1.7, z + 0.17], [xp, 0.45, z + 0.17], 0.1, 0.13, beamC));
      m.add(strut([xp, -1.7, z - 0.17], [-xp, 0.45, z - 0.17], 0.1, 0.13, beamC));
    }
  }
  piles.tint(algae);
  m.add(piles);
  if (lod) {
    m.add(aabb(-W / 2 - 0.05, 0.62, 0, W / 2 + 0.05, 1.2, L, shade(plankC, 0.85), ['ny']));
    m.add(aabb(-W / 2, 1.2, 0, W / 2, 1.2001, L, plankC, ['nx', 'px', 'pz', 'nz', 'ny'])); // top face
  } else {
    for (const x of W > 3.4 ? [-W / 2 + 0.2, -W / 6, W / 6, W / 2 - 0.2] : [-W / 2 + 0.2, 0, W / 2 - 0.2]) m.add(aabb(x - 0.09, 0.9, 0, x + 0.09, 1.12, L, vary(beamC, 0.05)));
    for (const sg of [-1, 1]) m.add(aabb(Math.min(sg * W / 2, sg * W / 2 - sg * 0.1), 0.92, 0, Math.max(sg * W / 2, sg * W / 2 - sg * 0.1), 1.2, L, beamC, ['py']));
    // plank slats across the deck (top, +z and -z faces), tiny gaps
    let z = 0.0, i = 0;
    while (z < L - 0.1) {
      const pw = Math.min(L - z, 0.16 + 0.06 * hash3(i, 1, 2)), gap = 0.012, k = 0.88 + 0.24 * hash3(i, 3, 7), xo = (hash3(i, 5, 9) - 0.5) * 0.04;
      m.add(aabb(-W / 2 + 0.05 + xo, 1.12, z + gap / 2, W / 2 - 0.05 + xo, 1.2, z + pw - gap / 2, shade(plankC, k), ['nx', 'px', 'ny']));
      z += pw; i++;
    }
    m.add(aabb(-W / 2 - 0.3, 0.2, -0.6, W / 2 + 0.3, 1.18, 0.0, vary(beamC, 0.05))); // shore sill
    // ladder on the end face
    const lx = (rnd() < 0.5 ? -1 : 1) * (W / 2 - 0.5);
    for (const dx of [-0.17, 0.17]) m.add(aabb(lx + dx - 0.025, -0.9, L + 0.03, lx + dx + 0.025, 1.3, L + 0.08, ironC, ['ny']));
    for (let r = 0; r < 6; r++) m.add(aabb(lx - 0.17, -0.7 + r * 0.38, L + 0.04, lx + 0.17, -0.7 + r * 0.38 + 0.03, L + 0.09, ironC, ['nx', 'px', 'nz', 'py', 'ny']));
    // barrels on deck
    const nbar = rnd() < 0.7 ? 2 : 1;
    for (let k = 0; k < nbar; k++) {
      const bx = (rnd() - 0.5) * (W - 1.2), bz = L * (0.15 + 0.5 * rnd());
      m.add(lathe([[0, 1.2], [0.27, 1.2], [0.34, 1.5], [0.27, 1.8], [0, 1.8]], 8, vary('#6a4e30', 0.06)), mat.translate(bx, 0, bz));
    }
  }
  // bollards
  const bz = [L * 0.3, L * 0.65, L - 0.5], bollard = [[0, 1.18], [0.13, 1.18], [0.13, 1.4], [0.09, 1.46], [0.09, 1.52], [0.16, 1.58], [0.16, 1.63], [0, 1.63]];
  bz.forEach((z, k) => {
    for (const sg of k === 2 ? [-1, 1] : [(k % 2 ? 1 : -1)]) {
      const x = sg * (W / 2 - 0.22);
      if (lod) m.add(aabb(x - 0.14, 1.2, z - 0.14, x + 0.14, 1.6, z + 0.14, ironC, ['ny']));
      else m.add(lathe(bollard, 6, vary(ironC, 0.1)), mat.translate(x, 0, z));
    }
  });
  if (rail) {
    const x = railSide * (W / 2 - 0.06), np = Math.max(2, Math.round(L / (lod ? 6 : 2)));
    for (let j = 0; j <= np; j++) {
      const z = 0.15 + (j * (L - 0.3)) / np;
      m.add(aabb(x - 0.05, 1.2, z - 0.05, x + 0.05, 2.1, z + 0.05, railC, ['ny', 'py']));
    }
    m.add(aabb(x - 0.05, 2.04, 0, x + 0.05, 2.14, L, railC));
    if (!lod) m.add(aabb(x - 0.04, 1.62, 0, x + 0.04, 1.7, L, railC));
  }
  return m;
}

// =====================================================================================
// QUAY
// =====================================================================================
function quay(seed, p, lod) {
  const rnd = srng('quay', seed), J = jitter(rnd);
  const L = p.length * (0.9 + 0.2 * rnd()), top = (p.height - 0.6) * (0.95 + 0.1 * rnd()), D = 3.0, bottom = -2.5;
  const stone = J('#9a9284'), copeC = J('#b3ab9b'), jointC = '#38352f', ironC = '#2e2d2b';
  const stepsLeft = rnd() < 0.5, ironBollards = rnd() < 0.4;
  const m = new Mesh();
  // underwater tint / waterline algae
  const wet = (_x, y) => (y > 0.7 ? 1 : y > 0.1 ? mix([1, 1, 1], [0.8, 0.88, 0.7], (0.7 - y) / 0.6)[0] : y > -0.5 ? [0.7, 0.8, 0.62] : [0.5, 0.58, 0.5]);
  const face = new Mesh();
  if (lod) {
    face.add(aabb(0, bottom, -D, L, top - 0.22, 0, shade(stone, 0.85), ['ny', 'nz', 'py']));
    face.tint(wet);
  } else {
    face.flatTris([[[0, bottom, -0.02], [L, bottom, -0.02], [L, -0.6, -0.02]], [[0, bottom, -0.02], [L, -0.6, -0.02], [0, -0.6, -0.02]]], '#454a44');
    face.flatTris([[[0, -0.6, -0.02], [L, -0.6, -0.02], [L, top, -0.02]], [[0, -0.6, -0.02], [L, top, -0.02], [0, top, -0.02]]], jointC);
    let y = top - 0.22, c = 0;
    while (y > -0.6 + 1e-6) {
      const h = 0.34 + 0.06 * hash3(c, 1, 7), y0 = Math.max(-0.6, y - h);
      let x = -hash3(c, 5, 5) * 1.0;
      while (x < L) {
        const w = 0.8 + 0.5 * hash3(c, Math.round(x * 10), 2), xa = Math.max(0, x) + 0.012, xb = Math.min(L, x + w) - 0.012;
        if (xb - xa > 0.06) {
          const zz = 0.012 * hash3(Math.round(x * 10), c, 4), k = 0.9 + 0.2 * hash3(Math.round(x * 10), c, 8);
          face.flatTris([[[xa, y0 + 0.012, zz], [xb, y0 + 0.012, zz], [xb, y - 0.012, zz]], [[xa, y0 + 0.012, zz], [xb, y - 0.012, zz], [xa, y - 0.012, zz]]], vary(shade(stone, k), 0.03));
        }
        x += w;
      }
      y = y0; c++;
    }
    face.tint(wet);
  }
  m.add(face);
  // structure: ends, top, back, bottom
  const bodyC = vary(shade(stone, 0.92), 0.04);
  m.flatTris([[[0, bottom, 0], [0, top, 0], [0, top, -D]], [[0, bottom, 0], [0, top, -D], [0, bottom, -D]]], bodyC);
  m.flatTris([[[L, bottom, -D], [L, top, -D], [L, top, 0]], [[L, bottom, -D], [L, top, 0], [L, bottom, 0]]], bodyC);
  m.flatTris([[[L, bottom, -D], [0, bottom, -D], [0, top, -D]], [[L, bottom, -D], [0, top, -D], [L, top, -D]]], '#5d5448');
  m.flatTris([[[0, bottom, 0], [L, bottom, 0], [L, bottom, -D]], [[0, bottom, 0], [L, bottom, -D], [0, bottom, -D]]], '#3a3a36');
  // paving behind the coping
  if (lod) {
    m.flatTris([[[0, top - 0.02, -D], [L, top - 0.02, -D], [L, top - 0.02, -0.5]], [[0, top - 0.02, -D], [L, top - 0.02, -0.5], [0, top - 0.02, -0.5]]], J('#8a8374'));
  } else {
    m.flatTris([[[0, top - 0.03, -D], [L, top - 0.03, -D], [L, top - 0.03, -0.5]], [[0, top - 0.03, -D], [L, top - 0.03, -0.5], [0, top - 0.03, -0.5]]], jointC);
    const rows = 3, rz = (D - 0.5) / rows;
    for (let r = 0; r < rows; r++) {
      let x = -hash3(r, 2, 6) * 1.2;
      while (x < L) {
        const w = 1.2 + 0.6 * hash3(r, Math.round(x * 4), 1), xa = Math.max(0, x) + 0.015, xb = Math.min(L, x + w) - 0.015, za = -D + r * rz + 0.015, zb = -D + (r + 1) * rz - 0.015;
        if (xb - xa > 0.05) m.flatTris([[[xa, top - 0.01, zb], [xb, top - 0.01, zb], [xb, top - 0.01, za]], [[xa, top - 0.01, zb], [xb, top - 0.01, za], [xa, top - 0.01, za]]], vary(shade(J('#8a8374'), 0.92 + 0.16 * hash3(r, Math.round(x * 4), 5)), 0.03));
        x += w;
      }
    }
  }
  // coping
  if (lod) m.add(aabb(-0.02, top - 0.22, -0.5, L + 0.02, top, 0.07, copeC, ['ny']));
  else {
    let x = 0, c = 0;
    while (x < L - 0.05) {
      const w = Math.min(L - x, 1.0 + 0.4 * hash3(c, 9, 9));
      m.add(aabb(x + 0.01, top - 0.22, -0.5, x + w - 0.01, top, 0.07, vary(shade(copeC, 0.94 + 0.12 * hash3(c, 1, 1)), 0.03), ['ny']));
      x += w; c++;
    }
  }
  // steps: a descending flight projecting from the face at one end
  const sw = 1.7, sx0 = stepsLeft ? 0.35 : L - 0.35 - sw, sx1 = sx0 + sw, nSt = 7, rise = 0.3, tread = 0.38, y0 = top - 0.3;
  for (let i = 0; i < (lod ? 3 : nSt); i++) {
    if (lod) { // coarse ramp in three blocks
      const yy = y0 - i * rise * 2.3, za = i * tread * 2.3, zb = (i + 1) * tread * 2.3;
      m.add(aabb(sx0, -1.0, za, sx1, yy, zb, stone, ['ny', 'nz']));
    } else {
      const yy = y0 - i * rise, za = i * tread, zb = (i + 1) * tread;
      m.add(aabb(sx0, -1.0, za, sx1, yy, zb, vary(shade(stone, 0.96 + 0.08 * hash3(i, 3, 3)), 0.03), ['ny', 'nz']).tint(wet));
    }
  }
  if (!lod) {
    // fender piles, mooring rings, bollards
    for (const fx of [L * (0.3 + 0.1 * rnd()), L * (0.65 + 0.1 * rnd())]) {
      if (Math.abs(fx - (sx0 + sw / 2)) < 1.8) continue;
      m.add(aabb(fx - 0.13, -1.6, 0.0, fx + 0.13, top - 0.3, 0.24, vary('#4d3b2a', 0.06), ['ny']).tint(wet));
      for (const yy of [0.5, top - 0.7]) m.add(aabb(fx - 0.15, yy, -0.0, fx + 0.15, yy + 0.05, 0.27, ironC, ['ny']));
    }
    const ringX = [L * 0.2, L * 0.5, L * 0.8].map((x) => x + (rnd() - 0.5) * 1.0).filter((x) => x < sx0 - 0.3 || x > sx1 + 0.3);
    for (const rx of ringX) {
      m.add(aabb(rx - 0.07, top - 0.82, 0, rx + 0.07, top - 0.62, 0.03, ironC, ['ny']));
      m.add(ring(0.1, 0.022, 8, 4, ironC), mat.translate(rx, top - 0.82 - 0.06, 0.05));
    }
    const bol = ironBollards ? [[0, 0], [0.14, 0], [0.14, 0.26], [0.1, 0.32], [0.1, 0.36], [0.18, 0.42], [0.18, 0.47], [0, 0.47]] : [[0, 0], [0.22, 0], [0.22, 0.3], [0.17, 0.38], [0.26, 0.52], [0.26, 0.58], [0, 0.58]];
    for (const bx of [L * 0.34 + (rnd() - 0.5), L * 0.72 + (rnd() - 0.5)]) {
      if (bx > sx0 - 0.5 && bx < sx1 + 0.5) continue;
      m.add(lathe(bol, 7, vary(ironBollards ? ironC : J('#8f887a'), 0.07)), mat.translate(bx, top, -0.5));
    }
  } else {
    for (const bx of [L * 0.4, L * 0.75]) if (bx < sx0 - 0.5 || bx > sx1 + 0.5) m.add(aabb(bx - 0.2, top, -0.7, bx + 0.2, top + 0.5, -0.3, stone, ['ny']));
  }
  return m;
}

// =====================================================================================
// HULL LOFTING (shared by the three boats)
// =====================================================================================
const WL_LO = -0.03, WL_HI = 0.04; // boot-top band around the waterline
/** Level list: lo/hi are fractions of strake tops below/above the waterline band; hiC their colours. */
function makeLevels({ lo, hi, hiC, lap = 0, top = false, topC = 'rail', gap = 0.03 }) {
  const L = []; let k = 0;
  L.push({ g: 'lo', f: 0, off: 0, c: 'tar', sh: 0.9 });
  lo.forEach((f, i) => {
    L.push({ g: 'lo', f, off: k * lap, c: 'tar', sh: 1 });
    if (i < lo.length - 1 && lap > 0) { k++; L.push({ g: 'lo', f: f + gap, off: k * lap, c: 'tar', sh: 0.85 }); }
  });
  L.push({ g: 'hi', f: 0, off: k * lap, c: hiC[0], sh: 0.9 });
  hi.forEach((f, i) => {
    L.push({ g: 'hi', f, off: k * lap, c: hiC[i], sh: 1 });
    if (i < hi.length - 1 && lap > 0) { k++; L.push({ g: 'hi', f: f + gap, off: k * lap, c: hiC[i + 1], sh: 0.85 }); }
  });
  if (top) L.push({ g: 'top', f: 1, off: k * lap, c: topC, sh: 1 });
  return L;
}
/** One point of the half-section at height y (x >= 0). */
function hullPoint(o, S, y, off = 0, inset = 0) {
  const u = clamp((y - S.K) / (S.D - S.K), 0, 1), fh = (y - S.K) / (S.S - S.K);
  let x = S.B * Math.pow(Math.sin(u * Math.PI / 2), S.A) * (1 + S.fl * fh);
  if (S.B > 1e-6) x = Math.max(0, x + off - inset);
  const z = S.z0 + o.rakeB * Math.pow(S.t, o.rakeP) * Math.pow(Math.max(0, fh), 1.6) - o.rakeS * Math.pow(1 - S.t, o.rakeP) * fh;
  return { x, y, z };
}
function section(o, t) {
  const S = { t, K: o.K(t), D: o.D(t), B: o.B(t), A: o.A(t), fl: o.flare(t), z0: -o.L / 2 + o.rakeS + t * (o.L - o.rakeS - o.rakeB) };
  S.S = S.D + o.BW(t);
  S.pts = o.levels.map((lv) => {
    const y = lv.g === 'lo' ? S.K + (WL_LO - S.K) * lv.f : lv.g === 'hi' ? WL_HI + (S.D - WL_HI) * lv.f : S.S;
    const q = hullPoint(o, S, y, lv.off); if (lv.g === 'lo' && lv.f === 0) q.x = 0;
    return { ...q, lv };
  });
  S.deck = S.pts.filter((q) => q.lv.g === 'hi').pop();
  S.top = S.pts[S.pts.length - 1];
  return S;
}
/** x,z of the outer hull half-section at height y. */
function rowAt(S, y) {
  const P = S.pts;
  if (y <= P[0].y) return { x: P[0].x, z: P[0].z };
  for (let i = 1; i < P.length; i++) if (y <= P[i].y) { const t = (y - P[i - 1].y) / (P[i].y - P[i - 1].y || 1); return { x: lerp(P[i - 1].x, P[i].x, t), z: lerp(P[i - 1].z, P[i].z, t) }; }
  return { x: P[P.length - 1].x, z: P[P.length - 1].z };
}
function loft(o) {
  const rows = o.ts.map((t) => section(o, t));
  for (const S of rows) {
    const half = S.pts.slice(1);
    S.ring = [...half.slice().reverse().map((q) => ({ ...q, x: -q.x })), S.pts[0], ...half];
  }
  const colOf = (q) => shade(o.pal[q.lv.c], q.lv.sh * (0.97 + 0.06 * hash3(Math.abs(q[0]) * 1.0, q[1], q[2])));
  const P = rows.map((S) => S.ring.map((q) => [q.x, q.y, q.z, q.lv]));
  const outer = gridMesh(P, (q) => shade(o.pal[q[3].c], q[3].sh * (0.97 + 0.06 * hash3(Math.abs(q[0]), q[1], q[2]))));
  // transom
  const S0 = rows[0];
  if (S0.B > 0.02) {
    const c = [0, S0.top.y, S0.top.z], pts = S0.ring.map((q) => [q.x, q.y, q.z]);
    fanH(outer, pts, c, shade(o.pal.hull, 0.95), [0, 0, -1]);
    if (o.transomTrim) fanH(outer, pts, c, shade(o.pal.hull, 0.95), [0, 0, -1]);
  }
  // water-line tint for everything below the boot-top is already in the 'tar' strakes
  return { rows, outer };
}
/** Inner shell for rows i0..i1: levels us (0..1 of K..D), optional top; separate port/starboard strips when !keel. */
function innerShell(o, rows, i0, i1, { us, th, top = true, keel = true, color }) {
  const m = new Mesh(), P = [], Lp = [], Rp = [];
  for (let r = i0; r <= i1; r++) {
    const S = rows[r], pts = us.map((u) => {
      const y = S.K + th + (S.D - S.K - th) * u, q = hullPoint(o, S, y, 0, th * 1.4);
      if (keel && u === 0) q.x = 0;
      return { ...q, u };
    });
    if (top && S.S > S.D + 1e-6) { const q = hullPoint(o, S, S.S, S.top.lv.off, th); pts.push({ ...q, u: 1.2 }); }
    if (S.t === 0 && S.B > 0.02) for (const q of pts) q.z += th;
    const mir = pts.map((q) => [-q.x, q.y, q.z, q.u]), pr = pts.map((q) => [q.x, q.y, q.z, q.u]);
    if (keel) P.push([...mir.slice(1).reverse(), pr[0], ...pr.slice(1)]);
    else { Lp.push(mir.slice().reverse()); Rp.push(pr); }
  }
  const colFn = (q) => shade(color, (0.62 + 0.38 * Math.min(1, q[3])) * (0.96 + 0.08 * hash3(q[0], q[1], q[2])));
  if (keel) m.add(gridMesh(P, colFn, { flip: true }));
  else { m.add(gridMesh(Lp, colFn, { flip: true })); m.add(gridMesh(Rp, colFn, { flip: true })); }
  return m;
}
/** Gunwale rim: strip from outer top edge to inner top edge on both sides; also closes the stem. */
function rim(o, rows, i0, i1, th, color) {
  const m = new Mesh(), hint = [0, 1, 0];
  for (let r = i0; r < i1; r++) {
    const A = rows[r], B = rows[r + 1];
    const oi = (S) => hullPoint(o, S, S.top.y, S.top.lv.off, th * 1.4);
    for (const sg of [-1, 1]) {
      const ia = oi(A), ib = oi(B);
      const a = [sg * A.top.x, A.top.y, A.top.z], b = [sg * B.top.x, B.top.y, B.top.z], c = [sg * ib.x, ib.y, ib.z], d = [sg * ia.x, ia.y, ia.z];
      if (Math.abs(a[0] - d[0]) + Math.abs(b[0] - c[0]) < 1e-6) continue;
      quadH(m, a, b, c, d, color, hint);
    }
  }
  return m;
}
/** Close a cross-section at row r as a flat wall (inner ring up to height yTop), facing dir. */
function bulkhead(o, S, th, us, yTop, color, dir) {
  const m = new Mesh();
  const pts = us.map((u) => { const y = S.K + th + (S.D - S.K - th) * u, q = hullPoint(o, S, Math.min(y, yTop), 0, th * 1.4); return q; });
  if (S.t === 0 && S.B > 0.02) for (const q of pts) q.z += th;
  const ringp = [...pts.slice(1).reverse().map((q) => [-q.x, q.y, q.z]), [0, pts[0].y, pts[0].z], ...pts.slice(1).map((q) => [q.x, q.y, q.z])];
  const last = ringp[ringp.length - 1], first = ringp[0];
  fanH(m, ringp, [0, yTop, (first[2] + last[2]) / 2], color, dir);
  return m;
}

// =====================================================================================
// ROWBOAT
// =====================================================================================
function rowboat(seed, p, lod) {
  const rnd = srng('rowboat', seed), J = jitter(rnd);
  const L = p.length * (0.9 + 0.2 * rnd()), s = L / 4.2;
  const painted = rnd() < 0.6, accent = J(ACCENTS[Math.floor(rnd() * 2.999)]), wood = J('#7d5d3d');
  const pal = { tar: J('#2b2219'), hull: painted ? accent : wood, rail: painted ? J('#bfb299') : shade(wood, 1.12), in: J('#5b452f') };
  const e = (t) => 2 * t - 1, tm = 0.46;
  const o = {
    L, rakeB: 0.18 * s, rakeS: 0.05 * s, rakeP: 4, pal,
    ts: lod ? [0, 0.3, 0.6, 0.85, 1] : [0, 0.06, 0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88, 0.96, 1],
    B: (t) => 0.155 * L * (t >= tm ? Math.pow(1 - Math.pow((t - tm) / (1 - tm), 2.0), 0.9) : 0.58 + 0.42 * (1 - Math.pow((tm - t) / tm, 2))),
    K: (t) => -0.15 * s * (1 - 0.55 * Math.pow(Math.abs(e(t)), 2.2)),
    D: (t) => 0.33 * s + (e(t) > 0 ? 0.30 : 0.08) * e(t) * e(t) * s,
    BW: () => 0, A: (t) => 0.55 + 0.45 * Math.pow(Math.abs(e(t)), 1.5), flare: () => 0.14,
    levels: lod ? makeLevels({ lo: [1], hi: [1], hiC: ['rail'] }) : makeLevels({ lo: [0.5, 1], hi: [0.5, 1], hiC: ['hull', 'rail'], lap: 0.012 * s }),
  };
  const { rows, outer } = loft(o), m = new Mesh(), th = 0.022 * s;
  m.add(outer);
  const N = rows.length - 1;
  if (lod) {
    // dark deck cover instead of a hollow interior
    const P = rows.map((S) => [[-S.top.x, S.top.y - 0.04, S.top.z], [S.top.x, S.top.y - 0.04, S.top.z]]);
    m.add(gridMesh(P, () => pal.in, { hint: [0, 1, 0] }));
  } else {
    m.add(innerShell(o, rows, 0, N, { us: [0, 0.35, 0.7, 1], th, top: false, keel: true, color: pal.in }));
    m.add(rim(o, rows, 0, N, th, shade(pal.rail, 0.9)));
    m.add(bulkhead(o, rows[0], th, [0, 0.35, 0.7, 1], rows[0].D, shade(pal.in, 0.9), [0, 0, 1]));
  }
  const tl = lod ? [0.5] : [0.3, 0.5, 0.68];
  for (const t of tl) {
    const S = section(o, t), y = S.D - 0.14 * s, w = rowAt(S, y).x - th * 1.4;
    m.add(aabb(-w, y - 0.035, S.z0 - 0.11, w, y, S.z0 + 0.11, vary(shade(wood, 0.95), 0.04), lod ? ['ny'] : []));
  }
  // oars resting in the rowlocks at the middle thwart
  const S5 = section(o, 0.52);
  for (const sg of [-1, 1]) {
    const px = sg * (S5.top.x + 0.02), py = S5.D + 0.05, pz = S5.z0 - 0.05;
    if (!lod) m.add(tube([px, py, pz], [px, py + 0.13, pz], 0.016, 0.014, 4, '#3a3026', { capA: false }));
    const d = nrm([sg * 1, -(py + 0.02) / (1.55 * s), -0.28]), A = add([px, py, pz], mul(d, -0.75 * s)), Bp = add([px, py, pz], mul(d, 1.5 * s)), Cc = add([px, py, pz], mul(d, 2.05 * s));
    m.add(lod ? strut(A, Cc, 0.07, 0.05, shade(wood, 1.1), { caps: false }) : tube(A, Bp, 0.024, 0.022, 5, shade(wood, 1.15)));
    if (!lod) m.add(strut(Bp, Cc, 0.13, 0.014, shade(wood, 1.05)));
  }
  return m;
}

// =====================================================================================
// FISHING BOAT
// =====================================================================================
function fishingBoat(seed, p, lod) {
  const rnd = srng('fishing_boat', seed), J = jitter(rnd);
  const L = p.length * (0.9 + 0.2 * rnd()), s = L / 9;
  const accent = J(ACCENTS[Math.floor(rnd() * 2.999)]), cabinC = J('#cfc5ae'), sailC = J('#b3a07b'), woodC = J('#8a6a47'), rigC = '#5a4a34';
  const pal = { tar: J('#2a2118'), hull: accent, wale: shade(woodC, 0.75), rail: shade(woodC, 1.0), in: J('#6d5538') };
  const e = (t) => 2 * t - 1, tm = 0.4, th = 0.04 * s, tD = 0.5;
  const o = {
    L, rakeB: 0.5 * s, rakeS: 0.1 * s, rakeP: 4, pal,
    ts: lod ? [0, 0.26, 0.5, 0.7, 0.89, 1] : [0, 0.07, 0.16, 0.26, 0.38, 0.5, 0.6, 0.7, 0.8, 0.89, 0.95, 1],
    B: (t) => 0.165 * L * (t >= tm ? Math.pow(1 - Math.pow((t - tm) / (1 - tm), 2.2), 0.8) : 0.52 + 0.48 * (1 - Math.pow((tm - t) / tm, 2))),
    K: (t) => -0.95 * s * (1 - 0.78 * Math.pow(Math.abs(e(t)), 2.4)),
    D: (t) => 0.65 * s + (e(t) > 0 ? 0.75 : 0.12) * e(t) * e(t) * s,
    BW: () => 0.22 * s, A: (t) => 0.62 + 0.38 * Math.pow(Math.abs(e(t)), 1.3), flare: () => 0.1,
    levels: lod ? makeLevels({ lo: [1], hi: [1], hiC: ['hull'], top: true }) : makeLevels({ lo: [0.5, 1], hi: [0.3, 0.65, 1], hiC: ['hull', 'hull', 'wale'], top: true }),
  };
  const { rows, outer } = loft(o), m = new Mesh();
  m.add(outer);
  const N = rows.length - 1, iD = o.ts.indexOf(tD), deckC = J('#8a7452');
  // cockpit interior (aft of tD) and foredeck bulwark inner
  if (lod) {
    const P = rows.map((S, i) => { const y = S.D - (i < iD ? 0.08 : 0), x = Math.max(0, rowAt(S, y).x - th); return [[-x, y, S.z0], [x, y, S.z0]]; });
    m.add(gridMesh(P, (q) => (q[2] < rows[iD].z0 ? pal.in : deckC), { hint: [0, 1, 0] }));
  } else {
    m.add(innerShell(o, rows, 0, iD, { us: [0, 0.2, 0.45, 0.7, 1], th, top: true, keel: true, color: pal.in }));
    m.add(innerShell(o, rows, iD, N, { us: [1], th, top: true, keel: false, color: shade(pal.in, 1.05) }));
    m.add(rim(o, rows, 0, N, th, shade(woodC, 0.85)));
    m.add(bulkhead(o, rows[iD], th, [0, 0.2, 0.45, 0.7, 1], rows[iD].D, shade(pal.in, 0.85), [0, 0, -1]));
    m.add(bulkhead(o, rows[0], th, [0, 0.2, 0.45, 0.7, 1], rows[0].D, shade(pal.in, 0.9), [0, 0, 1]));
    // cockpit sole just above the waterline
    const Pf = rows.slice(0, iD + 1).map((S) => { const q = rowAt(S, 0.08), x = Math.max(0, q.x - th * 1.4); return [-1, 0, 1].map((f) => [x * f, 0.08, q.z + (S.t === 0 ? th : 0), f]); });
    m.add(gridMesh(Pf, (q) => shade(pal.in, 0.9 + 0.2 * hash3(Math.round(q[2] * 3), 2, 1)), { hint: [0, 1, 0] }));
    // foredeck
    const P = rows.slice(iD).map((S) => { const x = Math.max(0, S.deck.x - th * 1.4); return [[-x, S.D, S.deck.z], [-x / 2, S.D + 0.045 * s, S.deck.z], [0, S.D + 0.07 * s, S.deck.z], [x / 2, S.D + 0.045 * s, S.deck.z], [x, S.D, S.deck.z]]; });
    m.add(gridMesh(P, (q) => shade(deckC, 0.92 + 0.16 * hash3(Math.round(q[0] * 4), 1, Math.round(q[2] * 2))), { hint: [0, 1, 0] }));
  }
  // cabin
  const Sa = rows[iD], Sb = section(o, 0.64), yb = Sa.D - 0.04, cw = Math.min(rowAt(Sa, Sa.D).x, rowAt(Sb, Sb.D).x) - 0.4 * s, ch = 0.95 * s;
  m.add(aabb(-cw, yb, Sa.z0 + 0.02, cw, yb + ch, Sb.z0, cabinC, ['ny']));
  m.add(aabb(-cw - 0.07, yb + ch, Sa.z0 - 0.07, cw + 0.07, yb + ch + 0.07 * s, Sb.z0 + 0.07, J('#3d3832'), ['ny']));
  if (!lod) {
    const zc = (Sa.z0 + Sb.z0) / 2;
    for (const sg of [-1, 1]) for (const dz of [-0.28 * s, 0.28 * s]) {
      const x = sg * (cw + 0.004), y0 = yb + 0.5 * s, h = 0.3 * s, hw = 0.16 * s;
      quadH(m, [x, y0, zc + dz - hw], [x, y0, zc + dz + hw], [x, y0 + h, zc + dz + hw], [x, y0 + h, zc + dz - hw], GLASS, [sg, 0, 0]);
    }
    const zd = Sa.z0 + 0.02 - 0.004;
    quadH(m, [-0.28 * s, yb + 0.02, zd], [0.28 * s, yb + 0.02, zd], [0.28 * s, yb + 0.85 * s, zd], [-0.28 * s, yb + 0.85 * s, zd], '#2a2420', [0, 0, -1]);
    m.add(aabb(-0.3 * s, yb, zd - 0.05, 0.3 * s, yb + 0.05, zd + 0.02, woodC, ['ny'])); // door sill
    // hatch forward
    const Sh = section(o, 0.82);
    m.add(aabb(-0.45 * s, Sh.D, Sh.z0 - 0.35 * s, 0.45 * s, Sh.D + 0.15 * s + 0.07 * s, Sh.z0 + 0.35 * s, shade(woodC, 0.9), ['ny']));
  }
  // mast, furled sail on boom, gaff
  const Sm = section(o, 0.74), zm = Sm.z0, yd = Sm.D + 0.07 * s, mastTop = yd + 6.0 * s;
  m.add(tube([0, yd - 0.15, zm], [0, mastTop, zm], 0.1 * s, 0.065 * s, lod ? 4 : 8, shade(woodC, 0.85), { capA: false }));
  const boomY = yd + 1.5 * s, bA = [0, boomY, zm - 0.28 * s], bB = [0, boomY + 0.14 * s, zm - 5.0 * s];
  if (lod) {
    m.add(tube(add(bA, [0, 0.14 * s, 0]), add(bB, [0, 0.14 * s, 0]), 0.2 * s, 0.2 * s, 5, sailC));
  } else {
    m.add(tube(bA, bB, 0.055 * s, 0.05 * s, 6, shade(woodC, 0.9)));
    const f0 = add(bA, [0, 0.16 * s, -0.4 * s]), f1 = add(bB, [0, 0.18 * s, 0.4 * s]);
    m.add(tube(f0, f1, 0.18 * s, 0.17 * s, 8, vary(sailC, 0.04)));
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4, c = add(f0, mul(sub(f1, f0), t)), d = nrm(sub(f1, f0));
      m.add(tube(sub(c, mul(d, 0.04)), add(c, mul(d, 0.04)), 0.19 * s, 0.19 * s, 8, rigC, { caps: false }));
    }
    m.add(tube([0, yd + 3.7 * s, zm - 0.1 * s], [0, boomY + 0.55 * s, zm - 4.4 * s], 0.04 * s, 0.035 * s, 5, shade(woodC, 0.9)));
    // standing rigging
    const Sdk = rowAt(Sm, Sm.D);
    for (const sg of [-1, 1]) for (const dz of [-0.2 * s, 0.25 * s]) rope(m, [0, yd + 4.6 * s, zm], [sg * (Sdk.x + 0.03), Sm.D + 0.12 * s, zm + dz], 0.035, rigC);
    rope(m, [0, mastTop - 0.05, zm], [0, rows[N].top.y - 0.1, rows[N].top.z], 0.035, rigC);
    rope(m, [0, mastTop - 0.4 * s, zm - 0.05], add(bB, [0, 0.2 * s, 0]), 0.035, rigC);
    // pennant
    m.flatTris([[[0.02, mastTop - 0.02, zm], [0.02, mastTop - 0.32, zm], [0.02, mastTop - 0.17, zm - 0.85]], [[0.02, mastTop - 0.02, zm], [0.02, mastTop - 0.17, zm - 0.85], [0.02, mastTop - 0.32, zm]]], accent);
    // rudder + tiller
    m.add(aabb(-0.04, -0.85 * s, rows[0].z0 - 0.38 * s, 0.04, 0.45 * s, rows[0].z0 - 0.04, shade(woodC, 0.8), []));
    m.add(strut([0, rows[0].D + 0.02, rows[0].z0 - 0.3 * s], [0, rows[0].D + 0.1, rows[0].z0 + 1.1 * s], 0.05, 0.05, shade(woodC, 0.9)));
    // nets heap, floats, crates, thwarts
    const Sn = section(o, 0.26), soleY = 0.08;
    const heap = new Mesh().add(sphereLumpy(1, 2, vary(J('#8c7e5e'), 0.12), seed));
    m.add(heap, mat.chain(mat.translate(0.1 * s, soleY + 0.05 * s, Sn.z0), mat.scale(0.95 * s, 0.34 * s, 0.85 * s)));
    for (let k = 0; k < 5; k++) m.add(sphereLumpy(0.075 * s, 0, '#c9b58a', seed + k), mat.translate((hash3(k, 1, 1) - 0.5) * 1.3 * s, soleY + 0.35 * s + hash3(k, 2, 2) * 0.1, Sn.z0 + (hash3(k, 3, 3) - 0.5) * 1.2 * s));
    for (const t of [0.14, 0.4]) {
      const S = section(o, t), y = S.D - 0.2 * s, w = rowAt(S, y).x - th * 1.4;
      m.add(aabb(-w, y - 0.04, S.z0 - 0.13, w, y, S.z0 + 0.13, vary(shade(woodC, 0.95), 0.04)));
    }
    const Sc = section(o, 0.1);
    m.add(aabb(0.35 * s, soleY, Sc.z0 - 0.35 * s, 1.0 * s, soleY + 0.3 * s, Sc.z0 + 0.3 * s, shade(woodC, 0.95), ['ny']));
  }
  if (lod) m.add(aabb(-0.03, -0.85 * s, rows[0].z0 - 0.38 * s, 0.03, 0.45 * s, rows[0].z0 - 0.04, shade(woodC, 0.8), ['ny']));
  return m;
}
/** Icosphere with seeded lumps (nets, bundles). */
function sphereLumpy(r, sub, color, seed) {
  const t = (1 + Math.sqrt(5)) / 2, nr = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nr);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < sub; k++) {
    const cache = new Map(), mid = (a, b) => { const key = a < b ? a * 1e6 + b : b * 1e6 + a; if (!cache.has(key)) { V.push(nr(V[a].map((v, i) => v + V[b][i]))); cache.set(key, V.length - 1); } return cache.get(key); };
    F = F.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  const m = new Mesh(), sd = typeof seed === 'number' ? seed : seed.length;
  for (const v of V) {
    const k = 1 + (sub > 0 ? 0.12 * (hash3(v[0] * 9 + sd, v[1] * 9, v[2] * 9) - 0.5) : 0), p = v.map((x) => x * r * k);
    m.pos.push(...p); m.nrm.push(...v); m.col.push(...rgb(typeof color === 'function' ? color(p) : color));
  }
  for (const f of F) m.idx.push(f[0], f[1], f[2]);
  return m.recomputeNormals();
}

// =====================================================================================
// COG
// =====================================================================================
function cog(seed, p, lod) {
  const rnd = srng('cog', seed), J = jitter(rnd);
  const L = p.length * (0.9 + 0.2 * rnd()), s = L / 22;
  const sailSet = rnd() < 0.5, accent = J(ACCENTS[Math.floor(rnd() * 2.999)]);
  const woodC = J('#6b5640'), canvas = J('#cdbf9c'), rigC = '#4a3d2c', deckC = J('#7a6446');
  const pal = { tar: J('#2c241b'), hull: woodC, rail: shade(woodC, 0.7) };
  const e = (t) => 2 * t - 1, ae = (t) => Math.abs(e(t)), th = 0.12 * s;
  const castleA = (t) => 1 - ss(0.18, 0.26, t), castleF = (t) => ss(0.74, 0.82, t);
  const o = {
    L, rakeB: 1.5 * s, rakeS: 0.8 * s, rakeP: 3, pal,
    ts: lod ? [0, 0.07, 0.18, 0.34, 0.5, 0.66, 0.82, 0.93, 1] : [0, 0.03, 0.07, 0.12, 0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.88, 0.93, 0.97, 1],
    B: (t) => 0.16 * L * Math.pow(Math.max(0, 1 - Math.pow(ae(t), 2.4)), 0.62),
    K: (t) => -2.1 * s * (1 - 0.88 * Math.pow(ae(t), 3)),
    D: (t) => 1.8 * s + 0.5 * s * e(t) * e(t),
    BW: (t) => 0.9 * s + 1.9 * s * castleA(t) + 1.2 * s * castleF(t),
    A: () => 0.62, flare: () => 0.06,
    levels: lod ? makeLevels({ lo: [1], hi: [1], hiC: ['hull'], top: true }) : makeLevels({ lo: [0.45, 1], hi: [0.28, 0.55, 0.8, 1], hiC: ['hull', 'hull', 'hull', 'rail'], lap: 0.022 * s, top: true }),
  };
  const { rows, outer } = loft(o), m = new Mesh(), N = rows.length - 1;
  m.add(outer);
  const iA = o.ts.indexOf(0.18), iF = o.ts.indexOf(0.82), ycA = section(o, 0.09).D + 1.6 * s, ycF = section(o, 0.9).D + 1.3 * s;
  const plank = (q) => shade(deckC, 0.9 + 0.2 * hash3(Math.round(q[0] * 3), 1, Math.round(q[2] * 1.5)));
  if (!lod) {
    m.add(innerShell(o, rows, 0, N, { us: [1], th, top: true, keel: false, color: shade(woodC, 0.8) }));
    m.add(rim(o, rows, 0, N, th, shade(woodC, 0.6)));
  }
  // main deck between the castles
  {
    const P = rows.slice(iA, iF + 1).map((S) => { const x = Math.max(0, S.deck.x - th * 1.4), y = S.D; return [-1, 0, 1].map((f) => [x * f, y + 0.04 * s * (1 - f * f), S.deck.z, f]); });
    m.add(gridMesh(P, plank, { hint: [0, 1, 0] }));
  }
  // castles: platform + front wall + door
  const castle = (i0, i1, yc, front, doorOnWall) => {
    const idx = []; for (let i = i0; i <= i1; i++) idx.push(i);
    const P = idx.map((i) => { const S = rows[i], q = rowAt(S, yc), x = Math.max(0, q.x - th * 1.4); return [-1, 0, 1].map((f) => [x * f, yc, q.z, f]); });
    m.add(gridMesh(P, (q) => shade(plank(q), 1.08), { hint: [0, 1, 0] }));
    const S = rows[front], qd = rowAt(S, S.D), qt = rowAt(S, yc), xd = Math.max(0, qd.x - th * 1.4), xt = Math.max(0, qt.x - th * 1.4);
    const dirz = front === i1 ? 1 : -1; // wall faces the waist
    quadH(m, [-xd, S.D, qd.z], [xd, S.D, qd.z], [xt, yc, qt.z], [-xt, yc, qt.z], shade(accent, 0.95), [0, 0, dirz]);
    if (!lod && doorOnWall) quadH(m, [-0.5 * s, S.D, qd.z + dirz * 0.01], [0.5 * s, S.D, qd.z + dirz * 0.01], [0.5 * s, S.D + 1.5 * s, qd.z + dirz * 0.01], [-0.5 * s, S.D + 1.5 * s, qd.z + dirz * 0.01], '#2a2420', [0, 0, dirz]);
    if (!lod) { // crenellations on the sheer
      for (const i of idx) {
        const Si = rows[i]; if (Si.B < 0.3) continue;
        for (const sg of [-1, 1]) {
          const x = sg * (Si.top.x - th * 0.5);
          m.add(aabb(x - th * 0.75 - 0.03, Si.S, Si.top.z - 0.26 * s, x + th * 0.75 + 0.03, Si.S + 0.5 * s, Si.top.z + 0.26 * s, shade(woodC, 0.75), ['ny']));
        }
      }
    }
  };
  castle(0, iA, ycA, iA, true);
  castle(iF, N, ycF, iF, false);
  // rudder on the stern post
  {
    const S0 = rows[0], y0 = -1.9 * s, y1 = ycA + 0.2 * s, z0 = rowAt(S0, 0).z;
    const zp = (y) => rowAt(S0, y).z;
    m.add(strut([0, y0, zp(y0) - 0.42 * s], [0, y1, zp(y1) - 0.42 * s], 0.12 * s, 0.7 * s, shade(woodC, 0.8), { up: [0, 0, -1], caps: !lod }));
  }
  // putlog beam ends along the waist
  if (!lod) for (const i of [7, 9, 11, 13 - 1]) {
    if (i >= iF) continue;
    const S = rows[i], y = S.D - 0.3 * s, q = rowAt(S, y);
    for (const sg of [-1, 1]) m.add(aabb(sg > 0 ? q.x - 0.05 : -q.x - 0.28 * s, y - 0.12 * s, q.z - 0.12 * s, sg > 0 ? q.x + 0.28 * s : -q.x + 0.05, y + 0.12 * s, q.z + 0.12 * s, shade(woodC, 0.75), [sg > 0 ? 'nx' : 'px']));
  }
  // mast, yard, sail, crow's nest
  const Sm = section(o, 0.5), zm = Sm.z0 + 0.9 * s, yd = Sm.D + 0.04 * s, mastTop = yd + 16 * s, yardY = yd + 13.2 * s, yardW = 12 * s;
  m.add(tube([0, yd - 0.1, zm], [0, mastTop, zm], 0.3 * s, 0.17 * s, lod ? 4 : 8, shade(woodC, 0.9), { capA: false }));
  m.add(tube([-yardW / 2, yardY, zm + 0.5 * s], [yardW / 2, yardY, zm + 0.5 * s], 0.13 * s, 0.13 * s, lod ? 4 : 6, shade(woodC, 0.85)));
  if (sailSet) {
    const nx = lod ? 1 : 8, ny = lod ? 1 : 6, W0 = yardW * 0.92, W1 = yardW * 1.0, Hs = 8.4 * s, bulge = 1.6 * s, P = [];
    for (let i = 0; i <= ny; i++) {
      const v = i / ny, row = [], w = lerp(W1, W0, v), y = yardY - 0.1 - (1 - v) * Hs;
      for (let j = 0; j <= nx; j++) { const u = j / nx - 0.5, bu = 1 - 4 * u * u, z = zm + 0.5 * s + 0.3 * s + bulge * Math.sin(Math.PI * (1 - v) * 0.92 + 0.05) * bu * 0.8; row.push([u * w, y, z, 0.8 + 0.2 * Math.sin(u * 9) * 0.5 + 0.1 * v]); }
      P.push(row);
    }
    const sm = gridMesh(P, (q) => shade(canvas, clamp(q[3] * (0.85 + 0.15 * (q[1] - (yardY - 8.5 * s)) / (8.5 * s)), 0.5, 1.05)), { hint: [0, 0, 1] });
    twoSided(sm, 0.006); m.add(sm);
  } else {
    m.add(tube([-yardW * 0.46, yardY - 0.36 * s, zm + 0.5 * s], [yardW * 0.46, yardY - 0.36 * s, zm + 0.5 * s], 0.42 * s, 0.42 * s, lod ? 5 : 8, vary(canvas, 0.05)));
    if (!lod) for (let k = 0; k < 5; k++) { const x = -yardW * 0.4 + k * yardW * 0.2; m.add(tube([x - 0.05, yardY - 0.36 * s, zm + 0.5 * s], [x + 0.05, yardY - 0.36 * s, zm + 0.5 * s], 0.45 * s, 0.45 * s, 8, rigC, { caps: false })); }
  }
  if (!lod) {
    const ny0 = mastTop - 2.2 * s;
    m.add(lathe([[0.1 * s, ny0], [0.7 * s, ny0], [0.85 * s, ny0 + 0.2 * s], [0.9 * s, ny0 + 0.9 * s]], 8, shade(woodC, 0.85)), mat.translate(0, 0, zm));
    // standing rigging
    const hy = yd + 14.6 * s, Sdk = rowAt(Sm, Sm.D);
    for (const sg of [-1, 1]) for (const dz of [-1.0 * s, 0, 1.0 * s]) rope(m, [sg * 0.12 * s, hy - Math.abs(dz) * 0.4, zm], [sg * (Sdk.x + 0.2 * s), Sm.D + 0.7 * s, zm + dz], 0.07 * s, rigC);
    rope(m, [0, mastTop - 0.3, zm], [0, rows[N].top.y, rows[N].top.z - 0.3], 0.07 * s, rigC);
    rope(m, [0, mastTop - 0.3, zm], [0, rows[0].S, rows[0].top.z + 0.3], 0.07 * s, rigC);
    for (const sg of [-1, 1]) {
      rope(m, [sg * yardW / 2, yardY, zm + 0.5 * s], [sg * (rowAt(rows[iF - 1], rows[iF - 1].D).x + 0.1), rows[iF - 1].D + 0.9 * s, rows[iF - 1].z0], 0.07 * s, rigC);
      if (sailSet) rope(m, [sg * yardW * 0.46, yardY - 8.5 * s, zm + 1.1 * s], [sg * (rowAt(rows[iF - 2], rows[iF - 2].D).x * 0.6), rows[iF - 2].D + 0.4 * s, rows[iF - 2].z0 + 1.2 * s], 0.07 * s, rigC);
    }
    // pennant
    m.flatTris([[[0.02, mastTop, zm], [0.02, mastTop - 0.9, zm], [0.02, mastTop - 0.45, zm - 2.2]], [[0.02, mastTop, zm], [0.02, mastTop - 0.45, zm - 2.2], [0.02, mastTop - 0.9, zm]]], accent);
    // hatch with grating, barrels
    const Sh = section(o, 0.4);
    m.add(aabb(-0.9 * s, Sh.D, Sh.z0 - 0.8 * s, 0.9 * s, Sh.D + 0.35 * s, Sh.z0 + 0.8 * s, shade(woodC, 0.8), ['ny']));
    m.add(aabb(-0.75 * s, Sh.D + 0.34 * s, Sh.z0 - 0.65 * s, 0.75 * s, Sh.D + 0.37 * s, Sh.z0 + 0.65 * s, '#3b2f22', ['ny', 'nx', 'px', 'nz', 'pz']));
    const barrel = [[0, 0], [0.34 * s, 0], [0.45 * s, 0.4 * s], [0.34 * s, 0.8 * s], [0, 0.8 * s]];
    const S6 = section(o, 0.66);
    for (const [bx, bz] of [[-1.5, 0.3], [1.6, -0.4], [-1.1, 1.3]]) m.add(lathe(barrel, 6, vary('#5d4630', 0.08)), mat.translate(bx * s, S6.D, S6.z0 + bz * s));
    // cargo bundle
    m.add(aabb(0.6 * s, section(o, 0.58).D, section(o, 0.58).z0 - 0.4 * s, 1.8 * s, section(o, 0.58).D + 0.7 * s, section(o, 0.58).z0 + 0.4 * s, J('#8c7e5e'), ['ny']));
  }
  return m;
}

// ---------- registry
/** Drop zero-area triangles and unreferenced vertices. */
function tidy(m) {
  const keep = [], P = m.pos;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    if (vlen(n) > 1e-9) keep.push(m.idx[t], m.idx[t + 1], m.idx[t + 2]);
  }
  const map = new Map(), o = new Mesh();
  for (const i of keep) {
    if (!map.has(i)) { map.set(i, o.vertexCount); o.pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); o.nrm.push(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]); o.col.push(m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2]); }
    o.idx.push(map.get(i));
  }
  return o;
}
const mk = (defaults, fn) => ({
  defaults,
  make: (seed, p) => tidy(fn(seed, { ...defaults, ...(p || {}) }, false)),
  lod1: (seed, p) => tidy(fn(seed, { ...defaults, ...(p || {}) }, true)),
});

export const WATERFRONT = {
  jetty: { desc: 'Timber pier along +Z from z=0 (shore end, with a ground sill) to z=length: plank deck (separate slats with tiny gaps) at y~+1.2, pile bents every ~3 m reaching down to the sea bed at y=-2.5 with X bracing, mooring bollards, optional handrail on one side (by seed), a ladder on the end face. Water level is y=0.', ...mk({ length: 20, width: 2.5 }, jetty) },
  quay: { desc: 'Dressed-stone quay wall along +X from x=0..length, its face toward +Z (the water), body behind it to z=-3. Top at y~+1.6 (= height-0.6), base to y=-2.5; coping stones, iron mooring rings or stone/iron bollards, timber fenders and a flight of steps projecting from the face down to the water at one end. Water level is y=0.', ...mk({ length: 16, height: 2.2 }, quay) },
  rowboat: { desc: 'Clinker-built open rowboat: lofted hull (sheer, rocker, pointed raked bow, transom stern), tarred bottom strakes, three thwarts, two oars in rowlocks. Bow toward +Z, waterline at y=0, centred at the origin.', ...mk({ length: 4.2 }, rowboat) },
  fishing_boat: { desc: 'Half-decked fishing boat: open cockpit aft with thwarts, nets heap and floats, foredeck with hatch, small cuddy cabin, single mast with the sail furled on its boom, rudder and tiller. Bow toward +Z, waterline at y=0, centred at the origin.', ...mk({ length: 9 }, fishingBoat) },
  cog: { desc: 'Medieval cog: deep round clinker hull with straight raked stem and stern post, crenellated stern castle and forecastle, open waist with hatch and barrels, single mast with a square sail (set or furled by seed, double-sided) and thin-quad rigging, hung rudder. Bow toward +Z, waterline at y=0, centred at the origin.', ...mk({ length: 22 }, cog) },
};
