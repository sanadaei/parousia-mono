import {boundBatterBlend} from './earthwork-bounds.mjs';
import { finiteNumber as finite, positiveNumber as positive, nonEmptyText as text,
  integerDimension, validateElevationInterval, validateMetricDisk } from './contract-validation.mjs';
import { copyJson, hashJson } from './json-contract.mjs';
import { unitNormalForGradient, fixedStencilCurvature } from './surface-derivatives.mjs';
import { surfaceTracePlan, completeSurfaceTrace, MAX_TRACE_SAMPLES } from './surface-trace.mjs';

const PAD_SCHEMA = 'minimal-world-building-pad@1';
const nonnegative = (v, name) => {
  finite(v, name);
  if (v < 0) throw new RangeError(`${name} must be nonnegative`);
  return v;
};
function freezeOwned(v) {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freezeOwned);
    Object.freeze(v);
  }
  return v;
}
function checkTerrain(terrain) {
  if (typeof terrain?.sampleAt !== 'function' || typeof terrain.groundElevationAt !== 'function') {
    throw new TypeError('Terrain needs sampleAt and groundElevationAt');
  }
  if (terrain.frame?.kind === 'sphere-geographic') throw new TypeError('Building pads require a metric terrain view');
}
const cross = (a, b, c) => finite((b.xM - a.xM) * (c.yM - a.yM)
  - (b.yM - a.yM) * (c.xM - a.xM), 'polygon cross product');
const samePoint = (a, b) => a.xM === b.xM && a.yM === b.yM;
function onSegment(p, a, b) {
  return cross(a, b, p) === 0 && p.xM >= Math.min(a.xM, b.xM) && p.xM <= Math.max(a.xM, b.xM)
    && p.yM >= Math.min(a.yM, b.yM) && p.yM <= Math.max(a.yM, b.yM);
}
function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (Math.sign(abC) * Math.sign(abD) < 0 && Math.sign(cdA) * Math.sign(cdB) < 0)
    || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}
function footprint(building, options = {}) {
  if (!building || typeof building !== 'object') throw new TypeError('Building needs a polygon or bounds');
  let raw = building.polygon;
  if (raw == null) {
    let b = building.bounds;
    if (b == null) {
      const x = finite(building.xM, 'building.xM'), y = finite(building.yM, 'building.yM');
      const width = positive(options.widthM ?? building.widthM, 'building.widthM');
      const depth = positive(options.depthM ?? building.depthM ?? width, 'building.depthM');
      b = { minXM: x - width / 2, maxXM: x + width / 2, minYM: y - depth / 2, maxYM: y + depth / 2 };
    }
    for (const key of ['minXM', 'minYM', 'maxXM', 'maxYM']) finite(b[key], `building.bounds.${key}`);
    if (b.maxXM <= b.minXM || b.maxYM <= b.minYM) throw new RangeError('Building bounds need positive area');
    raw = [{ xM: b.minXM, yM: b.minYM }, { xM: b.maxXM, yM: b.minYM },
      { xM: b.maxXM, yM: b.maxYM }, { xM: b.minXM, yM: b.maxYM }];
  }
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 257) throw new RangeError('Polygon needs 3..256 vertices (optional closing vertex)');
  let polygon = raw.map(p => ({ xM: finite(Array.isArray(p) ? p[0] : p?.xM, 'polygon.xM'),
    yM: finite(Array.isArray(p) ? p[1] : p?.yM, 'polygon.yM') }));
  if (samePoint(polygon[0], polygon.at(-1))) polygon.pop();
  if (polygon.length < 3 || polygon.length > 256) throw new RangeError('Polygon needs 3..256 vertices');
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (samePoint(a, b)) throw new RangeError('Polygon has a zero-length edge');
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (intersects(a, b, polygon[j], polygon[(j + 1) % polygon.length])) throw new RangeError('Polygon must be simple; intersecting edges');
    }
  }
  // Remove redundant collinear vertices, but reject adjacent backtracking edges.
  for (let i = 0; i < polygon.length && polygon.length > 3;) {
    const a = polygon[(i + polygon.length - 1) % polygon.length], b = polygon[i], c = polygon[(i + 1) % polygon.length];
    if (cross(a, b, c) === 0) {
      if (!onSegment(b, a, c)) throw new RangeError('Polygon has overlapping adjacent edges');
      polygon.splice(i, 1); i = 0;
    } else i++;
  }
  const signedArea = finite(polygon.slice(1, -1).reduce((sum, p, i) => sum + cross(polygon[0], p, polygon[i + 2]) / 2, 0), 'polygon area');
  positive(Math.abs(signedArea), 'polygon area');
  if (signedArea < 0) polygon.reverse();
  let first = 0;
  for (let i = 1; i < polygon.length; i++) if (polygon[i].xM < polygon[first].xM
    || (polygon[i].xM === polygon[first].xM && polygon[i].yM < polygon[first].yM)) first = i;
  polygon = [...polygon.slice(first), ...polygon.slice(0, first)];
  const bounds = { minXM: Math.min(...polygon.map(p => p.xM)), maxXM: Math.max(...polygon.map(p => p.xM)),
    minYM: Math.min(...polygon.map(p => p.yM)), maxYM: Math.max(...polygon.map(p => p.yM)) };
  return { polygon, bounds, areaM2: Math.abs(signedArea) };
}
function triangulate(polygon) {
  const remaining = [...polygon], triangles = [];
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length], b = remaining[i], c = remaining[(i + 1) % remaining.length];
      if (cross(a, b, c) <= 0) continue;
      if (remaining.some(p => p !== a && p !== b && p !== c
        && cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0)) continue;
      triangles.push([a, b, c]); remaining.splice(i, 1); found = true; break;
    }
    if (!found) throw new RangeError('Polygon cannot be triangulated');
  }
  positive(cross(...remaining), 'triangle area');
  triangles.push(remaining);
  return triangles;
}
function polygonLocation(polygon, xM, yM) {
  let inside = false, distanceM = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.xM - a.xM, dy = b.yM - a.yM;
    const t = Math.max(0, Math.min(1, ((xM - a.xM) * dx + (yM - a.yM) * dy) / (dx * dx + dy * dy)));
    const distance = Math.hypot(xM - (a.xM + t * dx), yM - (a.yM + t * dy));
    distanceM = Math.min(distanceM, distance);
    if ((a.yM > yM) !== (b.yM > yM) && xM < a.xM + (yM - a.yM) / dy * dx) inside = !inside;
    if (onSegment({ xM, yM }, a, b)) return { inside: true, distanceM: 0 };
  }
  return { inside, distanceM: inside ? 0 : distanceM };
}
function slopes(options) {
  return { cutBatterSlope: positive(options.cutBatterSlope ?? options.batterSlope ?? 0.5, 'cutBatterSlope'),
    fillBatterSlope: positive(options.fillBatterSlope ?? options.batterSlope ?? 0.5, 'fillBatterSlope'),
    batterWidthM: positive(options.batterWidthM ?? 1, 'batterWidthM') };
}
function batterWidth(delta, settings) {
  // A positive minimum transition width prevents an abrupt grade change where
  // sloping natural ground equals the pad elevation at its perimeter. Hypot
  // combines it smoothly with the slope-derived width, without a max() kink.
  return finite(Math.hypot(settings.batterWidthM, finite(1.5 * Math.abs(delta)
    / (delta > 0 ? settings.fillBatterSlope : settings.cutBatterSlope), 'slope-derived batter width')), 'batter width');
}
/** Shared conservative footprint clearance for default rectangular pads. */
export function buildingPadAffectsPoint(pad,xM,yM,baseElevationM){
 const b=pad.bounds,dx=Math.max(b.minXM-xM,0,xM-b.maxXM),dy=Math.max(b.minYM-yM,0,yM-b.maxYM);return Math.hypot(dx,dy)<batterWidth(pad.targetPadElevationM-baseElevationM,slopes(pad));
}
function identityFields(terrain) {
  return { ...(terrain.worldId ? { worldId: terrain.worldId } : {}),
    ...(terrain.regionId ? { regionId: terrain.regionId } : {}),
    ...(terrain.roadAdjustmentId ? { sourceRoadAdjustmentId: terrain.roadAdjustmentId } : {}),
    ...(terrain.buildingPadAdjustmentId ? { sourceBuildingPadAdjustmentId: terrain.buildingPadAdjustmentId } : {}) };
}
function checkIdentity(pad, terrain) {
  for (const [key, source] of [['worldId', 'worldId'], ['regionId', 'regionId'],
    ['sourceRoadAdjustmentId', 'roadAdjustmentId'], ['sourceBuildingPadAdjustmentId', 'buildingPadAdjustmentId']]) {
    if (pad[key] != null && pad[key] !== terrain[source]) throw new RangeError(`Building pad ${key} must match terrain`);
  }
}

/** Design in source metric coordinates, independently of rendering windows.
 * The area-weighted median minimizes sampled cut+fill volume inside the pad.
 * Subtriangle centroid quadrature and perimeter probes are bounded by maxStepM
 * and maxSamples: volumes and water clearance are estimates, not certificates
 * of arbitrary terrain extrema. Batters use smoothstep (1.5 peak derivative);
 * batterWidthM is a minimum width (default 1m), combined by hypot with the
 * slope-derived width. batterSlope limits rise/run on flat source ground;
 * arbitrary steep natural ground can exceed it.
 * Point settlement references need an explicit widthM (depthM defaults to width).
 */
export function designBuildingPad(building, terrain, options = {}) {
  checkTerrain(terrain);
  const shape = footprint(building, options), settings = slopes(options);
  checkIdentity(building, terrain);
  const buildingId = text(building.id ?? building.buildingId ?? `pad:${hashJson(shape.polygon)}`, 'building.id');
  const maxStepM = positive(options.maxStepM ?? 2, 'maxStepM');
  const maxSamples = integerDimension(options.maxSamples ?? MAX_TRACE_SAMPLES, 'maxSamples');
  if (maxSamples > MAX_TRACE_SAMPLES) throw new RangeError('Building pad sample budget exceeds 262144');
  const clearanceM = nonnegative(options.clearanceM ?? 0.5, 'clearanceM');
  const triangles = triangulate(shape.polygon).map(points => {
    const n = Math.max(1, Math.ceil(Math.max(...points.map((p, i) => Math.hypot(p.xM - points[(i + 1) % 3].xM,
      p.yM - points[(i + 1) % 3].yM))) / maxStepM));
    return { points, n, weight: positive(cross(...points) / 2 / (n * n), 'sample area') };
  });
  const edges = shape.polygon.map((a, i) => {
    const b = shape.polygon[(i + 1) % shape.polygon.length];
    return { a, b, n: Math.max(1, Math.ceil(Math.hypot(b.xM - a.xM, b.yM - a.yM) / maxStepM)) };
  });
  const sampleCount = triangles.reduce((sum, t) => sum + t.n * t.n, 0) + edges.reduce((sum, e) => sum + e.n, 0);
  if (!Number.isSafeInteger(sampleCount) || sampleCount > maxSamples) throw new RangeError('Building pad exceeds sample budget');
  const samples = [], perimeter = [];
  let maxWaterLevelElevationM = null, unknownWaterSamples = 0;
  function probe(xM, yM) {
    const p = terrain.sampleAt(finite(xM, 'sample.xM'), finite(yM, 'sample.yM'));
    const groundElevationM = finite(p.groundElevationM, 'groundElevationM');
    const level = p.waterLevelElevationM ?? p.waterSurfaceElevationM ?? null;
    if (level !== null) maxWaterLevelElevationM = Math.max(maxWaterLevelElevationM ?? -Infinity, finite(level, 'water level'));
    else if (p.waterDepthM == null) unknownWaterSamples++;
    return { xM, yM, groundElevationM };
  }
  for (const { points: [a, b, c], n, weight } of triangles) {
    const add = (u, v) => samples.push({ ...probe(a.xM + u * (b.xM - a.xM) + v * (c.xM - a.xM),
      a.yM + u * (b.yM - a.yM) + v * (c.yM - a.yM)), areaM2: weight });
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      add((i + 1 / 3) / n, (j + 1 / 3) / n);
      if (i + j < n - 1) add((i + 2 / 3) / n, (j + 2 / 3) / n);
    }
  }
  for (const { a, b, n } of edges) for (let j = 0; j < n; j++) {
    const t = j / n;
    perimeter.push(probe(a.xM * (1 - t) + b.xM * t, a.yM * (1 - t) + b.yM * t));
  }
  const sorted = [...samples].sort((a, b) => a.groundElevationM - b.groundElevationM);
  // Compensated sums keep a half-area tie symmetric even with thousands of
  // identical, non-binary triangle weights. A median interval uses its midpoint.
  let totalArea = 0, areaError = 0;
  for (const p of sorted) {
    const weight = p.areaM2 - areaError, next = totalArea + weight;
    areaError = (next - totalArea) - weight; totalArea = next;
  }
  const halfArea = totalArea / 2, areaTolerance = 32 * Number.EPSILON * totalArea;
  let cumulative = 0, cumulativeError = 0, optimum = sorted.at(-1).groundElevationM;
  for (let i = 0; i < sorted.length; i++) {
    const weight = sorted[i].areaM2 - cumulativeError, next = cumulative + weight;
    cumulativeError = (next - cumulative) - weight; cumulative = next;
    if (cumulative >= halfArea - areaTolerance) {
      optimum = Math.abs(cumulative - halfArea) <= areaTolerance && i + 1 < sorted.length
        ? sorted[i].groundElevationM / 2 + sorted[i + 1].groundElevationM / 2 : sorted[i].groundElevationM;
      break;
    }
  }
  const explicit = options.foundationElevationM ?? options.targetPadElevationM ?? building.foundationElevationM ?? building.targetPadElevationM;
  const minimumPadElevationM = maxWaterLevelElevationM === null ? null : finite(maxWaterLevelElevationM + clearanceM, 'minimum pad elevation');
  const targetPadElevationM = explicit == null ? Math.max(optimum, minimumPadElevationM ?? -Infinity) : finite(explicit, 'foundation elevation');
  if (minimumPadElevationM !== null && targetPadElevationM < minimumPadElevationM) {
    throw new RangeError('Explicit foundation elevation violates water clearance');
  }
  let cutVolumeM3 = 0, fillVolumeM3 = 0;
  for (const p of samples) {
    const delta = targetPadElevationM - p.groundElevationM;
    cutVolumeM3 += Math.max(0, -delta) * p.areaM2; fillVolumeM3 += Math.max(0, delta) * p.areaM2;
  }
  const perimeterTransitions = perimeter.map(p => {
    const delta = finite(targetPadElevationM - p.groundElevationM, 'foundation height');
    return { ...p, structureKind: delta === 0 ? 'at-grade' : delta > 0 ? 'fill' : 'cut',
      heightM: Math.abs(delta), batterSlope: delta > 0 ? settings.fillBatterSlope : settings.cutBatterSlope,
      batterWidthM: batterWidth(delta, settings) };
  });
  return freezeOwned({ schema: PAD_SCHEMA, buildingId, ...identityFields(terrain), ...shape, ...settings,
    targetPadElevationM, unconstrainedPadElevationM: optimum, elevationMode: explicit == null ? 'minimum-earthwork' : 'explicit',
    clearanceM, maxWaterLevelElevationM, minimumPadElevationM,
    waterClearanceStatus: unknownWaterSamples ? 'unresolved' : 'sampled',
    designSampling: { maxStepM, maxSamples, sampleCount, unknownWaterSamples },
    earthwork: { areaM2: shape.areaM2, cutVolumeM3: finite(cutVolumeM3, 'cut volume'),
      fillVolumeM3: finite(fillVolumeM3, 'fill volume'), totalVolumeM3: finite(cutVolumeM3 + fillVolumeM3, 'total volume'),
      precision: 'area-weighted subtriangle centroid estimate; platform only, excluding batters' },
    perimeterTransitions });
}

/** Overlay designed pads or explicit {id, polygon/bounds, targetPadElevationM}
 * records. Platforms precede batters; influence, distance, then sorted building
 * IDs resolve overlaps. Apply after surface-water construction and road earthwork.
 * Water levels stay fixed; runoff, flow and structural stability are not re-solved.
 */
export function createBuildingPadAdjustedTerrain(terrain, buildingPads = [], options = {}) {
  checkTerrain(terrain);
  if (!Array.isArray(buildingPads) || buildingPads.length > 4096) throw new RangeError('Invalid building pad collection');
  const derivativeStepM = positive(options.derivativeStepM ?? 1, 'derivativeStepM');
  const defaults = slopes(options);
  const ids = new Set();
  const pads = buildingPads.map(input => {
    if (input?.schema != null && input.schema !== PAD_SCHEMA) throw new TypeError('Unsupported building pad schema');
    const shape = footprint(input);
    const buildingId = text(input.buildingId ?? input.id ?? `pad:${hashJson(shape.polygon)}`, 'buildingId');
    if (ids.has(buildingId)) throw new RangeError('Duplicate building pad ID');
    ids.add(buildingId); checkIdentity(input, terrain);
    const settings = slopes({ ...defaults, ...Object.fromEntries(['cutBatterSlope', 'fillBatterSlope', 'batterWidthM']
      .filter(k => input[k] != null).map(k => [k, input[k]])) });
    const targetPadElevationM = finite(input.targetPadElevationM ?? input.foundationElevationM, 'targetPadElevationM');
    if (input.minimumPadElevationM != null && targetPadElevationM < finite(input.minimumPadElevationM, 'minimumPadElevationM')) {
      throw new RangeError('Building pad violates water clearance');
    }
    // Validate region containment even if the first query is far from this pad.
    for (const p of shape.polygon) finite(terrain.groundElevationAt(p.xM, p.yM), 'groundElevationM');
    return { buildingId, ...shape, ...settings, targetPadElevationM, ...identityFields(terrain) };
  }).sort((a, b) => a.buildingId < b.buildingId ? -1 : a.buildingId > b.buildingId ? 1 : 0);
  const buildingPadAdjustmentId = hashJson({ source: identityFields(terrain), pads, derivativeStepM });
  function adjustedGround(xM, yM, base) {
    let winner = null;
    for (const pad of pads) {
      // A conservative lower bound avoids polygon work for distant footprints.
      const dx=Math.max(pad.bounds.minXM-xM,0,xM-pad.bounds.maxXM),dy=Math.max(pad.bounds.minYM-yM,0,yM-pad.bounds.maxYM);
      if((dx||dy)&&Math.hypot(dx,dy)>=batterWidth(pad.targetPadElevationM-base,pad))continue;
      const location = polygonLocation(pad.polygon, xM, yM);
      if (location.inside) return { elevation: pad.targetPadElevationM, applied: true, inside: true, buildingId: pad.buildingId };
      const delta = finite(pad.targetPadElevationM - base, 'earthwork elevation difference');
      if (delta === 0) continue;
      const width = batterWidth(delta, pad);
      if (location.distanceM >= width) continue;
      const t = location.distanceM / width, influence = 1 - t * t * (3 - 2 * t);
      const candidate = { elevation: finite(base + delta * influence, 'adjusted ground elevation'),
        applied: true, inside: false, influence, distanceM: location.distanceM, buildingId: pad.buildingId };
      if (!winner || influence > winner.influence || (influence === winner.influence && candidate.distanceM < winner.distanceM)) winner = candidate;
    }
    return winner ?? { elevation: base, applied: false };
  }
  function groundElevationAt(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    return adjustedGround(xM, yM, finite(terrain.groundElevationAt(xM, yM), 'groundElevationM')).elevation;
  }
  function groundMetadataAt(xM,yM) {
    finite(xM,'xM');finite(yM,'yM');const a=adjustedGround(xM,yM,finite(terrain.groundElevationAt(xM,yM),'groundElevationM'));
    return {groundElevationM:a.elevation,buildingId:a.buildingId??null,structureKind:a.applied?(a.inside?'building-pad':'retaining-batter'):null};
  }
  function sampleAt(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    const base = terrain.sampleAt(xM, yM), adjustment = adjustedGround(xM, yM, finite(base.groundElevationM, 'groundElevationM'));
    if (!adjustment.applied) return base;
    const groundElevationM = adjustment.elevation, d = derivativeStepM, bounds = terrain.bounds;
    const left = Math.max(bounds?.minXM ?? -Infinity, xM - d), right = Math.min(bounds?.maxXM ?? Infinity, xM + d);
    const bottom = Math.max(bounds?.minYM ?? -Infinity, yM - d), top = Math.min(bounds?.maxYM ?? Infinity, yM + d);
    const gradient = adjustment.inside ? { x: 0, y: 0 } : {
      x: finite((groundElevationAt(right, yM) - groundElevationAt(left, yM)) / (right - left), 'gradient.x'),
      y: finite((groundElevationAt(xM, top) - groundElevationAt(xM, bottom)) / (top - bottom), 'gradient.y') };
    const level = base.waterLevelElevationM ?? base.waterSurfaceElevationM ?? null;
    const waterDepthM = level === null ? (base.waterDepthM == null ? null : 0) : Math.max(0, finite(level, 'water level') - groundElevationM);
    const waterSourceIds = [...(base.waterSourceIds ?? [])];
    if (waterDepthM === 0) waterSourceIds.length = 0;
    const gridLevel = base.staticWaterLevelElevationM ?? (base.hydrologyStatus === 'defined' ? level : null);
    if (waterDepthM > 0 && base.waterLevelRole !== 'groundwater' && gridLevel != null && gridLevel >= level
      && !waterSourceIds.includes('water-level-grid')) waterSourceIds.push('water-level-grid');
    waterSourceIds.sort();
    return { ...base, buildingPadAdjustmentId, buildingId: adjustment.buildingId, groundElevationM, gradient,
      structureKind: adjustment.inside ? 'building-pad' : 'retaining-batter',
      slopeMPerM: Math.hypot(gradient.x, gradient.y), waterDepthM,
      waterSurfaceElevationM: waterDepthM > 0 ? level : null,
      surfaceKind: waterDepthM === null ? 'unresolved' : waterDepthM > 0 ? 'water' : 'ground',
      ...(base.waterSourceIds || level !== null ? { waterSourceIds } : {}) };
  }
  function surfaceFrameAt(xM, yM) {
    const sample = sampleAt(xM, yM);
    if (sample.buildingPadAdjustmentId !== buildingPadAdjustmentId && terrain.surfaceFrameAt) return terrain.surfaceFrameAt(xM, yM);
    const d = derivativeStepM, b = terrain.bounds;
    const edge = b && (xM - d < b.minXM || xM + d > b.maxXM || yM - d < b.minYM || yM + d > b.maxYM);
    return { ...sample, normal: unitNormalForGradient(sample.gradient),
      curvature: edge ? null : fixedStencilCurvature(groundElevationAt, xM, yM, sample.groundElevationM, sample.gradient, d),
      curvatureStatus: edge ? 'unavailable-at-region-edge' : 'fixed-distance-estimate' };
  }
  // A later pad overlay supersedes carriageways wherever it changes the ground.
  function roadSurfaceAt(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    const base = finite(terrain.groundElevationAt(xM, yM), 'groundElevationM');
    return adjustedGround(xM, yM, base).applied ? null : terrain.roadSurfaceAt?.(xM, yM) ?? null;
  }
  const targetBounds=pads.reduce(([low,high],pad)=>[Math.min(low,pad.targetPadElevationM),Math.max(high,pad.targetPadElevationM)],[Infinity,-Infinity]);
  function boundGroundElevation(range,region){
    const disk=validateMetricDisk(region),base=validateElevationInterval(terrain.boundGroundElevation?.(range,disk)??range);
    let targets=targetBounds,covered=false;
    if(disk){
      const relevant=pads.filter(pad=>{
        const dx=Math.max(pad.bounds.minXM-disk.xM,0,disk.xM-pad.bounds.maxXM),dy=Math.max(pad.bounds.minYM-disk.yM,0,disk.yM-pad.bounds.maxYM),
          width=Math.max(batterWidth(pad.targetPadElevationM-base[0],pad),batterWidth(pad.targetPadElevationM-base[1],pad));
        return Math.hypot(dx,dy)<=disk.radiusM+width+1e-7;
      });
      const blends=relevant.map(pad=>{const location=polygonLocation(pad.polygon,disk.xM,disk.yM);
        return boundBatterBlend(base,[pad.targetPadElevationM,pad.targetPadElevationM],[Math.max(0,location.distanceM-disk.radiusM),location.distanceM+disk.radiusM],pad);});
      covered=blends.some(b=>b.minimumInfluence>0);
      targets=blends.reduce(([lo,hi],b)=>[Math.min(lo,b.range[0]),Math.max(hi,b.range[1])],[Infinity,-Infinity]);
      // For one possible pad, distance to every polygon edge certifies that a
      // disk around an interior point cannot leave even a concave polygon.
      if(relevant.length===1){
        const pad=relevant[0],location=polygonLocation(pad.polygon,disk.xM,disk.yM);
        let clearance=Infinity;
        for(let i=0;i<pad.polygon.length;i++){
          const a=pad.polygon[i],b=pad.polygon[(i+1)%pad.polygon.length],dx=b.xM-a.xM,dy=b.yM-a.yM,t=Math.max(0,Math.min(1,((disk.xM-a.xM)*dx+(disk.yM-a.yM)*dy)/(dx*dx+dy*dy)));
          clearance=Math.min(clearance,Math.hypot(disk.xM-a.xM-t*dx,disk.yM-a.yM-t*dy));
        }
        if(location.inside&&clearance>disk.radiusM+1e-7){const z=pad.targetPadElevationM,e=1e-8*Math.max(1,Math.abs(z));return[z-e,z+e];}
      }
    }
    const low=covered?targets[0]:Math.min(base[0],targets[0]),high=covered?targets[1]:Math.max(base[1],targets[1]),slack=1e-8*Math.max(1,Math.abs(low),Math.abs(high));
    return[low-slack,high+slack];
  }
  const adapter = { ...terrain, buildingPadAdjustmentId, groundElevationAt, boundGroundElevation, groundMetadataAt, sampleAt, surfaceFrameAt, roadSurfaceAt,
    toSnapshot: () => {
      if (!terrain.toSnapshot) throw new TypeError('Base terrain does not support snapshots');
      return { schema: 'minimal-world-building-pad-adjusted-terrain@1', baseTerrain: terrain.toSnapshot(),
        buildingPads: copyJson(pads), options: { derivativeStepM }, buildingPadAdjustmentId };
    } };
  if (terrain.sampleWindow) adapter.sampleWindow = windowOptions => {
    const window = terrain.sampleWindow(windowOptions);
    return { ...window, buildingPadAdjustmentId, samples: window.samples.map(p => sampleAt(p.xM, p.yM)) };
  };
  adapter.traceSurfaceSegment = (a, b, { maxStepM = 2, maxSamples = MAX_TRACE_SAMPLES } = {}) => {
    for (const p of [a, b]) { finite(p?.xM, 'trace.xM'); finite(p?.yM, 'trace.yM'); }
    const plan = surfaceTracePlan(a, b, maxStepM, maxSamples);
    if (terrain.traceSurfaceSegment && plan.lengthM > 0) {
      for (const p of terrain.traceSurfaceSegment(a, b, { maxStepM, maxSamples }).samples) plan.marks.add(p.distanceM / plan.lengthM);
    }
    const dx = b.xM - a.xM, dy = b.yM - a.yM;
    for (const pad of pads) for (let i = 0; i < pad.polygon.length; i++) {
      const c = pad.polygon[i], e = pad.polygon[(i + 1) % pad.polygon.length];
      const ex = e.xM - c.xM, ey = e.yM - c.yM, determinant = dx * ey - dy * ex;
      if (determinant === 0) continue;
      const t = ((c.xM - a.xM) * ey - (c.yM - a.yM) * ex) / determinant;
      const u = ((c.xM - a.xM) * dy - (c.yM - a.yM) * dx) / determinant;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) plan.marks.add(t);
    }
    return completeSurfaceTrace(plan, { worldId: terrain.worldId, regionId: terrain.regionId, maxStepM, maxSamples,
      sampleAt, precision: 'source terrain events, pad perimeter and bounded probes; batter extrema are not certified' });
  };
  return Object.freeze(adapter);
}
