#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { buildShapeFirstPyramid, renderShapeFirstPreview, sha256 } from './region-pyramid.mjs';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/experiments/shape-first/build-region-pyramid.mjs [candidate.json] [output-directory] [--levels N] [--recipe generator-file]');
  process.exit(0);
}
const positional = [], options = {};
for (let i = 0; i < args.length; i++) {
  if (['--levels', '--recipe'].includes(args[i])) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing ${flag} value`);
    options[flag] = value;
  } else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
  else positional.push(args[i]);
}
if (positional.length > 2) throw new Error('Expected candidate and output directory only');
const bundled = positional.length === 0;
const input = positional[0] ?? new URL('../../../fixtures/shape-first/river-first-candidate.json', import.meta.url);
const out = resolve(positional[1] ?? 'reports/shape-first-region');
const recipeFile = options['--recipe'] ?? (bundled ? new URL('./river-first.py', import.meta.url) : null);
const recipe = recipeFile ? { filename: basename(String(recipeFile)), sha256: sha256(readFileSync(recipeFile)),
  relationship: 'declared source recipe; byte hash is not proof of regeneration' } : null;
const pyramid = buildShapeFirstPyramid(readFileSync(input, 'utf8'), { levelCount: Number(options['--levels'] ?? 5), recipe });
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'region-pyramid.json'), JSON.stringify(pyramid));
writeFileSync(resolve(out, 'preview.html'), renderShapeFirstPreview(pyramid));
console.log(JSON.stringify({ outputDirectory: out, sourceSha256: pyramid.provenance.sourceSha256,
  levels: pyramid.levels.map(l => [l.grid.columns, l.grid.rows]), status: pyramid.status }, null, 2));
