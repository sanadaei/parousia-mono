import {validateProjectedHull} from './projected-hull.mjs';
/** Non-coercing contract checks. Values are returned without trimming. */
export function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  return value;
}
export function positiveNumber(value, name) {
  finiteNumber(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
export function nonEmptyText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}
export function integerDimension(value, name, min = 2) {
  if (!Number.isSafeInteger(min) || min < 0) throw new RangeError('Dimension minimum must be a nonnegative integer');
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`${name} must be an integer of at least ${min}`);
  return value;
}
/** Copy finite samples. Validators can be predicates or numeric checks/transforms;
 * false rejects a sample, a numeric return replaces it, and true/undefined keeps it. */
export function copyNumericField(field, count, name, validator = finiteNumber) {
  integerDimension(count, 'sample count', 0);
  if (!(Array.isArray(field) || ArrayBuffer.isView(field)) || field.length !== count) {
    throw new RangeError(`${name} must contain exactly ${count} samples`);
  }
  if (typeof validator !== 'function') throw new TypeError('Field validator must be a function');
  return Array.from(field, (value, i) => {
    const label = `${name}[${i}]`;
    finiteNumber(value, label);
    const result = validator(value, label);
    if (result === false) throw new RangeError(`Invalid ${name} value at ${i}`);
    return typeof result === 'number' ? finiteNumber(result, label) : value;
  });
}

export function validateElevationInterval(range) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1]) throw new RangeError('Expected a finite ordered elevation interval');
  return [...range];
}

/** Optional metric disk for conservative local terrain envelopes. */
export function validateMetricDisk(disk) {
  if (disk == null) return null;
  const xM=finiteNumber(disk.xM,'disk.xM'), yM=finiteNumber(disk.yM,'disk.yM'), radiusM=finiteNumber(disk.radiusM,'disk.radiusM');
  if(radiusM<0)throw new RangeError('disk.radiusM must be nonnegative');
  return {xM,yM,radiusM,...(disk.projectedHull!=null?{projectedHull:validateProjectedHull(disk.projectedHull)}:{})};
}
