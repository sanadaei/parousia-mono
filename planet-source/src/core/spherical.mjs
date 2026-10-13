import { finiteNumber } from './contract-validation.mjs';
export { finiteNumber } from './contract-validation.mjs';
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
export function geographicPoint(latDeg, lonDeg) {
  finiteNumber(latDeg, 'latDeg'); finiteNumber(lonDeg, 'lonDeg');
  if (Math.abs(latDeg) > 90) throw new RangeError('Latitude must be within -90..90');
  const lon = ((lonDeg + 180) % 360 + 360) % 360 - 180;
  return { latDeg: latDeg || 0, lonDeg: Math.abs(latDeg) === 90 ? 0 : lon || 0 };
}
export function sphereBasis(point) {
  const lat = point.latDeg * RAD, lon = point.lonDeg * RAD;
  const s = Math.sin(lat), c = Math.abs(point.latDeg) === 90 ? 0 : Math.cos(lat), a = Math.cos(lon), b = Math.sin(lon);
  return { up: [c * a, c * b, s], east: [-b, a, 0], north: [-s * a, -s * b, c] };
}
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
/** Great-circle distance and initial bearing on the chosen sphere. */
export function greatCircle(from, to, radiusM = 6371000) {
  finiteNumber(radiusM, 'radiusM');
  if (radiusM <= 0) throw new RangeError('radiusM must be positive');
  const a = geographicPoint(from.latDeg, from.lonDeg), b = geographicPoint(to.latDeg, to.lonDeg);
  const basis = sphereBasis(a), v = sphereBasis(b).up;
  const east = dot(v, basis.east), north = dot(v, basis.north);
  const distanceM = radiusM * Math.atan2(Math.hypot(east, north), dot(v, basis.up));
  const bearingDeg = distanceM < 1e-6 ? null : (Math.atan2(east, north) * DEG + 360) % 360;
  return { distanceM, bearingDeg };
}
function pointFromVector(v) {
  const horizontal = Math.hypot(v[0], v[1]);
  if (horizontal < 1e-14) return geographicPoint(v[2] >= 0 ? 90 : -90, 0);
  return geographicPoint(Math.atan2(v[2], horizontal) * DEG, Math.atan2(v[1], v[0]) * DEG);
}
/** Exponential map on the explicitly chosen sphere; distances are in meters. */
export function offsetGeographic(point, eastM, northM, radiusM) {
  const distance = Math.hypot(eastM, northM); if (!distance) return { ...point };
  const basis = sphereBasis(point), angle = distance / radiusM;
  return pointFromVector(basis.up.map((v, i) => Math.cos(angle) * v
    + Math.sin(angle) * (eastM * basis.east[i] + northM * basis.north[i]) / distance));
}

export function createSphericalProjection({ centerLatDeg, centerLonDeg, radiusM, maxRadiusM = Math.min(100000, radiusM * 0.1) }) {
  finiteNumber(radiusM, 'radiusM'); finiteNumber(maxRadiusM, 'maxRadiusM');
  if (radiusM <= 0 || maxRadiusM <= 0 || maxRadiusM > radiusM * 0.1) throw new RangeError('Projection radius must be positive and at most 0.1 planetary radians');
  const center = geographicPoint(centerLatDeg, centerLonDeg), basis = sphereBasis(center);
  const contract = Object.freeze({ kind: 'spherical-azimuthal-equidistant@1', centerLatDeg: center.latDeg,
    centerLonDeg: center.lonDeg, radiusM, maxRadiusM });
  function toGeographic(xM, yM) {
    finiteNumber(xM, 'xM'); finiteNumber(yM, 'yM');
    if (Math.hypot(xM, yM) > maxRadiusM) throw new RangeError('Point exceeds projection radius');
    return offsetGeographic(center, xM, yM, radiusM);
  }
  function toLocalIfWithin(latDeg, lonDeg) {
    const point = geographicPoint(latDeg, lonDeg), v = sphereBasis(point).up;
    const e = dot(v, basis.east), n = dot(v, basis.north), s = Math.hypot(e, n), angle = Math.atan2(s, dot(v, basis.up));
    const distance = radiusM * angle;
    if (distance > maxRadiusM + radiusM * 1e-12) return null;
    if (s < 1e-15 && angle < 1e-15) return { xM: 0, yM: 0 };
    return { xM: distance * e / s, yM: distance * n / s };
  }
  function toLocal(latDeg, lonDeg) {
    const p = toLocalIfWithin(latDeg, lonDeg);
    if (!p) throw new RangeError('Point exceeds projection radius');
    return p;
  }
  return Object.freeze({ contract, toGeographic, toLocal, toLocalIfWithin });
}
export const sameProjectionAxes = (a, b) => ['kind', 'centerLatDeg', 'centerLonDeg', 'radiusM'].every(key => a?.[key] === b?.[key]);
