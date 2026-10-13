import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainAdapter, restoreTerrain, serializeTerrain } from '../index.mjs';
import { connectSurfaceWater, solveSurfaceWaterModel } from '../surface-water.mjs';
import { compileSurfaceWater } from '../water-model.mjs';
import { globalInput, globalFixture, detailBands } from '../fixtures/global-scenarios.mjs';
import { createGlobalTerrain, createProjectedTerrainView, restoreGlobalTerrain, restoreProjectedTerrainView, serializeGlobalTerrain } from '../global-terrain.mjs';
import { connectGlobalSurfaceWaterCharts } from '../global-water.mjs';
import { ANCHORED_DETAIL_METHOD } from '../spherical-detail.mjs';
import { createProjectedGroundBounds } from '../projected-ground-bounds.mjs';
import { createSphericalProjection } from '../spherical.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const finite = () => createTerrainAdapter({ schema: 'minimal-world-continuous-terrain@3', interpolation: 'bounded-hermite-c1@1',
  seed: 'audit-smooth', revision: 'fixture@1', frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'test' },
  grid: { columns: 6, rows: 6, cellSizeM: 100 }, derivativeStepM: .01,
  fields: { groundElevationM: Array.from({ length: 36 }, (_, i) => 100 + (i % 6 + .5)), waterLevelElevationM: null }, references: {} });
const graph = points => ({ nodes: [{ id: 'a', ...points[0] }, { id: 'b', ...points.at(-1) }],
  edges: [{ id: 'r', from: 'a', to: 'b', points }] });
const detailed = height => { const input = globalInput({ bands: detailBands, ...(height ? { height } : {}) });
  input.detail.method = ANCHORED_DETAIL_METHOD; return createGlobalTerrain(input); };
const bounds = { minXM: -1000, minYM: -1000, maxXM: 1000, maxYM: 1000 };
const river = x => graph([{ xM: x, yM: -500 }, { xM: x, yM: 500 }]);
const chart = (id, centerLatDeg, centerLonDeg) => ({ id, centerLatDeg, centerLonDeg, bounds,
  verticalDatum: 'fixture-zero', riverGraph: river(0) });

test('equal-level self crossing within one edge is rejected, including legacy constructions', () => {
  const base = finite(), saved = base.toSnapshot(), riverGraph = graph([{ xM: 100, yM: 100 }, { xM: 500, yM: 500 },
    { xM: 100, yM: 500 }, { xM: 500, yM: 100 }]);
  assert.throws(() => connectSurfaceWater(base, { riverGraph }), /self-overlap/);
  const old = solveSurfaceWaterModel(base, { riverGraph }, { grid: saved.grid, frame: saved.frame });
  old.construction = 'strip-with-directional-open-cuts@3';
  assert.throws(() => compileSurfaceWater(old, base.bounds, saved.grid, saved.frame, base.groundElevationAt), /self-overlap/);
});
test('nonadjacent wet corridors on the same edge cannot return through their own width', () => {
  const base = finite(), riverGraph = graph([{ xM: 100, yM: 100 }, { xM: 100, yM: 400 },
    { xM: 400, yM: 400 }, { xM: 400, yM: 100 }, { xM: 103, yM: 100 }, { xM: 103, yM: 300 }]);
  assert.throws(() => connectSurfaceWater(base, { riverGraph }), /self-overlap/);
});
test('nonoverlapping bends and adjacent mesh faces remain valid and survive saving', () => {
  const water = connectSurfaceWater(finite(), { riverGraph: graph([{ xM: 100, yM: 100 }, { xM: 100, yM: 300 },
    { xM: 300, yM: 400 }, { xM: 500, yM: 300 }]) });
  assert.equal(water.toSnapshot().hydrology.construction, 'strip-with-smooth-banks@4');
  assert.deepEqual(restoreTerrain(serializeTerrain(water)).surfaceFrameAt(100, 200), water.surfaceFrameAt(100, 200));
});
test('smooth bank joins match the base normal derivative while keeping positive center depth', () => {
  const base = finite(), water = connectSurfaceWater(base, { riverGraph: graph([{ xM: 250, yM: 100 }, { xM: 250, yM: 500 }]) });
  for (const sign of [-1, 1]) {
    const x = 250 + sign * 4.8, y = 300, z = water.groundElevationAt(x, y), eps = 1e-4;
    const left = (z - water.groundElevationAt(x - eps, y)) / eps;
    const right = (water.groundElevationAt(x + eps, y) - z) / eps;
    near(left, right, 2e-5); near(z, base.groundElevationAt(x, y));
    near(water.sampleAt(x, y).waterDepthM, 0);
  }
  near(water.sampleAt(250, 300).waterDepthM, 1.2);
});
test('new detail preserves centers, source identity and fixed amplitude even on flat ground', () => {
  for (const terrain of [detailed(), detailed(() => 100)]) {
    const saved = terrain.toSnapshot();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
      const p = terrain.sampleAt(90 - (y + .5) * 45, (x + .5) * 45);
      assert.equal(p.groundElevationM, saved.fields.groundElevationM[y * 8 + x]); assert.equal(p.detailElevationM, 0);
    }
    for (let i = 0; i < 100; i++) assert.ok(Math.abs(terrain.sampleAt(-90 + i * 1.8, i * 19).detailElevationM) <= 24 + 1e-8);
  }
  assert.equal(detailed().sourceWorldId, globalFixture({ bands: detailBands }).sourceWorldId);
  assert.notEqual(detailed().worldId, globalFixture({ bands: detailBands }).worldId);
});
test('detail survives source grid lines and both polar caps without a longitude seam', () => {
  const terrain = detailed(() => 100), points = [[0,22.5],[22.5,0],[80,33],[-80,33],[90,0],[-90,0]];
  for (const [lat, lon] of points) assert.ok(Math.abs(terrain.sampleAt(lat,lon).detailElevationM) > 1e-6, `${lat},${lon}`);
  assert.deepEqual(terrain.sampleAt(34,180), terrain.sampleAt(34,-180));
  assert.deepEqual(terrain.sampleAt(90,33), terrain.sampleAt(90,-73));
  assert.deepEqual(terrain.sampleAt(-90,33), terrain.sampleAt(-90,-73));
});
test('anchored noise retains matching one-sided derivatives across grid, seam and cap joins', () => {
  const terrain = detailed(), eps = 1e-7;
  for (const [lat, lon] of [[12,22.5],[12,0],[12,180],[67.5,33],[-67.5,33],[22.5,33]]) {
    const z = terrain.groundElevationAt(lat,lon);
    near((z-terrain.groundElevationAt(lat,lon-eps))/eps,(terrain.groundElevationAt(lat,lon+eps)-z)/eps,.02);
    near((z-terrain.groundElevationAt(lat-eps,lon))/eps,(terrain.groundElevationAt(lat+eps,lon)-z)/eps,.02);
  }
});
test('new detail participates in conservative projected ground bounds, including polar charts', () => {
  const terrain = detailed();
  for (const lat of [0,90,-90]) {
    const p = createSphericalProjection({ centerLatDeg:lat, centerLonDeg:180, radiusM:terrain.frame.radiusM });
    const analysis = createProjectedGroundBounds(terrain,p,bounds,200), range = analysis.rectangleBounds(bounds);
    for (let i = 0; i < 49; i++) { const q = p.toGeographic(-1000+i%7*1000/3,-1000+Math.floor(i/7)*1000/3);
      const z = terrain.groundElevationAt(q.latDeg,q.lonDeg); assert.ok(z >= range.min && z <= range.max); }
    assert.ok(analysis.contract.lipschitzMPerM >= terrain.detailLipschitzMPerM);
  }
});
test('noise method is saved and tampering cannot reuse the old global identity', () => {
  const terrain = detailed(), restored = restoreGlobalTerrain(serializeGlobalTerrain(terrain));
  assert.deepEqual(restored.sampleAt(80,33),terrain.sampleAt(80,33));
  const saved = terrain.toSnapshot(); saved.detail.method = 'bounded-spherical-bands@1';
  assert.throws(() => restoreGlobalTerrain(saved),/worldId mismatch/);
});
test('four independent charts share one source sphere and preserve unknown coverage elsewhere', () => {
  const base = globalFixture({ height:()=>100 }), charts = [chart('date',0,180),chart('seam',0,0),chart('north',90,0),chart('south',-90,0)];
  const water = connectGlobalSurfaceWaterCharts(base,{charts}), reopened = restoreGlobalTerrain(serializeGlobalTerrain(water));
  assert.equal(water.toSnapshot().waterCharts.length,4); assert.equal(water.sourceWorldId,base.sourceWorldId);
  for (const c of charts) {
    const view = createProjectedTerrainView(water,c), p = view.sampleAt(0,0);
    assert.equal(p.waterChartId,c.id); assert.ok(p.waterDepthM > 0); assert.deepEqual(p.waterSourceIds,[`${c.id}/r`]);
    assert.deepEqual(reopened.sampleAt(c.centerLatDeg,c.centerLonDeg),water.sampleAt(c.centerLatDeg,c.centerLonDeg));
    assert.deepEqual(restoreProjectedTerrainView(view.toSnapshot()).surfaceFrameAt(1,2),view.surfaceFrameAt(1,2));
  }
  const unknown = water.sampleAt(30,90); assert.equal(unknown.waterDepthM,null); assert.equal(unknown.waterChartId,null);
});
test('same-projection disjoint charts contribute both coverage and road crossing events', () => {
  const base = globalFixture({height:()=>100});
  const charts = [-1,1].map(sign=>({ ...chart(sign<0?'left':'right',0,0), bounds:{minXM:sign<0?-3000:1000,maxXM:sign<0?-1000:3000,minYM:-1000,maxYM:1000}, riverGraph:river(sign*2000) }));
  const water = connectGlobalSurfaceWaterCharts(base,{charts});
  const view = createProjectedTerrainView(water,{centerLatDeg:0,centerLonDeg:0,bounds:{minXM:-4000,maxXM:4000,minYM:-1000,maxYM:1000}});
  const roads = [{id:'both',points:[{xM:-3500,yM:0},{xM:3500,yM:0}]}];
  const report = inspectRoadCrossings(view,{roads,maxStepM:7000}); assert.equal(report.crossings.length,2);
  assert.deepEqual(report.crossings.map(c=>c.waterSourceIds),[['left/r'],['right/r']]);
  assert.ok(report.unresolvedWaterSamples > 0);
  assert.deepEqual(inspectRoadCrossings(restoreProjectedTerrainView(view.toSnapshot()),{roads,maxStepM:7000}),report);
});
test('overlap, touching coverage, duplicate IDs and excessive chart counts fail explicitly', () => {
  const base = globalFixture({height:()=>100});
  assert.throws(()=>connectGlobalSurfaceWaterCharts(base,{charts:[chart('one',0,0),chart('two',0,.001)]}),/disjoint coverage/);
  assert.throws(()=>connectGlobalSurfaceWaterCharts(base,{charts:[chart('one',0,0),chart('one',0,180)]}),/Duplicate/);
  assert.throws(()=>connectGlobalSurfaceWaterCharts(base,{charts:[]}),/1..16/);
  assert.throws(()=>connectGlobalSurfaceWaterCharts(base,{charts:Array.from({length:17},(_,i)=>chart(String(i),0,0))}),/1..16/);
});
test('multiple chart IDs are independent of input order and saved contents are owned', () => {
  const base = globalFixture({height:()=>100}), charts = [chart('b',0,180),chart('a',0,0)];
  const water = connectGlobalSurfaceWaterCharts(base,{charts});
  assert.equal(connectGlobalSurfaceWaterCharts(base,{charts:[...charts].reverse()}).worldId,water.worldId);
  charts[0].riverGraph.nodes[0].xM=30;
  const saved = water.toSnapshot(); saved.waterCharts[0].model.parameters.depthM=10;
  assert.throws(()=>restoreGlobalTerrain(saved),/worldId mismatch/);
  assert.equal(water.sampleAt(0,0).waterChartId,'a');
});
