import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTerrainAdapter, TERRAIN_SCHEMA } from '../index.mjs';
import { createRoadAdjustedTerrain } from '../road-earthwork.mjs';
import { inspectRoadGradeSeparations } from '../road-junctions.mjs';
import { loadScene, sceneBundleForExport } from '../src/ui/scene.mjs';
import { sceneJunctions } from '../src/ui/junctions.mjs';
import { terrainTrafficabilityAt } from '../src/ui/trafficability.mjs';
const [mode, folder] = process.argv.slice(2), dir = resolve(folder);
const bundlePath = resolve(dir, 'four-statuses.scene.json'), witnessPath = resolve(dir, 'four-statuses.witnesses.json');
let bundle;
if (mode === 'capture') {
  mkdirSync(dir, { recursive: true });
  const base = createTerrainAdapter({ schema: TERRAIN_SCHEMA, seed: 'four-crossing-statuses', revision: 'audit-0.3.4@1',
    frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'fixture-ground-100m' },
    grid: { columns: 32, rows: 32, cellSizeM: 10, sampleLocation: 'cell-center' }, derivativeStepM: 1,
    fields: { groundElevationM: Array(1024).fill(100), waterLevelElevationM: Array(1024).fill(99) } });
  const roads = [];
  for (const [i, [x, y, z, kind]] of [[50,50,100,'at-grade'], [250,50,105,'bridge-deck'],
    [50,250,102,'bridge-deck'], [250,250,100.2,'bridge-deck']].entries()) {
    roads.push({ id: `case-${i}/lower`, points: [{xM:x-40,yM:y,roadElevationM:100}, {xM:x+40,yM:y,roadElevationM:100}] },
      { id: `case-${i}/upper`, structureKind: kind, points: [{xM:x,yM:y-40,roadElevationM:z,structureKind:kind},
        {xM:x,yM:y+40,roadElevationM:z,structureKind:kind}] });
  }
  const profiles = roads.map(r => ({ roadId: r.id, halfWidthM: 3, samples: r.points.map((p,i) =>
    ({ ...p, distanceM: 80*i, structureKind: p.structureKind ?? 'at-grade' })) }));
  const terrain = createRoadAdjustedTerrain(base, profiles);
  bundle = { schema: 'minimal-world-ui-scene@1', label: 'Core crossing statuses: matched, clear, insufficient, collision',
    terrain: terrain.toSnapshot(), roadJunctions: inspectRoadGradeSeparations(roads) };
} else if (mode === 'reopen') bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
else throw new Error('Use capture or reopen');
const scene = await loadScene(bundle);
const points = [[50,50],[250,50],[50,250],[250,250],[250,260]];
const witnesses = { worldId: scene.worldId, roadAdjustmentId: scene.roadAdjustmentId, junctions: sceneJunctions(scene),
  samples: points.map(([x,y]) => ({ point: [x,y], sample: scene.terrain.sampleAt(x,y), trafficability: terrainTrafficabilityAt(scene.terrain,x,y) })) };
const serializable = JSON.parse(JSON.stringify(witnesses));
if (mode === 'capture') {
  writeFileSync(bundlePath, JSON.stringify(sceneBundleForExport(scene)));
  writeFileSync(witnessPath, JSON.stringify(serializable));
} else assert.deepEqual(serializable, JSON.parse(readFileSync(witnessPath, 'utf8')));
console.log(JSON.stringify({ worldId: scene.worldId, roadAdjustmentId: scene.roadAdjustmentId,
  statuses: witnesses.junctions.roadCrossings.map(c => c.status), samplesCompared: points.length, exact: true }));
