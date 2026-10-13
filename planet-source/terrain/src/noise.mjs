// Seeded 3D simplex noise and fractal helpers. Engine-agnostic, no deps.

export function hashSeed(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let s = hashSeed(seed);
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G3 = 1 / 6, F3 = 1 / 3;
const GRAD = new Float32Array([1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1]);

/** Returns noise(x,y,z) in roughly [-1,1]. */
export function createSimplex3(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  return function noise(x, y, z) {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, t0, g;
    t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { g = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0); }
    t0 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t0 > 0) { g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1); }
    t0 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t0 > 0) { g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2); }
    t0 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t0 > 0) { g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3); }
    return 32 * n;
  };
}

/** Fractal Brownian motion over a unit-scale 3D noise. Output roughly [-1,1]. */
export function fbm(noise, x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 3.7);
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal in [0,1]: sharp crests, used to break up uplift belts. */
export function ridged(noise, x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1, w = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x * f + o * 11.7, y * f + o * 5.3, z * f - o * 7.9));
    n *= n * w; w = Math.min(1, n * 2);
    sum += amp * n; norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}
