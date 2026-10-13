import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreTerrain, serializeTerrain } from '../index.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { fromDynamicRegionalWater } from '../dynamic-regional.mjs';
import { baseTerrain, confluenceFixture, lakeOceanFixture, node, edge, box } from '../fixtures/water-scenarios.mjs';
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('directed profiles share one junction level and sampled centerlines never flow uphill', () => {
  const terrain = confluenceFixture(), model = terrain.toSnapshot().hydrology;
  const join = model.nodes.find(n => n.id === 'join');
  for (const e of model.edges) {
    if (e.from === join.id) assert.equal(e.points[0].waterLevelElevationM, join.waterLevelElevationM);
    if (e.to === join.id) assert.equal(e.points.at(-1).waterLevelElevationM, join.waterLevelElevationM);
    let previous = Infinity;
    for (let i = 1; i < e.points.length; i++) for (let step = 0; step <= 5; step++) {
      const a = e.points[i - 1], b = e.points[i], t = step / 5;
      const p = terrain.sampleAt(a.xM * (1 - t) + b.xM * t, a.yM * (1 - t) + b.yM * t);
      assert.equal(p.hydrologyStatus, 'modeled'); assert.ok(p.waterDepthM > 0);
      assert.ok(p.waterSurfaceElevationM <= previous + 1e-7); previous = p.waterSurfaceElevationM;
      near(p.waterSurfaceElevationM - p.groundElevationM, p.waterDepthM);
      near(p.waterSurfaceElevationM, a.waterLevelElevationM * (1 - t) + b.waterLevelElevationM * t);
    }
  }
  near(terrain.sampleAt(join.xM, join.yM).waterSurfaceElevationM, join.waterLevelElevationM);
});

test('river shores and bank influence boundaries are continuous and reach dry ground', () => {
  const terrain = confluenceFixture();
  const epsilon = 1e-6;
  for (const offset of [1.8, 4.8]) {
    const a = terrain.sampleAt(250 + offset - epsilon, 500), b = terrain.sampleAt(250 + offset + epsilon, 500);
    assert.ok(Math.abs(a.groundElevationM - b.groundElevationM) < 1e-4);
    assert.ok(Math.abs(a.waterDepthM - b.waterDepthM) < 1e-4);
    assert.equal(b.waterDepthM, 0);
  }
  near(terrain.sampleAt(251.8, 500).waterDepthM, 0);
  for (let y = 340; y <= 360; y += 0.5) for (let x = 240; x <= 260; x += 0.5) {
    const a = terrain.sampleAt(x - epsilon, y), b = terrain.sampleAt(x + epsilon, y);
    assert.ok(Math.abs(a.groundElevationM - b.groundElevationM) < 1e-4);
    assert.ok(Math.abs(a.waterDepthM - b.waterDepthM) < 1e-4);
  }
});

test('lake inflow/outflow and ocean mouth meet explicit body levels without painting water onto high land', () => {
  const terrain = lakeOceanFixture(), model = terrain.toSnapshot().hydrology;
  assert.equal(model.nodes.find(n => n.id === 'inlet').waterLevelElevationM, 140);
  assert.equal(model.nodes.find(n => n.id === 'outlet').waterLevelElevationM, 140);
  assert.equal(model.nodes.find(n => n.id === 'mouth').waterLevelElevationM, 0);
  const lake = terrain.sampleAt(400, 500), sea = terrain.sampleAt(980, 500);
  assert.equal(lake.waterSurfaceElevationM, 140); assert.ok(lake.waterDepthM > 0);
  assert.equal(sea.waterSurfaceElevationM, 0); assert.ok(sea.waterDepthM > 0);
  assert.ok(lake.waterSourceIds.includes('lake-1')); assert.ok(sea.waterSourceIds.includes('ocean-1'));
  const high = terrain.sampleAt(400, 640);
  assert.equal(high.surfaceKind, 'ground'); assert.equal(high.waterDepthM, 0);
  for (const x of [250, 550, 925]) {
    const a = terrain.sampleAt(x - 1e-6, 500), b = terrain.sampleAt(x + 1e-6, 500);
    assert.ok(Math.abs(a.groundElevationM - b.groundElevationM) < 1e-4);
    assert.ok(Math.abs(a.waterDepthM - b.waterDepthM) < 1e-4);
    if (a.waterDepthM > 0 && b.waterDepthM > 0) near(a.waterSurfaceElevationM, b.waterSurfaceElevationM);
  }
});

test('water meshes retain the same samples across LOD, adjacent windows and JSON restoration', () => {
  const terrain = confluenceFixture();
  const bounds = { minXM: 200, minYM: 400, maxXM: 300, maxYM: 600 };
  const coarse = terrain.sampleWindow({ ...bounds, spacingM: 10 }), fine = terrain.sampleWindow({ ...bounds, spacingM: 2 });
  const byCoordinate = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) assert.deepEqual(p, byCoordinate.get(`${p.xM},${p.yM}`));
  const left = terrain.sampleWindow({ ...bounds, maxXM: 250, spacingM: 2 });
  const right = terrain.sampleWindow({ ...bounds, minXM: 250, spacingM: 2 });
  assert.deepEqual(left.samples.filter(p => p.xM === 250), right.samples.filter(p => p.xM === 250));
  const restored = restoreTerrain(serializeTerrain(terrain));
  for (const p of coarse.samples) assert.deepEqual(restored.sampleAt(p.xM, p.yM), p);
  const returned = terrain.toSnapshot(); returned.hydrology.edges[0].points[0].depthM = 999;
  assert.deepEqual(terrain.sampleAt(250, 500), restored.sampleAt(250, 500));
});

test('source basin IDs and outlet indices survive surface-water sampling and restoration', () => {
  const base = baseTerrain(), a = node('a', 150, 150), b = node('b', 150, 700);
  const terrain = connectSurfaceWater(base, { riverGraph: { nodes: [a, b], edges: [edge('river', a, b)] },
    basins: { namespace: 'fixture-basin', indices: Array(400).fill(7), outletCellIndices: Array(400).fill(399) } });
  const p = terrain.sampleAt(150, 400);
  assert.equal(p.basinId, 'fixture-basin:7'); assert.equal(p.basinIndex, 7); assert.equal(p.outletCellIndex, 399);
  assert.deepEqual(restoreTerrain(serializeTerrain(terrain)).sampleAt(150, 400), p);
});

test('cycles, wet polygon boundaries, conflicting body levels and impossible upstream anchors are rejected', () => {
  const base = baseTerrain(), a = node('a', 150, 150), b = node('b', 150, 700);
  assert.throws(() => connectSurfaceWater(base, { riverGraph: { nodes: [a, b], edges: [edge('a-b', a, b), edge('b-a', b, a)] } }), /acyclic/);
  assert.throws(() => connectSurfaceWater(base, { waterBodies: [{ id: 'bad-lake', kind: 'lake', waterLevelElevationM: 190, polygon: box(100, 500, 500, 900) }] }), /Wet body envelope/);
  assert.throws(() => connectSurfaceWater(base, { waterBodies: [
    { id: 'one', kind: 'lake', waterLevelElevationM: 50, polygon: box(100, 100, 500, 500) },
    { id: 'two', kind: 'ocean', waterLevelElevationM: 60, polygon: box(400, 400, 900, 900) },
  ] }), /Touching/);
  const level = { id: 'high', kind: 'lake', waterLevelElevationM: 190, polygon: box(100, 600, 300, 900) };
  assert.throws(() => connectSurfaceWater(base, { riverGraph: { nodes: [a, b], edges: [edge('a-b', a, b)] }, waterBodies: [level] }), /Infeasible/);
});

test('stage-1 snapshots remain readable with their original identity and unresolved-water contract', () => {
  const saved = JSON.parse(readFileSync(new URL('../fixtures/terrain-v1.snapshot.json', import.meta.url), 'utf8'));
  const restored = restoreTerrain(saved);
  assert.equal(restored.worldId, saved.worldId);
  assert.equal(saved.schema, 'minimal-world-continuous-terrain@1');
  assert.equal(saved.worldId, 'sha256:7f46f493e94b26a757eb4dd852b3cc68bae01234c33de02b77a5338b636c43b7');
  assert.equal(restored.sampleAt(270, 270).hydrologyStatus, 'unresolved');
});

test('source heads and inland terminal caps taper continuously into ground', () => {
  const terrain = confluenceFixture(), model = terrain.toSnapshot().hydrology;
  const e = model.edges[0], a = e.points[0], b = e.points[1];
  const length = Math.hypot(b.xM - a.xM, b.yM - a.yM), ux = (b.xM - a.xM) / length, uy = (b.yM - a.yM) / length;
  for (const radius of [a.halfWidthM, a.halfWidthM + a.bankWidthM]) {
    const first = terrain.sampleAt(a.xM - ux * (radius - 1e-6), a.yM - uy * (radius - 1e-6));
    const second = terrain.sampleAt(a.xM - ux * (radius + 1e-6), a.yM - uy * (radius + 1e-6));
    assert.ok(Math.abs(first.groundElevationM - second.groundElevationM) < 1e-4);
    assert.ok(Math.abs(first.waterDepthM - second.waterDepthM) < 1e-4);
    assert.equal(second.waterDepthM, 0);
  }
  const end = terrain.sampleAt(250, 700);
  assert.ok(end.waterDepthM > 0);
  assert.equal(terrain.sampleAt(250, 710).waterDepthM, 0);
});

test('drainage gaps reach the region border while preserving source IDs and the original basin', () => {
  const receivers = new Int32Array(16).fill(-1), mask = new Uint8Array(16);
  for (const [a, b] of [[5, 6], [6, 10], [9, 10], [10, 14]]) receivers[a] = b;
  mask[5] = mask[6] = mask[9] = 1;
  const world = { seed: 'gap-fixture', w: 4, h: 4, cell: 100, elevation: Array(16).fill(100), flowReceiver: receivers, riverMask: mask,
    watersheds: { basin: Array.from({ length: 16 }, (_, i) => [5, 6, 9, 10, 14].includes(i) ? 0 : i + 1),
      outlet: Array.from({ length: 16 }, (_, i) => [5, 6, 9, 10, 14].includes(i) ? 14 : i) },
    riverGraph: { nodes: [
      { id: 'a', kind: 'source', cellIndex: 5, xMeters: 150, yMeters: 150 },
      { id: 'b', kind: 'outlet', cellIndex: 6, xMeters: 250, yMeters: 150 },
      { id: 'c', kind: 'source', cellIndex: 9, xMeters: 150, yMeters: 250 },
    ], edges: [{ id: 'original-river', from: 'a', to: 'b', points: [{ x: 150, y: 150, cellIndex: 5 }, { x: 250, y: 150, cellIndex: 6 }] }] }, settlements: [], roads: [] };
  const terrain = fromDynamicRegionalWater(world, { verticalDatum: 'fixture-zero', originXM: 1000, originYM: -2000 });
  const model = terrain.toSnapshot().hydrology;
  assert.deepEqual(model.diagnostics.isolatedNodeIds, []); assert.deepEqual(model.diagnostics.unresolvedTerminalNodeIds, []);
  for (const id of ['a', 'b', 'c']) assert.ok(model.nodes.some(n => n.id === id));
  assert.ok(model.edges.some(e => e.sourceEdgeId === 'original-river'));
  assert.ok(model.nodes.some(n => n.kind === 'confluence'));
  assert.ok(model.nodes.some(n => n.kind === 'regional-boundary' && n.yM === -1600));
  const p = terrain.sampleAt(1250, -1600);
  assert.equal(p.basinId, 'dynamic-basin:0'); assert.equal(p.outletCellIndex, 14); assert.ok(p.waterDepthM > 0);
  const cyclic = { ...world, flowReceiver: new Int32Array(receivers) }; cyclic.flowReceiver[6] = 5;
  assert.throws(() => fromDynamicRegionalWater(cyclic, { verticalDatum: 'fixture-zero' }), /cyclic/);
});

test('crossing river corridors require a graph junction before a model is accepted', () => {
  const a = node('a', 100, 150), b = node('b', 500, 650), c = node('c', 500, 150), d = node('d', 100, 650);
  assert.throws(() => connectSurfaceWater(baseTerrain(), { riverGraph: { nodes: [a, b, c, d], edges: [edge('one', a, b), edge('two', c, d)] } }), /overlap/i);
});

test('a dry node inside a body search envelope is not silently anchored to its water level', () => {
  const a = node('a', 150, 150), b = node('b', 150, 700);
  const terrain = connectSurfaceWater(baseTerrain(), { riverGraph: { nodes: [a, b], edges: [edge('river', a, b)] },
    waterBodies: [{ id: 'ocean', kind: 'ocean', waterLevelElevationM: 0, polygon: box(0, 0, 1000, 1000) }] });
  const model = terrain.toSnapshot().hydrology;
  assert.ok(model.nodes.every(n => n.bodyId === null && n.waterLevelElevationM > 0));
  assert.ok(terrain.sampleAt(150, 400).waterSurfaceElevationM > 0);
});
