import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CommittedMaterializer } from '../src/core/committed-materialization.mjs';
import {
  materializeL2SettlementCandidate,
  saveL2SettlementMaterialization,
  L2_SETTLEMENT_MATERIALIZATION_SCHEMA,
} from '../src/core/l2-settlement-materialization.mjs';
import { readL2SettlementCandidatePage } from '../src/core/l2-settlement-handoff.mjs';
import { createSphericalProjection, offsetGeographic, greatCircle } from '../src/core/spherical.mjs';

// The candidate example is a saved, real-world-shaped handoff; the surfaces
// below are synthetic fixtures and are not a claim about that world.
const RADIUS_M = 6371000;
const example = JSON.parse(readFileSync(new URL('../fixtures/l2-settlement-handoff.json', import.meta.url), 'utf8'));
const handoff = example.handoff;
const population = { id: handoff.populationId, sourceWorldId: handoff.sourceWorldId };
const VILLAGE_SLOT = handoff.budget.cities + handoff.budget.towns;
const TOWN_SLOT = 0;

const candidateAt = slot => readL2SettlementCandidatePage(handoff, { offset: slot, limit: 1 }).candidates[0];

function baseSurface(overrides = {}) {
  return {
    worldId: handoff.sourceWorldId,
    sourceLayerId: handoff.layerId,
    surfaceId: 'test-native-l2@1',
    layer: 'L2',
    detailKind: 'native-l2-terrain@1',
    nativeSpacingM: { east: 25, north: 25 },
    frame: { radiusM: RADIUS_M },
    method: 'test-flat-native@1',
    sampleSurfaceAt: () => ({ groundElevationM: 100, waterDepthM: 0, waterLevelElevationM: 0, waterSourceIds: [], landReserved: false }),
    groundElevationAt: () => 100,
    ...overrides,
  };
}

const flat = baseSurface();
const wet = baseSurface({
  sampleSurfaceAt: () => ({ groundElevationM: 50, waterDepthM: 2, waterLevelElevationM: 52, waterSourceIds: ['lake:x'], landReserved: false }),
  groundElevationAt: () => 50,
});
const steep = baseSurface({
  sampleSurfaceAt: (latDeg, lonDeg) => ({ groundElevationM: 100 + (latDeg-candidateAt(VILLAGE_SLOT).latDeg+lonDeg-candidateAt(VILLAGE_SLOT).lonDeg)*1e6, waterDepthM: 0, waterLevelElevationM: null, waterSourceIds: [], landReserved: false }),
  groundElevationAt: (latDeg, lonDeg) => 100 + (latDeg-candidateAt(VILLAGE_SLOT).latDeg+lonDeg-candidateAt(VILLAGE_SLOT).lonDeg)*1e6,
});
const unknown = baseSurface({
  sampleSurfaceAt: () => ({ groundElevationM: NaN, waterDepthM: NaN, waterLevelElevationM: NaN, waterSourceIds: [], landReserved: false }),
  groundElevationAt: () => NaN,
});

function boundedSurface(origin, regionM) {
  const inside = (latDeg, lonDeg) => greatCircle(origin, { latDeg, lonDeg }, RADIUS_M).distanceM <= regionM;
  return baseSurface({
    sampleSurfaceAt: (latDeg, lonDeg) => (inside(latDeg, lonDeg)
      ? { groundElevationM: 100, waterDepthM: 0, waterLevelElevationM: 0, waterSourceIds: [], landReserved: false }
      : { groundElevationM: NaN, waterDepthM: NaN, waterLevelElevationM: NaN, waterSourceIds: [], landReserved: false }),
    groundElevationAt: (latDeg, lonDeg) => (inside(latDeg, lonDeg) ? 100 : NaN),
  });
}

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async key => (map.has(key) ? map.get(key) : null),
    putIfAbsent: async (key, record) => {
      if (map.has(key)) return map.get(key);
      map.set(key, record);
      return record;
    },
  };
}

function assertFiniteJson(value, path = 'root') {
  if (value === null) return;
  const type = typeof value;
  if (type === 'number') { assert.ok(Number.isFinite(value), `${path} must be finite`); return; }
  if (type === 'string' || type === 'boolean') return;
  if (Array.isArray(value)) { value.forEach((entry, i) => assertFiniteJson(entry, `${path}[${i}]`)); return; }
  if (type === 'object') {
    for (const key of Object.keys(value)) {
      assert.notEqual(value[key], undefined, `${path}.${key} must not be undefined`);
      assertFiniteJson(value[key], `${path}.${key}`);
    }
    return;
  }
  assert.fail(`${path} has unsupported type ${type}`);
}

test('flat detailed fixture materializes a village district and field page as finite JSON', () => {
  const result = materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT });
  const candidate = candidateAt(VILLAGE_SLOT);
  assert.equal(result.schema, L2_SETTLEMENT_MATERIALIZATION_SCHEMA);
  assert.equal(result.status, 'materialized');
  assert.equal(result.candidateId, candidate.id);
  assert.equal(result.kind, 'village');
  assert.equal(result.origin.latDeg, candidate.latDeg);
  assert.equal(result.origin.lonDeg, candidate.lonDeg);
  assert.equal(result.housing.totalPopulation, candidate.population);
  assert.ok(result.housing.placedDwellings > 0);
  assert.ok(result.housing.representedPopulation > 0);
  assert.equal(result.housing.totalPopulation, result.housing.requestedPopulation + result.housing.unvisitedPopulation);
  assert.equal(result.housing.requestedPopulation, result.housing.representedPopulation + result.housing.unresolvedPopulation);
  assert.ok(result.layout.buildings.length > 0);
  assert.equal(result.fields.requestedM2, Math.min(16*40000,candidate.farmlandDemandM2));
  assert.equal(result.fields.totalDemandM2, candidate.farmlandDemandM2);
  assert.equal(result.fields.totalDemandM2, result.fields.requestedM2 + result.fields.outsidePageM2);
  assert.equal(result.fields.requestedM2, result.fields.surveyedM2 + result.fields.unresolvedM2);
  assert.equal(result.fields.surveyedM2, result.fields.accepted.reduce((sum, parcel) => sum + parcel.areaM2, 0));
  assert.ok(result.fields.accepted.length > 0);
  for (const parcel of result.fields.accepted) {
    assert.ok(Number.isInteger(parcel.areaM2) && parcel.areaM2 > 0);
    assert.equal(parcel.points.length, 4);
  }
  assert.ok(Number.isInteger(result.fields.requestedM2));
  assertFiniteJson(result);
});

test('district and field pages keep stable ids and positions', () => {
  const a = materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, fieldOffset: 0, fieldLimit: 16 });
  const b = materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, fieldOffset: 0, fieldLimit: 16 });
  assert.deepEqual(a, b);
  const later = materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, fieldOffset: 16, fieldLimit: 16 });
  assert.equal(a.layout.buildings[0].id, later.layout.buildings[0].id);
  assert.notEqual(a.fields.accepted[0].id, later.fields.accepted[0].id);
  assert.deepEqual(a.housing, later.housing);
});

test('dry corners do not hide water inside an accepted residential footprint',()=>{
  const initial=materializeL2SettlementCandidate(flat,population,handoff,{slot:VILLAGE_SLOT,fieldLimit:1});
  const house=initial.layout.buildings.find(b=>b.id.includes('/house:')),b=house.bounds;
  const origin=candidateAt(VILLAGE_SLOT),projection=createSphericalProjection({centerLatDeg:origin.latDeg,centerLonDeg:origin.lonDeg,radiusM:RADIUS_M,maxRadiusM:RADIUS_M*.1});
  const cx=(b.minXM+b.maxXM)/2,cy=(b.minYM+b.maxYM)/2;
  const sample=(lat,lon)=>{const p=projection.toLocal(lat,lon);return {groundElevationM:100,waterDepthM:Math.abs(p.xM-cx)<2&&Math.abs(p.yM-cy)<2?1:0,waterLevelElevationM:null};};
  const surface=baseSurface({sampleSurfaceAt:sample});
  const result=materializeL2SettlementCandidate(surface,population,handoff,{slot:VILLAGE_SLOT,fieldLimit:1});
  assert.ok(!result.layout.buildings.some(v=>v.id===house.id));
  assert.ok(!result.layout.buildingPads.some(v=>v.id===house.id));
  assert.ok(result.layout.geometryRejections.some(v=>v.id===house.id));
  assert.equal(result.housing.placedDwellings,initial.housing.placedDwellings-1);
  assert.equal(result.housing.requestedPopulation,result.housing.representedPopulation+result.housing.unresolvedPopulation);
  assert.equal(result.layout.layoutStatus.placedDwellings,result.housing.placedDwellings);
});

test('every field page conserves the single candidate demand including the partial last parcel',()=>{
  const candidate=candidateAt(VILLAGE_SLOT),ids=new Set();let requested=0;
  const count=Math.ceil(candidate.farmlandDemandM2/40000);
  for(let offset=0;offset<count;offset+=16){
    const result=materializeL2SettlementCandidate(flat,population,handoff,{slot:VILLAGE_SLOT,fieldOffset:offset,fieldLimit:16});
    requested+=result.fields.requestedM2;
    assert.equal(result.fields.totalDemandM2,candidate.farmlandDemandM2);
    assert.equal(result.fields.requestedM2,result.fields.surveyedM2+result.fields.unresolvedM2);
    for(const parcel of [...result.fields.accepted,...result.fields.rejected]){
      assert.ok(!ids.has(parcel.id));ids.add(parcel.id);
      const b=parcel.bounds;assert.ok(Math.abs((b.maxXM-b.minXM)*(b.maxYM-b.minYM)-parcel.areaM2)<1e-7);
    }
  }
  assert.equal(requested,candidate.farmlandDemandM2);assert.equal(ids.size,count);
});

test('the surveyed access corridor reserves its width before fields are accepted',()=>{
  const candidate=candidateAt(VILLAGE_SLOT);
  const target={id:'east-portal',provenance:'explicit boundary survey input',kind:'local-boundary-portal',
    ...offsetGeographic(candidate,1500,0,RADIUS_M)};
  const result=materializeL2SettlementCandidate(flat,population,handoff,{slot:VILLAGE_SLOT,accessTarget:target});
  assert.equal(result.access.status,'surveyed-local-route');
  assert.ok(result.fields.rejected.some(p=>p.reason==='occupied'));
  const projection=createSphericalProjection({...result.access.recipe.projection});
  const originProjection=createSphericalProjection({centerLatDeg:candidate.latDeg,centerLonDeg:candidate.lonDeg,radiusM:RADIUS_M,maxRadiusM:RADIUS_M*.1});
  for(const road of result.access.recipe.roadCenterlineProfiles)for(const sample of road.samples){
    const geo=projection.toGeographic(sample.xM,sample.yM),p=originProjection.toLocal(geo.latDeg,geo.lonDeg);
    for(const parcel of result.fields.accepted){const b=parcel.bounds;
      assert.ok(!(p.xM>b.minXM-road.halfWidthM&&p.xM<b.maxXM+road.halfWidthM&&p.yM>b.minYM-road.halfWidthM&&p.yM<b.maxYM+road.halfWidthM));
    }
  }
});

test('save commits once and reloads without regenerating', async () => {
  const store = memoryStore();
  const materializer = new CommittedMaterializer(store, { maxRecordBytes: 4 * 1024 * 1024 });
  const first = await saveL2SettlementMaterialization(materializer, flat, population, handoff, { slot: VILLAGE_SLOT });
  const second = await saveL2SettlementMaterialization(
    materializer, flat, population, handoff, { slot: VILLAGE_SLOT },
    { generate: () => { throw new Error('generator must not run on reload'); } },
  );
  assert.deepEqual(first, second);
  assert.equal(store.map.size, 1);
});

test('a changed surface is rejected by the committed store', async () => {
  const store = memoryStore();
  const materializer = new CommittedMaterializer(store);
  await saveL2SettlementMaterialization(materializer, flat, population, handoff, { slot: VILLAGE_SLOT });
  const other = baseSurface({ surfaceId: 'different-native@1' });
  await assert.rejects(() => saveL2SettlementMaterialization(materializer, other, population, handoff, { slot: VILLAGE_SLOT }));
});

for (const [name, surface, reason] of [['wet', wet, 'wet'], ['steep', steep, 'slope'], ['unknown', unknown, 'invalid-surface']]) {
  test(`${name} candidate is held with a reason and its requirement`, () => {
    const result = materializeL2SettlementCandidate(surface, population, handoff, { slot: VILLAGE_SLOT });
    assert.equal(result.status, 'held');
    assert.ok(result.reasons.some(entry => entry.includes(reason)), `expected ${reason} in ${JSON.stringify(result.reasons)}`);
    assert.equal(result.layout, null);
    assert.equal(result.housing.placedDwellings, 0);
    assert.equal(result.housing.representedPopulation, 0);
    assert.equal(result.housing.requestedPopulation, result.housing.unresolvedPopulation);
    assert.equal(result.fields.accepted.length, 0);
    assert.equal(result.fields.requestedM2, result.fields.unresolvedM2);
    assert.equal(result.access.status, 'not-generated');
    assertFiniteJson(result);
  });
}

test('detail boundary never materializes houses or fields outside it', () => {
  const candidate = candidateAt(VILLAGE_SLOT);
  const origin = { latDeg: candidate.latDeg, lonDeg: candidate.lonDeg };
  const surface = boundedSurface(origin, 1000);
  const result = materializeL2SettlementCandidate(surface, population, handoff, { slot: VILLAGE_SLOT });
  assert.equal(result.status, 'materialized');
  const projection = createSphericalProjection({ centerLatDeg: origin.latDeg, centerLonDeg: origin.lonDeg, radiusM: RADIUS_M, maxRadiusM: RADIUS_M * 0.1 });
  const within = (xM, yM) => greatCircle(origin, projection.toGeographic(xM, yM), RADIUS_M).distanceM <= 1000 + 1;
  for (const building of result.layout.buildings) {
    for (const [xM, yM] of [[building.bounds.minXM, building.bounds.minYM], [building.bounds.maxXM, building.bounds.minYM], [building.bounds.maxXM, building.bounds.maxYM], [building.bounds.minXM, building.bounds.maxYM]]) {
      assert.ok(within(xM, yM));
    }
  }
  for (const parcel of result.fields.accepted) for (const [xM, yM] of parcel.points) assert.ok(within(xM, yM));
  assert.ok(result.fields.rejected.length > 0);
  assert.ok(result.fields.accepted.length < result.fields.totalPlots);
  assertFiniteJson(result);
});

test('an access target routes through the existing local road survey and stays unresolved', () => {
  const candidate = candidateAt(VILLAGE_SLOT);
  const target = {
    id: 'portal-north',
    provenance: 'input boundary portal',
    kind: 'local-boundary-portal',
    ...offsetGeographic({ latDeg: candidate.latDeg, lonDeg: candidate.lonDeg }, 0, 1500, RADIUS_M),
  };
  const result = materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, accessTarget: target });
  assert.equal(result.access.status, 'surveyed-local-route');
  assert.equal(result.access.receivingConnection, 'unresolved');
  assert.ok(result.access.recipe.roadCenterlineProfiles.length > 0);
  assertFiniteJson(result);
});

test('a target beyond the local survey budget leaves an empty invalid profile', () => {
  const candidate = candidateAt(VILLAGE_SLOT);
  const target = {
    id: 'portal-far',
    provenance: 'input boundary portal',
    kind: 'local-boundary-portal',
    ...offsetGeographic({ latDeg: candidate.latDeg, lonDeg: candidate.lonDeg }, 0, 7000, RADIUS_M),
  };
  const result = materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, accessTarget: target });
  assert.notEqual(result.access.status, 'surveyed-local-route');
  assert.equal(result.access.recipe.roadCenterlineProfiles.length, 0);
});

test('a town keeps its demand explicit without inventing local fields', () => {
  const result = materializeL2SettlementCandidate(flat, population, handoff, { slot: TOWN_SLOT });
  assert.equal(result.kind, 'town');
  assert.equal(result.status, 'materialized');
  assert.ok(result.layout.buildings.length > 0);
  assert.equal(result.fields.requestedM2, 0);
  assert.equal(result.fields.surveyedM2, 0);
  assert.equal(result.fields.totalPlots, 0);
  assert.equal(result.fields.accepted.length, 0);
  assert.equal(result.fields.outsidePageM2, candidateAt(TOWN_SLOT).farmlandDemandM2);
  assert.equal(result.fields.status,'regional-supply-unresolved');
});

test('surface contract mismatches are rejected before generation', () => {
  const options = { slot: VILLAGE_SLOT };
  assert.throws(() => materializeL2SettlementCandidate(baseSurface({ worldId: 'other' }), population, handoff, options), /world mismatch/);
  assert.throws(() => materializeL2SettlementCandidate(baseSurface({ sourceLayerId: 'other' }), population, handoff, options), /parent L1 layer mismatch/);
  assert.throws(() => materializeL2SettlementCandidate(baseSurface({ layer: 'L1' }), population, handoff, options), /L2 surface/);
  assert.throws(() => materializeL2SettlementCandidate(baseSurface({ detailKind: 'other@1' }), population, handoff, options), /native L2 detail/);
  assert.throws(() => materializeL2SettlementCandidate(baseSurface({ nativeSpacingM: { east: 101, north: 25 } }), population, handoff, options), /native spacing/);
  assert.throws(() => materializeL2SettlementCandidate(baseSurface({ frame: { radiusM: 0 } }), population, handoff, options), /frame radius/);
  assert.throws(() => materializeL2SettlementCandidate(flat, { id: 'x', sourceWorldId: handoff.sourceWorldId }, handoff, options), /population authority mismatch/);
});

test('options are strictly validated', () => {
  assert.throws(() => materializeL2SettlementCandidate(flat, population, handoff, {}), /slot/);
  assert.throws(() => materializeL2SettlementCandidate(flat, population, handoff, { slot: 999999 }), /slot/);
  assert.throws(() => materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, fieldLimit: 0 }), /fieldLimit/);
  assert.throws(() => materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, fieldLimit: 65 }), /fieldLimit/);
  assert.throws(() => materializeL2SettlementCandidate(flat, population, handoff, { slot: VILLAGE_SLOT, districtIndex: 999 }), /district index/);
  assert.throws(() => materializeL2SettlementCandidate(flat, population, handoff, {
    slot: VILLAGE_SLOT,
    accessTarget: { id: 'p', latDeg: 0, lonDeg: 0, provenance: 'p', kind: 'wrong' },
  }), /local-boundary-portal/);
});
