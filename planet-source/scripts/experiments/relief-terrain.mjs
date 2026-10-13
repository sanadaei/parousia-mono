import { createTerrainAdapter, SMOOTH_TERRAIN_SCHEMA } from '../../src/core/index.mjs';

/** Use the existing canonical terrain format; do not invent another render field.
 * This is a local research surface, not a replacement for the planet drainage.
 * Routing area is deliberately NOT exposed as a river or water-level field.
 */
export function reliefTerrain(result, { seed, verticalDatum = 'synthetic-relief-datum' } = {}) {
  const r = result?.report;
  if (!r || !Number.isInteger(r.n) || r.n < 3 || r.n > 257 ||
      !Number.isFinite(r.extentM) || r.extentM <= 0 || r.extentM > 100000 ||
      result.heights?.length !== r.n * r.n || !result.heights.every(Number.isFinite)) {
    throw new TypeError('A bounded finite relief result is required');
  }
  const spacingM = r.extentM / (r.n - 1);
  return createTerrainAdapter({
    schema: SMOOTH_TERRAIN_SCHEMA,
    seed,
    revision: 'basin-graph-relief-research@1',
    interpolation: 'bounded-hermite-c1@1',
    // Solver vertices 0..extent are canonical cell centers. The extra half-cell
    // rim is a clamped support margin, not newly generated landscape.
    frame: { kind: 'planar-metric', originXM: -spacingM / 2,
      originYM: -spacingM / 2, verticalDatum },
    grid: { columns: r.n, rows: r.n, cellSizeM: spacingM },
    derivativeStepM: Math.min(1, spacingM / 20),
    fields: { groundElevationM: Array.from(result.heights) },
    references: {
      reliefResearch: {
        status: 'UNADOPTED local research surface',
        method: r.method,
        validInteriorM: { minXM: 0, minYM: 0, maxXM: r.extentM, maxYM: r.extentM },
        parameters: { steps: r.steps, dtYears: r.dtYears,
          erodibility: r.erodibility, areaExponent: r.areaExponent,
          upliftMPerYear: r.upliftMPerYear,
          ...(r.outlets?{outlets:r.outlets}:{}),
          ...(r.hillslopeDiffusivityM2PerYear>0?{hillslopeDiffusivityM2PerYear:r.hillslopeDiffusivityM2PerYear}:{}) },
        limitations: [
          'No regional boundary or spherical drainage integration',
          'Flow-routing edges are not physical water surfaces',
          'Grid-scale interpolation does not add unresolved cliffs or geology',
          'Simulation time is not a calibrated geological age',
        ],
      },
    },
  });
}
