import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrainAdapter, serializeTerrain, restoreTerrain, TERRAIN_SCHEMA } from '../index.mjs';
import { fromDynamicRegional } from '../dynamic-regional.mjs';

function plane({ water = true } = {}) {
  // Exact z = 100 + .1 * (x - 1000) + .2 * (y - 2000), at cell centers.
  const ground = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    ground.push(100 + 0.1 * ((x + 0.5) * 100) + 0.2 * ((y + 0.5) * 100));
  }
  return {
    schema: TERRAIN_SCHEMA, seed: 'analytic-plane', revision: 'fixture@1',
    frame: { kind: 'planar-metric', originXM: 1000, originYM: 2000, verticalDatum: 'fixture-zero' },
    grid: { columns: 4, rows: 4, cellSizeM: 100, sampleLocation: 'cell-center' },
    derivativeStepM: 1,
    fields: { groundElevationM: ground, waterLevelElevationM: water ? Array(16).fill(160) : null },
    references: { description: 'Analytic validation fixture, not a generated river' },
  };
}

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('arbitrary metric coordinates reproduce an analytic height and fixed-distance gradient', () => {
  const adapter = createTerrainAdapter(plane());
  for (const [x, y] of [[1081.25, 2114.75], [1200, 2200], [1318.6, 2084.2]]) {
    const sample = adapter.sampleAt(x, y);
    near(sample.groundElevationM, 100 + 0.1 * (x - 1000) + 0.2 * (y - 2000));
    near(sample.gradient.x, 0.1); near(sample.gradient.y, 0.2);
    near(sample.slopeMPerM, Math.hypot(0.1, 0.2));
  }
});

test('water surface, bed and depth agree; dry land and missing water data differ', () => {
  const adapter = createTerrainAdapter(plane());
  const wet = adapter.sampleAt(1200, 2100);
  assert.equal(wet.groundElevationM, 140);
  assert.equal(wet.waterSurfaceElevationM, 160);
  assert.equal(wet.waterDepthM, 20);
  assert.equal(wet.surfaceKind, 'water');
  const shore = adapter.sampleAt(1200, 2200);
  assert.equal(shore.waterDepthM, 0); assert.equal(shore.waterSurfaceElevationM, null);
  assert.equal(shore.waterLevelElevationM, 160);
  const dry = adapter.sampleAt(1200, 2300);
  assert.equal(dry.waterDepthM, 0); assert.equal(dry.surfaceKind, 'ground');
  const unknown = createTerrainAdapter(plane({ water: false })).sampleAt(1200, 2100);
  assert.equal(unknown.hydrologyStatus, 'unresolved');
  assert.equal(unknown.waterDepthM, null); assert.equal(unknown.waterLevelElevationM, null);
  assert.equal(unknown.surfaceKind, 'unresolved');
  const a = adapter.sampleAt(1200, 2200 - 0.001);
  const b = adapter.sampleAt(1200, 2200 + 0.001);
  near(a.waterDepthM, 0.0002); near(b.waterDepthM, 0);
});

test('LOD changes sample density only, including slopes and water quantities', () => {
  const adapter = createTerrainAdapter(plane());
  const bounds = { minXM: 1050, minYM: 2050, maxXM: 1350, maxYM: 2350 };
  const coarse = adapter.sampleWindow({ ...bounds, spacingM: 100 });
  const fine = adapter.sampleWindow({ ...bounds, spacingM: 25 });
  const byCoordinate = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const sample of coarse.samples) assert.deepEqual(sample, byCoordinate.get(`${sample.xM},${sample.yM}`));
  assert.equal(coarse.worldId, fine.worldId);
});

test('adjacent tiles and a larger window return identical values along their shared edge', () => {
  const adapter = createTerrainAdapter(plane());
  const left = adapter.sampleWindow({ minXM: 1050, minYM: 2050, maxXM: 1200, maxYM: 2350, spacingM: 25 });
  const right = adapter.sampleWindow({ minXM: 1200, minYM: 2050, maxXM: 1350, maxYM: 2350, spacingM: 25 });
  const whole = adapter.sampleWindow({ minXM: 1050, minYM: 2050, maxXM: 1350, maxYM: 2350, spacingM: 25 });
  assert.deepEqual(left.samples.filter(p => p.xM === 1200), right.samples.filter(p => p.xM === 1200));
  const byCoordinate = new Map(whole.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of [...left.samples, ...right.samples]) assert.deepEqual(p, byCoordinate.get(`${p.xM},${p.yM}`));
});

test('exact cell centers and finite outer edges use the documented half-cell extension', () => {
  const adapter = createTerrainAdapter(plane());
  assert.equal(adapter.sampleAt(1350, 2350).groundElevationM, 205);
  assert.equal(adapter.sampleAt(1400, 2400).groundElevationM, 205);
  assert.equal(adapter.sampleAt(1000, 2000).groundElevationM, 115);
  assert.throws(() => adapter.sampleAt(1400.0001, 2300), /outside/);
  assert.throws(() => adapter.sampleAt(1200, 1999.9999), /outside/);
  assert.throws(() => adapter.sampleAt(NaN, 2300), /finite/);
});

test('input edits, returned snapshots and returned sample edits cannot contaminate the adapter', () => {
  const input = plane();
  const adapter = createTerrainAdapter(input);
  const original = adapter.sampleAt(1200, 2200);
  input.fields.groundElevationM.fill(999);
  input.fields.waterLevelElevationM.fill(999);
  input.references.description = 'edited';
  const snapshot = adapter.toSnapshot();
  snapshot.fields.groundElevationM.fill(-999);
  snapshot.references.description = 'changed copy';
  const returned = adapter.sampleAt(1200, 2200);
  returned.gradient.x = 999;
  assert.deepEqual(adapter.sampleAt(1200, 2200), original);
  assert.equal(adapter.toSnapshot().references.description, 'Analytic validation fixture, not a generated river');
});

test('world identity covers field contents, water data and generation revision, independent of JSON key order', () => {
  const first = plane();
  const changed = plane(); changed.fields.groundElevationM[0] += 100;
  assert.notEqual(createTerrainAdapter(first).worldId, createTerrainAdapter(changed).worldId);
  assert.notEqual(createTerrainAdapter(first).worldId, createTerrainAdapter(plane({ water: false })).worldId);
  const version = plane(); version.revision = 'fixture@2';
  assert.notEqual(createTerrainAdapter(first).worldId, createTerrainAdapter(version).worldId);
  const a = plane(); a.references = { b: 2, a: 1 };
  const b = plane(); b.references = { a: 1, b: 2 };
  assert.equal(createTerrainAdapter(a).worldId, createTerrainAdapter(b).worldId);
});

test('JSON restoration reconstructs sampling, derivatives and water, and rejects tampered content', () => {
  const adapter = createTerrainAdapter(plane());
  const restored = restoreTerrain(serializeTerrain(adapter));
  for (const p of [[1000, 2000], [1234.5, 2134.25], [1400, 2400]]) {
    assert.deepEqual(restored.sampleAt(...p), adapter.sampleAt(...p));
  }
  const corrupt = adapter.toSnapshot(); corrupt.fields.groundElevationM[0]++;
  assert.throws(() => restoreTerrain(corrupt), /worldId mismatch/);
  assert.throws(() => restoreTerrain(plane()), /worldId/);
});

test('invalid scalar fields, coordinate contracts and oversized windows are rejected before sampling', () => {
  const short = plane(); short.fields.groundElevationM.pop();
  assert.throws(() => createTerrainAdapter(short), /exactly/);
  const missing = plane(); missing.fields.waterLevelElevationM[3] = null;
  assert.throws(() => createTerrainAdapter(missing), /finite/);
  const unknownDatum = plane(); delete unknownDatum.frame.verticalDatum;
  assert.throws(() => createTerrainAdapter(unknownDatum), /verticalDatum/);
  const wrongPosition = plane(); wrongPosition.grid.sampleLocation = 'cell-corner';
  assert.throws(() => createTerrainAdapter(wrongPosition), /cell-center/);
  const badReference = plane(); badReference.references.callback = () => 1;
  assert.throws(() => createTerrainAdapter(badReference), /JSON values/);
  const huge = plane(); huge.grid.rows = huge.grid.columns = 1_000_000;
  assert.throws(() => createTerrainAdapter(huge), /exceeds/);
  const adapter = createTerrainAdapter(plane());
  const bounds = { minXM: 1000, minYM: 2000, maxXM: 1400, maxYM: 2400 };
  assert.throws(() => adapter.sampleWindow({ ...bounds, spacingM: 0.1 }), /exceeds/);
  assert.throws(() => adapter.sampleWindow({ ...bounds, spacingM: 17 }), /whole multiples/);
  assert.throws(() => adapter.sampleWindow({ ...bounds, spacingM: Infinity }), /finite/);
});

test('legacy bridge preserves IDs and metric positions with an explicit origin and unresolved hydrology', () => {
  const world = { seed: 'bridge-fixture', w: 2, h: 2, cell: 100,
    elevation: new Float64Array([10, 20, 30, 40]),
    settlements: [{ id: 'village-1', kind: 'village', x: 0, y: 1 }],
    roads: [{ id: 'road-1', a: 'village-1', b: 'village-2', widthMeters: 4,
      path: [{ x: 0, y: 1 }, { x: 1, y: 1 }] }],
    riverGraph: { nodes: [{ id: 'n1', kind: 'source', xMeters: 50, yMeters: 50 }],
      edges: [{ id: 'r1', from: 'n1', to: 'n2', points: [{ x: 50, y: 50 }, { x: 150, y: 150 }] }] },
  };
  const adapter = fromDynamicRegional(world, { verticalDatum: 'legacy-unspecified-zero', originXM: -1000, originYM: 2000 });
  const refs = adapter.toSnapshot().references;
  assert.equal(adapter.hydrologyStatus, 'unresolved');
  assert.deepEqual(refs.settlements[0], { id: 'village-1', kind: 'village', xM: -950, yM: 2150 });
  assert.deepEqual(refs.roads[0].points[0], { xM: -950, yM: 2150 });
  assert.deepEqual(refs.riverGraph.edges[0].points[0], { xM: -950, yM: 2050 });
  assert.equal(adapter.sampleAt(-950, 2050).groundElevationM, 10);
  world.elevation[0] = 999; world.riverGraph.edges[0].points[0].x = 999;
  assert.equal(adapter.sampleAt(-950, 2050).groundElevationM, 10);
  assert.equal(adapter.toSnapshot().references.riverGraph.edges[0].points[0].xM, -950);
  assert.throws(() => fromDynamicRegional({ ...world, seed: undefined }), /seed/);
  assert.throws(() => fromDynamicRegional({ ...world, widthMeters: 999 }), /extent/);
});

test('irregular fields are continuous across raster boundaries and gradients use the same world stencil', () => {
  const input = plane();
  input.fields.groundElevationM = [10, 90, 30, 45, 50, 10, 100, 20, 40, 70, 15, 60, 80, 25, 55, 35];
  const adapter = createTerrainAdapter(input);
  const epsilon = 1e-6;
  for (const [x, y] of [[1150, 2175.25], [1227.75, 2250], [1250, 2250]]) {
    const a = adapter.sampleAt(x - epsilon, y - epsilon);
    const b = adapter.sampleAt(x + epsilon, y + epsilon);
    assert.ok(Math.abs(a.groundElevationM - b.groundElevationM) < 0.00001);
    assert.ok(Math.abs(a.waterDepthM - b.waterDepthM) < 0.00001);
    assert.ok(Math.abs(a.gradient.x - b.gradient.x) < 0.00001);
    assert.ok(Math.abs(a.gradient.y - b.gradient.y) < 0.00001);
  }
});

test('coordinate precision and overflowing derived values fail explicitly', () => {
  const precision = plane(); precision.frame.originXM = 1e20;
  assert.throws(() => createTerrainAdapter(precision), /representable/);
  const overflow = plane();
  overflow.fields.groundElevationM.fill(-1e308);
  overflow.fields.waterLevelElevationM.fill(1e308);
  assert.throws(() => createTerrainAdapter(overflow).sampleAt(1200, 2200), /Numeric range/);
});
