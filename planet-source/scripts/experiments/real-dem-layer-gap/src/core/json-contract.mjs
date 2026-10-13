import { createHash } from './sha256.mjs';

// Identity hashes preserve canonical top-level insertion order. Only caller JSON
// objects are sorted when copied; sorting an existing state would change old IDs.
export const hashJson = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
function copy(value, path, sorted) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return !sorted && Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return Array.from(value, (v, i) => copy(v, `${path}[${i}]`, sorted));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value);
    return Object.fromEntries((sorted ? keys.sort() : keys).map(key => [key, copy(value[key], `${path}.${key}`, sorted)]));
  }
  throw new TypeError(`${path} must contain finite JSON values only`);
}
export const copyJson = (value, path = 'references') => copy(value, path, true);
// Validated canonical state keeps insertion order so existing IDs remain exact.
export const cloneJson = (value, path = 'snapshot') => copy(value, path, false);
