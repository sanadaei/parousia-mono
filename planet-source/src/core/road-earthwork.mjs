import {projectedHullAxisRange} from './projected-hull.mjs';
import {boundBatterBlend,blendBatterElevations,boundBlendedBatters} from './earthwork-bounds.mjs';
import {validateRoadCrossSection,roadCrossSectionAt,roadCrossSectionOffsetBound,roadCrossSectionOffsetInterval} from './road-cross-section.mjs';
import {validateElevationInterval,validateMetricDisk} from './contract-validation.mjs';
import { finiteNumber as finite, positiveNumber as positive, nonEmptyText as text,
  integerDimension } from './contract-validation.mjs';
import { copyJson, hashJson } from './json-contract.mjs';
import { surfaceTracePlan, completeSurfaceTrace, MAX_TRACE_SAMPLES } from './surface-trace.mjs';
import { unitNormalForGradient, fixedStencilCurvature } from './surface-derivatives.mjs';

const KINDS = new Set(['bridge-deck', 'approach-ramp', 'at-grade', 'cut', 'fill']);
function freezeOwned(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwned(child);
    Object.freeze(value);
  }
  return value;
}
const nonnegative = (value, name) => {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
  return value;
};
function budget(value = MAX_TRACE_SAMPLES) {
  integerDimension(value, 'maxSamples');
  if (value > MAX_TRACE_SAMPLES) throw new RangeError('Road sample budget exceeds 262144');
  return value;
}
function metricRoad(road) {
  text(road?.id, 'road.id');
  if (!Array.isArray(road.points) || road.points.length < 2 || road.points.length > 65536) {
    throw new RangeError('Road needs 2..65536 metric points');
  }
  const hasElevations = road.points.some(p => p?.roadElevationM != null);
  let lengthM = 0;
  const points = road.points.map((p, i) => {
    finite(p?.xM, 'road.xM'); finite(p?.yM, 'road.yM');
    if (hasElevations) finite(p.roadElevationM, 'road.roadElevationM');
    if (i) {
      const previous = road.points[i - 1], length = Math.hypot(p.xM - previous.xM, p.yM - previous.yM);
      positive(length, 'road segment length');
      const next = finite(lengthM + length, 'road length');
      if (next === lengthM) throw new RangeError('Road stations are not representable');
      lengthM = next;
    }
    return { xM: p.xM, yM: p.yM, distanceM: lengthM,
      ...(hasElevations ? { roadElevationM: p.roadElevationM } : {}) };
  });
  const halfWidthM = positive(road.halfWidthM ?? (road.widthM == null ? 3 : road.widthM / 2), 'road.halfWidthM');
  function pointAt(distanceM) {
    finite(distanceM, 'distanceM');
    if (distanceM < 0 || distanceM > lengthM) throw new RangeError('Station is outside road');
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].distanceM <= distanceM) lo = mid; else hi = mid; }
    const a = points[lo], b = points[hi], t = (distanceM - a.distanceM) / (b.distanceM - a.distanceM);
    if (t === 0) return { ...a };
    if (t === 1) return { ...b };
    return { distanceM, xM: a.xM * (1 - t) + b.xM * t, yM: a.yM * (1 - t) + b.yM * t,
      ...(hasElevations ? { roadElevationM: a.roadElevationM * (1 - t) + b.roadElevationM * t } : {}) };
  }
  return { points, lengthM, halfWidthM, hasElevations, pointAt };
}
function baseLevel(route, options, groundAt) {
  for (const key of ['roadElevationAt', 'groundElevationAt']) {
    if (options[key] != null && typeof options[key] !== 'function') throw new TypeError(`${key} must be a function`);
  }
  return distanceM => {
    const p = route.pointAt(distanceM);
    return finite(options.roadElevationAt ? options.roadElevationAt(distanceM, p)
      : route.hasElevations ? p.roadElevationM : (options.groundElevationAt ?? groundAt)(p.xM, p.yM), 'road base elevation');
  };
}
function outsideGrade(levelAt, station, direction, lengthM) {
  const h = Math.min(0.01, direction < 0 ? station : lengthM - station);
  if (h <= 0) return 0;
  return finite((levelAt(station + direction * h) - levelAt(station)) / (direction * h), 'tie grade');
}
function cubic(section) {
  const length = positive(section.endDistanceM - section.startDistanceM, 'ramp length');
  const z0 = section.startElevationM, z1 = section.endElevationM;
  const m0 = section.startGradeSlope * length, m1 = section.endGradeSlope * length;
  const a = 2 * z0 - 2 * z1 + m0 + m1, b = -3 * z0 + 3 * z1 - 2 * m0 - m1, c = m0;
  for (const value of [a, b, c]) finite(value, 'vertical curve coefficient');
  const grade = t => finite((3 * a * t * t + 2 * b * t + c) / length, 'gradeSlope');
  const vertex = a === 0 ? -1 : -b / (3 * a);
  const maxGrade = Math.max(Math.abs(grade(0)), Math.abs(grade(1)), vertex > 0 && vertex < 1 ? Math.abs(grade(vertex)) : 0);
  const controls=[z0,z0+m0/3,z1-m1/3,z1];
  return { elevationBounds:[Math.min(...controls),Math.max(...controls)], interval(t0,t1){
    const value=t=>((a*t+b)*t+c)*t+z0, d=t=>3*a*t*t+2*b*t+c, span=t1-t0;
    const zLeft=value(t0),zRight=value(t1),hull=[zLeft,zLeft+d(t0)*span/3,zRight-d(t1)*span/3,zRight];
    return [Math.min(...hull),Math.max(...hull)];
  }, maxGrade, gradeExtremumDistanceM: vertex > 0 && vertex < 1 ? section.startDistanceM + vertex * length : null, at(station) {
    const t = Math.max(0, Math.min(1, (station - section.startDistanceM) / length));
    return { roadElevationM: t === 0 ? z0 : t === 1 ? z1 : finite(((a * t + b) * t + c) * t + z0, 'roadElevationM'),
      gradeSlope: t === 0 ? section.startGradeSlope : t === 1 ? section.endGradeSlope : grade(t) };
  } };
}
function bridgeAt(profile, station) {
  if (station < profile.approaches.before.startDistanceM || station > profile.approaches.after.endDistanceM) return null;
  if (station >= profile.startDistanceM && station <= profile.endDistanceM) {
    return { roadElevationM: profile.deckElevationM, gradeSlope: 0, structureKind: 'bridge-deck', deckThicknessM: profile.deckThicknessM };
  }
  const section = station < profile.startDistanceM ? profile.approaches.before : profile.approaches.after;
  return { ...cubic(section).at(station), structureKind: 'approach-ramp', deckThicknessM: 0 };
}

/** Flat deck and cubic Hermite approaches. Without a ground oracle or explicit
 * road elevations, dry witnesses are constant-height estimates; the centerline
 * sampler resolves those estimates against the actual terrain before tracing. */
export function designBridgeProfile(crossing, road, options = {}) {
  const route = metricRoad(road);
  if (crossing?.roadId !== road.id) throw new RangeError('Crossing roadId must match road');
  text(crossing.crossingId, 'crossingId');
  const water = finite(crossing.maxWaterLevelElevationM, 'maxWaterLevelElevationM');
  const wetStart = nonnegative(crossing.startDistanceM, 'crossing.startDistanceM');
  const wetEnd = finite(crossing.endDistanceM, 'crossing.endDistanceM');
  if (wetEnd < wetStart || wetEnd > route.lengthM) throw new RangeError('Crossing stations are outside road or reversed');
  const before = crossing.dryApproachBefore, after = crossing.dryApproachAfter;
  if (!before || !after) throw new RangeError('Bridge needs dry approaches on both sides of the crossing');
  for (const p of [before, after]) {
    nonnegative(p.distanceM, 'dry approach distanceM'); finite(p.groundElevationM, 'dry approach groundElevationM');
    if (p.waterSurfaceElevationM != null) throw new RangeError('Bridge approach witness must be dry');
    if (p.xM != null || p.yM != null) {
      finite(p.xM, 'dry approach xM'); finite(p.yM, 'dry approach yM');
      const point = route.pointAt(p.distanceM);
      if (Math.hypot(point.xM - p.xM, point.yM - p.yM) > 1e-6) throw new RangeError('Crossing witnesses do not match road geometry');
    }
  }
  if (before.distanceM > wetStart || after.distanceM < wetEnd || after.distanceM > route.lengthM) {
    throw new RangeError('Dry approaches must bracket the crossing');
  }
  const clearanceM = nonnegative(options.clearanceM ?? 1, 'clearanceM');
  const maxApproachSlope = positive(options.maxApproachSlope ?? 0.08, 'maxApproachSlope');
  const deckThicknessM = nonnegative(options.deckThicknessM ?? 0.5, 'deckThicknessM');
  const minBridgeLengthM = nonnegative(options.minBridgeLengthM ?? 0, 'minBridgeLengthM');
  const length = Math.max(after.distanceM - before.distanceM, minBridgeLengthM);
  if (length <= 0 || length > route.lengthM) throw new RangeError('Bridge length cannot fit on road');
  const center = (before.distanceM + after.distanceM) / 2;
  const startDistanceM = Math.max(0, Math.min(route.lengthM - length, center - length / 2));
  const endDistanceM = startDistanceM + length;
  const minimumClearanceM = Math.max(clearanceM, crossing.requiredDeckElevationM == null ? 0
    : finite(crossing.requiredDeckElevationM, 'requiredDeckElevationM') - water);
  const requiredDeckElevationM = finite(water + minimumClearanceM + deckThicknessM, 'required deck elevation');
  const unresolved = !route.hasElevations && !options.roadElevationAt && !options.groundElevationAt;
  const levelAt = baseLevel(route, options, () => { throw new TypeError('Missing ground elevation oracle'); });
  const beforeLevel = unresolved ? () => before.groundElevationM : levelAt;
  const afterLevel = unresolved ? () => after.groundElevationM : levelAt;
  const deckElevationM = Math.max(requiredDeckElevationM, beforeLevel(startDistanceM), afterLevel(endDistanceM),
    crossing.deckElevationM == null ? -Infinity : finite(crossing.deckElevationM, 'deckElevationM'));
  function approach(deckStation, direction, baseline) {
    const available = direction < 0 ? deckStation : route.lengthM - deckStation;
    if (available <= 0) throw new RangeError('Insufficient road length for bridge approach');
    let rampLength = Math.min(available, Math.max(1, 1.5 * Math.abs(deckElevationM - baseline(deckStation)) / maxApproachSlope));
    for (let attempt = 0; attempt < 128; attempt++) {
      const station = direction < 0 ? Math.max(0, deckStation - rampLength) : Math.min(route.lengthM, deckStation + rampLength);
      const elevation = baseline(station), grade = unresolved ? 0 : outsideGrade(baseline, station, direction, route.lengthM);
      const section = direction < 0
        ? { startDistanceM: station, endDistanceM: deckStation, startElevationM: elevation, endElevationM: deckElevationM, startGradeSlope: grade, endGradeSlope: 0 }
        : { startDistanceM: deckStation, endDistanceM: station, startElevationM: deckElevationM, endElevationM: elevation, startGradeSlope: 0, endGradeSlope: grade };
      const curve = cubic(section);
      if (curve.maxGrade <= maxApproachSlope * (1 + 1e-10)) return { ...section, maxGradeSlope: curve.maxGrade };
      if (rampLength === available) break;
      rampLength = Math.min(available, rampLength * 1.25);
    }
    throw new RangeError('Insufficient road length or excessive ground grade for bridge approach slope limit');
  }
  const profile = { crossingId: crossing.crossingId, roadId: road.id,
    ...(crossing.worldId ? { worldId: crossing.worldId } : {}), ...(crossing.regionId ? { regionId: crossing.regionId } : {}),
    startDistanceM, endDistanceM, deckElevationM, requiredDeckElevationM, deckThicknessM,
    clearanceM: deckElevationM - deckThicknessM - water, minimumClearanceM, maxApproachSlope,
    approaches: { before: approach(startDistanceM, -1, beforeLevel), after: approach(endDistanceM, 1, afterLevel) },
    requiresGroundTieResolution: unresolved, sourceCrossing: copyJson(crossing),
    designOptions: { clearanceM, maxApproachSlope, deckThicknessM, minBridgeLengthM } };
  freezeOwned(profile);
  return Object.freeze({ ...profile, sampleAt: distanceM => bridgeAt(profile, finite(distanceM, 'distanceM')) });
}

function validateBridge(profile, route, road, terrain) {
  if (profile.roadId !== road.id) throw new RangeError('Bridge roadId must match road');
  if (profile.worldId && profile.worldId !== terrain.worldId) throw new RangeError('Bridge worldId must match terrain');
  if (profile.regionId && profile.regionId !== terrain.regionId) throw new RangeError('Bridge regionId must match terrain');
  nonnegative(profile.startDistanceM, 'bridge start'); finite(profile.endDistanceM, 'bridge end');
  finite(profile.deckElevationM, 'deckElevationM'); nonnegative(profile.deckThicknessM, 'deckThicknessM');
  finite(profile.requiredDeckElevationM, 'requiredDeckElevationM');
  nonnegative(profile.minimumClearanceM, 'minimumClearanceM');
  if (profile.deckElevationM < profile.requiredDeckElevationM) throw new RangeError('Bridge deck is below required clearance');
  positive(profile.maxApproachSlope, 'maxApproachSlope');
  if (profile.endDistanceM <= profile.startDistanceM || profile.endDistanceM > route.lengthM) throw new RangeError('Invalid bridge stations');
  const a = profile.approaches?.before, b = profile.approaches?.after;
  for (const section of [a, b]) {
    for (const key of ['startDistanceM', 'endDistanceM', 'startElevationM', 'endElevationM', 'startGradeSlope', 'endGradeSlope']) finite(section?.[key], `approach.${key}`);
    if (cubic(section).maxGrade > profile.maxApproachSlope * (1 + 1e-10)) throw new RangeError('Bridge approach exceeds slope limit');
  }
  if (a.startDistanceM < 0 || b.endDistanceM > route.lengthM || a.endDistanceM !== profile.startDistanceM
    || b.startDistanceM !== profile.endDistanceM || a.endElevationM !== profile.deckElevationM
    || b.startElevationM !== profile.deckElevationM || a.endGradeSlope !== 0 || b.startGradeSlope !== 0) {
    throw new RangeError('Bridge approaches must join the deck continuously');
  }
}

/** Return an ordered array. Road vertices, terrain trace events, bridge joins and
 * ramp grade extrema are included in addition to probes no farther than maxStepM. */
export function sampleRoadCenterlineProfile(terrain, road, bridgeProfiles = [], options = {}) {
  const route = metricRoad(road), maxStepM = positive(options.maxStepM ?? 2, 'maxStepM'), maxSamples = budget(options.maxSamples);
  if (typeof terrain?.sampleAt !== 'function' || typeof terrain.groundElevationAt !== 'function') throw new TypeError('Terrain needs sampleAt and groundElevationAt');
  if (!Array.isArray(bridgeProfiles) || bridgeProfiles.length > 4096) throw new RangeError('Invalid bridge profile collection');
  const levelAt = baseLevel(route, options, (x, y) => terrain.groundElevationAt(x, y));
  const bridges = bridgeProfiles.map(p => {
    // Diagnose identity before re-solving so a foreign crossing never becomes an approval.
    if (p.worldId && p.worldId !== terrain.worldId) throw new RangeError('Bridge worldId must match terrain');
    if (p.regionId && p.regionId !== terrain.regionId) throw new RangeError('Bridge regionId must match terrain');
    const resolved = p.requiresGroundTieResolution ? designBridgeProfile(p.sourceCrossing, road,
      { ...p.designOptions, roadElevationAt: levelAt }) : p;
    validateBridge(resolved, route, road, terrain);
    for (const [section, station] of [[resolved.approaches.before, resolved.approaches.before.startDistanceM],
      [resolved.approaches.after, resolved.approaches.after.endDistanceM]]) {
      const expected = station === section.startDistanceM ? section.startElevationM : section.endElevationM;
      if (Math.abs(levelAt(station) - expected) > 1e-6) throw new RangeError('Bridge ground tie mismatch; redesign with groundElevationAt');
      const before = station === section.startDistanceM, grade = before ? section.startGradeSlope : section.endGradeSlope;
      if (Math.abs(outsideGrade(levelAt, station, before ? -1 : 1, route.lengthM) - grade) > 1e-6) {
        throw new RangeError('Bridge ground tie grade mismatch; redesign with groundElevationAt');
      }
    }
    return resolved;
  }).sort((a, b) => a.startDistanceM - b.startDistanceM);
  for (let i = 1; i < bridges.length; i++) if (bridges[i].approaches.before.startDistanceM < bridges[i - 1].approaches.after.endDistanceM) {
    throw new RangeError('Overlapping bridge approaches need a joint vertical alignment');
  }
  const stations = new Set(route.points.map(p => p.distanceM));
  const anchors = new Set(stations);
  const steps = Math.ceil(route.lengthM / maxStepM);
  if (steps >= maxSamples) throw new RangeError('Road profile exceeds sample budget');
  for (let i = 0; i <= steps; i++) stations.add(i === steps ? route.lengthM : i * route.lengthM / steps);
  if (terrain.traceSurfaceSegment) for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    const trace = terrain.traceSurfaceSegment(a, b, { maxStepM, maxSamples });
    for (const p of trace.samples) stations.add(p.distanceM === trace.lengthM ? b.distanceM : a.distanceM + p.distanceM);
    if (stations.size > maxSamples) throw new RangeError('Road profile exceeds sample budget');
  }
  for (const bridge of bridges) {
    stations.add(bridge.startDistanceM); stations.add(bridge.endDistanceM);
    anchors.add(bridge.startDistanceM); anchors.add(bridge.endDistanceM);
    for (const section of Object.values(bridge.approaches)) {
      stations.add(section.startDistanceM); stations.add(section.endDistanceM);
      anchors.add(section.startDistanceM); anchors.add(section.endDistanceM);
      const extremum = cubic(section).gradeExtremumDistanceM;
      if (extremum !== null) stations.add(extremum);
    }
  }
  if (stations.size > maxSamples) throw new RangeError('Road profile exceeds sample budget');
  const alignmentAt = station => {
    for (const p of bridges) { const result = bridgeAt(p, station); if (result) return result; }
    return null;
  };
  // Trace events and uniform probes can describe the same point a few ulps
  // apart. Keep authoritative vertices/joins rather than zero-length segments.
  const sorted = [];
  const tolerance = 32 * Number.EPSILON * Math.max(1, route.lengthM);
  for (const station of [...stations].sort((a, b) => a - b)) {
    const last = sorted.at(-1);
    if (last != null && station - last <= tolerance) {
      if (anchors.has(station)) sorted[sorted.length - 1] = station;
    } else sorted.push(station);
  }
  const samples = sorted.map(distanceM => {
    const point = route.pointAt(distanceM), ground = terrain.sampleAt(point.xM, point.yM), alignment = alignmentAt(distanceM);
    const roadElevationM = alignment?.roadElevationM ?? levelAt(distanceM);
    const difference = roadElevationM - ground.groundElevationM;
    const structureKind = alignment?.structureKind ?? (Math.abs(difference) <= 1e-8 ? 'at-grade' : difference > 0 ? 'fill' : 'cut');
    const water = ground.waterSurfaceElevationM ?? null;
    const clearanceM = water === null ? null : finite(roadElevationM - (alignment?.deckThicknessM ?? 0) - water, 'clearanceM');
    return { distanceM, xM: point.xM, yM: point.yM, groundElevationM: ground.groundElevationM,
      waterSurfaceElevationM: water, roadElevationM, structureKind, clearanceM,
      gradeSlope: alignment?.gradeSlope ?? 0, roadId: road.id, halfWidthM: route.halfWidthM,
      ...(terrain.worldId ? { worldId: terrain.worldId } : {}), ...(terrain.regionId ? { regionId: terrain.regionId } : {}) };
  });
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (!alignmentAt(p.distanceM)) {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
      p.gradeSlope = finite((b.roadElevationM - a.roadElevationM) / (b.distanceM - a.distanceM), 'gradeSlope');
    }
    // This interval tag preserves an exact deck boundary when an adjacent ramp
    // endpoint itself is tagged bridge-deck. It survives JSON copying.
    if (i + 1 < samples.length) p.segmentKind = alignmentAt((p.distanceM + samples[i + 1].distanceM) / 2)?.structureKind ?? p.structureKind;
    if (p.structureKind === 'bridge-deck' && p.clearanceM !== null) {
      const bridge = bridges.find(b => p.distanceM >= b.startDistanceM && p.distanceM <= b.endDistanceM);
      if (p.clearanceM < bridge.minimumClearanceM - 1e-7) throw new RangeError('Bridge has insufficient sampled water clearance');
    }
  }
  return samples;
}

function corridorProfiles(input, terrain, halfWidthM) {
  if (!Array.isArray(input)) throw new TypeError('roadCenterlineProfiles must be an array');
  const collection = input.length && input[0]?.distanceM != null ? [input] : input;
  if (collection.length > 4096) throw new RangeError('Too many road profiles');
  let total = 0;
  const ids = new Set();
  return collection.map((entry, index) => {
    const source = Array.isArray(entry) ? entry : entry?.samples;
    if (!Array.isArray(source) || source.length < 2) throw new RangeError('Road corridor needs at least two samples');
    total += source.length;
    if (total > MAX_TRACE_SAMPLES) throw new RangeError('Road corridors exceed sample budget');
    const id = text(entry.roadId ?? source[0].roadId ?? `road:${index}`, 'profile.roadId');
    if (ids.has(id)) throw new RangeError('Duplicate road profile ID');
    ids.add(id);
    const width = positive(entry.halfWidthM ?? source[0].halfWidthM ?? halfWidthM, 'halfWidthM');
    const samples = source.map((p, i) => {
      for (const key of ['distanceM', 'xM', 'yM', 'roadElevationM']) finite(p[key], `profile.${key}`);
      if (p.worldId && p.worldId !== terrain.worldId) throw new RangeError('Road profile worldId must match terrain');
      if (p.regionId && p.regionId !== terrain.regionId) throw new RangeError('Road profile regionId must match terrain');
      if (p.roadId && p.roadId !== id) throw new RangeError('Inconsistent road profile ID');
      if (!KINDS.has(p.structureKind) || (p.segmentKind && !KINDS.has(p.segmentKind))) throw new TypeError('Invalid road structureKind');
      if (p.gradeSlope != null) finite(p.gradeSlope, 'profile.gradeSlope');
      if (i && (p.distanceM <= source[i - 1].distanceM || Math.hypot(p.xM - source[i - 1].xM, p.yM - source[i - 1].yM) === 0)) throw new RangeError('Road sample stations must strictly increase with distinct coordinates');
      return { distanceM: p.distanceM, xM: p.xM, yM: p.yM, roadElevationM: p.roadElevationM,
        structureKind: p.structureKind, ...(p.segmentKind ? { segmentKind: p.segmentKind } : {}),
        ...(p.gradeSlope != null ? { gradeSlope: p.gradeSlope } : {}) };
    });
    validateRoadCrossSection(entry.crossSection,samples.at(-1).distanceM);
    return { roadId: id, halfWidthM: width, samples, ...(entry.crossSection?{crossSection:copyJson(entry.crossSection)}:{}) };
  }).sort((a, b) => a.roadId < b.roadId ? -1 : a.roadId > b.roadId ? 1 : 0);
}

/** Small immutable AABB hierarchy for exact nearest-segment queries. The
 * original station index is retained because bridge endpoint ties have a
 * deliberate legacy ordering. Bounds only skip impossible winners. */
function indexRoadSegments(segments){
  let minXM=Infinity,maxXM=-Infinity,minYM=Infinity,maxYM=-Infinity;
  for(const s of segments)for(const p of [s.a,s.b]){minXM=Math.min(minXM,p.xM);maxXM=Math.max(maxXM,p.xM);minYM=Math.min(minYM,p.yM);maxYM=Math.max(maxYM,p.yM);}
  const bounds={minXM,maxXM,minYM,maxYM};
  if(segments.length<=8)return {...bounds,segments};
  const axis=maxXM-minXM>=maxYM-minYM?'xM':'yM',mid=s=>(s.a[axis]+s.b[axis])/2,
    sorted=segments.slice().sort((a,b)=>mid(a)-mid(b)||a.index-b.index),middle=Math.floor(sorted.length/2);
  return {...bounds,axis,split:(mid(sorted[middle-1])+mid(sorted[middle]))/2,
    left:indexRoadSegments(sorted.slice(0,middle)),right:indexRoadSegments(sorted.slice(middle))};
}

/** Apply only ground-supported road spans. Batter slopes are rise/run, default
 * 0.5 (1V:2H). Smoothstep width uses its 1.5 peak derivative. No bridge fill is
 * placed in the waterway. All evaluation is in source metric coordinates. */
export function createRoadAdjustedTerrain(terrain, roadCenterlineProfiles = [], options = {}) {
  if (typeof terrain?.sampleAt !== 'function' || typeof terrain.groundElevationAt !== 'function') throw new TypeError('Terrain needs sampleAt and groundElevationAt');
  if(options.blendPolicy != null && options.blendPolicy !== 'squared-odds@1') throw new RangeError('Unknown road blendPolicy');
  const settings = {
    ...(options.blendPolicy ? {blendPolicy:options.blendPolicy} : {}),
    halfWidthM: positive(options.halfWidthM ?? 3, 'halfWidthM'),
    cutBatterSlope: positive(options.cutBatterSlope ?? options.batterSlope ?? 0.5, 'cutBatterSlope'),
    fillBatterSlope: positive(options.fillBatterSlope ?? options.batterSlope ?? 0.5, 'fillBatterSlope'),
    derivativeStepM: positive(options.derivativeStepM ?? 1, 'derivativeStepM'),
  };
  if (terrain.frame?.kind === 'sphere-geographic') throw new TypeError('Road earthwork requires a metric terrain view');
  const profiles = corridorProfiles(roadCenterlineProfiles, terrain, settings.halfWidthM);
  const roadAdjustmentId = hashJson({ sourceWorldId: terrain.worldId ?? null, profiles, settings });
  // Compile the sampled vertical curves once; query order never affects results.
  const compiled = profiles.map(road => ({ ...road, segments: road.samples.slice(1).map((b, i) => {
    const a = road.samples[i], secant = (b.roadElevationM - a.roadElevationM) / (b.distanceM - a.distanceM);
    return { a, b, index:i, dx:b.xM-a.xM, dy:b.yM-a.yM, length:Math.hypot(b.xM-a.xM,b.yM-a.yM), curve: cubic({ startDistanceM: a.distanceM, endDistanceM: b.distanceM,
      startElevationM: a.roadElevationM, endElevationM: b.roadElevationM,
      startGradeSlope: a.gradeSlope ?? secant, endGradeSlope: b.gradeSlope ?? secant }) };
  }) }));
  for(const road of compiled)road.segmentIndex=indexRoadSegments(road.segments);
  function closestSurface(road, xM, yM) {
      let bestSegment=null,bestDistance=Infinity,bestT=0,bestX=0,bestY=0,bestKind=null,bestIndex=Infinity;
      const stack=[road.segmentIndex];
      while(stack.length){
        const node=stack.pop(),lower=Math.hypot(Math.max(0,node.minXM-xM,xM-node.maxXM),Math.max(0,node.minYM-yM,yM-node.maxYM)),
          rounding=128*Number.EPSILON*Math.max(1,Math.abs(xM),Math.abs(yM),Math.abs(node.minXM),Math.abs(node.maxXM),Math.abs(node.minYM),Math.abs(node.maxYM));
        if(lower>bestDistance+rounding)continue;
        if(!node.segments){const first=(node.axis==='xM'?xM:yM)<=node.split?node.left:node.right;
          stack.push(first===node.left?node.right:node.left,first);continue;}
      for (const segment of node.segments) {
        const { a, b, dx, dy, length } = segment;
        const t = Math.max(0, Math.min(1, ((xM - a.xM) * (dx / length) + (yM - a.yM) * (dy / length)) / length));
        const x = t === 0 ? a.xM : t === 1 ? b.xM : a.xM * (1 - t) + b.xM * t;
        const y = t === 0 ? a.yM : t === 1 ? b.yM : a.yM * (1 - t) + b.yM * t;
        const distance = Math.hypot(xM - x, yM - y);
        const kind = t === 0 ? a.structureKind : t === 1 ? b.structureKind
          : a.segmentKind ?? (a.structureKind === 'bridge-deck' && b.structureKind === 'bridge-deck' ? 'bridge-deck' : 'at-grade');
        if (!bestSegment || distance < bestDistance || distance===bestDistance &&
          (kind==='bridge-deck' ? bestKind!=='bridge-deck'||segment.index>bestIndex : bestKind!=='bridge-deck'&&segment.index<bestIndex)) {
          bestSegment=segment;bestIndex=segment.index;bestDistance=distance;bestT=t;bestX=x;bestY=y;bestKind=kind;
        }
      }
      }
      if(!bestSegment)return null;
      // Vertical curves and cross-sections cannot affect the closest-segment
      // decision. Evaluate only the winner, retaining its exact arithmetic.
      const {a,b,dx,dy,length}=bestSegment,t=bestT;
      const station = t === 0 ? a.distanceM : t === 1 ? b.distanceM : a.distanceM * (1 - t) + b.distanceM * t;
      const vertical=bestSegment.curve.at(station);
      const lateral=Math.max(-road.halfWidthM,Math.min(road.halfWidthM,(-(xM-bestX)*dy+(yM-bestY)*dx)/length)),section=roadCrossSectionAt(road.crossSection,station,lateral);
      return {distance:bestDistance,kind:bestKind,elevation:road.crossSection?vertical.roadElevationM+section.offsetM:vertical.roadElevationM,
        slopeMPerM:road.crossSection?Math.hypot(vertical.gradeSlope+section.alongSlope,section.acrossSlope):Math.abs(vertical.gradeSlope)};
  }
  /** Carriageway/deck surface, separate from the ground beneath a bridge.
   * Nearest corridor wins; sorted road IDs settle ties. Batters are excluded. */
  function roadSurfaceAt(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    // Preserve the base adapter's coordinate/bounds contract.
    terrain.groundElevationAt(xM, yM);
    let winner = null;
    for (const road of compiled) {
      const closest = closestSurface(road, xM, yM);
      if (closest.distance > road.halfWidthM) continue;
      if (!winner || closest.distance < winner.distance) winner = { ...closest, roadId: road.roadId };
    }
    return winner ? { roadId: winner.roadId, structureKind: winner.kind,
      surfaceKind: 'road', roadElevationM: winner.elevation, slopeMPerM: winner.slopeMPerM,
      roughness: 0 } : terrain.roadSurfaceAt?.(xM, yM) ?? null;
  }
  function adjustedGround(xM, yM, base) {
    let winner = null;
    const candidates = settings.blendPolicy ? [] : null;
    for (const road of compiled) {
      const closest = closestSurface(road, xM, yM);
      if (closest.kind === 'bridge-deck') continue;
      const delta = finite(closest.elevation - base, 'earthwork elevation difference'), offset = Math.max(0, closest.distance - road.halfWidthM);
      if (delta === 0 && closest.distance > road.halfWidthM) continue;
      const slope = delta > 0 ? settings.fillBatterSlope : settings.cutBatterSlope;
      const width = finite(1.5 * Math.abs(delta) / slope, 'batter width');
      if (offset > 0 && offset >= width) continue;
      const t = offset === 0 ? 0 : offset / width, influence = 1 - t * t * (3 - 2 * t);
      const candidate = { influence, distance: closest.distance, elevation: finite(base + delta * influence, 'adjusted ground elevation') };
      if(candidates) candidates.push(candidate);
      // Full carriageways precede batters; nearest wins equal influence. Sorted
      // IDs settle the remaining tie independently of caller order.
      if (!winner || influence > winner.influence || (influence === winner.influence && candidate.distance < winner.distance)) winner = candidate;
    }
    return { elevation: candidates ? blendBatterElevations(candidates,base) : winner?.elevation ?? base, applied: winner !== null };
  }
  function groundElevationAt(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    return adjustedGround(xM, yM, terrain.groundElevationAt(xM, yM)).elevation;
  }
  function sampleAt(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    const base = terrain.sampleAt(xM, yM), adjustment = adjustedGround(xM, yM, base.groundElevationM);
    if (!adjustment.applied) return base;
    const groundElevationM = adjustment.elevation;
    const d = settings.derivativeStepM, bounds = terrain.bounds;
    const left = Math.max(bounds?.minXM ?? -Infinity, xM - d), right = Math.min(bounds?.maxXM ?? Infinity, xM + d);
    const bottom = Math.max(bounds?.minYM ?? -Infinity, yM - d), top = Math.min(bounds?.maxYM ?? Infinity, yM + d);
    const gradient = { x: finite((groundElevationAt(right, yM) - groundElevationAt(left, yM)) / (right - left), 'gradient.x'),
      y: finite((groundElevationAt(xM, top) - groundElevationAt(xM, bottom)) / (top - bottom), 'gradient.y') };
    const level = base.waterLevelElevationM ?? base.waterSurfaceElevationM ?? null;
    const waterDepthM = level === null ? (base.waterDepthM == null ? null : 0) : Math.max(0, level - groundElevationM);
    return { ...base, roadAdjustmentId, groundElevationM, gradient, slopeMPerM: Math.hypot(gradient.x, gradient.y),
      waterDepthM, waterSurfaceElevationM: waterDepthM > 0 ? level : null,
      surfaceKind: waterDepthM === null ? 'unresolved' : waterDepthM > 0 ? 'water' : 'ground',
      ...(base.waterSourceIds && waterDepthM === 0 ? { waterSourceIds: [] } : {}) };
  }
  function surfaceFrameAt(xM, yM) {
    const sample = sampleAt(xM, yM);
    if (!sample.roadAdjustmentId && terrain.surfaceFrameAt) return terrain.surfaceFrameAt(xM, yM);
    const d = settings.derivativeStepM, b = terrain.bounds;
    const edge = b && (xM - d < b.minXM || xM + d > b.maxXM || yM - d < b.minYM || yM + d > b.maxYM);
    return { ...sample, normal: unitNormalForGradient(sample.gradient),
      curvature: edge ? null : fixedStencilCurvature(groundElevationAt, xM, yM, sample.groundElevationM, sample.gradient, d),
      curvatureStatus: edge ? 'unavailable-at-region-edge' : 'fixed-distance-estimate' };
  }
  const targetBounds=compiled.reduce(([low,high],road)=>{
    const cross=roadCrossSectionOffsetBound(road.crossSection,road.halfWidthM);
    for(const segment of road.segments){low=Math.min(low,segment.curve.elevationBounds[0]-cross);high=Math.max(high,segment.curve.elevationBounds[1]+cross);}
    return[low,high];
  },[Infinity,-Infinity]);
  function boundGroundElevation(range,region){
    const disk=validateMetricDisk(region),base=validateElevationInterval(terrain.boundGroundElevation?.(range,disk)??range);
    let targets=targetBounds,covered=false,fullyCovered=false,guaranteedInfluence=0;
    if(disk){
      const candidates=[],roadIntervals=[];
      for(const road of compiled){
       // Find possible nearest segments before evaluating their Hermite and
       // crown intervals. A distant segment cannot affect this observation.
       const geometry=road.segments.map((segment,index)=>{
        const {a,b}=segment,dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy),
          raw=((disk.xM-a.xM)*dx+(disk.yM-a.yM)*dy)/(length*length),t=Math.max(0,Math.min(1,raw)),
          distance=Math.hypot(disk.xM-a.xM-t*dx,disk.yM-a.yM-t*dy);
        return {segment,index,dx,dy,length,raw,lower:Math.max(0,distance-disk.radiusM),upper:distance+disk.radiusM};
       });
       const nearestUpper=geometry.reduce((v,c)=>Math.min(v,c.upper),Infinity),possible=[];
       for(const g of geometry){
        if(g.lower>nearestUpper+1e-7)continue;
        const {segment:{a,b,curve},dx,dy,length,raw,lower,upper}=g,
          axisRange=projectedHullAxisRange(disk.projectedHull,dx/length,dy/length),origin=(a.xM*dx+a.yM*dy)/length,
          rawMin=axisRange?Math.max(raw-disk.radiusM/length,(axisRange[0]-origin)/length):raw-disk.radiusM/length,
          rawMax=axisRange?Math.min(raw+disk.radiusM/length,(axisRange[1]-origin)/length):raw+disk.radiusM/length,
          t0=Math.max(0,Math.min(1,rawMin)),t1=Math.max(0,Math.min(1,rawMax)),
          lateral=(-(disk.xM-a.xM)*dy+(disk.yM-a.yM)*dx)/length,
          clampLateral=v=>Math.max(-road.halfWidthM,Math.min(road.halfWidthM,v)),
          cross=roadCrossSectionOffsetInterval(road.crossSection,[a.distanceM+(b.distanceM-a.distanceM)*t0,a.distanceM+(b.distanceM-a.distanceM)*t1],[clampLateral(lateral-disk.radiusM),clampLateral(lateral+disk.radiusM)]),h=curve.interval(t0,t1),target=[h[0]+cross[0],h[1]+cross[1]],
          maxDelta=Math.max(Math.abs(target[0]-base[1]),Math.abs(target[1]-base[0])),
          reach=road.halfWidthM+1.5*maxDelta/Math.min(settings.cutBatterSlope,settings.fillBatterSlope),
          // Endpoint labels only apply where the projected station can reach
          // that endpoint. A ramp's far bridge endpoint must not make every
          // interior observation possibly suspended above unchanged ground.
          kinds=[...(t0===0?[a.structureKind]:[]),...(t1===1?[b.structureKind]:[]),...(t1>0&&t0<1?[a.segmentKind??(a.structureKind==='bridge-deck'&&b.structureKind==='bridge-deck'?'bridge-deck':'at-grade')]:[])],
          isDeck=kinds.every(kind=>kind==='bridge-deck'),
          blend=boundBatterBlend(base,target,[Math.max(0,lower-road.halfWidthM),Math.max(0,upper-road.halfWidthM)],settings),
          candidate={lower,upper,target,blend,reach,halfWidthM:road.halfWidthM,isDeck,alwaysGround:kinds.every(kind=>kind!=='bridge-deck')};
        // If this segment can only choose a shared endpoint, a neighbour
        // whose projection goes strictly into its span is strictly nearer.
        // Use directional hulls, not the enclosing disk, to prove this.
        if(axisRange && rawMax<0 && g.index>0){
          const previous=road.segments[g.index-1],axis=projectedHullAxisRange(disk.projectedHull,previous.dx/previous.length,previous.dy/previous.length),
            endpoint=(a.xM*previous.dx+a.yM*previous.dy)/previous.length;
          if(axis[1]<endpoint)continue;
        }
        if(axisRange && rawMin>1 && g.index+1<road.segments.length){
          const next=road.segments[g.index+1],axis=projectedHullAxisRange(disk.projectedHull,next.dx/next.length,next.dy/next.length),
            endpoint=(b.xM*next.dx+b.yM*next.dy)/next.length;
          if(axis[0]>endpoint)continue;
        }
        possible.push(candidate);
       }
       fullyCovered ||= nearestUpper<road.halfWidthM-1e-7&&possible.every(c=>c.alwaysGround);
       covered ||= possible.length>0&&possible.every(c=>c.alwaysGround&&c.blend.minimumInfluence>0);
       if(possible.length&&possible.every(c=>c.alwaysGround))guaranteedInfluence=Math.max(guaranteedInfluence,Math.min(...possible.map(c=>c.blend.minimumInfluence)));
       const groundCandidates=possible.filter(c=>!c.isDeck);
       if(groundCandidates.length) roadIntervals.push({
         minimumInfluence:possible.every(c=>c.alwaysGround)?Math.min(...possible.map(c=>c.blend.minimumInfluence)):0,
         maximumInfluence:Math.max(...groundCandidates.map(c=>c.blend.maximumInfluence)),
         range:[Math.min(...groundCandidates.map(c=>c.blend.range[0])),Math.max(...groundCandidates.map(c=>c.blend.range[1]))]});
       candidates.push(...possible.filter(c=>!c.isDeck&&c.lower<=c.reach+1e-7));
      }
      // At least one always-ground road covers every point. Its full influence
      // wins over all batters, even if the nearest segment changes at a joint.
      // The canonical sampler chooses maximum influence, not the union of
      // every road's possible height. Discard only provably weaker candidates.
      if(settings.blendPolicy && !fullyCovered) {
        const result=boundBlendedBatters(roadIntervals,base),slack=1e-8*Math.max(1,...result.map(Math.abs));
        return [result[0]-slack,result[1]+slack];
      }
      const competitive=candidates.filter(c=>c.blend.maximumInfluence>=guaranteedInfluence-1e-12);
      const possible=fullyCovered?competitive.filter(c=>c.lower<=c.halfWidthM+1e-7):competitive;
      targets=possible.reduce(([lo,hi],c)=>{const range=fullyCovered?c.target:c.blend.range;return[Math.min(lo,range[0]),Math.max(hi,range[1])];},[Infinity,-Infinity]);
    }
    const low=covered?targets[0]:Math.min(base[0],targets[0]),high=covered?targets[1]:Math.max(base[1],targets[1]),slack=1e-8*Math.max(1,Math.abs(low),Math.abs(high));
    return[low-slack,high+slack];
  }
  const adapter = { ...terrain, roadAdjustmentId, groundElevationAt, boundGroundElevation, sampleAt, surfaceFrameAt, roadSurfaceAt,
    // This is an overlay recipe, never an unchanged canonical snapshot. Rebuild
    // it with createRoadAdjustedTerrain after restoring the base separately.
    toSnapshot: () => {
      if (!terrain.toSnapshot) throw new TypeError('Base terrain does not support snapshots');
      return { schema: 'minimal-world-road-adjusted-terrain@1', baseTerrain: terrain.toSnapshot(),
        roadCenterlineProfiles: copyJson(profiles), options: { ...settings }, roadAdjustmentId };
    } };
  if (terrain.sampleWindow) adapter.sampleWindow = options => {
    const window = terrain.sampleWindow(options);
    return { ...window, roadAdjustmentId, samples: window.samples.map(p => sampleAt(p.xM, p.yM)) };
  };
  adapter.traceSurfaceSegment = (a, b, { maxStepM = 2, maxSamples = MAX_TRACE_SAMPLES } = {}) => {
    finite(a?.xM, 'start.xM'); finite(a?.yM, 'start.yM'); finite(b?.xM, 'end.xM'); finite(b?.yM, 'end.yM');
    const plan = surfaceTracePlan(a, b, maxStepM, maxSamples);
    if (terrain.traceSurfaceSegment && plan.lengthM > 0) {
      for (const p of terrain.traceSurfaceSegment(a, b, { maxStepM, maxSamples }).samples) plan.marks.add(p.distanceM / plan.lengthM);
    }
    return completeSurfaceTrace(plan, { worldId: terrain.worldId, regionId: terrain.regionId,
      maxStepM, maxSamples, sampleAt, precision: 'source terrain events and bounded probes; road earthwork extrema are not certified' });
  };
  return Object.freeze(adapter);
}
