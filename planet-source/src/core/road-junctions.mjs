import { roadCrossSectionAt, mergeFlatRoadIntervals, roadCrossSectionOffsetBound } from './road-cross-section.mjs';
import { finiteNumber as finite, positiveNumber as positive, nonEmptyText as text } from './contract-validation.mjs';
import { copyJson, hashJson } from './json-contract.mjs';
import { metricRoads, roadIntersections, verticalCurve, nonnegative, freezeOwned, DEFAULT_DECK_THICKNESS_M } from './road-geometry.mjs';
import { createRoadAdjustedTerrain } from './road-earthwork.mjs';
import { unitNormalForGradient, fixedStencilCurvature } from './surface-derivatives.mjs';
import { surfaceTracePlan, completeSurfaceTrace, MAX_TRACE_SAMPLES } from './surface-trace.mjs';
import { restoreTerrain } from './index.mjs';

export const JUNCTION_TERRAIN_SCHEMA = 'minimal-world-junction-adjusted-terrain@1';
export const ROAD_CROSSING_STATUSES = Object.freeze(['at-grade-matched',
  'grade-separated-clearance-met', 'insufficient-vertical-clearance', 'collision']);
export const ROAD_GRADE_SEPARATION_DEFAULTS = Object.freeze({
  requiredVehicleClearanceM: 4.5, atGradeToleranceM: 1e-7, deckThicknessM: DEFAULT_DECK_THICKNESS_M,
});

/** Shared classification for core diagnostics and UI records. Null geometry is
 * unknown; it must not become an at-grade success. At-grade eligibility excludes decks. */
export function classifyRoadGradeSeparation({ verticalSeparationM = null, verticalClearanceM = null,
  deckThicknessM = ROAD_GRADE_SEPARATION_DEFAULTS.deckThicknessM,
  requiredVehicleClearanceM = ROAD_GRADE_SEPARATION_DEFAULTS.requiredVehicleClearanceM,
  atGradeToleranceM = ROAD_GRADE_SEPARATION_DEFAULTS.atGradeToleranceM,
  atGradeEligible = true } = {}) {
  nonnegative(deckThicknessM, 'deckThicknessM');
  nonnegative(requiredVehicleClearanceM, 'requiredVehicleClearanceM');
  nonnegative(atGradeToleranceM, 'atGradeToleranceM');
  if (verticalSeparationM != null) finite(verticalSeparationM, 'verticalSeparationM');
  if (verticalClearanceM != null) finite(verticalClearanceM, 'verticalClearanceM');
  if (verticalSeparationM != null && Math.abs(verticalSeparationM) <= atGradeToleranceM && atGradeEligible) return 'at-grade-matched';
  const clearance = verticalClearanceM ?? (verticalSeparationM == null ? null : Math.abs(verticalSeparationM) - deckThicknessM);
  if (clearance == null) return null;
  return clearance <= 0 ? 'collision' : clearance >= requiredVehicleClearanceM
    ? 'grade-separated-clearance-met' : 'insufficient-vertical-clearance';
}
const supported = (route, station) => route.at(station).structureKind !== 'bridge-deck' && route.road.gradeSeparated !== true;

/** Exact centerline crossings, including common endpoints. Bridge decks are
 * excluded from at-grade design. Ambiguous collinear overlaps are rejected. */
export function designRoadJunctions(roads, options = {}) {
  const routes = metricRoads(roads);
  const maxSlope = positive(options.maxSlope ?? options.maxGradeSlope ?? options.maxApproachSlope ?? 0.08, 'maxSlope');
  const radius = options.plateauRadiusM == null ? null : positive(options.plateauRadiusM, 'plateauRadiusM');
  if (options.junctionElevationM != null) finite(options.junctionElevationM, 'junctionElevationM');
  const groups = [];
  for (const crossing of roadIntersections(routes)) {
    const { first, second, stationA, stationB, xM, yM, sinAngle } = crossing;
    if (!supported(first, stationA) || !supported(second, stationB)) continue;
    let group = groups.find(g => Math.hypot(g.xM - xM, g.yM - yM) <= 1e-7);
    if (!group) { group = { xM, yM, members: new Map(), radiusM: 0 }; groups.push(group); }
    for (const [route, station] of [[first, stationA], [second, stationB]]) {
      const prior = group.members.get(route.id);
      if (prior && Math.abs(prior.distanceM - station) > 1e-7) throw new RangeError('Self-returning road junction requires explicit alignment');
      group.members.set(route.id, { roadId: route.id, distanceM: station, roadElevationM: route.at(station).roadElevationM });
    }
    const cosine = Math.sqrt(Math.max(0, 1 - sinAngle * sinAngle));
    const requiredRadius = sinAngle === 0 ? Math.max(first.halfWidthM, second.halfWidthM)
      : Math.max(first.halfWidthM + second.halfWidthM * cosine, second.halfWidthM + first.halfWidthM * cosine) / sinAngle;
    if (radius !== null && radius < requiredRadius) throw new RangeError('Junction plateau is too short for overlapping carriageways');
    group.radiusM = Math.max(group.radiusM, finite(radius ?? requiredRadius, 'plateau radius'));
  }
  const junctions = groups.map((g, i) => {
    const members = [...g.members.values()].sort((a, b) => a.roadId < b.roadId ? -1 : 1);
    const roadElevationM = options.junctionElevationM ?? finite(members.reduce((sum, p) => sum + p.roadElevationM / members.length, 0), 'junction elevation');
    return { junctionId: `junction:${i}`, kind: 'at-grade', status: 'at-grade-matched', xM: g.xM, yM: g.yM, roadElevationM,
      plateauRadiusM: g.radiusM, roadIds: members.map(p => p.roadId), members };
  });
  const adjusted = routes.map(route => {
    const limit = Math.min(maxSlope, positive(route.road.maxSlope ?? route.road.maxGradeSlope ?? maxSlope, 'road.maxSlope'));
    const plateaus = junctions.filter(j => j.roadIds.includes(route.id)).map(j => {
      const station = j.members.find(p => p.roadId === route.id).distanceM;
      return { start: Math.max(0, station - j.plateauRadiusM), end: Math.min(route.lengthM, station + j.plateauRadiusM), z: j.roadElevationM };
    }).sort((a, b) => a.start - b.start);
    const merged = [];
    for (const p of plateaus) {
      const last = merged.at(-1);
      if (last && p.start <= last.end) {
        if (p.z !== last.z) throw new RangeError('Overlapping junction plateaus have incompatible levels');
        last.end = Math.max(last.end, p.end);
      } else merged.push({ ...p });
    }
    const curves = [];
    const anchor = (station, z, grade = 0) => ({ ...route.at(station), roadElevationM: z, gradeSlope: grade });
    const add = (a, b) => {
      if (a.distanceM === b.distanceM) {
        if (a.roadElevationM !== b.roadElevationM) throw new RangeError('Insufficient road length for junction approach');
        return;
      }
      const curve = verticalCurve(a, b);
      if (curve.maxGradeSlope > limit * (1 + 1e-10)) throw new RangeError('Junction approach exceeds slope limit; insufficient road length');
      curves.push({ a, b, curve });
    };
    function ramp(station, z, direction, available) {
      if (available <= 0) return null;
      let length = Math.min(available, Math.max(1, 1.5 * Math.abs(route.at(station).roadElevationM - z) / limit));
      for (let attempt = 0; attempt < 128; attempt++) {
        const tie = route.at(Math.max(0, Math.min(route.lengthM, station + direction * length)));
        const flat = anchor(station, z), a = direction < 0 ? tie : flat, b = direction < 0 ? flat : tie;
        if (verticalCurve(a, b).maxGradeSlope <= limit * (1 + 1e-10)) return { a, b };
        if (length === available) return null;
        length = Math.min(available, length * 1.25);
      }
      return null;
    }
    for (const p of merged) add(anchor(p.start, p.z), anchor(p.end, p.z));
    for (let i = 0; i <= merged.length && merged.length; i++) {
      const before = merged[i - 1], after = merged[i];
      const start = before?.end ?? 0, end = after?.start ?? route.lengthM, gap = end - start;
      if (gap <= 0) continue;
      const left = before ? ramp(start, before.z, 1, after ? gap / 2 : gap) : null;
      const right = after ? ramp(end, after.z, -1, before ? gap / 2 : gap) : null;
      if ((before && !left) || (after && !right)) {
        add(before ? anchor(start, before.z) : route.at(start), after ? anchor(end, after.z) : route.at(end));
      } else { if (left) add(left.a, left.b); if (right) add(right.a, right.b); }
    }
    // An at-grade junction must not drag a remote bridge deck onto its
    // approach curve. Check the cubic difference over every overlap (four
    // samples determine a cubic), not just the intersection point itself.
    for(const section of curves)for(const segment of route.segments){
      if(route.at((segment.a.distanceM+segment.b.distanceM)/2).structureKind!=='bridge-deck')continue;
      const lo=Math.max(section.a.distanceM,segment.a.distanceM),hi=Math.min(section.b.distanceM,segment.b.distanceM);
      if(hi<=lo)continue;
      for(const t of[0,1/3,2/3,1]){const d=lo+(hi-lo)*t;if(Math.abs(section.curve.at(d).roadElevationM-segment.curve.at(d).roadElevationM)>1e-8)throw new RangeError('Junction approach alters an existing bridge span');}
    }
    curves.sort((a, b) => a.a.distanceM - b.a.distanceM);
    const stations = new Set(route.points.map(p => p.distanceM));
    for (const { a, b } of curves) { stations.add(a.distanceM); stations.add(b.distanceM); }
    for (const j of junctions) for (const m of j.members) if (m.roadId === route.id) stations.add(m.distanceM);
    // Intersections on a stored station can differ by a few floating-point
    // ulps after projection. They must not create zero-length geometric edges.
    const stationTolerance=32*Number.EPSILON*Math.max(1,route.lengthM);
    const uniqueStations=[...stations].sort((a,b)=>a-b).filter((value,i,all)=>i===0||value-all[i-1]>stationTolerance);
    const points = uniqueStations.map(distanceM => {
      const baseline = route.at(distanceM), section = curves.find(c => distanceM >= c.a.distanceM && distanceM <= c.b.distanceM);
      return { ...baseline, ...(section ? section.curve.at(distanceM) : {}), roadId: route.id, halfWidthM: route.halfWidthM };
    });
    if (merged.length) for (let i = 1; i < points.length; i++) {
      if (verticalCurve(points[i - 1], points[i]).maxGradeSlope > limit * (1 + 1e-10)) throw new RangeError('Road profile exceeds junction slope limit');
    }
    return { ...copyJson(route.road), id: route.id, roadId: route.id, halfWidthM: route.halfWidthM,
      maxSlope: limit, points, samples: points, ...(route.road.crossSection?{crossSection:{...copyJson(route.road.crossSection),flatIntervals:mergeFlatRoadIntervals([...route.road.crossSection.flatIntervals,...merged.map(p=>({startM:p.start,endM:p.end}))],route.lengthM)}}:{}) };
  });
  return freezeOwned({ junctions, roads: adjusted });
}

export function inspectRoadGradeSeparations(roads, options = {}) {
  const routes = metricRoads(roads);
  const requiredVehicleClearanceM = nonnegative(options.requiredVehicleClearanceM ?? ROAD_GRADE_SEPARATION_DEFAULTS.requiredVehicleClearanceM, 'requiredVehicleClearanceM');
  const tolerance = nonnegative(options.atGradeToleranceM ?? ROAD_GRADE_SEPARATION_DEFAULTS.atGradeToleranceM, 'atGradeToleranceM');
  const thickness = options.deckThicknessM == null ? null : nonnegative(options.deckThicknessM, 'deckThicknessM');
  const crossings = roadIntersections(routes).map((c, i) => {
    const a = c.first.at(c.stationA), b = c.second.at(c.stationB);
    const aUpper = a.roadElevationM >= b.roadElevationM, upper = aUpper ? a : b, lower = aUpper ? b : a;
    const deckThicknessM = thickness ?? upper.deckThicknessM;
    const verticalClearanceM = finite(upper.roadElevationM - deckThicknessM - lower.roadElevationM, 'verticalClearanceM');
    const matched = Math.abs(a.roadElevationM - b.roadElevationM) <= tolerance && supported(c.first, c.stationA) && supported(c.second, c.stationB);
    const status = classifyRoadGradeSeparation({ verticalSeparationM: a.roadElevationM - b.roadElevationM,
      verticalClearanceM, deckThicknessM, requiredVehicleClearanceM, atGradeToleranceM: tolerance,
      atGradeEligible: supported(c.first, c.stationA) && supported(c.second, c.stationB) });
    return { crossingId: `road-crossing:${i}`, xM: c.xM, yM: c.yM, roadIds: [c.first.id, c.second.id],
      stations: [{ roadId: c.first.id, distanceM: c.stationA, roadElevationM: a.roadElevationM },
        { roadId: c.second.id, distanceM: c.stationB, roadElevationM: b.roadElevationM }],
      upperRoadId: aUpper ? c.first.id : c.second.id, lowerRoadId: aUpper ? c.second.id : c.first.id,
      kind: matched ? 'at-grade' : 'grade-separated', upperRoadElevationM: upper.roadElevationM, lowerRoadElevationM: lower.roadElevationM,
      stationsM: { [c.first.id]: c.stationA, [c.second.id]: c.stationB },
      deckThicknessM, verticalClearanceM, clearanceM: verticalClearanceM,
      requiredVehicleClearanceM, requiredClearanceM: requiredVehicleClearanceM, status };
  });
  return freezeOwned({ crossings, roadCount: routes.length });
}

/** Continuous weighted union of road platforms and smooth batters. Junction
 * profiles must already share the designed plateau. No fill beneath decks. */
export function createJunctionAdjustedTerrain(baseTerrain, { junctions = [], roads = [], batterSlopeMPerM = 0.5 } = {}) {
  const slope = positive(batterSlopeMPerM, 'batterSlopeMPerM'), routes = metricRoads(roads);
  if (!Array.isArray(junctions) || junctions.length > 4096) throw new RangeError('Invalid junction collection');
  const owned = copyJson(junctions);
  const junctionIds = new Set();
  for (const j of owned) {
    text(j.junctionId, 'junctionId'); finite(j.xM, 'junction.xM'); finite(j.yM, 'junction.yM'); finite(j.roadElevationM, 'junction.roadElevationM');
    if (junctionIds.has(j.junctionId)) throw new RangeError('Duplicate junction ID'); junctionIds.add(j.junctionId);
    positive(j.plateauRadiusM, 'plateauRadiusM');
    if (!Array.isArray(j.members) || j.members.length < 2) throw new RangeError('Junction needs multiple road members');
    const memberIds = j.members.map(m => m.roadId);
    if (new Set(memberIds).size !== memberIds.length || !Array.isArray(j.roadIds)
      || j.roadIds.length !== memberIds.length || j.roadIds.some(id => !memberIds.includes(id))
      || memberIds.some(id => !j.roadIds.includes(id))) throw new RangeError('Inconsistent junction road membership');
    for (const m of j.members) {
      const route = routes.find(r => r.id === m.roadId);
      if (!route) throw new RangeError('Unknown junction road');
      const p = route.at(m.distanceM);
      if(roadCrossSectionOffsetBound(route.road.crossSection,route.halfWidthM,Math.max(0,m.distanceM-j.plateauRadiusM),Math.min(route.lengthM,m.distanceM+j.plateauRadiusM))>1e-10)throw new RangeError('Junction cross section must be flat across its plateau');
      if (Math.hypot(p.xM - j.xM, p.yM - j.yM) > 1e-6 || p.roadElevationM !== j.roadElevationM || p.gradeSlope !== 0) throw new RangeError('Junction roads must match plateau level and grade');
    }
  }
  for (const route of routes) if (route.road.maxSlope != null) {
    const limit = positive(route.road.maxSlope, 'road.maxSlope');
    for (const s of route.segments) if (s.curve.maxGradeSlope > limit * (1 + 1e-10)) throw new RangeError('Junction road exceeds slope limit');
  }
  const profiles = routes.map(r => ({ roadId: r.id, halfWidthM: r.halfWidthM, ...(r.road.crossSection?{crossSection:r.road.crossSection}:{}), samples: r.points.map(p => ({ ...p,
    structureKind: p.structureKind ?? r.road.structureKind ?? 'at-grade' })) }));
  const overlay = createRoadAdjustedTerrain(baseTerrain, profiles, { batterSlope: slope });
  const recipeRoads = copyJson(roads), junctionAdjustmentId = hashJson({ junctions: owned, roads: recipeRoads, batterSlopeMPerM: slope, sourceWorldId: baseTerrain.worldId ?? null });
  function adjustedGround(xM, yM) {
    const base = baseTerrain.groundElevationAt(finite(xM, 'xM'), finite(yM, 'yM'));
    let weight = 0, deltaSum = 0, remaining = 1;
    const platforms = [];
    for (const route of routes) {
      let closest = null;
      for (const { a, b, curve } of route.segments) {
        const dx = b.xM - a.xM, dy = b.yM - a.yM, length = b.distanceM - a.distanceM;
        const t = Math.max(0, Math.min(1, ((xM - a.xM) * (dx / length) + (yM - a.yM) * (dy / length)) / length));
        const distance = Math.hypot(xM - (a.xM + t * dx), yM - (a.yM + t * dy));
        if (!closest || distance < closest.distance) {
          const station = a.distanceM + t * length;
          const lateral=Math.max(-route.halfWidthM,Math.min(route.halfWidthM,(-(xM-a.xM-t*dx)*dy+(yM-a.yM-t*dy)*dx)/length));
          closest = { distance, z: curve.at(station).roadElevationM+(route.road.crossSection?roadCrossSectionAt(route.road.crossSection,station,lateral).offsetM:0), kind: route.at(station).structureKind };
        }
      }
      if (closest.kind === 'bridge-deck') continue;
      const delta = closest.z - base, width = finite(1.5 * Math.abs(delta) / slope, 'batter width');
      const offset = Math.max(0, closest.distance - route.halfWidthM);
      if (offset > 0 && offset >= width) continue;
      const t = offset === 0 ? 0 : offset / width, influence = 1 - t * t * (3 - 2 * t);
      if (influence === 1) { platforms.push(closest.z); continue; }
      // Weights diverge smoothly at a full platform. Thus adjacent batters
      // cannot alter a carriageway, while overlapping batters stay continuous.
      const blendWeight = (influence / (1 - influence)) ** 2;
      weight += blendWeight; deltaSum += blendWeight * delta; remaining *= 1 - influence;
    }
    if (platforms.length) return { applied: true, elevation: platforms.every(z => z === platforms[0]) ? platforms[0]
      : finite(platforms.reduce((sum, z) => sum + z / platforms.length, 0), 'joint platform elevation') };
    return { applied: weight > 0, elevation: weight === 0 ? base : finite(base + deltaSum / weight * (1 - remaining), 'joint earthwork elevation') };
  }
  function groundElevationAt(xM, yM) {
    return adjustedGround(xM, yM).elevation;
  }
  function sampleAt(xM, yM) {
    const base = baseTerrain.sampleAt(xM, yM), adjustment = adjustedGround(xM, yM), z = adjustment.elevation;
    if (!adjustment.applied) return base;
    const b = baseTerrain.bounds, h = 0.1;
    const left = Math.max(b?.minXM ?? -Infinity, xM - h), right = Math.min(b?.maxXM ?? Infinity, xM + h);
    const bottom = Math.max(b?.minYM ?? -Infinity, yM - h), top = Math.min(b?.maxYM ?? Infinity, yM + h);
    const gradient = { x: finite((groundElevationAt(right, yM) - groundElevationAt(left, yM)) / (right - left), 'gradient.x'),
      y: finite((groundElevationAt(xM, top) - groundElevationAt(xM, bottom)) / (top - bottom), 'gradient.y') };
    const water = base.waterLevelElevationM ?? base.waterSurfaceElevationM ?? null;
    const waterDepthM = water === null ? base.waterDepthM == null ? null : 0 : Math.max(0, water - z);
    return { ...base, junctionAdjustmentId, groundElevationM: z, gradient, slopeMPerM: Math.hypot(gradient.x, gradient.y), waterDepthM,
      waterSurfaceElevationM: waterDepthM > 0 ? water : null, surfaceKind: waterDepthM === null ? 'unresolved' : waterDepthM > 0 ? 'water' : 'ground',
      ...(base.waterSourceIds && waterDepthM === 0 ? { waterSourceIds: [] } : {}) };
  }
  const adapter = { ...overlay, junctionAdjustmentId, groundElevationAt, sampleAt,
    surfaceFrameAt(xM, yM) {
      const p = sampleAt(xM, yM), b = baseTerrain.bounds, edge = b && (xM - 0.1 < b.minXM || xM + 0.1 > b.maxXM || yM - 0.1 < b.minYM || yM + 0.1 > b.maxYM);
      if (p.junctionAdjustmentId !== junctionAdjustmentId && baseTerrain.surfaceFrameAt) return baseTerrain.surfaceFrameAt(xM, yM);
      return { ...p, normal: unitNormalForGradient(p.gradient), curvature: edge ? null : fixedStencilCurvature(groundElevationAt, xM, yM, p.groundElevationM, p.gradient, 0.1),
        curvatureStatus: edge ? 'unavailable-at-region-edge' : 'fixed-distance-estimate' };
    },
    toSnapshot() { return { schema: JUNCTION_TERRAIN_SCHEMA, baseTerrain: baseTerrain.toSnapshot(), junctions: copyJson(owned),
      roads: copyJson(recipeRoads), batterSlopeMPerM: slope, junctionAdjustmentId }; },
    traceSurfaceSegment(a, b, { maxStepM = 2, maxSamples = MAX_TRACE_SAMPLES } = {}) {
      const plan = surfaceTracePlan(a, b, maxStepM, maxSamples);
      if (baseTerrain.traceSurfaceSegment && plan.lengthM > 0) for (const p of baseTerrain.traceSurfaceSegment(a, b, { maxStepM, maxSamples }).samples) plan.marks.add(p.distanceM / plan.lengthM);
      return completeSurfaceTrace(plan, { worldId: baseTerrain.worldId, maxStepM, maxSamples, sampleAt,
        precision: 'source events and bounded probes; joint batter extrema are not certified' });
    } };
  if (baseTerrain.sampleWindow) adapter.sampleWindow = options => {
    const window = baseTerrain.sampleWindow(options);
    return { ...window, junctionAdjustmentId, samples: window.samples.map(p => sampleAt(p.xM, p.yM)) };
  };
  return Object.freeze(adapter);
}

export function restoreJunctionAdjustedTerrain(serialized, restoreBaseTerrain = restoreTerrain) {
  const snapshot = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (snapshot?.schema !== JUNCTION_TERRAIN_SCHEMA) throw new TypeError('Unsupported junction terrain schema');
  if (typeof restoreBaseTerrain !== 'function') throw new TypeError('restoreBaseTerrain must be a function');
  const result = createJunctionAdjustedTerrain(restoreBaseTerrain(snapshot.baseTerrain), snapshot);
  if (snapshot.junctionAdjustmentId !== result.junctionAdjustmentId) throw new RangeError('Junction recipe identity mismatch');
  return result;
}
