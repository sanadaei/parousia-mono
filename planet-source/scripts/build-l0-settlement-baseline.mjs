import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {auditL0} from './audit-l0.mjs';
import {createL0ResolutionSeries} from './experiments/l0-resolution-series.mjs';
import {createL1BroadRegion} from '../src/core/l1-broad-region.mjs';
import {validateSettlementDistribution} from '../src/core/settlement-distribution.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
import {renderSavedSettlementDistributionReview} from './build-settlement-distribution-review.mjs';

/** Reproducible L0 -> L1 settlement-distribution baseline for the GUI. It runs
 * the existing audit, resolution series and L1 broad-region stages in series,
 * then saves l0.json / l1.json / summary.json and checks that the seven integer
 * budgets survive L0 -> L1 and that the saved record stays inside the dedicated
 * 24 MiB L1 store. It never generates houses, village sites or roads, and never
 * writes examples/planet/generated, fixtures or the reference DEM. */
export const MAX_RECORD_BYTES = 24 * 1024 * 1024;
export const SETTLEMENT_BUDGETS = ['population', 'ruralPopulation', 'townPopulation', 'cityPopulation', 'villages', 'towns', 'cities'];
const BLOCKED_OUTPUT_PREFIXES = ['examples', 'fixtures', 'reference'];

export function parseBaselineArgs(argv) {
  const options = { seed: 'planet-1', population: 100000000, columns: 128, rows: 64, levels: 2, outputDir: 'reports/l0-settlement-baseline' };
  for (const arg of argv) {
    if (arg.startsWith('--seed=')) options.seed = arg.slice('--seed='.length);
    else if (arg.startsWith('--population=')) options.population = Number(arg.slice('--population='.length));
    else if (arg.startsWith('--columns=')) options.columns = Number(arg.slice('--columns='.length));
    else if (arg.startsWith('--rows=')) options.rows = Number(arg.slice('--rows='.length));
    else if (arg.startsWith('--levels=')) options.levels = Number(arg.slice('--levels='.length));
    else if (arg.startsWith('--')) throw new RangeError(`Unknown option ${arg}`);
    else options.outputDir = arg;
  }
  if (typeof options.seed !== 'string' || !options.seed.trim()) throw new RangeError('--seed must be a non-empty string');
  if (!Number.isSafeInteger(options.population) || options.population < 0 || options.population > 10000000000) throw new RangeError('--population must be a non-negative integer up to 10 billion');
  if (!Number.isSafeInteger(options.columns) || options.columns < 16) throw new RangeError('--columns must be an integer of at least 16');
  if (!Number.isSafeInteger(options.rows) || options.rows < 8) throw new RangeError('--rows must be an integer of at least 8');
  if (!Number.isSafeInteger(options.levels) || options.levels < 1 || options.levels > 5) throw new RangeError('--levels must be an integer from 1 to 5');
  if (options.columns * options.rows > 32768) throw new RangeError('--columns x --rows must be at most 32768 for the population authority');
  if (options.columns * options.rows * 4 ** (options.levels - 1) > 131072) throw new RangeError('resolution series exceeds the bounded 131072-cell planning budget');
  const resolved = path.resolve(options.outputDir);
  const blocked = BLOCKED_OUTPUT_PREFIXES.some(prefix => resolved.split(path.sep).includes(prefix));
  if (blocked) throw new RangeError('Refusing to write a baseline into a distributed examples/fixtures/reference directory');
  return { ...options, outputDir: resolved };
}

export function buildL0SettlementBaseline({ seed, targetPopulation, columns, rows, levels, beforeLevel = () => requireVerificationMemory() }) {
  const l0 = auditL0(seed, { columns, rows, targetPopulation });
  validateSettlementDistribution(l0.settlementDistribution);
  const series = createL0ResolutionSeries(l0.snapshot, { levels, beforeLevel });
  const level = series.cases[levels - 1];
  const l1 = createL1BroadRegion(l0, level);
  if (!l1.settlementDistribution) throw new Error('L1 settlement distribution was not generated');
  validateSettlementDistribution(l1.settlementDistribution);
  for (const key of SETTLEMENT_BUDGETS) {
    const conserved = l1.settlementDistribution.totals[key] + l1.settlementDistribution.unallocated.totals[key];
    if (conserved !== l0.settlementDistribution.totals[key]) throw new Error(`L0 to L1 settlement budget did not conserve ${key}`);
  }
  const l0Bytes = Buffer.byteLength(JSON.stringify(l0));
  const l1Bytes = Buffer.byteLength(JSON.stringify(l1));
  if (l1Bytes > MAX_RECORD_BYTES) throw new RangeError('L1 settlement record exceeds the 24 MiB budget');
  const summary = {
    schema: 'l0-settlement-baseline@1',
    seed, columns, rows, levels,
    l0: {
      worldId: l0.snapshot.worldId, climateId: l0.climate.id, populationId: l0.population.id,
      settlementDistributionId: l0.settlementDistribution.id,
      requestedPopulation: l0.summary.requestedPopulation, supportedPopulation: l0.summary.supportedPopulation,
      unplacedPopulation: l0.summary.unplacedPopulation,
      villages: l0.summary.villages, towns: l0.summary.towns, cities: l0.summary.cities, populatedCells: l0.summary.populatedCells,
    },
    l1: {
      id: l1.id, grid: l1.snapshot.grid, resolutionId: l1.resolutionId,
      settlementDistributionId: l1.settlementDistribution.id,
      populatedCells: l1.settlementDistribution.totals.populatedCells,
      villages: l1.settlementDistribution.totals.villages, towns: l1.settlementDistribution.totals.towns, cities: l1.settlementDistribution.totals.cities,
      unallocatedPopulation: l1.settlementDistribution.unallocated.totals.population,
      unallocatedParents: l1.settlementDistribution.unallocated.parentCells.length,
      relativeBudgetResidual: l1.diagnostics.relativeBudgetResidual,
    },
    sizes: { l0Bytes, l1Bytes, l1LimitBytes: MAX_RECORD_BYTES, withinLimit: l1Bytes <= MAX_RECORD_BYTES },
    checks: { l0Validated: true, l1Validated: true, budgetsConserved: true, withinLimit: l1Bytes <= MAX_RECORD_BYTES },
    interpretation: 'Distribution-only L0/L1 settlement budgets for the GUI. Site selection and roads remain unresolved.',
    limitations: [
      'Suitability is a relative placement weight, not a certified local food capacity',
      'Unallocated parents keep their budgets explicitly instead of moving them to another parent',
      'No houses, village sites, fields or roads are generated by this baseline',
    ],
  };
  return { l0, l1, summary };
}

export function saveBaseline(result, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const files = { l0: path.join(directory, 'l0.json'), l1: path.join(directory, 'l1.json'), summary: path.join(directory, 'summary.json') };
  fs.writeFileSync(files.l0, JSON.stringify(result.l0));
  fs.writeFileSync(files.l1, JSON.stringify(result.l1));
  fs.writeFileSync(files.summary, JSON.stringify(result.summary, null, 2));
  const l0 = JSON.parse(fs.readFileSync(files.l0, 'utf8'));
  const l1 = JSON.parse(fs.readFileSync(files.l1, 'utf8'));
  assert.deepEqual(l0, JSON.parse(JSON.stringify(result.l0)), 'l0.json did not reload identically');
  assert.deepEqual(l1, JSON.parse(JSON.stringify(result.l1)), 'l1.json did not reload identically');
  validateSettlementDistribution(l1.settlementDistribution);
  const sizes = { l0Bytes: fs.statSync(files.l0).size, l1Bytes: fs.statSync(files.l1).size, summaryBytes: fs.statSync(files.summary).size };
  if (sizes.l1Bytes > MAX_RECORD_BYTES) throw new RangeError('Saved L1 settlement record exceeds the 24 MiB budget');
  return { files, sizes, reloadedIdentical: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireVerificationMemory();
  const options = parseBaselineArgs(process.argv.slice(2));
  const result = buildL0SettlementBaseline({ seed: options.seed, targetPopulation: options.population, columns: options.columns, rows: options.rows, levels: options.levels });
  const saved = saveBaseline(result, options.outputDir);
  saved.files.review = renderSavedSettlementDistributionReview(options.outputDir);
  console.log(JSON.stringify({ ...result.summary, saved }, null, 2));
}
