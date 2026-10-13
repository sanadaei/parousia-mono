import { createPlanetWaterSampler } from './sea-level.mjs';
import { createGlobalTerrain, GLOBAL_TERRAIN_SCHEMA } from './global-terrain.mjs';
import { buildGlobalWaterChart, restoreGlobalWaterChart, GLOBAL_MULTI_WATER_TERRAIN_SCHEMA } from './global-water.mjs';
import { copyJson, cloneJson, hashJson } from './json-contract.mjs';
import { createSphericalProjection, geographicPoint, sphereBasis, sameProjectionAxes, offsetGeographic } from './spherical.mjs';
import { interChartDeclarations, validateInterChartRivers } from './global-interchart-rivers.mjs';

export const SHARED_BASE_WATER = 'canonical-base-water@1';
const MAX_CHARTS = 16;
function chartId(id) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Water chart needs a non-empty id');
  return id;
}
function validateSeparation(charts, radius, margin, connections) {
  for (let i = 0; i < charts.length; i++) for (let j = i + 1; j < charts.length; j++) {
    const a = charts[i].chart, b = charts[j].chart;
    if (connections.some(c => c.fromChartId === charts[i].id && c.toChartId === charts[j].id
      || c.fromChartId === charts[j].id && c.toChartId === charts[i].id)) continue;
    if (sameProjectionAxes(a.projection, b.projection)) {
      const x = Math.max(b.bounds.minXM - a.bounds.maxXM, a.bounds.minXM - b.bounds.maxXM);
      const y = Math.max(b.bounds.minYM - a.bounds.maxYM, a.bounds.minYM - b.bounds.maxYM);
      if (Math.max(x, y) > margin) continue;
    } else {
      const u = sphereBasis(geographicPoint(a.projection.centerLatDeg, a.projection.centerLonDeg)).up;
      const v = sphereBasis(geographicPoint(b.projection.centerLatDeg, b.projection.centerLonDeg)).up;
      const angle = 2 * Math.asin(Math.min(1, Math.hypot(...u.map((c, k) => c - v[k])) / 2));
      const extent = c => Math.max(...[c.bounds.minXM, c.bounds.maxXM].flatMap(x =>
        [c.bounds.minYM, c.bounds.maxYM].map(y => Math.hypot(x, y))));
      if (angle * radius > extent(a) + extent(b) + margin) continue;
    }
    throw new RangeError(`Water charts need provably disjoint coverage: ${charts[i].id} / ${charts[j].id}`);
  }
}
function finish(base, entries, connections = [], sharedBaseWater = null) {
  if(sharedBaseWater!=null&&sharedBaseWater!==SHARED_BASE_WATER)throw new TypeError('Unsupported shared base water policy');
  const baseState=base.toSnapshot();
  if(sharedBaseWater&&!baseState.references.sea)throw new TypeError('Shared base water requires an explicit sea datum; do not infer sea level');
  const reservoirs=sharedBaseWater?createPlanetWaterSampler(baseState.references.sea,baseState.references.lakes??[],baseState.grid,baseState.references.localPonds):null;
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  validateInterChartRivers(entries, connections);
  validateSeparation(entries, base.frame.radiusM, 2 * base.derivativeStepM, connections);
  const state = { schema: GLOBAL_MULTI_WATER_TERRAIN_SCHEMA, base: base.toSnapshot(),
    waterCharts: entries.map(e => ({ id: e.id, ...e.chart })) };
  if(sharedBaseWater)state.sharedBaseWater=sharedBaseWater;
  if (connections.length) state.interChartRivers = cloneJson(connections);
  const worldId = hashJson(state);
  const runtime = entries.map(e => ({ ...e, projection: createSphericalProjection(e.chart.projection) }));
  function entryAt(latDeg, lonDeg) {
    for (const e of runtime) {
      const p = e.projection.toLocalIfWithin(latDeg, lonDeg), b = e.chart.bounds;
      if (p && p.xM >= b.minXM && p.xM <= b.maxXM && p.yM >= b.minYM && p.yM <= b.maxYM) return e;
    }
    return null;
  }
  function entriesAt(point) {
    return runtime.filter(e => {
      const p = e.projection.toLocalIfWithin(point.latDeg, point.lonDeg), b = e.chart.bounds;
      return p && p.xM >= b.minXM - 1e-6 && p.xM <= b.maxXM + 1e-6 && p.yM >= b.minYM - 1e-6 && p.yM <= b.maxYM + 1e-6;
    });
  }
  function groundElevationAt(latDeg, lonDeg) {
    if (connections.length) {
      const p = geographicPoint(latDeg, lonDeg);
      return entriesAt(p).reduce((z,e) => Math.min(z,e.terrain.groundElevationAt(p.latDeg,p.lonDeg)), base.groundElevationAt(p.latDeg,p.lonDeg));
    }
    const p = geographicPoint(latDeg, lonDeg), e = entryAt(p.latDeg, p.lonDeg);
    return (e?.terrain ?? base).groundElevationAt(p.latDeg, p.lonDeg);
  }
  function sampleChartsAt(latDeg, lonDeg) {
    if (connections.length) {
      const p = geographicPoint(latDeg,lonDeg), covered = entriesAt(p), source = base.sampleAt(p.latDeg,p.lonDeg);
      const samples = covered.map(e => ({ e, sample: e.terrain.sampleAt(p.latDeg,p.lonDeg) }));
      const ground = groundElevationAt(p.latDeg,p.lonDeg), wet = samples.filter(s => s.sample.waterLevelElevationM !== null);
      const level = wet[0]?.sample.waterLevelElevationM ?? null;
      if (wet.some(s => Math.abs(s.sample.waterLevelElevationM-level)>1e-6)) throw new RangeError('Cross-chart water surfaces disagree');
      const depth = level === null ? (covered.length ? 0 : null) : Math.max(0,level-ground);
      const d = base.derivativeStepM, at = (east,north) => { const q=offsetGeographic(p,east,north,base.frame.radiusM); return groundElevationAt(q.latDeg,q.lonDeg); };
      const east=(at(d,0)-at(-d,0))/(2*d), north=(at(0,d)-at(0,-d))/(2*d);
      const primary = wet[0]?.e ?? covered[0];
      return { ...source, worldId, baseWorldId: base.worldId, waterChartId: primary?.id ?? null,
        waterChartIds: covered.map(e=>e.id), groundElevationM: ground, channelGroundDeltaM: ground-source.groundElevationM,
        gradientEastNorth: { east: east||0, north: north||0 }, slopeMPerM: Math.hypot(east,north),
        hydrologyStatus: covered.length ? 'modeled':'unresolved', surfaceKind: !covered.length ? 'unresolved' : depth>0 ? 'water':'ground',
        waterLevelElevationM: level, waterSurfaceElevationM: depth>0 ? level:null, waterDepthM: depth,
        waterSourceIds: wet.flatMap(({e,sample})=>sample.waterSourceIds.map(id=>`${encodeURIComponent(e.id)}/${encodeURIComponent(id)}`)).sort(),
        surfaceWaterCoverage: covered.length ? 'inside-explicit-chart':'outside-explicit-charts' };
    }
    const p = geographicPoint(latDeg, lonDeg), e = entryAt(p.latDeg, p.lonDeg), sample = (e?.terrain ?? base).sampleAt(p.latDeg, p.lonDeg);
    return { ...sample, worldId, baseWorldId: base.worldId, waterChartId: e?.id ?? null,
      channelGroundDeltaM: sample.groundElevationM - base.groundElevationAt(p.latDeg, p.lonDeg),
      waterSourceIds: (sample.waterSourceIds ?? []).map(id => e ? `${encodeURIComponent(e.id)}/${encodeURIComponent(id)}` : id),
      surfaceWaterCoverage: e ? 'inside-explicit-chart' : 'outside-explicit-charts' };
  }
  function sampleAt(latDeg,lonDeg){
    const local=sampleChartsAt(latDeg,lonDeg);if(!reservoirs)return local;
    const original=base.sampleAt(latDeg,lonDeg),water=reservoirs(latDeg,lonDeg,local.groundElevationM);
    const candidates=[original,local,water].filter(s=>s.waterLevelElevationM!=null&&s.waterLevelElevationM>local.groundElevationM);
    candidates.sort((a,b)=>b.waterLevelElevationM-a.waterLevelElevationM);const selected=candidates[0]??water,level=selected.waterLevelElevationM;
    return{...local,waterLevelElevationM:level,waterSurfaceElevationM:level>local.groundElevationM?level:null,
      waterDepthM:level==null?null:Math.max(0,level-local.groundElevationM),waterSourceIds:selected.waterSourceIds,
      surfaceKind:selected===local?'local-water':selected.surfaceKind,hydrologyStatus:selected.hydrologyStatus??'modeled',
      surfaceWaterCoverage:'shared-base-and-explicit-charts'};
  }
  const projections = runtime.map(e => Object.freeze({ ...e.chart.projection }));
  function segmentSurfaceEvents(a, b, projection) {
    return runtime.filter(e => sameProjectionAxes(e.chart.projection, projection))
      .flatMap(e => e.terrain.segmentSurfaceEvents(a, b));
  }
  return Object.freeze({ schema: GLOBAL_MULTI_WATER_TERRAIN_SCHEMA, worldId, sourceWorldId: base.sourceWorldId, baseWorldId: base.worldId,
    frame: base.frame, grid: base.grid, derivativeStepM: base.derivativeStepM, hydrologyStatus: sharedBaseWater?'modeled':'partially-modeled',
    groundElevationAt, sampleAt, surfaceEventProjections: Object.freeze(projections), segmentSurfaceEvents,
    toSnapshot: () => ({ ...cloneJson(state), worldId }) });
}

/** Explicit charts on one sphere; contact requires a validated junction contract. */
export function connectGlobalSurfaceWaterCharts(global, options = {}) {
  const { charts } = options, connections = interChartDeclarations(options);
  if (global?.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Multiple water charts require base global terrain');
  if (!Array.isArray(charts) || !charts.length || charts.length > MAX_CHARTS) throw new RangeError('Provide 1..16 explicit water charts');
  const base = createGlobalTerrain(global.toSnapshot()), ids = new Set();
  const chartOptions = charts.map(({ id, ...options }) => {
    chartId(id); if (ids.has(id)) throw new TypeError('Duplicate water chart ID'); ids.add(id); return { id, options };
  });
  const entries = chartOptions.map(({ id, options }) => {
    if (options.interChartBoundaryNodeIds != null) throw new TypeError('Boundary openings must be authorized by inter-chart connections');
    const nodeIds = connections.flatMap(c => c.fromChartId===id ? [c.fromNodeId] : c.toChartId===id ? [c.toNodeId] : []);
    const graph = copyJson(options.riverGraph ?? { nodes:[], edges:[] }, 'riverGraph');
    const b = options.bounds ?? { minXM:-5000,minYM:-5000,maxXM:5000,maxYM:5000 };
    const boundaryIds = graph.nodes.filter(n => nodeIds.includes(n.id) && (n.xM===b.minXM || n.xM===b.maxXM || n.yM===b.minYM || n.yM===b.maxYM)).map(n=>n.id);
    for (const n of graph.nodes) if (boundaryIds.includes(n.id)) n.kind='regional-boundary';
    options = { ...options, riverGraph: graph, interChartBoundaryNodeIds: boundaryIds };
    const terrain = buildGlobalWaterChart(base, options); return { id, terrain, chart: terrain.toSnapshot().waterChart };
  });
  return finish(base, entries, connections, options.sharedBaseWater);
}

export function createGlobalMultiWaterTerrain(input) {
  if (input?.schema !== GLOBAL_MULTI_WATER_TERRAIN_SCHEMA || input.base?.schema !== GLOBAL_TERRAIN_SCHEMA
    || !Array.isArray(input.waterCharts) || !input.waterCharts.length || input.waterCharts.length > MAX_CHARTS) throw new TypeError('Unsupported multiple water chart contract');
  const base = createGlobalTerrain(input.base), ids = new Set();
  const entries = input.waterCharts.map(raw => {
    const { id, ...chart } = copyJson(raw, 'waterChart'); chartId(id);
    if (ids.has(id)) throw new TypeError('Duplicate water chart ID'); ids.add(id);
    const terrain = restoreGlobalWaterChart(base, chart);
    return { id, terrain, chart: terrain.toSnapshot().waterChart };
  });
  const terrain = finish(base, entries, interChartDeclarations({ interChartRivers: input.interChartRivers }), input.sharedBaseWater);
  if (input.worldId != null && input.worldId !== terrain.worldId) throw new Error('Multiple water chart snapshot worldId mismatch');
  return terrain;
}
