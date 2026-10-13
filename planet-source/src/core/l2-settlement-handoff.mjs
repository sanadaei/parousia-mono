import {copyJson, hashJson} from './json-contract.mjs';
import {validateSettlementDistribution} from './settlement-distribution.mjs';
import {
  validateSettlementSizePolicy, validateSettlementApportionment,
  settlementSlotPopulation, settlementSlotPeoplePrefix, settlementClassFor, settlementStableUnit,
} from './settlement-size-model.mjs';
import {sitePopulationRegion, SETTLEMENT_CATALOGUE_METHOD} from './settlement-catalogue.mjs';

export * from './settlement-size-model.mjs';

/** A compact, saved, per-cell recipe for reading L2 settlement candidates out of
 * one L1 cell budget. It carries the L1 cell budget, the L0 population authority
 * identity, the parent cell, the world/climate/distribution/layer identity, the
 * geographic bounds and the saved size policy. It is candidate-budget-only: no
 * house, road, field or surveyed site is created or claimed here. */
export const L2_SETTLEMENT_HANDOFF_SCHEMA = 'l2-settlement-handoff@1';
export const L2_SETTLEMENT_HANDOFF_STATUS = 'candidate-budget-only';
export const L2_SETTLEMENT_PAGE_SCHEMA = 'l2-settlement-candidate-page@1';
export const L2_SETTLEMENT_SURVEY_SCHEMA = 'l2-settlement-survey@1';
export const L2_MAX_PAGE_SIZE = 256;
export const L2_DEFAULT_PAGE_SIZE = 64;

const BUDGET_KEYS = ['population', 'ruralPopulation', 'townPopulation', 'cityPopulation', 'villages', 'towns', 'cities'];
const PEOPLE_COUNTS = [['ruralPopulation', 'villages'], ['townPopulation', 'towns'], ['cityPopulation', 'cities']];
const GRID_MAX_CELLS = 1048576;
const MAX_BUDGET = 10000000000;

// Handoff identity follows the distribution convention: canonical key order via
// copyJson, so a versioned id survives object key normalisation.
const handoffHash = content => hashJson(copyJson(content));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function integer(value, name, max = MAX_BUDGET) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}
function gridOf(grid, name) {
  const columns = grid?.columns, rows = grid?.rows;
  if (!Number.isSafeInteger(columns) || columns < 1 || !Number.isSafeInteger(rows) || rows < 1) throw new RangeError(`Invalid ${name}`);
  const cells = columns * rows;
  if (!Number.isSafeInteger(cells) || cells > GRID_MAX_CELLS) throw new RangeError(`${name} exceeds the bounded cell budget`);
  return { columns, rows, cells };
}
/** Re-derive the target L1 cell's geographic parent and bounds from the grids,
 * so a saved handoff can be checked against its own geometry. */
function deriveL1Cell(columns, rows, parentColumns, parentRows, cellIndex) {
  if (columns % parentColumns !== 0 || rows % parentRows !== 0) throw new RangeError('L2 handoff parent grid must divide the L1 grid');
  const scaleX = columns / parentColumns, scaleY = rows / parentRows;
  if (scaleX !== scaleY || scaleX < 1 || (scaleX & (scaleX - 1)) !== 0) throw new RangeError('L2 handoff parent grid must be an equal power-of-two multiple');
  const row = Math.floor(cellIndex / columns), col = cellIndex % columns;
  return {
    scale: scaleX,
    parent: Math.floor(row / scaleX) * parentColumns + Math.floor(col / scaleX),
    bounds: { west: col * 360 / columns, east: (col + 1) * 360 / columns, north: 90 - row * 180 / rows, south: 90 - (row + 1) * 180 / rows },
  };
}
function sameJson(a, b) { return JSON.stringify(copyJson(a)) === JSON.stringify(copyJson(b)); }
function budgetShape(budget) {
  for (const [people, count] of PEOPLE_COUNTS) {
    if ((budget[people] === 0) !== (budget[count] === 0) || budget[count] > budget[people]) throw new RangeError('Inconsistent L2 handoff budget');
  }
  if (budget.ruralPopulation + budget.townPopulation + budget.cityPopulation !== budget.population) throw new RangeError('L2 handoff budget does not sum to its population');
}
function slotSeed(handoffId, kind) { return `${handoffId}|${kind}`; }
function zeroBudget() { return { population: 0, ruralPopulation: 0, townPopulation: 0, cityPopulation: 0, villages: 0, towns: 0, cities: 0 }; }
function addBudget(budget, kind, population) {
  budget.population += population;
  if (kind === 'city') { budget.cityPopulation += population; budget.cities += 1; }
  else if (kind === 'town') { budget.townPopulation += population; budget.towns += 1; }
  else { budget.ruralPopulation += population; budget.villages += 1; }
}
function subtractBudget(a, b) {
  const out = {};
  for (const key of BUDGET_KEYS) out[key] = a[key] - b[key];
  return out;
}
function farmlandCut(handoff, k) {
  const total = handoff.farmland.totalDemandM2, totalPeople = handoff.budget.population, budget = handoff.budget, policy = handoff.sizePolicy;
  if (!total || !totalPeople) return 0;
  let prefix = settlementSlotPeoplePrefix(policy, 'city', budget.cityPopulation, budget.cities, Math.min(k, budget.cities), slotSeed(handoff.id, 'city'));
  prefix += settlementSlotPeoplePrefix(policy, 'town', budget.townPopulation, budget.towns, clamp(k - budget.cities, 0, budget.towns), slotSeed(handoff.id, 'town'));
  prefix += settlementSlotPeoplePrefix(policy, 'village', budget.ruralPopulation, budget.villages, clamp(k - budget.cities - budget.towns, 0, budget.villages), slotSeed(handoff.id, 'village'));
  return Number(BigInt(total) * BigInt(prefix) / BigInt(totalPeople));
}
/** One shared stratification over all candidate slots (count = every slot of
 * every kind, rank = the global slot), so city, town and village origins do not
 * collapse onto the same point. No full slot array is ever built. */
function candidateOrigin(handoff, slot, total) {
  const b = handoff.bounds, lonSpan = b.east - b.west, middle = (b.north + b.south) / 2;
  const sinN = Math.sin(b.north * Math.PI / 180), sinS = Math.sin(b.south * Math.PI / 180);
  const aspect = Math.max(0.05, lonSpan / Math.max(1e-9, b.north - b.south) * Math.cos(middle * Math.PI / 180));
  const nx = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, total) * aspect))), ny = Math.max(1, Math.ceil(total / nx));
  const u = ((slot % nx) + 0.25 + 0.5 * settlementStableUnit(`${handoff.id}|coord|${slot}|u`)) / nx;
  const v = (Math.floor(slot / nx) + 0.25 + 0.5 * settlementStableUnit(`${handoff.id}|coord|${slot}|v`)) / ny;
  const latDeg = Math.asin(sinS + (sinN - sinS) * clamp(v, 0, 1)) * 180 / Math.PI;
  const lonDeg = ((b.west + clamp(u, 0, 1) * lonSpan + 180) % 360) - 180;
  return { latDeg, lonDeg };
}

/** Validate a saved handoff in isolation. A mismatched identity hash, an
 * out-of-range grid/parent mapping, a non-integer budget, an apportionment the
 * policy cannot realise, a farmland demand that does not re-derive from its own
 * budget, or a slot population that does not conserve its type budget is
 * rejected even when the content hash was recomputed by the caller. */
export function validateL2SettlementHandoff(handoff) {
  if (!handoff || typeof handoff !== 'object') throw new TypeError('L2 settlement handoff required');
  if (handoff.schema !== L2_SETTLEMENT_HANDOFF_SCHEMA) throw new RangeError('Unsupported L2 settlement handoff schema');
  if (handoff.status !== L2_SETTLEMENT_HANDOFF_STATUS) throw new RangeError('L2 settlement handoff must be candidate-budget-only');
  for (const key of ['sourceWorldId', 'populationId', 'climateId', 'distributionId', 'layerId']) {
    if (typeof handoff[key] !== 'string' || !handoff[key]) throw new RangeError(`L2 settlement handoff ${key} required`);
  }
  if (handoff.parentDistributionId !== undefined && (typeof handoff.parentDistributionId !== 'string' || !handoff.parentDistributionId)) {
    throw new RangeError('L2 settlement handoff parentDistributionId must be a non-empty string');
  }
  const { columns, rows, cells: n } = gridOf(handoff.grid, 'L2 handoff grid');
  const parentGrid = gridOf(handoff.parentGrid, 'L2 handoff parent grid');
  const cellIndex = integer(handoff.cellIndex, 'cellIndex', n - 1);
  const parentCell = integer(handoff.parentCell, 'parentCell', parentGrid.cells - 1);
  const derived = deriveL1Cell(columns, rows, parentGrid.columns, parentGrid.rows, cellIndex);
  if (parentCell !== derived.parent) throw new RangeError('L2 handoff parent cell does not match the geographic parent');
  const b = handoff.bounds;
  const e = derived.bounds;
  if (!b || b.west !== e.west || b.east !== e.east || b.south !== e.south || b.north !== e.north) {
    throw new RangeError('L2 handoff bounds do not match the target L1 cell');
  }
  const sizePolicy = validateSettlementSizePolicy(handoff.sizePolicy);
  const budget = handoff.budget;
  if (!budget || typeof budget !== 'object' || Object.getPrototypeOf(budget) !== Object.prototype) throw new RangeError('L2 handoff budget required');
  for (const key of BUDGET_KEYS) integer(budget[key], `budget '${key}'`);
  budgetShape(budget);
  validateSettlementApportionment(sizePolicy, 'village', budget.ruralPopulation, budget.villages);
  validateSettlementApportionment(sizePolicy, 'town', budget.townPopulation, budget.towns);
  validateSettlementApportionment(sizePolicy, 'city', budget.cityPopulation, budget.cities);
  const farmland = handoff.farmland;
  if (!farmland || typeof farmland !== 'object') throw new RangeError('L2 handoff farmland demand required');
  if (!Number.isFinite(farmland.yieldKgPerHa) || farmland.yieldKgPerHa < 0) throw new RangeError('Invalid L2 handoff farmland yield');
  if (!Number.isFinite(farmland.foodKgPerPersonYear) || farmland.foodKgPerPersonYear <= 0) throw new RangeError('Invalid L2 handoff food reference');
  integer(farmland.totalDemandM2, 'farmland totalDemandM2', Number.MAX_SAFE_INTEGER);
  const unresolved = budget.population > 0 && !(farmland.yieldKgPerHa > 0);
  if (farmland.unresolved !== unresolved) throw new RangeError('L2 handoff farmland unresolved flag contradicts its budget');
  // Zero population always needs zero farmland; only a positive population with a
  // non-positive yield keeps the explicit unresolved flag.
  const expectedDemand = (budget.population === 0 || unresolved) ? 0 : Math.round(budget.population * farmland.foodKgPerPersonYear / farmland.yieldKgPerHa * 10000);
  if (farmland.totalDemandM2 !== expectedDemand) throw new RangeError('L2 handoff farmland demand does not match its budget');
  for (const [kind, people, count] of [['city', budget.cityPopulation, budget.cities], ['town', budget.townPopulation, budget.towns], ['village', budget.ruralPopulation, budget.villages]]) {
    if (count === 0) continue;
    if (settlementSlotPeoplePrefix(sizePolicy, kind, people, count, count, slotSeed(handoff.id, kind)) !== people) {
      throw new Error('L2 handoff slot population does not conserve its type budget');
    }
  }
  const { id, ...content } = handoff;
  if (typeof id !== 'string' || id !== handoffHash(content)) throw new Error('L2 settlement handoff identity mismatch');
  return handoff;
}

/** Build the L2 handoff hypothesis for a single L1 cell. `l1` is the L1 broad
 * region (or the L1 distribution carrying a `parentCell` array). The inputs are
 * not modified. Only an L1 layer may be turned into a handoff. */
export function createL2SettlementHandoff(l1, population, cellIndex) {
  const region = l1 && l1.settlementDistribution ? l1 : null;
  const distribution = region ? region.settlementDistribution : l1;
  validateSettlementDistribution(distribution);
  if (distribution.layer !== 'L1') throw new RangeError('createL2SettlementHandoff requires an L1 settlement distribution');
  if (region) {
    const { snapshot, climate } = region;
    if (snapshot) {
      if (snapshot.worldId !== distribution.sourceWorldId) throw new RangeError('L2 handoff region world does not match its distribution');
      if (snapshot.layerId !== undefined && snapshot.layerId !== distribution.sourceLayerId) throw new RangeError('L2 handoff region layer does not match its distribution');
      if (snapshot.grid && (snapshot.grid.columns !== distribution.grid.columns || snapshot.grid.rows !== distribution.grid.rows)) throw new RangeError('L2 handoff region grid does not match its distribution');
    }
    if (climate) {
      if (climate.id !== distribution.climateId) throw new RangeError('L2 handoff region climate does not match its distribution');
      if (climate.sourceWorldId !== undefined && climate.sourceWorldId !== distribution.sourceWorldId) throw new RangeError('L2 handoff region climate world does not match its distribution');
    }
  }
  const parentCell = region ? region.parentCell : l1?.parentCell;
  const { columns, rows, cells: n } = gridOf(distribution.grid, 'L2 handoff grid');
  if (!Number.isSafeInteger(cellIndex) || cellIndex < 0 || cellIndex >= n) throw new RangeError('L2 handoff cell index out of range');
  if (!Array.isArray(parentCell) || parentCell.length !== n) throw new RangeError('L2 handoff requires an L1 parent-cell mapping');
  if (population?.sourceWorldId !== distribution.sourceWorldId || population?.id !== distribution.populationId) throw new RangeError('L2 handoff population authority mismatch');
  // Re-derive the population authority identity, so a tampered population that
  // merely kept the same id is rejected.
  const { id: populationId, ...populationContent } = population;
  if (typeof populationId !== 'string' || populationId !== hashJson(copyJson(populationContent))) throw new Error('L2 handoff population authority identity mismatch');
  const parentGrid = gridOf(population.grid, 'L2 handoff parent grid');
  const parent = parentCell[cellIndex];
  if (!Number.isSafeInteger(parent) || parent < 0 || parent >= parentGrid.cells) throw new RangeError('L2 handoff parent cell out of range');
  const derived = deriveL1Cell(columns, rows, parentGrid.columns, parentGrid.rows, cellIndex);
  if (parent !== derived.parent) throw new RangeError('L2 handoff parent-cell mapping does not match the geographic parent');
  if (region?.climate?.parentClimateId !== undefined) {
    if (typeof region.climate.parentClimateId !== 'string' || !region.climate.parentClimateId) throw new RangeError('L2 handoff region parent climate identity must be a non-empty string');
    if (population.climateId !== undefined && region.climate.parentClimateId !== population.climateId) throw new RangeError('L2 handoff region parent climate does not match the population authority');
  }
  const parentData = population.cells?.[parent];
  if (!parentData) throw new RangeError('L2 handoff requires the matching L0 population authority');
  if (!Number.isSafeInteger(parentData.cellIndex) || parentData.cellIndex !== parent) throw new RangeError('L2 handoff population authority cells are not index ordered');
  for (const key of ['cultivatedHa', 'netFoodKg']) {
    if (!Number.isFinite(parentData[key]) || parentData[key] < 0) throw new RangeError(`L2 handoff parent '${key}' must be finite and nonnegative`);
  }
  const sizePolicy = validateSettlementSizePolicy(population.sizePolicy);
  if (distribution.sizePolicy !== undefined && !sameJson(distribution.sizePolicy, sizePolicy)) throw new RangeError('L2 handoff distribution size policy disagrees with the population authority');
  const budget = {};
  for (const key of BUDGET_KEYS) {
    const value = distribution.fields[key][cellIndex];
    integer(value, `budget '${key}'`);
    budget[key] = value;
  }
  budgetShape(budget);
  validateSettlementApportionment(sizePolicy, 'village', budget.ruralPopulation, budget.villages);
  validateSettlementApportionment(sizePolicy, 'town', budget.townPopulation, budget.towns);
  validateSettlementApportionment(sizePolicy, 'city', budget.cityPopulation, budget.cities);
  const bounds = derived.bounds;
  const yieldKgPerHa = parentData.cultivatedHa > 0 ? parentData.netFoodKg / parentData.cultivatedHa : 0;
  const foodKgPerPersonYear = population.settings?.foodKgPerPersonYear;
  if (!Number.isFinite(foodKgPerPersonYear) || foodKgPerPersonYear <= 0) throw new RangeError('L2 handoff requires a positive food reference');
  const unresolved = budget.population > 0 && !(yieldKgPerHa > 0);
  const totalDemandM2 = (budget.population === 0 || unresolved) ? 0 : Math.round(budget.population * foodKgPerPersonYear / yieldKgPerHa * 10000);
  const content = {
    schema: L2_SETTLEMENT_HANDOFF_SCHEMA,
    status: L2_SETTLEMENT_HANDOFF_STATUS,
    sourceWorldId: distribution.sourceWorldId,
    populationId: distribution.populationId,
    climateId: distribution.climateId,
    distributionId: distribution.id,
    layerId: distribution.sourceLayerId,
    ...(distribution.parentDistributionId ? { parentDistributionId: distribution.parentDistributionId } : {}),
    grid: { columns, rows },
    parentGrid: { columns: parentGrid.columns, rows: parentGrid.rows },
    cellIndex,
    parentCell: parent,
    bounds,
    sizePolicy,
    ruralFractionTarget: population.settings?.ruralFraction ?? null,
    budget,
    farmland: {
      yieldKgPerHa,
      foodKgPerPersonYear,
      totalDemandM2,
      unresolved,
      scenario: 'netFoodKg per cultivatedHa from the saved L0 population authority, cut by foodKgPerPersonYear',
    },
    interpretation: 'Candidate settlement budget recipe for one L1 cell. Farmland area is a demand-only requirement, not secured land, and the candidate coordinates are unsurveyed strata.',
    assumptions: [
      'Candidate counts and populations come from the saved L1 cell budget and the saved sizePolicy',
      'Farmland demand uses the L0 parent netFoodKg/cultivatedHa scenario yield and foodKgPerPersonYear',
      'No house, road, field or surveyed site is created by this recipe',
    ],
    limitations: [
      'A positive population with a non-positive scenario yield is kept as an explicit unresolved farmland demand rather than hidden as zero',
      'The sizePolicy magnitude model is provisional and not a historical calibration',
      'This recipe is one cell; it does not create a global slot array or a new census',
    ],
  };
  const handoff = { ...content, id: handoffHash(content) };
  validateL2SettlementHandoff(handoff);
  return handoff;
}

/** Read at most 256 candidates in the fixed city -> town -> village slot order.
 * Each candidate's id, population and stratified equal-area coordinate depends
 * only on the handoff id and its own slot, never on a previous slot's random
 * consumption or the visitation order. Village populations under 100 people are
 * shown as hamlets. Nothing here is surveyed. */
export function readL2SettlementCandidatePage(handoff, { offset = 0, limit = L2_DEFAULT_PAGE_SIZE } = {}) {
  validateL2SettlementHandoff(handoff);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid L2 candidate page offset');
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid L2 candidate page limit');
  const size = Math.min(limit, L2_MAX_PAGE_SIZE);
  const budget = handoff.budget, total = budget.cities + budget.towns + budget.villages;
  const start = Math.min(offset, total), end = Math.min(total, start + size);
  const candidates = [];
  for (let slot = start; slot < end; slot++) {
    const kind = slot < budget.cities ? 'city' : slot < budget.cities + budget.towns ? 'town' : 'village';
    const rank = kind === 'city' ? slot : kind === 'town' ? slot - budget.cities : slot - budget.cities - budget.towns;
    const people = kind === 'city' ? budget.cityPopulation : kind === 'town' ? budget.townPopulation : budget.ruralPopulation;
    const count = kind === 'city' ? budget.cities : kind === 'town' ? budget.towns : budget.villages;
    const population = settlementSlotPopulation(handoff.sizePolicy, kind, people, count, rank, slotSeed(handoff.id, kind));
    const origin = candidateOrigin(handoff, slot, total);
    candidates.push({
      id: `${handoff.id}/slot:${slot}`,
      handoffId: handoff.id,
      cellIndex: handoff.cellIndex,
      slot,
      kind,
      settlementClass: settlementClassFor(kind, population),
      population,
      latDeg: origin.latDeg,
      lonDeg: origin.lonDeg,
      origin: { ...origin },
      status: 'unsurveyed-candidate',
      farmlandDemandM2: farmlandCut(handoff, slot + 1) - farmlandCut(handoff, slot),
    });
  }
  return {
    schema: L2_SETTLEMENT_PAGE_SCHEMA,
    handoffId: handoff.id,
    status: handoff.status,
    cellIndex: handoff.cellIndex,
    bounds: { ...handoff.bounds },
    offset: start,
    limit: end - start,
    total,
    unvisited: total - (end - start),
    candidates,
    farmlandDemandM2: farmlandCut(handoff, end) - farmlandCut(handoff, start),
    interpretation: 'Unsurveyed stratified candidate origins inside the saved bounds; no buildings, roads, fields or terrain claims are made.',
  };
}

/** Survey the candidate page through the existing population-region siting path.
 * Candidate population, id and origin match the page exactly. The seven budgets
 * are partitioned into requested, adopted, siting-unresolved and unvisited, and
 * the farmland demand is partitioned the same way, so each partition sums
 * exactly to the handoff budget and total demand. A survey failure never moves a
 * budget to another region. */
export function surveyL2SettlementCandidates(base, population, handoff, { offset = 0, limit = L2_DEFAULT_PAGE_SIZE, anchors = [], waterIndex = null } = {}) {
  const page = readL2SettlementCandidatePage(handoff, { offset, limit });
  if (!base || typeof base.sampleSurfaceAt !== 'function' || typeof base.groundElevationAt !== 'function') throw new TypeError('Surface sampling base required');
  if (base.worldId !== handoff.sourceWorldId) throw new Error('L2 survey geography mismatch');
  if (base.sourceLayerId !== undefined && base.sourceLayerId !== handoff.layerId) throw new Error('L2 survey layer mismatch');
  if (!population || population.id !== handoff.populationId || population.sourceWorldId !== handoff.sourceWorldId) throw new Error('L2 survey population mismatch');
  const surveyed = sitePopulationRegion(base, population, handoff.cellIndex, { candidates: page.candidates, anchors, waterIndex });
  const candidateById = new Map(page.candidates.map(candidate => [candidate.id, candidate]));
  const demandById = new Map(page.candidates.map(candidate => [candidate.id, candidate.farmlandDemandM2]));
  const requested = zeroBudget(), adopted = zeroBudget();
  let requestedFarmland = 0, adoptedFarmland = 0;
  for (const candidate of page.candidates) { addBudget(requested, candidate.kind, candidate.population); requestedFarmland += candidate.farmlandDemandM2; }
  for (const site of surveyed.sites) { addBudget(adopted, site.kind, site.population); adoptedFarmland += demandById.get(site.id) ?? 0; }
  const unresolved = subtractBudget(requested, adopted);
  const cellTotal = zeroBudget();
  for (const key of BUDGET_KEYS) cellTotal[key] = handoff.budget[key];
  const unvisited = subtractBudget(cellTotal, requested);
  for (const key of BUDGET_KEYS) {
    if (adopted[key] + unresolved[key] + unvisited[key] !== cellTotal[key]) throw new Error(`L2 survey did not conserve '${key}'`);
  }
  const totalFarmland = handoff.farmland.totalDemandM2;
  const unresolvedFarmland = requestedFarmland - adoptedFarmland, unvisitedFarmland = totalFarmland - requestedFarmland;
  if (adoptedFarmland + unresolvedFarmland + unvisitedFarmland !== totalFarmland) throw new Error('L2 survey farmland demand did not conserve');
  // A surveyed-and-rejected candidate is a siting-unresolved candidate, not an
  // unsurveyed one. Only budgets.unvisited marks slots that were never read.
  const unresolvedCandidates = surveyed.rejections.map(({ id, reason }) => ({ ...candidateById.get(id), status: 'siting-unresolved', reason }));
  return {
    schema: L2_SETTLEMENT_SURVEY_SCHEMA,
    handoffId: handoff.id,
    status: handoff.status,
    cellIndex: handoff.cellIndex,
    bounds: { ...handoff.bounds },
    page: { offset: page.offset, limit: page.limit, total: page.total },
    sites: surveyed.sites,
    unresolvedCandidates,
    rejected: surveyed.rejected,
    populations: surveyed.populations,
    budgets: { requested, adopted, unresolved, unvisited },
    farmlandDemandM2: { requested: requestedFarmland, adopted: adoptedFarmland, unresolved: unresolvedFarmland, unvisited: unvisitedFarmland, total: totalFarmland, unresolvedYield: handoff.farmland.unresolved },
    survey: { ...surveyed.survey, method: waterIndex ? waterIndex.method : SETTLEMENT_CATALOGUE_METHOD },
    sampling: { sourceLayerId: base.sourceLayerId ?? null, surfaceId: base.surfaceId ?? null, method: base.method ?? (waterIndex ? waterIndex.method : SETTLEMENT_CATALOGUE_METHOD), worldId: base.worldId },
    interpretation: 'Surveyed real sites are distinguished from siting-unresolved candidates and from unvisited slots. Survey failure leaves the budget explicitly unresolved and never moves it to another region.',
    limitations: [
      'No house, road or field geometry is generated; adopted sites still need a local layout',
      'Rejected candidates stay unresolved at their own origin, not proof that the surrounding land is unusable',
    ],
  };
}
