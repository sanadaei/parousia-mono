// Procedural mesh builder for the asset library. Engine-agnostic: a mesh is
// plain arrays (metres, Y up, +Z south-facing front, origin at ground centre),
// finalised to typed arrays for glTF export and the browser gallery.
//
// Colours are per-vertex linear-ish sRGB 0..1 (no textures), so assets stay
// light and consistent under any engine's lighting.

import { createSimplex3, mulberry32 } from '../src/noise.mjs';

export class Mesh {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; }
  get vertexCount() { return this.pos.length / 3; }

  /** Append a triangle soup with flat normals. tris: [[p0,p1,p2], ...] of [x,y,z]. */
  flatTris(tris, color) {
    for (const [a, b, c] of tris) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const base = this.vertexCount;
      for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(...colorAt(color, p)); }
      this.idx.push(base, base + 1, base + 2);
    }
    return this;
  }

  /** Append another mesh, optionally transformed by a 4x4 column-major matrix. */
  add(m, M = null) {
    const base = this.vertexCount;
    for (let i = 0; i < m.pos.length; i += 3) {
      let [x, y, z] = [m.pos[i], m.pos[i + 1], m.pos[i + 2]], [nx, ny, nz] = [m.nrm[i], m.nrm[i + 1], m.nrm[i + 2]];
      if (M) {
        [x, y, z] = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
        const N = normalMatrix(M);
        [nx, ny, nz] = [N[0] * nx + N[3] * ny + N[6] * nz, N[1] * nx + N[4] * ny + N[7] * nz, N[2] * nx + N[5] * ny + N[8] * nz];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      }
      this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.col.push(m.col[i], m.col[i + 1], m.col[i + 2]);
    }
    for (const k of m.idx) this.idx.push(base + k);
    return this;
  }

  /** Move vertices: fn(x, y, z) -> [x, y, z]. Normals are recomputed (smooth per shared vertex). */
  deform(fn) {
    for (let i = 0; i < this.pos.length; i += 3) { const p = fn(this.pos[i], this.pos[i + 1], this.pos[i + 2]); this.pos[i] = p[0]; this.pos[i + 1] = p[1]; this.pos[i + 2] = p[2]; }
    return this.recomputeNormals();
  }

  recomputeNormals() {
    const n = new Float64Array(this.pos.length);
    for (let t = 0; t < this.idx.length; t += 3) {
      const [a, b, c] = [this.idx[t] * 3, this.idx[t + 1] * 3, this.idx[t + 2] * 3], P = this.pos;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { n[v] += nx; n[v + 1] += ny; n[v + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; this.nrm[i] = n[i] / l; this.nrm[i + 1] = n[i + 1] / l; this.nrm[i + 2] = n[i + 2] / l; }
    return this;
  }

  /** Multiply vertex colours by fn(x, y, z) -> scalar or [r,g,b] (e.g. ambient occlusion, variation). */
  tint(fn) {
    for (let i = 0; i < this.pos.length; i += 3) {
      const k = fn(this.pos[i], this.pos[i + 1], this.pos[i + 2]), r = Array.isArray(k) ? k : [k, k, k];
      for (let c = 0; c < 3; c++) this.col[i + c] = Math.min(1, Math.max(0, this.col[i + c] * r[c]));
    }
    return this;
  }

  finalize(name = 'asset') {
    const positions = Float32Array.from(this.pos), normals = Float32Array.from(this.nrm), colors = Float32Array.from(this.col);
    const indices = this.vertexCount > 65535 ? Uint32Array.from(this.idx) : Uint16Array.from(this.idx);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], positions[i + c]); max[c] = Math.max(max[c], positions[i + c]); }
    return { name, positions, normals, colors, indices, min, max, triangles: indices.length / 3 };
  }
}

// ---------- colour helpers
/** '#rrggbb' or [r,g,b] (0..255 or 0..1) or fn(p)->colour. */
export function rgb(c) {
  if (typeof c === 'string') { const v = parseInt(c.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; }
  return c.some((v) => v > 1) ? c.map((v) => v / 255) : c;
}
function colorAt(color, p) { return rgb(typeof color === 'function' ? color(p) : color); }
export const mixColor = (a, b, t) => { a = rgb(a); b = rgb(b); return a.map((v, i) => v + (b[i] - v) * t); };

// ---------- matrices (column-major 4x4)
export const mat = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(A, B) { const C = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) C[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return C; },
  translate: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  scale: (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
  rotY: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rotX: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  rotZ: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  /** Compose left to right: chain(T, R, S) = T*R*S (S applied first). */
  chain: (...Ms) => Ms.reduce((A, B) => mat.mul(A, B), mat.identity()),
};
function normalMatrix(M) { // inverse-transpose of the upper 3x3
  const a = M[0], b = M[4], c = M[8], d = M[1], e = M[5], f = M[9], g = M[2], h = M[6], i = M[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

// ---------- primitives (smooth unless noted)
/** Axis-aligned box centred on x/z, from y=0 to y=h. Flat-shaded. */
export function box(w, h, d, color) {
  const x = w / 2, z = d / 2, P = (i, j, k) => [i ? x : -x, j ? h : 0, k ? z : -z];
  const q = (a, b, c, e) => [[a, b, c], [a, c, e]];
  return new Mesh().flatTris([
    ...q(P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)), ...q(P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)),
    ...q(P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)), ...q(P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)),
    ...q(P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)), ...q(P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)),
  ], color);
}

/** Frustum along +Y from y=0 (radius r0) to y=h (radius r1); r1=0 gives a cone. Smooth sides. */
export function cylinder(r0, r1, h, seg = 8, color, { caps = true, flat = false } = {}) {
  const m = new Mesh(), c = (p) => colorAt(color, p), slope = (r0 - r1) / h;
  if (flat) {
    const tris = [];
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * 2 * Math.PI, a1 = (s + 1) / seg * 2 * Math.PI, P = (r, y, a) => [r * Math.cos(a), y, r * Math.sin(a)];
      tris.push([P(r0, 0, a0), P(r1, h, a0), P(r0, 0, a1)]); if (r1 > 0) tris.push([P(r0, 0, a1), P(r1, h, a0), P(r1, h, a1)]);
    }
    m.flatTris(tris, color);
  } else {
    for (let s = 0; s <= seg; s++) for (const [r, y] of [[r0, 0], [r1, h]]) {
      const a = s / seg * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), nl = Math.hypot(1, slope);
      m.pos.push(r * ca, y, r * sa); m.nrm.push(ca / nl, slope / nl, sa / nl); m.col.push(...c([r * ca, y, r * sa]));
    }
    for (let s = 0; s < seg; s++) { const a = s * 2; m.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  if (caps) {
    const tris = [];
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * 2 * Math.PI, a1 = (s + 1) / seg * 2 * Math.PI;
      tris.push([[0, 0, 0], [r0 * Math.cos(a0), 0, r0 * Math.sin(a0)], [r0 * Math.cos(a1), 0, r0 * Math.sin(a1)]]);
      if (r1 > 0) tris.push([[0, h, 0], [r1 * Math.cos(a1), h, r1 * Math.sin(a1)], [r1 * Math.cos(a0), h, r1 * Math.sin(a0)]]);
    }
    m.flatTris(tris, color);
  }
  return m;
}

/** Icosphere of radius r centred at origin, subdivided `sub` times. Smooth. */
export function sphere(r, sub = 1, color) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < sub; k++) {
    const cache = new Map(), mid = (a, b) => { const key = a < b ? a * 1e6 + b : b * 1e6 + a; if (!cache.has(key)) { V.push(norm(V[a].map((v, i) => v + V[b][i]))); cache.set(key, V.length - 1); } return cache.get(key); };
    F = F.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  const m = new Mesh();
  for (const v of V) { const p = v.map((x) => x * r); m.pos.push(...p); m.nrm.push(...v); m.col.push(...colorAt(color, p)); }
  for (const f of F) m.idx.push(f[0], f[1], f[2]);
  return m;
}
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

/** Vertical prism from a convex x/z polygon (either winding), y from 0 to h. Flat-shaded, with top cap. */
export function extrude(poly, h, color, { top = true, bottom = false } = {}) {
  let area = 0; for (let i = 0; i < poly.length; i++) { const [a, b] = poly[i], [c, d] = poly[(i + 1) % poly.length]; area += a * d - c * b; }
  if (area > 0) poly = [...poly].reverse(); // sides below assume this (negative-area) winding
  const tris = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
    tris.push([[x0, 0, z0], [x1, 0, z1], [x1, h, z1]], [[x0, 0, z0], [x1, h, z1], [x0, h, z0]]);
  }
  for (let i = 1; i < n - 1; i++) { // fan: convex polygons only
    if (top) tris.push([[poly[0][0], h, poly[0][1]], [poly[i][0], h, poly[i][1]], [poly[i + 1][0], h, poly[i + 1][1]]]);
    if (bottom) tris.push([[poly[0][0], 0, poly[0][1]], [poly[i + 1][0], 0, poly[i + 1][1]], [poly[i][0], 0, poly[i][1]]]);
  }
  return new Mesh().flatTris(tris, color);
}

/** Gable roof over a w (x) by d (z) footprint, ridge along x, eaves at y=0, ridge height rh, overhang o. Flat-shaded. */
export function gableRoof(w, d, rh, color, o = 0.3, gableColor = color) {
  const x = w / 2 + o, z = d / 2 + o, r = [[-x, rh, 0], [x, rh, 0]];
  const m = new Mesh().flatTris([
    [[-x, 0, z], [x, 0, z], r[1]], [[-x, 0, z], r[1], r[0]],
    [[x, 0, -z], [-x, 0, -z], r[0]], [[x, 0, -z], r[0], r[1]],
  ], color);
  const gx = w / 2;
  m.flatTris([[[gx, 0, d / 2], [gx, 0, -d / 2], [gx, rh * (d / 2) / z, 0]], [[-gx, 0, -d / 2], [-gx, 0, d / 2], [-gx, rh * (d / 2) / z, 0]]], gableColor);
  return m;
}

/** Hip roof (four slopes) over w by d, ridge along x. Flat-shaded. */
export function hipRoof(w, d, rh, color, o = 0.3) {
  const x = w / 2 + o, z = d / 2 + o, inset = Math.min(z, x), r0 = [-x + inset, rh, 0], r1 = [x - inset, rh, 0];
  return new Mesh().flatTris([
    [[-x, 0, z], [x, 0, z], r1], [[-x, 0, z], r1, r0], [[x, 0, -z], [-x, 0, -z], r0], [[x, 0, -z], r0, r1],
    [[x, 0, z], [x, 0, -z], r1], [[-x, 0, -z], [-x, 0, z], r0],
  ], color);
}

// ---------- randomness and organic deformation
export function rng(seed) { return mulberry32(String(seed)); }
/** Smooth 3D noise displacement along normals: amp metres at frequency freq (1/m). */
export function noisy(mesh, seed, amp, freq, octaves = 3) {
  const n = createSimplex3(String(seed));
  const N = mesh.nrm.slice();
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const [x, y, z] = [mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]];
    let s = 0, a = 1, f = freq, na = 0; for (let o = 0; o < octaves; o++) { s += a * n(x * f, y * f, z * f); na += a; a *= 0.5; f *= 2; }
    const d = amp * s / na;
    mesh.pos[i] += N[i] * d; mesh.pos[i + 1] += N[i + 1] * d; mesh.pos[i + 2] += N[i + 2] * d;
  }
  return mesh.recomputeNormals();
}
