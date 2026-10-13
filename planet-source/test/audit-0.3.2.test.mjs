import test from 'node:test';
import assert from 'node:assert/strict';
import { globalFixture, detailBands } from '../fixtures/global-scenarios.mjs';
import { createProjectedTerrainView, exportProjectedCanonicalRegion, restoreGlobalTerrain } from '../global-terrain.mjs';
import { createTerrainAdapter, restoreTerrain, serializeTerrain } from '../index.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { connectGlobalSurfaceWater } from '../global-water.mjs';
import { regionalDrainageGraph } from '../dynamic-drainage.mjs';
import { fromDynamicRegionalWater } from '../dynamic-regional.mjs';
import { createProjectedGroundBounds, PROJECTED_GROUND_BOUNDS_METHOD, LEGACY_PROJECTED_GROUND_BOUNDS_METHOD } from '../projected-ground-bounds.mjs';
import { createSphericalProjection } from '../spherical.mjs';
import { copyJson, cloneJson, hashJson } from '../json-contract.mjs';
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const flat = () => globalFixture({ height: () => 100 });
const bounds = { minXM: -1000, minYM: -1000, maxXM: 1000, maxYM: 1000 };
const graph = () => ({ nodes: [{ id: 'a', xM: 0, yM: -500 }, { id: 'b', xM: 0, yM: 500 }],
  edges: [{ id: 'river', from: 'a', to: 'b', points: [{ xM: 0, yM: -500 }, { xM: 0, yM: 500 }] }] });

test('canonical export preserves exact source centers, datum and source IDs at seams and poles', () => {
  const base = globalFixture({ bands: detailBands }), original = base.toSnapshot();
  for (const [lat, lon] of [[0, 180], [12, 0], [90, 0], [-90, 0]]) {
    const view = createProjectedTerrainView(base, { centerLatDeg: lat, centerLonDeg: lon, bounds });
    const snapshot = exportProjectedCanonicalRegion(view, { cellSizeM: 400 }), finite = createTerrainAdapter(snapshot);
    const meta = snapshot.references.projectedSource; assert.equal(meta.worldId, base.worldId);
    assert.equal(meta.regionId, view.regionId); assert.equal(snapshot.frame.verticalDatum, view.frame.verticalDatum);
    assert.notEqual(finite.worldId, view.worldId); assert.equal(finite.hydrologyStatus, 'unresolved');
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const xM = -1000 + (x + .5) * 400, yM = -1000 + (y + .5) * 400, p = view.sampleAt(xM, yM), i = y * 5 + x;
      assert.equal(finite.groundElevationAt(xM, yM), p.groundElevationM);
      assert.equal(meta.sourceCellIndices[i], p.sourceCellIndex); assert.equal(meta.sourceBasinIds[i], p.basinId);
      assert.equal(meta.sourceOutletCellIndices[i], p.outletCellIndex); assert.equal(meta.sourceMacroCellIds[i], p.sourceMacroCellId);
      assert.deepEqual(meta.sourceFeatureIdsByCell[i], p.geographicFeatureIds);
      for (const id of p.geographicFeatureIds) assert.ok(meta.geographicFeatures.some(f => f.id === id));
    }
    const coarse = finite.sampleWindow({ ...bounds, spacingM: 400 }), fine = new Map(finite.sampleWindow({ ...bounds, spacingM: 100 }).samples.map(p => [`${p.xM},${p.yM}`, p]));
    for (const p of coarse.samples) assert.deepEqual(p, fine.get(`${p.xM},${p.yM}`));
    const reopened = restoreTerrain(serializeTerrain(finite)); assert.deepEqual(reopened.surfaceFrameAt(12.5, 17), finite.surfaceFrameAt(12.5, 17));
  }
  assert.deepEqual(base.toSnapshot(), original);
});
test('exported finite terrain accepts explicit groundwater and the existing river builder', () => {
  const view = createProjectedTerrainView(flat(), { centerLatDeg: 0, centerLonDeg: 180, bounds });
  const levels = Array(100).fill(95), refs = { roads: [{ id: 'road', points: [{ xM: -400, yM: 0 }, { xM: 400, yM: 0 }] }] };
  const snapshot = exportProjectedCanonicalRegion(view, { cellSizeM: 200, waterLevelElevationM: levels, waterLevelRole: 'groundwater', references: refs });
  const base = createTerrainAdapter(snapshot), water = connectSurfaceWater(base, { riverGraph: graph() });
  levels.fill(999); refs.roads[0].id = 'edited'; snapshot.fields.groundElevationM.fill(999);
  const p = water.sampleAt(0, 0); near(p.waterDepthM, 1.2); near(p.groundwaterLevelElevationM, 95);
  assert.equal(water.toSnapshot().references.roads[0].id, 'road');
  assert.deepEqual(restoreTerrain(serializeTerrain(water)).surfaceFrameAt(0, 0), water.surfaceFrameAt(0, 0));
});
test('exported caller surface-water grid composes after carving and has a separate identity', () => {
  const view = createProjectedTerrainView(flat(), { centerLatDeg: 0, centerLonDeg: 180, bounds });
  const snapshot = exportProjectedCanonicalRegion(view, { cellSizeM: 200, waterLevelElevationM: Array(100).fill(101), waterLevelRole: 'surface' });
  const terrain = connectSurfaceWater(createTerrainAdapter(snapshot), { riverGraph: graph() });
  near(terrain.sampleAt(400, 0).waterDepthM, 1); near(terrain.sampleAt(0, 0).waterDepthM, 2.35);
  assert.deepEqual(terrain.sampleAt(0, 0).waterSourceIds, ['water-level-grid']);
  assert.notEqual(snapshot.worldId, exportProjectedCanonicalRegion(view, { cellSizeM: 400 }).worldId);
});
test('export rejects unsupported coverage, invalid grids and unsafe references before sampling', () => {
  const view = createProjectedTerrainView(flat(), { centerLatDeg: 0, centerLonDeg: 180, bounds });
  for (const options of [{ cellSizeM: 0 }, { cellSizeM: 3 }, { cellSizeM: 1 }, { cellSizeM: 2000 },
    { cellSizeM: 200, bounds: { ...bounds, maxXM: 2000 } }]) assert.throws(() => exportProjectedCanonicalRegion(view, options), /Export/);
  assert.throws(() => exportProjectedCanonicalRegion(view, { cellSizeM: 200, references: { projectedSource: {} } }), /reserved/);
  assert.throws(() => exportProjectedCanonicalRegion(view, { cellSizeM: 200, waterLevelRole: 'groundwater' }), /waterLevelRole/);
  assert.throws(() => exportProjectedCanonicalRegion(view, { cellSizeM: 200, waterLevelElevationM: [NaN] }), /finite caller/);
  const world = connectGlobalSurfaceWater(flat(), { centerLatDeg: 0, centerLonDeg: 180, verticalDatum: 'fixture-zero', riverGraph: graph() });
  assert.throws(() => exportProjectedCanonicalRegion(createProjectedTerrainView(world, { centerLatDeg: 0, centerLonDeg: 180 }), { cellSizeM: 200 }), /export before/);
});

function drainage(paths, accumulation) {
  const w = 4, h = 4, receivers = Array(16).fill(-1), mask = Array(16).fill(0);
  for (const [from, to] of paths) { receivers[from] = to; mask[from] = 1; }
  return { seed: 'tangent-outflow', w, h, cell: 100, elevation: Array(16).fill(100), flowReceiver: receivers, riverMask: mask,
    riverGraph: { nodes: [], edges: [] }, settlements: [], roads: [], ...(accumulation ? { flowAccum: accumulation } : {}) };
}
const frame = { originXM: 1000, originYM: -2000 };
test('each corner continues north/south and east/west arrivals without axis priority', () => {
  for (const [terminal, vertical, horizontal, x, y] of [[0, 4, 1, 0, 0], [3, 7, 2, 3, 0], [12, 8, 13, 0, 3], [15, 11, 14, 3, 3]]) {
    for (const [parent, isVertical] of [[vertical, true], [horizontal, false]]) {
      const g = regionalDrainageGraph(drainage([[parent, terminal]]), frame), out = g.nodes.find(n => n.kind === 'regional-boundary');
      assert.equal(out.boundaryDirection.authority, 'inferred-incoming-tangent');
      assert.equal(out.xM, frame.originXM + (isVertical ? x + .5 : x === 0 ? 0 : 4) * 100);
      assert.equal(out.yM, frame.originYM + (isVertical ? y === 0 ? 0 : 4 : y + .5) * 100);
    }
  }
});
test('diagonal corner and side outlets are collinear with the incoming D8 segment', () => {
  for (const [parent, terminal] of [[5, 0], [6, 3], [9, 12], [10, 15], [5, 8], [9, 4], [6, 11], [10, 7]]) {
    const g = regionalDrainageGraph(drainage([[parent, terminal]]), frame), out = g.nodes.find(n => n.kind === 'regional-boundary');
    const dx = terminal % 4 - parent % 4, dy = Math.floor(terminal / 4) - Math.floor(parent / 4);
    near((out.xM - (frame.originXM + (terminal % 4 + .5) * 100)) * dy
      - (out.yM - (frame.originYM + (Math.floor(terminal / 4) + .5) * 100)) * dx, 0);
    assert.ok(out.xM === 1000 || out.xM === 1400 || out.yM === -2000 || out.yM === -1600);
  }
});
test('weighted arrivals and absent directions have explicit outflow authority', () => {
  const accumulation = Array(16).fill(0); accumulation[1] = 1; accumulation[4] = 3;
  const g = regionalDrainageGraph(drainage([[1, 0], [4, 0]], accumulation), frame), out = g.nodes.find(n => n.kind === 'regional-boundary');
  assert.equal(out.yM, -2000); near(out.xM, 1000 + 100 / 3);
  const source = drainage([]); source.riverMask[0] = 1;
  const fallback = regionalDrainageGraph(source, frame).nodes.find(n => n.kind === 'regional-boundary');
  assert.equal(fallback.boundaryDirection.authority, 'outward-normal-fallback'); assert.equal(fallback.xM, 1000); assert.equal(fallback.yM, -2000);
});
test('the repaired corner outlet remains open and wet through finite water save/reopen', () => {
  const terrain = fromDynamicRegionalWater(drainage([[4, 0]]), { verticalDatum: 'fixture-zero', ...frame });
  const snapshot = terrain.toSnapshot(); assert.equal(snapshot.hydrology.diagnostics.boundaryOutflowPolicy, 'incoming-tangent-or-outward-normal@1');
  assert.ok(terrain.sampleAt(1050, -2000).waterDepthM > 1.19); assert.equal(terrain.sampleAt(1000, -1950).waterDepthM, 0);
  assert.deepEqual(restoreTerrain(serializeTerrain(terrain)).surfaceFrameAt(1050, -2000), terrain.surfaceFrameAt(1050, -2000));
});
test('diagonal side and corner cuts keep both perimeter sides wet and restore identically', () => {
  for (const [parent, terminal] of [[5, 0], [6, 3], [9, 12], [10, 15], [5, 8], [6, 11]]) {
    const terrain = fromDynamicRegionalWater(drainage([[parent, terminal]]), { verticalDatum: 'fixture-zero', ...frame });
    const n = terrain.toSnapshot().hydrology.nodes.find(n => n.kind === 'regional-boundary'), b = terrain.bounds;
    const atX = n.xM === b.minXM || n.xM === b.maxXM, atY = n.yM === b.minYM || n.yM === b.maxYM;
    const probes = atX && atY ? [[n.xM, n.yM], [n.xM + (n.xM === b.minXM ? .9 : -.9), n.yM], [n.xM, n.yM + (n.yM === b.minYM ? .9 : -.9)]]
      : [-.9, 0, .9].map(d => atX ? [n.xM, n.yM + d] : [n.xM + d, n.yM]);
    const reopened = restoreTerrain(serializeTerrain(terrain));
    for (const [x, y] of probes) { assert.ok(terrain.sampleAt(x, y).waterDepthM > 0); assert.deepEqual(reopened.sampleAt(x, y), terrain.sampleAt(x, y)); }
  }
});

test('a 100km projection adapts rectangle probes while preserving conservative detailed bounds', () => {
  const base = globalFixture({ bands: detailBands }), projection = createSphericalProjection({ centerLatDeg: 15, centerLonDeg: 150, radiusM: base.frame.radiusM });
  const area = { minXM: -70000, minYM: -70000, maxXM: 70000, maxYM: 70000 }, analysis = createProjectedGroundBounds(base, projection, area);
  const range = analysis.rectangleBounds(area); assert.ok(range.adapted); assert.ok(range.probes <= 262144);
  assert.ok(range.effectiveStepXM > 20 && range.effectiveStepYM > 20); assert.equal(analysis.contract.method, PROJECTED_GROUND_BOUNDS_METHOD);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const z = analysis.ground(-70000 + i * 14000, -70000 + j * 14000); assert.ok(z >= range.min && z <= range.max);
  }
  const old = createProjectedGroundBounds(base, projection, area, 20, { method: LEGACY_PROJECTED_GROUND_BOUNDS_METHOD });
  assert.throws(() => old.rectangleBounds(area), /probe budget/);
});
test('long segments adapt their budget and include the linear level gradient in both bounds', () => {
  const base = flat(), projection = createSphericalProjection({ centerLatDeg: 0, centerLonDeg: 180, radiusM: base.frame.radiusM, maxRadiusM: 300000 });
  const area = { minXM: -150000, minYM: -100, maxXM: 150000, maxYM: 100 }, analysis = createProjectedGroundBounds(base, projection, area, 1);
  const range = analysis.ground.segmentMinimum({ xM: -150000, yM: 0 }, { xM: 150000, yM: 0 }, 90, 120);
  assert.ok(range.adapted); assert.equal(range.probes, 262144); assert.ok(range.minimum <= -20 && range.maximum >= 10);
  const zero = analysis.ground.segmentMinimum({ xM: 0, yM: 0 }, { xM: 0, yM: 0 }, 90, 120);
  assert.ok(zero.minimum <= -20 && zero.maximum >= 10);
});
test('strict JSON clones retain canonical order and reject non-JSON values in river inputs', () => {
  const value = { z: 1, a: [{ b: 2 }] }, clone = cloneJson(value); assert.equal(hashJson(clone), hashJson(value));
  assert.equal(Object.is(cloneJson(-0), -0), false);
  assert.deepEqual(Object.keys(copyJson(value)), ['a', 'z']); clone.a[0].b = 100; assert.equal(value.a[0].b, 2);
  for (const bad of [undefined, NaN, Infinity, new Date(), [ , 1]]) assert.throws(() => cloneJson(bad), /finite JSON/);
  const input = graph(); input.nodes[0].metadata = { missing: undefined };
  assert.throws(() => connectSurfaceWater(createTerrainAdapter(exportProjectedCanonicalRegion(createProjectedTerrainView(flat(), { centerLatDeg: 0, centerLonDeg: 180, bounds }), { cellSizeM: 200 })), { riverGraph: input }), /finite JSON/);
});
test('new adaptive global snapshots restore fitted channels and reject stale bounds/identity', () => {
  const world = connectGlobalSurfaceWater(flat(), { centerLatDeg: 0, centerLonDeg: 180, verticalDatum: 'fixture-zero', riverGraph: graph() });
  const snapshot = world.toSnapshot(); assert.equal(snapshot.waterChart.groundAnalysis.method, PROJECTED_GROUND_BOUNDS_METHOD);
  const saved = restoreGlobalTerrain(snapshot); for (const lon of [179.99999, 180, -179.99999]) assert.deepEqual(saved.sampleAt(0, lon), world.sampleAt(0, lon));
  snapshot.waterChart.groundAnalysis.method = LEGACY_PROJECTED_GROUND_BOUNDS_METHOD;
  assert.throws(() => restoreGlobalTerrain(snapshot), /worldId mismatch/);
});
