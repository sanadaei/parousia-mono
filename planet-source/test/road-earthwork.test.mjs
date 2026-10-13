import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteNumber, positiveNumber, nonEmptyText, integerDimension, copyNumericField } from '../contract-validation.mjs';
import { designBridgeProfile, sampleRoadCenterlineProfile, createRoadAdjustedTerrain } from '../road-earthwork.mjs';
import { inspectRoadCrossings } from '../road-crossings.mjs';
import { restoreTerrain, createTerrainAdapter } from '../index.mjs';
import { connectSurfaceWater } from '../surface-water.mjs';
import { baseTerrain, confluenceFixture, lakeOceanFixture, box } from '../fixtures/water-scenarios.mjs';

const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const road = (points = [{ xM: 50, yM: 500 }, { xM: 450, yM: 500 }], id = 'test-road') => ({ id, halfWidthM: 3, points });
const crossing = (r = road()) => ({ crossingId: `${r.id}/crossing:0`, roadId: r.id,
  startDistanceM: 195, endDistanceM: 205, maxWaterLevelElevationM: 100, requiredDeckElevationM: 101,
  dryApproachBefore: { distanceM: 194, groundElevationM: 100, waterSurfaceElevationM: null },
  dryApproachAfter: { distanceM: 206, groundElevationM: 100, waterSurfaceElevationM: null } });
function supportedProfile(elevation, id = 'earthwork', kind = 'fill', y = 500) {
  return { roadId: id, halfWidthM: 3, samples: [100, 900].map((xM, i) => ({ distanceM: i * 800, xM, yM: y,
    roadElevationM: elevation, structureKind: kind, gradeSlope: 0 })) };
}

test('road height intervals include Hermite interior extrema and preserve the source interval',()=>{
  const terrain=baseTerrain(()=>100),profile=supportedProfile(105);profile.samples[0].gradeSlope=.04;profile.samples[1].gradeSlope=-.04;
  const road=createRoadAdjustedTerrain(terrain,[profile]),range=road.boundGroundElevation([100,100]);
  assert.ok(range[0]<=100&&range[1]>115);
  for(let x=100;x<=900;x+=8)for(const y of [495,500,505]){const z=road.groundElevationAt(x,y);assert.ok(z>=range[0]&&z<=range[1]);}
  assert.throws(()=>road.boundGroundElevation([101,100]),/interval/);
});

test('shared contracts retain values, reject coercion, and support typed fields and predicates', () => {
  assert.equal(finiteNumber(3, 'n'), 3); assert.equal(positiveNumber(3, 'n'), 3);
  assert.equal(nonEmptyText('  datum  ', 'datum'), '  datum  ');
  assert.equal(integerDimension(1, 'rows', 1), 1); assert.equal(integerDimension(0, 'rows', 0), 0);
  assert.throws(() => finiteNumber('3', 'n'), TypeError); assert.throws(() => finiteNumber(Infinity, 'n'), TypeError);
  assert.throws(() => positiveNumber(0, 'n'), RangeError); assert.throws(() => nonEmptyText(' ', 'n'), TypeError);
  assert.throws(() => integerDimension(2.5, 'n'), RangeError); assert.throws(() => integerDimension(2, 'n', -1), RangeError);
  const input = new Float64Array([1, 2]), owned = copyNumericField(input, 2, 'samples', positiveNumber);
  input[0] = 9; assert.deepEqual(owned, [1, 2]);
  assert.deepEqual(copyNumericField([0, 1], 2, 'mask', v => v === 0 || v === 1), [0, 1]);
  assert.ok(Object.is(copyNumericField([-0], 1, 'zero')[0], -0));
  assert.throws(() => copyNumericField([2], 1, 'mask', v => v === 0), RangeError);
  assert.throws(() => copyNumericField([, 2], 2, 'sparse'), TypeError);
  assert.throws(() => copyNumericField(new BigInt64Array([1n]), 1, 'big'), TypeError);
  assert.throws(() => copyNumericField(new DataView(new ArrayBuffer(8)), 1, 'view'), RangeError);
  assert.throws(() => copyNumericField([1], 2, 'short'), RangeError);
  assert.throws(() => copyNumericField([1], 1, 'transform', () => NaN), TypeError);
});

test('bridge deck clearance includes structural thickness and the diagnosed minimum', () => {
  const r = road(), c = crossing(r), p = designBridgeProfile(c, r);
  assert.equal(p.deckElevationM, 101.5); assert.equal(p.deckThicknessM, 0.5); assert.equal(p.clearanceM, 1);
  assert.ok(p.startDistanceM <= c.startDistanceM && p.endDistanceM >= c.endDistanceM);
  assert.ok(p.startDistanceM <= c.dryApproachBefore.distanceM && p.endDistanceM >= c.dryApproachAfter.distanceM);
  const higher = designBridgeProfile({ ...c, requiredDeckElevationM: 103 }, r, { clearanceM: 2, deckThicknessM: 0.75 });
  assert.equal(higher.deckElevationM, 103.75);
  const long = designBridgeProfile(c, r, { minBridgeLengthM: 30 });
  near(long.endDistanceM - long.startDistanceM, 30);
  assert.equal(p.sampleAt(p.startDistanceM).structureKind, 'bridge-deck');
});

test('smoothstep approach peak grades stay within the limit throughout the ramps', () => {
  const p = designBridgeProfile(crossing(), road(), { maxApproachSlope: 0.04 });
  for (const section of Object.values(p.approaches)) {
    for (let i = 0; i <= 1000; i++) {
      const station = section.startDistanceM + (section.endDistanceM - section.startDistanceM) * i / 1000;
      assert.ok(Math.abs(p.sampleAt(station).gradeSlope) <= 0.04 + 1e-10);
    }
    near(section.maxGradeSlope, 0.04);
  }
});

test('approaches have continuous heights and zero slopes at flat-ground and deck joins', () => {
  const p = designBridgeProfile(crossing(), road()), epsilon = 1e-5;
  for (const station of [p.startDistanceM, p.endDistanceM]) {
    near(p.sampleAt(station - epsilon).roadElevationM, p.sampleAt(station + epsilon).roadElevationM, 1e-8);
    near(p.sampleAt(station - epsilon).gradeSlope, 0, 1e-6);
    near(p.sampleAt(station + epsilon).gradeSlope, 0, 1e-6);
  }
  const a = p.approaches.before, b = p.approaches.after;
  near(p.sampleAt(a.startDistanceM).roadElevationM, 100); near(p.sampleAt(a.startDistanceM).gradeSlope, 0);
  near(p.sampleAt(b.endDistanceM).roadElevationM, 100); near(p.sampleAt(b.endDistanceM).gradeSlope, 0);
  assert.equal(p.sampleAt(a.startDistanceM - 1), null); assert.equal(p.sampleAt(b.endDistanceM + 1), null);
});

test('Hermite approaches match sloping road heights and derivatives at ground ties', () => {
  const r = road(), level = station => 99 + 0.01 * station;
  const p = designBridgeProfile(crossing(r), r, { roadElevationAt: level, clearanceM: 2 });
  for (const [section, station, elevation, grade] of [
    [p.approaches.before, p.approaches.before.startDistanceM, 'startElevationM', 'startGradeSlope'],
    [p.approaches.after, p.approaches.after.endDistanceM, 'endElevationM', 'endGradeSlope'],
  ]) {
    near(section[elevation], level(station)); near(section[grade], 0.01);
    assert.ok(section.maxGradeSlope <= 0.08 + 1e-10);
  }
});

test('bridge design rejects bad geometry, nonfinite options, missing dry ties and infeasible ramps', () => {
  const r = road(), c = crossing();
  for (const options of [{ clearanceM: -1 }, { maxApproachSlope: 0 }, { deckThicknessM: NaN }, { minBridgeLengthM: 1000 }]) {
    assert.throws(() => designBridgeProfile(c, r, options));
  }
  assert.throws(() => designBridgeProfile({ ...c, roadId: 'another' }, r), /roadId/);
  assert.throws(() => designBridgeProfile({ ...c, dryApproachAfter: null }, r), /dry approaches/);
  assert.throws(() => designBridgeProfile({ ...c, startDistanceM: 210 }, r), /reversed/);
  assert.throws(() => designBridgeProfile(c, { ...r, points: [r.points[0], r.points[0]] }), /segment length/);
  assert.throws(() => designBridgeProfile(c, r, { maxApproachSlope: 0.0001 }), /Insufficient road/);
  assert.throws(() => designBridgeProfile(c, r, { groundElevationAt: 'invalid' }), /function/);
});

test('a diagnosed river crossing becomes a clear deck, dry approaches and ordered metric samples', () => {
  const terrain = confluenceFixture(), r = road();
  const diagnosis = inspectRoadCrossings(terrain, { roads: [r] });
  assert.equal(diagnosis.crossings.length, 1);
  const p = designBridgeProfile(diagnosis.crossings[0], r);
  const samples = sampleRoadCenterlineProfile(terrain, r, [p], { maxStepM: 2 });
  assert.equal(samples[0].distanceM, 0); assert.equal(samples.at(-1).distanceM, 400);
  const wet = samples.filter(p => p.waterSurfaceElevationM !== null);
  assert.ok(wet.length > 0); assert.ok(samples.some(p => p.structureKind === 'approach-ramp'));
  assert.ok(samples.some(p => p.structureKind === 'at-grade'));
  for (const p of wet) { assert.equal(p.structureKind, 'bridge-deck'); assert.ok(p.clearanceM >= 1 - 1e-7); }
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].distanceM > samples[i - 1].distanceM);
    assert.ok(samples[i].distanceM - samples[i - 1].distanceM <= 2 + 1e-7);
    assert.ok(Math.abs(samples[i].gradeSlope) <= 0.08 + 1e-7);
  }
  assert.deepEqual(sampleRoadCenterlineProfile(terrain, r, [p]), samples);
  const adjusted = createRoadAdjustedTerrain(terrain, [samples]);
  for (const p of wet) assert.deepEqual(adjusted.sampleAt(p.xM, p.yM), terrain.sampleAt(p.xM, p.yM));
  const ramp = samples.find(p => p.structureKind === 'approach-ramp' && p.roadElevationM > p.groundElevationM + 0.1);
  near(adjusted.groundElevationAt(ramp.xM, ramp.yM), ramp.roadElevationM);
});

test('a lake crossing resolves estimated ties against actual varying terrain', () => {
  const terrain = connectSurfaceWater(baseTerrain((x, y) => 100 - 2 * Math.max(0, 1 - Math.hypot(x - 500, y - 500) / 150)),
    { waterBodies: [{ id: 'shallow-lake', kind: 'lake', waterLevelElevationM: 99, polygon: box(250, 250, 750, 750) }] });
  const r = road([{ xM: 50, yM: 500 }, { xM: 950, yM: 500 }]);
  const diagnosis = inspectRoadCrossings(terrain, { roads: [r] });
  const samples = sampleRoadCenterlineProfile(terrain, r, diagnosis.crossings.map(c => designBridgeProfile(c, r)), { maxStepM: 5 });
  assert.ok(samples.some(p => p.waterSurfaceElevationM === 99 && p.structureKind === 'bridge-deck'));
  for (const p of samples.filter(p => p.structureKind === 'approach-ramp')) assert.ok(Math.abs(p.gradeSlope) <= 0.08 + 1e-7);
});

test('the existing steep lake-to-ocean fixture is rejected when its road cannot fit 8 percent approaches', () => {
  const terrain = lakeOceanFixture(), r = road([{ xM: 50, yM: 500 }, { xM: 850, yM: 500 }]);
  const diagnosis = inspectRoadCrossings(terrain, { roads: [r] });
  assert.throws(() => diagnosis.crossings.map(c => designBridgeProfile(c, r)), /Insufficient road/);
});

test('centerline preserves bends and computes cut, fill and grade from explicit road heights', () => {
  const terrain = baseTerrain(() => 100), r = road([
    { xM: 100, yM: 100, roadElevationM: 99 }, { xM: 150, yM: 100, roadElevationM: 100 },
    { xM: 150, yM: 175, roadElevationM: 101.5 },
  ]);
  const samples = sampleRoadCenterlineProfile(terrain, r, [], { maxStepM: 7 });
  assert.equal(samples.at(-1).distanceM, 125);
  assert.ok(samples.some(p => p.xM === 150 && p.yM === 100 && p.distanceM === 50));
  assert.ok(samples.some(p => p.structureKind === 'cut')); assert.ok(samples.some(p => p.structureKind === 'fill'));
  for (const p of samples) near(p.gradeSlope, 0.02, 1e-6);
  assert.equal(samples[0].waterSurfaceElevationM, null); assert.equal(samples[0].clearanceM, null);
});

test('sampling rejects stale identities, overlapping approaches, invalid budgets and inconsistent ties', () => {
  const terrain = baseTerrain(() => 100), r = road(), p = designBridgeProfile(crossing(), r);
  assert.throws(() => sampleRoadCenterlineProfile(terrain, r, [{ ...p, worldId: 'stale' }]), /worldId/);
  assert.throws(() => sampleRoadCenterlineProfile(terrain, r, [{ ...p, regionId: 'foreign' }]), /regionId/);
  assert.throws(() => sampleRoadCenterlineProfile(terrain, r, [p, p]), /Overlapping/);
  for (const options of [{ maxStepM: 0 }, { maxSamples: 1 }, { maxSamples: 262145 }, { maxSamples: 10 }]) {
    assert.throws(() => sampleRoadCenterlineProfile(terrain, r, [], options));
  }
  const resolved = designBridgeProfile(crossing(), r, { groundElevationAt: () => 100 });
  assert.throws(() => sampleRoadCenterlineProfile(baseTerrain(() => 90), r, [resolved]), /tie mismatch/);
});

test('fill and cut carriageways reach their design elevations and smooth batters respect the specified slope', () => {
  const base = baseTerrain(() => 100);
  for (const [target, kind] of [[104, 'fill'], [96, 'cut']]) {
    const adjusted = createRoadAdjustedTerrain(base, [supportedProfile(target, 'work', kind)], { batterSlope: 0.5 });
    const width = 12; // 1.5 * 4m / 0.5 rise/run
    near(adjusted.groundElevationAt(500, 500), target); near(adjusted.groundElevationAt(500, 503), target);
    near(adjusted.groundElevationAt(500, 509), (100 + target) / 2);
    for (let offset = 0; offset <= width; offset += 0.05) {
      const y = 503 + offset, epsilon = 1e-4;
      const slope = (adjusted.groundElevationAt(500, y + epsilon) - adjusted.groundElevationAt(500, y - epsilon)) / (2 * epsilon);
      assert.ok(Math.abs(slope) <= 0.5 + 1e-6);
      near(adjusted.groundElevationAt(500, y), adjusted.groundElevationAt(500, 1000 - y));
    }
    for (const y of [503, 515]) {
      near(adjusted.groundElevationAt(500, y - 1e-5), adjusted.groundElevationAt(500, y + 1e-5), 1e-7);
      near((adjusted.groundElevationAt(500, y + 1e-5) - adjusted.groundElevationAt(500, y - 1e-5)) / 2e-5, 0, 1e-5);
    }
    assert.deepEqual(adjusted.sampleAt(500, 516), base.sampleAt(500, 516));
  }
});

test('sampleAt, groundElevationAt, windows, LOD and trace agree exactly and queries do not mutate sources', () => {
  const base = baseTerrain(() => 100), profile = supportedProfile(104);
  const saved = base.toSnapshot(), adjusted = createRoadAdjustedTerrain(base, [profile]);
  const area = { minXM: 400, minYM: 480, maxXM: 520, maxYM: 520 };
  const coarse = adjusted.sampleWindow({ ...area, spacingM: 4 }), fine = adjusted.sampleWindow({ ...area, spacingM: 2 });
  const byPosition = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
  for (const p of coarse.samples) {
    assert.deepEqual(p, byPosition.get(`${p.xM},${p.yM}`)); assert.deepEqual(p, adjusted.sampleAt(p.xM, p.yM));
    assert.equal(p.groundElevationM, adjusted.groundElevationAt(p.xM, p.yM));
  }
  const left = adjusted.sampleWindow({ ...area, maxXM: 480, spacingM: 2 });
  const right = adjusted.sampleWindow({ ...area, minXM: 480, spacingM: 2 });
  assert.deepEqual(left.samples.filter(p => p.xM === 480), right.samples.filter(p => p.xM === 480));
  const trace = adjusted.traceSurfaceSegment({ xM: 500, yM: 480 }, { xM: 500, yM: 520 });
  for (const { distanceM, ...p } of trace.samples) assert.deepEqual(p, adjusted.sampleAt(p.xM, p.yM));
  const expected = adjusted.sampleAt(500, 500);
  profile.samples[0].roadElevationM = 999; profile.halfWidthM = 100;
  assert.deepEqual(adjusted.sampleAt(500, 500), expected); assert.deepEqual(base.toSnapshot(), saved);
});

test('outside corridors and bridge spans retain complete source samples, including unresolved water', () => {
  const base = baseTerrain(() => 100), adjusted = createRoadAdjustedTerrain(base, [supportedProfile(104)]);
  for (const [x, y] of [[500, 520], [50, 500], [0, 0], [1000, 1000]]) {
    assert.deepEqual(adjusted.sampleAt(x, y), base.sampleAt(x, y)); assert.equal(adjusted.groundElevationAt(x, y), base.groundElevationAt(x, y));
    assert.deepEqual(adjusted.surfaceFrameAt(x, y), base.surfaceFrameAt(x, y));
  }
  assert.equal(adjusted.sampleAt(500, 500).waterDepthM, null);
  const bridge = createRoadAdjustedTerrain(base, [supportedProfile(104, 'deck', 'bridge-deck')]);
  assert.deepEqual(bridge.sampleAt(500, 500), base.sampleAt(500, 500));
  assert.deepEqual(createRoadAdjustedTerrain(base).sampleAt(500, 500), base.sampleAt(500, 500));
});

test('adjusted gradients and normals describe earthwork and known water depth is recomputed', () => {
  const input = baseTerrain(() => 100).toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(400).fill(102);
  const base = createTerrainAdapter(input), adjusted = createRoadAdjustedTerrain(base, [supportedProfile(104)]);
  const center = adjusted.sampleAt(500, 500); assert.equal(center.waterDepthM, 0); assert.equal(center.waterSurfaceElevationM, null);
  assert.equal(center.surfaceKind, 'ground'); assert.equal(center.waterLevelElevationM, 102);
  const frame = adjusted.surfaceFrameAt(500, 509);
  near(frame.gradient.y, -0.5, 0.005); near(frame.normal.z, 1 / Math.hypot(frame.gradient.y, 1));
  assert.equal(frame.curvatureStatus, 'fixed-distance-estimate'); assert.ok(Number.isFinite(frame.curvature.meanPerM));
  const cut = createRoadAdjustedTerrain(base, [supportedProfile(96, 'cut', 'cut')]);
  assert.equal(cut.sampleAt(500, 500).waterDepthM, 6); assert.equal(cut.sampleAt(500, 500).waterSurfaceElevationM, 102);
});

test('overlapping road precedence is deterministic under input reordering and carriageways precede batters', () => {
  const base = baseTerrain(() => 100), a = supportedProfile(104, 'a'), b = supportedProfile(102, 'b', 'fill', 508);
  const one = createRoadAdjustedTerrain(base, [a, b]), two = createRoadAdjustedTerrain(base, [b, a]);
  assert.equal(one.roadAdjustmentId, two.roadAdjustmentId);
  for (let y = 480; y <= 525; y++) assert.deepEqual(one.sampleAt(500, y), two.sampleAt(500, y));
  assert.equal(one.groundElevationAt(500, 508), 102);
});

test('road overlay recipes roundtrip deterministically without masquerading as canonical terrain', () => {
  const base = baseTerrain(() => 100), adjusted = createRoadAdjustedTerrain(base, [supportedProfile(104)]);
  const recipe = JSON.parse(JSON.stringify(adjusted.toSnapshot()));
  assert.equal(recipe.schema, 'minimal-world-road-adjusted-terrain@1');
  const rebuilt = createRoadAdjustedTerrain(restoreTerrain(recipe.baseTerrain), recipe.roadCenterlineProfiles, recipe.options);
  assert.equal(adjusted.roadAdjustmentId, rebuilt.roadAdjustmentId);
  assert.deepEqual(adjusted.sampleAt(500, 509), rebuilt.sampleAt(500, 509));
});

test('earthwork rejects invalid dimensions, stale profiles, nonmonotone stations and out-of-region queries', () => {
  const base = baseTerrain(() => 100), p = supportedProfile(104);
  for (const options of [{ halfWidthM: 0 }, { batterSlope: -1 }, { cutBatterSlope: NaN }, { derivativeStepM: 0 }]) assert.throws(() => createRoadAdjustedTerrain(base, [p], options));
  assert.throws(() => createRoadAdjustedTerrain(base, [{ ...p, samples: [p.samples[0]] }]), /two samples/);
  assert.throws(() => createRoadAdjustedTerrain(base, [{ ...p, samples: p.samples.toReversed() }]), /strictly increase/);
  assert.throws(() => createRoadAdjustedTerrain(base, [{ ...p, samples: p.samples.map(s => ({ ...s, worldId: 'stale' })) }]), /worldId/);
  assert.throws(() => createRoadAdjustedTerrain(base, [p, p]), /Duplicate/);
  const adjusted = createRoadAdjustedTerrain(base, [p]);
  assert.throws(() => adjusted.sampleAt(-1, 500), /outside/); assert.throws(() => adjusted.groundElevationAt(NaN, 500), /finite/);
});

test('bridge designs own immutable crossing data and reject later road geometry changes', () => {
  const r = road(), c = crossing(), p = designBridgeProfile(c, r);
  c.dryApproachBefore.groundElevationM = 999;
  assert.equal(p.sourceCrossing.dryApproachBefore.groundElevationM, 100);
  assert.throws(() => { p.approaches.before.startElevationM = 999; }, TypeError);
  const terrain = confluenceFixture(), diagnosed = inspectRoadCrossings(terrain, { roads: [r] }).crossings[0];
  assert.throws(() => designBridgeProfile(diagnosed, road([{ xM: 50, yM: 501 }, { xM: 450, yM: 501 }])), /geometry/);
});

test('sampled water changes and altered vertical ties cannot reuse an accepted bridge profile', () => {
  const base = baseTerrain(() => 100), r = road(), p = designBridgeProfile(crossing(), r, { groundElevationAt: () => 100 });
  const changedWater = { ...base, sampleAt(x, y) { return { ...base.sampleAt(x, y), waterSurfaceElevationM: 101 }; } };
  assert.throws(() => sampleRoadCenterlineProfile(changedWater, r, [p]), /water clearance/);
  const changedGrade = { ...p, approaches: { ...p.approaches, before: { ...p.approaches.before, startGradeSlope: 0.01 } } };
  assert.throws(() => sampleRoadCenterlineProfile(base, r, [changedGrade]), /grade mismatch/);
});

test('flat sample arrays, round end caps, and separate cut/fill batter settings are supported', () => {
  const base = baseTerrain(() => 100), p = supportedProfile(104), adjusted = createRoadAdjustedTerrain(base, p.samples, { fillBatterSlope: 0.25 });
  near(adjusted.groundElevationAt(100, 503), 104);
  near(adjusted.groundElevationAt(97, 500), 104);
  near(adjusted.groundElevationAt(85, 500), 102);
  assert.deepEqual(adjusted.sampleAt(72, 500), base.sampleAt(72, 500));
  const cut = createRoadAdjustedTerrain(base, [supportedProfile(96, 'cut', 'cut')], { cutBatterSlope: 1 });
  near(cut.groundElevationAt(500, 506), 98);
  assert.deepEqual(cut.sampleAt(500, 510), base.sampleAt(500, 510));
});

test('at-grade carriageways flatten cross-slope and outrank batters even where height equals source ground', () => {
  const base = baseTerrain((x, y) => 100 + 0.1 * (y - 500)), road = supportedProfile(100, 'level-road', 'at-grade');
  const adjusted = createRoadAdjustedTerrain(base, [road]);
  const center = adjusted.sampleAt(500, 500);
  near(center.groundElevationM, base.sampleAt(500, 500).groundElevationM);
  near(center.gradient.y, 0); near(base.sampleAt(500, 500).gradient.y, 0.1);
  near(adjusted.groundElevationAt(500, 502), 100); near(adjusted.groundElevationAt(500, 498), 100);
  const flat = baseTerrain(() => 100), overlapping = createRoadAdjustedTerrain(flat,
    [supportedProfile(100, 'at-grade', 'at-grade'), supportedProfile(104, 'raised-road', 'fill', 508)]);
  assert.equal(overlapping.groundElevationAt(500, 500), 100);
});

test('local road envelopes converge on supported spans without filling beneath decks',()=>{
 const terrain=baseTerrain(()=>100),profile=supportedProfile(105),r=createRoadAdjustedTerrain(terrain,[profile]);
 const far=r.boundGroundElevation([100,100],{xM:500,yM:900,radiusM:1});assert.ok(far[1]-far[0]<1e-4);
 const inside=r.boundGroundElevation([100,100],{xM:500,yM:500,radiusM:1});assert.ok(inside[0]>104.999&&inside[1]<105.001);
 const deck=createRoadAdjustedTerrain(terrain,[supportedProfile(105,'deck','bridge-deck')]);assert.ok(deck.boundGroundElevation([100,100],{xM:500,yM:500,radiusM:1})[1]<100.001);
 profile.samples[0].gradeSlope=.04;profile.samples[1].gradeSlope=-.04;
 const curved=createRoadAdjustedTerrain(terrain,[profile]);
 for(const radiusM of [0,1,10,100])for(const yM of [498,500,520]){
   const disk={xM:500,yM,radiusM},range=curved.boundGroundElevation([100,100],disk);
   for(let i=0;i<32;i++){const angle=i*Math.PI/16,z=curved.groundElevationAt(500+radiusM*Math.cos(angle),yM+radiusM*Math.sin(angle));assert.ok(z>=range[0]&&z<=range[1],`${z} outside ${range}`);}
 }
 assert.throws(()=>r.boundGroundElevation([100,100],{xM:0,yM:0,radiusM:-1}),/nonnegative/);
});

test('local road envelopes cover competing bends, joints, crown, batters and bridge endpoints',()=>{
 const base=baseTerrain(()=>100),profile={roadId:'bend',halfWidthM:4,crossSection:{schema:'road-cross-section@1',crownSlope:.02,crossSlope:.01,transitionLengthM:8,flatIntervals:[{startM:390,endM:410}]},samples:[
  {xM:100,yM:500,distanceM:0,roadElevationM:104,structureKind:'at-grade',gradeSlope:.01},
  {xM:500,yM:500,distanceM:400,roadElevationM:106,structureKind:'at-grade',gradeSlope:0},
  {xM:500,yM:800,distanceM:700,roadElevationM:102,structureKind:'at-grade',gradeSlope:-.01}]},
  bridge=supportedProfile(108,'bridge','bridge-deck',505),a=createRoadAdjustedTerrain(base,[profile,bridge,supportedProfile(99,'cut','cut',485)]);
 for(let k=0;k<150;k++){
  const xM=450+(k*17%101),yM=470+(k*29%71),radiusM=[0,.1,1,4,15][k%5],range=a.boundGroundElevation([100,100],{xM,yM,radiusM});
  for(let i=0;i<24;i++){const angle=i*Math.PI/12,z=a.groundElevationAt(xM+radiusM*Math.cos(angle),yM+radiusM*Math.sin(angle));assert.ok(z>=range[0]&&z<=range[1],`${xM},${yM},${radiusM}: ${z} not ${range}`);}
 }
 const joint=a.boundGroundElevation([100,100],{xM:500,yM:500,radiusM:.01});assert.ok(joint[0]>105.999&&joint[1]<106.001,`${joint}`);
});

test('nearest-road index preserves brute-force order at crossings and equal bridge ties',async()=>{
 const {metricRoads}=await import('../src/core/road-geometry.mjs');
 for(const retraced of[false,true]){
  let station=0;const samples=[];
  for(let i=0;i<64;i++){
   const p={xM:retraced?(i%2?900:100):100+i*12,yM:retraced?500:500+80*Math.sin(i*.71),roadElevationM:105+i*.25,gradeSlope:0,
    structureKind:i%3===0?'bridge-deck':'fill',segmentKind:i%3===0?'bridge-deck':'fill'};
   if(i)station+=Math.hypot(p.xM-samples.at(-1).xM,p.yM-samples.at(-1).yM);p.distanceM=station;samples.push(p);
  }
  const input={roadId:'indexed',halfWidthM:1000,samples},actual=createRoadAdjustedTerrain(baseTerrain(()=>100),[input]),ref=metricRoads([input])[0];
  const oracle=(xM,yM)=>{
   let best;
   for(const {a,b,curve}of ref.segments){const dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy),t=Math.max(0,Math.min(1,((xM-a.xM)*(dx/length)+(yM-a.yM)*(dy/length))/length)),
    x=t===0?a.xM:t===1?b.xM:a.xM*(1-t)+b.xM*t,y=t===0?a.yM:t===1?b.yM:a.yM*(1-t)+b.yM*t,distance=Math.hypot(xM-x,yM-y),
    kind=t===0?a.structureKind:t===1?b.structureKind:a.segmentKind??(a.structureKind==='bridge-deck'&&b.structureKind==='bridge-deck'?'bridge-deck':'at-grade');
    if(!best||distance<best.distance||distance===best.distance&&kind==='bridge-deck'){
     const station=t===0?a.distanceM:t===1?b.distanceM:a.distanceM*(1-t)+b.distanceM*t;
     best={distance,kind,elevation:curve.at(station).roadElevationM};
    }
   }return best;
  };
  const probes=[...samples.map(p=>[p.xM,p.yM]),...samples.flatMap(p=>[[p.xM+1e-8,p.yM],[p.xM-1e-8,p.yM]]),...Array.from({length:500},(_,i)=>[100+800*((i*7919%1000)/1000),400+200*((i*3571%1000)/1000)]),[500,500]];
  for(const [x,y]of probes){const expected=oracle(x,y),surface=actual.roadSurfaceAt(x,y);assert.equal(surface.structureKind,expected.kind);assert.equal(surface.roadElevationM,expected.elevation);}
 }
});
