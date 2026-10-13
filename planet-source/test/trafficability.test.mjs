import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAFFICABILITY_CLASSES, evaluateTrafficabilityAt, createTrafficabilitySampler } from '../trafficability.mjs';
import * as core from '../src/core/trafficability.mjs';
import * as packaged from 'minimal-world-continuous-terrain-adapter/trafficability';
import { createTerrainAdapter } from '../index.mjs';
import { createRoadAdjustedTerrain } from '../road-earthwork.mjs';
import { createBuildingPadAdjustedTerrain } from '../building-pad.mjs';
import { baseTerrain } from '../fixtures/water-scenarios.mjs';

function analytic({ slope = 0, roughness = 0, depth = 0, ...fields } = {}) {
  return { worldId: 'analytic-world',
    sampleAt(xM, yM) { return { xM, yM, worldId: this.worldId, groundElevationM: slope * xM,
      slopeMPerM: slope, gradient: { x: slope, y: 0 }, roughness, waterDepthM: depth,
      surfaceKind: 'ground', ...fields }; } };
}
function waterTerrain(level = 102, height = () => 100) {
  const input = baseTerrain(height).toSnapshot(); delete input.worldId;
  input.fields.waterLevelElevationM = Array(400).fill(level);
  input.fields.waterLevelRole = 'surface';
  return createTerrainAdapter(input);
}
function roadProfile(elevation = 104, structureKind = 'fill', roadId = 'road') {
  return { roadId, halfWidthM: 3, samples: [100, 900].map((xM, i) => ({ xM, yM: 500,
    distanceM: i * 800, roadElevationM: elevation, gradeSlope: 0, structureKind })) };
}
const pad = (targetPadElevationM = 104) => ({ id: 'house', targetPadElevationM,
  bounds: { minXM: 490, minYM: 490, maxXM: 510, maxYM: 510 } });

test('root and package exports use the core implementation and class lists are immutable', () => {
  assert.equal(evaluateTrafficabilityAt, core.evaluateTrafficabilityAt);
  assert.equal(createTrafficabilitySampler, core.createTrafficabilitySampler);
  assert.equal(packaged.evaluateTrafficabilityAt, core.evaluateTrafficabilityAt);
  assert.equal(TRAFFICABILITY_CLASSES, core.TRAFFICABILITY_CLASSES);
  assert.equal(TRAFFICABILITY_CLASSES.pedestrian.length, 5);
  assert.equal(TRAFFICABILITY_CLASSES.vehicle.length, 5);
  assert.throws(() => TRAFFICABILITY_CLASSES.pedestrian.push('other'), TypeError);
});

test('pedestrian slope thresholds are inclusive and steep cliffs block with Infinity', () => {
  for (const [slope, expected, passable] of [[0, 'walkable', true], [0.5, 'walkable', true],
    [0.50001, 'difficult-scramble', true], [1, 'difficult-scramble', true], [1.00001, 'impassable-cliff', false]]) {
    const p = evaluateTrafficabilityAt(analytic({ slope }), 7, -3);
    assert.equal(p.pedestrianClass, expected); assert.equal(p.isPassable, passable);
    assert.equal(p.xM, 7); assert.equal(p.yM, -3); assert.equal(p.worldId, 'analytic-world');
    assert.equal(p.slopeMPerM, slope);
    assert.equal(Number.isFinite(p.costFactor), passable);
    if (!passable) assert.equal(p.costFactor, Infinity);
  }
});

test('vehicle slope thresholds and selected movement mode are independent of pedestrian class', () => {
  for (const [slope, expected] of [[0, 'offroad-passable'], [0.3, 'offroad-passable'], [0.30001, 'steep-infeasible']]) {
    const terrain = analytic({ slope });
    const p = evaluateTrafficabilityAt(terrain, 0, 0, { movementMode: 'vehicle' });
    assert.equal(p.vehicleClass, expected); assert.equal(p.pedestrianClass, 'walkable');
    assert.equal(p.isPassable, slope <= 0.3);
    assert.equal(evaluateTrafficabilityAt(terrain, 0, 0).isPassable, true);
  }
});

test('surfaceFrameAt supplies the authoritative slope, with gradient fallback for lightweight adapters', () => {
  const terrain = analytic();
  terrain.surfaceFrameAt = () => ({ slopeMPerM: 2 });
  assert.equal(evaluateTrafficabilityAt(terrain, 0, 0).pedestrianClass, 'impassable-cliff');
  const gradientOnly = analytic({ slopeMPerM: undefined, gradient: { x: 0.3, y: 0.4 } });
  assert.equal(evaluateTrafficabilityAt(gradientOnly, 0, 0).slopeMPerM, 0.5);
});

test('wading limits accept the exact limit and reject deeper water for each mode', () => {
  for (const depth of [0, 0.3, 0.300001, 0.4, 0.400001, 10]) {
    const terrain = analytic({ depth });
    const p = evaluateTrafficabilityAt(terrain, 0, 0);
    const v = evaluateTrafficabilityAt(terrain, 0, 0, { movementMode: 'vehicle' });
    assert.equal(p.pedestrianClass, depth === 0 ? 'walkable' : depth <= 0.3 ? 'wading-shallow' : 'drowning-deep');
    assert.equal(p.isPassable, depth <= 0.3); assert.equal(v.isPassable, depth <= 0.4);
    assert.equal(v.vehicleClass, depth <= 0.4 ? 'offroad-passable' : 'flooded');
    assert.equal(Number.isFinite(p.costFactor), p.isPassable);
    assert.equal(Number.isFinite(v.costFactor), v.isPassable);
  }
  const cliff = evaluateTrafficabilityAt(analytic({ slope: 2, depth: 0.1 }), 0, 0);
  assert.equal(cliff.pedestrianClass, 'impassable-cliff'); assert.equal(cliff.isPassable, false);
});

test('configurable thresholds and maxWadingDepthM affect only the selected mode', () => {
  const p = evaluateTrafficabilityAt(analytic({ depth: 0.35 }), 0, 0, { maxWadingDepthM: 0.35 });
  assert.equal(p.pedestrianClass, 'wading-shallow'); assert.equal(p.vehicleClass, 'offroad-passable');
  const v = evaluateTrafficabilityAt(analytic({ depth: 0.35 }), 0, 0,
    { movementMode: 'vehicle', maxWadingDepthM: 0.2 });
  assert.equal(v.vehicleClass, 'flooded'); assert.equal(v.pedestrianClass, 'drowning-deep');
  const steep = evaluateTrafficabilityAt(analytic({ slope: 0.7 }), 0, 0,
    { maxWalkableSlopeMPerM: 0.2, maxScrambleSlopeMPerM: 0.6, maxVehicleSlopeMPerM: 0.8 });
  assert.equal(steep.pedestrianClass, 'impassable-cliff'); assert.equal(steep.vehicleClass, 'offroad-passable');
});

test('cost is standard on flat ground and monotone in slope, roughness and shallow water', () => {
  assert.equal(evaluateTrafficabilityAt(analytic(), 0, 0).costFactor, 1);
  for (const key of ['slope', 'roughness', 'depth']) {
    let previous = 0;
    for (const value of [0, 0.1, 0.2, 0.3]) {
      const p = evaluateTrafficabilityAt(analytic({ [key]: value }), 0, 0);
      assert.ok(p.costFactor > previous); assert.ok(Number.isFinite(p.costFactor));
      previous = p.costFactor;
    }
  }
});

test('blocked surfaces block both modes regardless of a flat dry frame', () => {
  for (const movementMode of ['pedestrian', 'vehicle']) {
    const p = evaluateTrafficabilityAt(analytic({ surfaceKind: 'blocked' }), 0, 0, { movementMode });
    assert.equal(p.vehicleClass, 'blocked'); assert.equal(p.isPassable, false); assert.equal(p.costFactor, Infinity);
  }
});

test('real road carriageways flatten cross slopes and discard underlying roughness', () => {
  const source = baseTerrain((x, y) => 100 + 2 * (y - 500));
  const base = { ...source, sampleAt(x, y) { return { ...source.sampleAt(x, y), roughness: 50 }; } };
  const adjusted = createRoadAdjustedTerrain(base, [roadProfile(100, 'at-grade')]);
  assert.equal(evaluateTrafficabilityAt(base, 500, 500).isPassable, false);
  // At the carriageway edge, a ground derivative stencil straddles the batter.
  for (const yM of [497, 499, 500, 501, 503]) {
    const p = evaluateTrafficabilityAt(adjusted, 500, yM, { movementMode: 'vehicle' });
    assert.equal(p.slopeMPerM, 0); assert.equal(p.costFactor, 1);
    assert.equal(p.vehicleClass, 'highway'); assert.equal(p.isPassable, true);
  }
  assert.equal(adjusted.roadSurfaceAt(500, 504), null);
  assert.notEqual(evaluateTrafficabilityAt(adjusted, 500, 510).vehicleClass, 'highway');
});

test('roads retain actual longitudinal grades rather than replacing steep grades with zero', () => {
  const profile = roadProfile(100, 'at-grade');
  profile.samples[1].roadElevationM = 420;
  profile.samples.forEach(p => { p.gradeSlope = 0.4; });
  const adjusted = createRoadAdjustedTerrain(baseTerrain(() => 100), [profile]);
  const p = evaluateTrafficabilityAt(adjusted, 500, 500, { movementMode: 'vehicle' });
  assert.equal(p.slopeMPerM, 0.4); assert.equal(p.vehicleClass, 'steep-infeasible');
  assert.equal(p.costFactor, Infinity);
});

test('supported roads use water clearance and lose highway cost when flooded', () => {
  for (const [elevation, depth] of [[104, 0], [101.75, 0.25], [101, 1]]) {
    const adjusted = createRoadAdjustedTerrain(waterTerrain(), [roadProfile(elevation)]);
    const p = evaluateTrafficabilityAt(adjusted, 500, 500);
    assert.equal(p.waterDepthM, depth); assert.equal(p.isPassable, depth <= 0.3);
    if (depth === 0) assert.equal(p.costFactor, 1);
    else assert.ok(p.costFactor > 1);
  }
});

test('bridge decks override deep water and riverbed slope, while the ground sample stays unchanged', () => {
  const base = waterTerrain(102, (x, y) => 90 + 2 * (y - 500));
  const original = base.sampleAt(500, 500);
  const bridge = createRoadAdjustedTerrain(base, [roadProfile(104, 'bridge-deck')]);
  assert.deepEqual(bridge.sampleAt(500, 500), original);
  assert.equal(evaluateTrafficabilityAt(base, 500, 500).isPassable, false);
  for (const movementMode of ['pedestrian', 'vehicle']) for (const yM of [497, 500, 503]) {
    const p = evaluateTrafficabilityAt(bridge, 500, yM, { movementMode });
    assert.equal(p.structureKind, 'bridge-deck'); assert.equal(p.slopeMPerM, 0);
    assert.equal(p.waterDepthM, 0); assert.equal(p.vehicleClass, 'highway');
    assert.equal(p.costFactor, 1); assert.equal(p.isPassable, true);
  }
  assert.notEqual(evaluateTrafficabilityAt(bridge, 500, 504).vehicleClass, 'highway');
  const explicitDeck = evaluateTrafficabilityAt(analytic({ depth: 5, structureKind: 'bridge-deck' }), 0, 0);
  assert.equal(explicitDeck.isPassable, true);
});

test('a submerged bridge deck is blocked; being above the riverbed alone is insufficient', () => {
  const bridge = createRoadAdjustedTerrain(waterTerrain(106), [roadProfile(104, 'bridge-deck')]);
  const p = evaluateTrafficabilityAt(bridge, 500, 500);
  assert.equal(p.waterDepthM, 2); assert.equal(p.pedestrianClass, 'drowning-deep');
  assert.equal(p.vehicleClass, 'flooded'); assert.equal(p.isPassable, false); assert.equal(p.costFactor, Infinity);
});

test('real building pads are level and retaining batters use their measured slope', () => {
  const steep = baseTerrain((x, y) => 100 + 2 * (x - 500));
  const leveled = createBuildingPadAdjustedTerrain(steep, [pad(100)]);
  for (const xM of [490, 500, 510]) {
    const p = evaluateTrafficabilityAt(leveled, xM, 500, { movementMode: 'vehicle' });
    assert.equal(p.structureKind, 'building-pad'); assert.equal(p.pedestrianClass, 'walkable');
    assert.equal(p.slopeMPerM, 0); assert.equal(p.isPassable, true); assert.equal(p.costFactor, 1);
  }
  for (const batterSlope of [0.2, 0.75, 2]) {
    const adjusted = createBuildingPadAdjustedTerrain(baseTerrain(() => 100), [pad()],
      { batterSlope, derivativeStepM: 0.01 });
    const halfWidth = Math.hypot(1, 6 / batterSlope) / 2;
    const p = evaluateTrafficabilityAt(adjusted, 500, 510 + halfWidth);
    assert.equal(p.structureKind, 'retaining-batter');
    assert.equal(p.slopeMPerM, adjusted.surfaceFrameAt(500, 510 + halfWidth).slopeMPerM);
    assert.equal(p.pedestrianClass, batterSlope <= 0.5 ? 'walkable'
      : batterSlope <= 1 ? 'difficult-scramble' : 'impassable-cliff');
  }
});

test('pad water clearance still blocks flooded platforms and pad overlays supersede roads', () => {
  const flooded = createBuildingPadAdjustedTerrain(waterTerrain(106), [pad()]);
  assert.equal(evaluateTrafficabilityAt(flooded, 500, 500).isPassable, false);
  const road = createRoadAdjustedTerrain(baseTerrain(() => 100), [roadProfile()]);
  const adjusted = createBuildingPadAdjustedTerrain(road, [pad(102)]);
  assert.equal(adjusted.roadSurfaceAt(500, 500), null);
  assert.equal(evaluateTrafficabilityAt(adjusted, 500, 500).structureKind, 'building-pad');
  assert.equal(evaluateTrafficabilityAt(adjusted, 700, 500).vehicleClass, 'highway');
});

test('base, road, bridge and pad samples are exactly equal across LOD and adjacent windows', () => {
  const base = waterTerrain();
  const road = createRoadAdjustedTerrain(base, [roadProfile()]);
  const bridge = createRoadAdjustedTerrain(base, [roadProfile(104, 'bridge-deck')]);
  const adjusted = createBuildingPadAdjustedTerrain(road, [pad(105)]);
  for (const terrain of [base, road, bridge, adjusted]) {
    const sampler = createTrafficabilitySampler(terrain);
    assert.equal(sampler.sampleAt, terrain.sampleAt);
    const bounds = { minXM: 480, minYM: 480, maxXM: 520, maxYM: 520 };
    const fine = sampler.sampleTrafficabilityWindow({ ...bounds, spacingM: 0.5 });
    assert.equal(fine.columns, 81); assert.equal(fine.rows, 81);
    const byPosition = new Map(fine.samples.map(p => [`${p.xM},${p.yM}`, p]));
    for (const spacingM of [1, 2, 4, 10]) {
      for (const p of sampler.sampleTrafficabilityWindow({ ...bounds, spacingM }).samples) {
        assert.deepEqual(p, byPosition.get(`${p.xM},${p.yM}`));
        assert.deepEqual(p, sampler.trafficabilityAt(p.xM, p.yM));
        assert.deepEqual(p, evaluateTrafficabilityAt(terrain, p.xM, p.yM));
      }
    }
    const left = sampler.sampleTrafficabilityWindow({ ...bounds, maxXM: 500, spacingM: 2 });
    const right = sampler.sampleTrafficabilityWindow({ ...bounds, minXM: 500, spacingM: 2 });
    assert.deepEqual(left.samples.filter(p => p.xM === 500), right.samples.filter(p => p.xM === 500));
    const p = sampler.trafficabilityAt(500, 500); p.costFactor = -999;
    assert.deepEqual(sampler.trafficabilityAt(500, 500), byPosition.get('500,500'));
  }
});

test('sampler owns options and preserves unknown hydrology rather than reporting dry ground', () => {
  const options = { maxWalkableSlopeMPerM: 0.1 };
  const terrain = analytic({ slope: 0.2, depth: null, surfaceKind: 'unresolved' });
  const sampler = createTrafficabilitySampler(terrain, options);
  options.maxWalkableSlopeMPerM = 0.5;
  const p = sampler.trafficabilityAt(0, 0);
  assert.equal(p.pedestrianClass, 'difficult-scramble'); assert.equal(p.waterDepthM, null);
  assert.equal(p.surfaceKind, 'unresolved'); assert.ok(Object.isFrozen(sampler));
});

test('invalid numeric contracts, geographic inputs, window dimensions and budgets fail explicitly', () => {
  assert.throws(() => createTrafficabilitySampler({}), TypeError);
  assert.throws(() => createTrafficabilitySampler({ ...analytic(), frame: { kind: 'sphere-geographic' } }), /metric/);
  for (const value of [NaN, Infinity, '1']) {
    assert.throws(() => evaluateTrafficabilityAt(analytic(), value, 0), TypeError);
    assert.throws(() => evaluateTrafficabilityAt(analytic({ slope: value }), 0, 0), TypeError);
  }
  for (const options of [{ movementMode: 'boat' }, { maxWadingDepthM: -1 },
    { maxVehicleSlopeMPerM: Infinity }, { maxWalkableSlopeMPerM: 2 }]) {
    assert.throws(() => createTrafficabilitySampler(analytic(), options));
  }
  assert.throws(() => evaluateTrafficabilityAt(analytic({ depth: -1 }), 0, 0), RangeError);
  assert.throws(() => evaluateTrafficabilityAt(analytic({ roughness: -1 }), 0, 0), RangeError);
  const sampler = createTrafficabilitySampler(analytic());
  const bounds = { minXM: 0, minYM: 0, maxXM: 10, maxYM: 10, spacingM: 1 };
  for (const changes of [{ spacingM: 0 }, { spacingM: 3 }, { maxXM: 0 }, { minYM: NaN },
    { maxXM: 1000, maxYM: 1000 }, { minXM: 1e16, maxXM: 1e16 + 10, spacingM: 0.01 }]) {
    assert.throws(() => sampler.sampleTrafficabilityWindow({ ...bounds, ...changes }));
  }
  const bounded = createTrafficabilitySampler(baseTerrain());
  assert.throws(() => bounded.trafficabilityAt(-1, 500));
  assert.throws(() => bounded.sampleTrafficabilityWindow({ ...bounds, minXM: -1 }));
});
