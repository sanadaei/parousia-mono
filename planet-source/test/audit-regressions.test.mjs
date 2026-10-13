import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTerrainAdapter, serializeTerrain, restoreTerrain, buildTerrainWithSurfaceWater } from '../index.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { compileSurfaceWater, segmentIntervals, insidePolygon } from '../water-model.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
import { baseTerrain, confluenceFixture, concaveBodyFixture, concaveEnvelope, combinedWaterFixture, node, edge } from '../fixtures/water-scenarios.mjs';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('regional cuts retain open wet cross-sections with meshes inside all four edges and a corner', () => {
  for (const [x, y] of [[0, 500], [1000, 500], [500, 0], [500, 1000], [1000, 1000], [1000, 700]]) {
    const a = node('a', 500, 500), b = { ...node('b', x, y), kind: 'regional-boundary' };
    const terrain = connectSurfaceWater(baseTerrain(() => 100), { riverGraph: { nodes: [a, b], edges: [edge('river', a, b)] } });
    const compiled = compileSurfaceWater(terrain.toSnapshot().hydrology, terrain.bounds, terrain.grid, terrain.frame, () => 100);
    assert.ok(compiled.meshBounds.minXM >= 0 && compiled.meshBounds.minYM >= 0);
    assert.ok(compiled.meshBounds.maxXM <= 1000 && compiled.meshBounds.maxYM <= 1000);
    near(terrain.sampleAt(x, y).waterDepthM, 1.2);
    const restored = restoreTerrain(serializeTerrain(terrain));
    assert.deepEqual(restored.sampleAt(x, y), terrain.sampleAt(x, y));
    const length = Math.hypot(x - 500, y - 500), tx = (x - 500) / length, ty = (y - 500) / length;
    near(terrain.sampleAt(x - tx * 0.001, y - ty * 0.001).groundElevationM,
      terrain.sampleAt(x, y).groundElevationM);
  }
});

test('source caps near a cut are clipped without inventing internal boundary nodes', () => {
  const a = node('a', 1, 500), b = node('b', 400, 500), base = baseTerrain(() => 100);
  const terrain = connectSurfaceWater(base, { riverGraph: { nodes: [a, b], edges: [edge('river', a, b)] } });
  const compiled = compileSurfaceWater(terrain.toSnapshot().hydrology, terrain.bounds, terrain.grid, terrain.frame, () => 100);
  assert.equal(compiled.meshBounds.minXM, 0);
  const saved = terrain.toSnapshot(); delete saved.worldId;
  saved.hydrology.nodes[0].kind = 'regional-boundary';
  assert.throws(() => createTerrainAdapter(saved), /perimeter/);
});

test('concave bodies fill both arms while leaving the excluded depression dry in either orientation', () => {
  const terrain = concaveBodyFixture();
  assert.equal(terrain.sampleAt(200, 500).waterSurfaceElevationM, 90);
  assert.equal(terrain.sampleAt(800, 500).waterSurfaceElevationM, 90);
  assert.equal(terrain.sampleAt(500, 500).waterDepthM, 0);
  assert.ok(terrain.sampleAt(500, 500).groundElevationM < 90);
  assert.equal(insidePolygon({ xM: 300, yM: 500 }, concaveEnvelope), true);
  const reversed = terrain.toSnapshot(); delete reversed.worldId;
  reversed.hydrology.bodies[0].polygon.reverse();
  const other = createTerrainAdapter(reversed), restored = restoreTerrain(serializeTerrain(terrain));
  for (const [x, y] of [[200, 500], [800, 500], [500, 500], [300, 500]]) {
    const p = terrain.sampleAt(x, y), q = other.sampleAt(x, y); delete p.worldId; delete q.worldId;
    assert.deepEqual(p, q);
    assert.deepEqual(restored.sampleAt(x, y), terrain.sampleAt(x, y));
  }
});

test('concave segment clipping returns disjoint wet-region intervals, including tangencies and collinear edges', () => {
  const a = { xM: 50, yM: 500 }, b = { xM: 950, yM: 500 };
  const intervals = segmentIntervals(a, b, concaveEnvelope);
  assert.equal(intervals.length, 2);
  for (const [i, target] of [[0, [1 / 18, 5 / 18]], [1, [13 / 18, 17 / 18]]]) {
    near(intervals[i][0], target[0]); near(intervals[i][1], target[1]);
  }
  assert.deepEqual(segmentIntervals({ xM: 300, yM: 350 }, { xM: 300, yM: 850 }, concaveEnvelope), [[0, 1]]);
  assert.deepEqual(segmentIntervals({ xM: 350, yM: 350 }, { xM: 650, yM: 850 }, concaveEnvelope), []);
  assert.deepEqual(segmentIntervals({ xM: 300, yM: 300 }, { xM: 500, yM: 500 }, concaveEnvelope), [[0, 0]]);
});

test('concave polygons still reject self intersections and wet search-envelope boundaries', () => {
  const body = { id: 'bad', kind: 'lake', waterLevelElevationM: 90 };
  assert.throws(() => connectSurfaceWater(baseTerrain(() => 100), { waterBodies: [{ ...body,
    polygon: [[100, 100], [900, 900], [900, 100], [100, 900]].map(([xM, yM]) => ({ xM, yM })) }] }), /Degenerate|Self-intersecting/);
  assert.throws(() => connectSurfaceWater(baseTerrain(() => 80), { waterBodies: [{ ...body, polygon: concaveEnvelope }] }), /Wet body envelope/);
});

test('surface grids compose with carved channels and groundwater remains a separate quantity', () => {
  const surface = combinedWaterFixture('surface'), groundwater = combinedWaterFixture('groundwater');
  const p = surface.sampleAt(500, 500);
  assert.equal(p.waterSurfaceElevationM, 101); assert.deepEqual(p.waterSourceIds, ['water-level-grid']);
  near(p.waterDepthM, 101 - p.groundElevationM);
  assert.equal(surface.sampleAt(100, 500).waterDepthM, 1);
  assert.equal(groundwater.sampleAt(100, 500).waterDepthM, 0);
  assert.equal(groundwater.sampleAt(500, 500).groundwaterLevelElevationM, 101);
  near(groundwater.sampleAt(500, 500).waterSurfaceElevationM, 99.85);
  assert.deepEqual(restoreTerrain(serializeTerrain(surface)).sampleAt(500, 500), p);
  const input = baseTerrain(() => 100).toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(400).fill(101);
  assert.throws(() => connectSurfaceWater(createTerrainAdapter(input)), /waterLevelRole/);
  assert.throws(() => connectSurfaceWater(createTerrainAdapter(input), { waterLevelRole: 'guess' }), /waterLevelRole/);
});

test('background gradients, LOD and mutation isolation survive combined water models', () => {
  const terrain = combinedWaterFixture(), restored = restoreTerrain(serializeTerrain(terrain));
  const area = { minXM: 480, minYM: 480, maxXM: 520, maxYM: 520 };
  const coarse = terrain.sampleWindow({ ...area, spacingM: 10 });
  const fine = terrain.sampleWindow({ ...area, spacingM: 2 });
  const coordinates = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) assert.deepEqual(p, coordinates.get(`${p.xM},${p.yM}`));
  const snapshot = terrain.toSnapshot(); snapshot.fields.waterLevelElevationM.fill(999);
  assert.deepEqual(terrain.sampleAt(500, 500), restored.sampleAt(500, 500));
});

test('a groundwater-only grid does not claim resolved dry surface water', () => {
  const input = baseTerrain(() => 100).toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(400).fill(101);
  input.fields.waterLevelRole = 'groundwater';
  const terrain = createTerrainAdapter(input), p = terrain.sampleAt(500, 500);
  assert.equal(p.groundwaterLevelElevationM, 101); assert.equal(p.waterSurfaceElevationM, null);
  assert.equal(p.waterDepthM, null); assert.equal(p.surfaceKind, 'unresolved');
  assert.equal(terrain.hydrologyStatus, 'unresolved');
});

test('saved topology certificates are checked, while old water hashes and all 353 witnesses remain unchanged', () => {
  const old = JSON.parse(readFileSync(new URL('../fixtures/surface-water-v1.snapshot.json', import.meta.url), 'utf8'));
  const witnesses = JSON.parse(readFileSync(new URL('../fixtures/surface-water-v1.witnesses.json', import.meta.url), 'utf8'));
  const restored = restoreTerrain(old); assert.equal(restored.worldId, old.worldId);
  assert.equal(witnesses.length, 353);
  for (const p of witnesses) assert.deepEqual(restored.sampleAt(p.xM, p.yM), p);
  const tampered = confluenceFixture().toSnapshot(); delete tampered.worldId;
  tampered.hydrology.topologyOrder.reverse();
  assert.throws(() => createTerrainAdapter(tampered), /acyclic/);
  assert.throws(() => buildTerrainWithSurfaceWater(restored.toSnapshot()), /saved snapshot/);
});

test('roads find a narrow channel between coarse probes and carry caller-specified deck heights', () => {
  const terrain = confluenceFixture(), roads = [{ id: 'road', points: [{ xM: 100, yM: 500 }, { xM: 900, yM: 500 }] }];
  const original = structuredClone(roads), report = inspectRoadCrossings(terrain, { roads, maxStepM: 100 });
  assert.equal(report.crossings.length, 1);
  const crossing = report.crossings[0];
  assert.ok(crossing.waterSourceIds.includes('c-d'));
  assert.ok(crossing.dryApproachBefore && crossing.dryApproachAfter);
  assert.equal(crossing.status, 'bridge-height-required');
  const bridge = { crossingId: crossing.crossingId, worldId: terrain.worldId, deckElevationM: crossing.requiredDeckElevationM };
  assert.equal(inspectRoadCrossings(terrain, { roads, maxStepM: 100, bridges: [bridge] }).crossings[0].status, 'sampled-clearance-met');
  assert.equal(inspectRoadCrossings(terrain, { roads, bridges: [{ ...bridge, deckElevationM: bridge.deckElevationM - 0.1 }] }).crossings[0].status, 'insufficient-sampled-clearance');
  assert.equal(crossing.requiresStage4Review, true);
  assert.deepEqual(roads, original);
  assert.deepEqual(inspectRoadCrossings(restoreTerrain(serializeTerrain(terrain)), { roads, maxStepM: 100 }), report);
});

test('concave water bodies produce distinct road crossings and a dry notch', () => {
  const terrain = concaveBodyFixture(), roads = [{ id: 'road', points: [{ xM: 150, yM: 500 }, { xM: 850, yM: 500 }] }];
  const report = inspectRoadCrossings(terrain, { roads });
  assert.equal(report.crossings.length, 2);
  assert.ok(report.crossings[0].endDistanceM < report.crossings[1].startDistanceM);
  assert.ok(report.crossings.every(c => c.maxWaterLevelElevationM === 90));
});

test('bridge approvals reject stale worlds, unknown crossings and unbounded traces', () => {
  const terrain = confluenceFixture(), roads = [{ id: 'road', points: [{ xM: 100, yM: 500 }, { xM: 900, yM: 500 }] }];
  assert.throws(() => inspectRoadCrossings(terrain, { roads, bridges: [{ crossingId: 'road/crossing:0', worldId: 'old', deckElevationM: 200 }] }), /worldId/);
  assert.throws(() => inspectRoadCrossings(terrain, { roads, bridges: [{ crossingId: 'unknown', worldId: terrain.worldId, deckElevationM: 200 }] }), /Unknown bridge/);
  assert.throws(() => inspectRoadCrossings(terrain, { roads, maxSamples: 10 }), /budget/);
  assert.throws(() => terrain.traceSurfaceSegment(roads[0].points[0], roads[0].points[1], { maxStepM: 0 }), /positive/);
  assert.throws(() => terrain.traceSurfaceSegment({ xM: -1, yM: 0 }, roads[0].points[1]), /outside/);
  const unresolved = baseTerrain();
  const unknown = inspectRoadCrossings(unresolved, { roads });
  assert.deepEqual(unknown.crossings, []); assert.equal(unknown.hydrologyStatus, 'unresolved');
});
