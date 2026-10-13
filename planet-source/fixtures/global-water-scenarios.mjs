import { createGlobalTerrain, GLOBAL_TERRAIN_SCHEMA } from '../global-terrain.mjs';
export function sphericalBowlFixture() {
  // Deliberately synthetic source bowl, solely to verify an internal dry shore.
  const w = 64, h = 32, z = Array(w * h).fill(1000000); z[15 * w + 31] = 20;
  const base = createGlobalTerrain({ schema: GLOBAL_TERRAIN_SCHEMA, seed: 'spherical-bowl-fixture', revision: 'fixture@1',
    frame: { radiusM: 6371000, sourceVerticalDatum: 'fixture-zero', verticalDatum: 'fixture-zero', elevationOffsetM: 0 },
    grid: { columns: w, rows: h, macroColumns: w, macroRows: h }, derivativeStepM: 1,
    fields: { groundElevationM: z, landMask: Array(w * h).fill(0), downstream: Array(w * h).fill(-1) },
    detail: { bands: [] }, references: { macroCellIds: Array.from({ length: w * h }, (_, i) => `fixture-${i}`) } });
  return { base, centerLatDeg: 90 - 15.5 / h * 180, centerLonDeg: 31.5 / w * 360,
    bounds: { minXM: -6000, minYM: -6000, maxXM: 6000, maxYM: 6000 },
    verticalDatum: 'fixture-zero', riverGraph: { nodes: [], edges: [] }, groundBoundsStepM: 5,
    waterBodies: [{ id: 'explicit-bowl-lake', kind: 'lake', waterLevelElevationM: 50,
      polygon: [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]].map(([xM, yM]) => ({ xM, yM })) }] };
}
