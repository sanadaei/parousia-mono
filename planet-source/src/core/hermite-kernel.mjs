// Arithmetic is shared by resident and paged fields. Keep its order stable:
// existing snapshot witnesses depend on exact IEEE-754 results.
export const minmod = (a, b) => Math.sign(a) !== Math.sign(b) ? 0 : Math.sign(a) * Math.min(Math.abs(a), Math.abs(b));
export const hermiteBasis = t => [2 * t ** 3 - 3 * t ** 2 + 1, -2 * t ** 3 + 3 * t ** 2,
  t ** 3 - 2 * t ** 2 + t, t ** 3 - t ** 2];
export function evaluateHermitePatch(hx, hy, values, dx, dy) {
  const row = i => hx[0] * values[i] + hx[1] * values[i + 1] + hx[2] * dx[i] + hx[3] * dx[i + 1];
  const tangent = i => hx[0] * dy[i] + hx[1] * dy[i + 1];
  return hy[0] * row(0) + hy[1] * row(2) + hy[2] * tangent(0) + hy[3] * tangent(2);
}
/** Reads at most a 4x4 neighborhood; no resident array or derivative grid. */
export function createPeriodicHermiteAccessor(get, columns, rows, {cacheLastPatch=false}={}) {
  if(typeof cacheLastPatch!=='boolean')throw new TypeError('cacheLastPatch must be boolean');
  // Opt-in for immutable hashed pages/noise only. Ordinary mutable callers
  // still read current values on every invocation. Retain just one patch.
  let cached=null;
  const read = (x, y) => get((x % columns + columns) % columns, y);
  return (xM, yM) => {
    // Reproduce the two-ghost-column resident field's coordinate arithmetic.
    const x = Math.max(0, Math.min(columns + 3, (xM + 2) - .5));
    const y = Math.max(0, Math.min(rows - 1, yM - .5));
    const x0 = Math.floor(x) - 2, y0 = Math.floor(y), x1 = x0 + 1, y1 = Math.min(rows - 1, y0 + 1);
    let patch=cacheLastPatch&&cached?.x0===x0&&cached?.y0===y0?cached:null;
    if(!patch){
    const vertices = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    const values = vertices.map(([xx, yy]) => read(xx, yy));
    const dx = vertices.map(([xx, yy], i) => minmod(values[i] - read(xx - 1, yy), read(xx + 1, yy) - values[i]));
    const dy = vertices.map(([xx, yy], i) => yy === 0 || yy === rows - 1 ? 0
      : minmod(values[i] - read(xx, yy - 1), read(xx, yy + 1) - values[i]));
    patch={x0,y0,values,dx,dy};
    if(cacheLastPatch)cached=patch;
    }
    return evaluateHermitePatch(hermiteBasis(x - Math.floor(x)), hermiteBasis(y - y0), patch.values, patch.dx, patch.dy);
  };
}
