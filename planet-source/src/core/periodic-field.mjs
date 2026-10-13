import { createHermiteField } from './hermite-field.mjs';
/** Shared two-column ghosts preserve the original periodic Hermite arithmetic. */
export function createPeriodicHermiteField(source, columns, rows) {
  const padded = [], wrap = x => (x % columns + columns) % columns;
  for (let y = 0; y < rows; y++) for (let x = -2; x <= columns + 1; x++) padded.push(source[y * columns + wrap(x)]);
  return createHermiteField(padded, { columns: columns + 4, rows, cellSizeM: 1 }, { originXM: -2, originYM: 0 });
}
