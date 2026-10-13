import { gridAxisCuts, segmentGridCuts } from './field-math.mjs';
import { restrictBernstein } from './bernstein.mjs';
import { minmod, hermiteBasis as basis, evaluateHermitePatch } from './hermite-kernel.mjs';

// Shared vertex derivatives and zero mixed derivatives make neighboring patches C1.
// Minmod derivatives keep every Bezier control inside the four-corner height range.

export function createHermiteField(field, grid, frame) {
  const { columns, rows, cellSizeM } = grid;
  const dx = new Float64Array(field.length), dy = new Float64Array(field.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const i = y * columns + x;
    if (x > 0 && x < columns - 1) dx[i] = minmod(field[i] - field[i - 1], field[i + 1] - field[i]);
    if (y > 0 && y < rows - 1) dy[i] = minmod(field[i] - field[i - columns], field[i + columns] - field[i]);
  }
  const at = (xM, yM) => {
    const x = Math.max(0, Math.min(columns - 1, (xM - frame.originXM) / cellSizeM - 0.5));
    const y = Math.max(0, Math.min(rows - 1, (yM - frame.originYM) / cellSizeM - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(columns - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
    const hx = basis(x - x0), hy = basis(y - y0);
    const ids = [y0 * columns + x0, y0 * columns + x1, y1 * columns + x0, y1 * columns + x1];
    return evaluateHermitePatch(hx, hy, ids.map(i => field[i]), ids.map(i => dx[i]), ids.map(i => dy[i]));
  };
  const clampX = x => Math.max(0, Math.min(columns - 1, (x - frame.originXM) / cellSizeM - 0.5));
  const clampY = y => Math.max(0, Math.min(rows - 1, (y - frame.originYM) / cellSizeM - 0.5));
  function patchControls(x, y) {
    const values = Array.from({ length: 4 }, () => Array(4));
    for (const [cx, fx, sx] of [[0, x, 1], [3, x + 1, -1]]) for (const [cy, fy, sy] of [[0, y, 1], [3, y + 1, -1]]) {
      const i = fy * columns + fx, innerX = cx === 0 ? 1 : 2, innerY = cy === 0 ? 1 : 2;
      values[cy][cx] = field[i]; values[cy][innerX] = field[i] + sx * dx[i] / 3;
      values[innerY][cx] = field[i] + sy * dy[i] / 3;
      values[innerY][innerX] = field[i] + sx * dx[i] / 3 + sy * dy[i] / 3;
    }
    return values;
  }
  function controlsOnRectangle(xa, ya, xb, yb) {
    const x = Math.min(columns - 2, Math.floor((xa + xb) / 2)), y = Math.min(rows - 2, Math.floor((ya + yb) / 2));
    const values = patchControls(x, y);
    // Metric grid cuts can round to just outside the chosen patch at an endpoint.
    const local = t => Math.max(0, Math.min(1, t));
    const horizontal = values.map(row => restrictBernstein(row, local(xa - x), local(xb - x)));
    const clipped = Array.from({ length: 4 }, () => Array(4));
    for (let i = 0; i < 4; i++) {
      const column = restrictBernstein(horizontal.map(row => row[i]), local(ya - y), local(yb - y));
      for (let j = 0; j < 4; j++) clipped[j][i] = column[j];
    }
    return clipped;
  }
  function visitRectangles({ minXM, minYM, maxXM, maxYM }, visit) {
    const xs = [minXM, ...gridAxisCuts(minXM, maxXM, frame.originXM, columns, cellSizeM), maxXM];
    const ys = [minYM, ...gridAxisCuts(minYM, maxYM, frame.originYM, rows, cellSizeM), maxYM];
    for (let j = 1; j < ys.length; j++) for (let i = 1; i < xs.length; i++) {
      visit(clampX(xs[i - 1]), clampY(ys[j - 1]), clampX(xs[i]), clampY(ys[j]));
    }
  }
  // Cropped patch control hulls give a conservative rectangle bound. Sampling
  // corners is insufficient for a cubic, even though full patch ranges are bounded.
  at.rectangleBounds = rect => {
    let min = Infinity, max = -Infinity;
    visitRectangles(rect, (xa, ya, xb, yb) => {
      const controls = controlsOnRectangle(xa, ya, xb, yb).flat();
      min = Math.min(min, ...controls); max = Math.max(max, ...controls);
    });
    return { min, max };
  };
  at.derivativeBounds = rect => {
    let x = 0, y = 0, maxPatchSpan = 0;
    visitRectangles(rect, (xa, ya, xb, yb) => {
      const values = patchControls(Math.min(columns - 2, Math.floor((xa + xb) / 2)), Math.min(rows - 2, Math.floor((ya + yb) / 2)));
      const all = values.flat(); maxPatchSpan = Math.max(maxPatchSpan, Math.max(...all) - Math.min(...all));
      for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) x = Math.max(x, 3 * Math.abs(values[j][i + 1] - values[j][i]) / cellSizeM);
      for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) y = Math.max(y, 3 * Math.abs(values[j + 1][i] - values[j][i]) / cellSizeM);
    });
    return { x, y, maxPatchSpan };
  };
  at.segmentPolynomials = (a, b, maxCuts = Infinity) => {
    const cuts = segmentGridCuts(a, b, grid, frame, maxCuts), pieces = [], c3 = [1, 3, 3, 1], c6 = [1, 6, 15, 20, 15, 6, 1];
    const pointAt = t => ({ x: clampX(a.xM * (1 - t) + b.xM * t), y: clampY(a.yM * (1 - t) + b.yM * t) });
    for (let n = 1; n < cuts.length; n++) {
      const lo = cuts[n - 1], hi = cuts[n], p = pointAt(lo), q = pointAt(hi);
      let matrix = controlsOnRectangle(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y));
      if (q.x < p.x) matrix = matrix.map(row => row.reverse());
      if (q.y < p.y) matrix.reverse();
      const controls = Array(7).fill(0);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) controls[i + j] += matrix[j][i] * c3[i] * c3[j] / c6[i + j];
      pieces.push({ lo, hi, controls });
    }
    return pieces;
  };
  return at;
}
