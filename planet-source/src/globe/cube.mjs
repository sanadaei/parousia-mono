export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const length = a => Math.hypot(...a);
export const normalize = a => { const d = length(a); return a.map(v => v / d); };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const tileKey = t => `${t.face}/${t.level}/${t.x}/${t.y}`;
export const parentTile = t => t.level ? { face: t.face, level: t.level - 1, x: t.x >> 1, y: t.y >> 1 } : null;
export const children = t => [0, 1, 2, 3].map(i => ({ face: t.face, level: t.level + 1, x: t.x * 2 + i % 2, y: t.y * 2 + (i >> 1) }));
export function cubeDirection(face, u, v) {
  return normalize([[1, u, v], [-1, -u, v], [-u, 1, v], [u, -1, v], [u, v, 1], [u, -v, -1]][face]);
}
export function tileDirection(t, x, y) {
  const n = 2 ** t.level;
  return cubeDirection(t.face, -1 + 2 * (t.x + x) / n, -1 + 2 * (t.y + y) / n);
}
export const geographic = d => ({ latDeg: Math.atan2(d[2], Math.hypot(d[0], d[1])) * 180 / Math.PI, lonDeg: Math.atan2(d[1], d[0]) * 180 / Math.PI });
export function tileBound(t, radius) {
  const center = tileDirection(t, .5, .5), corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(p => tileDirection(t, ...p));
  // acos(dot) loses all angular resolution for centimetre-scale cells.
  // atan2(cross,dot) retains the small-angle term; pad floating roundoff.
  const angular = Math.max(...corners.map(d => Math.atan2(length(cross(center,d)),dot(center,d))))+32*Number.EPSILON;
  return { center, angular, radiusM: radius * 2 * Math.sin(angular / 2), corners };
}
export function triangleInterpolate(a, b, c, d, x, y) {
  return x + y <= 1 ? a.map((v, i) => v * (1 - x - y) + b[i] * x + c[i] * y)
    : b.map((v, i) => v * (1 - y) + c[i] * (1 - x) + d[i] * (x + y - 1));
}
export function nearestTileDirection(tile, d) {
  const axes = [[d[0], d[1], d[2]], [-d[0], -d[1], d[2]], [d[1], -d[0], d[2]], [-d[1], d[0], d[2]], [d[2], d[0], d[1]], [-d[2], d[0], -d[1]]][tile.face];
  if (axes[0] <= 0) return tileDirection(tile, .5, .5);
  const n = 2 ** tile.level, x = (axes[1] / axes[0] + 1) / 2 * n - tile.x, y = (axes[2] / axes[0] + 1) / 2 * n - tile.y;
  return tileDirection(tile, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
}
