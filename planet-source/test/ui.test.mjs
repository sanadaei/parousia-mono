import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Viewport, clamp, lerp, elevationColor, waterColor, hillshade,
  polylineLength, formatMeters
} from '../src/ui/util.mjs';
import {
  loadScene, sampleLineProfile
} from '../src/ui/scene.mjs';
import { buildDemoScene, PRESETS } from '../src/ui/presets.mjs';

test('UI utilities clamp, lerp, and formatting work correctly', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(formatMeters(1234.56), '1234.56 m');
  assert.equal(formatMeters(0.42), '0.42 m');
  assert.equal(polylineLength([{ xM: 0, yM: 0 }, { xM: 30, yM: 40 }]), 50);
});

test('UI color palettes and hillshade return valid RGBA and shade factors', () => {
  const elevRgb = elevationColor(100, { minM: 0, maxM: 200 });
  assert.ok(Array.isArray(elevRgb) && elevRgb.length === 3);
  assert.ok(elevRgb.every(c => c >= 0 && c <= 255));

  const waterRgb = waterColor(5, 10);
  assert.ok(Array.isArray(waterRgb) && waterRgb.length === 3);

  const shade = hillshade({ x: 0.1, y: -0.1 });
  assert.ok(Number.isFinite(shade) && shade >= 0 && shade <= 1);
});

test('UI demo scene builds deterministically and samples profiles', async () => {
  const sceneInput = buildDemoScene();
  assert.ok(sceneInput.terrain);
  assert.equal(sceneInput.label, 'Demo valley');
  assert.ok(sceneInput.roads.length > 0);

  const scene = await loadScene(sceneInput);
  assert.ok(scene.terrain);
  assert.equal(scene.kind, 'planar');

  const p = scene.terrain.sampleAt(100, 100);
  assert.ok(Number.isFinite(p.groundElevationM));

  const profile = sampleLineProfile(scene, { xM: 0, yM: 100 }, { xM: 200, yM: 100 }, { targetSamples: 10 });
  assert.ok(profile.samples.length > 1);
  assert.equal(profile.samples[0].distanceM, 0);
  assert.ok(profile.lengthM > 0);
});

test('UI presets catalog is available', () => {
  assert.ok(PRESETS.length >= 4);
  const demoPreset = PRESETS.find(p => p.id === 'demo');
  assert.ok(demoPreset);
  assert.ok(demoPreset.label.includes('Demo'));
});

test('UI trafficability classifier identifies roads, water and slope categories', async () => {
  const { classifyTrafficability } = await import('../src/ui/trafficability.mjs');
  const road = classifyTrafficability({ slopeMPerM: 0.1, structureKind: 'bridge-deck' });
  assert.equal(road.class, 'highway');
  assert.equal(road.passable, true);

  const deepWater = classifyTrafficability({ waterDepthM: 2.0 });
  assert.equal(deepWater.class, 'deep-water');
  assert.equal(deepWater.passable, false);

  const cliff = classifyTrafficability({ slopeMPerM: 1.05 });
  assert.equal(cliff.class, 'cliff');
  assert.equal(cliff.passable, false);

  const gentle = classifyTrafficability({ slopeMPerM: 0.1 });
  assert.equal(gentle.class, 'offroad');
  assert.equal(gentle.passable, true);
});

// ---------- Drainage / basin layer and multi-chart overlays ----------

test('UI drainage layer is registered, off by default and toggleable from the quick layers', async () => {
  const { DEFAULT_LAYERS } = await import('../src/ui/map-viewer.mjs');
  const { QUICK_LAYERS } = await import('../src/ui/app.mjs');
  const { DRAINAGE_SETTINGS } = await import('../src/ui/drainage.mjs');
  assert.equal(DEFAULT_LAYERS.drainage, false);
  assert.ok(Object.isFrozen(DEFAULT_LAYERS));
  assert.deepEqual(QUICK_LAYERS.find(([label]) => label === 'Drainage')?.[1], ['drainage']);
  assert.ok(DRAINAGE_SETTINGS.basinAlpha > 0 && DRAINAGE_SETTINGS.basinAlpha < 1);
  assert.ok(DRAINAGE_SETTINGS.arrowSpacingPx > 0 && DRAINAGE_SETTINGS.maxSinkMarkers > 0);
  const ui = await import('../src/ui/index.mjs');
  for (const name of ['basinPalette', 'basinColor', 'flowBearingDeg', 'describeWaterCharts', 'drainageRows']) assert.equal(typeof ui[name], 'function', name);
});

test('UI basin palette is deterministic, valid and well separated', async () => {
  const { basinPalette, basinColor, basinKey, hashBasinKey, hslToRgb } = await import('../src/ui/drainage.mjs');
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
  const palette = basinPalette(12);
  assert.equal(palette.length, 12);
  assert.deepEqual(basinPalette(12), palette);
  assert.deepEqual(basinPalette(0), []);
  assert.throws(() => basinPalette(-1), RangeError);
  for (const c of palette) assert.ok(c.length === 3 && c.every(v => Number.isInteger(v) && v >= 0 && v <= 255));
  // Neighbouring palette entries differ clearly (golden-angle hue steps).
  for (let i = 1; i < palette.length; i++) {
    const d = Math.hypot(...palette[i].map((v, k) => v - palette[i - 1][k]));
    assert.ok(d > 60, `palette[${i - 1}] vs palette[${i}] too similar (${d.toFixed(1)})`);
  }
  // Basin keys prefer basinId, then outletCellIndex, then basinIndex.
  assert.equal(basinKey({ basinId: 'w/outlet:7', outletCellIndex: 7 }), 'w/outlet:7');
  assert.equal(basinKey({ basinId: null, outletCellIndex: 7 }), 'outlet:7');
  assert.equal(basinKey({ basinIndex: 3 }), 'basin:3');
  assert.equal(basinKey({}), null);
  assert.equal(basinColor({}), null);
  assert.deepEqual(basinColor('w/outlet:7'), basinColor({ basinId: 'w/outlet:7' }));
  assert.notDeepEqual(basinColor('w/outlet:7'), basinColor('w/outlet:8'));
  assert.ok(hashBasinKey('') > 0 && hashBasinKey('a') !== hashBasinKey('b'));
});

test('UI flow direction, trapped flow and local minima helpers', async () => {
  const { flowBearingDeg, formatFlowDirection, compassPoint, isTrappedFlow, basinStatusOf, isLocalMinimum } = await import('../src/ui/drainage.mjs');
  // Ground rising to the north drains south; rising to the east drains west.
  assert.equal(flowBearingDeg({ x: 0, y: 0.1 }), 180);
  assert.equal(flowBearingDeg({ x: 0.1, y: 0 }), 270);
  assert.equal(flowBearingDeg({ x: -0.1, y: -0.1 }), 45);
  assert.equal(flowBearingDeg({ x: 0, y: 0 }), null);
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(135), 'SE');
  assert.equal(formatFlowDirection(45), '45.0° NE');
  assert.equal(formatFlowDirection(null), 'flat / undefined');
  assert.equal(isTrappedFlow({ basinStatus: 'depression' }), true);
  assert.equal(isTrappedFlow({ basinStatus: 'unresolved-terminal' }), true);
  assert.equal(isTrappedFlow({ flowTrapped: true }), true);
  assert.equal(isTrappedFlow({ basinStatus: 'source-drainage' }), false);
  assert.equal(basinStatusOf({ basinStatus: 'source-drainage' }), 'source-drainage');
  assert.equal(basinStatusOf({ basinId: 'b:1' }), 'modeled-basin');
  assert.equal(basinStatusOf({}), null);
  const bowl = [3, 3, 3, 3, 1, 3, 3, 3, 3];
  assert.equal(isLocalMinimum(bowl, 3, 3, 1, 1), true);
  assert.equal(isLocalMinimum(bowl, 3, 3, 0, 0), false);
  assert.equal(isLocalMinimum([3, 3, 3, 3, 1, 1, 3, 3, 3], 3, 3, 1, 1), false);
});

test('UI terrain tiles store basin hashes and report sinks for the drainage layer', async () => {
  const { TerrainTile, TILE_SIZE } = await import('../src/ui/map-viewer.mjs');
  const { hashBasinKey } = await import('../src/ui/drainage.mjs');
  // A bowl centred in the tile; the west strip is a trapped depression basin.
  const c = TILE_SIZE / 2 + 0.5; // on a sample centre
  const sampler = { sampleAt: (x, y) => ({ groundElevationM: (x - c) ** 2 + (y - c) ** 2, gradient: { x: 2 * (x - c), y: 2 * (y - c) },
    waterDepthM: 0, basinId: x < 20 ? 'west' : 'east', basinStatus: x < 20 ? 'depression' : 'source-drainage' }) };
  const tile = new TerrainTile(0, 0, 0, { xM: 0, yM: 0 });
  assert.ok(tile.compute(sampler, { minXM: 0, minYM: 0, maxXM: TILE_SIZE, maxYM: TILE_SIZE }, Infinity));
  assert.equal(tile.basin[0], hashBasinKey('west'));
  assert.equal(tile.basin[TILE_SIZE - 1], hashBasinKey('east'));
  const sinks = tile.sinkList();
  assert.ok(sinks.some(s => s.kind === 'pit' && s.xM === c && s.yM === c), 'bowl bottom is a pit');
  assert.ok(sinks.some(s => s.kind === 'depression' && s.xM < 20));
  assert.ok(sinks.every(s => s.kind === 'pit' || s.xM < 20));
  assert.equal(tile.sinkList(), sinks, 'sinks are cached');
});

test('UI multi-chart boundaries, labels and seam markers are formatted', async () => {
  const { chartBoundaryPolygon, formatChartLabel, chartSeamMarkers, describeWaterCharts, sceneWaterCharts, greatCircle } = await import('../src/ui/drainage.mjs');
  const bounds = { minXM: -6000, minYM: -4000, maxXM: 6000, maxYM: 4000 };
  assert.deepEqual(chartBoundaryPolygon(bounds), [{ xM: -6000, yM: -4000 }, { xM: 6000, yM: -4000 }, { xM: 6000, yM: 4000 }, { xM: -6000, yM: 4000 }]);
  const projection = { kind: 'spherical-azimuthal-equidistant@1', centerLatDeg: 12, centerLonDeg: -45.5, radiusM: 6371000, maxRadiusM: 100000 };
  assert.equal(formatChartLabel({ id: 'delta', projection, bounds }), 'delta · 12.00°, -45.50° · 12 × 8 km');
  assert.equal(formatChartLabel({ id: 'bare' }), 'bare');
  const chart = { id: 'delta', projection, bounds, model: { edges: [
    { id: 'outflow', points: [{ xM: 0, yM: 0 }, { xM: 6000, yM: 120 }] },
    { id: 'inner', points: [{ xM: -10, yM: 0 }, { xM: 10, yM: 0 }] },
    { id: 'inflow', points: [{ xM: 200, yM: -4000 }, { xM: 0, yM: 0 }] }] } };
  assert.deepEqual(chartSeamMarkers(chart).map(s => [s.edgeId, s.role, s.side]), [['outflow', 'end', 'east'], ['inflow', 'start', 'south']]);
  const gc = greatCircle({ latDeg: 0, lonDeg: 0 }, { latDeg: 0, lonDeg: 90 }, 1);
  assert.ok(Math.abs(gc.distanceM - Math.PI / 2) < 1e-12 && Math.abs(gc.bearingDeg - 90) < 1e-9);
  // A neighbour 0.05° east is re-projected into the active chart frame; a far chart is only listed.
  const near = { id: 'near', projection: { ...projection, centerLonDeg: -45.45 }, bounds: { minXM: -1000, minYM: -1000, maxXM: 1000, maxYM: 1000 } };
  const far = { id: 'far', projection: { ...projection, centerLatDeg: -60 }, bounds };
  const snapshot = { schema: 'minimal-world-global-water-terrain@2', waterCharts: [chart, near, far] };
  const charts = describeWaterCharts(snapshot, 0);
  assert.deepEqual(charts.map(c => [c.id, c.active, c.polygon !== null]), [['delta', true, true], ['near', false, true], ['far', false, false]]);
  assert.equal(charts[0].seams.length, 2);
  assert.deepEqual(charts[0].seams[0].local, { xM: 6000, yM: 120 });
  const n = charts[1].polygon.length;
  const nearCenter = charts[1].polygon.reduce((a, p) => ({ xM: a.xM + p.xM / n, yM: a.yM + p.yM / n }), { xM: 0, yM: 0 });
  assert.ok(Math.abs(nearCenter.xM - 0.05 * Math.PI / 180 * 6371000 * Math.cos(12 * Math.PI / 180)) < 50 && Math.abs(nearCenter.yM) < 50);
  assert.ok(charts[2].distanceM > 7e6 && Math.abs(charts[2].bearingDeg - 180) < 1e-6);
  assert.deepEqual(describeWaterCharts({ schema: 'minimal-world-terrain@2' }), []);
  assert.deepEqual(sceneWaterCharts({ rawBundle: { terrain: snapshot }, viewIndex: 2 }).map(c => c.active), [false, false, true]);
  assert.deepEqual(sceneWaterCharts(null), []);
});

test('UI inspector reports drainage fields and the drainage preset is registered', async () => {
  const { inspectPoint, inspectionRows } = await import('../src/ui/inspector.mjs');
  const scene = await loadScene(buildDemoScene(), { buildRoads: false });
  const info = inspectPoint(scene, 300, 600);
  for (const key of ['basinId', 'basinStatus', 'outletCellIndex', 'waterChartId', 'flowDirectionDeg', 'trappedFlow']) assert.ok(key in info, key);
  assert.equal(info.waterChartId, null);
  assert.ok(info.flowDirectionDeg === null || (info.flowDirectionDeg >= 0 && info.flowDirectionDeg < 360));
  const drainage = inspectionRows(info).find(([title]) => title === 'Drainage')[1];
  assert.deepEqual(drainage.slice(0, 5).map(([k]) => k), ['basinId', 'basinStatus', 'outletCellIndex', 'waterChartId', 'flow direction']);
  const preset = PRESETS.find(p => p.id === 'global-drainage');
  assert.ok(preset && /Drainage/.test(preset.label) && /Multi-Chart/.test(preset.label));
  assert.equal(preset.layers.drainage, true);
  assert.ok(Number.isInteger(preset.viewIndex));
});


// ---------- Road junctions, overpasses and culverts ----------

/** Synthetic scene: road a (y = 0, deck at 110 m) crossed by b (100 m), c (106 m) and d (ungraded, ground 110 m); e ends on a. */
function junctionScene() {
  const line = (id, pts, halfWidthM = 3) => ({ id, halfWidthM, points: pts.map(([xM, yM]) => ({ xM, yM })) });
  const flat = elevation => [{ distanceM: 0, roadElevationM: elevation }, { distanceM: 200, roadElevationM: elevation }];
  return {
    overlays: {
      roads: [line('a', [[-100, 0], [100, 0]]), line('b', [[0, -100], [0, 100]]), line('c', [[50, -100], [50, 100]]),
        line('d', [[-50, -100], [-50, 100]]), line('e', [[-80, -50], [-80, 0]])],
      rivers: [{ id: 'creek', points: [{ xM: 20, yM: -50 }, { xM: 20, yM: 50 }] }, { id: 'river', points: [{ xM: 70, yM: -50 }, { xM: 70, yM: 50 }] }],
      sourceRivers: [],
      bridges: [{ roadId: 'a', crossingId: 'a/river', startDistanceM: 160, endDistanceM: 180, minClearanceM: 3, deckElevationM: 110,
        design: { minimumClearanceM: 2 }, points: [{ xM: 60, yM: 0 }, { xM: 80, yM: 0 }] }],
    },
    crossings: [], roadErrors: [], roadInspection: null,
    roadProfiles: new Map([['a', flat(110)], ['b', flat(100)], ['c', flat(106)]]),
    base: { groundElevationAt: (xM, yM) => (yM === 0 ? 110 : 100) },
  };
}

test('UI road-road crossings are classified by vertical clearance', async () => {
  const { classifyRoadCrossing, deriveRoadCrossings, JUNCTION_SETTINGS } = await import('../src/ui/junctions.mjs');
  assert.equal(classifyRoadCrossing({ verticalSeparationM: 0.2 }), 'collision');
  assert.equal(classifyRoadCrossing({ verticalSeparationM: 10 }), 'grade-separated-clearance-met');
  assert.equal(classifyRoadCrossing({ verticalSeparationM: 4 }), 'insufficient-vertical-clearance');
  assert.equal(classifyRoadCrossing({ clearanceM: 5.2, requiredClearanceM: 5.5 }), 'insufficient-vertical-clearance');
  assert.equal(classifyRoadCrossing({}), null);
  assert.equal(JUNCTION_SETTINGS.minimumClearanceM, 4.5);

  const found = deriveRoadCrossings(junctionScene());
  const byPair = Object.fromEntries(found.map(c => [[...c.roadIds].sort().join(''), c]));
  assert.deepEqual(Object.keys(byPair).sort(), ['ab', 'ac', 'ad', 'ae']);
  const ab = byPair.ab;
  assert.equal(ab.status, 'grade-separated-clearance-met');
  assert.equal(ab.kind, 'grade-separated');
  assert.deepEqual([ab.upperRoadId, ab.lowerRoadId], ['a', 'b']);
  assert.deepEqual([ab.xM, ab.yM], [0, 0]);
  assert.deepEqual(ab.stationsM, { a: 100, b: 100 });
  assert.equal(ab.verticalSeparationM, 10);
  assert.equal(ab.clearanceM, 10);
  assert.equal(byPair.ac.status, 'insufficient-vertical-clearance');
  assert.equal(byPair.ac.clearanceM, 4);
  assert.equal(byPair.ad.status, 'at-grade-matched', 'ungraded road meets the deck at ground level');
  assert.equal(byPair.ae.status, 'at-grade-matched', 'a road ending on another is a junction');
  assert.equal(byPair.ae.upperRoadId, null);
  assert.equal(found.filter(c => c.xM === -80).length, 1, 'end join and segment touch merge');
});

test('UI culverts are derived outside bridge spans and summarized', async () => {
  const { deriveCulverts, summarizeCulverts } = await import('../src/ui/junctions.mjs');
  const culverts = deriveCulverts(junctionScene());
  assert.equal(culverts.length, 1, 'the bridged river is not a culvert');
  const [k] = culverts;
  assert.equal(k.roadId, 'a');
  assert.equal(k.stationM, 120);
  assert.deepEqual([k.xM, k.yM], [20, 0]);
  assert.equal(k.invertElevationM, 110);
  assert.equal(k.roadElevationM, 110);
  assert.deepEqual(k.waterSourceIds, ['creek']);
  assert.deepEqual(k.flowDirection, { x: 0, y: 1 });

  const sum = summarizeCulverts([k, { ...k, id: 'k2', roadId: 'b', invertElevationM: 95, coverM: 4 }, { ...k, id: 'k3', invertElevationM: null, coverM: null }]);
  assert.equal(sum.count, 3);
  assert.deepEqual([...sum.byRoad.keys()], ['a', 'b']);
  assert.equal(sum.byRoad.get('a').length, 2);
  assert.equal(sum.minInvertElevationM, 95);
  assert.equal(sum.maxInvertElevationM, 110);
  assert.equal(sum.minCoverM, 0);
  assert.deepEqual(summarizeCulverts([]), { count: 0, byRoad: new Map(), minInvertElevationM: null, maxInvertElevationM: null, minCoverM: null });
});

test('UI crossing panel summary counts water bridges, overpasses, junctions and culverts', async () => {
  const { summarizeCrossings } = await import('../src/ui/crossing-panel.mjs');
  const sum = summarizeCrossings(junctionScene());
  assert.equal(sum.total, 0);
  assert.equal(sum.bridges.length, 1);
  assert.equal(sum.junctions.waterBridges, 1);
  assert.equal(sum.junctions.overpasses, 2);
  assert.equal(sum.junctions.atGrade, 2);
  assert.deepEqual(sum.junctions.byStatus, { 'grade-separated-clearance-met': 1, 'insufficient-vertical-clearance': 1, 'at-grade-matched': 2, collision: 0 });
  assert.equal(sum.junctions.culverts, 1);
  assert.equal(sum.culverts.count, 1);
  assert.equal(sum.culverts.minInvertElevationM, 110);
});

test('UI core junction and culvert records take precedence and are normalized', async () => {
  const { sceneJunctions, normalizeRoadCrossing, normalizeCulvert } = await import('../src/ui/junctions.mjs');
  const scene = { ...junctionScene(), roadJunctions: {
    crossings: [{ id: 'x1', upperRoadId: 'a', lowerRoadId: 'b', point: { xM: 0, yM: 0 }, upperElevationM: 110, lowerElevationM: 106 },
      { id: 'x2', roadIds: ['a', 'e'], xM: -80, yM: 0, kind: 'at-grade' },
      { id: 'x3', upperRoadId: 'a', lowerRoadId: 'c', xM: 50, yM: 0, status: 'grade-separated-clearance-met', clearanceM: 6 }],
    culverts: [{ culvertId: 'k1', roadId: 'a', distanceM: 120, xM: 20, yM: 0, invertM: 108.2, roadElevationM: 110 }],
  } };
  const { roadCrossings, culverts } = sceneJunctions(scene);
  assert.deepEqual(roadCrossings.map(c => [c.id, c.kind, c.status]),
    [['x1', 'grade-separated', 'insufficient-vertical-clearance'], ['x2', 'at-grade', 'at-grade-matched'], ['x3', 'grade-separated', 'grade-separated-clearance-met']]);
  assert.equal(roadCrossings[0].verticalSeparationM, 4);
  assert.deepEqual(roadCrossings[0].direction, { x: 1, y: 0 }, 'direction filled from the upper road');
  assert.equal(sceneJunctions(scene), sceneJunctions(scene), 'cached per scene');
  assert.equal(culverts.length, 1);
  assert.equal(culverts[0].id, 'k1');
  assert.equal(culverts[0].stationM, 120);
  assert.equal(culverts[0].invertElevationM, 108.2);
  assert.ok(Math.abs(culverts[0].coverM - 1.8) < 1e-9);
  assert.ok(Math.abs(culverts[0].flowDirection.x) < 1e-12 && culverts[0].flowDirection.y === 1, 'culvert flow defaults across the road');
  assert.equal(normalizeRoadCrossing({ xM: 1, yM: 2, roadIds: ['p', 'q'] }, 7).id, 'junction:7');
  assert.equal(normalizeCulvert({ xM: 1, yM: 2 }, 3).id, 'culvert:3');
});

test('UI junction markers, labels and inspector rows are formatted', async () => {
  const { deriveRoadCrossings, deriveCulverts, junctionMarker, formatJunctionLabel, junctionLocation, junctionFeaturesNear,
    JUNCTION_STATUS_COLORS, CULVERT_COLOR } = await import('../src/ui/junctions.mjs');
  const { junctionRows } = await import('../src/ui/inspector.mjs');
  const { DEFAULT_LAYERS } = await import('../src/ui/map-viewer.mjs');
  const scene = junctionScene(), found = deriveRoadCrossings(scene), [culvert] = deriveCulverts(scene);
  const over = found.find(c => c.status === 'grade-separated-clearance-met'), low = found.find(c => c.status === 'insufficient-vertical-clearance');
  const atGrade = found.find(c => c.kind === 'at-grade');
  assert.deepEqual(junctionMarker(over), { shape: 'overpass', color: JUNCTION_STATUS_COLORS['grade-separated-clearance-met'], sizePx: 9, label: 'a over b' });
  assert.equal(junctionMarker(low).color, JUNCTION_STATUS_COLORS['insufficient-vertical-clearance']);
  assert.equal(junctionMarker(over, { focused: true }).sizePx, 12);
  assert.equal(junctionMarker(atGrade).shape, 'circle');
  assert.ok(junctionMarker(atGrade).sizePx < junctionMarker(over).sizePx, 'at-grade rings are subtle');
  assert.deepEqual(junctionMarker(culvert), { shape: 'culvert', color: CULVERT_COLOR, sizePx: 6, label: 'culvert a' });
  assert.equal(formatJunctionLabel(over), 'a over b');
  assert.match(formatJunctionLabel(atGrade), /^a × [de] junction$/);
  const loc = junctionLocation(over);
  assert.deepEqual(loc.center, { xM: 0, yM: 0 });
  assert.ok(loc.bounds.minXM < 0 && loc.bounds.maxXM > 0);
  assert.equal(DEFAULT_LAYERS.junctions, true);

  const near = junctionFeaturesNear(scene, 18, 2);
  assert.deepEqual(near.map(n => n.type), ['culvert', 'overpass'], 'culvert at 2.8 m, overpass a/b at 18.1 m');
  assert.deepEqual(junctionFeaturesNear(scene, 0, 90), []);
  const rows = junctionRows({ junctions: near });
  assert.deepEqual(rows.map(([k]) => k), ['culvert', 'invert', 'cover', 'drains', 'overpass', 'status', 'clearance', 'upper / lower']);
  assert.equal(rows[0][1], `a @ ${formatMeters(120, 1)} · ${formatMeters(Math.hypot(2, 2), 1)} away`);
  assert.equal(rows[1][1], formatMeters(110, 2));
  assert.equal(rows[5][1], 'Clearance met');
  assert.equal(rows[6][1], `${formatMeters(10, 2)} (min ${formatMeters(4.5, 2)})`);
  const ui = await import('../src/ui/index.mjs');
  for (const name of ['sceneJunctions', 'summarizeJunctions', 'summarizeCulverts', 'junctionMarker', 'classifyRoadCrossing', 'junctionRows']) {
    assert.equal(typeof ui[name], 'function', name);
  }
});

test('UI demo scene inspection carries junction context without errors', async () => {
  const { inspectPoint, inspectionRows } = await import('../src/ui/inspector.mjs');
  const { summarizeCrossings } = await import('../src/ui/crossing-panel.mjs');
  const scene = await loadScene(buildDemoScene());
  const sum = summarizeCrossings(scene);
  assert.ok(Number.isInteger(sum.junctions.overpasses) && Number.isInteger(sum.junctions.culverts));
  const info = inspectPoint(scene, 300, 600);
  assert.ok(Array.isArray(info.junctions));
  const titles = inspectionRows(info).map(([t]) => t);
  assert.equal(titles.includes('Junctions & culverts'), info.junctions.length > 0);
});
