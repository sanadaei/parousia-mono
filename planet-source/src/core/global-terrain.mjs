import {usesEnvironmentPolicy,environmentRiverReach,VALLEY_ENVIRONMENT_POLICY} from './environment-cover.mjs';
import {terrainBandGradientMultiplier} from './terrain-band-noise.mjs';
import { LOCAL_SHORE_METHOD,localShoreMask,localShoreSpatialGradient,MULTISCALE_SHORE_METHOD,multiscaleShoreGradient,SHORE_DETAIL_METHOD,isAnchoredDetailMethod,shoreDetailConstraint } from './shore-detail.mjs';
import { createSphericalRiverSampler } from './planet-rivers.mjs';
import { validateSeaLevel, sampleSeaLevel, createPlanetWaterSampler, selectBasePlanetWater } from './sea-level.mjs';
import { createGlobalFieldEvaluator } from './global-field-evaluator.mjs';
import { finiteNumber, nonEmptyText as text, integerDimension as dimension, copyNumericField } from './contract-validation.mjs';
import { copyJson, cloneJson, hashJson as hash } from './json-contract.mjs';
import { MAX_TRACE_SAMPLES, surfaceTracePlan, completeSurfaceTrace } from './surface-trace.mjs';
import { createPeriodicHermiteField } from './periodic-field.mjs';
import { geographicPoint, sphereBasis, offsetGeographic, createSphericalProjection, sameProjectionAxes } from './spherical.mjs';
import { createSphericalNoise } from './spherical-noise.mjs';
import { ANCHORED_DETAIL_METHOD, createAnchoredSphericalDetail } from './spherical-detail.mjs';
import { unitNormalForGradient, fixedStencilCurvature } from './surface-derivatives.mjs';
import { createGlobalWaterTerrain, GLOBAL_WATER_TERRAIN_SCHEMA, createGlobalMultiWaterTerrain, GLOBAL_MULTI_WATER_TERRAIN_SCHEMA } from './global-water.mjs';
import { GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA, restorePostDetailDrainage } from './post-detail-drainage.mjs';

export const GLOBAL_TERRAIN_SCHEMA = 'minimal-world-global-terrain@1';
export const PROJECTED_TERRAIN_SCHEMA = 'minimal-world-projected-terrain@1';
export { exportProjectedCanonicalRegion } from './projected-canonical.mjs';
const MAX_CELLS = 131072, MAX_WINDOW = 262144;
function field(values, count, name, valid) {
  // Preserve global snapshots' signed-zero normalization.
  return copyNumericField(values, count, name, valid).map(value => value || 0);
}
function drainageOutlets(grid, land, downstream) {
  const { columns: w, rows: h } = grid, count = w * h, status = new Uint8Array(count), outlets = new Int32Array(count);
  outlets.fill(-1);
  for (let i = 0; i < count; i++) {
    const to = downstream[i];
    if (!land[i]) {
      if (to !== -1) throw new RangeError('Source ocean cells must be drainage outlets');
      status[i] = 2; outlets[i] = i; continue;
    }
    if (to >= 0) {
      const dx = Math.abs(i % w - to % w), dy = Math.abs(Math.floor(i / w) - Math.floor(to / w));
      if (to === i || Math.min(dx, w - dx) > 1 || dy > 1) throw new RangeError('Drainage receivers must be neighboring cells');
    }
  }
  for (let start = 0; start < count; start++) {
    if (status[start] === 2) continue;
    const path = []; let current = start;
    while (current >= 0 && status[current] === 0) { status[current] = 1; path.push(current); current = downstream[current]; }
    if (current >= 0 && status[current] === 1) throw new RangeError('Global drainage must be acyclic');
    const outlet = current < 0 ? -1 : outlets[current];
    for (const cell of path) { status[cell] = 2; outlets[cell] = outlet; }
  }
  return Array.from(outlets);
}
function normalize(input) {
  if (input?.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Unsupported global terrain schema');
  if ((input.frame?.kind != null && input.frame.kind !== 'sphere-geographic')
    || (input.interpolation != null && input.interpolation !== 'periodic-hermite-polar-caps@1')
    || (input.grid?.sampleLocation != null && input.grid.sampleLocation !== 'cell-center')
    || (input.grid?.longitudeOriginDeg != null && input.grid.longitudeOriginDeg !== 0)
    || (input.grid?.northToSouth != null && input.grid.northToSouth !== true)) throw new TypeError('Unsupported global coordinate/interpolation contract');
  const columns = dimension(input.grid?.columns, 'columns'), rows = dimension(input.grid?.rows, 'rows'), count = columns * rows;
  if (count > MAX_CELLS) throw new RangeError('Global field exceeds 131072 cells');
  const macroColumns = dimension(input.grid.macroColumns, 'macroColumns'), macroRows = dimension(input.grid.macroRows, 'macroRows');
  if (columns % macroColumns || rows % macroRows) throw new RangeError('Physical grid must subdivide the macro grid');
  const radiusM = finiteNumber(input.frame?.radiusM, 'radiusM');
  if (radiusM < 1 || radiusM > 1e9) throw new RangeError('Planetary radius must be 1..1e9 meters');
  const sourceVerticalDatum = text(input.frame.sourceVerticalDatum, 'sourceVerticalDatum'), verticalDatum = text(input.frame.verticalDatum, 'verticalDatum');
  const elevationOffsetM = finiteNumber(input.frame.elevationOffsetM ?? 0, 'elevationOffsetM') || 0;
  if (Math.abs(elevationOffsetM) > 1e7 || (elevationOffsetM !== 0 && sourceVerticalDatum === verticalDatum)) throw new RangeError('Nonzero datum offset needs distinct source/target datum names and magnitude at most 1e7m');
  const derivativeStepM = finiteNumber(input.derivativeStepM ?? 1, 'derivativeStepM');
  if (derivativeStepM <= 0 || derivativeStepM >= radiusM * 0.01 || derivativeStepM / radiusM < 1e-12) throw new RangeError('Invalid global derivative distance');
  const fields = {
    groundElevationM: field(input.fields?.groundElevationM, count, 'groundElevationM', v => Math.abs(v) <= 1e7),
    landMask: field(input.fields?.landMask, count, 'landMask', v => v === 0 || v === 1),
    downstream: field(input.fields?.downstream, count, 'downstream', v => Number.isSafeInteger(v) && v >= -1 && v < count),
    lakeFillDepthM: input.fields?.lakeFillDepthM == null ? null : field(input.fields.lakeFillDepthM, count, 'lakeFillDepthM', v => v >= 0 && v <= 1e7),
    runoffIndex: input.fields?.runoffIndex == null ? null : field(input.fields.runoffIndex, count, 'runoffIndex', v => v >= 0 && v <= 1e12),
  };
  const grid = { columns, rows, macroColumns, macroRows, sampleLocation: 'cell-center', longitudeOriginDeg: 0, northToSouth: true };
  const outlets = drainageOutlets(grid, fields.landMask, fields.downstream);
  if (input.fields.basinOutletCellIndex != null) {
    const saved = field(input.fields.basinOutletCellIndex, count, 'basinOutletCellIndex', v => Number.isSafeInteger(v) && v >= -1 && v < count);
    if (saved.some((v, i) => v !== outlets[i])) throw new RangeError('Saved basin outlets disagree with source drainage');
  }
  const references = copyJson(input.references ?? {});
  validateSeaLevel(references.sea, verticalDatum);
  if(references.localPonds&&references.localPonds.radiusM!==radiusM)throw new RangeError('Local pond frame differs from terrain');
  if(references.sea&&references.rivers&&(references.rivers.radiusM!==radiusM||references.rivers.grid?.columns!==columns||references.rivers.grid?.rows!==rows))throw new RangeError('River network frame differs from terrain');
  if (!Array.isArray(references.macroCellIds) || references.macroCellIds.length !== macroColumns * macroRows
    || references.macroCellIds.some(id => typeof id !== 'string' || !id) || new Set(references.macroCellIds).size !== references.macroCellIds.length) throw new RangeError('Macro cell IDs must be unique and cover the macro grid');
  const features = references.features ?? [], featureIds = new Set();
  if (!Array.isArray(features) || features.length > 4096) throw new RangeError('Too many geographic features');
  let memberships = 0;
  for (const f of features) {
    text(f.id, 'feature.id'); if (featureIds.has(f.id)) throw new TypeError('Duplicate geographic feature ID'); featureIds.add(f.id);
    if (!Array.isArray(f.cellIndices) || f.cellIndices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= macroColumns * macroRows)) throw new RangeError('Invalid geographic feature membership');
    memberships += f.cellIndices.length;
    if (memberships > 262144) throw new RangeError('Geographic feature memberships exceed limits');
  }
  const bands = input.detail?.bands ?? [];
  if (!Array.isArray(bands) || bands.length > 4) throw new RangeError('At most four detail bands are supported');
  const bandIds = new Set(), normalizedBands = bands.map(b => {
    const id = text(b.id, 'band.id'); if (bandIds.has(id)) throw new TypeError('Duplicate detail band ID'); bandIds.add(id);
    terrainBandGradientMultiplier(b);
    const wavelengthM = finiteNumber(b.wavelengthM, 'wavelengthM'), amplitudeM = finiteNumber(b.amplitudeM, 'amplitudeM');
    if (wavelengthM < 1 || radiusM / wavelengthM > 1e9 || amplitudeM < 0 || amplitudeM > 10000) throw new RangeError('Invalid detail wavelength/amplitude');
    const activation=b.elevationActivationM;if(activation!==undefined&&(!Array.isArray(activation)||activation.length!==2||!activation.every(Number.isFinite)||activation[0]>=activation[1]))throw new RangeError('Invalid elevation activation interval');
    const fraction=b.shoreBudgetFraction;if(fraction!==undefined&&(!Number.isFinite(fraction)||fraction<=0||fraction>1))throw new RangeError('Invalid shore budget fraction');
    return { id, wavelengthM, amplitudeM,...(b.shape?{shape:b.shape}:{}),...(activation?{elevationActivationM:[...activation]}:{}),...(fraction!==undefined?{shoreBudgetFraction:fraction}:{}) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const detailMethod = input.detail?.method ?? 'bounded-spherical-bands@1';
  if (!['bounded-spherical-bands@1', ANCHORED_DETAIL_METHOD,SHORE_DETAIL_METHOD,MULTISCALE_SHORE_METHOD,LOCAL_SHORE_METHOD].includes(detailMethod)) throw new TypeError('Unsupported global detail method');
  if(normalizedBands.some(b=>b.shape)&&!isAnchoredDetailMethod(detailMethod))throw new TypeError('Shaped landforms require anchored detail');
  if(normalizedBands.some(b=>b.elevationActivationM)&&detailMethod!==LOCAL_SHORE_METHOD)throw new TypeError('Elevation activation requires local shore detail');
  if(normalizedBands.some(b=>b.shoreBudgetFraction!==undefined)&&![LOCAL_SHORE_METHOD,MULTISCALE_SHORE_METHOD].includes(detailMethod))throw new TypeError('Band shore budgets require multiscale shores');
  if([LOCAL_SHORE_METHOD,MULTISCALE_SHORE_METHOD].includes(detailMethod)&&normalizedBands.filter(b=>b.amplitudeM>0).reduce((sum,b)=>sum+(b.shoreBudgetFraction??.25),0)>1+1e-12)throw new RangeError('Combined shore fractions exceed one');
  const shoreLevelsM=[SHORE_DETAIL_METHOD,MULTISCALE_SHORE_METHOD,LOCAL_SHORE_METHOD].includes(detailMethod)?[...new Set(input.detail.shoreLevelsM??[])].sort((a,b)=>a-b):null;if(shoreLevelsM)shoreDetailConstraint(shoreLevelsM,normalizedBands.reduce((n,b)=>n+b.amplitudeM,0));
  const shoreRegions=detailMethod===LOCAL_SHORE_METHOD?copyJson(input.detail.shoreRegions??[]):null;if(shoreRegions){if(!Array.isArray(shoreRegions)||shoreRegions.length>4096||shoreRegions.some(r=>!Number.isFinite(r.levelElevationM)||!Array.isArray(r.cells)))throw new TypeError('Invalid regional shores');localShoreMask({shoreRegions},{columns,rows});}

  const seed = text(input.seed, 'seed'), sourceWorldId = hash({ seed, grid, fields, references });
  if (input.sourceWorldId != null && input.sourceWorldId !== sourceWorldId) throw new Error('Source worldId mismatch');
  return { schema: GLOBAL_TERRAIN_SCHEMA, seed, revision: text(input.revision, 'revision'), sourceWorldId,
    frame: { kind: 'sphere-geographic', radiusM, sourceVerticalDatum, verticalDatum, elevationOffsetM }, grid, derivativeStepM,
    interpolation: 'periodic-hermite-polar-caps@1', detail: { method: detailMethod, bands: normalizedBands,...(shoreLevelsM?{shoreLevelsM}:{}),...(shoreRegions?{shoreRegions}:{}) },
    fields: { ...fields, basinOutletCellIndex: outlets }, references };
}

/** One canonical sphere; query windows never rerun a generator or drop detail bands. */
export function createGlobalTerrain(input) {
  if (input?.schema === GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA) return restorePostDetailDrainage(input);
  if (input?.schema === GLOBAL_WATER_TERRAIN_SCHEMA) return createGlobalWaterTerrain(input);
  if (input?.schema === GLOBAL_MULTI_WATER_TERRAIN_SCHEMA) return createGlobalMultiWaterTerrain(input);
  const state = normalize(input), worldId = hash(state);
  if (input.worldId != null && input.worldId !== worldId) throw new Error('Global snapshot worldId mismatch');
  const { columns: w, rows: h, macroColumns, macroRows } = state.grid, source = state.fields.groundElevationM;
  // Two ghost columns on each side keep seam derivatives identical on both sides.
  const wrap = x => (x % w + w) % w;
  const evaluate = createPeriodicHermiteField(source, w, h);
  const northPole = source.slice(0, w).reduce((sum, v) => sum + v / w, 0), southPole = source.slice(-w).reduce((sum, v) => sum + v / w, 0);
  const anchoredDetail = isAnchoredDetailMethod(state.detail.method) ? createAnchoredSphericalDetail(state) : null;
  const rawFieldAt = createGlobalFieldEvaluator(state, source, evaluate, northPole, southPole, anchoredDetail);
  const riverAt=createSphericalRiverSampler(state.references.sea?state.references.rivers:null);
  const fieldAt=riverAt?point=>{const data=rawFieldAt(point),river=riverAt(point.latDeg,point.lonDeg,data.ground);return{...data,ground:river.groundElevationM,river,riverAdjustmentM:river.groundElevationM-data.ground};}:rawFieldAt;
  const planetWater = createPlanetWaterSampler(state.references.sea, state.references.sea ? state.references.lakes ?? [] : [], state.grid, state.references.localPonds);
  const featuresByCell = new Map();
  for (const f of state.references.features ?? []) for (const i of new Set(f.cellIndices)) {
    const ids = featuresByCell.get(i) ?? []; ids.push(f.id); featuresByCell.set(i, ids);
  }
  function waterAt(point,data){const water=planetWater(point.latDeg,point.lonDeg,data.ground),river=data.river;
    return selectBasePlanetWater(water,river);
  }
  function groundElevationAt(latDeg, lonDeg) { return fieldAt(geographicPoint(latDeg, lonDeg)).ground; }
  function samplePoint(latDeg, lonDeg, includeDerivatives) {
    const point = geographicPoint(latDeg, lonDeg), data = fieldAt(point), atPole = Math.abs(point.latDeg) === 90;
    const x = Math.min(w - 1, Math.floor(data.x)), y = Math.min(h - 1, Math.floor(data.y)), i = y * w + x;
    const macroIndex = Math.floor(y / (h / macroRows)) * macroColumns + Math.floor(x / (w / macroColumns));
    const outlet = state.fields.basinOutletCellIndex[i], d = state.derivativeStepM, radius = state.frame.radiusM;
    let derivatives={};
    if(includeDerivatives){const at = (east, north) => fieldAt(offsetGeographic(point, east, north, radius)).ground;
    const east = (at(d, 0) - at(-d, 0)) / (2 * d), north = (at(0, d) - at(0, -d)) / (2 * d);
    finiteNumber(east, 'east gradient'); finiteNumber(north, 'north gradient');derivatives={gradientEastNorth:{east:east||0,north:north||0},slopeMPerM:Math.hypot(east,north)};}
    return { worldId, sourceWorldId: state.sourceWorldId, ...point, groundElevationM: data.ground, baseGroundElevationM: data.base,
      detailElevationM: data.detail, ...(riverAt?{riverAdjustmentM:data.riverAdjustmentM}:{}), ...derivatives,
      ...(state.references.sea ? waterAt(point,data) : { hydrologyStatus: 'unresolved', surfaceKind: 'unresolved', waterLevelElevationM: null, waterSurfaceElevationM: null, waterDepthM: null }),
      ...(usesEnvironmentPolicy(state.references.environmentPolicy)?{riverEnvironment:riverAt?.nearby(point.latDeg,point.lonDeg,environmentRiverReach(state.references.environmentPolicy,riverAt),{includeValley:state.references.environmentPolicy===VALLEY_ENVIRONMENT_POLICY})??null}:{}),
      sourceCellIndex: atPole ? null : i, sourceMacroCellId: atPole ? null : state.references.macroCellIds[macroIndex],
      sourceLandMask: atPole ? null : state.fields.landMask[i], sourceLakeFillDepthM: atPole ? null : state.fields.lakeFillDepthM?.[i] ?? null,
      sourceRunoffIndex: atPole ? null : state.fields.runoffIndex?.[i] ?? null, sourceDownstreamCellIndex: atPole ? null : state.fields.downstream[i],
      outletCellIndex: atPole || outlet < 0 ? null : outlet,
      basinId: atPole || outlet < 0 ? null : `${state.sourceWorldId}/outlet:${outlet}`,
      basinStatus: atPole ? 'undefined-at-pole' : outlet < 0 ? 'unresolved-terminal' : 'source-drainage',
      geographicFeatureIds: atPole ? [] : [...(featuresByCell.get(macroIndex) ?? [])].sort() };
  }
  return Object.freeze({ schema: GLOBAL_TERRAIN_SCHEMA, worldId, sourceWorldId: state.sourceWorldId, frame: Object.freeze({ ...state.frame }),
    grid: Object.freeze({ ...state.grid }), derivativeStepM: state.derivativeStepM, hydrologyStatus: state.references.sea ? 'modeled' : 'unresolved',
    ...(anchoredDetail ? { detailLipschitzForLatitudeRange:(low,high)=>anchoredDetail.lipschitzForLatitudeRange(low,high)+localShoreSpatialGradient(state.detail,state.grid,state.frame.radiusM,[low,high]),detailLipschitzMPerM: anchoredDetail.lipschitzMPerM+localShoreSpatialGradient(state.detail,state.grid,state.frame.radiusM),...([MULTISCALE_SHORE_METHOD,LOCAL_SHORE_METHOD].includes(state.detail.method)?{detailBaseGradientMultiplier:multiscaleShoreGradient(state.detail)+(state.detail.shoreRegions?.length??0)*.75+state.detail.bands.reduce((n,b)=>n+(b.elevationActivationM?1.5*b.amplitudeM/(b.elevationActivationM[1]-b.elevationActivationM[0]):0),0)}:{}),...(state.detail.method===SHORE_DETAIL_METHOD?{detailBaseGradientMultiplier:shoreDetailConstraint(state.detail.shoreLevelsM,state.detail.bands.reduce((n,b)=>n+b.amplitudeM,0)).baseGradientMultiplier}:{}) } : {}),
    rawGroundElevationAt:(lat,lon)=>rawFieldAt(geographicPoint(lat,lon)).ground, groundElevationAt, sampleAt:(lat,lon)=>samplePoint(lat,lon,true),sampleSurfaceAt:(lat,lon)=>samplePoint(lat,lon,false), toSnapshot: () => ({ ...cloneJson(state), worldId }) });
}

/** Imports the fine physical grid, not the mixed land/sea macro averages. */
export function fromGeographyLite(world, { radiusM, sourceVerticalDatum, verticalDatum, elevationOffsetM = 0, derivativeStepM = 1,
  detailBands = [], detailMethod = ANCHORED_DETAIL_METHOD } = {}) {
  if (world?.schema !== 'project-toki-geography@0.10.0' || world.physical?.schema !== 'project-toki-physical-geography@0.10.0') throw new TypeError('Unsupported geography-lite source schema');
  const p = world.physical;
  if (!((typeof world.geographySeed === 'string' && world.geographySeed.trim()) || (typeof world.geographySeed === 'number' && Number.isFinite(world.geographySeed)))) throw new TypeError('Geography seed must be text or a finite number');
  if (world.physicalGrid?.[0] !== p.width || world.physicalGrid?.[1] !== p.height || world.cells?.length !== world.width * world.height) throw new RangeError('Geography grid dimensions disagree');
  if (p.macroScale?.x !== p.width / world.width || p.macroScale?.y !== p.height / world.height) throw new RangeError('Geography macro subdivision disagrees');
  for (let i = 0; i < world.cells.length; i++) if (world.cells[i].index !== i || world.cells[i].x !== i % world.width || world.cells[i].y !== Math.floor(i / world.width)) throw new RangeError('Macro cell positions disagree with canonical indices');
  return createGlobalTerrain({ schema: GLOBAL_TERRAIN_SCHEMA, seed: String(world.geographySeed), revision: 'geography-lite-import@1',
    frame: { radiusM, sourceVerticalDatum, verticalDatum, elevationOffsetM }, derivativeStepM,
    grid: { columns: p.width, rows: p.height, macroColumns: world.width, macroRows: world.height },
    fields: { groundElevationM: p.elevationM, landMask: p.landMask, downstream: p.downstream, lakeFillDepthM: p.lakeDepthM, runoffIndex: p.riverFlow },
    detail: { method: detailMethod, bands: detailBands }, references: { source: 'geography-lite', sourceSchema: world.schema,
      physicalSchema: p.schema, macroCellIds: world.cells.map(c => c.id),
      features: (world.features ?? []).map(f => ({ id: f.id, type: f.type, name: f.name, cellIndices: f.cellIndices })) } });
}
export function serializeGlobalTerrain(terrain) { return JSON.stringify(terrain.toSnapshot()); }
export function restoreGlobalTerrain(input) {
  const saved = typeof input === 'string' ? JSON.parse(input) : input;
  if (typeof saved?.worldId !== 'string') throw new TypeError('Saved global terrain needs a worldId');
  return createGlobalTerrain(saved);
}

/** A bounded chart reading the global evaluator directly, rather than a resampled grid. */
export function createProjectedTerrainView(global, { centerLatDeg, centerLonDeg, maxRadiusM,
  bounds = { minXM: -5000, minYM: -5000, maxXM: 5000, maxYM: 5000 } } = {}) {
  if (![GLOBAL_TERRAIN_SCHEMA, GLOBAL_WATER_TERRAIN_SCHEMA, GLOBAL_MULTI_WATER_TERRAIN_SCHEMA, GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA].includes(global?.schema)) throw new TypeError('Projected view requires global terrain');
  const projection = createSphericalProjection({ centerLatDeg, centerLonDeg, radiusM: global.frame.radiusM, maxRadiusM });
  const area = Object.fromEntries(['minXM', 'minYM', 'maxXM', 'maxYM'].map(k => [k, finiteNumber(bounds[k], k) || 0]));
  if (area.minXM >= area.maxXM || area.minYM >= area.maxYM) throw new RangeError('Projected bounds must have positive area');
  const d = global.derivativeStepM;
  for (const x of [area.minXM, area.maxXM]) for (const y of [area.minYM, area.maxYM]) {
    if (Math.hypot(x, y) + 2 * d > projection.contract.maxRadiusM) throw new RangeError('View bounds need a derivative margin inside the projection radius');
  }
  const contract = { schema: PROJECTED_TERRAIN_SCHEMA, worldId: global.worldId, projection: { ...projection.contract }, bounds: area };
  const regionId = hash(contract), frame = Object.freeze({ ...projection.contract, verticalDatum: global.frame.verticalDatum });
  function check(x, y) {
    finiteNumber(x, 'xM'); finiteNumber(y, 'yM');
    if (x < area.minXM || x > area.maxXM || y < area.minYM || y > area.maxYM) throw new RangeError('Point outside projected region');
  }
  const groundAt = (x, y) => { const p = projection.toGeographic(x, y); return global.groundElevationAt(p.latDeg, p.lonDeg); };
  function groundElevationAt(x, y) { check(x, y); return groundAt(x, y); }
  function sampleAt(xM, yM) {
    check(xM, yM); const p = projection.toGeographic(xM, yM), source = global.sampleAt(p.latDeg, p.lonDeg);
    const gx = (groundAt(xM + d, yM) - groundAt(xM - d, yM)) / (2 * d), gy = (groundAt(xM, yM + d) - groundAt(xM, yM - d)) / (2 * d);
    finiteNumber(gx, 'projected gradient x'); finiteNumber(gy, 'projected gradient y');
    return { ...source, regionId, xM, yM, gradient: { x: gx || 0, y: gy || 0 }, slopeMPerM: Math.hypot(gx, gy) };
  }
  function surfaceFrameAt(x, y) {
    const sample = sampleAt(x, y);
    return { ...sample, normal: unitNormalForGradient(sample.gradient),
      curvature: fixedStencilCurvature(groundAt, x, y, sample.groundElevationM, sample.gradient, d),
      curvatureStatus: 'fixed-distance-projected-estimate' };
  }
  function sampleWindow({ minXM, minYM, maxXM, maxYM, spacingM } = {}) {
    check(minXM, minYM); check(maxXM, maxYM); finiteNumber(spacingM, 'spacingM');
    const width = maxXM - minXM, height = maxYM - minYM, nx = Math.round(width / spacingM), ny = Math.round(height / spacingM);
    if (minXM + spacingM === minXM || minYM + spacingM === minYM || maxXM - spacingM === maxXM || maxYM - spacingM === maxYM) throw new RangeError('Projected spacing is not representable');
    if (spacingM <= 0 || width <= 0 || height <= 0 || !Number.isSafeInteger(nx) || !Number.isSafeInteger(ny) || nx < 1 || ny < 1
      || Math.abs(nx * spacingM - width) > Math.max(1, width) * 1e-10 || Math.abs(ny * spacingM - height) > Math.max(1, height) * 1e-10
      || (nx + 1) * (ny + 1) > MAX_WINDOW) throw new RangeError('Invalid or oversized projected sampling window');
    const samples = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) samples.push(sampleAt(i === nx ? maxXM : minXM + i * spacingM, j === ny ? maxYM : minYM + j * spacingM));
    return { worldId: global.worldId, regionId, columns: nx + 1, rows: ny + 1,
      bounds: { minXM, minYM, maxXM, maxYM }, spacingM, samples };
  }
  const hasSurfaceEvents = Boolean((global.surfaceEventProjections ?? [global.surfaceEventProjection])
    .some(p => p && sameProjectionAxes(projection.contract, p)));
  const tracePrecision = [GLOBAL_TERRAIN_SCHEMA, GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA].includes(global.schema) ? 'bounded projected centerline probes; water unresolved; no mesh/body events'
    : hasSurfaceEvents ? 'mesh/body/coverage events and bounded projected centerline probes; partial explicit water coverage'
      : 'bounded projected centerline probes; partial explicit water coverage; no mesh/body events in this projection';
  function traceSurfaceSegment(a, b, { maxStepM = 2, maxSamples = MAX_TRACE_SAMPLES } = {}) {
    check(a?.xM, a?.yM); check(b?.xM, b?.yM);
    const plan = surfaceTracePlan(a, b, maxStepM, maxSamples), { marks } = plan;
    if (hasSurfaceEvents) for (const t of global.segmentSurfaceEvents(a, b, projection.contract)) marks.add(t);
    return completeSurfaceTrace(plan, { worldId: global.worldId, regionId, maxStepM, maxSamples,
      precision: tracePrecision, sampleAt });
  }
  return Object.freeze({ worldId: global.worldId, regionId, frame, bounds: Object.freeze({ ...area }), hydrologyStatus: global.hydrologyStatus,
    toGeographic: projection.toGeographic, toLocal: projection.toLocal, groundElevationAt, sampleAt, surfaceFrameAt, sampleWindow,
    traceSurfaceSegment, tracePrecision,
    toSnapshot: () => ({ ...cloneJson(contract), world: global.toSnapshot(), regionId }) });
}
export function restoreProjectedTerrainView(input) {
  const saved = typeof input === 'string' ? JSON.parse(input) : input;
  if (saved?.schema !== PROJECTED_TERRAIN_SCHEMA || typeof saved.regionId !== 'string') throw new TypeError('Saved projected terrain needs a regionId');
  if (saved.projection?.kind !== 'spherical-azimuthal-equidistant@1') throw new TypeError('Unsupported saved projection');
  const global = restoreGlobalTerrain(saved.world);
  if (saved.worldId !== global.worldId || saved.projection.radiusM !== global.frame.radiusM) throw new Error('Projected/global world contract mismatch');
  const view = createProjectedTerrainView(global, { ...saved.projection, bounds: saved.bounds });
  if (view.regionId !== saved.regionId) throw new Error('Projected regionId mismatch');
  return view;
}
