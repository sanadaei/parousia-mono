/** Shared graph-surface derivatives for metric regional and projected charts. */
export function unitNormalForGradient({ x: gx, y: gy }) {
  const norm = Math.hypot(gx, gy, 1);
  return { x: gx === 0 ? 0 : -gx / norm, y: gy === 0 ? 0 : -gy / norm, z: 1 / norm };
}
export function fixedStencilCurvature(groundAt, x, y, z, { x: gx, y: gy }, d) {
  const square = d * d;
  const xx = (groundAt(x - d, y) - 2 * z + groundAt(x + d, y)) / square;
  const yy = (groundAt(x, y - d) - 2 * z + groundAt(x, y + d)) / square;
  const xy = (groundAt(x + d, y + d) - groundAt(x + d, y - d) - groundAt(x - d, y + d) + groundAt(x - d, y - d)) / (4 * square);
  const denominator = 1 + gx * gx + gy * gy;
  const mean = ((1 + gy * gy) * xx - 2 * gx * gy * xy + (1 + gx * gx) * yy) / (2 * denominator ** 1.5);
  const gaussian = (xx * yy - xy * xy) / denominator ** 2;
  if (![xx, yy, xy, mean, gaussian].every(Number.isFinite)) throw new RangeError('Numeric range of curvature is too large');
  return { xxPerM: xx || 0, yyPerM: yy || 0, xyPerM: xy || 0, meanPerM: mean || 0, gaussianPerM2: gaussian || 0, stencilStepM: d };
}
