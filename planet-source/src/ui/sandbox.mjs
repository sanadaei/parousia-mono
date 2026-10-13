// Interactive placement sandbox: temporary test building pads and straight
// test road segments, designed against the loaded scene with the canonical
// core (designBuildingPad, sampleRoadCenterlineProfile). Nothing here modifies
// the scene; results are previews for the profile chart and the Sandbox panel.
// DOM-free so it can be exercised in Node.

import { designBuildingPad } from '../core/building-pad.mjs';
import { sampleRoadCenterlineProfile } from '../core/road-earthwork.mjs';
import { rectanglePolygon, pointInPolygon, insideBounds, boundsOfPoints } from './util.mjs';
import { classifyTrafficability, TRAFFIC_THRESHOLDS } from './trafficability.mjs';

export const SANDBOX_DEFAULTS = Object.freeze({
  padWidthM: 20, padDepthM: 14, padRotationDeg: 0,
  roadWidthM: 7, roadSmoothingM: 60, maxRoadGrade: 0.12,
});

let serial = 0;
const nextId = prefix => `${prefix}:${++serial}`;

function insideScene(scene, points) {
  return points.every(p => insideBounds(scene.bounds, p.xM, p.yM));
}

/**
 * Value-identical fast terrain for core designers: the scene's corridor sampler
 * skips the road-adjusted evaluation wherever earthwork cannot apply.
 * No traceSurfaceSegment, so road profiles use uniform probes only.
 */
export function sandboxTerrain(scene) {
  const t = scene.terrain;
  return { sampleAt: (x, y) => scene.sampler.sampleAt(x, y), groundElevationAt: (x, y) => scene.sampler.sampleAt(x, y).groundElevationM,
    worldId: t.worldId, regionId: t.regionId, roadAdjustmentId: t.roadAdjustmentId, frame: t.frame };
}

/** Slope magnitude and water depth at a point, through the scene sampler. */
function groundState(scene, xM, yM) {
  const s = scene.sampler.sampleAt(xM, yM);
  return { groundElevationM: s.groundElevationM, slopeMPerM: Math.hypot(s.gradient.x, s.gradient.y), waterDepthM: s.waterDepthM ?? null };
}

/**
 * Design a temporary rectangular pad centred at (xM, yM). Returns
 * `{ kind: 'pad', id, polygon, design, summary, profile }` where `profile`
 * is a cross-section along the pad's long axis with `padElevationM` set inside it.
 */
export function designTestPad(scene, { xM, yM, widthM = SANDBOX_DEFAULTS.padWidthM, depthM = SANDBOX_DEFAULTS.padDepthM,
  rotationDeg = SANDBOX_DEFAULTS.padRotationDeg, id = nextId('test-pad') } = {}) {
  const polygon = rectanglePolygon({ xM, yM, widthM, depthM, rotationDeg });
  if (!insideScene(scene, polygon)) throw new RangeError('Test pad must lie inside the scene bounds');
  const area = widthM * depthM;
  const design = designBuildingPad({ id, polygon }, sandboxTerrain(scene), { maxStepM: Math.max(0.5, Math.sqrt(area) / 16) });
  const heights = design.perimeterTransitions.map(p => p.heightM);
  const maxBatterWidthM = Math.max(...design.perimeterTransitions.map(p => p.batterWidthM));
  const overlaps = [];
  for (const pad of scene.overlays.buildingPads) if (polygon.some(p => pointInPolygon(p.xM, p.yM, pad.polygon))) overlaps.push(pad.id);
  for (const r of scene.corridorIndex.roads) {
    if (polygon.some(p => scene.corridorIndex.nearest(r, p.xM, p.yM, r.halfWidthM)) || scene.corridorIndex.nearest(r, xM, yM, Math.max(widthM, depthM) / 2)) overlaps.push(r.roadId);
  }
  const wet = polygon.concat([{ xM, yM }]).filter(p => (groundState(scene, p.xM, p.yM).waterDepthM ?? 0) > 0).length;
  const summary = {
    padElevationM: design.targetPadElevationM, elevationMode: design.elevationMode,
    unconstrainedPadElevationM: design.unconstrainedPadElevationM, minimumPadElevationM: design.minimumPadElevationM,
    waterClearanceStatus: design.waterClearanceStatus,
    areaM2: design.earthwork.areaM2, cutVolumeM3: design.earthwork.cutVolumeM3, fillVolumeM3: design.earthwork.fillVolumeM3,
    totalVolumeM3: design.earthwork.totalVolumeM3, netVolumeM3: design.earthwork.fillVolumeM3 - design.earthwork.cutVolumeM3,
    maxPerimeterHeightM: Math.max(...heights), maxBatterWidthM,
    samples: design.designSampling.sampleCount, overlaps, wetProbes: wet,
  };
  const item = { kind: 'pad', id, center: { xM, yM }, widthM, depthM, rotationDeg, polygon: design.polygon, summary };
  item.profile = padProfile(scene, item, design, maxBatterWidthM);
  return item;
}

function padProfile(scene, item, design, batterM) {
  // Long axis through the centre, extended past the batters on both sides.
  const along = item.widthM >= item.depthM ? item.rotationDeg : item.rotationDeg + 90;
  const half = Math.max(item.widthM, item.depthM) / 2 + batterM + Math.max(10, 0.5 * Math.max(item.widthM, item.depthM));
  const c = Math.cos(along * Math.PI / 180), s = Math.sin(along * Math.PI / 180);
  const clampToScene = p => ({ xM: Math.min(scene.bounds.maxXM, Math.max(scene.bounds.minXM, p.xM)),
    yM: Math.min(scene.bounds.maxYM, Math.max(scene.bounds.minYM, p.yM)) });
  const a = clampToScene({ xM: item.center.xM - half * c, yM: item.center.yM - half * s });
  const b = clampToScene({ xM: item.center.xM + half * c, yM: item.center.yM + half * s });
  const profile = scene.lineProfile(a, b, { targetSamples: 240 });
  for (const p of profile.samples) if (pointInPolygon(p.xM, p.yM, design.polygon)) p.padElevationM = design.targetPadElevationM;
  return { ...profile, kind: 'sandbox', id: `sandbox:${item.id}`, label: `Test pad ${item.id}` };
}

/** Smoothed ground (symmetric moving average, window shrinking to zero at the tie-in ends). */
export function smoothGrade(stations, ground, windowM) {
  const n = stations.length, prefix = new Float64Array(n + 1), out = new Float64Array(n);
  // Trapezoid-free mean over station samples; stations are uniform.
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + ground[i];
  const step = n > 1 ? stations[1] - stations[0] : 1, L = stations[n - 1];
  for (let i = 0; i < n; i++) {
    const halfM = Math.min(windowM / 2, stations[i], L - stations[i]), k = Math.floor(halfM / step + 1e-9);
    const lo = Math.max(0, i - k), hi = Math.min(n - 1, i + k);
    out[i] = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
  }
  return out;
}

/**
 * Design a straight test road from `a` to `b` on a smoothed design grade.
 * Earthwork uses average-end-area over prismatic sections: carriageway width
 * × |Δ| plus two batters at the scene's batter slopes (Δ²/slope per section).
 */
export function designTestRoad(scene, a, b, { widthM = SANDBOX_DEFAULTS.roadWidthM, smoothingM = SANDBOX_DEFAULTS.roadSmoothingM,
  maxRoadGrade = SANDBOX_DEFAULTS.maxRoadGrade, id = nextId('test-road') } = {}) {
  if (!insideScene(scene, [a, b])) throw new RangeError('Test road must lie inside the scene bounds');
  const lengthM = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  if (!(lengthM > 1)) throw new RangeError('Test road must be longer than 1 m');
  const stepM = Math.max(0.5, lengthM / 400), n = Math.ceil(lengthM / stepM) + 1;
  const stations = Float64Array.from({ length: n }, (_, i) => i === n - 1 ? lengthM : i * lengthM / (n - 1));
  const at = d => ({ xM: a.xM + (b.xM - a.xM) * d / lengthM, yM: a.yM + (b.yM - a.yM) * d / lengthM });
  const natural = [...stations].map(d => { const p = at(d); return groundState(scene, p.xM, p.yM); });
  const design = smoothGrade(stations, natural.map(s => s.groundElevationM), smoothingM);
  const roadElevationAt = d => {
    const u = Math.min(n - 1, Math.max(0, d / lengthM * (n - 1))), i = Math.min(n - 2, Math.floor(u)), t = u - i;
    return design[i] + (design[i + 1] - design[i]) * t;
  };
  const road = { id, points: [a, b], halfWidthM: widthM / 2 };
  const samples = sampleRoadCenterlineProfile(sandboxTerrain(scene), road, [], { maxStepM: stepM, roadElevationAt });

  const cutSlope = scene.roadSettings?.cutBatterSlope ?? 0.5, fillSlope = scene.roadSettings?.fillBatterSlope ?? 0.5;
  const section = delta => delta >= 0
    ? { fill: widthM * delta + delta * delta / fillSlope, cut: 0 }
    : { cut: -widthM * delta + delta * delta / cutSlope, fill: 0 };
  let cutVolumeM3 = 0, fillVolumeM3 = 0, maxCutM = 0, maxFillM = 0, maxGrade = 0, wetLengthM = 0, steepLengthM = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i], delta = p.roadElevationM - p.groundElevationM;
    maxCutM = Math.max(maxCutM, -delta); maxFillM = Math.max(maxFillM, delta);
    if (i === 0) continue;
    const q = samples[i - 1], ds = p.distanceM - q.distanceM, s0 = section(q.roadElevationM - q.groundElevationM), s1 = section(delta);
    cutVolumeM3 += ds * (s0.cut + s1.cut) / 2; fillVolumeM3 += ds * (s0.fill + s1.fill) / 2;
    const grade = Math.abs((p.roadElevationM - q.roadElevationM) / ds);
    maxGrade = Math.max(maxGrade, grade);
    if (grade > maxRoadGrade) steepLengthM += ds;
    const wet = s => s.waterSurfaceElevationM !== null && s.waterSurfaceElevationM > s.groundElevationM;
    if (wet(p) || wet(q)) wetLengthM += ds;
  }
  // Natural-ground trafficability along the line before construction.
  const traffic = {};
  for (const s of natural) {
    const c = classifyTrafficability({ slopeMPerM: s.slopeMPerM, waterDepthM: s.waterDepthM }).class;
    traffic[c] = (traffic[c] ?? 0) + lengthM / n;
  }
  const crossesRoads = scene.corridorIndex.roads.filter(r => {
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 200))) { const p = at(stations[i]); if (scene.corridorIndex.nearest(r, p.xM, p.yM, r.halfWidthM)) return true; }
    return false;
  }).map(r => r.roadId);
  const startGround = natural[0].groundElevationM, endGround = natural.at(-1).groundElevationM;
  const summary = {
    lengthM, widthM, smoothingM, stations: samples.length,
    startElevationM: startGround, endElevationM: endGround, averageGrade: (endGround - startGround) / lengthM,
    maxGrade, maxRoadGrade, steepLengthM, maxCutM, maxFillM,
    cutVolumeM3, fillVolumeM3, totalVolumeM3: cutVolumeM3 + fillVolumeM3, netVolumeM3: fillVolumeM3 - cutVolumeM3,
    wetLengthM, crossesRoads, naturalTraffic: traffic,
    vehiclePassableNaturalFraction: natural.filter(s => classifyTrafficability({ slopeMPerM: s.slopeMPerM, waterDepthM: s.waterDepthM }).vehicle.passable).length / n,
    thresholds: TRAFFIC_THRESHOLDS,
  };
  const profile = { kind: 'sandbox', id: `sandbox:${id}`, label: `Test road ${id}`, lengthM, path: [a, b], bridges: [],
    samples: samples.map(p => ({ distanceM: p.distanceM, xM: p.xM, yM: p.yM, groundElevationM: p.groundElevationM,
      waterSurfaceElevationM: p.waterSurfaceElevationM, waterDepthM: p.waterSurfaceElevationM === null ? null : Math.max(0, p.waterSurfaceElevationM - p.groundElevationM),
      roadElevationM: p.roadElevationM, structureKind: p.structureKind, segmentKind: p.segmentKind, gradeSlope: p.gradeSlope, clearanceM: p.clearanceM })) };
  return { kind: 'road', id, a, b, widthM, points: [a, b], bounds: boundsOfPoints([a, b], widthM), summary, profile };
}
