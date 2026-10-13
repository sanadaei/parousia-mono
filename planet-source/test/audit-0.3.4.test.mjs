import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { evaluateTrafficabilityAt, TRAFFICABILITY_DEFAULTS } from '../src/core/trafficability.mjs';
import { inspectRoadGradeSeparations, ROAD_CROSSING_STATUSES, ROAD_GRADE_SEPARATION_DEFAULTS } from '../src/core/road-junctions.mjs';
import { classifyTrafficability, terrainTrafficabilityAt, trafficRasterColor, TRAFFIC_CLASSES, TRAFFIC_COLORS, TRAFFIC_THRESHOLDS } from '../src/ui/trafficability.mjs';
import { normalizeRoadCrossing, deriveRoadCrossings, sceneJunctions, junctionMarker, summarizeJunctions, JUNCTION_SETTINGS } from '../src/ui/junctions.mjs';
import { TerrainTile } from '../src/ui/map-viewer.mjs';
import { sceneBundleForExport, loadScene } from '../src/ui/scene.mjs';
import { buildDemoScene } from '../src/ui/presets.mjs';
import { runVerification, requireVerificationMemory, VERIFICATION_LIMITS } from '../scripts/verification-runtime.mjs';

test('all legacy module entry points export the same core objects, including water boundary contacts', async () => {
  const files = readdirSync(new URL('../src/core/', import.meta.url)).filter(n => n.endsWith('.mjs') && existsSync(new URL(`../${n}`, import.meta.url)));
  assert.equal(files.length, 30);
  for (const file of files) {
    const legacy = await import(`../${file}`), core = await import(`../src/core/${file}`);
    assert.deepEqual(Object.keys(legacy), Object.keys(core), file);
    for (const key of Object.keys(core)) assert.equal(legacy[key], core[key], `${file}:${key}`);
  }
  const packaged = await import('minimal-world-continuous-terrain-adapter');
  const core = await import('../src/core/index.mjs');
  assert.equal(packaged.createTerrainAdapter, core.createTerrainAdapter);
});

test('UI and core agree on both movement modes at every default threshold, including null water', () => {
  for (const slope of [0, 0.3 - 1e-8, 0.3, 0.3 + 1e-8, 0.5, 0.5 + 1e-8, 1, 1 + 1e-8]) {
    for (const depth of [null, 0, 0.3, 0.3 + 1e-8, 0.4, 0.4 + 1e-8, 2]) {
      const sample = { slopeMPerM: slope, waterDepthM: depth, roughness: 0.2 };
      const terrain = { sampleAt: () => sample }, ui = classifyTrafficability(sample);
      for (const movementMode of ['pedestrian', 'vehicle']) {
        const core = evaluateTrafficabilityAt(terrain, 0, 0, { movementMode });
        assert.deepEqual(ui[movementMode], { class: core[`${movementMode}Class`], passable: core.isPassable, costFactor: core.costFactor });
      }
      assert.equal(ui.waterDepthM, depth);
      if (depth == null) assert.equal(ui.waterStatus, 'unknown');
    }
  }
  assert.equal(TRAFFIC_THRESHOLDS.offroadSlope, TRAFFICABILITY_DEFAULTS.maxWalkableSlopeMPerM);
  assert.equal(classifyTrafficability({ slopeMPerM: 0.85 }).pedestrian.class, 'difficult-scramble');
  assert.equal(classifyTrafficability({ slopeMPerM: 0.35 }).vehicle.passable, false);
  assert.equal(classifyTrafficability({ waterDepthM: 0.35 }).pedestrian.passable, false);
  assert.equal(classifyTrafficability({ waterDepthM: 0.35 }).vehicle.passable, true);
});

test('UI uses canonical road grade and deck overtopping rather than making every bridge passable', () => {
  const terrain = { sampleAt: () => ({ slopeMPerM: 0, groundElevationM: 90, waterDepthM: 10, waterLevelElevationM: 100 }),
    roadSurfaceAt: (xM) => ({ structureKind: 'bridge-deck', surfaceKind: 'road', roadElevationM: xM < 1 ? 101 : 99, slopeMPerM: xM > 2 ? 1.1 : 0 }) };
  assert.equal(terrainTrafficabilityAt(terrain, 0, 0).class, 'highway');
  const flooded = terrainTrafficabilityAt(terrain, 1, 0);
  assert.equal(flooded.waterDepthM, 1);
  assert.equal(flooded.pedestrian.passable, false);
  assert.equal(flooded.vehicle.class, 'flooded');
  assert.equal(terrainTrafficabilityAt({ ...terrain, sampleAt: () => ({ slopeMPerM: 0, waterDepthM: 0 }) }, 3, 0).class, 'cliff');
});

const crossingRoads = (upper, structureKind = 'bridge-deck') => [
  { id: 'lower', points: [{ xM: 0, yM: -10, roadElevationM: 100 }, { xM: 0, yM: 10, roadElevationM: 100 }] },
  { id: 'upper', structureKind, points: [{ xM: -10, yM: 0, roadElevationM: upper }, { xM: 10, yM: 0, roadElevationM: upper }] },
];
test('all four core crossing statuses survive UI normalization and retain clearance metadata', () => {
  const cases = [[100, 'at-grade', 'at-grade-matched'], [105, 'bridge-deck', 'grade-separated-clearance-met'],
    [102, 'bridge-deck', 'insufficient-vertical-clearance'], [100.2, 'bridge-deck', 'collision']];
  for (const [z, kind, status] of cases) {
    const raw = inspectRoadGradeSeparations(crossingRoads(z, kind)).crossings[0], ui = normalizeRoadCrossing(raw);
    assert.equal(raw.status, status); assert.equal(ui.status, status); assert.equal(ui.id, raw.crossingId);
    assert.deepEqual(ui.stationsM, raw.stationsM);
    assert.equal(ui.clearanceM, raw.verticalClearanceM);
    assert.equal(ui.requiredClearanceM, raw.requiredVehicleClearanceM);
    if (status === 'collision') assert.equal(junctionMarker(ui).color, '#ff3344');
  }
  assert.equal(ROAD_CROSSING_STATUSES.length, 4);
  assert.equal(JUNCTION_SETTINGS.minimumClearanceM, ROAD_GRADE_SEPARATION_DEFAULTS.requiredVehicleClearanceM);
  assert.equal(JUNCTION_SETTINGS.structureDepthM, 0.5);
  assert.equal(normalizeRoadCrossing({ xM: 0, yM: 0 }).status, null);
  assert.equal(summarizeJunctions({ rawBundle: { roadJunctions: { crossings: [] } }, overlays: {
    bridges: [{ roadId: 'overpass', crossingId: null }, { roadId: 'water-bridge', crossingId: 'wet-crossing' }] } }).waterBridges, 1);
});

test('UI derives the same core crossing result with internal vertical profile knots and custom deck thickness', () => {
  const roads = crossingRoads(105);
  roads[1].points.splice(1, 0, { xM: 0, yM: 0, roadElevationM: 104.2, gradeSlope: 0 });
  roads[1].deckThicknessM = 0.8;
  const scene = { overlays: { roads: roads.map(r => ({ ...r, points: [r.points[0], r.points.at(-1)] })) },
    roadProfiles: new Map(roads.map(r => [r.id, r.points.map((p, i) => ({ ...p,
      distanceM: i === 0 ? 0 : i === r.points.length - 1 ? 20 : 10, structureKind: r.structureKind ?? 'at-grade' }))])) };
  const expected = inspectRoadGradeSeparations(roads).crossings[0], actual = deriveRoadCrossings(scene)[0];
  assert.equal(actual.status, expected.status); assert.equal(actual.clearanceM, expected.clearanceM);
  assert.equal(actual.upperElevationM, expected.upperRoadElevationM);
});

test('legacy UI status aliases remain readable, while a core collision is never reclassified', () => {
  assert.equal(normalizeRoadCrossing({ status: 'clearance-met' }).status, 'grade-separated-clearance-met');
  const scene = { rawBundle: { roadJunctions: { crossings: [{ crossingId: 'hit', xM: 0, yM: 0,
    roadIds: ['a', 'b'], status: 'collision', verticalClearanceM: -0.2 }] } } };
  assert.equal(sceneJunctions(scene).roadCrossings[0].status, 'collision');
});

test('scene download preserves core crossing, culvert and source metadata through reload', async () => {
  const input = { ...buildDemoScene(), roadJunctions: { crossings: [{ crossingId: 'hit', xM: 300, yM: 600,
    roadIds: ['hill-road', 'valley-road'], status: 'collision', verticalClearanceM: -0.2 }] },
    culverts: [{ culvertId: 'drain', xM: 200, yM: 300, roadId: 'hill-road', invertElevationM: 20 }],
    provenance: { reviewId: 'explicit-fixture' } };
  const scene = await loadScene(input), saved = sceneBundleForExport(scene), reopened = await loadScene(JSON.stringify(saved));
  assert.deepEqual(saved.roadJunctions, input.roadJunctions);
  assert.deepEqual(saved.culverts, input.culverts); assert.deepEqual(saved.provenance, input.provenance);
  assert.deepEqual(sceneJunctions(reopened), sceneJunctions(scene));
  assert.equal(reopened.worldId, scene.worldId); assert.equal(reopened.roadAdjustmentId, scene.roadAdjustmentId);
});

test('map tiles retain core traffic classes so flooded carriageways are not painted green', () => {
  const sample = { groundElevationM: 99, gradient: { x: 0, y: 0 }, waterDepthM: 1, waterLevelElevationM: 100,
    structureKind: 'bridge-deck', surfaceKind: 'road', roadElevationM: 99 };
  const tile = new TerrainTile(0, 0, 0, { xM: 0, yM: 0 });
  tile.compute({ sampleAt: () => sample, trafficabilityAt: () => classifyTrafficability(sample) },
    { minXM: 0, minYM: 0, maxXM: 1, maxYM: 1 }, Infinity);
  assert.equal(TRAFFIC_CLASSES[tile.traffic[0]], 'deep-water');
  const rgb = [1, 3, 5].map(i => parseInt(TRAFFIC_COLORS['deep-water'].slice(i, i + 2), 16));
  assert.deepEqual(trafficRasterColor(0, 1), rgb);
  assert.deepEqual(trafficRasterColor(1, 0), [1, 3, 5].map(i => parseInt(TRAFFIC_COLORS.difficult.slice(i, i + 2), 16)));
});

test('UI geographic distance is the core function across date line, poles and antipodes', async () => {
  const core = await import('../src/core/spherical.mjs'), ui = await import('../src/ui/drainage.mjs');
  assert.equal(core.greatCircle, ui.greatCircle);
  assert.ok(Math.abs(ui.greatCircle({ latDeg: 0, lonDeg: 179 }, { latDeg: 0, lonDeg: -179 }).distanceM - 6371000 * Math.PI / 90) < 1e-6);
  assert.equal(ui.greatCircle({ latDeg: 90, lonDeg: 0 }, { latDeg: 90, lonDeg: 120 }).distanceM, 0);
  assert.ok(Math.abs(ui.greatCircle({ latDeg: 0, lonDeg: 0 }, { latDeg: 0, lonDeg: 180 }).distanceM - 6371000 * Math.PI) < 1e-6);
  assert.throws(() => ui.greatCircle({ latDeg: 91, lonDeg: 0 }, { latDeg: 0, lonDeg: 0 }), /Latitude/);
});

test('shared verification runtime enforces memory, child failure and timeout gates', () => {
  assert.throws(() => requireVerificationMemory(767), /defer verification/);
  assert.equal(requireVerificationMemory(768), 768);
  assert.equal(VERIFICATION_LIMITS.childHeapMiB, 256);
  assert.equal(runVerification(['-e', 'process.stdout.write("ok")']), 'ok');
  assert.throws(() => runVerification(['-e', 'process.exit(7)']), /Exit 7/);
  assert.throws(() => runVerification(['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 400 }), /ETIMEDOUT/);
});
