import test from 'node:test';
import assert from 'node:assert/strict';
import { globalInput, globalFixture, detailBands } from '../fixtures/global-scenarios.mjs';
import { createGlobalTerrain, createProjectedTerrainView, restoreGlobalTerrain, restoreProjectedTerrainView, serializeGlobalTerrain, fromGeographyLite } from '../global-terrain.mjs';
import { createSphericalProjection } from '../spherical.mjs';
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('global C1 sampling retains every source center and canonical longitude/poles', () => {
  const terrain = globalFixture({ bands: detailBands }), input = globalInput();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const p = terrain.sampleAt(90 - (y + 0.5) * 45, (x + 0.5) * 45);
    assert.equal(p.groundElevationM, input.fields.groundElevationM[y * 8 + x]); assert.equal(p.detailElevationM, 0);
    assert.equal(p.sourceCellIndex, y * 8 + x);
  }
  assert.deepEqual(terrain.sampleAt(23, 180), terrain.sampleAt(23, -180));
  assert.deepEqual(terrain.sampleAt(23, 540), terrain.sampleAt(23, -180));
  assert.deepEqual(terrain.sampleAt(90, -123), terrain.sampleAt(90, 71));
  assert.deepEqual(terrain.sampleAt(-90, 42), terrain.sampleAt(-90, -78));
  assert.equal(terrain.sampleAt(90, 0).sourceCellIndex, null); assert.equal(terrain.sampleAt(90, 0).basinStatus, 'undefined-at-pole');
});
test('periodic field and polar caps have matching one-sided first derivatives', () => {
  // The shortest band is 5km: use centimeter-scale angular probes so finite
  // second-derivative error does not masquerade as a discontinuity.
  const terrain = globalFixture({ bands: detailBands }), eps = 1e-7;
  for (const lat of [-60, -12, 0, 60]) for (const lon of [0, 22.5, 67.5, 180]) {
    const z = terrain.groundElevationAt(lat, lon);
    near((z - terrain.groundElevationAt(lat, lon - eps)) / eps, (terrain.groundElevationAt(lat, lon + eps) - z) / eps, 0.001);
  }
  for (const lat of [-67.5, -22.5, 22.5, 67.5]) for (const lon of [3, 57, -175]) {
    const z = terrain.groundElevationAt(lat, lon);
    near((z - terrain.groundElevationAt(lat - eps, lon)) / eps, (terrain.groundElevationAt(lat + eps, lon) - z) / eps, 0.001);
  }
  for (const lat of [-90, 90]) for (const lon of [-165, 0, 113]) near(terrain.groundElevationAt(lat, lon), terrain.groundElevationAt(lat > 0 ? lat - eps : lat + eps, lon), 1e-8);
});
test('fixed detail bands vary between source centers but obey four-corner/amplitude constraints', () => {
  const terrain = globalFixture({ bands: detailBands }), field = globalInput().fields.groundElevationM; let varied = 0;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 8; x++) {
    const corners = [field[y * 8 + x], field[y * 8 + (x + 1) % 8], field[(y + 1) * 8 + x], field[(y + 1) * 8 + (x + 1) % 8]];
    for (let i = 1; i < 10; i++) {
      const p = terrain.sampleAt(90 - (y + 0.5 + i / 10) * 45, (x + 0.5 + (10 - i) / 10) * 45);
      assert.ok(p.groundElevationM >= Math.min(...corners) - 1e-8 && p.groundElevationM <= Math.max(...corners) + 1e-8);
      assert.ok(Math.abs(p.detailElevationM) <= 24 + 1e-8); if (Math.abs(p.detailElevationM) > 1e-5) varied++;
    }
  }
  assert.ok(varied > 50); assert.equal(globalFixture({ bands: detailBands, height: () => 50 }).sampleAt(20, 123).detailElevationM, 0);
});
test('source drainage IDs and feature membership survive detail and explicit datum offsets', () => {
  const plain = globalFixture(), detailed = globalFixture({ bands: detailBands });
  const p = plain.sampleAt(22.5, 157.5), q = detailed.sampleAt(22.5, 157.5);
  assert.equal(p.outletCellIndex, 10); assert.equal(p.basinId, q.basinId); assert.equal(p.sourceWorldId, q.sourceWorldId);
  assert.equal(p.sourceMacroCellId, 'cell-1'); assert.deepEqual(p.geographicFeatureIds, ['fixture-range']);
  assert.equal(q.sourceLakeFillDepthM, 80); assert.equal(q.hydrologyStatus, 'unresolved'); assert.equal(q.waterDepthM, null);
  const input = globalInput({ bands: detailBands }); input.frame.verticalDatum = 'offset-zero'; input.frame.elevationOffsetM = 250;
  const shifted = createGlobalTerrain(input); near(shifted.sampleAt(12, 140).groundElevationM - detailed.sampleAt(12, 140).groundElevationM, 250);
  assert.equal(shifted.sampleAt(12, 140).basinId, detailed.sampleAt(12, 140).basinId); assert.notEqual(shifted.worldId, detailed.worldId);
});
test('global ownership, deterministic band ordering and restoration reject stale identities', () => {
  const input = globalInput({ bands: detailBands }), terrain = createGlobalTerrain(input), witness = terrain.sampleAt(30, 140);
  const reversed = globalInput({ bands: [...detailBands].reverse() }); assert.equal(createGlobalTerrain(reversed).worldId, terrain.worldId);
  input.fields.groundElevationM[0] = 999; input.references.features[0].id = 'edited';
  const returned = terrain.toSnapshot(); returned.detail.bands[0].amplitudeM = 100; returned.fields.landMask[0] = 1;
  witness.geographicFeatureIds.push('edited');
  const restored = restoreGlobalTerrain(serializeGlobalTerrain(terrain)); assert.deepEqual(restored.sampleAt(30, 140), terrain.sampleAt(30, 140));
  const saved = terrain.toSnapshot(); saved.detail.bands[0].amplitudeM += 1; assert.throws(() => restoreGlobalTerrain(saved), /worldId mismatch/);
  const badOutlet = terrain.toSnapshot(); badOutlet.fields.basinOutletCellIndex[3] = 9; assert.throws(() => restoreGlobalTerrain(badOutlet), /basin outlets/);
});
test('malformed global coordinates, drainage, detail and source grids fail before use', () => {
  let input = globalInput(); input.fields.downstream[3] = 4; assert.throws(() => createGlobalTerrain(input), /acyclic/);
  input = globalInput(); input.fields.downstream[3] = 19; assert.throws(() => createGlobalTerrain(input), /neighboring/);
  input = globalInput(); input.fields.downstream[0] = 1; assert.throws(() => createGlobalTerrain(input), /ocean cells/);
  input = globalInput(); input.grid.northToSouth = false; assert.throws(() => createGlobalTerrain(input), /coordinate/);
  input = globalInput(); input.frame.radiusM = 0; assert.throws(() => createGlobalTerrain(input), /radius/);
  input = globalInput(); input.frame.elevationOffsetM = 1; assert.throws(() => createGlobalTerrain(input), /datum/);
  input = globalInput(); input.detail.bands = [{ id: 'bad', wavelengthM: 0, amplitudeM: 1 }]; assert.throws(() => createGlobalTerrain(input), /wavelength/);
  input = globalInput(); input.grid.columns = 512; input.grid.rows = 512; assert.throws(() => createGlobalTerrain(input), /131072/);
  assert.throws(() => globalFixture().sampleAt(91, 0), /Latitude/); assert.throws(() => globalFixture().sampleAt(0, NaN), /finite/);
});
test('absent source lake/flow proxies remain unknown rather than becoming zero', () => {
  const input = globalInput(); delete input.fields.lakeFillDepthM; delete input.fields.runoffIndex;
  const terrain = createGlobalTerrain(input), sample = terrain.sampleAt(22.5, 157.5);
  assert.equal(sample.sourceLakeFillDepthM, null); assert.equal(sample.sourceRunoffIndex, null);
  assert.equal(sample.waterDepthM, null); assert.equal(terrain.toSnapshot().fields.lakeFillDepthM, null);
  assert.deepEqual(restoreGlobalTerrain(serializeGlobalTerrain(terrain)).sampleAt(22.5, 157.5), sample);
});
test('spherical projection round trips meters across the date line and both poles', () => {
  for (const [lat, lon] of [[14, 179.99], [90, 50], [-90, -30], [89.9, -165], [0, 0]]) {
    const projection = createSphericalProjection({ centerLatDeg: lat, centerLonDeg: lon, radiusM: 6371000 });
    for (const [x, y] of [[0, 0], [5000, 3000], [-5000, -7000], [120, -50]]) {
      const geo = projection.toGeographic(x, y), local = projection.toLocal(geo.latDeg, geo.lonDeg);
      near(local.xM, x, 2e-6); near(local.yM, y, 2e-6);
    }
  }
  const projection = createSphericalProjection({ centerLatDeg: 0, centerLonDeg: 0, radiusM: 6371000 });
  assert.throws(() => projection.toGeographic(200000, 0), /projection radius/); assert.throws(() => projection.toLocal(0, 180), /projection radius/);
  assert.throws(() => createSphericalProjection({ centerLatDeg: 0, centerLonDeg: 0, radiusM: 6371000, maxRadiusM: 1000000 }), /0.1/);
});
test('projected views retain all common samples across LOD/tiles including boundary derivatives', () => {
  const world = globalFixture({ bands: detailBands });
  for (const [lat, lon] of [[22.5, 157.5], [14, 179.99], [90, 0], [-90, 0]]) {
    const view = createProjectedTerrainView(world, { centerLatDeg: lat, centerLonDeg: lon });
    const coarse = view.sampleWindow({ ...view.bounds, spacingM: 1000 }), fine = view.sampleWindow({ ...view.bounds, spacingM: 500 });
    const byCoordinate = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
    for (const p of coarse.samples) assert.deepEqual(p, byCoordinate.get(`${p.xM},${p.yM}`));
    const left = view.sampleWindow({ ...view.bounds, maxXM: 0, spacingM: 500 }), right = view.sampleWindow({ ...view.bounds, minXM: 0, spacingM: 500 });
    assert.deepEqual(left.samples.filter(p => p.xM === 0), right.samples.filter(p => p.xM === 0));
    const otherBounds = createProjectedTerrainView(world, { centerLatDeg: lat, centerLonDeg: lon, bounds: { ...view.bounds, maxXM: 10000 } });
    const a = view.surfaceFrameAt(5000, 0), b = otherBounds.surfaceFrameAt(5000, 0);
    near(a.gradient.x, b.gradient.x, 0); assert.deepEqual(a.normal, b.normal); assert.deepEqual(a.curvature, b.curvature);
    assert.equal(a.curvatureStatus, 'fixed-distance-projected-estimate');
  }
});
test('regional geographic correspondence keeps one global world and source basin', () => {
  const world = globalFixture({ bands: detailBands }), view = createProjectedTerrainView(world, { centerLatDeg: 22.5, centerLonDeg: 157.5 });
  for (const [x, y] of [[0, 0], [1000, 500], [-4000, -2000]]) {
    const p = view.toGeographic(x, y), globalSample = world.sampleAt(p.latDeg, p.lonDeg), localSample = view.sampleAt(x, y);
    assert.equal(localSample.groundElevationM, globalSample.groundElevationM); assert.equal(localSample.basinId, globalSample.basinId);
    assert.equal(localSample.sourceCellIndex, globalSample.sourceCellIndex); assert.equal(view.worldId, world.worldId);
  }
});
test('projected surface frames and identities survive JSON including poles and flat terrain', () => {
  for (const [lat, lon] of [[20, 140], [90, 0], [-90, 0]]) {
    const view = createProjectedTerrainView(globalFixture({ bands: detailBands, height: () => 50 }), { centerLatDeg: lat, centerLonDeg: lon });
    const restored = restoreProjectedTerrainView(JSON.stringify(view.toSnapshot()));
    for (const [x, y] of [[0, 0], [5000, 5000], [-4300, -1500]]) {
      const frame = view.surfaceFrameAt(x, y); near(Math.hypot(...Object.values(frame.normal)), 1); near(frame.curvature.meanPerM, 0, 1e-8);
      assert.deepEqual(frame, restored.surfaceFrameAt(x, y)); assert.deepEqual(JSON.parse(JSON.stringify(frame)), frame);
    }
    const changed = view.toSnapshot(); changed.bounds.maxXM += 1; assert.throws(() => restoreProjectedTerrainView(changed), /regionId/);
  }
});
test('invalid regional extents, projection saves and sampling budgets are rejected', () => {
  const global = globalFixture();
  assert.throws(() => createProjectedTerrainView(global, { centerLatDeg: 0, centerLonDeg: 0, maxRadiusM: 100 }), /margin/);
  const view = createProjectedTerrainView(global, { centerLatDeg: 0, centerLonDeg: 0 });
  assert.throws(() => view.sampleAt(6000, 0), /outside/);
  assert.throws(() => view.sampleWindow({ ...view.bounds, spacingM: 1 }), /oversized/);
  assert.throws(() => view.sampleWindow({ ...view.bounds, spacingM: 300 }), /Invalid/);
  const bad = view.toSnapshot(); bad.projection.radiusM = 1; assert.throws(() => restoreProjectedTerrainView(bad), /contract mismatch/);
});
test('geography bridge checks schema and dimensions without generating a source world', () => {
  const input = globalInput(), source = { schema: 'project-toki-geography@0.10.0', geographySeed: 'fixture', width: 4, height: 2,
    physicalGrid: [8, 4], cells: Array.from({ length: 8 }, (_, i) => ({ id: `cell-${i}`, index: i, x: i % 4, y: Math.floor(i / 4) })),
    physical: { schema: 'project-toki-physical-geography@0.10.0', width: 8, height: 4, macroScale: { x: 2, y: 2 }, elevationM: input.fields.groundElevationM,
      landMask: input.fields.landMask, downstream: input.fields.downstream, lakeDepthM: input.fields.lakeFillDepthM, riverFlow: input.fields.runoffIndex } };
  const options = { radiusM: 6371000, sourceVerticalDatum: 'fixture-zero', verticalDatum: 'fixture-zero' };
  const global = fromGeographyLite(source, options); assert.equal(global.grid.columns, 8); assert.equal(global.sampleAt(22.5, 157.5).sourceMacroCellId, 'cell-1');
  source.physical.macroScale.x = 3; assert.throws(() => fromGeographyLite(source, options), /subdivision/);
  source.schema = 'unknown'; assert.throws(() => fromGeographyLite(source, options), /schema/);
});
