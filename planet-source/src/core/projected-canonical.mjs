import { createTerrainAdapter, SMOOTH_TERRAIN_SCHEMA } from './index.mjs';
import { restoreProjectedTerrainView, GLOBAL_TERRAIN_SCHEMA, PROJECTED_TERRAIN_SCHEMA } from './global-terrain.mjs';
import { copyJson } from './json-contract.mjs';
const MAX_EXPORT_SAMPLES = 262144;

/** Explicit finite approximation, with source provenance; never the direct sphere. */
export function exportProjectedCanonicalRegion(view, { bounds = view?.bounds, cellSizeM,
  interpolation = 'bounded-hermite-c1@1', derivativeStepM, references = {},
  waterLevelElevationM = null, waterLevelRole } = {}) {
  const saved = view?.toSnapshot?.();
  if (saved?.schema !== PROJECTED_TERRAIN_SCHEMA || saved.world?.schema !== GLOBAL_TERRAIN_SCHEMA) {
    throw new TypeError('Canonical export requires a projected base global terrain; export before adding a water chart');
  }
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) throw new RangeError('Export cellSizeM must be positive and finite');
  if (!['bilinear@1', 'bounded-hermite-c1@1'].includes(interpolation)) throw new TypeError('Unsupported export interpolation');
  const area = Object.fromEntries(['minXM', 'minYM', 'maxXM', 'maxYM'].map(k => [k, bounds?.[k]]));
  if (!Object.values(area).every(Number.isFinite) || area.minXM >= area.maxXM || area.minYM >= area.maxYM) throw new RangeError('Export bounds must have positive finite area');
  const columns = Math.round((area.maxXM - area.minXM) / cellSizeM), rows = Math.round((area.maxYM - area.minYM) / cellSizeM);
  if (![columns, rows].every(n => Number.isSafeInteger(n) && n >= 2) || columns * rows > MAX_EXPORT_SAMPLES
    || Math.abs(columns * cellSizeM - (area.maxXM - area.minXM)) > cellSizeM * 1e-9
    || Math.abs(rows * cellSizeM - (area.maxYM - area.minYM)) > cellSizeM * 1e-9) throw new RangeError('Export bounds must be whole cells with 2+ rows/columns and at most 262144 samples');
  for (const k of ['minXM', 'minYM']) if (area[k] < saved.bounds[k]) throw new RangeError('Export bounds exceed projected view');
  for (const k of ['maxXM', 'maxYM']) if (area[k] > saved.bounds[k]) throw new RangeError('Export bounds exceed projected view');
  area.maxXM = area.minXM + columns * cellSizeM; area.maxYM = area.minYM + rows * cellSizeM;
  if (area.maxXM > saved.bounds.maxXM || area.maxYM > saved.bounds.maxYM) throw new RangeError('Export canonical extent exceeds projected view');
  const d = derivativeStepM ?? saved.world.derivativeStepM;
  if (!Number.isFinite(d) || d <= 0) throw new RangeError('Export derivativeStepM must be positive and finite');
  for (const coordinate of Object.values(area)) {
    if (coordinate + cellSizeM / 2 === coordinate || coordinate - cellSizeM / 2 === coordinate
      || coordinate + d === coordinate || coordinate - d === coordinate) throw new RangeError('Export coordinates/derivative step are not representable');
  }
  const refs = copyJson(references);
  if (!refs || Object.getPrototypeOf(refs) !== Object.prototype) throw new TypeError('Export references must be a JSON object');
  if (Object.hasOwn(refs, 'projectedSource')) throw new TypeError('projectedSource is reserved for export provenance');
  // Validate caller water data before sampling, and never derive a level from masks.
  const count = columns * rows;
  if (waterLevelElevationM !== null && (!(Array.isArray(waterLevelElevationM) || ArrayBuffer.isView(waterLevelElevationM))
    || waterLevelElevationM.length !== count || !Array.from(waterLevelElevationM).every(Number.isFinite))) throw new RangeError('Export water level needs one finite caller value per cell');
  if (waterLevelRole != null && (!['surface', 'groundwater'].includes(waterLevelRole) || waterLevelElevationM === null)) throw new TypeError('Export waterLevelRole needs a matching caller water grid');
  const canonicalView = restoreProjectedTerrainView(saved), ground = [], sourceCells = [], sourceOutlets = [], sourceBasins = [], sourceMacroIds = [], sourceFeatureIds = [], usedFeatureIds = new Set();
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const p = canonicalView.sampleAt(area.minXM + (x + .5) * cellSizeM, area.minYM + (y + .5) * cellSizeM);
    ground.push(p.groundElevationM); sourceCells.push(p.sourceCellIndex); sourceOutlets.push(p.outletCellIndex);
    sourceBasins.push(p.basinId); sourceMacroIds.push(p.sourceMacroCellId);
    sourceFeatureIds.push(p.geographicFeatureIds);
    for (const id of p.geographicFeatureIds) usedFeatureIds.add(id);
  }
  const region = createTerrainAdapter({ schema: SMOOTH_TERRAIN_SCHEMA, interpolation,
    seed: saved.world.seed, revision: 'projected-canonical-export@1',
    frame: { kind: 'planar-metric', originXM: area.minXM, originYM: area.minYM, verticalDatum: canonicalView.frame.verticalDatum },
    grid: { columns, rows, cellSizeM, sampleLocation: 'cell-center' }, derivativeStepM: d,
    fields: { groundElevationM: ground, waterLevelElevationM, ...(waterLevelRole != null ? { waterLevelRole } : {}) },
    references: { ...refs, projectedSource: { method: 'cell-center-resample@1', worldId: canonicalView.worldId,
      sourceWorldId: saved.world.sourceWorldId, regionId: canonicalView.regionId, projection: saved.projection, bounds: area,
      hydrology: 'source-basins-only; no inferred water level or recomputed drainage',
      sourceCellIndices: sourceCells, sourceOutletCellIndices: sourceOutlets, sourceBasinIds: sourceBasins, sourceMacroCellIds: sourceMacroIds,
      sourceFeatureIdsByCell: sourceFeatureIds, geographicFeatures: (saved.world.references.features ?? [])
        .filter(f => usedFeatureIds.has(f.id)) } } });
  return region.toSnapshot();
}
