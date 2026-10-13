import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSettlementSizePolicy, validateSettlementSizePolicy, settlementKindBounds,
  settlementCountFor, settlementSlotPopulation, settlementSlotPeoplePrefix,
  validateSettlementApportionment, settlementClassFor, SETTLEMENT_SIZE_POLICY_SCHEMA,
} from '../src/core/settlement-size-model.mjs';

test('size policy derives and re-derives the default integer bounds', () => {
  const policy = createSettlementSizePolicy();
  assert.equal(policy.schema, SETTLEMENT_SIZE_POLICY_SCHEMA);
  assert.equal(policy.villageMin, 1);
  assert.equal(policy.villageMax, 450);
  assert.equal(policy.townMin, 1000);
  assert.equal(policy.townMax, 6000);
  assert.equal(policy.cityMin, 25000);
  assert.equal(policy.cityMax, 75000);
  assert.equal(validateSettlementSizePolicy(policy), policy);
});

test('size policy converts custom integer means and rejects abnormal means', () => {
  const policy = createSettlementSizePolicy({ meanVillagePopulation: 200, meanTownPopulation: 2000, meanCityPopulation: 40000 });
  assert.equal(policy.townMin, 500);
  assert.equal(policy.townMax, 3000);
  assert.equal(policy.cityMin, 20000);
  assert.equal(policy.cityMax, 60000);
  assert.throws(() => createSettlementSizePolicy({ meanTownPopulation: 4000.5 }), RangeError);
  assert.throws(() => createSettlementSizePolicy({ meanCityPopulation: 1e9 }), RangeError);
  assert.throws(() => createSettlementSizePolicy({ meanVillagePopulation: 0 }), RangeError);
  assert.throws(() => createSettlementSizePolicy({ jitterPeriod: 64 }), RangeError);
});

test('a re-hashed contradictory policy is rejected by self-consistency', () => {
  const policy = createSettlementSizePolicy();
  assert.throws(() => validateSettlementSizePolicy({ ...policy, townMin: 5 }), /inconsistent/);
  assert.throws(() => validateSettlementSizePolicy({ ...policy, schema: 'other' }), RangeError);
});

test('town and city counts keep the mean inside the policy bounds', () => {
  const policy = createSettlementSizePolicy();
  const town = settlementCountFor(policy, 'town', 9000);
  assert.ok(town >= Math.ceil(9000 / policy.townMax) && town <= Math.floor(9000 / policy.townMin));
  assert.ok(9000 / town >= policy.townMin && 9000 / town <= policy.townMax);
  const tiny = settlementCountFor(policy, 'town', 999);
  assert.equal(tiny, 0);
  const city = settlementCountFor(policy, 'city', 30000);
  assert.ok(30000 / city >= policy.cityMin && 30000 / city <= policy.cityMax);
  assert.equal(settlementCountFor(policy, 'village', 0), 0);
  assert.equal(settlementCountFor(policy, 'village', 1), 1);
});

test('slot populations conserve the type budget and respect min/max', () => {
  const policy = createSettlementSizePolicy();
  const { min, max } = settlementKindBounds(policy, 'town');
  const people = 2000000, count = 1000, seed = 'seed';
  let sum = 0, prefixSum = 0;
  for (let rank = 0; rank < count; rank++) {
    const value = settlementSlotPopulation(policy, 'town', people, count, rank, seed);
    assert.ok(value >= min && value <= max, `slot ${rank} out of range: ${value}`);
    assert.equal(settlementSlotPeoplePrefix(policy, 'town', people, count, rank + 1, seed) - prefixSum, value);
    prefixSum += value;
    sum += value;
  }
  assert.equal(sum, people);
  assert.equal(settlementSlotPeoplePrefix(policy, 'town', people, count, count, seed), people);
});

test('an odd trailing slot is left unvaried so the sum is exact', () => {
  const policy = createSettlementSizePolicy();
  const people = 5001, count = 3;
  const slots = [0, 1, 2].map(rank => settlementSlotPopulation(policy, 'town', people, count, rank, 'odd'));
  assert.equal(slots[2], settlementSlotPopulation(policy, 'town', people, count, 2, 'odd'));
  assert.equal(slots.reduce((a, b) => a + b, 0), people);
});

test('a village slot is never below one person', () => {
  const policy = createSettlementSizePolicy();
  for (let rank = 0; rank < 64; rank++) {
    assert.ok(settlementSlotPopulation(policy, 'village', 64, 64, rank, 'v') >= 1);
  }
});

test('prefix population at billions of people is exact without a slot array', () => {
  const policy = createSettlementSizePolicy();
  const people = 2000000000, count = 500000;
  assert.equal(settlementSlotPeoplePrefix(policy, 'town', people, count, count, 'huge'), people);
  assert.equal(settlementSlotPeoplePrefix(policy, 'town', people, count, 0, 'huge'), 0);
  assert.equal(settlementSlotPeoplePrefix(policy, 'town', people, count, 2, 'huge'), 8000);
});

test('apportionment validation rejects impossible people/count pairs', () => {
  const policy = createSettlementSizePolicy();
  assert.equal(validateSettlementApportionment(policy, 'town', 3000, 1), true);
  assert.throws(() => validateSettlementApportionment(policy, 'town', 1000, 2), /below/);
  assert.throws(() => validateSettlementApportionment(policy, 'city', 30000, 2), /below/);
  assert.throws(() => validateSettlementApportionment(policy, 'town', 100, 0), /agree on zero/);
});

test('a zero jitter amplitude produces no variation at all', () => {
  const policy = createSettlementSizePolicy({ jitterAmplitudeFraction: 0 });
  const people = 2000000, count = 1000;
  for (let rank = 0; rank < count; rank++) {
    assert.equal(settlementSlotPopulation(policy, 'town', people, count, rank, 'zero'), Math.floor(people / count) + (rank < people % count ? 1 : 0));
  }
  assert.equal(settlementSlotPeoplePrefix(policy, 'town', people, count, count, 'zero'), people);
});

test('a small integer town mean still yields a positive derived town minimum', () => {
  const policy = createSettlementSizePolicy({ meanVillagePopulation: 1, meanTownPopulation: 1, meanCityPopulation: 1 });
  assert.equal(policy.townMin, 1);
  assert.ok(policy.townMax >= 1);
  assert.ok(policy.cityMin >= 1);
  assert.ok(policy.villageMax >= 1);
});

test('slot and prefix APIs reject an impossible people/count apportionment', () => {
  const policy = createSettlementSizePolicy();
  assert.throws(() => settlementSlotPopulation(policy, 'town', 1000, 2, 0, 'bad'), /below/);
  assert.throws(() => settlementSlotPeoplePrefix(policy, 'town', 1000, 2, 1, 'bad'), /below/);
  assert.throws(() => settlementSlotPopulation(policy, 'city', 30000, 2, 0, 'bad'), /below/);
});

test('villages under 100 people are shown as hamlets', () => {
  assert.equal(settlementClassFor('village', 99), 'hamlet');
  assert.equal(settlementClassFor('village', 100), 'village');
  assert.equal(settlementClassFor('town', 99), 'town');
  assert.equal(settlementClassFor('city', 99), 'city');
});
