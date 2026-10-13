import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { designBuildingPad, createBuildingPadAdjustedTerrain } from '../building-pad.mjs';
import * as core from '../src/core/building-pad.mjs';
import { createTerrainAdapter, restoreTerrain } from '../index.mjs';
import { createRoadAdjustedTerrain } from '../road-earthwork.mjs';
import { baseTerrain, box, confluenceFixture, combinedWaterFixture } from '../fixtures/water-scenarios.mjs';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const building = (id = 'house') => ({ id, bounds: { minXM: 490, minYM: 490, maxXM: 510, maxYM: 510 } });
const explicitPad = (elevation, id = 'house') => ({ ...building(id), targetPadElevationM: elevation });
test('pad height bounds compose with the previous road bounds and cannot substitute roof height',()=>{
 const base=baseTerrain(()=>100),road=createRoadAdjustedTerrain(base,[{roadId:'r',halfWidthM:3,samples:[{xM:100,yM:500,distanceM:0,roadElevationM:104,structureKind:'at-grade'},{xM:900,yM:500,distanceM:800,roadElevationM:104,structureKind:'at-grade'}]}]),pad=createBuildingPadAdjustedTerrain(road,[explicitPad(110)]),range=pad.boundGroundElevation([100,100]);
 assert.ok(range[0]<=100&&range[1]>=110&&range[1]<110.001);
 for(let x=450;x<=550;x+=2)for(let y=480;y<=520;y+=2){const z=pad.groundElevationAt(x,y);assert.ok(z>=range[0]&&z<=range[1]);}
 assert.throws(()=>pad.boundGroundElevation([100,Infinity]),/interval/);
});
function staticWater(level = 102, role = 'surface') {
  const input = baseTerrain(() => 100).toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(400).fill(level);
  input.fields.waterLevelRole = role;
  return createTerrainAdapter(input);
}
function rebuild(recipe) {
  if (recipe.schema === 'minimal-world-building-pad-adjusted-terrain@1') {
    return createBuildingPadAdjustedTerrain(rebuild(recipe.baseTerrain), recipe.buildingPads, recipe.options);
  }
  if (recipe.schema === 'minimal-world-road-adjusted-terrain@1') {
    return createRoadAdjustedTerrain(rebuild(recipe.baseTerrain), recipe.roadCenterlineProfiles, recipe.options);
  }
  return restoreTerrain(recipe);
}

test('root exports point to the core implementation and flat ground has zero earthwork', () => {
  assert.equal(designBuildingPad, core.designBuildingPad);
  assert.equal(createBuildingPadAdjustedTerrain, core.createBuildingPadAdjustedTerrain);
  const base = baseTerrain(() => 100), pad = designBuildingPad(building(), base);
  assert.equal(pad.targetPadElevationM, 100); assert.equal(pad.buildingId, 'house');
  assert.equal(pad.areaM2, 400); assert.equal(pad.earthwork.totalVolumeM3, 0);
  assert.equal(pad.waterClearanceStatus, 'unresolved');
  const adjusted = createBuildingPadAdjustedTerrain(base, [pad]);
  assert.equal(adjusted.groundElevationAt(500, 500), 100);
  assert.deepEqual(adjusted.sampleAt(500, 500).gradient, { x: 0, y: 0 });
});

test('the area-weighted median minimizes absolute earthwork rather than selecting the mean', () => {
  // Three quarters of a flat footprint is 100m, one quarter is a 110m mound.
  const terrain = { sampleAt(xM, yM) { return { xM, yM, groundElevationM: xM < 15 ? 100 : 110,
    waterDepthM: null, waterLevelElevationM: null }; }, groundElevationAt(x) { return x < 15 ? 100 : 110; } };
  const site = { id: 'asymmetric', bounds: { minXM: 0, minYM: 0, maxXM: 20, maxYM: 20 } };
  const optimal = designBuildingPad(site, terrain, { maxStepM: 0.25 });
  const higher = designBuildingPad(site, terrain, { maxStepM: 0.25, foundationElevationM: 102.5 });
  const lower = designBuildingPad(site, terrain, { maxStepM: 0.25, foundationElevationM: 99 });
  assert.equal(optimal.targetPadElevationM, 100);
  assert.ok(optimal.earthwork.totalVolumeM3 < higher.earthwork.totalVolumeM3);
  assert.ok(optimal.earthwork.totalVolumeM3 < lower.earthwork.totalVolumeM3);
  assert.equal(optimal.earthwork.fillVolumeM3, 0); near(optimal.earthwork.cutVolumeM3, 1000, 10);
});

test('sloping ground becomes level throughout the polygon, including its perimeter', () => {
  const terrain = baseTerrain((x, y) => 100 + 0.1 * (x - 500) + 0.05 * (y - 500));
  const pad = designBuildingPad(building(), terrain);
  near(pad.targetPadElevationM, 100, 0.03);
  assert.ok(pad.earthwork.cutVolumeM3 > 0); assert.ok(pad.earthwork.fillVolumeM3 > 0);
  const adjusted = createBuildingPadAdjustedTerrain(terrain, [pad]);
  for (let x = 490; x <= 510; x += 2) for (let y = 490; y <= 510; y += 2) {
    assert.equal(adjusted.groundElevationAt(x, y), pad.targetPadElevationM);
    assert.deepEqual(adjusted.sampleAt(x, y).gradient, { x: 0, y: 0 });
  }
  assert.deepEqual(adjusted.surfaceFrameAt(500, 500).normal, { x: 0, y: 0, z: 1 });
});

test('explicit elevations are honored and platform volume estimates integrate a constant offset', () => {
  const base = baseTerrain(() => 100);
  for (const [target, kind] of [[104, 'fill'], [96, 'cut']]) {
    const pad = designBuildingPad({ ...building(), foundationElevationM: target }, base);
    assert.equal(pad.targetPadElevationM, target); assert.equal(pad.elevationMode, 'explicit');
    near(pad.earthwork.totalVolumeM3, 1600);
    near(pad.earthwork[kind === 'fill' ? 'fillVolumeM3' : 'cutVolumeM3'], 1600);
    assert.ok(pad.perimeterTransitions.every(p => p.structureKind === kind && p.batterWidthM === Math.hypot(1, 12)));
    const adjusted = createBuildingPadAdjustedTerrain(base, [pad]);
    assert.equal(adjusted.groundElevationAt(500, 500), target);
  }
  assert.equal(designBuildingPad({ ...building(), foundationElevationM: 104 }, base,
    { foundationElevationM: 105 }).targetPadElevationM, 105);
});

test('concave polygons retain their notch and triangle quadrature uses their actual area', () => {
  const site = { id: 'L', polygon: [[490, 490], [510, 490], [510, 500], [500, 500], [500, 510], [490, 510]] };
  const base = baseTerrain(() => 100), pad = designBuildingPad(site, base, { targetPadElevationM: 101, batterSlope: 3 });
  assert.equal(pad.areaM2, 300); near(pad.earthwork.fillVolumeM3, 300);
  const adjusted = createBuildingPadAdjustedTerrain(base, [pad]);
  assert.equal(adjusted.groundElevationAt(495, 505), 101); assert.equal(adjusted.groundElevationAt(505, 495), 101);
  assert.deepEqual(adjusted.sampleAt(507, 507), base.sampleAt(507, 507));
  const reversed = designBuildingPad({ ...site, polygon: site.polygon.toReversed() }, base, { targetPadElevationM: 101, batterSlope: 3 });
  assert.deepEqual(pad, reversed);
});

test('settlement point references accept explicit dimensions and anonymous footprints have stable IDs', () => {
  const base = baseTerrain(() => 100), snapshot = base.toSnapshot(); delete snapshot.worldId;
  snapshot.references.settlements = [{ id: 'village', kind: 'village', xM: 500, yM: 500 }];
  const terrain = createTerrainAdapter(snapshot), settlement = terrain.toSnapshot().references.settlements[0];
  const pad = designBuildingPad(settlement, terrain, { widthM: 20, depthM: 10 });
  assert.equal(pad.buildingId, settlement.id); assert.equal(pad.areaM2, 200);
  assert.deepEqual(pad.bounds, { minXM: 490, minYM: 495, maxXM: 510, maxYM: 505 });
  const anonymous = { polygon: box(490, 490, 510, 510) };
  assert.deepEqual(designBuildingPad(anonymous, terrain), designBuildingPad(anonymous, terrain));
  assert.throws(() => designBuildingPad(settlement, terrain), /widthM/);
});

test('smooth cut and fill batters join both platform and natural ground with zero end slope', () => {
  const base = baseTerrain(() => 100);
  for (const target of [104, 96]) {
    const adjusted = createBuildingPadAdjustedTerrain(base, [explicitPad(target)], { batterSlope: 0.5, derivativeStepM: 0.01 });
    const width = Math.hypot(1, 12);
    assert.equal(adjusted.groundElevationAt(500, 510), target);
    near(adjusted.groundElevationAt(500, 510 + width / 2), (target + 100) / 2);
    for (let offset = 0; offset <= width; offset += 0.05) {
      const y = 510 + offset, h = 1e-4;
      const slope = (adjusted.groundElevationAt(500, y + h) - adjusted.groundElevationAt(500, y - h)) / (2 * h);
      assert.ok(Math.abs(slope) <= 0.5 + 1e-6);
      near(adjusted.groundElevationAt(500, y), adjusted.groundElevationAt(500, 1000 - y));
    }
    for (const y of [510, 510 + width]) {
      const h = 1e-5;
      near(adjusted.groundElevationAt(500, y - h), adjusted.groundElevationAt(500, y + h), 1e-8);
      near((adjusted.groundElevationAt(500, y + h) - adjusted.groundElevationAt(500, y - h)) / (2 * h), 0, 1e-5);
    }
    assert.deepEqual(adjusted.sampleAt(500, 523), base.sampleAt(500, 523));
    const frame = adjusted.surfaceFrameAt(500, 510 + width / 2);
    near(Math.abs(frame.gradient.y), 6 / width, 1e-5);
    near(frame.normal.z, 1 / Math.hypot(frame.gradient.y, 1));
    assert.equal(frame.curvatureStatus, 'fixed-distance-estimate');
  }
});

test('Euclidean distance produces rounded polygon corner batters and separate cut/fill settings', () => {
  const base = baseTerrain(() => 100);
  const fill = createBuildingPadAdjustedTerrain(base, [explicitPad(104)], { fillBatterSlope: 0.25 });
  const halfWidth = Math.hypot(1, 24) / 2;
  near(fill.groundElevationAt(510 + halfWidth / Math.SQRT2, 510 + halfWidth / Math.SQRT2), 102);
  const cut = createBuildingPadAdjustedTerrain(base, [explicitPad(96)], { cutBatterSlope: 1 });
  near(cut.groundElevationAt(500, 510 + Math.hypot(1, 6) / 2), 98); assert.equal(cut.groundElevationAt(500, 517), 100);
  const broad = createBuildingPadAdjustedTerrain(base, [explicitPad(104)], { batterWidthM: 24 });
  near(broad.groundElevationAt(500, 510 + Math.hypot(24, 12) / 2), 102);
});

test('a pad equal to sloping natural ground at its perimeter still joins with a zero outer grade', () => {
  const terrain = baseTerrain((x, y) => 100 + 0.1 * (y - 510));
  const adjusted = createBuildingPadAdjustedTerrain(terrain, [explicitPad(100)]);
  const h = 1e-4;
  assert.equal(adjusted.groundElevationAt(500, 510), 100);
  near((adjusted.groundElevationAt(500, 510 + h) - 100) / h, 0, 1e-7);
  assert.ok(adjusted.groundElevationAt(500, 510.5) > 100);
  assert.deepEqual(adjusted.sampleAt(500, 520), terrain.sampleAt(500, 520));
});

test('known water levels raise the optimal pad for clearance and reject an unsafe explicit elevation', () => {
  const terrain = staticWater(), pad = designBuildingPad(building(), terrain, { clearanceM: 1 });
  assert.equal(pad.unconstrainedPadElevationM, 100); assert.equal(pad.targetPadElevationM, 103);
  assert.equal(pad.maxWaterLevelElevationM, 102); assert.equal(pad.minimumPadElevationM, 103);
  assert.equal(pad.waterClearanceStatus, 'sampled');
  assert.throws(() => designBuildingPad(building(), terrain, { foundationElevationM: 102, clearanceM: 1 }), /clearance/);
  assert.throws(() => createBuildingPadAdjustedTerrain(terrain, [{ ...pad, targetPadElevationM: 102 }]), /clearance/);
  const adjusted = createBuildingPadAdjustedTerrain(terrain, [pad]), center = adjusted.sampleAt(500, 500);
  assert.equal(center.waterLevelElevationM, 102); assert.equal(center.waterDepthM, 0);
  assert.equal(center.waterSurfaceElevationM, null); assert.equal(center.surfaceKind, 'ground');
  assert.deepEqual(center.waterSourceIds, []);
  const floodedBatter = adjusted.sampleAt(500, 516);
  assert.equal(floodedBatter.waterDepthM, 102 - floodedBatter.groundElevationM);
  assert.equal(floodedBatter.waterSurfaceElevationM, 102);
});

test('perimeter water probes include vertices and unknown water remains unresolved', () => {
  const base = baseTerrain(() => 100);
  const terrain = { ...base, sampleAt(x, y) {
    return { ...base.sampleAt(x, y), waterLevelElevationM: x === 510 && y === 510 ? 105 : null };
  } };
  const pad = designBuildingPad(building(), terrain);
  assert.equal(pad.targetPadElevationM, 105.5); assert.equal(pad.waterClearanceStatus, 'unresolved');
  const adjusted = createBuildingPadAdjustedTerrain(base, [explicitPad(104)]);
  assert.equal(adjusted.sampleAt(500, 500).waterDepthM, null);
  assert.equal(adjusted.sampleAt(500, 500).surfaceKind, 'unresolved');
});

test('cutting below known potential surface water recomputes depth and source IDs', () => {
  const base = staticWater(99), adjusted = createBuildingPadAdjustedTerrain(base, [explicitPad(96)]);
  assert.equal(base.sampleAt(500, 500).waterDepthM, 0);
  const wet = adjusted.sampleAt(500, 500);
  assert.equal(wet.waterDepthM, 3); assert.equal(wet.waterSurfaceElevationM, 99);
  assert.deepEqual(wet.waterSourceIds, ['water-level-grid']);
  const groundwater = staticWater(105, 'groundwater');
  const pad = designBuildingPad(building(), groundwater);
  assert.equal(pad.targetPadElevationM, 100); assert.equal(pad.maxWaterLevelElevationM, null);
  const dry = createBuildingPadAdjustedTerrain(groundwater, [explicitPad(96)]).sampleAt(500, 500);
  assert.equal(dry.waterDepthM, null); assert.equal(dry.waterSurfaceElevationM, null);
  assert.equal(dry.groundwaterLevelElevationM, 105);
});

test('modeled river levels and provenance survive platform fill without re-solving hydrology', () => {
  const base = confluenceFixture(), site = { id: 'river-site', polygon: box(246, 496, 254, 504) };
  const original = base.sampleAt(250, 500); assert.ok(original.waterDepthM > 0);
  const pad = designBuildingPad(site, base), adjusted = createBuildingPadAdjustedTerrain(base, [pad]);
  const center = adjusted.sampleAt(250, 500);
  assert.equal(center.waterLevelElevationM, original.waterLevelElevationM); assert.equal(center.waterDepthM, 0);
  assert.equal(center.basinId, original.basinId); assert.equal(center.hydrologyStatus, 'modeled');
  assert.deepEqual(adjusted.sampleAt(250, 600), base.sampleAt(250, 600));
  const mixed = combinedWaterFixture('groundwater'), mixedPad = designBuildingPad(building(), mixed);
  const mixedCenter = createBuildingPadAdjustedTerrain(mixed, [mixedPad]).sampleAt(500, 500);
  assert.equal(mixedCenter.waterDepthM, 0); assert.equal(mixedCenter.groundwaterLevelElevationM, 101);
});

test('building pads compose over road earthwork and preserve road samples outside the pad influence', () => {
  const base = staticWater(99);
  const profile = { roadId: 'road', halfWidthM: 3, samples: [100, 900].map((xM, i) => ({
    distanceM: i * 800, xM, yM: 500, roadElevationM: 104, structureKind: 'fill', gradeSlope: 0 })) };
  const road = createRoadAdjustedTerrain(base, [profile]);
  const pad = designBuildingPad(building(), road, { foundationElevationM: 106 });
  assert.equal(pad.sourceRoadAdjustmentId, road.roadAdjustmentId);
  const adjusted = createBuildingPadAdjustedTerrain(road, [pad]);
  assert.equal(adjusted.groundElevationAt(500, 500), 106);
  assert.equal(adjusted.sampleAt(500, 500).roadAdjustmentId, road.roadAdjustmentId);
  assert.deepEqual(adjusted.sampleAt(700, 500), road.sampleAt(700, 500));
  assert.deepEqual(adjusted.surfaceFrameAt(700, 500), road.surfaceFrameAt(700, 500));
  assert.throws(() => createBuildingPadAdjustedTerrain(base, [pad]), /sourceRoadAdjustmentId/);
  const rebuilt = rebuild(JSON.parse(JSON.stringify(adjusted.toSnapshot())));
  assert.equal(rebuilt.buildingPadAdjustmentId, adjusted.buildingPadAdjustmentId);
  for (const y of [500, 516, 530]) assert.deepEqual(rebuilt.sampleAt(500, y), adjusted.sampleAt(500, y));
});

test('direct sampling, windows, adjacent windows and LOD return exactly matching complete samples', () => {
  const base = baseTerrain(() => 100), adjusted = createBuildingPadAdjustedTerrain(base, [explicitPad(104)]);
  const area = { minXM: 480, minYM: 480, maxXM: 530, maxYM: 530 };
  const coarse = adjusted.sampleWindow({ ...area, spacingM: 2 }), fine = adjusted.sampleWindow({ ...area, spacingM: 1 });
  const byPosition = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) {
    assert.deepEqual(p, byPosition.get(`${p.xM},${p.yM}`)); assert.deepEqual(p, adjusted.sampleAt(p.xM, p.yM));
    assert.equal(p.groundElevationM, adjusted.groundElevationAt(p.xM, p.yM));
  }
  const left = adjusted.sampleWindow({ ...area, maxXM: 500, spacingM: 1 });
  const right = adjusted.sampleWindow({ ...area, minXM: 500, spacingM: 1 });
  assert.deepEqual(left.samples.filter(p => p.xM === 500), right.samples.filter(p => p.xM === 500));
  const trace = adjusted.traceSurfaceSegment({ xM: 500, yM: 480 }, { xM: 500, yM: 530 }, { maxStepM: 7 });
  assert.ok(trace.samples.some(p => p.yM === 490)); assert.ok(trace.samples.some(p => p.yM === 510));
  for (const { distanceM, ...p } of trace.samples) assert.deepEqual(p, adjusted.sampleAt(p.xM, p.yM));
  assert.deepEqual(createBuildingPadAdjustedTerrain(base).sampleAt(500, 500), base.sampleAt(500, 500));
});

test('pad ordering and query ordering cannot change overlapping platform or batter precedence', () => {
  const base = baseTerrain(() => 100), a = explicitPad(104, 'a');
  const b = { id: 'b', polygon: box(505, 505, 525, 525), targetPadElevationM: 102 };
  const one = createBuildingPadAdjustedTerrain(base, [a, b]), two = createBuildingPadAdjustedTerrain(base, [b, a]);
  assert.equal(one.buildingPadAdjustmentId, two.buildingPadAdjustmentId);
  assert.equal(one.groundElevationAt(507, 507), 104); assert.equal(one.groundElevationAt(520, 515), 102);
  for (let y = 475; y <= 540; y++) assert.deepEqual(one.sampleAt(515, y), two.sampleAt(515, y));
  const expected = one.sampleAt(515, 515);
  for (let y = 540; y >= 475; y--) one.sampleAt(515, y);
  assert.deepEqual(one.sampleAt(515, 515), expected);
});

test('designs and overlays own their inputs; source terrain and returned data remain isolated', () => {
  const base = baseTerrain(() => 100), original = base.toSnapshot(), site = building();
  const options = { foundationElevationM: 104, fillBatterSlope: 0.25 };
  const pad = designBuildingPad(site, base, options);
  site.bounds.minXM = 0; options.foundationElevationM = 999;
  assert.equal(pad.bounds.minXM, 490); assert.equal(pad.targetPadElevationM, 104);
  assert.ok(!Object.isFrozen(site.bounds));
  assert.throws(() => { pad.polygon[0].xM = 0; }, TypeError);
  assert.throws(() => { pad.perimeterTransitions[0].heightM = 999; }, TypeError);
  const mutable = JSON.parse(JSON.stringify(pad)), list = [mutable];
  const adjusted = createBuildingPadAdjustedTerrain(base, list), expected = adjusted.sampleAt(500, 516);
  mutable.targetPadElevationM = 999; mutable.polygon[0].xM = 0; list.length = 0;
  assert.deepEqual(adjusted.sampleAt(500, 516), expected);
  const returned = adjusted.sampleAt(500, 516); returned.gradient.y = 999;
  const recipe = adjusted.toSnapshot(); recipe.buildingPads[0].targetPadElevationM = 999;
  assert.deepEqual(adjusted.sampleAt(500, 516), expected); assert.deepEqual(base.toSnapshot(), original);
  assert.ok(Object.isFrozen(adjusted));
});

test('overlay recipes reproduce identical IDs and samples in a fresh Node process', () => {
  const base = staticWater(), pad = designBuildingPad(building(), base);
  const adjusted = createBuildingPadAdjustedTerrain(base, [pad]), recipe = adjusted.toSnapshot();
  assert.equal(recipe.schema, 'minimal-world-building-pad-adjusted-terrain@1');
  const code = `import {restoreTerrain} from './index.mjs';
    import {createBuildingPadAdjustedTerrain} from './building-pad.mjs';
    let data = ''; for await (const chunk of process.stdin) data += chunk;
    const r = JSON.parse(data), terrain = createBuildingPadAdjustedTerrain(restoreTerrain(r.baseTerrain), r.buildingPads, r.options);
    console.log(JSON.stringify({id: terrain.buildingPadAdjustmentId, sample: terrain.sampleAt(500, 516)}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: new URL('..', import.meta.url), input: JSON.stringify(recipe), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { id: adjusted.buildingPadAdjustmentId, sample: adjusted.sampleAt(500, 516) });
});

test('validation rejects invalid geometry, dimensions, budgets, stale identities and queries', () => {
  const base = baseTerrain(() => 100);
  for (const site of [{ polygon: [[0, 0], [1, 1], [2, 2]] },
    { polygon: [[490, 490], [510, 510], [490, 510], [510, 490]] },
    { polygon: [[490, 490], [490, 490], [510, 510]] },
    { polygon: [[490, 490], [510, 490], [500, 490], [500, 510], [490, 510]] },
    { bounds: { minXM: 500, minYM: 500, maxXM: 490, maxYM: 510 } }]) {
    assert.throws(() => designBuildingPad(site, base));
  }
  for (const options of [{ maxStepM: 0 }, { maxSamples: 1 }, { maxSamples: 262145 }, { maxSamples: 10 },
    { foundationElevationM: NaN }, { clearanceM: -1 }, { batterSlope: 0 }, { fillBatterSlope: Infinity }, { batterWidthM: -1 }]) {
    assert.throws(() => designBuildingPad(building(), base, options));
  }
  for (const options of [{ derivativeStepM: 0 }, { cutBatterSlope: -1 }, { fillBatterSlope: '0.5' }]) {
    assert.throws(() => createBuildingPadAdjustedTerrain(base, [], options));
  }
  const pad = designBuildingPad(building(), base);
  assert.throws(() => createBuildingPadAdjustedTerrain(base, [pad, pad]), /Duplicate/);
  assert.throws(() => createBuildingPadAdjustedTerrain(base, [{ ...pad, worldId: 'stale' }]), /worldId/);
  assert.throws(() => designBuildingPad({ ...building(), regionId: 'foreign' }, base), /regionId/);
  assert.throws(() => createBuildingPadAdjustedTerrain(base, [{ ...building(), targetPadElevationM: NaN }]), /finite/);
  assert.throws(() => designBuildingPad({ ...building(), bounds: { minXM: -1, minYM: 0, maxXM: 10, maxYM: 10 } }, base), /outside/);
  const adjusted = createBuildingPadAdjustedTerrain(base, [pad]);
  assert.throws(() => adjusted.groundElevationAt(NaN, 500), /finite/);
  assert.throws(() => adjusted.sampleAt(-1, 500), /outside/);
  assert.throws(() => adjusted.traceSurfaceSegment({ xM: 500, yM: 480 }, { xM: 500, yM: 530 }, { maxSamples: 3 }), /budget/);
  assert.equal(adjusted.surfaceFrameAt(0, 0).curvatureStatus, base.surfaceFrameAt(0, 0).curvatureStatus);
});

test('local pad envelopes retain concave boundary and batter uncertainty',()=>{
 const terrain=baseTerrain(()=>100),pad={id:'p',bounds:{minXM:490,maxXM:510,minYM:490,maxYM:510},targetPadElevationM:110},a=createBuildingPadAdjustedTerrain(terrain,[pad]);
 const inside=a.boundGroundElevation([100,100],{xM:500,yM:500,radiusM:1});assert.ok(inside[0]>109.999&&inside[1]<110.001);
 const far=a.boundGroundElevation([100,100],{xM:900,yM:900,radiusM:1});assert.ok(far[1]<100.001);
 for(const radiusM of [0,1,10,40])for(const xM of [500,510,535]){
  const range=a.boundGroundElevation([100,100],{xM,yM:500,radiusM});
  for(let i=0;i<32;i++){const angle=i*Math.PI/16,z=a.groundElevationAt(xM+radiusM*Math.cos(angle),500+radiusM*Math.sin(angle));assert.ok(z>=range[0]&&z<=range[1]);}
 }
 assert.throws(()=>a.boundGroundElevation([100,100],{xM:0,yM:0,radiusM:NaN}),/finite/);
});

test('rectangular pad clearance includes the same retaining batter as the physical surface', () => {
  const base = baseTerrain(() => 100);
  for (const elevation of [99, 100.1, 101]) {
    const pad = explicitPad(elevation), adjusted = createBuildingPadAdjustedTerrain(base, [pad]);
    for (let x = 480; x <= 520; x += 0.25) {
      const affected = core.buildingPadAffectsPoint(pad, x, 500, 100);
      const delta = Math.abs(adjusted.groundElevationAt(x, 500) - 100);
      assert.equal(affected, delta > 1e-10, `pad ${elevation}, x ${x}`);
    }
  }
});
