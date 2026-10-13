import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainAdapter, SMOOTH_TERRAIN_SCHEMA, serializeTerrain, restoreTerrain } from '../index.mjs';
import { createHermiteField } from '../hermite-field.mjs';
import { bernsteinRoots, evaluateBernstein, hermiteSegmentMinimum } from '../bernstein.mjs';
import { quadraticVertex } from '../field-math.mjs';
import { validateBodyBoundaries } from '../water-model.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
import { createProjectedTerrainView, restoreProjectedTerrainView } from '../global-terrain.mjs';
import { globalFixture } from '../fixtures/global-scenarios.mjs';
import { baseTerrain, confluenceFixture, lakeOceanFixture, node, edge } from '../fixtures/water-scenarios.mjs';
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function c1Base(input) {
  const snapshot = input.toSnapshot(); delete snapshot.worldId;
  snapshot.schema = SMOOTH_TERRAIN_SCHEMA; snapshot.interpolation = 'bounded-hermite-c1@1'; snapshot.hydrology = null;
  return createTerrainAdapter(snapshot);
}
const data = [120, 181, 134, 161, 46, 60, 98, 72, 54, 28, 156, 78, 121, 58, 40, 67];
const grid = { columns: 4, rows: 4, cellSizeM: 100 }, frame = { originXM: 0, originYM: 0 };
const a = { xM: 150, yM: 150 }, b = { xM: 250, yM: 250 };
function depressionTerrain() {
  return createTerrainAdapter({ schema: SMOOTH_TERRAIN_SCHEMA, seed: 'missed-cubic-minimum', revision: 'regression@1',
    frame: { kind: 'planar-metric', ...frame, verticalDatum: 'fixture-zero' }, grid,
    fields: { groundElevationM: data, waterLevelElevationM: Array(16).fill(59) } });
}

test('Bernstein roots include repeated roots, endpoint roots and tiny scaled coefficients', () => {
  for (const scale of [1, 1e-250]) {
    const roots = bernsteinRoots([-.046875, .09895833333333333, -.171875, .140625].map(v => v * scale));
    assert.equal(roots.length, 2); near(roots[0], .25, 1e-10); near(roots[1], .75, 1e-10);
  }
  assert.deepEqual(bernsteinRoots([0, 1]), [0]); assert.deepEqual(bernsteinRoots([0, 0, 0]), []);
  assert.deepEqual(bernsteinRoots([1, 2, 1]), []);
});
test('C1 segment polynomials match the evaluator in both directions and outer extensions', () => {
  const field = createHermiteField(data, grid, frame);
  for (const [p, q] of [[a, b], [b, a], [{ xM: 0, yM: 60 }, { xM: 400, yM: 340 }],
    [{ xM: 200, yM: 400 }, { xM: 200, yM: 0 }], [{ xM: 0, yM: 0 }, { xM: 40, yM: 40 }], [a, a]]) {
    for (const piece of field.segmentPolynomials(p, q)) for (let j = 0; j <= 40; j++) {
      const t = j / 40, u = piece.lo + (piece.hi - piece.lo) * t;
      near(evaluateBernstein(piece.controls, t), field(p.xM * (1 - u) + q.xM * u, p.yM * (1 - u) + q.yM * u));
    }
  }
  assert.throws(() => field.segmentPolynomials({ xM: 0, yM: 0 }, { xM: 400, yM: 400 }, 3), /budget/);
});
test('cropped C1 control hulls bound interior heights across patches and perimeter shelves', () => {
  const field = createHermiteField(data, grid, frame);
  for (const rect of [{ minXM: 173, minYM: 151, maxXM: 236, maxYM: 237 },
    { minXM: 0, minYM: 0, maxXM: 400, maxYM: 400 }, { minXM: 0, minYM: 373, maxXM: 37, maxYM: 400 }]) {
    const bounds = field.rectangleBounds(rect); assert.ok(Number.isFinite(bounds.min) && Number.isFinite(bounds.max));
    for (let y = 0; y <= 40; y++) for (let x = 0; x <= 40; x++) {
      const z = field(rect.minXM + (rect.maxXM - rect.minXM) * x / 40, rect.minYM + (rect.maxYM - rect.minYM) * y / 40);
      assert.ok(z >= bounds.min - 1e-8 && z <= bounds.max + 1e-8);
    }
  }
});
test('roundoff next to cell-center cuts does not make C1 bounds or traces non-finite', () => {
  const heights = Array.from({ length: 64 }, (_, i) => Math.sin(i) * 100);
  const field = createHermiteField(heights, { columns: 8, rows: 8, cellSizeM: 120 }, frame);
  const rect = { minXM: 659.9999999999999, maxXM: 660, minYM: 180, maxYM: 300 };
  const bounds = field.rectangleBounds(rect); assert.ok(Number.isFinite(bounds.min) && Number.isFinite(bounds.max));
  for (const piece of field.segmentPolynomials({ xM: rect.minXM, yM: rect.minYM }, { xM: rect.maxXM, yM: rect.maxYM })) {
    assert.ok(piece.controls.every(Number.isFinite));
    near(evaluateBernstein(piece.controls, .5), field((rect.minXM + rect.maxXM) / 2, 240));
  }
});
test('C1 boundary validation rejects a wet minimum missed by endpoint/midpoint quadratic checks', () => {
  const field = createHermiteField(data, grid, frame), f0 = field(a.xM, a.yM), fm = field(200, 200), f1 = field(b.xM, b.yM);
  assert.equal(quadraticVertex(f0, fm, f1, { minimumOnly: true }), null); assert.ok(Math.min(f0, fm, f1) > 59);
  near(hermiteSegmentMinimum(field, a, b).minimum, 58.77412668090878);
  assert.throws(() => validateBodyBoundaries([{ id: 'wet-envelope', waterLevelElevationM: 59,
    polygon: [a, b, { xM: 250, yM: 150 }] }], { minXM: 0, minYM: 0, maxXM: 400, maxYM: 400 }, grid, frame, field), /Wet body envelope/);
});
test('C1 surface-grid traces find interior water even with coarse probes and restore identically', () => {
  const terrain = depressionTerrain(), trace = terrain.traceSurfaceSegment(a, b, { maxStepM: 1000 });
  assert.ok(trace.samples.some(p => p.waterDepthM > .22)); assert.equal(trace.samples[0].waterDepthM, 0);
  assert.equal(trace.samples.at(-1).waterDepthM, 0);
  const road = inspectRoadCrossings(terrain, { roads: [{ id: 'diagonal', points: [a, b] }], maxStepM: 1000 });
  assert.equal(road.crossings.length, 1); assert.equal(road.crossings[0].maxWaterLevelElevationM, 59);
  const restored = restoreTerrain(serializeTerrain(terrain)); assert.deepEqual(restored.traceSurfaceSegment(a, b, { maxStepM: 1000 }), trace);
});
test('C1 ground connects confluences with continuous shores, unchanged input and LOD/save parity', () => {
  const old = confluenceFixture().toSnapshot(), base = c1Base(baseTerrain()), before = base.toSnapshot();
  const graph = { nodes: old.hydrology.nodes, edges: old.hydrology.edges.map(e => ({ ...e, points: [e.points[0], e.points.at(-1)] })) };
  const water = connectSurfaceWater(base, { riverGraph: graph, channelSizing: { mode: 'strahler' } });
  assert.deepEqual(base.toSnapshot(), before); assert.equal(water.toSnapshot().interpolation, 'bounded-hermite-c1@1');
  assert.equal(water.toSnapshot().hydrology.diagnostics.groundBoundsMethod, 'cropped-bezier-control-hull@1');
  const join = water.sampleAt(250, 350), restored = restoreTerrain(serializeTerrain(water)); assert.ok(join.waterDepthM > 0);
  for (const e of water.toSnapshot().hydrology.edges) for (const p of e.points) {
    const sample = water.sampleAt(p.xM, p.yM); near(sample.waterSurfaceElevationM, p.waterLevelElevationM);
    assert.deepEqual(restored.surfaceFrameAt(p.xM, p.yM), water.surfaceFrameAt(p.xM, p.yM));
  }
  const half = water.toSnapshot().hydrology.edges[2].points[0].halfWidthM;
  near(water.sampleAt(250 + half - 1e-6, 500).groundElevationM, water.sampleAt(250 + half + 1e-6, 500).groundElevationM, 1e-4);
  const area = { minXM: 240, minYM: 490, maxXM: 260, maxYM: 510 };
  const fine = new Map(water.sampleWindow({ ...area, spacingM: 1 }).samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of water.sampleWindow({ ...area, spacingM: 5 }).samples) assert.deepEqual(p, fine.get(`${p.xM},${p.yM}`));
  const snapshot = base.toSnapshot(); delete snapshot.worldId;
  snapshot.grid = { columns: 258, rows: 258, cellSizeM: 1 }; snapshot.fields.groundElevationM = Array(258 * 258).fill(100);
  const p = node('p', 100, 100), q = node('q', 200, 200);
  assert.throws(() => connectSurfaceWater(createTerrainAdapter(snapshot), { riverGraph: { nodes: [p, q], edges: [edge('oversized', p, q)] },
    parameters: { halfWidthM: 100, bankWidthM: 100 } }), /rectangle bounds budget/);
});
test('explicit lake/sea levels connect to C1 ground and saved body boundaries are revalidated', () => {
  const old = lakeOceanFixture(), model = old.toSnapshot().hydrology;
  const water = connectSurfaceWater(c1Base(old), { riverGraph: { nodes: model.nodes,
    edges: model.edges }, waterBodies: model.bodies });
  assert.equal(water.sampleAt(400, 500).waterSurfaceElevationM, 140); assert.equal(water.sampleAt(980, 500).waterSurfaceElevationM, 0);
  assert.deepEqual(restoreTerrain(serializeTerrain(water)).sampleAt(980, 500), water.sampleAt(980, 500));
  const tampered = water.toSnapshot(); delete tampered.worldId; tampered.hydrology.bodies[0].waterLevelElevationM = 1000;
  assert.throws(() => createTerrainAdapter(tampered), /Wet body envelope/);
});
test('C1 static surface and groundwater grids compose with river beds using explicit roles', () => {
  const start = node('start', 500, 100), end = node('end', 500, 900);
  for (const role of ['surface', 'groundwater']) {
    const snapshot = c1Base(baseTerrain(() => 100)).toSnapshot(); delete snapshot.worldId;
    snapshot.fields.waterLevelElevationM = Array(400).fill(101); snapshot.fields.waterLevelRole = role;
    const terrain = connectSurfaceWater(createTerrainAdapter(snapshot), { riverGraph: { nodes: [start, end], edges: [edge('river', start, end)] } });
    const dry = terrain.sampleAt(100, 500), wet = terrain.sampleAt(500, 500);
    assert.equal(dry.waterDepthM, role === 'surface' ? 1 : 0); assert.ok(wet.waterDepthM > 1);
    near(wet.waterDepthM, wet.waterSurfaceElevationM - wet.groundElevationM);
    assert.equal(wet.groundwaterLevelElevationM, role === 'groundwater' ? 101 : null);
  }
});
test('projected traces preserve global samples, unknown water, bounds, budgets and restoration', () => {
  for (const [lat, lon] of [[14, 179.99], [90, 0], [-90, 0]]) {
    const view = createProjectedTerrainView(globalFixture(), { centerLatDeg: lat, centerLonDeg: lon });
    const p = { xM: -5000, yM: -5000 }, q = { xM: 5000, yM: 5000 };
    const trace = view.traceSurfaceSegment(p, q, { maxStepM: 2000 }), reopened = restoreProjectedTerrainView(view.toSnapshot());
    assert.equal(trace.regionId, view.regionId); assert.deepEqual(reopened.traceSurfaceSegment(p, q, { maxStepM: 2000 }), trace);
    let previous = 0;
    for (const sample of trace.samples) {
      assert.deepEqual(sample, { distanceM: sample.distanceM, ...view.sampleAt(sample.xM, sample.yM) });
      assert.equal(sample.waterDepthM, null); assert.ok(sample.distanceM - previous <= 2000); previous = sample.distanceM;
    }
    near(trace.lengthM, Math.sqrt(2) * 10000);
    assert.throws(() => view.traceSurfaceSegment(p, { xM: 6000, yM: 0 }), /outside/);
    assert.throws(() => view.traceSurfaceSegment(p, q, { maxStepM: 1, maxSamples: 20 }), /budget/);
    assert.throws(() => view.traceSurfaceSegment(p, q, { maxStepM: 0 }), /positive/);
    assert.equal(view.traceSurfaceSegment(p, p, { maxSamples: 3 }).samples.length, 3);
    assert.throws(() => connectSurfaceWater(view), /finite planar/);
  }
});
test('projected road diagnostics work with explicit/default roads and report unresolved samples', () => {
  const view = createProjectedTerrainView(globalFixture(), { centerLatDeg: 14, centerLonDeg: 179.99 });
  assert.equal(inspectRoadCrossings(view).roadCount, 0);
  const roads = [{ id: 'projected-road', points: [{ xM: -300, yM: 0 }, { xM: 0, yM: 0 }, { xM: 300, yM: 0 }] }];
  const result = inspectRoadCrossings(view, { roads, maxStepM: 100 });
  assert.equal(result.regionId, view.regionId); assert.equal(result.hydrologyStatus, 'unresolved');
  assert.ok(result.unresolvedWaterSamples > 0); assert.equal(result.unresolvedWaterSamples, result.sampledPoints - 1);
  assert.deepEqual(result.crossings, []); assert.match(result.precision, /water unresolved/);
  assert.deepEqual(inspectRoadCrossings(restoreProjectedTerrainView(view.toSnapshot()), { roads, maxStepM: 100 }), result);
  assert.throws(() => inspectRoadCrossings(view, { roads, bridges: [{ crossingId: 'x', worldId: view.worldId, regionId: 'different-view', deckElevationM: 100 }] }), /regionId/);
});
