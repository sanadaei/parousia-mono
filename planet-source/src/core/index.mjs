import {createTriangularTerrain, TRIANGULAR_TERRAIN_SCHEMA} from './triangular-terrain.mjs';
export {createTriangularTerrain, TRIANGULAR_TERRAIN_SCHEMA} from './triangular-terrain.mjs';
import { finiteNumber as finite, positiveNumber as positive, nonEmptyText as text,
  integerDimension as dimension, copyNumericField as copyField } from './contract-validation.mjs';
import { copyJson, cloneJson, hashJson } from './json-contract.mjs';
import { compileSurfaceWater } from './water-model.mjs';
import { segmentGridCuts, quadraticVertex, composeSurfaceWater } from './field-math.mjs';
import { createHermiteField } from './hermite-field.mjs';
import { unitNormalForGradient, fixedStencilCurvature } from './surface-derivatives.mjs';
import { bernsteinExtrema } from './bernstein.mjs';
import { surfaceTracePlan, completeSurfaceTrace } from './surface-trace.mjs';
export { designRoadJunctions, inspectRoadGradeSeparations, createJunctionAdjustedTerrain, restoreJunctionAdjustedTerrain, JUNCTION_TERRAIN_SCHEMA } from './road-junctions.mjs';
export { inspectEarthworkDrainage } from './earthwork-drainage.mjs';
export { connectInterChartRivers } from './global-interchart-rivers.mjs';
export { adaptPostDetailDrainage, restorePostDetailDrainage, GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA } from './post-detail-drainage.mjs';

export const TERRAIN_SCHEMA = 'minimal-world-continuous-terrain@2';
export const LEGACY_TERRAIN_SCHEMA = 'minimal-world-continuous-terrain@1';
export const SMOOTH_TERRAIN_SCHEMA = 'minimal-world-continuous-terrain@3';
const MAX_GRID_SAMPLES = 1_048_576;
const MAX_WINDOW_SAMPLES = 262_144;

function normalize(input) {
  if (!input || ![TERRAIN_SCHEMA, LEGACY_TERRAIN_SCHEMA, SMOOTH_TERRAIN_SCHEMA].includes(input.schema)) throw new TypeError('Unsupported terrain schema');
  if (input.schema !== SMOOTH_TERRAIN_SCHEMA && input.interpolation != null) throw new TypeError('Explicit interpolation requires terrain schema @3');
  const interpolation = input.interpolation ?? 'bounded-hermite-c1@1';
  if (input.schema === SMOOTH_TERRAIN_SCHEMA && !['bilinear@1', 'bounded-hermite-c1@1'].includes(interpolation)) throw new TypeError('Unsupported field interpolation');
  if (input.frame?.kind !== 'planar-metric') throw new TypeError('frame.kind must be planar-metric');
  const columns = dimension(input.grid?.columns, 'grid.columns');
  const rows = dimension(input.grid?.rows, 'grid.rows');
  const count = columns * rows;
  if (!Number.isSafeInteger(count) || count > MAX_GRID_SAMPLES) {
    throw new RangeError(`Canonical grid exceeds ${MAX_GRID_SAMPLES} samples`);
  }
  const cellSizeM = positive(input.grid.cellSizeM, 'grid.cellSizeM');
  const originXM = finite(input.frame.originXM, 'frame.originXM');
  const originYM = finite(input.frame.originYM, 'frame.originYM');
  const maxX = originXM + columns * cellSizeM;
  const maxY = originYM + rows * cellSizeM;
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY) || maxX <= originXM || maxY <= originYM) {
    throw new RangeError('Metric grid extent is not representable');
  }
  for (const coordinate of [originXM, originYM, maxX, maxY]) {
    if (coordinate + cellSizeM / 2 === coordinate || coordinate - cellSizeM / 2 === coordinate) {
      throw new RangeError('Cell centers are not representable at this coordinate origin');
    }
  }
  const derivativeStepM = positive(input.derivativeStepM ?? 1, 'derivativeStepM');
  for (const coordinate of [originXM, originYM, maxX, maxY]) {
    if (coordinate + derivativeStepM === coordinate || coordinate - derivativeStepM === coordinate) {
      throw new RangeError('derivativeStepM is too small for this coordinate origin');
    }
  }
  return {
    schema: input.schema,
    seed: text(input.seed, 'seed'),
    revision: text(input.revision, 'revision'),
    frame: { kind: 'planar-metric', originXM, originYM,
      verticalDatum: text(input.frame.verticalDatum, 'frame.verticalDatum') },
    grid: { columns, rows, cellSizeM, sampleLocation: 'cell-center' },
    derivativeStepM,
    fields: {
      groundElevationM: copyField(input.fields?.groundElevationM, count, 'groundElevationM'),
      waterLevelElevationM: input.fields?.waterLevelElevationM == null ? null
        : copyField(input.fields.waterLevelElevationM, count, 'waterLevelElevationM'),
      ...(input.fields?.waterLevelRole != null ? { waterLevelRole: text(input.fields.waterLevelRole, 'waterLevelRole') } : {}),
    },
    references: copyJson(input.references ?? {}),
    ...(input.schema !== LEGACY_TERRAIN_SCHEMA ? { hydrology: copyJson(input.hydrology ?? null, 'hydrology') } : {}),
    ...(input.schema === SMOOTH_TERRAIN_SCHEMA ? { interpolation } : {}),
  };
}

/** A finite planar region. Rendering never changes these canonical source fields. */
function constructTerrainAdapter(input, fitWidths = false) {
  if (input?.grid?.sampleLocation != null && input.grid.sampleLocation !== 'cell-center') {
    throw new TypeError('Only cell-center grids are supported');
  }
  const state = normalize(input);
  const { columns, rows, cellSizeM } = state.grid;
  const { originXM, originYM } = state.frame;
  const bounds = Object.freeze({ minXM: originXM, minYM: originYM,
    maxXM: originXM + columns * cellSizeM, maxYM: originYM + rows * cellSizeM });
  const hasWaterLevel = state.fields.waterLevelElevationM !== null;
  const waterLevelRole = state.fields.waterLevelRole ?? 'surface';
  if (!['surface', 'groundwater'].includes(waterLevelRole)) throw new TypeError('waterLevelRole must be surface or groundwater');
  if (state.hydrology && hasWaterLevel && !state.fields.waterLevelRole) throw new TypeError('Combined water models require an explicit waterLevelRole');
  const smooth = state.interpolation === 'bounded-hermite-c1@1';

  function checkPoint(xM, yM) {
    finite(xM, 'xM'); finite(yM, 'yM');
    if (xM < bounds.minXM || xM > bounds.maxXM || yM < bounds.minYM || yM > bounds.maxYM) {
      throw new RangeError('Point is outside the canonical region');
    }
  }

  // A constant half-cell extension at the outer perimeter is explicit in the contract.
  // At the last cell center use the exact final value rather than w - 1.001.
  function interpolate(field, xM, yM) {
    const gx = Math.max(0, Math.min(columns - 1, (xM - originXM) / cellSizeM - 0.5));
    const gy = Math.max(0, Math.min(rows - 1, (yM - originYM) / cellSizeM - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(columns - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
    const tx = gx - x0, ty = gy - y0;
    const a = field[y0 * columns + x0] * (1 - tx) + field[y0 * columns + x1] * tx;
    const b = field[y1 * columns + x0] * (1 - tx) + field[y1 * columns + x1] * tx;
    return a * (1 - ty) + b * ty;
  }

  const baseGroundAt = smooth ? createHermiteField(state.fields.groundElevationM, state.grid, state.frame)
    : (xM, yM) => interpolate(state.fields.groundElevationM, xM, yM);
  const staticLevelAt = hasWaterLevel ? smooth
    ? createHermiteField(state.fields.waterLevelElevationM, state.grid, state.frame)
    : (xM, yM) => interpolate(state.fields.waterLevelElevationM, xM, yM) : null;
  const identity = () => hashJson(state);
  const preFitWorldId = fitWidths ? null : identity();
  // Reject altered saves before spending time rebuilding their spatial index.
  if (!fitWidths && input.worldId != null && input.worldId !== preFitWorldId) throw new Error('Snapshot worldId mismatch');
  const surfaceWater = state.hydrology ? compileSurfaceWater(state.hydrology, bounds, state.grid, state.frame, baseGroundAt, { fitWidths }) : null;
  // Width fitting only mutates our owned canonical copy, before identity is computed.
  const worldId = preFitWorldId ?? identity();
  const hasSurfaceDefinition = Boolean(surfaceWater) || (hasWaterLevel && waterLevelRole === 'surface');
  const groundAt = surfaceWater ? surfaceWater.sampleGround : baseGroundAt;
  function groundElevationAt(xM, yM) {
    checkPoint(xM, yM);
    return finite(groundAt(xM, yM), 'groundElevationM');
  }

  function sampleAt(xM, yM) {
    checkPoint(xM, yM);
    const water = surfaceWater?.sample(xM, yM);
    const groundElevationM = water?.groundElevationM ?? baseGroundAt(xM, yM);
    const d = state.derivativeStepM;
    const left = Math.max(bounds.minXM, xM - d), right = Math.min(bounds.maxXM, xM + d);
    const bottom = Math.max(bounds.minYM, yM - d), top = Math.min(bounds.maxYM, yM + d);
    const gx = (groundAt(right, yM) - groundAt(left, yM)) / (right - left);
    const gy = (groundAt(xM, top) - groundAt(xM, bottom)) / (top - bottom);
    const staticLevel = staticLevelAt?.(xM, yM) ?? null;
    const localLevel = water?.waterLevelElevationM ?? null;
    const { waterLevelElevationM, waterDepthM, waterSourceIds } = composeSurfaceWater(
      groundElevationM, localLevel, water?.waterSourceIds ?? [], staticLevel, waterLevelRole, hasSurfaceDefinition);
    const slopeMPerM = Math.hypot(gx, gy);
    if (!Number.isFinite(slopeMPerM) || !Number.isFinite(groundElevationM)
      || (waterDepthM !== null && !Number.isFinite(waterDepthM))) {
      throw new RangeError('Numeric range of terrain or water fields is too large');
    }
    const wet = waterDepthM !== null && waterDepthM > 0;
    return {
      worldId, xM, yM, groundElevationM,
      gradient: { x: gx, y: gy }, slopeMPerM,
      hydrologyStatus: surfaceWater ? 'modeled' : hasSurfaceDefinition ? 'defined' : 'unresolved',
      waterLevelElevationM,
      waterSurfaceElevationM: wet ? waterLevelElevationM : null,
      waterDepthM, surfaceKind: !hasSurfaceDefinition ? 'unresolved' : wet ? 'water' : 'ground',
      ...(state.fields.waterLevelRole ? { waterLevelRole, staticWaterLevelElevationM: staticLevel,
        groundwaterLevelElevationM: waterLevelRole === 'groundwater' ? staticLevel : null } : {}),
      ...(water ? { waterSourceIds, basinId: water.basinId,
        basinIndex: water.basinIndex, outletCellIndex: water.outletCellIndex } : {}),
    };
  }

  /** z is up; curvature is a fixed-distance diagnostic, not a C2 guarantee. */
  function surfaceFrameAt(xM, yM) {
    const sample = sampleAt(xM, yM), normal = unitNormalForGradient(sample.gradient);
    const d = state.derivativeStepM;
    if (xM - d < bounds.minXM || xM + d > bounds.maxXM || yM - d < bounds.minYM || yM + d > bounds.maxYM) {
      return { ...sample, normal, curvature: null, curvatureStatus: 'unavailable-at-region-edge' };
    }
    return { ...sample, normal, curvature: fixedStencilCurvature(groundAt, xM, yM, sample.groundElevationM, sample.gradient, d),
      curvatureStatus: 'fixed-distance-estimate' };
  }

  /** Inclusive vertex grid. Adjacent windows share their boundary vertices. */
  function sampleWindow({ minXM, minYM, maxXM, maxYM, spacingM } = {}) {
    checkPoint(minXM, minYM); checkPoint(maxXM, maxYM); positive(spacingM, 'spacingM');
    const width = maxXM - minXM, height = maxYM - minYM;
    if (width <= 0 || height <= 0) throw new RangeError('Window must have a positive area');
    if (minXM + spacingM === minXM || minYM + spacingM === minYM
      || maxXM - spacingM === maxXM || maxYM - spacingM === maxYM) {
      throw new RangeError('spacingM is too small for these coordinates');
    }
    const nx = Math.round(width / spacingM), ny = Math.round(height / spacingM);
    if (!Number.isSafeInteger(nx) || !Number.isSafeInteger(ny) || nx < 1 || ny < 1
      || Math.abs(nx * spacingM - width) > Math.max(1, width) * 1e-10
      || Math.abs(ny * spacingM - height) > Math.max(1, height) * 1e-10) {
      throw new RangeError('Window dimensions must be whole multiples of spacingM');
    }
    if ((nx + 1) * (ny + 1) > MAX_WINDOW_SAMPLES) {
      throw new RangeError(`Window exceeds ${MAX_WINDOW_SAMPLES} samples; use a smaller window or larger spacing`);
    }
    const samples = [];
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      samples.push(sampleAt(x === nx ? maxXM : minXM + x * spacingM,
        y === ny ? maxYM : minYM + y * spacingM));
    }
    return { worldId, bounds: { minXM, minYM, maxXM, maxYM }, spacingM,
      columns: nx + 1, rows: ny + 1, samples };
  }

  function toSnapshot() {
    return { ...cloneJson(state), worldId };
  }

  /** Mesh/body events plus bounded probes for road diagnostics, not a deck solver. */
  function traceSurfaceSegment(a, b, { maxStepM = 2, maxSamples = MAX_WINDOW_SAMPLES } = {}) {
    checkPoint(a?.xM, a?.yM); checkPoint(b?.xM, b?.yM);
    const plan = surfaceTracePlan(a, b, maxStepM, maxSamples), { marks } = plan;
    for (const t of surfaceWater?.segmentBreaks(a, b) ?? []) marks.add(t);
    for (const t of segmentGridCuts(a, b, state.grid, state.frame, maxSamples)) marks.add(t);
    return completeSurfaceTrace(plan, { worldId, maxStepM, maxSamples, sampleAt,
      refineInterval: (lo, hi, marks, pointAt) => {
        if (hasWaterLevel && waterLevelRole === 'surface') {
          if (smooth) {
            const pa = pointAt(lo), pb = pointAt(hi), level = staticLevelAt.segmentPolynomials(pa, pb);
            const ground = baseGroundAt.segmentPolynomials(pa, pb);
            for (let j = 0; j < level.length; j++) for (const depth of [false, true]) {
              const piece = level[j], controls = piece.controls.map((v, k) => v - (depth ? ground[j].controls[k] : 0));
              for (const t of bernsteinExtrema(controls)) marks.add(lo + (hi - lo) * (piece.lo + (piece.hi - piece.lo) * t));
            }
          } else {
            // Bilinear grid fields restrict to quadratics along a straight segment.
            for (const depth of [false, true]) {
              const value = t => { const p = pointAt(t); return staticLevelAt(p.xM, p.yM) - (depth ? baseGroundAt(p.xM, p.yM) : 0); };
              const f0 = value(lo), f1 = value(hi), fm = value((lo + hi) / 2);
              const vertex = quadraticVertex(f0, fm, f1, { epsilon: 1e-12 });
              if (vertex !== null) marks.add(lo + (hi - lo) * vertex);
            }
          }
        }
      } });
  }

  return Object.freeze({ worldId, bounds, frame: Object.freeze({ ...state.frame }),
    grid: Object.freeze({ ...state.grid }), hydrologyStatus: surfaceWater ? 'modeled' : hasSurfaceDefinition ? 'defined' : 'unresolved',
    sampleAt, surfaceFrameAt, groundElevationAt, sampleWindow, traceSurfaceSegment, toSnapshot });
}

export function createTerrainAdapter(input) {
  return input?.schema === TRIANGULAR_TERRAIN_SCHEMA ? createTriangularTerrain(input) : constructTerrainAdapter(input);
}

// Construction entry used by the water builder. Restores always validate saved widths.
export function buildTerrainWithSurfaceWater(input) {
  if (input?.worldId != null) throw new TypeError('Cannot refit a saved snapshot');
  if (!input?.hydrology) throw new TypeError('Surface water is required');
  return constructTerrainAdapter(input, true);
}

export function serializeTerrain(adapter) {
  return JSON.stringify(adapter.toSnapshot());
}

export function restoreTerrain(serialized) {
  const snapshot = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (typeof snapshot?.worldId !== 'string') throw new TypeError('Saved snapshot must have a worldId');
  return createTerrainAdapter(snapshot);
}

export { generatePlanet, GENERATED_RIVER_VALLEYS } from './planet-generation.mjs';
export { snapshotPlanetWorld, restorePlanetWorld, PLANET_WORLD_SCHEMA } from './planet-world.mjs';
export { derivePlanetHydrology } from './planet-hydrology.mjs';
export { inspectRoadCorridorClearance } from './road-corridors.mjs';

export { createRunoffState, runoffFromTerrain, stepRunoff, submergedPipeFlow } from './runoff-dynamics.mjs';

export { derivePlanetRivers, createSphericalRiverSampler, PLANET_RIVERS_SCHEMA, SMOOTH_RIVER_BED, LEGACY_SMOOTH_RIVER_BED, smoothIncisionUnion } from './planet-rivers.mjs';

export { assessBeamSpan, buildBridgeStructure, validateBridgeStructures, GENERATED_TIMBER } from './bridge-structures.mjs';

export { createPlanetRunoffScenario } from './planet-runoff.mjs';

export { traceVehicleTurn, inspectVehicleSweep, settlementVehicleObstacles } from './vehicle-sweep.mjs';

export { planCulvertRouting, validateCulvertRouting, mapCulvertRouting, CULVERT_ROUTING_SCHEMA, SIZED_CULVERT_ROUTING_SCHEMA, validateCulvertDesign } from './culvert-routing.mjs';

export { inspectVehicleSupport, planetVehicleSurface } from './vehicle-support.mjs';

export { CIRCULAR_CULVERT_MODEL, circularSection, circularCulvertFlow, validateCircularCulvert, sizeCircularCulvert } from './culvert-hydraulics.mjs';

export {inspectVehicleStability,bicycleAccelerationProfile} from './vehicle-stability.mjs';

export {mapSupportFaceObstructions,validateFaceObstructions,openFaceHead} from './runoff-obstacles.mjs';

export {assessSupportBase,inspectBridgeFoundations} from './bridge-foundations.mjs';

export { extendVillageRoads } from './village-roads.mjs';

export * from './road-cross-section.mjs';

export { PLANAR_C1_BED } from './planar-river-bed.mjs';

export {delineateGridCatchments,estimateCatchmentPeak,assessCatchmentCulverts} from './catchment-flow.mjs';
export {inspectPlanetCatchments} from './planet-catchments.mjs';

export {mapSupportStorage,compileStorage,runoffWaterDepths} from "./runoff-storage.mjs";

export {timeVehicleMotion,simulateVehicleDynamics} from "./vehicle-dynamics.mjs";
export {SETTLEMENT_CATALOGUE_METHOD,sitePopulationRegion,catalogueRegionBound,intersectsCatalogueRegion} from './settlement-catalogue.mjs';
export {createSettlementLayout} from './settlement-layout.mjs';
export {createTerritoryScenario,territoryAt,TERRITORY_SCENARIO} from './territory-scenario.mjs';

export {surveyRiverCrossingSites,commitRiverCrossingSites} from './river-crossing-sites.mjs';
export {encodeMaterializationArchive,decodeMaterializationArchive,MATERIALIZATION_ARCHIVE_LIMIT} from './materialization-archive.mjs';

export {createPlanetMacroTerrain,describeL0Region,EARTHLIKE_L0} from './planet-macro.mjs';
export {createL0SettlementDistribution,validateSettlementDistribution,describeSettlementDistribution,refineSettlementDistribution} from './settlement-distribution.mjs';
export * from './l2-settlement-handoff.mjs';
export {createL1SettlementSurveySurface} from './l1-settlement-survey-surface.mjs';

export {planRegionalDomains} from "./regional-domains.mjs";

export {solveRegionalDrainage} from "./regional-drainage.mjs";

export {createL1BroadRegion} from './l1-broad-region.mjs';

export {createL1WaterNetwork,clipL1WaterNetwork} from './l1-water-network.mjs';

export {createRegionalWaterContext,regionalWaterWindow,saveRegionalWaterWindow} from './regional-water-context.mjs';
export {refineRegionalWater,saveRegionalWaterRefinement} from './refine-regional-water.mjs';
export {refineWaterCandidate,reconcileWaterCandidate,saveWaterCandidate} from './refine-water-candidates.mjs';

export {createShapeFirstCandidateChannels} from './shape-first-channels.mjs';
export {L2_SETTLEMENT_DETAIL_SCHEMA,makeL2SettlementDetail,createL2SettlementSurface} from './l2-settlement-surface.mjs';
// The provisional orthogonal layout is a diagnostic fixture, not the adopted
// settlement-generation API. Diagnostic scripts import its module explicitly.
