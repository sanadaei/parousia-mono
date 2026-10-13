// A fixed, C1 Cartesian lattice sampled on the sphere has no longitude seam.
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a * (1 - t) + b * t;
function seedHash(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function lattice(seed, x, y, z) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295 * 2 - 1;
}
export function createSphericalNoise(seed, radiusM, wavelengthM) {
  const key = seedHash(seed), scale = radiusM / wavelengthM;
  return vector => {
    const p = vector.map(v => v * scale), cell = p.map(Math.floor), t = p.map((v, i) => smooth(v - cell[i]));
    const row = (y, z) => lerp(lattice(key, cell[0], y, z), lattice(key, cell[0] + 1, y, z), t[0]);
    const plane = z => lerp(row(cell[1], z), row(cell[1] + 1, z), t[1]);
    return lerp(plane(cell[2]), plane(cell[2] + 1), t[2]);
  };
}
