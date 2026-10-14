// Procedural vegetation for the asset library (see ART_DIRECTION.md).
// Metres, Y up, origin at the trunk base on the ground. Every species exports
//   { desc, defaults, make(seed, p) -> Mesh, lod1(seed, p) -> Mesh }
// make() is LOD0 (trees <= 1500 tris, shrub <= 300, grass <= 60); lod1() is a
// distant stand-in (<= 1/8) with the same proportions and mean colour.
// Both are pure functions of (seed, params): the plan (size, lean, colours,
// crown dimensions) is drawn first, so LOD0 and LOD1 share the same silhouette.

import { Mesh, rgb, mixColor, mat, sphere, rng, noisy } from './mesh.mjs';

// ---------- small maths helpers
const TAU = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Per-individual colour variation: lightness +-amt, slight per-channel (hue) drift. */
function jit(c, r, amt = 0.08) {
  const k = 1 + (r() * 2 - 1) * amt;
  return rgb(c).map((v) => clamp(v * k * (1 + (r() - 0.5) * 0.05)));
}
const scaleCol = (c, k) => c.map((v) => clamp(v * k));

// ---------- ring meshes: lathes and tubes share one outward-CCW strip builder
// rings: [{ ring: [[x,y,z] x segs], c } | { p: [x,y,z], c }] ordered bottom -> top (or base -> tip).
// Winding matches mesh.mjs cylinder(): outward normal is (dy, -dr) of the profile direction.
function ringMesh(rings, segs, hard = false) {
  const m = new Mesh();
  const addRing = (rg) => {
    if (rg.p) { const i = m.vertexCount; m.pos.push(...rg.p); m.nrm.push(0, 1, 0); m.col.push(...rg.c); return new Array(segs).fill(i); }
    const out = [];
    for (let s = 0; s < segs; s++) { out.push(m.vertexCount); m.pos.push(...rg.ring[s]); m.nrm.push(0, 1, 0); m.col.push(...rg.c); }
    return out;
  };
  let prev = hard ? null : addRing(rings[0]);
  for (let j = 0; j < rings.length - 1; j++) {
    const lo = hard ? addRing(rings[j]) : prev, hi = addRing(rings[j + 1]);
    prev = hi;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (!rings[j].p) m.idx.push(lo[s], hi[s], lo[s1]);
      if (!rings[j + 1].p) m.idx.push(lo[s1], hi[s], hi[s1]);
    }
  }
  return m.recomputeNormals();
}

/** Surface of revolution around a vertical axis at (cx, cy, cz). prof: [[r, y, shade], ...] bottom -> top. */
function lathe(cx, cy, cz, prof, segs, base, o = {}) {
  const rings = prof.map(([r, y, sh], j) => {
    const c = scaleCol(base, sh);
    if (r === 0) return { p: [cx, cy + y, cz], c };
    const ring = [];
    for (let s = 0; s < segs; s++) {
      const a = s / segs * TAU, k = r * (o.rm ? o.rm(j, s) : 1);
      ring.push([cx + k * Math.cos(a), cy + y + (o.dy ? o.dy(j, s) : 0), cz + k * Math.sin(a)]);
    }
    return { ring, c };
  });
  return ringMesh(rings, segs, !!o.hard);
}

/** Tube along a polyline with per-point radius (parallel-transport frames). colors: one rgb or one per point. */
function tubeRings(path, radii, segs, colors, o = {}) {
  const n = path.length, rings = [], jt = o.jit || 0, rnd = o.rnd;
  let N = null, T = [0, 1, 0];
  for (let i = 0; i < n; i++) {
    T = vnorm(vsub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]));
    if (!N) { const ref = Math.abs(T[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; N = vnorm(vsub(ref, vmul(T, vdot(ref, T)))); }
    else N = vnorm(vsub(N, vmul(T, vdot(N, T))));
    const B = vcross(N, T), c = typeof colors[0] === 'number' ? colors : colors[i], ring = [];
    for (let s = 0; s < segs; s++) {
      const a = s / segs * TAU, k = radii[i] * (jt ? 1 + jt * (rnd() * 2 - 1) : 1);
      ring.push(vadd(path[i], vadd(vmul(N, Math.cos(a) * k), vmul(B, Math.sin(a) * k))));
    }
    rings.push({ ring, c });
  }
  if (o.cap !== undefined) rings.push({ p: vadd(path[n - 1], vmul(T, o.cap)), c: typeof colors[0] === 'number' ? colors : colors[n - 1] });
  return ringMesh(rings, segs);
}

/** Ellipsoid blob (icosphere + noise), placed into dst. */
function addBlob(dst, sub, noiseSeed, amp, color, cx, cy, cz, rx, ry, rz, rot = 0) {
  const b = noisy(sphere(1, sub, color), noiseSeed, amp, 1.3, 2);
  dst.add(b, mat.chain(mat.translate(cx, cy, cz), mat.rotY(rot), mat.scale(rx, ry, rz)));
}

/** Random lean + heading applied to the finished tree (rotation about the ground point). */
function drawLean(r, maxDeg = 4) { return { az: r() * TAU, lean: r() * maxDeg * DEG }; }
const finish = (m, pl) => new Mesh().add(m, mat.chain(mat.rotY(pl.az), mat.rotZ(pl.lean)));

/** Gentle trunk wander so no trunk is a perfect line. */
const wander = (ph, amp) => (y) => [amp * Math.sin(y * 0.55 + ph) * Math.min(1, y / 5), y, amp * Math.cos(y * 0.43 + ph * 1.7) * Math.min(1, y / 5)];

/** Root flare multiplier: ~1.6 at the ground, 1 above ~1 m. */
const flare = (y, k = 0.6) => 1 + k * Math.exp(-Math.max(y, 0) / 0.5);

// ======================================================================= spruce
function planSpruce(seed, p) {
  const r = rng(`spruce:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return {
    r, H, ...drawLean(r),
    needle: jit(mixColor('#2c4429', '#3a5233', r()), r), bark: jit('#574936', r),
    Rmax: H * (0.15 + 0.03 * r()), y0: H * (0.25 + 0.07 * r()), ph: r() * TAU, asym: 0.08 + 0.1 * r(),
  };
}
function buildSpruce(pl, lod) {
  const { H, needle, bark, Rmax, y0, ph, asym, r } = pl, m = new Mesh(), wob = wander(ph, 0.1);
  // trunk
  const ys = lod ? [-0.1, 0.45 * H, 0.97 * H] : [-0.15, 0.2, 0.8, 2, 0.18 * H, 0.35 * H, 0.55 * H, 0.75 * H, 0.97 * H];
  const tr = H * 0.02;
  m.add(tubeRings(ys.map(wob), ys.map((y) => tr * (1 - 0.9 * clamp(y / H)) * (lod ? 1 : flare(y))), lod ? 5 : 7,
    ys.map((y) => scaleCol(bark, (y < 1 ? 0.85 : 1) * (0.92 + 0.16 * r()))), { cap: 0.1 }));
  // tiers: drooping skirts that narrow to a spire
  const n = lod ? 4 : 14, segs = lod ? 8 : 12, crown = new Mesh();
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), y = y0 + f * (H - y0) * 0.93;
    const R = Rmax * Math.pow(1 - f * 0.95, 0.95) * (i === 0 ? 0.88 : 1) * (0.93 + 0.14 * r());
    const h = Math.min(H - y, i === n - 1 ? H - y : (H - y0) / n * 2.5);
    const [tx, , tz] = wob(y), c = scaleCol(needle, lerp(0.8, 1, f) * (0.95 + 0.1 * r()));
    const rmv = [], dyv = [];
    for (let s = 0; s < segs; s++) {
      const a = s / segs * TAU;
      rmv.push((lod ? 1 : 0.8 + 0.4 * r()) * (1 + asym * Math.cos(a - ph)));
      dyv.push(lod ? 0 : -h * 0.2 * r());
    }
    const ox = (lod ? 0 : (r() - 0.5) * 0.25 * R);
    const prof = lod ? [[0, y + 0.3 * h, 0.55], [R, y, 0.8], [0, y + h, 1]]
      : [[0, y + 0.3 * h, 0.5], [R, y, 0.78], [0.5 * R, y + 0.55 * h, 0.95], [0, y + h, 1.05]];
    crown.add(lathe(tx + ox, 0, tz - ox, prof, segs, c, { hard: true, rm: (j, s) => (j === 0 ? 1 : rmv[s]), dy: (j, s) => (j === 1 ? dyv[s] : 0) }));
  }
  crown.tint((x, y) => 0.8 + 0.2 * clamp((y - y0) / (H - y0)));
  m.add(crown);
  return finish(m, pl);
}

// ========================================================================= pine
function planPine(seed, p) {
  const r = rng(`pine:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return {
    r, H, ...drawLean(r),
    needle: jit(mixColor('#2c4429', '#3a5233', 0.3 + 0.7 * r()), r), bark: jit('#574936', r), upper: jit('#85604a', r, 0.05),
    ph: r() * TAU, n: 3 + ((r() * 3) | 0), crownR: H * (0.17 + 0.03 * r()),
  };
}
function pinePads(pl) { // 3-5 large overlapping clumps forming one broad flat-topped mass: [{x,y,z,rx,ry,rz,rot}]
  const { H, ph, n, crownR } = pl, r = pl.r, pads = [];
  for (let i = 0; i < n; i++) {
    const top = i === n - 1, a = ph + i * 2.4 + r() * 0.6;
    const d = top ? crownR * 0.15 : crownR * (0.45 + 0.45 * r());
    const rp = H * (0.15 + 0.04 * r()) * (top ? 0.9 : 1), ry = rp * (0.5 + 0.1 * r());
    const y = top ? H - ry * 0.8 : Math.min(H * (0.76 + 0.1 * r()), 0.95 * H - ry * 0.8);
    pads.push({ x: d * Math.cos(a), y, z: d * Math.sin(a), rx: rp * (0.85 + 0.3 * r()), ry, rz: rp * (0.85 + 0.3 * r()), rot: r() * TAU });
  }
  return pads;
}
function buildPine(pl, lod) {
  const { H, needle, bark, upper, ph, r } = pl, m = new Mesh(), wob = wander(ph, 0.35), pads = pinePads(pl);
  const topY = 0.96 * H, tr = H * 0.016;
  const ys = lod ? [-0.1, 0.4 * H, topY] : [-0.15, 0.2, 0.8, 2, 0.2 * H, 0.32 * H, 0.45 * H, 0.57 * H, 0.7 * H, 0.82 * H, topY];
  m.add(tubeRings(ys.map(wob), ys.map((y) => tr * (1 - 0.72 * clamp(y / topY)) * (lod ? 1 : flare(y, 0.8))), lod ? 5 : 8,
    ys.map((y) => scaleCol(mixColor(bark, upper, 0.7 * smooth((y / H - 0.42) / 0.25)), (y < 1 ? 0.85 : 1) * (0.92 + 0.16 * r()))), { cap: 0.1, jit: lod ? 0 : 0.05, rnd: r }));
  const crown = new Mesh();
  pads.forEach((pd, i) => {
    const c = jit(needle, r, 0.05), top = i === pads.length - 1;
    if (lod) return;
    // branch from the trunk up to the pad
    if (!top) {
      const hs = Math.max(0.5 * H, pd.y - H * (0.1 + 0.05 * r())), s = wob(hs), e = [pd.x * 0.8, pd.y - pd.ry * 0.3, pd.z * 0.8];
      const pts = [0, 0.35, 0.7, 1].map((t) => [lerp(s[0], e[0], Math.pow(t, 1.2)), lerp(s[1], e[1], Math.pow(t, 0.7)), lerp(s[2], e[2], Math.pow(t, 1.2))]);
      m.add(tubeRings(pts, [0.07, 0.06, 0.045, 0.03].map((v) => v * H / 16), 5, scaleCol(upper, 0.85), { cap: 0.05 }));
    }
    addBlob(crown, i < 2 ? 2 : 1, `pine:${pl.ph}:${i}`, 0.17, c, pd.x, pd.y, pd.z, pd.rx, pd.ry, pd.rz, pd.rot);
  });
  if (lod) { // one flat ellipsoid + a bump, same envelope as the pads
    const w = Math.max(...pads.map((p) => Math.hypot(p.x, p.z) + p.rx)), yb = Math.min(...pads.map((p) => p.y - p.ry)), yt = H;
    addBlob(crown, 1, 'pl', 0.05, jit(needle, r, 0.02), 0, (yb + yt) / 2, 0, w * 0.95, (yt - yb) / 2, w * 0.95);
    const t = pads[pads.length - 1];
    addBlob(crown, 0, 'pl2', 0, jit(needle, r, 0.02), t.x, t.y, t.z, t.rx, t.ry, t.rz);
  }
  const { H: hh } = pl, y0 = 0.5 * hh;
  crown.tint((x, y, z) => (0.62 + 0.38 * smooth((y - y0) / (hh - y0))) * (0.88 + 0.12 * clamp(Math.hypot(x, z) / pl.crownR)));
  m.add(crown);
  return finish(m, pl);
}

// ================================================================== broadleaf
function planBroadleaf(seed, p) {
  const r = rng(`broadleaf:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return {
    r, H, ...drawLean(r),
    leaf: jit(mixColor('#4a6a2c', '#55702f', r()), r, 0.06), bark: jit('#574936', r), ph: r() * TAU,
    crownR: H * (0.3 + 0.05 * r()), nLimb: 4 + ((r() * 2) | 0), trunkR: H * 0.03,
  };
}
function broadBlobs(pl) { // [{x,y,z,rx,ry,rz,hs}] ; first is the crown top
  const { H, ph, crownR, nLimb } = pl, r = pl.r, bl = [];
  bl.push({ x: (r() - 0.5) * 0.08 * H, y: 0.78 * H, z: (r() - 0.5) * 0.08 * H, rx: H * 0.22, ry: H * 0.19, rz: H * 0.22, hs: 0 });
  for (let i = 0; i < nLimb; i++) {
    const a = ph + i * TAU / nLimb + (r() - 0.5) * 0.7, d = crownR * (0.5 + 0.4 * r()), rb = H * (0.17 + 0.05 * r());
    bl.push({ x: d * Math.cos(a), y: H * (0.55 + 0.2 * r()), z: d * Math.sin(a), rx: rb, ry: rb * 0.85, rz: rb * (0.9 + 0.2 * r()), hs: H * (0.28 + 0.1 * r()) });
  }
  return bl;
}
function buildBroadleaf(pl, lod) {
  const { H, leaf, bark, ph, trunkR, r } = pl, m = new Mesh(), wob = wander(ph, 0.15), blobs = broadBlobs(pl);
  const topY = 0.8 * H;
  const ys = lod ? [-0.1, 0.4 * H, topY] : [-0.15, 0.25, 0.8, 1.8, 0.18 * H, 0.3 * H, 0.45 * H, 0.6 * H, topY];
  m.add(tubeRings(ys.map(wob), ys.map((y) => trunkR * (1 - 0.7 * clamp(y / topY)) * (lod ? 1 : flare(y, 0.7))), lod ? 5 : 8,
    ys.map((y) => scaleCol(bark, (y < 1 ? 0.85 : 1) * (0.92 + 0.16 * r()))), { cap: 0.1, jit: lod ? 0 : 0.05, rnd: r }));
  const crown = new Mesh();
  blobs.forEach((b, i) => {
    if (i > 0 && !lod) { // limb from the trunk to this blob
      const s = wob(b.hs), e = [b.x * 0.85, b.y - b.ry * 0.3, b.z * 0.85], bend = 0.25 * Math.hypot(b.x, b.z);
      const pts = [0, 0.33, 0.66, 1].map((t) => [lerp(s[0], e[0], Math.pow(t, 1.3)), lerp(s[1], e[1], Math.pow(t, 0.75)) - bend * 0.15 * Math.sin(t * Math.PI), lerp(s[2], e[2], Math.pow(t, 1.3))]);
      const lr = trunkR * 0.5;
      m.add(tubeRings(pts, [lr, lr * 0.75, lr * 0.5, lr * 0.3], 6, bark, { cap: 0.05 }));
    }
    if (lod) return;
    addBlob(crown, i < 2 ? 2 : 1, `broad:${pl.ph}:${i}`, 0.16, jit(leaf, r, 0.05), b.x, b.y, b.z, b.rx, b.ry, b.rz, r() * TAU);
  });
  if (lod) { // a big envelope ellipsoid + two bumps
    const top = Math.max(...blobs.map((b) => b.y + b.ry)), bot = Math.min(...blobs.map((b) => b.y - b.ry));
    const w = Math.max(...blobs.map((b) => Math.hypot(b.x, b.z) + b.rx));
    addBlob(crown, 1, 'bl', 0.06, jit(leaf, r, 0.02), 0, (top + bot) / 2, 0, w * 0.88, (top - bot) / 2, w * 0.88);
    for (const b of [blobs[0], blobs[1]]) addBlob(crown, 0, 'bl2', 0, jit(leaf, r, 0.02), b.x, b.y, b.z, b.rx, b.ry, b.rz);
  }
  const cb = H * 0.38;
  crown.tint((x, y, z) => (0.6 + 0.4 * smooth((y - cb) / (H - cb))) * (1 - 0.3 * (1 - clamp(Math.hypot(x, z) / pl.crownR)) * (1 - 0.6 * clamp((y - cb) / (H - cb)))));
  m.add(crown);
  return finish(m, pl);
}

// ========================================================================= birch
function planBirch(seed, p) {
  const r = rng(`birch:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return {
    r, H, ...drawLean(r),
    leaf: jit(mixColor('#4f6f30', '#5f7c38', r()), r, 0.05), bark: jit('#d6d1c4', r, 0.05),
    ph: r() * TAU, n: 7 + ((r() * 3) | 0), trunkR: 0.12 * H / 13,
  };
}
function birchBlobs(pl) {
  const { H, n, ph } = pl, r = pl.r, bl = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), y = H * (0.4 + 0.57 * f), a = ph + i * 2.4 + r() * 0.6, d = H * 0.12 * (1 - 0.75 * f) * (0.4 + 0.6 * r());
    const rb = H * (0.065 + 0.04 * (1 - f) * r() + 0.02 * r());
    bl.push({ x: d * Math.cos(a), y, z: d * Math.sin(a), rx: rb, ry: rb * 1.3, rz: rb * (0.9 + 0.2 * r()) });
  }
  const t = bl[n - 1]; t.y = Math.min(t.y, H - t.ry * 0.9); // keep the apex at the nominal height
  return bl;
}
function buildBirch(pl, lod) {
  const { H, leaf, bark, ph, trunkR, r } = pl, m = new Mesh(), wob = wander(ph, 0.3), blobs = birchBlobs(pl);
  const topY = 0.93 * H;
  const ys = lod ? [-0.1, 0.45 * H, topY] : [-0.1, 0.3, 0.9, 0.15 * H, 0.25 * H, 0.35 * H, 0.45 * H, 0.55 * H, 0.65 * H, 0.75 * H, 0.85 * H, topY];
  const cols = ys.map((y) => (y < 0.8 ? mixColor('#4a4038', bark, smooth(y / 0.8)) : scaleCol(bark, r() < 0.14 ? 0.45 : 0.93 + 0.14 * r())));
  m.add(tubeRings(ys.map(wob), ys.map((y) => trunkR * (1 - 0.8 * clamp(y / topY)) * (lod ? 1 : flare(y, 0.35))), lod ? 5 : 6, cols, { cap: 0.1 }));
  const crown = new Mesh();
  if (lod) {
    const top = Math.max(...blobs.map((b) => b.y + b.ry)), bot = Math.min(...blobs.map((b) => b.y - b.ry));
    const w = Math.max(...blobs.map((b) => Math.hypot(b.x, b.z) + b.rx));
    addBlob(crown, 1, 'bi', 0.05, jit(leaf, r, 0.02), 0, (top + bot) / 2, 0, w * 0.85, (top - bot) / 2, w * 0.85);
  } else blobs.forEach((b, i) => {
    const hs = Math.max(0.3 * H, b.y - H * 0.12), s = wob(hs), e = [b.x * 0.8, b.y - b.ry * 0.3, b.z * 0.8];
    const pts = [0, 0.5, 1].map((t) => [lerp(s[0], e[0], t * t), lerp(s[1], e[1], t), lerp(s[2], e[2], t * t)]);
    m.add(tubeRings(pts, [0.04, 0.03, 0.018].map((v) => v * H / 13), 4, scaleCol(bark, 0.7), { cap: 0.03 }));
    addBlob(crown, 1, `birch:${pl.ph}:${i}`, 0.24, jit(leaf, r, 0.05), b.x, b.y, b.z, b.rx, b.ry, b.rz, r() * TAU);
  });
  const cb = H * 0.35;
  crown.tint((x, y, z) => (0.62 + 0.38 * smooth((y - cb) / (H - cb))) * (1 - 0.2 * (1 - clamp(Math.hypot(x, z) / (H * 0.12)))));
  m.add(crown);
  return finish(m, pl);
}

// ========================================================================== palm
function planPalm(seed, p) {
  const r = rng(`palm:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return { r, H, ...drawLean(r, 3), leaf: jit(mixColor('#4a6a2c', '#5d7a34', r()), r), trunk: jit('#7d6c55', r), bendAz: r() * TAU, bend: H * (0.08 + 0.12 * r()), nF: 9 + ((r() * 2) | 0) };
}
/** Trunk centreline: slight sideways curve, ends at the crown point. */
const palmPath = (pl, t) => { const x = pl.bend * t * t; return [x * Math.cos(pl.bendAz), pl.H * 0.93 * (t - 0.12 * t * t), x * Math.sin(pl.bendAz)]; };

/** Fronds as V-folded strips, emitted with both windings. */
function frondTris(o, dir, len, pitch, droop, wmax, nSt, fold) {
  const up = [0, 1, 0], side = [-dir[2], 0, dir[0]], st = [];
  for (let i = 0; i <= nSt; i++) {
    const t = i / nSt, h = len * t, w = wmax * Math.sin(Math.PI * Math.pow(t, 0.7) * 0.97) * (t < 0.08 ? t / 0.08 : 1) * (i === nSt ? 0 : 1);
    const rib = vadd(o, vadd(vmul(dir, h * Math.cos(pitch)), vmul(up, h * Math.sin(pitch) - droop * len * t * t)));
    const lift = fold ? 0.25 * w : 0, edgeDrop = fold ? 0.3 * w + 0.15 * w * t : 0;
    st.push({ M: vadd(rib, vmul(up, lift)), L: vadd(vsub(rib, vmul(up, edgeDrop)), vmul(side, w)), R: vadd(vsub(rib, vmul(up, edgeDrop)), vmul(side, -w)) });
  }
  const tris = [], area = (t) => { const g = vcross(vsub(t[1], t[0]), vsub(t[2], t[0])); return Math.hypot(...g); };
  const push = (a, b, c) => { const t = [a, b, c]; if (area(t) > 1e-8) tris.push(t); };
  for (let i = 0; i < nSt; i++) {
    const a = st[i], b = st[i + 1];
    if (fold) { push(a.L, a.M, b.L); push(b.L, a.M, b.M); push(a.M, a.R, b.M); push(b.M, a.R, b.R); }
    else { push(a.L, a.R, b.L); push(b.L, a.R, b.R); }
  }
  return tris;
}
function buildPalm(pl, lod) {
  const { H, leaf, trunk, r } = pl, m = new Mesh(), crownPt = palmPath(pl, 1);
  const rings = lod ? 4 : 20, ts = [], rad = [], cols = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1); ts.push(t);
    const bulge = lod ? 1 : (i % 2 === 0 ? 1.1 : 0.95);
    rad.push((0.3 * H / 10) * (0.62 + 0.38 * (1 - t)) * bulge * (t < 0.05 ? 1.4 - 8 * t : 1));
    cols.push(scaleCol(trunk, (i % 2 === 0 || lod) ? 0.95 + 0.1 * r() : 0.72));
  }
  m.add(tubeRings(ts.map((t) => (t === 0 ? [0, -0.15, 0] : palmPath(pl, t))), rad, lod ? 5 : 7, cols, { cap: 0.05 }));
  const fr = new Mesh();
  const nF = lod ? 8 : pl.nF, dead = lod ? 0 : 2;
  for (let k = 0; k < nF + dead; k++) {
    const isDead = k >= nF, a = (k / (nF + dead)) * TAU + (r() - 0.5) * 0.5, dir = [Math.cos(a), 0, Math.sin(a)];
    const len = H * (0.28 + 0.1 * r()) * (isDead ? 0.85 : 1);
    const pitch = isDead ? -0.9 - 0.3 * r() : (0.1 + 0.55 * r()) * (k % 2 ? 0.7 : 1);
    const droop = isDead ? 0.15 : 0.6 + 0.3 * r(), o = vadd(crownPt, [0, 0.1, 0]);
    const tris = frondTris(o, dir, len, pitch, droop, 0.42 * H / 10, lod ? 2 : 6, !lod);
    const c = isDead ? jit('#7a6a3a', r) : leaf;
    const colFn = (p) => { const d = clamp(Math.hypot(p[0] - o[0], p[2] - o[2]) / len); return scaleCol(c, 0.65 + 0.4 * d); };
    fr.flatTris(tris, colFn);
    fr.flatTris(tris.map(([a1, b, c1]) => [a1, c1, b]), colFn);
  }
  m.add(fr);
  if (!lod) for (let k = 0; k < 4; k++) { // coconut cluster under the crown
    const a = k / 4 * TAU + r(), q = sphere(1, 0, jit('#5e5a3a', r));
    m.add(q, mat.chain(mat.translate(crownPt[0] + 0.22 * Math.cos(a), crownPt[1] - 0.15, crownPt[2] + 0.22 * Math.sin(a)), mat.scale(0.13 * H / 10)));
  }
  return finish(m, pl);
}

// ======================================================================== shrub
function planShrub(seed, p) {
  const r = rng(`shrub:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return { r, H, az: 0, lean: 0, leaf: jit(mixColor('#4a6a2c', '#5d7a34', r()), r), ph: r() * TAU };
}
function buildShrub(pl, lod) {
  const { H, leaf, ph, r } = pl, s = H / 1.5, m = new Mesh();
  if (lod) addBlob(m, 0, `sh:${ph}`, 0.08, leaf, 0, 0.42 * H, 0, 0.62 * s, 0.45 * H, 0.62 * s, ph);
  else {
    addBlob(m, 1, `sh:${ph}:0`, 0.2, jit(leaf, r, 0.05), 0, 0.42 * H, 0, 0.62 * s, 0.42 * H, 0.62 * s, ph);
    addBlob(m, 1, `sh:${ph}:1`, 0.2, jit(leaf, r, 0.05), 0.35 * s * Math.cos(ph), 0.32 * H, 0.35 * s * Math.sin(ph), 0.5 * s, 0.34 * H, 0.5 * s, ph + 1);
    for (let i = 0; i < 5; i++) {
      const a = ph + 1.2 + i * TAU / 5 + (r() - 0.5) * 0.6, d = (0.4 + 0.3 * r()) * s, rb = (0.26 + 0.14 * r()) * s;
      addBlob(m, 0, `sh:${ph}:${i + 2}`, 0.25, jit(leaf, r, 0.06), d * Math.cos(a), (0.2 + 0.25 * r()) * H + 0.1, d * Math.sin(a), rb, rb * 0.8, rb, r() * TAU);
    }
  }
  m.tint((x, y) => 0.5 + 0.5 * Math.pow(clamp(y / H), 0.7) * (lod ? 0.92 : 1));
  let lo = Infinity, hi = -Infinity; for (let i = 1; i < m.pos.length; i += 3) { lo = Math.min(lo, m.pos[i]); hi = Math.max(hi, m.pos[i]); }
  const k = H / (hi - lo); // fit the nominal height, settle slightly into the ground
  return new Mesh().add(m, mat.chain(mat.translate(0, -0.03 - lo * k, 0), mat.scale(1, k, 1)));
}

// ======================================================================== grass
function planGrass(seed, p) {
  const r = rng(`grass:${seed}`), H = p.height * (0.85 + 0.3 * r());
  const base = jit(mixColor('#6f8338', '#a89a5c', r() * 0.6), r);
  return { r, H, az: 0, lean: 0, base, nb: 8 + ((r() * 2) | 0) };
}
function buildGrass(pl, lod) {
  const { H, base, r } = pl, m = new Mesh(), tipC = mixColor(base, '#b4a468', 0.25);
  const colFn = (p) => mixColor(scaleCol(base, 0.55), tipC, clamp(p[1] / H));
  const tris = [];
  if (lod) for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3 + r(), c = Math.cos(a), s = Math.sin(a), w = 0.05 * H / 0.5, lean = 0.15 * H;
    tris.push([[-w * s, 0, w * c], [w * s, 0, -w * c], [lean * c, 0.9 * H, lean * s]]);
  } else for (let k = 0; k < pl.nb; k++) {
    const a = r() * TAU, rr = 0.06 * Math.sqrt(r()), b0 = [rr * Math.cos(r() * TAU), 0, rr * Math.sin(r() * TAU)];
    const hg = H * (0.6 + 0.4 * r()), lean = 0.12 + 0.5 * r(), d = [Math.cos(a), 0, Math.sin(a)], sd = [-d[2] * 0.012 * (1 + r()), 0, d[0] * 0.012 * (1 + r())];
    const p1 = vadd(b0, [d[0] * 0.5 * hg * Math.sin(lean * 0.5), 0.5 * hg * Math.cos(lean * 0.5), d[2] * 0.5 * hg * Math.sin(lean * 0.5)]);
    const p2 = vadd(p1, [d[0] * 0.5 * hg * Math.sin(lean * 1.5), 0.5 * hg * Math.cos(lean * 1.5), d[2] * 0.5 * hg * Math.sin(lean * 1.5)]);
    const s2 = vmul(sd, 0.6);
    tris.push([vsub(b0, sd), vadd(b0, sd), vsub(p1, s2)], [vadd(b0, sd), vadd(p1, s2), vsub(p1, s2)], [vsub(p1, s2), vadd(p1, s2), p2]);
  }
  m.flatTris(tris, colFn);
  m.flatTris(tris.map(([a, b, c]) => [a, c, b]), colFn);
  return m;
}

// ========================================================================== snag
function planSnag(seed, p) {
  const r = rng(`snag:${seed}`), H = p.height * (0.85 + 0.3 * r());
  return { r, H, ...drawLean(r, 5), bark: jit('#85806f', r), dark: jit('#5e5a55', r), ph: r() * TAU, nB: 4 + ((r() * 3) | 0) };
}
function buildSnag(pl, lod) {
  const { H, bark, ph, r } = pl, m = new Mesh(), wob = wander(ph, 0.2), tr = H * 0.027;
  const ys = lod ? [-0.1, 0.5 * H, H] : [-0.15, 0.25, 0.9, 0.15 * H, 0.3 * H, 0.45 * H, 0.6 * H, 0.75 * H, 0.9 * H, H];
  m.add(tubeRings(ys.map(wob), ys.map((y) => tr * (1 - 0.6 * clamp(y / H)) * (lod ? 1 : flare(y, 0.5))), lod ? 5 : 7,
    ys.map((y) => scaleCol(bark, y < 0.3 ? 0.75 : lod ? 0.9 : 0.8 + 0.28 * r())), { cap: lod ? 0 : 0.35 * r() + 0.1, jit: lod ? 0 : 0.1, rnd: r }));
  for (let i = 0; i < pl.nB; i++) { // broken branches
    const hs = H * (0.35 + 0.55 * (i + r() * 0.7) / pl.nB), a = ph + i * 2.4 + r() * 0.5, len = H * (0.09 + 0.14 * r()) * (1.3 - hs / H);
    if (lod && i > 1) break;
    const s = wob(hs), dirv = [Math.cos(a), 0, Math.sin(a)], up = 0.3 + 0.6 * r(), sag = 0.2 * r();
    const pts = [0, 0.5, 1].map((t) => [s[0] + dirv[0] * len * t, s[1] + len * t * (up - sag * t) - 0.03, s[2] + dirv[2] * len * t]);
    const br = tr * 0.28 * (1 - hs / H * 0.5);
    m.add(tubeRings(pts, [br, br * 0.7, br * 0.45], lod ? 3 : 5, pl.dark, { cap: 0 }));
    if (!lod && r() < 0.5) { // a short side twig
      const q = pts[1], b = a + 0.9, e = [q[0] + Math.cos(b) * len * 0.35, q[1] + len * 0.2, q[2] + Math.sin(b) * len * 0.35];
      m.add(tubeRings([q, vadd(q, vmul(vsub(e, q), 0.5)), e], [br * 0.5, br * 0.35, br * 0.22], 4, pl.dark, { cap: 0 }));
    }
  }
  return finish(m, pl);
}

// ======================================================================= export
const species = (desc, height, plan, build) => ({
  desc, defaults: { height },
  make: (seed, p = {}) => build(plan(seed, { height, ...p }), false),
  lod1: (seed, p = {}) => build(plan(seed, { height, ...p }), true),
});

export const VEGETATION = {
  spruce: species('Norway spruce: straight trunk, 14 drooping irregular tiers narrowing to a spire, bare lower quarter.', 18, planSpruce, buildSpruce),
  pine: species('Scots pine: tall bare trunk with orange upper bark, flat irregular crown of needle pads.', 16, planPine, buildPine),
  broadleaf: species('Oak/beech: thick trunk, a few main limbs, lumpy rounded crown of several noisy blobs.', 14, planBroadleaf, buildBroadleaf),
  birch: species('Silver birch: slender pale trunk with dark scars, narrow airy crown of small blobs.', 13, planBirch, buildBirch),
  palm: species('Palm: curved ringed trunk, drooping V-folded fronds (double-sided), a few dead fronds and nuts.', 10, planPalm, buildPalm),
  shrub: species('Low shrub: cluster of noisy leaf blobs, darker toward the ground.', 1.5, planShrub, buildShrub),
  grass: species('Grass tuft: thin curved double-sided blades, dark base to light tip.', 0.5, planGrass, buildGrass),
  snag: species('Dead tree: weathered grey trunk with a broken top and a few broken branches.', 9, planSnag, buildSnag),
};
