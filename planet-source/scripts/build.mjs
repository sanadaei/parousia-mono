import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== Continuous Terrain Adapter: Build Verification ===');

// 1. Verify Core Modules
console.log('1. Checking src/core modules...');
const coreDir = path.join(rootDir, 'src', 'core');
if (!fs.existsSync(coreDir)) {
  console.error('Error: src/core does not exist');
  process.exit(1);
}

const coreFiles = fs.readdirSync(coreDir).filter(f => f.endsWith('.mjs'));
console.log(`   Found ${coreFiles.length} core modules in src/core`);
for (const file of coreFiles) {
  try {
    await import(`../src/core/${file}`);
  } catch (err) {
    console.error(`   FAIL: Error importing src/core/${file}:`, err.message);
    process.exit(1);
  }
}
console.log('   All src/core modules imported successfully.');

// Legacy paths must remain aliases, never a second implementation.
let aliases = 0;
for (const file of coreFiles) {
  if (!fs.existsSync(path.join(rootDir, file))) continue;
  const legacy = await import(`../${file}`), core = await import(`../src/core/${file}`);
  if (Object.keys(legacy).join('|') !== Object.keys(core).join('|')
    || Object.keys(core).some(key => legacy[key] !== core[key])) {
    throw new Error(`Legacy/core export drift: ${file}`);
  }
  aliases++;
}
console.log(`   ${aliases} legacy entry points share the exact core exports.`);

// 2. Verify UI Modules
console.log('2. Checking src/ui modules...');
const uiDir = path.join(rootDir, 'src', 'ui');
if (!fs.existsSync(uiDir)) {
  console.error('Error: src/ui does not exist');
  process.exit(1);
}

const uiIndex = path.join(uiDir, 'index.mjs');
if (fs.existsSync(uiIndex)) {
  try {
    await import('../src/ui/index.mjs');
    console.log('   src/ui/index.mjs imported successfully.');
  } catch (err) {
    console.error('   FAIL: Error importing src/ui/index.mjs:', err.message);
    process.exit(1);
  }
} else {
  console.log('   Notice: src/ui/index.mjs pending implementation.');
}

// Browser entry points cannot execute in Node; syntax-check every globe module.
const { spawnSync } = await import('node:child_process');
const globeFiles = fs.readdirSync(path.join(rootDir, 'src', 'globe')).filter(f => f.endsWith('.mjs'));
for (const file of globeFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(rootDir, 'src', 'globe', file)], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0 || result.error) throw new Error(`Globe syntax failed: ${file}: ${result.error?.message ?? result.stderr}`);
}
console.log(`3. ${globeFiles.length} globe modules passed syntax checks.`);
console.log('=== Build Verification Completed Successfully ===');
