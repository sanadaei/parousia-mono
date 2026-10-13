// De Casteljau operations keep the field bounds in the Bernstein basis.
export function splitBernstein(values, t) {
  const row = [...values], left = [row[0]], right = [row.at(-1)];
  for (let n = row.length - 1; n > 0; n--) {
    for (let i = 0; i < n; i++) row[i] = row[i] * (1 - t) + row[i + 1] * t;
    left.push(row[0]); right.push(row[n - 1]);
  }
  return [left, right.reverse()];
}
export const evaluateBernstein = (values, t) => splitBernstein(values, t)[0].at(-1);
export function restrictBernstein(values, lo, hi) {
  if (lo === hi) return values.map(() => evaluateBernstein(values, lo));
  const upper = hi === 1 ? values : splitBernstein(values, hi)[0];
  return lo === 0 ? [...upper] : splitBernstein(upper, lo / hi)[1];
}

// Roots of the derivative split a polynomial into monotone intervals. Recursing
// on degree also finds even-multiplicity roots, which sign-change probes miss.
export function bernsteinRoots(values) {
  if (values.some(v => !Number.isFinite(v))) throw new RangeError('Polynomial numeric range is too large');
  const scale = Math.max(...values.map(Math.abs));
  if (values.length < 2 || scale === 0 || Math.min(...values) > 0 || Math.max(...values) < 0) return [];
  const normalized = values.map(v => v / scale), n = values.length - 1;
  const turns = bernsteinRoots(normalized.slice(1).map((v, i) => n * (v - normalized[i])));
  const cuts = [0, ...turns.filter(t => t > 0 && t < 1), 1], roots = [];
  for (const t of cuts) if (Math.abs(evaluateBernstein(normalized, t)) <= 1e-13) roots.push(t);
  for (let i = 1; i < cuts.length; i++) {
    let lo = cuts[i - 1], hi = cuts[i], fLo = evaluateBernstein(normalized, lo);
    const fHi = evaluateBernstein(normalized, hi);
    if (Math.abs(fLo) <= 1e-13 || Math.abs(fHi) <= 1e-13 || Math.sign(fLo) === Math.sign(fHi)) continue;
    for (let j = 0; j < 48; j++) {
      const mid = (lo + hi) / 2, fMid = evaluateBernstein(normalized, mid);
      if (fMid === 0) { lo = hi = mid; break; }
      if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else hi = mid;
    }
    roots.push((lo + hi) / 2);
  }
  return roots.sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1] > 1e-12);
}
export function bernsteinExtrema(values) {
  const n = values.length - 1;
  return bernsteinRoots(values.slice(1).map((v, i) => n * (v - values[i]))).filter(t => t > 0 && t < 1);
}

/** C1 tensor cubics restrict to degree-six polynomials on a metric line. */
export function hermiteSegmentMinimum(field, a, b, levelA = 0, levelB = 0) {
  const pieces = field.segmentPolynomials(a, b);
  let minimum = Infinity;
  for (const { lo, hi, controls } of pieces) {
    const f = controls.map((v, i) => v - (levelA * (1 - (lo + (hi - lo) * i / 6)) + levelB * (lo + (hi - lo) * i / 6)));
    for (const t of [0, 1, ...bernsteinExtrema(f)]) minimum = Math.min(minimum, evaluateBernstein(f, t));
  }
  return { minimum, intervals: pieces.length };
}
