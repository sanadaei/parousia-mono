import { finiteNumber as finite, positiveNumber as positive } from './contract-validation.mjs';
import { metricRoads, nonnegative, freezeOwned } from './road-geometry.mjs';
import { createBuildingPadAdjustedTerrain } from './building-pad.mjs';

/** Fixed metric probes of natural cross-embankment downhill paths. Returns
 * gravity pass-through proposals, not pipe capacities or a hydraulic simulation.
 * `terrain` must be the natural terrain before these fills are applied. */
export function inspectEarthworkDrainage(terrain, { roads = [], pads = [], culvertSpacingM = 100, maxPondingDepthM = 0.5 } = {}) {
  if (typeof terrain?.groundElevationAt !== 'function' || typeof terrain?.sampleAt !== 'function') throw new TypeError('Terrain needs sampleAt and groundElevationAt');
  if (terrain.frame?.kind === 'sphere-geographic') throw new TypeError('Drainage requires metric terrain');
  positive(culvertSpacingM, 'culvertSpacingM'); nonnegative(maxPondingDepthM, 'maxPondingDepthM');
  const routes = metricRoads(roads), culverts = [];
  let probes = 0, blockedFlowCount = 0, totalEmbankmentLengthM = 0, unresolvedFlowCount = 0;
  function ground(p) {
    if (++probes > 262144) throw new RangeError('Drainage exceeds probe budget');
    return finite(terrain.groundElevationAt(p.xM, p.yM), 'natural ground elevation');
  }
  function inBounds(p) {
    const b = terrain.bounds;
    return !b || p.xM >= b.minXM && p.xM <= b.maxXM && p.yM >= b.minYM && p.yM <= b.maxYM;
  }
  function passThrough(center, nx, ny, halfLength, crest, fields, platformHalfLength, batterSlope, minBatterWidth = 0) {
    let a, b, za, zb, foundToes = false, reachA = halfLength, reachB = halfLength;
    // Toe width depends on natural ground at the toe, not just centerline fill.
    // Extend until both mouths emerge outside the actual smooth fill batters.
    for (let attempt = 0; attempt < 128; attempt++) {
      a = { xM: center.xM - nx * reachA, yM: center.yM - ny * reachA };
      b = { xM: center.xM + nx * reachB, yM: center.yM + ny * reachB };
      if (!inBounds(a) || !inBounds(b)) { unresolvedFlowCount++; return null; }
      za = ground(a); zb = ground(b);
      const toeWidth = z => Math.max(minBatterWidth, 1.5 * Math.max(0, crest - z) / batterSlope);
      const beforeFound = reachA - platformHalfLength >= toeWidth(za), afterFound = reachB - platformHalfLength >= toeWidth(zb);
      if (beforeFound && afterFound) { foundToes = true; break; }
      if (!beforeFound) reachA = finite(reachA * 1.25, 'drainage toe reach');
      if (!afterFound) reachB = finite(reachB * 1.25, 'drainage toe reach');
    }
    if (!foundToes) { unresolvedFlowCount++; return null; }
    if (Math.abs(za - zb) <= 1e-7) return null;
    const upstream = za > zb ? a : b, downstream = za > zb ? b : a;
    const upstreamInvertElevationM = Math.max(za, zb), downstreamInvertElevationM = Math.min(za, zb);
    const pondingDepthM = crest - upstreamInvertElevationM;
    if (pondingDepthM <= maxPondingDepthM) return null;
    // Reject natural ridges and depressions: a gravity culvert is warranted
    // only where a pre-fill downhill path actually crossed this embankment.
    const lengthM = positive(reachA + reachB, 'culvert length'), count = Math.ceil(lengthM / 2);
    if (count > 262144) throw new RangeError('Culvert transect exceeds probe budget');
    let previous = upstreamInvertElevationM;
    for (let i = 1; i <= count; i++) {
      const t = i / count, z = ground({ xM: upstream.xM + t * (downstream.xM - upstream.xM), yM: upstream.yM + t * (downstream.yM - upstream.yM) });
      if (z > previous + 1e-7) return null;
      previous = z;
    }
    return { ...fields, xM: center.xM, yM: center.yM, roadElevationM: fields.roadId ? crest : null,
      flowDirection: { x: (downstream.xM - upstream.xM) / lengthM, y: (downstream.yM - upstream.yM) / lengthM },
      upstream: { ...upstream, invertElevationM: upstreamInvertElevationM },
      downstream: { ...downstream, invertElevationM: downstreamInvertElevationM },
      invertElevationM: upstreamInvertElevationM, upstreamInvertElevationM, downstreamInvertElevationM,
      slopeMPerM: finite((upstreamInvertElevationM - downstreamInvertElevationM) / lengthM, 'culvert slope'),
      lengthM, pondingDepthM, drainageContinuity: true, status: 'gravity-pass-through-designed' };
  }
  for (const route of routes) {
    for (const key of ['worldId', 'regionId']) if (route.road[key] != null && route.road[key] !== terrain[key]) throw new RangeError(`Road ${key} must match terrain`);
    for (const p of route.points) { ground(p); for (const key of ['worldId', 'regionId']) if (p[key] != null && p[key] !== terrain[key]) throw new RangeError(`Road ${key} must match terrain`); }
    const bins = Math.ceil(route.lengthM / culvertSpacingM);
    if (bins > 262144) throw new RangeError('Drainage station budget exceeded');
    const batterSlope = positive(route.road.fillBatterSlope ?? route.road.batterSlopeMPerM ?? 0.5, 'fillBatterSlope');
    for (let bin = 0; bin < bins; bin++) {
      const lo = bin * culvertSpacingM, hi = Math.min(route.lengthM, (bin + 1) * culvertSpacingM);
      const marks = [lo, hi, ...route.points.filter(p => p.distanceM > lo && p.distanceM < hi).map(p => p.distanceM)].sort((a, b) => a - b);
      const candidates = [];
      for (let edge = 1; edge < marks.length; edge++) {
        const start = marks[edge - 1], end = marks[edge], n = Math.ceil((end - start) / Math.min(10, culvertSpacingM / 4));
        if (n > 262144) throw new RangeError('Drainage station budget exceeded');
        for (let k = 0; k < n; k++) {
          const distanceM = start + (k + 0.5) * (end - start) / n, p = route.at(distanceM);
          if (p.structureKind === 'bridge-deck') continue;
          const fill = p.roadElevationM - ground(p);
          if (fill <= 0) continue;
          totalEmbankmentLengthM += (end - start) / n;
          const segment = route.segments.find(s => distanceM <= s.b.distanceM), dx = segment.b.xM - segment.a.xM, dy = segment.b.yM - segment.a.yM;
          const length = Math.hypot(dx, dy), halfLength = route.halfWidthM + 1.5 * fill / batterSlope + 1;
          const candidate = passThrough(p, -dy / length, dx / length, halfLength, p.roadElevationM,
            { roadId: route.id, distanceM, stationM: distanceM, structureKind: 'culvert', sourceKind: 'road-embankment' }, route.halfWidthM, batterSlope);
          if (candidate) candidates.push(candidate);
        }
      }
      if (candidates.length) {
        // One proposal per spacing cell, at its lowest natural drainage path.
        // Multiple independently blocked paths remain visible in the count.
        blockedFlowCount += candidates.length;
        candidates.sort((a, b) => a.upstreamInvertElevationM - b.upstreamInvertElevationM || a.distanceM - b.distanceM);
        culverts.push({ ...candidates[0], culvertId: `${route.id}/culvert:${bin}`, blockedSectionCount: candidates.length });
      }
    }
  }
  // Reuse the pad footprint/identity contracts and normalized polygons without
  // demanding snapshot support from the natural terrain used for inspection.
  const normalizedPads = createBuildingPadAdjustedTerrain({ ...terrain, toSnapshot: () => ({}) }, pads).toSnapshot().buildingPads;
  for (const pad of normalizedPads) {
    const center = { xM: (pad.bounds.minXM + pad.bounds.maxXM) / 2, yM: (pad.bounds.minYM + pad.bounds.maxYM) / 2 };
    const h = 0.5;
    const left = { xM: center.xM - h, yM: center.yM }, right = { xM: center.xM + h, yM: center.yM };
    const bottom = { xM: center.xM, yM: center.yM - h }, top = { xM: center.xM, yM: center.yM + h };
    if (![left, right, bottom, top].every(inBounds)) { unresolvedFlowCount++; continue; }
    const gx = (ground(right) - ground(left)) / (2 * h), gy = (ground(top) - ground(bottom)) / (2 * h), magnitude = Math.hypot(gx, gy);
    if (magnitude <= 1e-7) continue;
    const nx = -gx / magnitude, ny = -gy / magnitude;
    const diagonal = Math.hypot(pad.bounds.maxXM - pad.bounds.minXM, pad.bounds.maxYM - pad.bounds.minYM);
    const bins = Math.max(1, Math.ceil(diagonal / culvertSpacingM));
    if (bins > 262144) throw new RangeError('Pad drainage budget exceeded');
    for (let bin = 0; bin < bins; bin++) {
      const offset = ((bin + 0.5) / bins - 0.5) * diagonal;
      const origin = { xM: center.xM - ny * offset, yM: center.yM + nx * offset }, intersections = [];
      for (let i = 0; i < pad.polygon.length; i++) {
        const a = pad.polygon[i], b = pad.polygon[(i + 1) % pad.polygon.length];
        const dx = b.xM - a.xM, dy = b.yM - a.yM, det = nx * dy - ny * dx;
        if (Math.abs(det) <= 1e-12) continue;
        const cx = a.xM - origin.xM, cy = a.yM - origin.yM;
        const t = (cx * dy - cy * dx) / det, u = (cx * ny - cy * nx) / det;
        if (u >= 0 && u < 1) intersections.push(t);
      }
      intersections.sort((a, b) => a - b);
      for (let i = 1; i < intersections.length; i += 2) {
        const lo = intersections[i - 1], hi = intersections[i];
        const p = { xM: origin.xM + nx * (lo + hi) / 2, yM: origin.yM + ny * (lo + hi) / 2 };
        const fill = pad.targetPadElevationM - ground(p);
        if (fill <= 0) continue;
        const candidate = passThrough(p, nx, ny, (hi - lo) / 2 + Math.max(pad.batterWidthM, 1.5 * fill / pad.fillBatterSlope) + 1,
          pad.targetPadElevationM, { buildingId: pad.buildingId, structureKind: 'drainage-pass-through', sourceKind: 'building-pad-fill' },
          (hi - lo) / 2, pad.fillBatterSlope, pad.batterWidthM);
        if (candidate) { blockedFlowCount++; culverts.push({ ...candidate, culvertId: `${pad.buildingId}/drain:${bin}:${i}` }); }
      }
    }
  }
  return freezeOwned({ culverts, blockedFlowCount, totalEmbankmentLengthM: finite(totalEmbankmentLengthM, 'total embankment length'), unresolvedFlowCount,
    precision: 'fixed metric downhill transects; blockedFlowCount counts sampled blocked sections; hydraulic capacity and sub-probe flow paths are unresolved' });
}
