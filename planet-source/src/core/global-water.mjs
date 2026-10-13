import { createGlobalTerrain, GLOBAL_TERRAIN_SCHEMA, createProjectedTerrainView } from './global-terrain.mjs';
import { createSphericalProjection, geographicPoint, offsetGeographic, sphereBasis, finiteNumber } from './spherical.mjs';
import { createProjectedGroundBounds } from './projected-ground-bounds.mjs';
import { solveSurfaceWaterModel } from './surface-water.mjs';
import { compileSurfaceWater, segmentIntervals } from './water-model.mjs';
import { copyJson, cloneJson, hashJson } from './json-contract.mjs';
import { composeSurfaceWater } from './field-math.mjs';

export const GLOBAL_WATER_TERRAIN_SCHEMA = 'minimal-world-global-water-terrain@1';
export const GLOBAL_MULTI_WATER_TERRAIN_SCHEMA = 'minimal-world-global-water-terrain@2';
export { connectGlobalSurfaceWaterCharts, createGlobalMultiWaterTerrain, SHARED_BASE_WATER } from './global-water-charts.mjs';
const CHART_SCHEMA = 'minimal-world-explicit-water-chart@1';
function spatialContract(bounds) {
  return { frame: { originXM: bounds.minXM, originYM: bounds.minYM },
    grid: { cellSizeM: 100, columns: Math.ceil((bounds.maxXM - bounds.minXM) / 100), rows: Math.ceil((bounds.maxYM - bounds.minYM) / 100) } };
}
function incisionLimit(value) {
  finiteNumber(value, 'maxCenterIncisionM');
  if (value <= 0 || value > 10000) throw new RangeError('Incision limit must be positive and at most 10000m');
  return value;
}
function checkSupport(compiled, chart) {
  const b = compiled.meshBounds, a = chart.bounds;
  const allowed = chart.interChartBoundaryNodeIds ?? [];
  if (!Array.isArray(allowed) || new Set(allowed).size !== allowed.length || allowed.some(id =>
    !chart.model.nodes.some(n => n.id === id && n.kind === 'regional-boundary'))) throw new RangeError('Invalid inter-chart boundary node IDs');
  for (const side of ['minXM', 'maxXM', 'minYM', 'maxYM']) {
    const touches = b && (side.startsWith('min') ? b[side] <= a[side] + 1e-6 : b[side] >= a[side] - 1e-6);
    if (touches && !chart.model.nodes.some(n => allowed.includes(n.id) && n[side.endsWith('XM') ? 'xM' : 'yM'] === a[side])) {
      throw new RangeError('Global channel support must stay inside its explicit chart; expand the chart or move the channel');
    }
  }
  for (const contact of compiled.boundaryContacts) {
    const edge=chart.model.edges.find(e=>e.id===contact.edgeId),axis=contact.side.endsWith('XM')?'xM':'yM',other=axis==='xM'?'yM':'xM';
    const matches=[edge.points[0],edge.points.at(-1)].some((p,i)=>{
      const id=i===0?edge.from:edge.to,neighbor=i===0?edge.points[1]:edge.points.at(-2);
      if (!allowed.includes(id) || p[axis]!==a[contact.side]) return false;
      const outward=Math.abs(p[axis]-neighbor[axis])/Math.hypot(p.xM-neighbor.xM,p.yM-neighbor.yM);
      const extent=(p.halfWidthM+p.bankWidthM)/outward;
      return contact.minM>=p[other]-extent-1e-6 && contact.maxM<=p[other]+extent+1e-6;
    });
    if (!matches) throw new RangeError('Channel support crosses a boundary outside its declared inter-chart opening');
  }
  if (chart.model.nodes.some(n => n.kind === 'regional-boundary' && !allowed.includes(n.id))) throw new RangeError('Global explicit charts require internal capped channels, not regional-boundary outlets');
}
function centerIncisionUpperBound(model, ground) {
  let bound = 0, maxVertexIncisionM = 0;
  for (const edge of model.edges) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1], b = edge.points[i];
    const range = ground.segmentMaximum(a, b, a.waterLevelElevationM - a.depthM, b.waterLevelElevationM - b.depthM);
    bound = Math.max(bound, range.maximum); maxVertexIncisionM = Math.max(maxVertexIncisionM, range.endpointsMaximum);
  }
  return { bound, maxVertexIncisionM };
}

/** One explicit metric water chart over a canonical sphere. No source mask is
 * interpreted as a water level. Profile solving and mesh validation are shared. */
export function connectGlobalSurfaceWater(global, options = {}) {
  if (global?.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Explicit global water requires a base global terrain without a water chart');
  if (options.interChartBoundaryNodeIds != null) throw new TypeError('Boundary openings require validated multi-chart connections');
  return buildGlobalWaterChart(createGlobalTerrain(global.toSnapshot()), options);
}

/** @internal Uses the owned canonical base shared by a multiple-chart world. */
export function buildGlobalWaterChart(global, { centerLatDeg, centerLonDeg, maxRadiusM, bounds,
  verticalDatum, riverGraph, waterBodies = [], parameters = {}, channelSizing = null,
  groundBoundsStepM = 20, maxCenterIncisionM = 5, interChartBoundaryNodeIds = [], bed = null } = {}) {
  if (global?.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Explicit global water requires a base global terrain without a water chart');
  if (verticalDatum !== global.frame.verticalDatum) throw new RangeError('Water verticalDatum must explicitly match the global terrain datum');
  const view = createProjectedTerrainView(global, { centerLatDeg, centerLonDeg, maxRadiusM, bounds });
  const projection = createSphericalProjection(view.frame), analysis = createProjectedGroundBounds(global, projection, view.bounds, groundBoundsStepM);
  const cache = spatialContract(view.bounds), limit = incisionLimit(maxCenterIncisionM);
  if(bed&&bed.maxIncisionM>limit)throw new RangeError('C1 bed cap exceeds the chart incision limit');
  const model = solveSurfaceWaterModel(view, { riverGraph, waterBodies, parameters, channelSizing, bed }, { ...cache, groundBounds: analysis });
  const chart = { schema: CHART_SCHEMA, projection: { ...projection.contract }, bounds: { ...view.bounds },
    verticalDatum, groundAnalysis: analysis.contract, maxCenterIncisionM: limit, model };
  if (interChartBoundaryNodeIds.length) chart.interChartBoundaryNodeIds = copyJson(interChartBoundaryNodeIds, 'interChartBoundaryNodeIds').sort();
  const compiled = compileSurfaceWater(model, chart.bounds, cache.grid, cache.frame, analysis.ground, { fitWidths: true });
  checkSupport(compiled, chart);
  chart.centerIncisionUpperBoundM = centerIncisionUpperBound(model, analysis.ground).bound;
  if (chart.centerIncisionUpperBoundM > limit + 1e-8) throw new RangeError(`Channel center incision bound ${chart.centerIncisionUpperBoundM}m exceeds the explicit ${limit}m limit`);
  chart.model = copyJson(model, 'waterChart.model');
  return finishGlobalWaterTerrain(global, chart, compiled, projection);
}
export function connectProjectedSurfaceWater(view, options = {}) {
  const saved = view.toSnapshot();
  if (!saved.world || saved.world.schema !== GLOBAL_TERRAIN_SCHEMA || saved.projection?.kind !== 'spherical-azimuthal-equidistant@1') {
    throw new TypeError('Expected a projected view of a base global terrain');
  }
  const global = connectGlobalSurfaceWater(createGlobalTerrain(saved.world), { ...options, ...saved.projection, bounds: saved.bounds });
  return createProjectedTerrainView(global, { ...saved.projection, bounds: saved.bounds });
}

/** Restore a fitted model against the same direct global field. No width refit. */
export function createGlobalWaterTerrain(input) {
  if (input?.schema !== GLOBAL_WATER_TERRAIN_SCHEMA || input.base?.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Unsupported global water terrain contract');
  if (input.waterChart?.interChartBoundaryNodeIds?.length) throw new RangeError('Boundary openings require a connected multi-chart snapshot');
  return restoreGlobalWaterChart(createGlobalTerrain(input.base), input.waterChart, input.worldId);
}

/** @internal Revalidates a chart without rebuilding the shared sphere. */
export function restoreGlobalWaterChart(base, raw, expectedWorldId) {
  if (raw?.schema !== CHART_SCHEMA || raw.verticalDatum !== base.frame.verticalDatum
    || raw.projection?.kind !== 'spherical-azimuthal-equidistant@1' || raw.projection.radiusM !== base.frame.radiusM) throw new RangeError('Water chart projection/datum contract mismatch');
  const view = createProjectedTerrainView(base, { ...raw.projection, bounds: raw.bounds });
  const projection = createSphericalProjection(view.frame), analysis = createProjectedGroundBounds(base, projection, view.bounds,
    raw.groundAnalysis?.stepM, { method: raw.groundAnalysis?.method });
  if (hashJson(copyJson(raw.groundAnalysis)) !== hashJson(copyJson(analysis.contract))) {
    throw new RangeError('Saved ground bounds disagree with the canonical sphere');
  }
  const chart = { schema: CHART_SCHEMA, projection: { ...projection.contract }, bounds: { ...view.bounds },
    verticalDatum: base.frame.verticalDatum, groundAnalysis: analysis.contract, maxCenterIncisionM: incisionLimit(raw.maxCenterIncisionM), model: copyJson(raw.model, 'waterChart.model') };
  if (raw.interChartBoundaryNodeIds != null) chart.interChartBoundaryNodeIds = copyJson(raw.interChartBoundaryNodeIds, 'interChartBoundaryNodeIds').sort();
  if (chart.model.basins !== null) throw new TypeError('Global water retains source spherical basins; no local basin grid is accepted');
  chart.centerIncisionUpperBoundM = finiteNumber(raw.centerIncisionUpperBoundM, 'centerIncisionUpperBoundM');
  const state = { schema: GLOBAL_WATER_TERRAIN_SCHEMA, base: base.toSnapshot(), waterChart: chart }, worldId = hashJson(state);
  if (expectedWorldId != null && expectedWorldId !== worldId) throw new Error('Global water snapshot worldId mismatch');
  const cache = spatialContract(chart.bounds), compiled = compileSurfaceWater(chart.model, chart.bounds, cache.grid, cache.frame, analysis.ground);
  if(chart.model.bed&&chart.model.bed.maxIncisionM>chart.maxCenterIncisionM)throw new RangeError('Saved C1 bed cap exceeds the chart incision limit');
  checkSupport(compiled, chart);
  const { bound: upperBound, maxVertexIncisionM } = centerIncisionUpperBound(chart.model, analysis.ground);
  if (upperBound > chart.maxCenterIncisionM + 1e-8) throw new RangeError('Saved channel exceeds its center incision limit');
  if (upperBound !== chart.centerIncisionUpperBoundM) throw new RangeError('Saved center incision bound mismatch');
  // Endpoint diagnostics are collected during the same conservative interval
  // pass. They are distinct from its upper bound and remain checked on restore.
  if (Math.abs(maxVertexIncisionM - chart.model.diagnostics.maxCenterIncisionM) > 1e-8) throw new RangeError('Saved center incision diagnostic mismatch');
  return finishGlobalWaterTerrain(base, chart, compiled, projection);
}

// Builder reuses its validated fitted mesh; restoration compiles saved widths once.
function finishGlobalWaterTerrain(base, chart, compiled, projection) {
  const state = { schema: GLOBAL_WATER_TERRAIN_SCHEMA, base: base.toSnapshot(), waterChart: chart }, worldId = hashJson(state);
  const basis = sphereBasis(geographicPoint(chart.projection.centerLatDeg, chart.projection.centerLonDeg));
  const cosineRadius = Math.cos(chart.projection.maxRadiusM / base.frame.radiusM);
  function localAt(point) {
    const vector = sphereBasis(point).up, dot = vector.reduce((sum, v, i) => sum + v * basis.up[i], 0);
    if (dot < cosineRadius - 1e-14) return null;
    const p = projection.toLocalIfWithin(point.latDeg, point.lonDeg), b = chart.bounds;
    if (!p) return null;
    const epsilon = chart.interChartBoundaryNodeIds?.length ? 1e-6 : 0;
    if (p.xM < b.minXM-epsilon || p.xM > b.maxXM+epsilon || p.yM < b.minYM-epsilon || p.yM > b.maxYM+epsilon) return null;
    return epsilon ? {xM:Math.max(b.minXM,Math.min(b.maxXM,p.xM)),yM:Math.max(b.minYM,Math.min(b.maxYM,p.yM))}:p;
  }
  function groundElevationAt(latDeg, lonDeg) {
    const point = geographicPoint(latDeg, lonDeg), p = localAt(point);
    const original = base.groundElevationAt(point.latDeg, point.lonDeg);
    return p ? compiled.sampleGround(p.xM, p.yM, original) : original;
  }
  function sampleAt(latDeg, lonDeg) {
    const point = geographicPoint(latDeg, lonDeg), source = base.sampleAt(point.latDeg, point.lonDeg), p = localAt(point);
    const water = p ? compiled.sample(p.xM, p.yM, source.groundElevationM) : null, ground = water?.groundElevationM ?? source.groundElevationM;
    const values = composeSurfaceWater(ground, water?.waterLevelElevationM ?? null, water?.waterSourceIds ?? [], null, 'surface', Boolean(p));
    const d = base.derivativeStepM, at = (east, north) => { const q = offsetGeographic(point, east, north, base.frame.radiusM); return groundElevationAt(q.latDeg, q.lonDeg); };
    const east = (at(d, 0) - at(-d, 0)) / (2 * d), north = (at(0, d) - at(0, -d)) / (2 * d);
    const wet = values.waterDepthM !== null && values.waterDepthM > 0;
    return { ...source, worldId, baseWorldId: base.worldId, groundElevationM: ground, channelGroundDeltaM: ground - source.groundElevationM,
      gradientEastNorth: { east: east || 0, north: north || 0 }, slopeMPerM: Math.hypot(east, north),
      hydrologyStatus: p ? 'modeled' : 'unresolved', surfaceKind: !p ? 'unresolved' : wet ? 'water' : 'ground',
      waterLevelElevationM: values.waterLevelElevationM, waterSurfaceElevationM: wet ? values.waterLevelElevationM : null,
      waterDepthM: values.waterDepthM, waterSourceIds: values.waterSourceIds,
      surfaceWaterCoverage: p ? 'inside-explicit-chart' : 'outside-explicit-chart' };
  }
  function segmentSurfaceEvents(a, b) {
    const box = [{ xM: chart.bounds.minXM, yM: chart.bounds.minYM }, { xM: chart.bounds.maxXM, yM: chart.bounds.minYM },
      { xM: chart.bounds.maxXM, yM: chart.bounds.maxYM }, { xM: chart.bounds.minXM, yM: chart.bounds.maxYM }];
    return [...compiled.segmentBreaks(a, b), ...segmentIntervals(a, b, box).flat()];
  }
  return Object.freeze({ schema: GLOBAL_WATER_TERRAIN_SCHEMA, worldId, sourceWorldId: base.sourceWorldId, baseWorldId: base.worldId,
    frame: base.frame, grid: base.grid, derivativeStepM: base.derivativeStepM, hydrologyStatus: 'partially-modeled',
    groundElevationAt, sampleAt, surfaceEventProjection: Object.freeze({ ...chart.projection }), segmentSurfaceEvents,
    toSnapshot: () => ({ ...cloneJson(state), worldId }) });
}
