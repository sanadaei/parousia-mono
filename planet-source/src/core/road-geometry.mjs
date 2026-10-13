import {validateRoadCrossSection,roadCrossSectionCurvatureBound} from './road-cross-section.mjs';
import { finiteNumber as finite, positiveNumber as positive, nonEmptyText as text } from './contract-validation.mjs';
import { copyJson } from './json-contract.mjs';
const KINDS = new Set(['at-grade', 'cut', 'fill', 'approach-ramp', 'bridge-deck']);
export const DEFAULT_DECK_THICKNESS_M = 0.5;

export function nonnegative(value, name) {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
  return value;
}
export function freezeOwned(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeOwned); Object.freeze(value); }
  return value;
}
export function verticalCurve(a, b) {
  const length = positive(b.distanceM - a.distanceM, 'curve length');
  const z0 = a.roadElevationM, z1 = b.roadElevationM;
  const secant = (z1 - z0) / length;
  const m0 = (a.gradeSlope ?? secant) * length, m1 = (b.gradeSlope ?? secant) * length;
  const A = finite(2 * z0 - 2 * z1 + m0 + m1, 'curve coefficient');
  const B = finite(-3 * z0 + 3 * z1 - 2 * m0 - m1, 'curve coefficient');
  const grade = t => finite((3 * A * t * t + 2 * B * t + m0) / length, 'gradeSlope');
  const extremum = A === 0 ? -1 : -B / (3 * A);
  return { maxGradeSlope: Math.max(Math.abs(grade(0)), Math.abs(grade(1)),
    extremum > 0 && extremum < 1 ? Math.abs(grade(extremum)) : 0), at(distanceM) {
    const t = (distanceM - a.distanceM) / length;
    return { roadElevationM: t === 0 ? z0 : t === 1 ? z1 : finite(((A * t + B) * t + m0) * t + z0, 'road elevation'),
      gradeSlope: t === 0 ? m0 / length : t === 1 ? m1 / length : grade(t) };
  } };
}
export function metricRoads(input) {
  if (!Array.isArray(input)) throw new TypeError('roads must be an array');
  if (input.length > 4096) throw new RangeError('Too many roads');
  const ids = new Set(); let total = 0;
  return input.map(road => {
    const id = text(road?.id ?? road?.roadId, 'road.id');
    if (road.structureKind != null && !KINDS.has(road.structureKind)) throw new TypeError('Invalid road structureKind');
    if (ids.has(id)) throw new RangeError('Duplicate road ID'); ids.add(id);
    const raw = road.points ?? road.samples;
    if (!Array.isArray(raw) || raw.length < 2 || (total += raw.length) > 262144) throw new RangeError('Invalid road point budget');
    let lengthM = 0;
    const points = raw.map((p, i) => {
      finite(p?.xM, 'road.xM'); finite(p?.yM, 'road.yM');
      if (i) {
        const previousLength = lengthM;
        lengthM = finite(lengthM + positive(Math.hypot(p.xM - raw[i - 1].xM, p.yM - raw[i - 1].yM), 'segment length'), 'road length');
        if (lengthM <= previousLength) throw new RangeError('Unrepresentable stations');
      }
      if (p.distanceM != null && Math.abs(finite(p.distanceM, 'distanceM') - lengthM) > 1e-6) throw new RangeError('Road stations must match metric geometry');
      if (p.gradeSlope != null) finite(p.gradeSlope, 'gradeSlope');
      if (p.structureKind != null && !KINDS.has(p.structureKind) || p.segmentKind != null && !KINDS.has(p.segmentKind)) throw new TypeError('Invalid road point structureKind');
      if (p.deckThicknessM != null) nonnegative(p.deckThicknessM, 'deckThicknessM');
      return { ...copyJson(p), distanceM: lengthM, roadElevationM: finite(p.roadElevationM ?? road.roadElevationM, 'roadElevationM') };
    });
    validateRoadCrossSection(road.crossSection,lengthM);
    const halfWidthM = positive(road.halfWidthM ?? (road.widthM == null ? 3 : road.widthM / 2), 'halfWidthM');
    nonnegative(road.deckThicknessM ?? 0, 'deckThicknessM');
    const segments = points.slice(1).map((b, i) => ({ a: points[i], b, curve: verticalCurve(points[i], b) }));
    function at(distanceM) {
      finite(distanceM, 'distanceM');
      if (distanceM < 0 || distanceM > lengthM) throw new RangeError('Station outside road');
      const segment = segments.find(s => distanceM <= s.b.distanceM) ?? segments.at(-1);
      const { a, b, curve } = segment, t = (distanceM - a.distanceM) / (b.distanceM - a.distanceM);
      const kind = t === 1 ? b.structureKind ?? road.structureKind ?? 'at-grade'
        : a.segmentKind ?? a.structureKind ?? road.structureKind ?? 'at-grade';
      const metadata = t === 1 ? b : a;
      return { ...metadata, distanceM, xM: t === 0 ? a.xM : t === 1 ? b.xM : a.xM + t * (b.xM - a.xM),
        yM: t === 0 ? a.yM : t === 1 ? b.yM : a.yM + t * (b.yM - a.yM), ...curve.at(distanceM),
        structureKind: kind, deckThicknessM: kind === 'bridge-deck' ? metadata.deckThicknessM ?? road.deckThicknessM ?? DEFAULT_DECK_THICKNESS_M : road.deckThicknessM ?? 0 };
    }
    return { id, road, points, segments, lengthM, halfWidthM, at };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
const cross = (ax, ay, bx, by) => finite(ax * by - ay * bx, 'intersection determinant');
export function roadIntersections(routes) {
  const results = []; let checks = 0;
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const first = routes[i], second = routes[j], seen = new Set();
    for (const s of first.segments) for (const q of second.segments) {
      if (++checks > 2000000) throw new RangeError('Road intersection budget exceeded');
      const ax = s.b.xM - s.a.xM, ay = s.b.yM - s.a.yM, bx = q.b.xM - q.a.xM, by = q.b.yM - q.a.yM;
      const cx = q.a.xM - s.a.xM, cy = q.a.yM - s.a.yM, det = cross(ax, ay, bx, by);
      let pairs = [];
      if (det === 0) {
        if (cross(cx, cy, ax, ay) !== 0) continue;
        const length2 = ax * ax + ay * ay;
        const u = (cx * ax + cy * ay) / length2, v = u + (bx * ax + by * ay) / length2;
        const lo = Math.max(0, Math.min(u, v)), hi = Math.min(1, Math.max(u, v));
        if (hi < lo) continue;
        if (hi > lo) throw new RangeError('Collinear overlapping roads require a shared corridor design');
        const x = s.a.xM + lo * ax, y = s.a.yM + lo * ay;
        pairs = [[lo, ((x - q.a.xM) * bx + (y - q.a.yM) * by) / (bx * bx + by * by)]];
      } else {
        const t = cross(cx, cy, bx, by) / det, u = cross(cx, cy, ax, ay) / det;
        const positionTolerance=32*Number.EPSILON*Math.max(1,...[s.a,s.b,q.a,q.b].flatMap(p=>[Math.abs(p.xM),Math.abs(p.yM)]));
        const ta=positionTolerance/Math.hypot(ax,ay),tb=positionTolerance/Math.hypot(bx,by);
        const snap=(v,e)=>Math.abs(v)<=e?0:Math.abs(v-1)<=e?1:v;
        if (t >= -ta && t <= 1+ta && u >= -tb && u <= 1+tb) pairs = [[snap(t,ta),snap(u,tb)]];
      }
      for (const [t, u] of pairs) {
        const stationA = s.a.distanceM + t * (s.b.distanceM - s.a.distanceM);
        const stationB = q.a.distanceM + u * (q.b.distanceM - q.a.distanceM);
        const key = `${stationA}:${stationB}`; if (seen.has(key)) continue; seen.add(key);
        const p = first.at(stationA);
        results.push({ xM: p.xM, yM: p.yM, first, second, stationA, stationB,
          sinAngle: Math.abs(det) / (Math.hypot(ax, ay) * Math.hypot(bx, by)) });
      }
    }
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  return results.sort((a, b) => a.xM - b.xM || a.yM - b.yM || compare(a.first.id, b.first.id) || compare(a.second.id, b.second.id));
}

/** Piecewise-linear display stations bounded against the canonical cubic.
 * The cubic's second derivative is affine, so endpoint extrema give a rigorous
 * vertical interpolation error bound M * span² / 8. No midpoint-only heuristic. */
export function tessellateRoadProfile(route, { elevationToleranceM = .005, maxSpanM = 5, maxSegments = 8192 } = {}) {
  positive(elevationToleranceM, 'elevationToleranceM'); positive(maxSpanM, 'maxSpanM');
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 65536) throw new RangeError('Invalid road tessellation budget');
  const output = [];
  for (const segment of route.segments) {
    const { a, b, curve } = segment, length = b.distanceM - a.distanceM;
    const z0 = a.roadElevationM, z1 = b.roadElevationM, secant = (z1-z0)/length;
    const m0 = (a.gradeSlope ?? secant)*length, m1 = (b.gradeSlope ?? secant)*length;
    const A = 2*z0-2*z1+m0+m1, B = -3*z0+3*z1-2*m0-m1;
    const M = Math.max(Math.abs(2*B), Math.abs(6*A+2*B))/(length*length)+roadCrossSectionCurvatureBound(route.road.crossSection,route.halfWidthM);
    const count = Math.max(1, Math.ceil(length/maxSpanM), Math.ceil(length*Math.sqrt(M/(8*elevationToleranceM))));
    if (output.length + count > maxSegments) throw new RangeError('Road tessellation exceeds geometry budget');
    const sample = t => ({ xM:a.xM+(b.xM-a.xM)*t, yM:a.yM+(b.yM-a.yM)*t,
      distanceM:a.distanceM+length*t, ...curve.at(a.distanceM+length*t) });
    for (let i=0;i<count;i++) output.push({a:sample(i/count),b:sample((i+1)/count),elevationErrorBoundM:M*(length/count)**2/8});
  }
  return output;
}
