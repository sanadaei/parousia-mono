import {createHash} from './sha256.mjs';

/** Explicit, saved settlement magnitude assumptions. These are named policy
 * bounds for a provisional size-variation model, not a historical calibration,
 * a trade model or a finished natural urban hierarchy.
 *
 * A town is at least a quarter of its mean and a city at least half of its mean;
 * every type is capped at 1.5x its mean. Custom means are converted to these
 * integer boundaries, and abnormal (non-integer or extreme) means are rejected. */
export const SETTLEMENT_SIZE_POLICY_SCHEMA = 'settlement-size-policy@1';
export const HAMLET_MAX_POPULATION = 100;
const MAX_MEAN = 100000000;
const DEFAULT_JITTER_PERIOD = 16;
const MAX_JITTER_PERIOD = 32;
export const SETTLEMENT_KINDS = ['city', 'town', 'village'];

function meanValue(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MEAN) throw new RangeError(`Invalid ${name}`);
  return value;
}
function periodValue(value, name, max = MAX_JITTER_PERIOD) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}
function amplitudeFraction(value) {
  if (!Number.isFinite(value) || value < 0 || value > 0.5) throw new RangeError('Invalid settlement size policy jitter amplitude');
  return value;
}
function townMinFor(mean) { return Math.max(1, Math.round(mean / 4)); }
function boundFor(mean, factor) { return Math.round(mean * factor); }

/** Re-derive every boundary from the saved means, so a tampered policy is
 * rejected even when its content hash (if any) was recomputed by the caller. */
export function validateSettlementSizePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Object.getPrototypeOf(policy) !== Object.prototype) throw new TypeError('Settlement size policy required');
  if (policy.schema !== SETTLEMENT_SIZE_POLICY_SCHEMA) throw new RangeError('Unsupported settlement size policy schema');
  const meanVillage = meanValue(policy.meanVillagePopulation, 'meanVillagePopulation');
  const meanTown = meanValue(policy.meanTownPopulation, 'meanTownPopulation');
  const meanCity = meanValue(policy.meanCityPopulation, 'meanCityPopulation');
  if (policy.villageMin !== 1) throw new RangeError('Settlement size policy village minimum must be 1');
  const expected = {
    villageMax: boundFor(meanVillage, 1.5),
    townMin: townMinFor(meanTown),
    townMax: boundFor(meanTown, 1.5),
    cityMin: boundFor(meanCity, 0.5),
    cityMax: boundFor(meanCity, 1.5),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (policy[key] !== value) throw new RangeError(`Settlement size policy '${key}' is inconsistent with its means`);
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid settlement size policy '${key}'`);
  }
  if (expected.villageMax < 1 || expected.townMin > expected.townMax || expected.cityMin > expected.cityMax) throw new RangeError('Settlement size policy bounds are not ordered');
  amplitudeFraction(policy.jitterAmplitudeFraction);
  periodValue(policy.jitterPeriod, 'jitterPeriod');
  return policy;
}

export function createSettlementSizePolicy({
  meanVillagePopulation = 300,
  meanTownPopulation = 4000,
  meanCityPopulation = 50000,
  jitterAmplitudeFraction = 0.25,
  jitterPeriod = DEFAULT_JITTER_PERIOD,
} = {}) {
  meanValue(meanVillagePopulation, 'meanVillagePopulation');
  meanValue(meanTownPopulation, 'meanTownPopulation');
  meanValue(meanCityPopulation, 'meanCityPopulation');
  amplitudeFraction(jitterAmplitudeFraction);
  periodValue(jitterPeriod, 'jitterPeriod');
  const policy = {
    schema: SETTLEMENT_SIZE_POLICY_SCHEMA,
    meanVillagePopulation,
    meanTownPopulation,
    meanCityPopulation,
    villageMin: 1,
    villageMax: boundFor(meanVillagePopulation, 1.5),
    townMin: townMinFor(meanTownPopulation),
    townMax: boundFor(meanTownPopulation, 1.5),
    cityMin: boundFor(meanCityPopulation, 0.5),
    cityMax: boundFor(meanCityPopulation, 1.5),
    jitterAmplitudeFraction,
    jitterPeriod,
  };
  return validateSettlementSizePolicy(policy);
}

export function settlementKindBounds(policy, kind) {
  validateSettlementSizePolicy(policy);
  if (kind === 'city') return { min: policy.cityMin, max: policy.cityMax, mean: policy.meanCityPopulation };
  if (kind === 'town') return { min: policy.townMin, max: policy.townMax, mean: policy.meanTownPopulation };
  if (kind === 'village') return { min: policy.villageMin, max: policy.villageMax, mean: policy.meanVillagePopulation };
  throw new RangeError('Unknown settlement kind');
}

/** A stable unit interval value from an arbitrary textual seed. */
export function settlementStableUnit(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 8);
  return parseInt(hex, 16) / 4294967296;
}

function pairDelta(policy, seed, kind, pairIndex, cap) {
  if (cap <= 0) return 0;
  const { mean } = settlementKindBounds(policy, kind);
  const amplitude = Math.round(mean * policy.jitterAmplitudeFraction);
  if (amplitude <= 0) return 0;
  const period = policy.jitterPeriod;
  const residue = ((pairIndex % period) + period) % period;
  const unit = settlementStableUnit(`${seed}|${kind}|delta|${residue}`);
  const raw = Math.round((2 * unit - 1) * amplitude);
  return Math.max(-cap, Math.min(cap, raw));
}

function slotJitter(policy, seed, kind, people, count, rank) {
  const { min, max } = settlementKindBounds(policy, kind);
  const small = Math.floor(people / count);
  const cap = Math.max(0, Math.min(small - min, max - small - 1));
  // The trailing slot of an odd count has no partner, so it is left unvaried and
  // the whole type still sums to its people budget exactly.
  if (count % 2 === 1 && rank === count - 1) return 0;
  const delta = pairDelta(policy, seed, kind, Math.floor(rank / 2), cap);
  return (rank & 1) ? -delta : delta;
}

/** Individual slot population: the integer base + remainder plus a fixed-period,
 * zero-sum pairwise variation. Every slot stays inside the kind's min/max. */
export function settlementSlotPopulation(policy, kind, people, count, rank, seed) {
  validateSettlementSizePolicy(policy);
  if (!Number.isSafeInteger(people) || people < 0 || !Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid settlement slot budget');
  if ((people === 0) !== (count === 0)) throw new RangeError('Settlement slot people and count must agree on zero');
  if (count === 0) throw new RangeError('No settlement slot exists for a zero count');
  if (!Number.isSafeInteger(rank) || rank < 0 || rank >= count) throw new RangeError('Settlement slot rank out of range');
  // An impossible people/count split is rejected explicitly instead of being
  // smoothed toward the mean.
  validateSettlementApportionment(policy, kind, people, count);
  const small = Math.floor(people / count);
  const remainder = people % count;
  return small + (rank < remainder ? 1 : 0) + slotJitter(policy, seed, kind, people, count, rank);
}

/** Population of the first `m` slots of one type, computed in O(period) without
 * building the per-slot array. Complete adjacent pairs cancel exactly. */
export function settlementSlotPeoplePrefix(policy, kind, people, count, m, seed) {
  validateSettlementSizePolicy(policy);
  if (!Number.isSafeInteger(people) || people < 0 || !Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid settlement slot budget');
  if ((people === 0) !== (count === 0)) throw new RangeError('Settlement slot people and count must agree on zero');
  if (!Number.isSafeInteger(m) || m < 0 || m > count) throw new RangeError('Settlement slot prefix out of range');
  if (count === 0) return 0;
  validateSettlementApportionment(policy, kind, people, count);
  const small = Math.floor(people / count);
  const remainder = people % count;
  let total = m * small + Math.min(m, remainder);
  if (m % 2 === 1) total += slotJitter(policy, seed, kind, people, count, m - 1);
  return total;
}

/** How many settlements of a kind a people budget should hold so that the mean
 * size stays inside the kind's bounds. Zero people means zero settlements. */
export function settlementCountFor(policy, kind, people) {
  validateSettlementSizePolicy(policy);
  if (!Number.isSafeInteger(people) || people < 0) throw new RangeError('Invalid settlement people budget');
  if (people === 0) return 0;
  const { min, max, mean } = settlementKindBounds(policy, kind);
  // A people budget below a single settlement's minimum cannot form any
  // settlement of this kind. The caller returns those people to a smaller kind.
  if (people < min) return 0;
  const minCount = Math.ceil(people / max);
  const maxCount = Math.floor(people / min);
  const base = Math.ceil(people / mean);
  return Math.max(minCount, Math.min(maxCount, base));
}

/** Whether a saved people/count pair can be realised inside the policy bounds. */
export function validateSettlementApportionment(policy, kind, people, count) {
  validateSettlementSizePolicy(policy);
  const { min, max } = settlementKindBounds(policy, kind);
  if (!Number.isSafeInteger(people) || people < 0 || !Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid settlement apportionment');
  if ((people === 0) !== (count === 0)) throw new RangeError('Settlement apportionment people and count must agree on zero');
  if (count === 0) return true;
  if (BigInt(people) > BigInt(count) * BigInt(max)) throw new RangeError(`Settlement ${kind} average exceeds its size policy maximum`);
  if (BigInt(people) < BigInt(count) * BigInt(min)) throw new RangeError(`Settlement ${kind} average is below its size policy minimum`);
  const small = Math.floor(people / count);
  if (small < min || small > max) throw new RangeError(`Settlement ${kind} size policy cannot realise this apportionment`);
  return true;
}

/** Villages aggregate small settlements; a village under 100 people is shown as
 * a hamlet. This is a display class, not a separate budget. */
export function settlementClassFor(kind, population) {
  if (kind === 'village' && population < HAMLET_MAX_POPULATION) return 'hamlet';
  return kind;
}
