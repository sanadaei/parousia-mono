import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {copyJson, hashJson} from '../src/core/json-contract.mjs';
import {
  createL0SettlementDistribution, validateSettlementDistribution,
  describeSettlementDistribution, refineSettlementDistribution, SETTLEMENT_DISTRIBUTION_SCHEMA,
} from '../src/core/settlement-distribution.mjs';
import {describeL0Region} from '../src/core/planet-macro.mjs';
import {auditL0} from '../scripts/audit-l0.mjs';
import {createL0ResolutionSeries} from '../scripts/experiments/l0-resolution-series.mjs';
import {createL1BroadRegion} from '../src/core/l1-broad-region.mjs';
import {parseBaselineArgs, buildL0SettlementBaseline, saveBaseline, SETTLEMENT_BUDGETS} from '../scripts/build-l0-settlement-baseline.mjs';

function fixture({ columns = 1, rows = 1, population, ruralPopulation, townPopulation = population.map(() => 0), cityPopulation = population.map(() => 0), villages, towns = population.map(() => 0), cities = population.map(() => 0), landMask, lakeFillDepthM, suitability }) {
  const n = columns * rows;
  const at = (a, fallback) => (a === undefined ? fallback : a);
  const budgets = { population, ruralPopulation, townPopulation, cityPopulation, villages, towns, cities };
  for (const [key, values] of Object.entries(budgets)) if (!Array.isArray(values) || values.length !== n) throw new Error(`fixture ${key} length`);
  const cells = population.map((_, i) => ({ cellIndex: i, population: population[i], ruralPopulation: ruralPopulation[i], townPopulation: townPopulation[i], cityPopulation: cityPopulation[i], villages: villages[i], towns: towns[i], cities: cities[i], suitability: at(suitability, population.map(() => 1))[i] }));
  const snapshot = { worldId: 'world@1', grid: { columns, rows }, frame: { radiusM: 6371000, verticalDatum: 'test' }, references: { sea: { levelElevationM: 0 } }, fields: { groundElevationM: Array.from({ length: n }, () => 100), landMask, lakeFillDepthM: at(lakeFillDepthM, landMask.map(() => 0)) } };
  const climate = { id: 'climate@1', sourceWorldId: 'world@1', grid: { columns, rows }, cellAreaM2: Array.from({ length: n }, () => 1), biome: Array.from({ length: n }, () => 'grassland'), annualMeanTemperatureC: Array.from({ length: n }, () => 12), annualPrecipitationMm: Array.from({ length: n }, () => 600) };
  const authority = { id: 'population@1', sourceWorldId: 'world@1', climateId: 'climate@1', grid: { columns, rows }, totals: { targetPopulation: population.reduce((s, v) => s + v, 0), supportedPopulation: population.reduce((s, v) => s + v, 0), unplacedPopulation: 0 }, cells };
  return { snapshot, climate, population: authority };
}

const singleParent = () => fixture({ population: [100], ruralPopulation: [100], villages: [3], landMask: [1] });

const mutation = (value) => JSON.parse(JSON.stringify(value));
const reidentify = (value) => { const { id, ...content } = value; return { ...content, id: hashJson(copyJson(content)) }; };

test('L0 distribution inherits the census, ignores water cells and survives reload', () => {
  const { snapshot, climate, population } = fixture({ columns: 2, rows: 1, population: [100, 0], ruralPopulation: [100, 0], villages: [4, 0], landMask: [1, 0] });
  const before = JSON.stringify({ snapshot, climate, population });
  const distribution = createL0SettlementDistribution(snapshot, climate, population);
  assert.equal(distribution.schema, SETTLEMENT_DISTRIBUTION_SCHEMA);
  assert.equal(distribution.layer, 'L0');
  assert.equal(distribution.status, 'distribution-only');
  assert.deepEqual(distribution.totals, { population: 100, ruralPopulation: 100, townPopulation: 0, cityPopulation: 0, villages: 4, towns: 0, cities: 0, populatedCells: 1 });
  assert.deepEqual(distribution.fields.wet, [0, 1]);
  assert.equal(distribution.fields.population[1], 0);
  validateSettlementDistribution(distribution);
  assert.deepEqual(JSON.parse(JSON.stringify(distribution)), distribution);
  assert.equal(JSON.stringify({ snapshot, climate, population }), before);
  for (let i = 0; i < 2; i++) assert.equal(distribution.fields.ruralPopulation[i] + distribution.fields.townPopulation[i] + distribution.fields.cityPopulation[i], distribution.fields.population[i]);
  assert.equal(distribution.id, createL0SettlementDistribution(snapshot, climate, population).id);
});

test('validation rejects a tampered id, water allocation and mismatched inputs', () => {
  const { snapshot, climate, population } = fixture({ population: [100], ruralPopulation: [100], villages: [3], landMask: [1] });
  const distribution = createL0SettlementDistribution(snapshot, climate, population);
  const tampered = mutation(distribution); tampered.interpretation = 'forged';
  assert.throws(() => validateSettlementDistribution(tampered), /identity/);
  const shifted = mutation(distribution); shifted.fields.population[0] += 1;
  assert.throws(() => validateSettlementDistribution(shifted), /does not match/);
  const wet = mutation(distribution); wet.fields.wet[0] = 1;
  assert.throws(() => validateSettlementDistribution(wet), /Water|water|Sea/);
  const badCount = mutation(distribution); badCount.fields.villages[0] = 0;
  assert.throws(() => validateSettlementDistribution(badCount), /Inconsistent/);
  const altCells = population.cells.map(c => ({ ...c, ruralPopulation: 99, cityPopulation: 1, cities: 1, villages: 3, population: 100 }));
  const alternative = createL0SettlementDistribution(snapshot, climate, { ...population, id: 'population@2', cells: altCells });
  assert.doesNotThrow(() => validateSettlementDistribution(alternative));
  assert.notEqual(alternative.id, distribution.id);
  assert.throws(() => createL0SettlementDistribution({ ...snapshot, worldId: 'other' }, climate, population), /population authority/);
  assert.throws(() => createL0SettlementDistribution(snapshot, { ...climate, id: 'other' }, population), /climate/);
  assert.throws(() => createL0SettlementDistribution(snapshot, climate, { ...population, grid: { columns: 2, rows: 1 } }), /population authority/);
  assert.throws(() => createL0SettlementDistribution(snapshot, climate, { ...population, totals: { ...population.totals, supportedPopulation: 50 } }), /balance|does not match/);
});

test('re-hashed totals, populated-cell counts and summaries are rejected as inconsistent aggregates', () => {
  const { snapshot, climate, population } = fixture({ population: [100], ruralPopulation: [100], villages: [3], landMask: [1] });
  const distribution = createL0SettlementDistribution(snapshot, climate, population);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(distribution), totals: { ...distribution.totals, villages: distribution.totals.villages + 1 } })), /total 'villages'/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(distribution), totals: { ...distribution.totals, populatedCells: 0 } })), /populatedCells/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(distribution), totals: { ...distribution.totals, population: 10000000001 } })), /total 'population'/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(distribution), summary: { ...distribution.summary, supportedPopulation: distribution.summary.supportedPopulation - 1 } })), /balance|supported population/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(distribution), summary: { ...distribution.summary, villages: distribution.summary.villages + 1 } })), /summary 'villages'/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(distribution), summary: { ...distribution.summary, requestedPopulation: 10000000001, supportedPopulation: 10000000001 } })), /Invalid requestedPopulation/);
  const overWorld = reidentify({
    ...mutation(distribution),
    fields: { ...distribution.fields, population: [10000000001], ruralPopulation: [10000000001] },
    totals: { ...distribution.totals, population: 10000000001, ruralPopulation: 10000000001 },
    summary: { ...distribution.summary, requestedPopulation: 10000000001, supportedPopulation: 10000000001 },
  });
  assert.throws(() => validateSettlementDistribution(overWorld), /Invalid population/);
});

test('L1 unallocated totals, false empty aggregates and L1 re-refinement are rejected', () => {
  const { snapshot, climate, population } = singleParent();
  const parent = createL0SettlementDistribution(snapshot, climate, population);
  const base = { sourceWorldId: 'world@1', climateId: 'l1-climate@1', sourceLayerId: 'l1-layer@1', grid: { columns: 2, rows: 1 }, parentCell: [0, 0], cellAreaM2: [1, 1], lakeFillDepthM: [0, 0] };
  const allWet = refineSettlementDistribution(parent, { ...base, landMask: [0, 0] });
  validateSettlementDistribution(allWet);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(allWet), unallocated: { ...allWet.unallocated, totals: { ...allWet.unallocated.totals, villages: allWet.unallocated.totals.villages + 1 } } })), /Unallocated total 'villages'/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(allWet), unallocated: { ...allWet.unallocated, totals: { ...allWet.unallocated.totals, parentCells: 0 } } })), /parentCells/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(allWet), unallocated: { ...allWet.unallocated, totals: { ...allWet.unallocated.totals, population: 0, ruralPopulation: 0, villages: 0 } } })), /Unallocated population does not match|Unallocated total/);
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(allWet), summary: { ...allWet.summary, unallocatedPopulation: allWet.summary.unallocatedPopulation - 1 } })), /unallocated population/);
  const allSuitable = refineSettlementDistribution(parent, { ...base, landMask: [1, 1], suitability: [1, 1] });
  assert.deepEqual(allSuitable.unallocated.parentCells, []);
  assert.deepEqual(allSuitable.unallocated.totals, { population: 0, ruralPopulation: 0, townPopulation: 0, cityPopulation: 0, villages: 0, towns: 0, cities: 0, populatedCells: 0, parentCells: 0 });
  assert.throws(() => validateSettlementDistribution(reidentify({ ...mutation(allSuitable), unallocated: { ...allSuitable.unallocated, totals: { ...allSuitable.unallocated.totals, villages: 5 } } })), /Unallocated total 'villages'/);
  assert.throws(() => refineSettlementDistribution(allWet, { ...base, grid: { columns: 4, rows: 1 }, parentCell: [0, 0, 0, 0], cellAreaM2: [1, 1, 1, 1], landMask: [1, 1, 1, 1] }), /L0 parent/);
});

test('describe aggregates budgets and describeL0Region attaches them as settlementBudget', () => {
  const { snapshot, climate, population } = fixture({ columns: 2, rows: 1, population: [100, 20], ruralPopulation: [100, 20], villages: [4, 1], landMask: [1, 1] });
  const distribution = createL0SettlementDistribution(snapshot, climate, population);
  const described = describeSettlementDistribution(distribution, [1, 0]);
  assert.deepEqual(described.cellIndices, [0, 1]);
  assert.equal(described.budgets.population, 120);
  assert.equal(described.budgets.villages, 5);
  assert.equal(described.budgets.population, described.budgets.ruralPopulation + described.budgets.townPopulation + described.budgets.cityPopulation);
  const whole = describeL0Region(snapshot, climate, [0, 1], distribution);
  assert.equal(whole.settlementBudget.population, 120);
  assert.equal(whole.settlementBudget.villages, 5);
  assert.equal(whole.settlementBudget.player, undefined);
  assert.equal(describeL0Region(snapshot, climate, [0, 1]).settlementBudget, undefined);
  const other = createL0SettlementDistribution({ ...snapshot, worldId: 'elsewhere' }, { ...climate, sourceWorldId: 'elsewhere' }, { ...population, sourceWorldId: 'elsewhere' });
  assert.throws(() => describeL0Region(snapshot, climate, [0], other), /matching this world|must be an L0/);
});

test('refine conserves every budget, binds people to counts and never touches the parent', () => {
  const { snapshot, climate, population } = singleParent();
  const parent = createL0SettlementDistribution(snapshot, climate, population);
  const before = JSON.stringify(parent);
  const options = {
    sourceWorldId: 'world@1', climateId: 'l1-climate@1', sourceLayerId: 'l1-layer@1', grid: { columns: 2, rows: 1 }, parentCell: [0, 0],
    cellAreaM2: [4, 1], landMask: [1, 1], lakeFillDepthM: [0, 0], suitability: [1, 1],
  };
  const refined = refineSettlementDistribution(parent, options);
  validateSettlementDistribution(refined);
  assert.equal(refined.layer, 'L1');
  assert.equal(refined.parentDistributionId, parent.id);
  assert.equal(refined.sourceLayerId, 'l1-layer@1');
  assert.equal(JSON.stringify(parent), before);
  for (const key of SETTLEMENT_BUDGETS) assert.equal(refined.totals[key] + refined.unallocated.totals[key], parent.totals[key], key);
  assert.equal(refined.totals.ruralPopulation, refined.totals.population);
  for (let i = 0; i < 2; i++) {
    assert.equal((refined.fields.villages[i] > 0), (refined.fields.ruralPopulation[i] > 0));
    assert.ok(refined.fields.villages[i] <= refined.fields.ruralPopulation[i]);
    assert.equal(refined.fields.ruralPopulation[i] + refined.fields.townPopulation[i] + refined.fields.cityPopulation[i], refined.fields.population[i]);
  }
  assert.ok(refined.fields.ruralPopulation[0] > refined.fields.ruralPopulation[1]);
  assert.equal(refined.fields.suitability[0], 1000000);
  assert.deepEqual(refineSettlementDistribution(parent, options), refined);
});

test('a parent with no habitable child keeps its budgets as explicit unallocated', () => {
  const { snapshot, climate, population } = singleParent();
  const parent = createL0SettlementDistribution(snapshot, climate, population);
  const base = { sourceWorldId: 'world@1', climateId: 'l1-climate@1', sourceLayerId: 'l1-layer@1', grid: { columns: 2, rows: 1 }, parentCell: [0, 0], cellAreaM2: [1, 1] };
  for (const option of [{ landMask: [0, 0], lakeFillDepthM: [0, 0] }, { landMask: [1, 1], lakeFillDepthM: [0, 0], suitability: [0, 0] }]) {
    const refined = refineSettlementDistribution(parent, { ...base, ...option });
    validateSettlementDistribution(refined);
    assert.deepEqual(refined.unallocated.parentCells, [0]);
    for (const key of SETTLEMENT_BUDGETS) {
      assert.equal(refined.totals[key], 0, key);
      assert.equal(refined.unallocated.totals[key], parent.totals[key], key);
      assert.equal(refined.unallocated[key][0], parent.fields[key][0], key);
    }
  }
});

test('refine rejects a different world, grid, parent cell or malformed area', () => {
  const { snapshot, climate, population } = singleParent();
  const parent = createL0SettlementDistribution(snapshot, climate, population);
  const base = { sourceWorldId: 'world@1', climateId: 'l1-climate@1', sourceLayerId: 'l1-layer@1', grid: { columns: 2, rows: 1 }, parentCell: [0, 0], cellAreaM2: [1, 1], landMask: [1, 1], lakeFillDepthM: [0, 0] };
  assert.throws(() => refineSettlementDistribution(parent, { ...base, sourceWorldId: 'other' }), /world mismatch/);
  assert.throws(() => refineSettlementDistribution(parent, { ...base, grid: { columns: 2, rows: 2 } }), /must match|length/);
  assert.throws(() => refineSettlementDistribution(parent, { ...base, parentCell: [0, 2] }), /out of range/);
  assert.throws(() => refineSettlementDistribution(parent, { ...base, cellAreaM2: [1, 0] }), /positive/);
  assert.throws(() => refineSettlementDistribution(parent, { ...base, landMask: [1, 2] }), /land mask/);
});

test('L1 broad region refines the parent distribution and leaves terrain and climate numbers identical', () => {
  const audit = auditL0('settlement-l1', { columns: 32, rows: 16 });
  validateSettlementDistribution(audit.settlementDistribution);
  const series = createL0ResolutionSeries(audit.snapshot, { levels: 2 }), level = series.cases[1];
  const withBudget = createL1BroadRegion(audit, level);
  const plainParent = { snapshot: audit.snapshot, climate: audit.climate };
  const withoutBudget = createL1BroadRegion(plainParent, level);
  assert.equal(withoutBudget.settlementDistribution, undefined);
  assert.ok(withBudget.settlementDistribution);
  validateSettlementDistribution(withBudget.settlementDistribution);
  assert.equal(withBudget.settlementDistribution.sourceLayerId, withBudget.id);
  assert.equal(withBudget.settlementDistribution.parentDistributionId, audit.settlementDistribution.id);
  assert.notEqual(withBudget.id, withoutBudget.id);
  assert.deepEqual(withBudget.snapshot.fields, withoutBudget.snapshot.fields);
  assert.deepEqual(withBudget.parentCell, withoutBudget.parentCell);
  assert.deepEqual(withBudget.provinceKind, withoutBudget.provinceKind);
  for (const key of ['cellAreaM2', 'annualMeanTemperatureC', 'annualPrecipitationMm', 'biome']) assert.deepEqual(withBudget.climate[key], withoutBudget.climate[key], key);
  for (const key of SETTLEMENT_BUDGETS) assert.equal(withBudget.settlementDistribution.totals[key] + withBudget.settlementDistribution.unallocated.totals[key], audit.settlementDistribution.totals[key], key);
  const denser = auditL0('settlement-l1', { columns: 32, rows: 16, targetPopulation: 50000000 });
  assert.notEqual(denser.settlementDistribution.id, audit.settlementDistribution.id);
  assert.notEqual(createL1BroadRegion(denser, level).id, withBudget.id);
});

test('baseline CLI validates options, conserves budgets and reloads identically', () => {
  assert.deepEqual(parseBaselineArgs([]), { seed: 'planet-1', population: 100000000, columns: 128, rows: 64, levels: 2, outputDir: path.resolve('reports/l0-settlement-baseline') });
  assert.equal(parseBaselineArgs(['out', '--seed=x', '--population=10', '--columns=16', '--rows=8', '--levels=1']).population, 10);
  assert.throws(() => parseBaselineArgs(['--levels=6']), /levels/);
  assert.throws(() => parseBaselineArgs(['--columns=8']), /columns/);
  assert.throws(() => parseBaselineArgs(['--population=-1']), /population/);
  assert.throws(() => parseBaselineArgs(['--unknown=1']), /Unknown option/);
  assert.throws(() => parseBaselineArgs(['examples/planet/generated']), /Refusing/);
  const result = buildL0SettlementBaseline({ seed: 'baseline-test', targetPopulation: 1000000, columns: 32, rows: 16, levels: 2, beforeLevel: () => {} });
  assert.equal(result.summary.checks.budgetsConserved, true);
  assert.equal(result.summary.checks.withinLimit, true);
  assert.ok(result.summary.sizes.l1Bytes > 0);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'l0-settlement-baseline-'));
  try {
    const saved = saveBaseline(result, directory);
    assert.equal(saved.reloadedIdentical, true);
    assert.ok(fs.existsSync(path.join(directory, 'l0.json')));
    assert.ok(fs.existsSync(path.join(directory, 'l1.json')));
    assert.ok(fs.existsSync(path.join(directory, 'summary.json')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
