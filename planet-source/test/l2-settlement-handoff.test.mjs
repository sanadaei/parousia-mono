import test from 'node:test';
import assert from 'node:assert/strict';
import { planAgriculturePopulation } from '../src/core/planet-population.mjs';
import { createL0SettlementDistribution, refineSettlementDistribution } from '../src/core/settlement-distribution.mjs';
import { createL2SettlementHandoff, validateL2SettlementHandoff, readL2SettlementCandidatePage, surveyL2SettlementCandidates, L2_MAX_PAGE_SIZE } from '../src/core/l2-settlement-handoff.mjs';
import { copyJson, hashJson } from '../src/core/json-contract.mjs';

const RADIUS = 6371000;

function buildWorld({ worldId = 'world-a', columns = 8, rows = 8 } = {}) {
  const n = columns * rows;
  const groundElevationM = Array.from({ length: n }, (_, i) => (i % columns) * 4);
  const landMask = Array.from({ length: n }, (_, i) => (i === 5 ? 0 : 1));
  const lakeFillDepthM = new Array(n).fill(0);
  const snapshot = { worldId, grid: { columns, rows }, frame: { radiusM: RADIUS }, fields: { groundElevationM, landMask, lakeFillDepthM } };
  const monthlyTemperatureC = Array.from({ length: 12 }, () => new Array(n).fill(15));
  const monthlyPrecipitationMm = Array.from({ length: 12 }, () => new Array(n).fill(60));
  const cellAreaM2 = new Array(n).fill(1000000000);
  const climate = { id: 'climate-1', sourceWorldId: worldId, grid: { columns, rows }, monthlyTemperatureC, monthlyPrecipitationMm, cellAreaM2 };
  return { snapshot, climate, columns, rows, n };
}

function buildFixture() {
  const { snapshot, climate, columns, rows, n } = buildWorld();
  const population = planAgriculturePopulation(snapshot, climate, { targetPopulation: 20000000 });
  const l0 = createL0SettlementDistribution(snapshot, climate, population);
  const parentCell = Array.from({ length: n }, (_, i) => i);
  const cellAreaM2 = climate.cellAreaM2;
  const landMask = snapshot.fields.landMask;
  const lakeFillDepthM = snapshot.fields.lakeFillDepthM;
  const l1 = refineSettlementDistribution(l0, { sourceWorldId: snapshot.worldId, climateId: climate.id, sourceLayerId: 'layer-l1', grid: { columns, rows }, parentCell, cellAreaM2, landMask, lakeFillDepthM });
  const region = { settlementDistribution: l1, parentCell };
  return { snapshot, climate, population, l0, l1, region, n };
}

function findCell(population, predicate) {
  const index = population.cells.findIndex(predicate);
  assert.ok(index >= 0, 'expected a matching cell');
  return index;
}

function fakeBase({ worldId = 'world-a', wet = () => false, height = () => 10, sitingWet = () => false, sourceLayerId = undefined, surfaceId = undefined, surface = null } = {}) {
  return {
    worldId,
    ...(sourceLayerId !== undefined ? { sourceLayerId } : {}),
    ...(surfaceId !== undefined ? { surfaceId } : {}),
    frame: { radiusM: RADIUS },
    sampleSurfaceAt: surface ?? ((latDeg, lonDeg) => ({
      waterDepthM: wet(latDeg, lonDeg) ? 1 : 0,
      groundElevationM: height(latDeg, lonDeg),
      waterLevelElevationM: wet(latDeg, lonDeg) ? 5 : undefined,
      sitingWet: sitingWet(latDeg, lonDeg),
    })),
    groundElevationAt: (latDeg, lonDeg) => height(latDeg, lonDeg),
  };
}

function reorder(value) {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).reverse();
    return Object.fromEntries(keys.map(key => [key, reorder(value[key])]));
  }
  return value;
}

function rehash(content) { return { ...content, id: hashJson(copyJson(content)) }; }
function rehashPopulation(population) { const { id, ...rest } = population; return { ...rest, id: hashJson(copyJson(rest)) }; }

test('the population authority saves a canonical top-level size policy and keeps population = its parts', () => {
  const { population } = buildFixture();
  assert.equal(population.schema, 'agriculture-population@2');
  // The canonical size policy lives at population.sizePolicy; settings keeps only
  // the original input values.
  assert.equal(population.sizePolicy.townMin, 1000);
  assert.equal(population.sizePolicy.cityMin, 25000);
  assert.equal(population.settings.sizePolicy, undefined);
  assert.equal(population.settings.meanTownPopulation, 4000);
  for (const cell of population.cells) {
    assert.equal(cell.population, cell.ruralPopulation + cell.townPopulation + cell.cityPopulation);
    assert.equal((cell.cityPopulation === 0), (cell.cities === 0));
    assert.equal((cell.townPopulation === 0), (cell.towns === 0));
    assert.equal((cell.ruralPopulation === 0), (cell.villages === 0));
    if (cell.towns) assert.ok(cell.townPopulation / cell.towns >= population.sizePolicy.townMin && cell.townPopulation / cell.towns <= population.sizePolicy.townMax);
    if (cell.cities) assert.ok(cell.cityPopulation / cell.cities >= population.sizePolicy.cityMin && cell.cityPopulation / cell.cities <= population.sizePolicy.cityMax);
  }
});

test('the size policy propagates from the population authority to L0 and L1', () => {
  const { population, l0, l1 } = buildFixture();
  assert.equal(l0.sizePolicy.townMin, population.sizePolicy.townMin);
  assert.equal(l1.sizePolicy.townMin, population.sizePolicy.townMin);
  const tampered = { ...l1, sizePolicy: { ...l1.sizePolicy, townMin: l1.sizePolicy.townMin + 1 } };
  assert.throws(() => refineSettlementDistribution(tampered, { sourceWorldId: population.sourceWorldId, climateId: l1.climateId, sourceLayerId: 'x', grid: l1.grid, parentCell: [], cellAreaM2: [], landMask: [], lakeFillDepthM: [] }), RangeError);
});

test('the L0 to L1 refinement keeps parents = children + unallocated and preserves town means', () => {
  const { l0, l1, population } = buildFixture();
  for (const key of ['population', 'ruralPopulation', 'townPopulation', 'cityPopulation', 'villages', 'towns', 'cities']) {
    assert.equal(l1.totals[key] + l1.unallocated.totals[key], l0.totals[key]);
  }
  assert.equal(l1.fields.population.reduce((a, b) => a + b, 0), population.totals.supportedPopulation);
  const populated = findCell(population, c => c.townPopulation > 0);
  assert.equal(l1.fields.townPopulation[populated], l0.fields.townPopulation[populated]);
});

test('createL2SettlementHandoff is pure, L1-only and identity stable under key reordering', () => {
  const { population, l0, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const before = JSON.stringify(population);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  assert.equal(JSON.stringify(population), before, 'inputs must not be modified');
  assert.equal(handoff.status, 'candidate-budget-only');
  assert.equal(handoff.cellIndex, cellIndex);
  assert.equal(handoff.budget.population, population.cells[cellIndex].population);
  assert.equal(validateL2SettlementHandoff(handoff), handoff);
  const reordered = reorder(handoff);
  assert.equal(reordered.id, handoff.id);
  assert.equal(validateL2SettlementHandoff(reordered), reordered);
  assert.throws(() => createL2SettlementHandoff({ settlementDistribution: l0, parentCell: Array.from({ length: population.cells.length }, (_, i) => i) }, population, 0), /L1/);
});

test('create rejects a tampered population that kept the same id', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const tampered = { ...population, cells: population.cells.map((cell, i) => (i === 0 ? { ...cell, netFoodKg: cell.netFoodKg + 1 } : cell)) };
  assert.throws(() => createL2SettlementHandoff(region, tampered, cellIndex), /identity/);
});

test('create rejects mismatched region world, layer, grid and climate identities', () => {
  const { snapshot, population, l1, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const good = {
    ...region,
    snapshot: { worldId: snapshot.worldId, layerId: l1.sourceLayerId, grid: { columns: l1.grid.columns, rows: l1.grid.rows } },
    climate: { id: l1.climateId, sourceWorldId: snapshot.worldId, parentClimateId: population.climateId },
  };
  assert.ok(createL2SettlementHandoff(good, population, cellIndex).id);
  assert.throws(() => createL2SettlementHandoff({ ...good, snapshot: { ...good.snapshot, worldId: 'other' } }, population, cellIndex), /world/);
  assert.throws(() => createL2SettlementHandoff({ ...good, snapshot: { ...good.snapshot, layerId: 'other' } }, population, cellIndex), /layer/);
  assert.throws(() => createL2SettlementHandoff({ ...good, snapshot: { ...good.snapshot, grid: { columns: 1, rows: 1 } } }, population, cellIndex), /grid/);
  assert.throws(() => createL2SettlementHandoff({ ...good, climate: { ...good.climate, id: 'other' } }, population, cellIndex), /climate/);
  assert.throws(() => createL2SettlementHandoff({ ...good, climate: { ...good.climate, parentClimateId: 'other' } }, population, cellIndex), /parent climate/);
});

test('a tampered parent mapping, bounds, granularity or policy is rejected even after rehashing', () => {
  const { population, region, l1 } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  const { id, ...content } = handoff;

  const badBudgets = rehash({ ...content, budget: { ...content.budget, population: content.budget.population + 1 } });
  assert.throws(() => validateL2SettlementHandoff(badBudgets), /sum to its population/);

  const badGrid = rehash({ ...content, cellIndex: content.grid.columns * content.grid.rows + 5 });
  assert.throws(() => validateL2SettlementHandoff(badGrid), /cellIndex/);

  const badParent = rehash({ ...content, parentCell: (content.parentCell + 1) % (content.parentGrid.columns * content.parentGrid.rows) });
  assert.throws(() => validateL2SettlementHandoff(badParent), /geographic parent/);

  const badBounds = rehash({ ...content, bounds: { ...content.bounds, east: content.bounds.east + 360 / content.grid.columns } });
  assert.throws(() => validateL2SettlementHandoff(badBounds), /bounds/);

  const badGranularity = rehash({ ...content, parentGrid: { columns: content.parentGrid.columns + 1, rows: content.parentGrid.rows } });
  assert.throws(() => validateL2SettlementHandoff(badGranularity), RangeError);

  const badPolicy = rehash({ ...content, sizePolicy: { ...content.sizePolicy, townMin: content.sizePolicy.townMin + 1 } });
  assert.throws(() => validateL2SettlementHandoff(badPolicy), /inconsistent/);

  const badFarmland = rehash({ ...content, farmland: { ...content.farmland, totalDemandM2: content.farmland.totalDemandM2 + 7 } });
  assert.throws(() => validateL2SettlementHandoff(badFarmland), /farmland/);

  const badHash = { ...handoff, id: 'sha256:0000' };
  assert.throws(() => validateL2SettlementHandoff(badHash), /identity/);
  // The L0 policy is also asserted for local re-derivation.
  assert.equal(l1.sizePolicy.cityMin, 25000);
});

test('a zero-population, zero-yield cell yields zero farmland demand without NaN', () => {
  const { population, region } = buildFixture();
  const cellIndex = population.cells.findIndex(c => c.population === 0 && c.capacity === 0);
  assert.ok(cellIndex >= 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  assert.equal(handoff.budget.population, 0);
  assert.equal(handoff.farmland.yieldKgPerHa, 0);
  assert.equal(handoff.farmland.totalDemandM2, 0);
  assert.equal(handoff.farmland.unresolved, false);
  assert.equal(validateL2SettlementHandoff(handoff), handoff);
  const page = readL2SettlementCandidatePage(handoff, { offset: 0, limit: 64 });
  assert.equal(page.total, 0);
  assert.deepEqual(page.candidates, []);
});

test('a positive population with a zero scenario yield keeps the explicit unresolved flag', () => {
  const { population, snapshot, climate } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const zeroed = rehashPopulation({ ...population, cells: population.cells.map((cell, i) => (i === cellIndex ? { ...cell, netFoodKg: 0 } : cell)) });
  const l0=createL0SettlementDistribution(snapshot,climate,zeroed);
  const parentCell=zeroed.cells.map(c=>c.cellIndex);
  const l1=refineSettlementDistribution(l0,{sourceWorldId:snapshot.worldId,climateId:climate.id,sourceLayerId:'layer-l1',grid:snapshot.grid,parentCell,cellAreaM2:climate.cellAreaM2,landMask:snapshot.fields.landMask,lakeFillDepthM:snapshot.fields.lakeFillDepthM});
  const region={settlementDistribution:l1,parentCell};
  const handoff = createL2SettlementHandoff(region, zeroed, cellIndex);
  assert.ok(handoff.budget.population > 0);
  assert.equal(handoff.farmland.yieldKgPerHa, 0);
  assert.equal(handoff.farmland.totalDemandM2, 0);
  assert.equal(handoff.farmland.unresolved, true);
});

test('a non-finite or negative parent agricultural value is rejected, not silently zeroed', () => {
  const { population, snapshot, climate } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  for (const bad of [NaN, -1]) {
    assert.throws(() => {
      const broken = rehashPopulation({ ...population, cells: population.cells.map((cell, i) => (i === cellIndex ? { ...cell, netFoodKg: bad } : cell)) });
      const l0=createL0SettlementDistribution(snapshot,climate,broken),parentCell=broken.cells.map(c=>c.cellIndex);
      const l1=refineSettlementDistribution(l0,{sourceWorldId:snapshot.worldId,climateId:climate.id,sourceLayerId:'layer-l1',grid:snapshot.grid,parentCell,cellAreaM2:climate.cellAreaM2,landMask:snapshot.fields.landMask,lakeFillDepthM:snapshot.fields.lakeFillDepthM});
      return createL2SettlementHandoff({settlementDistribution:l1,parentCell},broken,cellIndex);
    }, /finite/);
  }
});

test('pages are bounded, ordered city then town then village, and stable on revisit', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.towns > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  const first = readL2SettlementCandidatePage(handoff, { offset: 0, limit: 64 });
  const again = readL2SettlementCandidatePage(JSON.parse(JSON.stringify(handoff)), { offset: 0, limit: 64 });
  assert.deepEqual(again, first);
  const kinds = first.candidates.map(c => c.kind);
  const order = { city: 0, town: 1, village: 2 };
  for (let i = 1; i < kinds.length; i++) assert.ok(order[kinds[i]] >= order[kinds[i - 1]]);
  const all = readL2SettlementCandidatePage(handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE }).candidates;
  const page2 = readL2SettlementCandidatePage(handoff, { offset: 64, limit: 64 });
  for (let i = 0; i < page2.candidates.length; i++) {
    assert.equal(page2.candidates[i].id, all[64 + i]?.id);
  }
  const wide = readL2SettlementCandidatePage(handoff, { offset: 0, limit: 100000 });
  assert.ok(wide.limit <= L2_MAX_PAGE_SIZE);
  assert.throws(() => readL2SettlementCandidatePage(handoff, { offset: -1 }), RangeError);
  assert.throws(() => readL2SettlementCandidatePage(handoff, { offset: 1.5 }), RangeError);
});

test('page candidates keep their population, id and a unique shared-stratum coordinate', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.villages > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  const page = readL2SettlementCandidatePage(handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  const seen = new Set();
  for (const candidate of page.candidates) {
    assert.equal(candidate.id, `${handoff.id}/slot:${candidate.slot}`);
    assert.ok(candidate.latDeg <= handoff.bounds.north && candidate.latDeg >= handoff.bounds.south);
    assert.ok(candidate.population > 0);
    if (candidate.kind === 'village') assert.equal(candidate.settlementClass, candidate.population < 100 ? 'hamlet' : 'village');
    const key = `${candidate.latDeg},${candidate.lonDeg}`;
    assert.equal(seen.has(key), false, 'candidate origins must not overlap within a page');
    seen.add(key);
  }
});

test('farmland demand is an integer, matches the page and slices exactly across pages', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  if (!handoff.farmland.unresolved) assert.ok(handoff.farmland.totalDemandM2 > 0);
  const pageA = readL2SettlementCandidatePage(handoff, { offset: 0, limit: 4 });
  const pageB = readL2SettlementCandidatePage(handoff, { offset: 4, limit: Math.max(1, pageA.total - 4) });
  const pageAll = readL2SettlementCandidatePage(handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  assert.equal(pageA.farmlandDemandM2 + pageB.farmlandDemandM2, handoff.farmland.totalDemandM2);
  assert.equal(pageAll.farmlandDemandM2, handoff.farmland.totalDemandM2);
  assert.equal(Number.isSafeInteger(handoff.farmland.totalDemandM2), true);
});

test('survey adopts real sites and partitions the seven budgets and farmland exactly', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  const base = fakeBase();
  const survey = surveyL2SettlementCandidates(base, population, handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  assert.equal('unsurveyed' in survey, false);
  assert.deepEqual(survey.unresolvedCandidates, []);
  for (const key of Object.keys(survey.budgets.requested)) {
    assert.equal(survey.budgets.adopted[key] + survey.budgets.unresolved[key] + survey.budgets.unvisited[key], handoff.budget[key]);
    assert.equal(survey.budgets.requested[key] + survey.budgets.unvisited[key], handoff.budget[key]);
  }
  assert.equal(survey.budgets.adopted.population, survey.budgets.requested.population);
  assert.equal(survey.budgets.unresolved.population, 0);
  assert.equal(survey.budgets.unvisited.population, 0);
  assert.equal(survey.farmlandDemandM2.adopted + survey.farmlandDemandM2.unresolved + survey.farmlandDemandM2.unvisited, handoff.farmland.totalDemandM2);
  assert.equal(survey.farmlandDemandM2.adopted, survey.farmlandDemandM2.requested);
  for (const site of survey.sites) {
    const candidate = readL2SettlementCandidatePage(handoff, { offset: site.slot, limit: 1 }).candidates[0];
    assert.equal(site.id, candidate.id);
    assert.equal(site.population, candidate.population);
    assert.equal(site.origin.latDeg, candidate.latDeg);
    assert.equal(site.origin.lonDeg, candidate.lonDeg);
  }
});

test('wet, steep and invalid candidates become siting-unresolved candidates with reasons', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  const wet = surveyL2SettlementCandidates(fakeBase({ wet: () => true }), population, handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  assert.equal(wet.budgets.adopted.population, 0);
  assert.equal(wet.budgets.unresolved.population, wet.budgets.requested.population);
  assert.ok(wet.rejected.wet > 0);
  assert.equal(wet.unresolvedCandidates.length, wet.page.limit);
  assert.ok(wet.unresolvedCandidates.every(candidate => candidate.status === 'siting-unresolved' && candidate.reason === 'wet'));
  const steep = surveyL2SettlementCandidates(fakeBase({ height: latDeg => latDeg * 100000 }), population, handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  assert.ok(steep.rejected.slope > 0 && steep.unresolvedCandidates.every(candidate => candidate.reason === 'slope'));
  const sitingWet = surveyL2SettlementCandidates(fakeBase({ sitingWet: () => true }), population, handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  assert.ok(sitingWet.rejected.wet > 0);
  const invalid = surveyL2SettlementCandidates(fakeBase({ surface: () => ({ waterDepthM: 0, groundElevationM: NaN }) }), population, handoff, { offset: 0, limit: L2_MAX_PAGE_SIZE });
  assert.equal(invalid.budgets.adopted.population, 0);
  assert.equal(invalid.rejected.invalid, invalid.page.limit);
  assert.ok(invalid.unresolvedCandidates.every(candidate => candidate.reason === 'invalid-surface'));
});

test('survey rejects a mismatched sampling layer and records its sampling source', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.population > 0);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  assert.throws(() => surveyL2SettlementCandidates(fakeBase({ sourceLayerId: 'other' }), population, handoff), /layer/);
  const survey = surveyL2SettlementCandidates(fakeBase({ sourceLayerId: handoff.layerId, surfaceId: 'surface-1' }), population, handoff, { offset: 0, limit: 4 });
  assert.equal(survey.sampling.sourceLayerId, handoff.layerId);
  assert.equal(survey.sampling.surfaceId, 'surface-1');
  assert.equal(survey.sampling.worldId, handoff.sourceWorldId);
  assert.ok(typeof survey.sampling.method === 'string');
});

test('a small page leaves the rest of the cell budget explicitly unvisited', () => {
  const { population, region } = buildFixture();
  const cellIndex = findCell(population, c => c.villages > 1);
  const handoff = createL2SettlementHandoff(region, population, cellIndex);
  const survey = surveyL2SettlementCandidates(fakeBase(), population, handoff, { offset: 0, limit: 1 });
  assert.equal(survey.budgets.requested.villages + survey.budgets.requested.towns + survey.budgets.requested.cities, 1);
  assert.equal(survey.budgets.adopted.population + survey.budgets.unresolved.population + survey.budgets.unvisited.population, handoff.budget.population);
  assert.ok(survey.budgets.unvisited.population > 0);
});
