import { readdirSync } from 'node:fs';
// npm test and every verifier execute this same complete suite.
export const TEST_FILES = Object.freeze(readdirSync(new URL('../test/', import.meta.url))
  .filter(name => name.endsWith('.test.mjs')).sort().map(name => 'test/' + name));
