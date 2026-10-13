import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { restoreGlobalTerrain, createProjectedTerrainView, exportProjectedCanonicalRegion } from '../global-terrain.mjs';
import { createTerrainAdapter, restoreTerrain, serializeTerrain } from '../index.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
const [mode, sourcePath, site, snapshotPath, witnessPath] = process.argv.slice(2), started = performance.now();
const sites = { 'date-line': [0, 180], 'source-seam': [12, 0], 'north-pole': [90, 0], 'south-pole': [-90, 0] };
const bounds = { minXM: -6000, minYM: -6000, maxXM: 6000, maxYM: 6000 }, near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7);
const roadOptions = { roads: [{ id: 'export-road', points: [{ xM: -1000, yM: 300 }, { xM: 1000, yM: 300 }] }], maxStepM: 500 };
if (mode === 'reopen') {
  // Reopen the finite canonical export alone; neither global terrain nor a generator is invoked.
  const terrain = restoreTerrain(readFileSync(snapshotPath, 'utf8')), saved = JSON.parse(readFileSync(witnessPath, 'utf8'));
  for (const p of saved.frames) assert.deepEqual(terrain.surfaceFrameAt(p.xM, p.yM), p);
  assert.deepEqual(inspectRoadCrossings(terrain, roadOptions), saved.roads);
  assert.deepEqual(terrain.toSnapshot().references.projectedSource, saved.sourceMetadata);
  console.log(JSON.stringify({ worldId: terrain.worldId, separateProcess: true, framesCompared: saved.frames.length,
    sourceCellsCompared: saved.sourceMetadata.sourceCellIndices.length, roadInspectionsCompared: 1,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else if (mode === 'capture') {
  const global = restoreGlobalTerrain(readFileSync(sourcePath, 'utf8')), before = JSON.stringify(global.toSnapshot());
  const [centerLatDeg, centerLonDeg] = sites[site], view = createProjectedTerrainView(global, { centerLatDeg, centerLonDeg, bounds });
  const snapshot = exportProjectedCanonicalRegion(view, { cellSizeM: 200 }), base = createTerrainAdapter(snapshot);
  let centersCompared = 0;
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
    const p = view.sampleAt(-6000 + (x + .5) * 200, -6000 + (y + .5) * 200), i = y * 60 + x;
    assert.equal(base.groundElevationAt(p.xM, p.yM), p.groundElevationM);
    assert.equal(snapshot.references.projectedSource.sourceBasinIds[i], p.basinId);
    assert.equal(snapshot.references.projectedSource.sourceOutletCellIndices[i], p.outletCellIndex); centersCompared++;
    assert.deepEqual(snapshot.references.projectedSource.sourceFeatureIdsByCell[i], p.geographicFeatureIds);
  }
  let maxObservedApproximationDifferenceM = 0;
  for (const x of [-5900, -3000, -10.3, 10.3, 3000, 5900]) for (const y of [-5900, -2000, -17.2, 17.2, 2000, 5900]) {
    maxObservedApproximationDifferenceM = Math.max(maxObservedApproximationDifferenceM,
      Math.abs(base.groundElevationAt(x, y) - view.groundElevationAt(x, y)));
  }
  const role = site.includes('pole') ? 'groundwater' : 'surface'; delete snapshot.worldId;
  snapshot.fields.waterLevelRole = role;
  snapshot.fields.waterLevelElevationM = snapshot.fields.groundElevationM.map(z => z + (role === 'surface' ? .5 : -4));
  const nodes = [{ id: 'source-a', xM: -600, yM: -1800 }, { id: 'source-b', xM: 600, yM: -1800 },
    { id: 'join', xM: 0, yM: -600 }, { id: 'out', xM: 0, yM: 1800 }];
  const edge = (id, a, b) => ({ id, from: nodes[a].id, to: nodes[b].id, points: [nodes[a], nodes[b]] });
  const terrain = connectSurfaceWater(createTerrainAdapter(snapshot), { riverGraph: { nodes,
    edges: [edge('a', 0, 2), edge('b', 1, 2), edge('joined', 2, 3)] } });
  const model = terrain.toSnapshot().hydrology; let profilePointsCompared = 0, waterSamples = 0;
  for (const edge of model.edges) for (let i = 1; i < edge.points.length; i++) {
    assert.ok(edge.points[i].waterLevelElevationM <= edge.points[i - 1].waterLevelElevationM + 1e-8); profilePointsCompared++;
    const p = terrain.sampleAt(edge.points[i].xM, edge.points[i].yM);
    assert.ok(p.waterDepthM > 0); near(p.waterSurfaceElevationM - p.groundElevationM, p.waterDepthM); waterSamples++;
    if (role === 'groundwater') assert.ok(p.groundwaterLevelElevationM !== null);
  }
  const join = model.nodes.find(n => n.id === 'join');
  for (const e of model.edges) {
    const p = e.from === join.id ? e.points[0] : e.to === join.id ? e.points.at(-1) : null;
    if (p) assert.equal(p.waterLevelElevationM, join.waterLevelElevationM);
  }
  const coarse = terrain.sampleWindow({ ...bounds, spacingM: 2000 }), fine = new Map(terrain.sampleWindow({ ...bounds, spacingM: 400 }).samples.map(p => [`${p.xM},${p.yM}`, p]));
  const frames = [];
  for (const p of coarse.samples) { assert.deepEqual(p, fine.get(`${p.xM},${p.yM}`)); frames.push(terrain.surfaceFrameAt(p.xM, p.yM)); }
  const left = terrain.sampleWindow({ ...bounds, maxXM: 0, spacingM: 400 }), right = terrain.sampleWindow({ ...bounds, minXM: 0, spacingM: 400 });
  const seam = left.samples.filter(p => p.xM === 0); assert.deepEqual(seam, right.samples.filter(p => p.xM === 0));
  for (const p of seam) frames.push(terrain.surfaceFrameAt(p.xM, p.yM));
  for (const y of [-400, 0, 400, 1000]) frames.push(terrain.surfaceFrameAt(0, y));
  const roads = inspectRoadCrossings(terrain, roadOptions), sourceMetadata = terrain.toSnapshot().references.projectedSource;
  assert.deepEqual(sourceMetadata, snapshot.references.projectedSource); assert.equal(JSON.stringify(global.toSnapshot()), before);
  writeFileSync(snapshotPath, serializeTerrain(terrain)); writeFileSync(witnessPath, JSON.stringify({ frames, roads, sourceMetadata }));
  console.log(JSON.stringify({ site, worldId: terrain.worldId, sourceGlobalWorldId: global.worldId, exportedBaseWorldId: base.worldId,
    canonicalGrid: [60, 60, 200], centersCompared, maxObservedApproximationDifferenceM, waterLevelRole: role,
    profilePointsCompared, waterSamples, confluencesCompared: 1, profileRiseViolations: 0, depthViolations: 0,
    lodComparedPoints: coarse.samples.length, adjacentBoundaryPoints: seam.length, persistedFrames: frames.length,
    sourceInputUnchanged: true, maxCenterIncisionM: model.diagnostics.maxCenterIncisionM,
    durationMs: performance.now() - started, maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} else throw new TypeError('Unknown canonical export mode');
