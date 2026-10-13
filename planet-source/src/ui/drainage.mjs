// Drainage / basin and multi-chart helpers for the visualizer. Pure functions
// only (no DOM): basin keys and tint colours, downhill flow bearings, trapped
// flow (depression) detection, and the water-chart index of a
// `minimal-world-global-water-terrain@2` scene (boundary boxes, labels, seams).
//
// Basin tints are derived from a stable hash of the basin identity
// (basinId → outletCellIndex → basinIndex), so the same catchment keeps its
// colour across tiles, zoom levels and reloads.

import { createSphericalProjection, greatCircle } from '../core/spherical.mjs';
export { greatCircle } from '../core/spherical.mjs';

export const DRAINAGE_SETTINGS = Object.freeze({
  basinAlpha: 0.34, divideShade: 0.55, arrowSpacingPx: 34, minFlowSlope: 1e-4, maxSinkMarkers: 300,
  chartDash: Object.freeze([6, 4]), seamToleranceM: 1,
});

/** basinStatus values (or flags) that mean flow has no resolved outlet. */
export const TRAPPED_BASIN_STATUSES = Object.freeze(['depression', 'trapped', 'endorheic', 'unresolved-terminal']);

const GOLDEN_ANGLE_DEG = 137.50776405003785;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Stable identity of the catchment a sample drains to, or null when unknown. */
export function basinKey(sample) {
  if (!sample) return null;
  if (sample.basinId !== null && sample.basinId !== undefined) return String(sample.basinId);
  if (Number.isSafeInteger(sample.outletCellIndex)) return `outlet:${sample.outletCellIndex}`;
  if (Number.isSafeInteger(sample.basinIndex)) return `basin:${sample.basinIndex}`;
  return null;
}

/** FNV-1a 32-bit hash; never 0 so 0 can mean "no basin" in typed arrays. */
export function hashBasinKey(key) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0) || 1;
}

/** HSL (degrees, 0..1, 0..1) → [r, g, b] in 0..255. */
export function hslToRgb(hDeg, s, l) {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  const f = n => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** `count` well-separated tint colours (golden-angle hue steps, alternating lightness). */
export function basinPalette(count, { saturation = 0.62, lightness = 0.56 } = {}) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('Palette size must be a non-negative integer');
  return Array.from({ length: count }, (_, i) => hslToRgb(i * GOLDEN_ANGLE_DEG, saturation, lightness + (i % 2 ? -0.08 : 0.04)));
}

/** Tint colour of a basin hash (see hashBasinKey). */
export function basinColorFromHash(hash) {
  const hue = ((hash >>> 0) % 3600) / 10 + ((hash >>> 12) & 7) * GOLDEN_ANGLE_DEG;
  return hslToRgb(hue, 0.55 + ((hash >>> 20) & 3) * 0.06, 0.5 + ((hash >>> 24) & 3) * 0.04);
}

/** Tint colour of a basin key (or sample); null when the basin is unknown. */
export function basinColor(keyOrSample) {
  const key = typeof keyOrSample === 'string' ? keyOrSample : basinKey(keyOrSample);
  return key === null ? null : basinColorFromHash(hashBasinKey(key));
}

/** basinStatus as reported by the core, or 'modeled-basin' for planar water models that only carry ids. */
export function basinStatusOf(sample) {
  if (sample?.basinStatus) return sample.basinStatus;
  return basinKey(sample) !== null ? 'modeled-basin' : null;
}

/** True when the sample's flow is trapped (depression / no resolved outlet). */
export function isTrappedFlow(sample) {
  if (!sample) return false;
  if (sample.flowTrapped === true || sample.trappedFlow === true) return true;
  return TRAPPED_BASIN_STATUSES.includes(sample.basinStatus);
}

/**
 * Downhill flow bearing in degrees clockwise from north (+y), or null on
 * flat ground (slope below `minSlope`).
 */
export function flowBearingDeg(gradient, minSlope = DRAINAGE_SETTINGS.minFlowSlope) {
  if (!gradient || !Number.isFinite(gradient.x) || !Number.isFinite(gradient.y)) return null;
  if (Math.hypot(gradient.x, gradient.y) < minSlope) return null;
  return (Math.atan2(-gradient.x, -gradient.y) * 180 / Math.PI + 360) % 360;
}

/** 16-point compass name of a bearing. */
export const compassPoint = bearingDeg => COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16];

/** "123.4° SE" style label for a flow bearing. */
export function formatFlowDirection(bearingDeg) {
  if (bearingDeg === null || bearingDeg === undefined || !Number.isFinite(bearingDeg)) return 'flat / undefined';
  return `${bearingDeg.toFixed(1)}° ${compassPoint(bearingDeg)}`;
}

/**
 * Strict local minimum of a row-major lattice at (i, j): lower than all eight
 * neighbours. Edge samples are never reported (their neighbourhood is incomplete).
 */
export function isLocalMinimum(values, width, height, i, j) {
  if (i <= 0 || j <= 0 || i >= width - 1 || j >= height - 1) return false;
  const z = values[j * width + i];
  if (!Number.isFinite(z)) return false;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const n = values[(j + dj) * width + i + di];
    if (!Number.isFinite(n) || n <= z) return false;
  }
  return true;
}

// ---------- Water charts ----------

/** Closed rectangle of chart bounds as `{ xM, yM }` corners (counter-clockwise from south-west). */
export function chartBoundaryPolygon(bounds) {
  return [{ xM: bounds.minXM, yM: bounds.minYM }, { xM: bounds.maxXM, yM: bounds.minYM },
    { xM: bounds.maxXM, yM: bounds.maxYM }, { xM: bounds.minXM, yM: bounds.maxYM }];
}

/** Chart tag text: "id · lat°, lon° · W × H km". */
export function formatChartLabel(chart) {
  const p = chart.projection ?? {}, b = chart.bounds;
  const km = v => { const k = v / 1000; return Number.isInteger(k) ? String(k) : k.toFixed(1); };
  const center = Number.isFinite(p.centerLatDeg) ? ` · ${p.centerLatDeg.toFixed(2)}°, ${p.centerLonDeg.toFixed(2)}°` : '';
  const size = b ? ` · ${km(b.maxXM - b.minXM)} × ${km(b.maxYM - b.minYM)} km` : '';
  return `${chart.id}${center}${size}`;
}

/**
 * Seam markers of one chart: river edge end points lying on the chart
 * boundary (where flow leaves or enters the explicit chart), in chart metres.
 */
export function chartSeamMarkers(chart, toleranceM = DRAINAGE_SETTINGS.seamToleranceM) {
  const b = chart.bounds, out = [];
  if (!b) return out;
  for (const edge of chart.model?.edges ?? []) {
    const pts = edge.points ?? [];
    for (const [p, role] of [[pts[0], 'start'], [pts.at(-1), 'end']]) {
      if (!p) continue;
      const sides = [['west', p.xM - b.minXM], ['east', b.maxXM - p.xM], ['south', p.yM - b.minYM], ['north', b.maxYM - p.yM]];
      const [side, gap] = sides.reduce((best, s) => Math.abs(s[1]) < Math.abs(best[1]) ? s : best);
      if (Math.abs(gap) <= toleranceM) out.push({ chartId: chart.id, edgeId: edge.id, role, side, xM: p.xM, yM: p.yM });
    }
  }
  return out;
}

/** Densified chart boundary (n points per side) so curved re-projections stay smooth. */
function densePolygon(bounds, n = 8) {
  const c = chartBoundaryPolygon(bounds), out = [];
  for (let s = 0; s < 4; s++) {
    const a = c[s], b = c[(s + 1) % 4];
    for (let k = 0; k < n; k++) out.push({ xM: a.xM + (b.xM - a.xM) * k / n, yM: a.yM + (b.yM - a.yM) * k / n });
  }
  return out;
}

/**
 * Index of the water charts in a global multi-chart snapshot, relative to
 * the active chart: each entry carries its label, centre, distance/bearing
 * from the active chart centre, seam markers, and — when it lies within
 * reach of the active projection — its boundary and seams in active-chart
 * metres (`polygon`, `seams[].local`). Returns [] for other schemas.
 */
export function describeWaterCharts(snapshot, activeIndex = 0) {
  const charts = Array.isArray(snapshot?.waterCharts) ? snapshot.waterCharts : [];
  if (!charts.length) return [];
  const index = Math.max(0, Math.min(charts.length - 1, activeIndex)), active = charts[index];
  const radiusM = active.projection?.radiusM ?? 6371000;
  // Other charts are re-projected through the widest azimuthal reach the core allows (0.1 planetary radians).
  let reach = null;
  try { reach = createSphericalProjection({ ...active.projection, radiusM, maxRadiusM: radiusM * 0.1 }); } catch { /* incomplete projection: list charts without re-projected boxes */ }
  const activeCenter = { latDeg: active.projection?.centerLatDeg ?? 0, lonDeg: active.projection?.centerLonDeg ?? 0 };
  return charts.map((chart, i) => {
    const center = { latDeg: chart.projection?.centerLatDeg ?? 0, lonDeg: chart.projection?.centerLonDeg ?? 0 };
    const { distanceM, bearingDeg } = i === index ? { distanceM: 0, bearingDeg: null } : greatCircle(activeCenter, center, radiusM);
    const seams = chartSeamMarkers(chart);
    let polygon = null;
    if (i === index) polygon = chartBoundaryPolygon(chart.bounds);
    else if (reach && chart.bounds) {
      try {
        const own = createSphericalProjection({ ...chart.projection, radiusM: chart.projection.radiusM ?? radiusM });
        const toActive = p => { const g = own.toGeographic(p.xM, p.yM); return reach.toLocalIfWithin(g.latDeg, g.lonDeg); };
        const projected = densePolygon(chart.bounds).map(toActive);
        polygon = projected.every(Boolean) ? projected : null;
        for (const s of seams) s.local = polygon ? toActive(s) : null;
      } catch { polygon = null; }
    }
    if (i === index) for (const s of seams) s.local = { xM: s.xM, yM: s.yM };
    return { index: i, id: chart.id, active: i === index, label: formatChartLabel(chart), center, bounds: chart.bounds ?? null,
      polygon, seams, riverCount: chart.model?.edges?.length ?? 0, bodyCount: chart.model?.bodies?.length ?? 0, distanceM, bearingDeg };
  });
}

/** Water-chart index of a loaded scene (empty unless it was restored from a multi-chart snapshot). */
export function sceneWaterCharts(scene) {
  const terrain = scene?.rawBundle?.terrain;
  const snapshot = terrain?.baseTerrain ?? terrain;
  return describeWaterCharts(snapshot, scene?.viewIndex ?? 0);
}
