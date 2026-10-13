import {copyJson, hashJson} from './json-contract.mjs';
import {validateSettlementSizePolicy, validateSettlementApportionment} from './settlement-size-model.mjs';

// Planet saves canonicalize object key order. Distribution identity must survive
// that serialization, while retaining exact array order and numerical budgets.
const distributionHash = content => hashJson(copyJson(content));

/** A distribution-only settlement budget. It carries the authoritative census
 * (or a refined allocation of it) as compact column arrays: population totals,
 * rural/town/city people and counts, a wet mask and a relative suitability
 * weight. No individual house, village site or road is placed here.
 *
 * This is the L0 -> L1 half of the deferred materialization contract: the
 * parent's seven integer budgets are conserved exactly when they are passed to
 * children, and any parent budget whose children have no habitable land is kept
 * as an explicit `unallocated` record instead of being dropped or moved. */
export const SETTLEMENT_DISTRIBUTION_SCHEMA = 'settlement-distribution@1';
export const SETTLEMENT_DISTRIBUTION_STATUS = 'distribution-only';
export const SUITABILITY_SCALE = 1000000;
const MAX_CELLS = 1048576;
const MAX_PEOPLE = 10000000000;
const LAYERS = ['L0', 'L1'];
const BUDGETS = ['population', 'ruralPopulation', 'townPopulation', 'cityPopulation', 'villages', 'towns', 'cities'];
const PEOPLE_COUNTS = [['ruralPopulation', 'villages'], ['townPopulation', 'towns'], ['cityPopulation', 'cities']];

const clamp01 = v => Math.max(0, Math.min(1, v));
function integer(value, name = 'budget', max = MAX_PEOPLE) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}
function positiveDimension(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid ${name}`);
  return value;
}
function gridOf(grid, name) {
  const columns = positiveDimension(grid?.columns, `${name} columns`);
  const rows = positiveDimension(grid?.rows, `${name} rows`);
  const cells = columns * rows;
  if (!Number.isSafeInteger(cells) || cells > MAX_CELLS) throw new RangeError(`${name} exceeds the bounded cell budget`);
  return { columns, rows, cells };
}
function sumField(field, n) { let s = 0; for (let i = 0; i < n; i++) s += field[i]; return s; }
function totalsFor(fields, n) {
  const totals = {};
  for (const key of BUDGETS) totals[key] = sumField(fields[key], n);
  let populatedCells = 0;
  for (let i = 0; i < n; i++) if (fields.population[i] > 0) populatedCells++;
  return { ...totals, populatedCells };
}

/** Exact largest-remainder integer apportionment. `total` is a safe integer;
 * weights are non-negative BigInt so that area (metres squared) and a quantised
 * suitability cannot lose precision or drift independently. */
export function allocateIntegerBudget(total, weights) {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('Invalid allocation total');
  if (!Array.isArray(weights)) throw new TypeError('Allocation weights required');
  let sum = 0n;
  for (const weight of weights) { if (typeof weight !== 'bigint' || weight < 0n) throw new RangeError('Invalid allocation weight'); sum += weight; }
  if (sum === 0n || total === 0) return weights.map(() => 0);
  const terms = weights.map((weight, i) => { const v = BigInt(total) * weight; return { i, n: Number(v / sum), r: v % sum }; });
  let left = total - terms.reduce((s, t) => s + t.n, 0);
  for (const t of [...terms].sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))) { if (!left) break; t.n++; left--; }
  return terms.map(t => t.n);
}

function requireIdentity(distribution) {
  for (const key of ['sourceWorldId', 'populationId', 'climateId', 'sourceLayerId']) {
    if (typeof distribution[key] !== 'string' || !distribution[key]) throw new RangeError(`Settlement distribution ${key} required`);
  }
}

function validateFields(fields, n, { label = 'Settlement distribution' } = {}) {
  const required = [...BUDGETS, 'wet', 'suitability'];
  for (const key of required) {
    if (!Array.isArray(fields?.[key]) || fields[key].length !== n) throw new RangeError(`${label} field '${key}' must match the grid`);
  }
  for (let i = 0; i < n; i++) {
    const population = integer(fields.population[i], 'population');
    let sum = 0;
    for (const [people, count] of PEOPLE_COUNTS) {
      const p = integer(fields[people][i], people), c = integer(fields[count][i], count);
      if ((p === 0) !== (c === 0) || c > p) throw new RangeError('Inconsistent settlement budget');
      sum += p;
    }
    if (sum !== population) throw new RangeError('Cell population does not match its parts');
    const wet = fields.wet[i];
    if (wet !== 0 && wet !== 1) throw new RangeError('Wet mask must be 0 or 1');
    if (wet && population !== 0) throw new RangeError('Sea or lake cells cannot receive a settlement budget');
    integer(fields.suitability[i], 'suitability', SUITABILITY_SCALE);
  }
}

function validateTotals(totals, recomputed, n) {
  if (!totals || typeof totals !== 'object') throw new RangeError('Settlement distribution totals required');
  for (const key of BUDGETS) {
    integer(totals[key], `total '${key}'`);
    if (totals[key] !== recomputed[key]) throw new RangeError(`Settlement distribution total '${key}' does not match its cells`);
  }
  integer(totals.populatedCells, 'total populatedCells', n);
  if (totals.populatedCells !== recomputed.populatedCells) throw new RangeError("Settlement distribution total 'populatedCells' does not match its cells");
}

/** Summary populations are declared aggregates, so they are re-derived from the
 * actual cells rather than trusted. A re-hashed record with a plausible but
 * inconsistent summary is rejected exactly like an inconsistent total. */
function validateSummary(summary, { layer, fieldsTotals, unallocatedTotals, n }) {
  if (!summary || typeof summary !== 'object') throw new RangeError('Settlement distribution summary required');
  const requested = integer(summary.requestedPopulation, 'requestedPopulation');
  const supported = integer(summary.supportedPopulation, 'supportedPopulation');
  const unplaced = integer(summary.unplacedPopulation, 'unplacedPopulation');
  if (requested !== supported + unplaced) throw new RangeError('Settlement distribution summary population does not balance');
  const expectedSupported = layer === 'L1' ? fieldsTotals.population + unallocatedTotals.population : fieldsTotals.population;
  if (supported !== expectedSupported) throw new RangeError('Settlement distribution summary supported population does not match its cells');
  for (const key of ['villages', 'towns', 'cities']) {
    if (integer(summary[key], key) !== fieldsTotals[key]) throw new RangeError(`Settlement distribution summary '${key}' does not match allocated cells`);
  }
  if (integer(summary.populatedCells, 'summary populatedCells', n) !== fieldsTotals.populatedCells) throw new RangeError('Settlement distribution summary populated cells do not match allocated cells');
  if (layer === 'L1') {
    if (integer(summary.unallocatedPopulation, 'unallocatedPopulation') !== unallocatedTotals.population) throw new RangeError('Settlement distribution summary unallocated population does not match unallocated cells');
  }
}

/** Validate a saved distribution in isolation. Rejects a tampered content hash,
 * an inconsistent people/count split, an allocation to sea or lake, a
 * distribution that does not carry the declared grid, and any declared
 * total/summary that does not re-derive from the actual cells. */
export function validateSettlementDistribution(distribution) {
  if (!distribution || typeof distribution !== 'object') throw new TypeError('Settlement distribution required');
  if (distribution.schema !== SETTLEMENT_DISTRIBUTION_SCHEMA) throw new RangeError('Unsupported settlement distribution schema');
  if (distribution.status !== SETTLEMENT_DISTRIBUTION_STATUS) throw new RangeError('Settlement distribution must be distribution-only');
  if (!LAYERS.includes(distribution.layer)) throw new RangeError('Settlement distribution layer must be L0 or L1');
  requireIdentity(distribution);
  if (distribution.layer === 'L1' && (typeof distribution.parentDistributionId !== 'string' || !distribution.parentDistributionId)) throw new RangeError('L1 settlement distribution requires a parent distribution id');
  if (distribution.suitabilityScale !== SUITABILITY_SCALE) throw new RangeError('Unsupported settlement distribution suitability scale');
  // A distribution that carries a size policy must also have that policy's own
  // bounds re-derived, so a re-hashed contradictory policy is rejected here.
  const policy = distribution.sizePolicy !== undefined ? validateSettlementSizePolicy(distribution.sizePolicy) : null;
  const { cells } = gridOf(distribution.grid, 'Settlement distribution grid');
  validateFields(distribution.fields, cells);
  if (policy) {
    for (let i = 0; i < cells; i++) {
      validateSettlementApportionment(policy, 'village', distribution.fields.ruralPopulation[i], distribution.fields.villages[i]);
      validateSettlementApportionment(policy, 'town', distribution.fields.townPopulation[i], distribution.fields.towns[i]);
      validateSettlementApportionment(policy, 'city', distribution.fields.cityPopulation[i], distribution.fields.cities[i]);
    }
  }
  const fieldsTotals = totalsFor(distribution.fields, cells);
  validateTotals(distribution.totals, fieldsTotals, cells);
  let unallocatedTotals = null;
  if (distribution.layer === 'L1') {
    const unallocated = distribution.unallocated;
    if (!unallocated || typeof unallocated !== 'object') throw new RangeError('L1 settlement distribution requires unallocated budgets');
    if (!Array.isArray(unallocated.parentCells)) throw new RangeError('Unallocated parent cells must be an array');
    const { cells: parentN } = gridOf(unallocated.parentGrid, 'Unallocated parent grid');
    const n = unallocated.parentCells.length;
    for (const key of BUDGETS) if (!Array.isArray(unallocated[key]) || unallocated[key].length !== n) throw new RangeError(`Unallocated field '${key}' must match the parent cells`);
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const parentCell = unallocated.parentCells[i];
      if (!Number.isSafeInteger(parentCell) || parentCell < 0 || parentCell >= parentN || seen.has(parentCell)) throw new RangeError('Unallocated parent cell out of range or duplicated');
      seen.add(parentCell);
      let sum = 0;
      for (const [people, count] of PEOPLE_COUNTS) {
        const p = integer(unallocated[people][i], people), c = integer(unallocated[count][i], count);
        if ((p === 0) !== (c === 0) || c > p) throw new RangeError('Inconsistent unallocated settlement budget');
        sum += p;
      }
      if (sum !== integer(unallocated.population[i], 'unallocated population')) throw new RangeError('Unallocated population does not match its parts');
      if (policy) {
        validateSettlementApportionment(policy, 'village', unallocated.ruralPopulation[i], unallocated.villages[i]);
        validateSettlementApportionment(policy, 'town', unallocated.townPopulation[i], unallocated.towns[i]);
        validateSettlementApportionment(policy, 'city', unallocated.cityPopulation[i], unallocated.cities[i]);
      }
    }
    unallocatedTotals = totalsFor(unallocated, n);
    const declared = unallocated.totals;
    if (!declared || typeof declared !== 'object') throw new RangeError('L1 settlement distribution requires unallocated totals');
    for (const key of BUDGETS) {
      integer(declared[key], `unallocated total '${key}'`);
      if (declared[key] !== unallocatedTotals[key]) throw new RangeError(`Unallocated total '${key}' does not match its cells`);
    }
    integer(declared.populatedCells, 'unallocated populatedCells', n);
    if (declared.populatedCells !== unallocatedTotals.populatedCells) throw new RangeError("Unallocated total 'populatedCells' does not match its cells");
    if (!Number.isSafeInteger(declared.parentCells) || declared.parentCells !== n) throw new RangeError("Unallocated total 'parentCells' does not match the record");
  } else if (distribution.unallocated !== undefined) {
    throw new RangeError('L0 settlement distribution must not declare unallocated budgets');
  }
  validateSummary(distribution.summary, { layer: distribution.layer, fieldsTotals, unallocatedTotals, n: cells });
  const { id, ...content } = distribution;
  if (typeof id !== 'string' || id !== distributionHash(content)) throw new Error('Settlement distribution identity mismatch');
  return distribution;
}

/** A contradictory authority would silently become a second census, so its
 * declared totals are checked against the actual allocated cells. */
function validateAuthorityTotals(population, fields, n) {
  const totals = population?.totals;
  if (!totals || typeof totals !== 'object') throw new RangeError('Population authority totals required');
  const target = integer(totals.targetPopulation, 'targetPopulation');
  const supported = integer(totals.supportedPopulation, 'supportedPopulation');
  const unplaced = integer(totals.unplacedPopulation, 'unplacedPopulation');
  if (target !== supported + unplaced) throw new RangeError('Population authority totals do not balance');
  if (supported !== totalsFor(fields, n).population) throw new RangeError('Population authority supported population does not match its cells');
}

/** L0 creation reuses the existing agricultural population authority as the one
 * census. It does not recompute people, trade, irrigation or history. */
export function createL0SettlementDistribution(snapshot, climate, population) {
  const { columns, rows, cells: n } = gridOf(snapshot?.grid, 'L0 settlement grid');
  if (typeof snapshot?.worldId !== 'string' || !snapshot.worldId) throw new RangeError('L0 settlement distribution requires a world id');
  if (population?.sourceWorldId !== snapshot.worldId || population?.grid?.columns !== columns || population?.grid?.rows !== rows) {
    throw new RangeError('L0 settlement distribution requires the matching population authority');
  }
  if (typeof population.id !== 'string' || !population.id) throw new RangeError('Population authority id required');
  if (climate?.sourceWorldId !== snapshot.worldId || climate?.id !== population.climateId || climate?.grid?.columns !== columns || climate?.grid?.rows !== rows) {
    throw new RangeError('L0 settlement distribution requires the matching climate');
  }
  if (!Array.isArray(population.cells) || population.cells.length !== n) throw new RangeError('Population authority cells must match the L0 grid');
  // The canonical size policy lives at population.sizePolicy; @2 authorities must
  // carry it. settings only keeps the original input values.
  if (population.schema === 'agriculture-population@2' && population.sizePolicy === undefined) throw new RangeError('Population authority @2 requires a size policy');
  const sizePolicy = population.sizePolicy !== undefined ? validateSettlementSizePolicy(population.sizePolicy) : null;
  const land = snapshot.fields?.landMask, lake = snapshot.fields?.lakeFillDepthM;
  if (!Array.isArray(land) || land.length !== n) throw new RangeError('L0 land mask required');
  const fields = { population: [], ruralPopulation: [], townPopulation: [], cityPopulation: [], villages: [], towns: [], cities: [], wet: [], suitability: [] };
  for (let i = 0; i < n; i++) {
    const cell = population.cells[i];
    if (!cell || cell.cellIndex !== i) throw new RangeError('Population authority cells must be index ordered');
    for (const key of BUDGETS) fields[key].push(cell[key] ?? 0);
    fields.wet.push((!land[i] || (lake?.[i] ?? 0) > 0) ? 1 : 0);
    fields.suitability.push(Math.round(clamp01(cell.suitability ?? 0) * SUITABILITY_SCALE));
  }
  validateAuthorityTotals(population, fields, n);
  const totals = totalsFor(fields, n);
  const summary = {
    layer: 'L0',
    requestedPopulation: population.totals.targetPopulation,
    supportedPopulation: population.totals.supportedPopulation,
    unplacedPopulation: population.totals.unplacedPopulation,
    populatedCells: totals.populatedCells,
    villages: totals.villages, towns: totals.towns, cities: totals.cities,
    allocation: 'inherited population authority; no independent census',
  };
  const content = {
    schema: SETTLEMENT_DISTRIBUTION_SCHEMA,
    layer: 'L0',
    sourceWorldId: snapshot.worldId,
    populationId: population.id,
    climateId: climate.id,
    sourceLayerId: snapshot.layerId ?? snapshot.worldId,
    grid: { columns, rows },
    status: SETTLEMENT_DISTRIBUTION_STATUS,
    suitabilityScale: SUITABILITY_SCALE,
    ...(sizePolicy ? { sizePolicy } : {}),
    fields, totals, summary,
    interpretation: 'Aggregate settlement budget per L0 cell. Locations, roads, fields and buildings remain unresolved.',
    assumptions: [
      'People and settlement counts come from the existing agricultural population authority, not a second census',
      'Suitability is a relative placement weight from the saved L0 climate and relief, not a measured food capacity',
      'Settlement counts still depend on assumed mean size; no urban hierarchy is simulated',
    ],
    limitations: [
      'Sea and lake cells carry zero population and zero settlements',
      'A cell budget is not a list of instantiated villages, towns or cities',
      'No trade, irrigation, fisheries, migration or political boundaries',
    ],
  };
  const distribution = { ...content, id: distributionHash(content) };
  validateSettlementDistribution(distribution);
  return distribution;
}

/** Read-only aggregation of a saved distribution over selected cells. */
export function describeSettlementDistribution(distribution, cellIndices) {
  validateSettlementDistribution(distribution);
  const { cells: n } = gridOf(distribution.grid, 'Settlement distribution grid');
  if (!Array.isArray(cellIndices) || !cellIndices.length || cellIndices.length > n
    || new Set(cellIndices).size !== cellIndices.length
    || cellIndices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= n)) {
    throw new RangeError('Settlement distribution description requires unique in-range cells');
  }
  const cells = [...cellIndices].sort((a, b) => a - b);
  const pick = key => cells.reduce((s, i) => s + distribution.fields[key][i], 0);
  return {
    schema: 'settlement-distribution-description@1',
    layer: distribution.layer,
    sourceWorldId: distribution.sourceWorldId,
    populationId: distribution.populationId,
    climateId: distribution.climateId,
    grid: { ...distribution.grid },
    cellIndices: cells,
    budgets: {
      population: pick('population'),
      ruralPopulation: pick('ruralPopulation'),
      townPopulation: pick('townPopulation'),
      cityPopulation: pick('cityPopulation'),
      villages: pick('villages'),
      towns: pick('towns'),
      cities: pick('cities'),
    },
    populatedCells: cells.filter(i => distribution.fields.population[i] > 0).length,
    interpretation: distribution.interpretation,
    assumptions: [...distribution.assumptions],
  };
}

/** Refine a saved distribution onto a finer grid. Each parent cell's children
 * are allocated together from the L1 cell area and a relative suitability, so
 * that no child rounding can steal another child's budget. A parent whose
 * children are all water or all unsuitable keeps its seven budgets as an
 * explicit `unallocated` record: parent = children + unallocated for every one
 * of the seven fields. No settlement site, road or building is placed. */
export function refineSettlementDistribution(distribution, {
  sourceWorldId, climateId, sourceLayerId, grid, parentCell, cellAreaM2, landMask, lakeFillDepthM, suitability,
} = {}) {
  validateSettlementDistribution(distribution);
  if (distribution.layer !== 'L0') throw new RangeError('refineSettlementDistribution currently refines only an L0 parent distribution');
  const { columns: parentColumns, rows: parentRows, cells: parentN } = gridOf(distribution.grid, 'Parent settlement grid');
  if (sourceWorldId !== distribution.sourceWorldId) throw new RangeError('Refined settlement distribution world mismatch');
  if (typeof climateId !== 'string' || !climateId) throw new RangeError('Refined settlement distribution climate identity required');
  if (typeof sourceLayerId !== 'string' || !sourceLayerId) throw new RangeError('Refined settlement distribution source layer identity required');
  const { columns, rows, cells: n } = gridOf(grid, 'Refined settlement grid');
  for (const [key, array] of Object.entries({ parentCell, cellAreaM2, landMask, lakeFillDepthM })) {
    if (!Array.isArray(array) || array.length !== n) throw new RangeError(`Refined settlement distribution '${key}' must match the child grid`);
  }
  if (parentCell.some(p => !Number.isSafeInteger(p) || p < 0 || p >= parentN)) throw new RangeError('Refined settlement parent cell out of range');
  if (cellAreaM2.some(a => !Number.isFinite(a) || a <= 0)) throw new RangeError('Refined settlement cell area must be positive and finite');
  if (landMask.some(v => v !== 0 && v !== 1)) throw new RangeError('Refined settlement land mask must be 0 or 1');
  if (lakeFillDepthM.some(v => !Number.isFinite(v) || v < 0)) throw new RangeError('Refined settlement lake depth must be finite and non-negative');
  if (suitability !== undefined && (!Array.isArray(suitability) || suitability.length !== n || suitability.some(v => !Number.isFinite(v)))) {
    throw new RangeError('Refined settlement suitability must match the child grid');
  }
  const suitInt = new Array(n);
  for (let i = 0; i < n; i++) {
    suitInt[i] = suitability === undefined
      ? distribution.fields.suitability[parentCell[i]]
      : Math.round(clamp01(suitability[i]) * SUITABILITY_SCALE);
  }
  const childrenByParent = new Map();
  for (let i = 0; i < n; i++) { const p = parentCell[i]; if (!childrenByParent.has(p)) childrenByParent.set(p, []); childrenByParent.get(p).push(i); }
  const fields = { population: new Array(n).fill(0), ruralPopulation: new Array(n).fill(0), townPopulation: new Array(n).fill(0), cityPopulation: new Array(n).fill(0), villages: new Array(n).fill(0), towns: new Array(n).fill(0), cities: new Array(n).fill(0), wet: new Array(n).fill(0), suitability: new Array(n).fill(0) };
  for (let i = 0; i < n; i++) {
    fields.wet[i] = (!landMask[i] || lakeFillDepthM[i] > 0) ? 1 : 0;
    fields.suitability[i] = fields.wet[i] ? 0 : suitInt[i];
  }
  const unallocated = { parentGrid: { columns: parentColumns, rows: parentRows }, parentCells: [], population: [], ruralPopulation: [], townPopulation: [], cityPopulation: [], villages: [], towns: [], cities: [], totals: {} };
  for (let p = 0; p < parentN; p++) {
    const parentPopulation = distribution.fields.population[p];
    const kids = childrenByParent.get(p) ?? [];
    const weights = kids.map(k => {
      const suitable = landMask[k] === 1 && !(lakeFillDepthM[k] > 0);
      return suitable ? BigInt(Math.round(cellAreaM2[k])) * BigInt(suitInt[k]) : 0n;
    });
    const totalWeight = weights.reduce((s, w) => s + w, 0n);
    if (parentPopulation === 0 && !kids.length) continue;
    if (!kids.length || totalWeight === 0n) {
      if (parentPopulation > 0 || BUDGETS.some(key => key !== 'population' && distribution.fields[key][p] > 0)) {
        unallocated.parentCells.push(p);
        for (const key of BUDGETS) unallocated[key].push(distribution.fields[key][p]);
      }
      continue;
    }
    for (const [people, count] of PEOPLE_COUNTS) {
      const totalPeople = distribution.fields[people][p], totalCount = distribution.fields[count][p];
      const counts = allocateIntegerBudget(totalCount, weights);
      if (totalCount === 0) { kids.forEach((k, i) => { fields[count][k] = 0; fields[people][k] = 0; }); continue; }
      // First distribute the settlement counts by area and suitability. The
      // matching people are then the parent's floor(people/count) base plus the
      // remainder spread over a contiguous run of settlements. People are not
      // independently redistributed by area weight, so a town's mean size is not
      // distorted; parent = children + unallocated still holds for all seven
      // budgets. This global apportionment is deliberately not generalised to
      // L1 -> L2.
      const small = Math.floor(totalPeople / totalCount), extra = totalPeople % totalCount;
      let offset = 0;
      kids.forEach((k, i) => { const n = counts[i]; fields[count][k] = n; fields[people][k] = n > 0 ? small * n + Math.max(0, Math.min(n, extra - offset)) : 0; offset += n; });
    }
    kids.forEach(k => { fields.population[k] = fields.ruralPopulation[k] + fields.townPopulation[k] + fields.cityPopulation[k]; });
  }
  const totals = totalsFor(fields, n);
  const unallocatedTotals = { ...totalsFor(unallocated, unallocated.parentCells.length), parentCells: unallocated.parentCells.length };
  unallocated.totals = unallocatedTotals;
  for (const key of BUDGETS) {
    if (totals[key] + unallocatedTotals[key] !== distribution.totals[key]) throw new Error(`Refinement did not conserve ${key}`);
  }
  const summary = {
    layer: 'L1',
    requestedPopulation: distribution.summary.requestedPopulation,
    supportedPopulation: distribution.summary.supportedPopulation,
    unplacedPopulation: distribution.summary.unplacedPopulation,
    unallocatedPopulation: unallocatedTotals.population,
    populatedCells: totals.populatedCells,
    villages: totals.villages, towns: totals.towns, cities: totals.cities,
    allocation: 'area-and-suitability weighted largest-remainder within each parent cell',
  };
  const content = {
    schema: SETTLEMENT_DISTRIBUTION_SCHEMA,
    layer: 'L1',
    sourceWorldId, populationId: distribution.populationId, climateId, sourceLayerId,
    parentDistributionId: distribution.id,
    grid: { columns, rows },
    status: SETTLEMENT_DISTRIBUTION_STATUS,
    suitabilityScale: SUITABILITY_SCALE,
    ...(distribution.sizePolicy ? { sizePolicy: distribution.sizePolicy } : {}),
    fields, unallocated, totals, summary,
    interpretation: 'Refined aggregate settlement budget per L1 cell. Coarse suitability is a relative weight, not a certified local food capacity. No site, road or building is fixed yet.',
    assumptions: [
      'Parent = allocated children + explicit unallocated for every one of the seven budgets',
      'Child area is the actual L1 cell area; suitability is projected from the parent distribution unless overridden',
      'A child may only receive a population type when it also receives a settlement count of that type',
      'People are the parent floor(people/count) base plus a contiguous remainder run, never an independent area-weighted redistribution',
    ],
    limitations: [
      'Sea and lake cells carry zero population and zero settlements',
      'Unallocated parents have no habitable L1 land in this refinement; they are not silently zeroed or moved',
      'Exact town and city sites and roads remain unresolved',
    ],
  };
  const refined = { ...content, id: distributionHash(content) };
  validateSettlementDistribution(refined);
  return refined;
}

export { BUDGETS as SETTLEMENT_DISTRIBUTION_BUDGETS };
