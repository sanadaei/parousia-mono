import { createTerrainAdapter, serializeTerrain, restoreTerrain, TERRAIN_SCHEMA } from './index.mjs';
import { writeFileSync } from 'node:fs';

// A small analytic example with an explicit level water surface.
// This demonstrates the contract; it is not evidence of generated river/lake geometry.
const groundElevationM = [];
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  groundElevationM.push(100 + (x + 0.5) * 0.8 + (y + 0.5) * 1.6);
}
const terrain = createTerrainAdapter({
  schema: TERRAIN_SCHEMA, seed: 'analytic-example', revision: 'example@1',
  frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'example-zero' },
  grid: { columns: 8, rows: 8, cellSizeM: 10 }, derivativeStepM: 1,
  fields: { groundElevationM, waterLevelElevationM: Array(64).fill(110) },
  references: { source: 'analytic-example' },
});
const saved = serializeTerrain(terrain);
if (process.argv[2]) writeFileSync(process.argv[2], saved, { flag: 'wx' });
const restored = restoreTerrain(saved);
console.log(JSON.stringify({
  worldId: terrain.worldId,
  point: terrain.sampleAt(20.25, 15.5),
  coarseVertices: terrain.sampleWindow({ minXM: 10, minYM: 10, maxXM: 70, maxYM: 70, spacingM: 10 }).samples.length,
  fineVertices: terrain.sampleWindow({ minXM: 10, minYM: 10, maxXM: 70, maxYM: 70, spacingM: 1 }).samples.length,
  restoredPoint: restored.sampleAt(20.25, 15.5),
}, null, 2));
