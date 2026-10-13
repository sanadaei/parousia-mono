import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { designRoadJunctions, inspectRoadGradeSeparations, createJunctionAdjustedTerrain,
  restoreJunctionAdjustedTerrain } from '../road-junctions.mjs';
import { inspectEarthworkDrainage } from '../earthwork-drainage.mjs';
import { baseTerrain, box } from '../fixtures/water-scenarios.mjs';
import { restoreTerrain } from '../index.mjs';

const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const road = (id, z, points, extra = {}) => ({ id, halfWidthM: 3, ...extra,
  points: points.map(([xM, yM]) => ({ xM, yM, roadElevationM: typeof z === 'function' ? z(xM, yM) : z })) });
const crossRoads = (a = 101, b = 103) => [road('east', a, [[100, 500], [900, 500]]), road('north', b, [[500, 100], [500, 900]])];
// Independent Hermite evaluation of the public numerical profile.
function profileAt(road, distanceM) {
  const points = road.points, i = Math.max(1, points.findIndex(p => p.distanceM >= distanceM));
  const a = points[i - 1], b = points[i], l = b.distanceM - a.distanceM, t = (distanceM - a.distanceM) / l;
  const z = (2 * t ** 3 - 3 * t ** 2 + 1) * a.roadElevationM + (t ** 3 - 2 * t ** 2 + t) * l * a.gradeSlope
    + (-2 * t ** 3 + 3 * t ** 2) * b.roadElevationM + (t ** 3 - t ** 2) * l * b.gradeSlope;
  const grade = (6 * t ** 2 - 6 * t) * a.roadElevationM / l + (3 * t ** 2 - 4 * t + 1) * a.gradeSlope
    + (-6 * t ** 2 + 6 * t) * b.roadElevationM / l + (3 * t ** 2 - 2 * t) * b.gradeSlope;
  return { z, grade };
}

test('at-grade crossings unify the exact carriageway level with flat common plateaus', () => {
  const result = designRoadJunctions(crossRoads());
  assert.equal(result.junctions.length, 1); assert.equal(result.junctions[0].roadElevationM, 102);
  for (const r of result.roads) {
    const p = r.points.find(p => p.xM === 500 && p.yM === 500);
    assert.equal(p.roadElevationM, 102); assert.equal(p.gradeSlope, 0);
    for (const distanceM of [397, 399, 400, 401, 403]) near(profileAt(r, distanceM).z, 102);
    assert.equal(r.points[0].roadElevationM, r.id === 'east' ? 101 : 103);
    assert.equal(r.points.at(-1).roadElevationM, r.id === 'east' ? 101 : 103);
  }
  assert.equal(inspectRoadGradeSeparations(result.roads).crossings[0].status, 'at-grade-matched');
});

test('approach elevations and first derivatives remain continuous and meet strict peak grade limits', () => {
  const result = designRoadJunctions(crossRoads(100, 104), { maxSlope: 0.03 });
  for (const r of result.roads) {
    for (let s = 0; s <= 800; s += 0.125) assert.ok(Math.abs(profileAt(r, s).grade) <= 0.03 + 1e-9);
    for (const p of r.points.slice(1, -1)) {
      const left = profileAt(r, p.distanceM - 1e-6), right = profileAt(r, p.distanceM + 1e-6);
      near(left.z, right.z, 1e-7); near(left.grade, right.grade, 1e-7);
    }
  }
});

test('sloping baseline ties retain their incoming and outgoing grades', () => {
  const result = designRoadJunctions(crossRoads(x => 100 + 0.01 * (x - 500), 102), { maxSlope: 0.04 });
  const r = result.roads.find(r => r.id === 'east');
  near(r.points[0].gradeSlope, 0.01); near(r.points.at(-1).gradeSlope, 0.01);
  for (let s = 0; s <= 800; s += 0.5) assert.ok(Math.abs(profileAt(r, s).grade) <= 0.04 + 1e-9);
});

test('common endpoints, T junctions and repeated segment witnesses produce one junction', () => {
  const roads = [road('west', 100, [[100, 500], [500, 500]]), road('east', 102, [[500, 500], [900, 500]]),
    road('north', 101, [[500, 100], [500, 500], [500, 900]])];
  const result = designRoadJunctions(roads);
  assert.equal(result.junctions.length, 1); assert.equal(result.junctions[0].members.length, 3);
  for (const r of result.roads) assert.equal(r.points.find(p => p.xM === 500 && p.yM === 500).roadElevationM, 101);
  assert.equal(inspectRoadGradeSeparations(result.roads).crossings.length, 3);
});

test('nearby junctions connect through one joint vertical alignment where independent ramps cannot fit', () => {
  const roads = [road('main', 100, [[100, 500], [900, 500]]), road('a', 104, [[450, 100], [450, 900]]),
    road('b', 106, [[500, 100], [500, 900]])];
  const result = designRoadJunctions(roads, { maxSlope: 0.04 });
  assert.equal(result.junctions.length, 2);
  const main = result.roads.find(r => r.id === 'main');
  near(profileAt(main, 350).z, 102); near(profileAt(main, 400).z, 103);
  for (let s = 350; s <= 400; s += 0.25) assert.ok(Math.abs(profileAt(main, s).grade) <= 0.04 + 1e-8);
});

test('designs remain deterministic across caller road order and isolate owned input', () => {
  const roads = crossRoads(); roads[0].points[0].references = { ids: ['original'] };
  const first = designRoadJunctions(roads);
  assert.deepEqual(first, designRoadJunctions([...roads].reverse()));
  roads[0].points[0].roadElevationM = 900;
  roads[0].points[0].references.ids.push('later');
  assert.equal(first.roads[0].points[0].roadElevationM, 101);
  assert.deepEqual(first.roads[0].points[0].references.ids, ['original']);
  assert.ok(Object.isFrozen(first.junctions[0])); assert.ok(Object.isFrozen(first.roads[0].points));
});

test('explicit junction elevation and narrower road grade limits are enforced', () => {
  const roads = crossRoads(); roads[0].maxSlope = 0.02;
  const result = designRoadJunctions(roads, { junctionElevationM: 104, maxSlope: 0.08 });
  assert.equal(result.junctions[0].roadElevationM, 104);
  for (let s = 0; s <= 800; s += 0.5) assert.ok(Math.abs(profileAt(result.roads[0], s).grade) <= 0.02 + 1e-9);
});

test('impossible approaches and incompatible overlapping plateaus reject rather than exceed grades', () => {
  assert.throws(() => designRoadJunctions([road('a', 0, [[490, 500], [510, 500]]),
    road('b', 10, [[500, 490], [500, 510]])]), /slope limit|Insufficient/);
  assert.throws(() => designRoadJunctions([road('main', 100, [[100, 500], [900, 500]]),
    road('a', 104, [[499, 100], [499, 900]]), road('b', 106, [[501, 100], [501, 900]])]), /Overlapping/);
});

test('acute crossings reserve enough flat approach for overlapping carriageway widths', () => {
  const roads = [road('a', 100, [[100, 500], [900, 500]]), road('b', 102, [[100, 450], [900, 550]])];
  const result = designRoadJunctions(roads);
  assert.ok(result.junctions[0].plateauRadiusM > 20);
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 99), result);
  for (const x of [480, 490, 500, 510, 520]) near(overlay.groundElevationAt(x, 500), 101);
  near(overlay.groundElevationAt(546, 503), 101);
});

test('bridge crossings preserve their grades and meet vehicle clearance at the underside', () => {
  const roads = crossRoads(100, 105); roads[1].structureKind = 'bridge-deck'; roads[1].deckThicknessM = 0.5;
  assert.equal(designRoadJunctions(roads).junctions.length, 0);
  const result = inspectRoadGradeSeparations(roads);
  assert.equal(result.roadCount, 2); assert.equal(result.crossings[0].status, 'grade-separated-clearance-met');
  assert.equal(result.crossings[0].verticalClearanceM, 4.5); assert.equal(result.crossings[0].upperRoadId, 'north');
});

test('positive but inadequate underside clearance is insufficient; touching/intersecting decks collide', () => {
  for (const [height, expected] of [[104.9, 'insufficient-vertical-clearance'], [100.5, 'collision'], [100.1, 'collision'], [100, 'collision']]) {
    const roads = crossRoads(100, height); roads[1].structureKind = 'bridge-deck'; roads[1].deckThicknessM = 0.5;
    assert.equal(inspectRoadGradeSeparations(roads).crossings[0].status, expected);
  }
});

test('clearance settings and profile-local deck thickness override defaults', () => {
  const roads = crossRoads(100, 106); roads[1].structureKind = 'bridge-deck';
  roads[1].points.forEach(p => { p.deckThicknessM = 2; });
  assert.equal(inspectRoadGradeSeparations(roads).crossings[0].verticalClearanceM, 4);
  assert.equal(inspectRoadGradeSeparations(roads, { requiredVehicleClearanceM: 3.5 }).crossings[0].status, 'grade-separated-clearance-met');
  assert.equal(inspectRoadGradeSeparations(roads, { deckThicknessM: 1 }).crossings[0].verticalClearanceM, 5);
});

test('crossing elevation is evaluated on cubic profiles, including interior crossings', () => {
  const roads = crossRoads(100, 106);
  roads[1].structureKind = 'bridge-deck'; roads[1].points[0].gradeSlope = 0.02; roads[1].points[1].gradeSlope = -0.02;
  const result = inspectRoadGradeSeparations(roads).crossings[0];
  near(result.stations.find(p => p.roadId === 'north').roadElevationM, 110);
  near(result.verticalClearanceM, 9.5);
});

test('continuous joint platform and batters have no jump across former winner boundaries', () => {
  const result = designRoadJunctions(crossRoads(102, 104));
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 100), result);
  assert.equal(overlay.groundElevationAt(500, 500), 103);
  for (const offset of [2, 3, 4, 5, 6, 7, 8, 10, 12, 15]) {
    const a = overlay.groundElevationAt(500 + offset - 1e-5, 500 + offset);
    const b = overlay.groundElevationAt(500 + offset + 1e-5, 500 + offset);
    near(a, b, 1e-4);
  }
  assert.equal(overlay.groundElevationAt(200, 200), 100);
  const frame = overlay.surfaceFrameAt(500, 500); near(frame.normal.z, 1);
});

test('cut platforms blend continuously into natural terrain', () => {
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 110), designRoadJunctions(crossRoads(105, 107)));
  assert.equal(overlay.groundElevationAt(500, 500), 106);
  for (let d = 4; d <= 15; d += 0.5) {
    const z = overlay.groundElevationAt(500 + d, 500 + d); assert.ok(z >= 106 && z <= 110);
  }
});

test('equal-height ground contact still recomputes the platform gradient and preserves outside frames', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.01 * y);
  const overlay = createJunctionAdjustedTerrain(terrain, designRoadJunctions(crossRoads(95, 95)));
  assert.equal(overlay.groundElevationAt(500, 500), terrain.groundElevationAt(500, 500));
  const sample = overlay.sampleAt(500, 500); near(sample.gradient.x, 0); near(sample.gradient.y, 0);
  assert.equal(sample.junctionAdjustmentId, overlay.junctionAdjustmentId);
  assert.deepEqual(overlay.surfaceFrameAt(200, 200), terrain.surfaceFrameAt(200, 200));
});

test('grade-separated bridge creates no embankment under its deck', () => {
  const roads = crossRoads(100, 106); roads[1].structureKind = 'bridge-deck';
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 100), designRoadJunctions(roads));
  assert.equal(overlay.groundElevationAt(500, 500), 100);
  assert.equal(overlay.groundElevationAt(500, 600), 100);
});

test('LOD, adjacent windows and traces use the identical joint sampler', () => {
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 100), designRoadJunctions(crossRoads()));
  const bounds = { minXM: 480, minYM: 480, maxXM: 520, maxYM: 520 };
  const fine = overlay.sampleWindow({ ...bounds, spacingM: 2 }), coarse = overlay.sampleWindow({ ...bounds, spacingM: 10 });
  for (const p of coarse.samples) assert.deepEqual(p, fine.samples.find(q => q.xM === p.xM && q.yM === p.yM));
  const a = overlay.sampleWindow({ ...bounds, maxXM: 500, spacingM: 2 }), b = overlay.sampleWindow({ ...bounds, minXM: 500, spacingM: 2 });
  assert.deepEqual(a.samples.filter(p => p.xM === 500), b.samples.filter(p => p.xM === 500));
  for (const { distanceM, ...p } of overlay.traceSurfaceSegment({ xM: 480, yM: 480 }, { xM: 520, yM: 520 }).samples) assert.deepEqual(p, overlay.sampleAt(p.xM, p.yM));
});

test('joint recipe restores exactly and rejects corrupted identity, grade and membership', () => {
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 100), designRoadJunctions(crossRoads()));
  const json = JSON.stringify(overlay.toSnapshot()), restored = restoreJunctionAdjustedTerrain(json, restoreTerrain);
  assert.equal(overlay.junctionAdjustmentId, restored.junctionAdjustmentId);
  for (const [x, y] of [[500, 500], [504, 506], [515, 515], [600, 500]]) assert.deepEqual(overlay.sampleAt(x, y), restored.sampleAt(x, y));
  const corrupted = JSON.parse(json); corrupted.junctions[0].roadElevationM += 1;
  assert.throws(() => restoreJunctionAdjustedTerrain(corrupted), /plateau/);
  const foreign = JSON.parse(json); foreign.junctionAdjustmentId = 'other';
  assert.throws(() => restoreJunctionAdjustedTerrain(foreign), /identity/);
  const unknown = JSON.parse(json); unknown.junctions[0].members[0].roadId = 'unknown';
  unknown.junctions[0].roadIds[0] = 'unknown';
  assert.throws(() => restoreJunctionAdjustedTerrain(unknown), /Unknown/);
  const duplicate = JSON.parse(json); duplicate.junctions[0].roadIds[1] = duplicate.junctions[0].roadIds[0];
  assert.throws(() => restoreJunctionAdjustedTerrain(duplicate), /membership/);
});

test('saved numerical design and terrain recipe reproduce in a fresh Node process', () => {
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 100), designRoadJunctions(crossRoads()));
  const script = `import {restoreJunctionAdjustedTerrain} from './road-junctions.mjs';
    let data=''; for await (const chunk of process.stdin) data+=chunk;
    const t=restoreJunctionAdjustedTerrain(data); console.log(JSON.stringify(t.sampleAt(504,506)));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('..', import.meta.url),
    input: JSON.stringify(overlay.toSnapshot()), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), overlay.sampleAt(504, 506));
});

test('road fill dams cross-slope drainage and places gravity culverts with natural invert levels', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.01 * y);
  const result = inspectEarthworkDrainage(terrain, { roads: [road('fill', 97, [[100, 500], [900, 500]])] });
  assert.equal(result.culverts.length, 8); assert.equal(result.blockedFlowCount, 80); near(result.totalEmbankmentLengthM, 800);
  for (const c of result.culverts) {
    assert.equal(c.roadId, 'fill'); assert.ok(c.distanceM > 0 && c.distanceM < 800);
    assert.equal(c.upstreamInvertElevationM, terrain.groundElevationAt(c.upstream.xM, c.upstream.yM));
    assert.equal(c.downstreamInvertElevationM, terrain.groundElevationAt(c.downstream.xM, c.downstream.yM));
    near(c.slopeMPerM, 0.01); assert.equal(c.drainageContinuity, true); assert.ok(c.pondingDepthM > 0.5);
  }
});

test('flow direction follows reversed natural crossfall and culvert interval options', () => {
  const terrain = baseTerrain((x, y) => 100 + 0.01 * y);
  const result = inspectEarthworkDrainage(terrain, { roads: [road('fill', 107, [[100, 500], [900, 500]])], culvertSpacingM: 200 });
  assert.equal(result.culverts.length, 4);
  for (const c of result.culverts) { assert.ok(c.upstream.yM > c.downstream.yM); near(c.slopeMPerM, 0.01); }
});

test('bridge decks, cuts, flat natural ground and flow parallel to roads need no cross culverts', () => {
  const slope = baseTerrain((x, y) => 100 - 0.01 * y);
  const options = [
    [slope, road('bridge', 110, [[100, 500], [900, 500]], { structureKind: 'bridge-deck' })],
    [slope, road('cut', 90, [[100, 500], [900, 500]])],
    [baseTerrain(() => 100), road('flat', 103, [[100, 500], [900, 500]])],
    [baseTerrain((x, y) => 100 - 0.01 * x), road('parallel', (x) => 102 - 0.01 * x, [[100, 500], [900, 500]])],
  ];
  for (const [terrain, r] of options) assert.equal(inspectEarthworkDrainage(terrain, { roads: [r] }).culverts.length, 0);
});

test('ponding tolerance filters minor barriers and natural ridges cannot be labelled continuous drainage', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.01 * y), roads = [road('fill', 97, [[100, 500], [900, 500]])];
  assert.equal(inspectEarthworkDrainage(terrain, { roads, maxPondingDepthM: 3 }).culverts.length, 0);
  const ridge = { ...terrain, groundElevationAt(x, y) { return 100 - 0.01 * y + (y > 490 && y < 495 ? 4 : 0); } };
  assert.equal(inspectEarthworkDrainage(ridge, { roads }).culverts.length, 0);
});

test('building pad fills receive pass-throughs across the natural downhill path', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.01 * y);
  const pad = { id: 'pad', polygon: box(400, 400, 600, 600), targetPadElevationM: 100 };
  const result = inspectEarthworkDrainage(terrain, { pads: [pad], culvertSpacingM: 100 });
  assert.ok(result.culverts.length >= 1); assert.equal(result.totalEmbankmentLengthM, 0);
  for (const c of result.culverts) { assert.equal(c.buildingId, 'pad'); assert.equal(c.sourceKind, 'building-pad-fill');
    assert.ok(c.upstream.yM < 400 && c.downstream.yM > 600); near(c.slopeMPerM, 0.01); }
  assert.equal(inspectEarthworkDrainage(terrain, { pads: [{ ...pad, targetPadElevationM: 90 }] }).culverts.length, 0);
});

test('out-of-region drainage toes remain explicitly unresolved', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.01 * y);
  const result = inspectEarthworkDrainage(terrain, { roads: [road('edge', 105, [[100, 2], [900, 2]])] });
  assert.equal(result.culverts.length, 0); assert.ok(result.unresolvedFlowCount > 0);
});

test('downstream culvert mouths extend beyond fill batters on appreciable crossfall', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.1 * y);
  const result = inspectEarthworkDrainage(terrain, { roads: [road('fill', 52, [[100, 500], [900, 500]])] });
  assert.ok(result.culverts.length > 0);
  for (const c of result.culverts) {
    for (const mouth of [c.upstream, c.downstream]) {
      const distanceOutside = Math.abs(mouth.yM - 500) - 3;
      const fillBatterWidth = 1.5 * Math.max(0, 52 - mouth.invertElevationM) / 0.5;
      assert.ok(distanceOutside >= fillBatterWidth);
    }
    near(c.slopeMPerM, 0.1);
  }
});

test('full carriageways retain their exact profile elevation beside overlapping batters', () => {
  const design = designRoadJunctions(crossRoads(102, 104)), main = design.roads.find(r => r.id === 'east');
  const overlay = createJunctionAdjustedTerrain(baseTerrain(() => 100), design);
  for (const station of [360, 390, 394, 396, 397, 400, 403, 407, 410, 440]) {
    near(overlay.groundElevationAt(100 + station, 500), profileAt(main, station).z, 1e-12);
  }
});

test('bridge boundary metadata uses deck thickness at that endpoint and excludes subsequent deck fills', () => {
  const roads = [road('lower', 100, [[100, 500], [900, 500]]), { id: 'upper', points: [
    { xM: 500, yM: 100, roadElevationM: 100, structureKind: 'at-grade', segmentKind: 'approach-ramp', gradeSlope: 0 },
    { xM: 500, yM: 500, roadElevationM: 106, structureKind: 'bridge-deck', segmentKind: 'bridge-deck', deckThicknessM: 1.5, gradeSlope: 0 },
    { xM: 500, yM: 900, roadElevationM: 106, structureKind: 'bridge-deck', deckThicknessM: 1.5, gradeSlope: 0 },
  ] }];
  const inspection = inspectRoadGradeSeparations(roads).crossings[0];
  assert.equal(inspection.deckThicknessM, 1.5); assert.equal(inspection.verticalClearanceM, 4.5);
  const design = designRoadJunctions(roads); assert.equal(design.junctions.length, 0);
  assert.equal(createJunctionAdjustedTerrain(baseTerrain(() => 100), design).groundElevationAt(500, 600), 100);
});

test('sampled road profile records are accepted and ambiguous station or structure contracts reject', () => {
  const design = designRoadJunctions(crossRoads());
  const profiles = design.roads.map(({ roadId, halfWidthM, samples }) => ({ roadId, halfWidthM, samples }));
  assert.equal(inspectRoadGradeSeparations(profiles).crossings[0].status, 'at-grade-matched');
  const bad = structuredClone(profiles); bad[0].samples[1].distanceM += 2;
  assert.throws(() => inspectRoadGradeSeparations(bad), /stations/);
  assert.throws(() => inspectRoadGradeSeparations([{ ...crossRoads()[0], structureKind: 'unknown' }]), /structureKind/);
});

test('drainage is invariant under terrain display/query history, road order and JSON restoration', () => {
  const terrain = baseTerrain((x, y) => 100 - 0.01 * y);
  const roads = [road('a', 97, [[100, 500], [900, 500]]), road('b', 99, [[100, 300], [900, 300]])];
  const first = inspectEarthworkDrainage(terrain, { roads });
  terrain.sampleWindow({ minXM: 100, minYM: 100, maxXM: 900, maxYM: 900, spacingM: 50 });
  assert.deepEqual(first, inspectEarthworkDrainage(terrain, { roads: [...roads].reverse() }));
  assert.deepEqual(first, inspectEarthworkDrainage(restoreTerrain(JSON.stringify(terrain.toSnapshot())), { roads: JSON.parse(JSON.stringify(roads)) }));
  assert.deepEqual(first, JSON.parse(JSON.stringify(first)));
});

test('junction and drainage contracts reject nonfinite values, duplicate IDs and invalid geometry', () => {
  const terrain = baseTerrain(), roads = crossRoads();
  for (const options of [{ maxSlope: 0 }, { maxSlope: NaN }, { junctionElevationM: '102' }, { plateauRadiusM: -1 }]) assert.throws(() => designRoadJunctions(roads, options));
  assert.throws(() => designRoadJunctions([roads[0], roads[0]]), /Duplicate/);
  assert.throws(() => designRoadJunctions([road('invalid', NaN, [[100, 100], [200, 200]])]), TypeError);
  assert.throws(() => designRoadJunctions([road('invalid', 100, [[100, 100], [100, 100]])]), RangeError);
  assert.throws(() => designRoadJunctions([road('a', 100, [[100, 100], [500, 100]]), road('b', 100, [[200, 100], [600, 100]])]), /overlapping/);
  assert.throws(() => inspectRoadGradeSeparations(roads, { requiredVehicleClearanceM: -1 }));
  assert.throws(() => inspectRoadGradeSeparations(roads, { deckThicknessM: NaN }));
  assert.throws(() => inspectEarthworkDrainage(terrain, { roads, culvertSpacingM: 0 }));
  assert.throws(() => inspectEarthworkDrainage(terrain, { roads, maxPondingDepthM: NaN }));
  assert.throws(() => inspectEarthworkDrainage(terrain, { roads: [{ ...roads[0], worldId: 'foreign' }] }), /worldId/);
  assert.throws(() => inspectEarthworkDrainage(terrain, { pads: [{ id: 'p', polygon: box(400, 400, 600, 600), targetPadElevationM: Infinity }] }));
  assert.throws(() => restoreJunctionAdjustedTerrain({ schema: 'unknown' }), /schema/);
  assert.throws(() => createJunctionAdjustedTerrain(terrain, { roads, batterSlopeMPerM: 0 }));
});

test('empty collections are accepted and all requested entrypoints export the numerical APIs', async () => {
  assert.deepEqual(designRoadJunctions([]), { junctions: [], roads: [] });
  assert.deepEqual(inspectRoadGradeSeparations([]), { crossings: [], roadCount: 0 });
  assert.equal(inspectEarthworkDrainage(baseTerrain()).blockedFlowCount, 0);
  for (const path of ['../index.mjs', '../src/core/index.mjs']) {
    const entry = await import(path); assert.equal(entry.designRoadJunctions, designRoadJunctions);
    assert.equal(entry.inspectEarthworkDrainage, inspectEarthworkDrainage);
  }
});
