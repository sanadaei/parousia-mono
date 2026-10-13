import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainAdapter, SMOOTH_TERRAIN_SCHEMA, restoreTerrain, serializeTerrain } from '../index.mjs';
import { fromDynamicRegionalWater, fromDynamicRegional } from '../dynamic-regional.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { segmentGridCuts, gridAxisCuts, quadraticVertex } from '../field-math.mjs';
import { baseTerrain, confluenceFixture, node, edge } from '../fixtures/water-scenarios.mjs';
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function smooth(height = (x, y) => 10 + 2 * x + 3 * y) {
  const groundElevationM = Array.from({ length: 30 }, (_, i) => height((i % 6 + 0.5) * 10, (Math.floor(i / 6) + 0.5) * 10));
  return createTerrainAdapter({ schema: SMOOTH_TERRAIN_SCHEMA, seed: 'c1-fixture', revision: 'c1@1',
    frame: { kind: 'planar-metric', originXM: 0, originYM: 0, verticalDatum: 'fixture-zero' },
    grid: { columns: 6, rows: 5, cellSizeM: 10 }, derivativeStepM: 0.1,
    fields: { groundElevationM, waterLevelElevationM: null } });
}
function graph() {
  const a = node('a', 150, 150), b = node('b', 350, 150), c = node('join', 250, 350), d = node('out', 250, 700);
  return { nodes: [a, b, c, d], edges: [edge('a-c', a, c), edge('b-c', b, c), edge('c-d', c, d)] };
}

test('shared cuts handle offset, reversed/axis-aligned traces and budgets', () => {
  const grid = { columns: 4, rows: 3, cellSizeM: 10 }, frame = { originXM: -20, originYM: 100 };
  assert.deepEqual([...gridAxisCuts(-15, 15, -20, 4, 10)], [-5, 5]);
  const a = { xM: -20, yM: 110 }, b = { xM: 20, yM: 110 };
  assert.deepEqual(segmentGridCuts(a, b, grid, frame), [0, 0.125, 0.375, 0.625, 0.875, 1]);
  assert.deepEqual(segmentGridCuts(b, a, grid, frame), segmentGridCuts(a, b, grid, frame));
  assert.throws(() => segmentGridCuts(a, b, grid, frame, 4), /budget/);
});
test('shared quadratic extrema handle minima, maxima, linear and outside vertices', () => {
  near(quadraticVertex(1, 0, 1), 0.5); near(quadraticVertex(0, 1, 0), 0.5);
  assert.equal(quadraticVertex(0, 1, 0, { minimumOnly: true }), null);
  assert.equal(quadraticVertex(0, 0.5, 1), null); assert.equal(quadraticVertex(1, 2.25, 4), null);
});
test('C1 keeps source centers and heights within each four-corner range', () => {
  const terrain = smooth((x, y) => 100 * Math.sin(x * 0.4) * Math.cos(y * 0.3));
  const field = terrain.toSnapshot().fields.groundElevationM;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) assert.equal(terrain.groundElevationAt((x + 0.5) * 10, (y + 0.5) * 10), field[y * 6 + x]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
    const corners = [field[y * 6 + x], field[y * 6 + x + 1], field[(y + 1) * 6 + x], field[(y + 1) * 6 + x + 1]];
    for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) {
      const z = terrain.groundElevationAt((x + 0.5) * 10 + i, (y + 0.5) * 10 + j);
      assert.ok(z >= Math.min(...corners) - 1e-9 && z <= Math.max(...corners) + 1e-9);
    }
  }
});
test('C1 derivatives agree across patch lines and constant half-cell extensions', () => {
  const terrain = smooth((x, y) => 100 * Math.sin(x * 0.4) * Math.cos(y * 0.3)), epsilon = 1e-5;
  for (const [axis, count, otherMax] of [['x', 6, 50], ['y', 5, 60]]) {
    for (let i = 0; i < count; i++) for (let other = 0; other <= otherMax; other += 2.5) {
      const at = offset => axis === 'x' ? terrain.groundElevationAt((i + 0.5) * 10 + offset, other)
        : terrain.groundElevationAt(other, (i + 0.5) * 10 + offset);
      near((at(0) - at(-epsilon)) / epsilon, (at(epsilon) - at(0)) / epsilon, 0.001);
    }
  }
});
test('surface frames match plane normals/zero curvature and expose edge limits', () => {
  const terrain = smooth(), frame = terrain.surfaceFrameAt(25, 25), norm = Math.sqrt(14);
  near(frame.normal.x, -2 / norm); near(frame.normal.y, -3 / norm); near(frame.normal.z, 1 / norm);
  near(Math.hypot(...Object.values(frame.normal)), 1);
  for (const name of ['xxPerM', 'yyPerM', 'xyPerM', 'meanPerM', 'gaussianPerM2']) near(frame.curvature[name], 0, 1e-8);
  const saddle = baseTerrain((x, y) => x * y * 0.01).surfaceFrameAt(250, 250);
  const denominator = 1 + 2.5 ** 2 + 2.5 ** 2;
  near(saddle.curvature.xxPerM, 0); near(saddle.curvature.yyPerM, 0); near(saddle.curvature.xyPerM, 0.01);
  near(saddle.curvature.meanPerM, -2.5 * 2.5 * 0.01 / denominator ** 1.5);
  near(saddle.curvature.gaussianPerM2, -(0.01 ** 2) / denominator ** 2);
  assert.equal(frame.curvatureStatus, 'fixed-distance-estimate');
  assert.equal(terrain.surfaceFrameAt(0, 25).curvature, null);
  assert.equal(terrain.surfaceFrameAt(0, 25).curvatureStatus, 'unavailable-at-region-edge');
  for (const p of [terrain.surfaceFrameAt(0, 0), frame, smooth((x) => -x * x).surfaceFrameAt(25, 25)]) {
    assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  }
  const water = confluenceFixture(), wet = water.surfaceFrameAt(250, 500);
  near(Math.hypot(...Object.values(wet.normal)), 1); assert.equal(wet.groundElevationM, water.sampleAt(250, 500).groundElevationM);
  frame.normal.x = 99; near(terrain.surfaceFrameAt(25, 25).normal.x, -2 / norm);
});
test('C1 LOD/window samples, identity and frames survive restoration', () => {
  const terrain = smooth((x, y) => x * x / 20 + Math.sin(y)), reopened = restoreTerrain(serializeTerrain(terrain));
  const bounds = { minXM: 10, minYM: 10, maxXM: 50, maxYM: 40 };
  const coarse = terrain.sampleWindow({ ...bounds, spacingM: 10 }), fine = terrain.sampleWindow({ ...bounds, spacingM: 5 });
  const lookup = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) {
    assert.deepEqual(p, lookup.get(`${p.xM},${p.yM}`));
    assert.deepEqual(reopened.surfaceFrameAt(p.xM, p.yM), terrain.surfaceFrameAt(p.xM, p.yM));
  }
  const left = terrain.sampleWindow({ ...bounds, maxXM: 30, spacingM: 5 }), right = terrain.sampleWindow({ ...bounds, minXM: 30, spacingM: 5 });
  assert.deepEqual(left.samples.filter(p => p.xM === 30), right.samples.filter(p => p.xM === 30));
  const changed = terrain.toSnapshot(); changed.interpolation = 'bilinear@1'; assert.throws(() => restoreTerrain(changed), /worldId mismatch/);
});
test('C1 groundwater keeps unknown surface water until an explicit surface model is connected', () => {
  const input = smooth().toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(30).fill(1000); input.fields.waterLevelRole = 'groundwater';
  const terrain = createTerrainAdapter(input), sample = terrain.sampleAt(25, 25);
  assert.equal(sample.waterDepthM, null); assert.equal(sample.groundwaterLevelElevationM, 1000); assert.equal(sample.surfaceKind, 'unresolved');
  const modeled = connectSurfaceWater(terrain); assert.equal(modeled.sampleAt(25, 25).waterDepthM, 0);
  assert.equal(modeled.sampleAt(25, 25).groundwaterLevelElevationM, 1000);
  input.fields.waterLevelRole = 'surface'; assert.ok(createTerrainAdapter(input).sampleAt(25, 25).waterDepthM > 0);
  input.fields.waterLevelRole = 'groundwater'; input.interpolation = 'unknown'; assert.throws(() => createTerrainAdapter(input), /interpolation/);
});
test('Strahler sizes expand downstream while preserving junctions and continuous shores', () => {
  const terrain = connectSurfaceWater(baseTerrain(), { riverGraph: graph(), channelSizing: { mode: 'strahler' } });
  const edges = terrain.toSnapshot().hydrology.edges;
  assert.deepEqual(edges.map(e => e.strahlerOrder), [1, 1, 2]);
  assert.ok(edges[2].points[0].halfWidthM > edges[0].points[0].halfWidthM); assert.ok(edges[2].points[0].depthM > edges[0].points[0].depthM);
  const level = terrain.sampleAt(250, 350).waterLevelElevationM;
  for (const e of edges) near(e.from === 'join' ? e.points[0].waterLevelElevationM : e.points.at(-1).waterLevelElevationM, level);
  const half = edges[2].points[0].halfWidthM;
  const a = terrain.sampleAt(250 + half - 1e-6, 500), b = terrain.sampleAt(250 + half + 1e-6, 500);
  near(a.groundElevationM, b.groundElevationM, 1e-4); near(a.waterDepthM, b.waterDepthM, 1e-4); assert.equal(b.waterDepthM, 0);
  assert.deepEqual(restoreTerrain(serializeTerrain(terrain)).surfaceFrameAt(250, 500), terrain.surfaceFrameAt(250, 500));
});
test('regional completion preserves source order and propagates it through missing links', () => {
  const world = { seed: 'gap', w: 4, h: 3, cell: 100, elevation: Array(12).fill(100),
    riverMask: [1, 1, ...Array(10).fill(0)], flowReceiver: [1, 5, -1, -1, -1, 9, -1, -1, -1, -1, -1, -1],
    riverGraph: { nodes: [{ id: 'a', kind: 'source', cellIndex: 0, xMeters: 50, yMeters: 50 }, { id: 'b', kind: 'through', cellIndex: 1, xMeters: 150, yMeters: 50 }],
      edges: [{ id: 'old', from: 'a', to: 'b', strahlerOrder: 3, points: [{ cellIndex: 0, x: 50, y: 50 }, { cellIndex: 1, x: 150, y: 50 }] }] } };
  const terrain = fromDynamicRegionalWater(world, { verticalDatum: 'fixture-zero', channelSizing: { mode: 'strahler' } });
  const edges = terrain.toSnapshot().hydrology.edges;
  assert.equal(edges.find(e => e.sourceEdgeId === 'old').sourceStrahlerOrder, 3);
  assert.ok(edges.filter(e => !e.sourceEdgeId).every(e => e.sourceStrahlerOrder === null)); assert.ok(edges.every(e => e.strahlerOrder === 3));
  const c1 = fromDynamicRegional(world, { verticalDatum: 'fixture-zero', interpolation: 'bounded-hermite-c1@1' });
  assert.equal(c1.toSnapshot().schema, SMOOTH_TERRAIN_SCHEMA); assert.equal(c1.groundElevationAt(175, 125), 100);
  const explicitBilinear = fromDynamicRegionalWater(world, { verticalDatum: 'fixture-zero', interpolation: 'bilinear@1' });
  assert.equal(explicitBilinear.toSnapshot().interpolation, 'bilinear@1');
  assert.ok(explicitBilinear.sampleAt(150, 175).waterDepthM > 0);
});
test('Strahler growth caps and invalid sizes/orders/bifurcations have explicit contracts', () => {
  const g = graph(); g.edges[0].strahlerOrder = 32;
  const options = { riverGraph: g, channelSizing: { mode: 'strahler', maxHalfWidthM: 2, maxBankWidthM: 3.5, maxDepthM: 1.5 } };
  const model = connectSurfaceWater(baseTerrain(), options).toSnapshot().hydrology;
  assert.ok(model.edges.every(e => e.points.every(p => p.halfWidthM <= 2 && p.bankWidthM <= 3.5 && p.depthM <= 1.5)));
  assert.throws(() => connectSurfaceWater(baseTerrain(), { ...options, channelSizing: { widthFactor: 0.5 } }), /base dimensions/);
  assert.throws(() => connectSurfaceWater(baseTerrain(), { ...options, channelSizing: { maxDepthM: 0.5 } }), /base dimensions/);
  assert.throws(() => connectSurfaceWater(baseTerrain(), { ...options, channelSizing: { extra: 1 } }), /channelSizing/);
  g.edges[0].strahlerOrder = 1.5; assert.throws(() => connectSurfaceWater(baseTerrain(), options), /Source Strahler/);
  g.edges[0].strahlerOrder = 1; g.edges[1].from = 'a'; assert.throws(() => connectSurfaceWater(baseTerrain(), options), /non-bifurcating/);
});
