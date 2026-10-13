import { isAnchoredDetailMethod } from './shore-detail.mjs';
import { createPeriodicHermiteField } from './periodic-field.mjs';
import { finiteNumber } from './spherical.mjs';
import { ANCHORED_DETAIL_METHOD } from './spherical-detail.mjs';

export const LEGACY_PROJECTED_GROUND_BOUNDS_METHOD = 'spherical-lipschitz-probes@1';
export const PROJECTED_GROUND_BOUNDS_METHOD = 'spherical-lipschitz-adaptive-probes@2';
const MAX_PROBES = 262144, RAD = Math.PI / 180;

/** A conservative gradient bound for the existing Hermite/cap/detail contract.
 * It bounds a sphere disk containing the chart and every straight probe interval.
 * No local elevation grid or new noise is created. */
export function createProjectedGroundBounds(global, projection, bounds, stepM = 20, { method = PROJECTED_GROUND_BOUNDS_METHOD } = {}) {
  finiteNumber(stepM, 'groundBoundsStepM');
  if (stepM < 1 || stepM > 1000) throw new RangeError('Ground bounds step must be 1..1000 meters');
  if (![PROJECTED_GROUND_BOUNDS_METHOD, LEGACY_PROJECTED_GROUND_BOUNDS_METHOD].includes(method)) throw new TypeError('Unsupported projected ground bounds method');
  const adaptive = method === PROJECTED_GROUND_BOUNDS_METHOD;
  const snapshot = global.toSnapshot(), { columns: w, rows: h } = snapshot.grid;
  const source = snapshot.fields.groundElevationM, radius = snapshot.frame.radiusM;
  const field = createPeriodicHermiteField(source, w, h);
  const center = projection.contract, diskRadius = Math.max(...[bounds.minXM, bounds.maxXM].flatMap(x =>
    [bounds.minYM, bounds.maxYM].map(y => Math.hypot(x, y)))) + 2 * global.derivativeStepM;
  const angle = diskRadius / radius, lat = center.centerLatDeg * RAD;
  const loLat = Math.max(-Math.PI / 2, lat - angle), hiLat = Math.min(Math.PI / 2, lat + angle);
  const yLo = (Math.PI / 2 - hiLat) / Math.PI * h, yHi = (Math.PI / 2 - loLat) / Math.PI * h;
  const poleTouched = Math.max(Math.abs(loLat), Math.abs(hiLat)) >= Math.PI / 2;
  const deltaX = poleTouched ? w : angle / Math.cos(Math.max(Math.abs(loLat), Math.abs(hiLat))) * w / (2 * Math.PI);
  const centerX = ((center.centerLonDeg % 360) + 360) % 360 / 360 * w;
  let xRanges;
  if (2 * deltaX >= w) xRanges = [[0, w]];
  else {
    const lo = centerX - deltaX, hi = centerX + deltaX;
    xRanges = lo < 0 ? [[0, hi], [lo + w, w]] : hi > w ? [[lo, w], [0, hi - w]] : [[lo, hi]];
  }
  const regionFieldBounds = (lowY, highY) => {
    let dx = 0, dy = 0, span = 0, min = Infinity, max = -Infinity;
    for (const [minXM, maxXM] of xRanges) {
      const rect = { minXM, maxXM, minYM: lowY, maxYM: highY };
      const gradient = field.derivativeBounds(rect), range = field.rectangleBounds(rect);
      dx = Math.max(dx, gradient.x); dy = Math.max(dy, gradient.y); span = Math.max(span, gradient.maxPatchSpan);
      min = Math.min(min, range.min); max = Math.max(max, range.max);
    }
    return { dx, dy, span, min, max };
  };
  const alpha = Math.PI / (2 * h), longitudeRate = w / (2 * Math.PI), latitudeRate = h / Math.PI;
  let baseBound = 0, detailBound = 0;
  if (yHi >= .5 && yLo <= h - .5) {
    const low = Math.max(.5, yLo), high = Math.min(h - .5, yHi), range = regionFieldBounds(low, high);
    const mostPolar = Math.max(Math.abs(Math.PI / 2 - low / h * Math.PI), Math.abs(Math.PI / 2 - high / h * Math.PI));
    const lonScale = longitudeRate / (radius * Math.cos(mostPolar)), latScale = latitudeRate / radius;
    const interiorBase = Math.hypot(range.dx * lonScale, range.dy * latScale);
    baseBound = Math.max(baseBound, interiorBase);
    const bands = snapshot.detail.bands, amplitude = bands.reduce((sum, b) => sum + b.amplitudeM, 0);
    if (!isAnchoredDetailMethod(snapshot.detail.method) && range.span > 0 && amplitude > 0) {
      // |bubble'| <= 16/(3*sqrt(3)), q*margin <= total amplitude,
      // |d margin/d base| <= 1, and Cartesian value-noise |grad| <= 3*sqrt(3)/wave.
      detailBound = interiorBase + 16 / (3 * Math.sqrt(3)) * amplitude * Math.hypot(lonScale, latScale)
        + 3 * Math.sqrt(3) * bands.reduce((sum, b) => sum + b.amplitudeM / b.wavelengthM, 0);
    }
  }
  for (const [north, entered] of [[true, yLo < .5], [false, yHi > h - .5]]) {
    if (!entered) continue;
    const row = north ? .5 : h - .5, ring = regionFieldBounds(row, row);
    const mean = (north ? source.slice(0, w) : source.slice(-w)).reduce((sum, z) => sum + z / w, 0);
    const difference = Math.max(Math.abs(ring.min - mean), Math.abs(ring.max - mean));
    const tMax = Math.min(1, (north ? yHi : h - yLo) * 2);
    const smoothRate = tMax < .5 ? 6 * tMax * (1 - tMax) : 1.5;
    // smooth(t)/sin(alpha*t) <= 3*t/sin(alpha), including the pole limit.
    baseBound = Math.max(baseBound, Math.hypot(ring.dx * longitudeRate * 3 * tMax / (radius * Math.sin(alpha)),
      difference * smoothRate / (radius * alpha)));
  }
  if (isAnchoredDetailMethod(snapshot.detail.method)) detailBound = finiteNumber(global.detailLipschitzMPerM, 'anchored detail Lipschitz bound')+(global.detailBaseGradientMultiplier??0)*baseBound;
  const lipschitzMPerM = (baseBound + detailBound) * (1 + 1e-10);
  finiteNumber(lipschitzMPerM, 'ground Lipschitz bound');
  const groundAt = (x, y) => { const p = projection.toGeographic(x, y); return global.groundElevationAt(p.latDeg, p.lonDeg); };
  const roundingM = 128 * Number.EPSILON * source.reduce((max, z) => Math.max(max, Math.abs(z)), Math.max(1, Math.abs(snapshot.frame.elevationOffsetM)));
  const ground = (x, y) => groundAt(x, y);
  const segmentRange = (a, b, levelA = 0, levelB = 0) => {
    const length = Math.hypot(b.xM - a.xM, b.yM - a.yM), requestedIntervals = Math.max(1, Math.ceil(length / stepM));
    const intervals = adaptive ? Math.min(MAX_PROBES - 1, requestedIntervals) : requestedIntervals;
    if (intervals + 1 > MAX_PROBES) throw new RangeError('Projected ground segment exceeds probe budget');
    let minimum = Infinity, maximum = -Infinity, endpointsMaximum = -Infinity;
    const levelRate = length ? Math.abs(levelB - levelA) / length : 0;
    for (let i = 0; i <= intervals; i++) {
      const t = i / intervals, value = groundAt(a.xM * (1 - t) + b.xM * t, a.yM * (1 - t) + b.yM * t)
        - (levelA * (1 - t) + levelB * t);
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      if (i === 0 || i === intervals) endpointsMaximum = Math.max(endpointsMaximum, value);
    }
    const uncertainty = (lipschitzMPerM + levelRate) * length / intervals / 2 + roundingM;
    return { minimum: minimum - uncertainty, maximum: maximum + uncertainty, endpointsMaximum, intervals,
      probes: intervals + 1, effectiveStepM: length / intervals, adapted: intervals !== requestedIntervals };
  };
  ground.segmentMinimum = segmentRange;
  ground.segmentMaximum = segmentRange;
  const rectangleBounds = ({ minXM, minYM, maxXM, maxYM }) => {
    const width = maxXM - minXM, height = maxYM - minYM;
    if (![minXM, minYM, maxXM, maxYM].every(Number.isFinite) || width < 0 || height < 0) throw new RangeError('Invalid projected ground rectangle');
    let nx = Math.max(1, Math.ceil(width / stepM)), ny = Math.max(1, Math.ceil(height / stepM));
    const requestedProbes = nx * ny;
    if (adaptive && requestedProbes > MAX_PROBES) {
      const factor = Math.sqrt(requestedProbes / MAX_PROBES);
      nx = Math.max(1, Math.min(MAX_PROBES, Math.floor(nx / factor)));
      ny = Math.max(1, Math.min(MAX_PROBES, Math.floor(ny / factor)));
      if (nx * ny > MAX_PROBES) {
        if (nx >= ny) nx = Math.floor(MAX_PROBES / ny); else ny = Math.floor(MAX_PROBES / nx);
      }
    }
    if (nx * ny > MAX_PROBES) throw new RangeError('Projected ground rectangle exceeds probe budget');
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const z = groundAt(minXM + (maxXM - minXM) * (i + .5) / nx, minYM + (maxYM - minYM) * (j + .5) / ny);
      min = Math.min(min, z); max = Math.max(max, z);
    }
    const uncertainty = lipschitzMPerM * Math.hypot((maxXM - minXM) / nx, (maxYM - minYM) / ny) / 2 + roundingM;
    return { min: min - uncertainty, max: max + uncertainty, probes: nx * ny,
      intervalsX: nx, intervalsY: ny, effectiveStepXM: width / nx, effectiveStepYM: height / ny,
      uncertaintyM: uncertainty, adapted: nx * ny !== requestedProbes };
  };
  return { ground, rectangleBounds, method,
    contract: { method, stepM, lipschitzMPerM, roundingM } };
}
