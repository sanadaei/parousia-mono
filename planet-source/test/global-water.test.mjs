import test from 'node:test';
import assert from 'node:assert/strict';
import { globalFixture, detailBands } from '../fixtures/global-scenarios.mjs';
import { createGlobalTerrain, createProjectedTerrainView, restoreGlobalTerrain, restoreProjectedTerrainView, serializeGlobalTerrain } from '../global-terrain.mjs';
import { connectGlobalSurfaceWater, connectProjectedSurfaceWater, GLOBAL_WATER_TERRAIN_SCHEMA } from '../global-water.mjs';
import { createProjectedGroundBounds, LEGACY_PROJECTED_GROUND_BOUNDS_METHOD } from '../projected-ground-bounds.mjs';
import { createSphericalProjection } from '../spherical.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
import { sphericalBowlFixture } from '../fixtures/global-water-scenarios.mjs';
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const bounds = { minXM: -5000, minYM: -5000, maxXM: 5000, maxYM: 5000 };
function graph(x = 0) {
  const a = { id: 'source', xM: x, yM: -1000 }, b = { id: 'out', xM: x, yM: 1000 };
  return { nodes: [a, b], edges: [{ id: 'river', from: a.id, to: b.id, points: [a, b] }] };
}
const flat = () => globalFixture({ height: () => 100 });
function connect(base = flat(), options = {}) {
  return connectGlobalSurfaceWater(base, { centerLatDeg: 0, centerLonDeg: 180, verticalDatum: 'fixture-zero', riverGraph: graph(), ...options });
}
const polygon = b => [[b.minXM, b.minYM], [b.maxXM, b.minYM], [b.maxXM, b.maxYM], [b.minXM, b.maxYM]].map(([xM, yM]) => ({ xM, yM }));

test('spherical Lipschitz bounds cover detailed field differences, rectangles and segments including poles', () => {
  const base = globalFixture({ bands: detailBands });
  for (const [lat, lon] of [[15, 150], [0, 180], [12, 0], [90, 0], [-90, 0], [89.98, 179.99]]) {
    const projection = createSphericalProjection({ centerLatDeg: lat, centerLonDeg: lon, radiusM: base.frame.radiusM });
    const analysis = createProjectedGroundBounds(base, projection, bounds, 100), L = analysis.contract.lipschitzMPerM;
    assert.ok(Number.isFinite(L) && L >= 0);
    for (let y = -4000; y <= 4000; y += 1000) for (let x = -4000; x <= 4000; x += 1000) {
      const z = analysis.ground(x, y);
      for (const [dx, dy] of [[1, 0], [0, 1], [37, -61]]) assert.ok(Math.abs(analysis.ground(x + dx, y + dy) - z) <= L * Math.hypot(dx, dy) + 1e-7);
    }
    const rect = { minXM: -537, minYM: -619, maxXM: 712, maxYM: 531 }, range = analysis.rectangleBounds(rect);
    for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
      const z = analysis.ground(rect.minXM + (rect.maxXM - rect.minXM) * i / 20, rect.minYM + (rect.maxYM - rect.minYM) * j / 20);
      assert.ok(z >= range.min - 1e-7 && z <= range.max + 1e-7);
    }
    const a = { xM: -537, yM: -619 }, b = { xM: 712, yM: 531 }, minimum = analysis.ground.segmentMinimum(a, b, 70, 83).minimum;
    for (let i = 0; i <= 100; i++) { const t = i / 100; assert.ok(analysis.ground(a.xM * (1 - t) + b.xM * t, a.yM * (1 - t) + b.yM * t) - 70 * (1 - t) - 83 * t >= minimum - 1e-7); }
  }
  const p = createSphericalProjection({ centerLatDeg: 90, centerLonDeg: 0, radiusM: 6371000 });
  assert.equal(createProjectedGroundBounds(flat(), p, bounds).contract.lipschitzMPerM, 0);
});
test('ground bounds reject unreasonable steps and probe work before allocating a huge grid', () => {
  const p = createSphericalProjection({ centerLatDeg: 0, centerLonDeg: 0, radiusM: 6371000 });
  assert.throws(() => createProjectedGroundBounds(flat(), p, bounds, .1), /step/);
  assert.throws(() => createProjectedGroundBounds(flat(), p, bounds, 1001), /step/);
  const analysis = createProjectedGroundBounds(flat(), p, bounds, 1, { method: LEGACY_PROJECTED_GROUND_BOUNDS_METHOD });
  assert.throws(() => analysis.rectangleBounds(bounds), /probe budget/);
  assert.equal(p.toLocalIfWithin(0, 180), null);
});
test('explicit global channels keep one sphere, retain source basin IDs and leave outside coverage unknown', () => {
  const base = flat(), before = base.toSnapshot(), water = connect(base), view = createProjectedTerrainView(water, { centerLatDeg: 0, centerLonDeg: 180 });
  assert.deepEqual(base.toSnapshot(), before); assert.equal(water.schema, GLOBAL_WATER_TERRAIN_SCHEMA);
  assert.notEqual(water.worldId, base.worldId); assert.equal(water.sourceWorldId, base.sourceWorldId);
  const wet = view.sampleAt(0, 0), dry = view.sampleAt(300, 0), source = base.sampleAt(wet.latDeg, wet.lonDeg);
  near(wet.waterDepthM, 1.2); near(wet.channelGroundDeltaM, -1.35); assert.equal(wet.hydrologyStatus, 'modeled');
  assert.equal(wet.basinId, source.basinId); assert.deepEqual(wet.waterSourceIds, ['river']); assert.equal(dry.waterDepthM, 0);
  const outside = view.toGeographic(6000, 0), sample = water.sampleAt(outside.latDeg, outside.lonDeg);
  assert.equal(sample.waterDepthM, null); assert.equal(sample.surfaceKind, 'unresolved');
  assert.equal(sample.groundElevationM, base.groundElevationAt(outside.latDeg, outside.lonDeg));
  near(water.groundElevationAt(30, 30), base.groundElevationAt(30, 30), 0);
});
test('channels work across the date line and both polar charts with geometric metadata intact', () => {
  for (const [lat, lon] of [[14, 179.99], [90, 0], [-90, 0]]) {
    const water = connect(flat(), { centerLatDeg: lat, centerLonDeg: lon });
    const view = createProjectedTerrainView(water, { centerLatDeg: lat, centerLonDeg: lon });
    for (const y of [-800, 0, 800]) {
      const sample = view.sampleAt(0, y); assert.ok(sample.waterDepthM > 1.19); assert.equal(sample.hydrologyStatus, 'modeled');
      near(sample.waterSurfaceElevationM - sample.groundElevationM, sample.waterDepthM);
      const frame = view.surfaceFrameAt(0, y); near(Math.hypot(...Object.values(frame.normal)), 1);
    }
    if (Math.abs(lat) === 90) assert.equal(view.sampleAt(0, 0).sourceCellIndex, null);
  }
});
test('same spherical water survives LOD, adjacent windows and alternate projection centers', () => {
  const water = connect(globalFixture({ bands: detailBands }), { centerLatDeg: 15, centerLonDeg: 150 });
  const view = createProjectedTerrainView(water, { centerLatDeg: 15, centerLonDeg: 150 });
  const area = { minXM: -50, minYM: -50, maxXM: 50, maxYM: 50 }, fine = new Map(view.sampleWindow({ ...area, spacingM: 5 }).samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of view.sampleWindow({ ...area, spacingM: 25 }).samples) assert.deepEqual(p, fine.get(`${p.xM},${p.yM}`));
  const left = view.sampleWindow({ ...area, maxXM: 0, spacingM: 5 }), right = view.sampleWindow({ ...area, minXM: 0, spacingM: 5 });
  assert.deepEqual(left.samples.filter(p => p.xM === 0), right.samples.filter(p => p.xM === 0));
  const other = createProjectedTerrainView(water, { centerLatDeg: 15.001, centerLonDeg: 150.001 });
  for (const y of [-600, 0, 600]) {
    const sample = view.sampleAt(0, y), xy = other.toLocal(sample.latDeg, sample.lonDeg), same = other.sampleAt(xy.xM, xy.yM);
    near(sample.groundElevationM, same.groundElevationM); near(sample.waterDepthM, same.waterDepthM);
    assert.equal(sample.basinId, same.basinId); assert.equal(sample.worldId, same.worldId);
  }
});
test('global water save/restoration keeps fitted widths, frames, hashes and owns all copies', () => {
  const options = { riverGraph: graph(), verticalDatum: 'fixture-zero' }, base = flat();
  const view = connectProjectedSurfaceWater(createProjectedTerrainView(base, { centerLatDeg: 0, centerLonDeg: 180 }), options);
  options.riverGraph.nodes[0].xM = 3000;
  const saved = view.toSnapshot(), restored = restoreProjectedTerrainView(JSON.stringify(saved));
  for (const x of [-4.8, -1, 0, 1, 4.8, 100]) assert.deepEqual(restored.surfaceFrameAt(x, 0), view.surfaceFrameAt(x, 0));
  const global = restoreGlobalTerrain(serializeGlobalTerrain(createGlobalTerrain(saved.world)));
  assert.equal(global.worldId, view.worldId);
  saved.world.waterChart.model.edges[0].points[0].depthM = 100;
  assert.throws(() => restoreProjectedTerrainView(saved), /worldId mismatch/);
  assert.ok(view.sampleAt(0, 0).waterDepthM < 2);
});
test('incision limits and saved derived bounds are enforced again on restoration', () => {
  assert.throws(() => connect(flat(), { maxCenterIncisionM: 1 }), /incision/i);
  const water = connect(flat(), { maxCenterIncisionM: 2 });
  let saved = water.toSnapshot(); delete saved.worldId; saved.waterChart.groundAnalysis.lipschitzMPerM = 100;
  assert.throws(() => createGlobalTerrain(saved), /bounds disagree/);
  saved = water.toSnapshot(); delete saved.worldId;
  for (const node of saved.waterChart.model.nodes) node.waterLevelElevationM -= 100;
  for (const edge of saved.waterChart.model.edges) for (const p of edge.points) p.waterLevelElevationM -= 100;
  saved.waterChart.model.diagnostics.maxCenterIncisionM += 100;
  assert.throws(() => createGlobalTerrain(saved), /incision limit/);
  saved = water.toSnapshot(); delete saved.worldId; saved.waterChart.model.basins = {};
  assert.throws(() => createGlobalTerrain(saved), /source spherical basins/);
});
test('water input datum must match and translated ground uses the declared target datum', () => {
  assert.throws(() => connect(flat(), { verticalDatum: undefined }), /datum/i);
  assert.throws(() => connect(flat(), { verticalDatum: 'different-zero' }), /datum/i);
  const input = flat().toSnapshot(); delete input.worldId; input.frame.verticalDatum = 'shifted-zero'; input.frame.elevationOffsetM = 250;
  const base = createGlobalTerrain(input), water = connect(base, { verticalDatum: 'shifted-zero' });
  near(water.sampleAt(0, 180).waterSurfaceElevationM, 349.85); near(water.sampleAt(0, 180).waterDepthM, 1.2);
});
test('explicit water bodies define partial coverage while wet internal envelopes are rejected', () => {
  const body = { id: 'explicit-ocean', kind: 'ocean', waterLevelElevationM: 101, polygon: polygon(bounds) };
  const water = connect(flat(), { riverGraph: graph(), waterBodies: [body] }), view = createProjectedTerrainView(water, { centerLatDeg: 0, centerLonDeg: 180 });
  assert.equal(view.sampleAt(300, 0).waterDepthM, 1); near(view.sampleAt(0, 0).waterDepthM, 1.2);
  const p = view.toGeographic(6000, 0); assert.equal(water.sampleAt(p.latDeg, p.lonDeg).waterDepthM, null);
  assert.throws(() => connect(flat(), { riverGraph: { nodes: [], edges: [] }, waterBodies: [{ ...body,
    polygon: polygon({ minXM: -2000, minYM: -2000, maxXM: 2000, maxYM: 2000 }) }] }), /Wet body envelope/);
});
test('global channel cuts cannot introduce a ground discontinuity at a chart edge or stack charts', () => {
  const g = graph(); g.nodes[0].yM = -4999; g.edges[0].points[0].yM = -4999;
  assert.throws(() => connect(flat(), { riverGraph: g }), /support must stay inside/);
  const water = connect(), view = createProjectedTerrainView(water, { centerLatDeg: 0, centerLonDeg: 180 });
  for (const x of [4999.999, 5000, 5000.001]) { const p = view.toGeographic(x, 0); near(water.groundElevationAt(p.latDeg, p.lonDeg), 100); }
  assert.throws(() => connect(water), /base global terrain/);
});

test('an explicit spherical lake meets the unchanged ground at an internal dry shore', () => {
  const { base, ...options } = sphericalBowlFixture(), world = connectGlobalSurfaceWater(base, options);
  const view = createProjectedTerrainView(world, options), saved = restoreGlobalTerrain(serializeGlobalTerrain(world));
  near(view.sampleAt(0, 0).waterDepthM, 30, 1e-7);
  let lo = 0, hi = 5000;
  for (let i = 0; i < 45; i++) { const x = (lo + hi) / 2; if (view.groundElevationAt(x, 0) < 50) lo = x; else hi = x; }
  const wet = view.sampleAt(lo - .001, 0), dry = view.sampleAt(hi + .001, 0);
  assert.ok(wet.waterDepthM > 0 && wet.waterDepthM < .001); assert.equal(dry.waterDepthM, 0);
  for (const x of [0, lo, hi, 5000, 5000.001]) {
    const p = view.sampleAt(x, 0); assert.equal(p.groundElevationM, base.groundElevationAt(p.latDeg, p.lonDeg));
    assert.deepEqual(saved.sampleAt(p.latDeg, p.lonDeg), world.sampleAt(p.latDeg, p.lonDeg));
  }
  const snapshot = world.toSnapshot(); delete snapshot.worldId; snapshot.waterChart.centerIncisionUpperBoundM += 1;
  assert.throws(() => createGlobalTerrain(snapshot), /incision bound mismatch/);
});
test('same-projection mesh events detect a narrow global river with coarse road probes and bind bridge IDs', () => {
  const water = connect(flat(), { riverGraph: graph(137) }), view = createProjectedTerrainView(water, { centerLatDeg: 0, centerLonDeg: 180 });
  const roads = [{ id: 'crossing', points: [{ xM: -1000, yM: 0 }, { xM: 1000, yM: 0 }] }];
  const report = inspectRoadCrossings(view, { roads, maxStepM: 3000 }); assert.equal(report.crossings.length, 1);
  assert.match(report.precision, /mesh\/body\/coverage/);
  const crossing = report.crossings[0], bridges = [{ crossingId: crossing.crossingId, worldId: view.worldId, regionId: view.regionId, deckElevationM: crossing.requiredDeckElevationM }];
  assert.equal(inspectRoadCrossings(view, { roads, maxStepM: 3000, bridges }).crossings[0].status, 'sampled-clearance-met');
  assert.throws(() => inspectRoadCrossings(view, { roads, bridges: [{ ...bridges[0], regionId: 'stale' }] }), /regionId/);
  const outside = createProjectedTerrainView(water, { centerLatDeg: 0, centerLonDeg: 180, bounds: { ...bounds, minXM: -10000, maxXM: 10000 } });
  const partial = inspectRoadCrossings(outside, { roads: [{ id: 'partial', points: [{ xM: -8000, yM: 0 }, { xM: 8000, yM: 0 }] }], maxStepM: 1000 });
  assert.ok(partial.unresolvedWaterSamples > 0); assert.equal(partial.crossings.length, 1);
});
