import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildL0SettlementBaseline, saveBaseline} from '../scripts/build-l0-settlement-baseline.mjs';
import {buildSettlementDistributionReview, renderSavedSettlementDistributionReview} from '../scripts/build-settlement-distribution-review.mjs';
import {createL0SettlementDistribution, refineSettlementDistribution, validateSettlementDistribution, SETTLEMENT_DISTRIBUTION_BUDGETS as BUDGETS} from '../src/core/settlement-distribution.mjs';
import {copyJson, hashJson} from '../src/core/json-contract.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEMP_ROOT = path.join(ROOT, 'tmp/l0-population-20261013');
const clone = value => JSON.parse(JSON.stringify(value));
const reidentify = d => { const {id, ...content} = d; return {...content, id: hashJson(copyJson(content))}; };
function withTemp(run) {
  fs.mkdirSync(TEMP_ROOT, {recursive: true});
  const dir = fs.mkdtempSync(path.join(TEMP_ROOT, 'ui-review-'));
  try { return run(dir); } finally { fs.rmSync(dir, {recursive: true}); }
}

// Backend-created distributions with known wet, empty, allocated and entirely
// unallocated parents. Coordinates refer only to grid cells, never settlements.
function budgetFixture({empty = false} = {}) {
  const grid = {columns: 4, rows: 2};
  const snapshot = {worldId: 'review-world', grid, fields: {
    landMask: [0, 1, 1, 1, 1, 1, 1, 1], lakeFillDepthM: [0, 1, 0, 0, 0, 0, 0, 0],
  }};
  const climate = {id: 'review-climate', sourceWorldId: snapshot.worldId, grid, cellAreaM2: Array(8).fill(1e9)};
  const cells = Array.from({length: 8}, (_, cellIndex) => {
    const inhabited = !empty && cellIndex >= 3;
    return {cellIndex, population: inhabited ? 100 : 0, ruralPopulation: inhabited ? 60 : 0,
      townPopulation: inhabited ? 30 : 0, cityPopulation: inhabited ? 10 : 0,
      villages: inhabited ? 6 : 0, towns: inhabited ? 3 : 0, cities: inhabited ? 1 : 0, suitability: 1};
  });
  const supported = empty ? 0 : 500;
  const population = {id: 'review-population', sourceWorldId: snapshot.worldId, climateId: climate.id, grid, cells,
    totals: {targetPopulation: supported + 20, supportedPopulation: supported, unplacedPopulation: 20}};
  const l0 = {snapshot, climate, population, settlementDistribution: createL0SettlementDistribution(snapshot, climate, population)};
  const childGrid = {columns: 8, rows: 4};
  const parentCell = Array.from({length: 32}, (_, i) => Math.floor(Math.floor(i / 8) / 2) * 4 + Math.floor(i % 8 / 2));
  const landMask = parentCell.map(p => p === 0 || p === 3 ? 0 : 1);
  const lakeFillDepthM = parentCell.map(p => p === 1 ? 1 : 0);
  const childSnapshot = {worldId: snapshot.worldId, layerId: 'review-L1', grid: childGrid, fields: {landMask, lakeFillDepthM}};
  const childClimate = {id: 'review-climate-L1', sourceWorldId: snapshot.worldId, grid: childGrid, cellAreaM2: Array(32).fill(2.5e8)};
  const distribution = refineSettlementDistribution(l0.settlementDistribution, {sourceWorldId: snapshot.worldId,
    climateId: childClimate.id, sourceLayerId: childSnapshot.layerId, grid: childGrid, parentCell, cellAreaM2: childClimate.cellAreaM2, landMask, lakeFillDepthM});
  const l1 = {snapshot: childSnapshot, climate: childClimate, parentCell, settlementDistribution: distribution};
  const d0 = l0.settlementDistribution;
  const summary = {schema: 'l0-settlement-baseline@1', seed: 'review',
    l0: {...d0.summary, settlementDistributionId: d0.id},
    l1: {...distribution.summary, settlementDistributionId: distribution.id, unallocatedParents: distribution.unallocated.parentCells.length}};
  return {l0, l1, summary};
}

function harness(html) {
  const match = html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script><script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'standalone data and runtime');
  const paints = [], outlines = [], canvases = [], elements = new Map();
  function context() {
    return {createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}),
      putImageData(image) { this.pixels = image.data; }, clearRect() {},
      drawImage(image) { paints.push(image); }, setLineDash() {},
      strokeRect(...rect) { outlines.push({rect, color: this.strokeStyle}); }};
  }
  function element(tag = 'div') {
    return {tag, value: '', textContent: '', hidden: false, style: {}, children: [], attributes: {}, width: 1440, height: 720,
      ctx: tag === 'canvas' ? context() : null, getContext() { return this.ctx; },
      classList: {toggle() {}}, setAttribute(k, v) { this.attributes[k] = v; },
      replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
      getBoundingClientRect() { return {left: 10, top: 20, width: 720, height: 360}; },
      focus() { this.focused = true; }};
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element(id === 'map' ? 'canvas' : 'div')); return elements.get(id); };
  $('review-data').textContent = match[1];
  const doc = {getElementById: $, createElement(tag) { const e = element(tag); if (tag === 'canvas') canvases.push(e); return e; }};
  vm.runInNewContext(match[2], {document: doc, Uint8ClampedArray}, {timeout: 3000});
  const click = (x, y) => $('map').onpointerdown({clientX: 10 + x * 720, clientY: 20 + y * 360, button: 0});
  const key = key => { let prevented = false; $('map').onkeydown({key, preventDefault() { prevented = true; }}); return prevented; };
  const level = value => { $('level').value = String(value); $('level').onchange(); };
  const metric = value => { $('metric').value = value; $('metric').onchange(); };
  const selected = () => Number($('cell-identity').textContent.match(/区画番号: (\d+)/)[1]);
  const pixel = (index, canvas = paints.at(-1)) => Array.from(canvas.ctx.pixels.slice(index * 4, index * 4 + 3));
  return {$, click, key, level, metric, selected, pixel, paints, outlines, canvases, data: JSON.parse(match[1])};
}

test('real backend records survive saving and render through the independent CLI without changing JSON', () => withTemp(dir => {
  const result = buildL0SettlementBaseline({seed: 'ui-real', targetPopulation: 1000000, columns: 32, rows: 16, levels: 2, beforeLevel: () => {}});
  const saved = saveBaseline(result, dir), before = Object.values(saved.files).map(f => fs.readFileSync(f, 'utf8'));
  const run = spawnSync(process.execPath, ['--max-old-space-size=256', 'scripts/build-settlement-distribution-review.mjs', dir], {cwd: ROOT,
    env: {...process.env, TEMP: dir, TMP: dir}, encoding: 'utf8', windowsHide: true, timeout: 15000});
  assert.equal(run.status, 0, run.stderr);
  const html = fs.readFileSync(path.join(dir, 'review.html'), 'utf8'), h = harness(html);
  assert.equal(h.$('global-supportedPopulation').textContent, result.l0.settlementDistribution.totals.population.toLocaleString('ja-JP'));
  assert.equal(h.data.layers[1].id, result.l1.settlementDistribution.id);
  h.level(1);
  assert.match(h.$('map-status').textContent, /64 × 32/);
  assert.deepEqual(Object.values(saved.files).map(f => fs.readFileSync(f, 'utf8')), before);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|fetch\(|https?:\/\//);
  assert.throws(() => renderSavedSettlementDistributionReview(dir, path.join(dir, 'l0.json')), /overwrite/);
}));

test('baseline CLI and npm entry create JSON plus standalone HTML after readback', () => withTemp(dir => {
  const run = spawnSync(process.execPath, ['--max-old-space-size=256', 'scripts/build-l0-settlement-baseline.mjs', dir,
    '--seed=ui-cli', '--population=100000', '--columns=16', '--rows=8', '--levels=2'], {cwd: ROOT,
    env: {...process.env, TEMP: dir, TMP: dir}, encoding: 'utf8', windowsHide: true, timeout: 15000});
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.saved.reloadedIdentical, true);
  assert.equal(report.saved.files.review, path.join(dir, 'review.html'));
  const html = fs.readFileSync(report.saved.files.review, 'utf8');
  assert.equal(harness(html).data.layers[0].id, JSON.parse(fs.readFileSync(report.saved.files.l0, 'utf8')).settlementDistribution.id);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['l0:baseline'], 'node --max-old-space-size=256 scripts/build-l0-settlement-baseline.mjs');
}));

test('builder rejects malformed distributions, spatial joins, summaries and per-parent imbalance', () => {
  const reject = (mutate, pattern) => { const value = budgetFixture(); mutate(value); assert.throws(() => buildSettlementDistributionReview(value), pattern); };
  reject(v => v.l0.settlementDistribution.id = 'tampered', /identity/);
  reject(v => v.l1.settlementDistribution.fields.population[0] = 3, /population|budget/);
  reject(v => v.l1.parentCell[0] = 1, /geographic/);
  reject(v => v.l1.climate.cellAreaM2[0] = 0, /area/);
  reject(v => v.l1.climate.cellAreaM2.pop(), /grid/);
  reject(v => v.l0.snapshot.fields.landMask[0] = 1, /Wet mask/);
  reject(v => v.l1.climate.id = 'another-climate', /identity/);
  reject(v => v.l1.snapshot.worldId = 'another-world', /identity/);
  reject(v => v.l1.snapshot.grid = {columns: 4, rows: 8}, /grid/);
  reject(v => v.summary.l1.unallocatedPopulation = 0, /unallocated/);
  reject(v => v.summary.l0.supportedPopulation = 1, /supportedPopulation/);
  reject(v => { const d = v.l1.settlementDistribution; d.parentDistributionId = 'other'; v.l1.settlementDistribution = reidentify(d); }, /parent distribution/);
  reject(v => {
    // The global sums and individual distribution remain valid, but moving an
    // entire child's budget between two parents violates the saved parent join.
    const d = v.l1.settlementDistribution;
    for (const k of BUDGETS) [d.fields[k][16], d.fields[k][18]] = [d.fields[k][18], d.fields[k][16]];
    // Use unequal budgets by moving one child's full tuple into another parent.
    for (const k of BUDGETS) { d.fields[k][18] += d.fields[k][16]; d.fields[k][16] = 0; }
    d.totals.populatedCells--; d.summary.populatedCells--;
    v.l1.settlementDistribution = reidentify(d);
    assert.doesNotThrow(() => validateSettlementDistribution(v.l1.settlementDistribution));
  }, /Parent budget/);
});

test('L0/L1 switching keeps geographic selection and exposes global allocated and unallocated totals', () => {
  const records = budgetFixture(), before = JSON.stringify(records), h = harness(buildSettlementDistributionReview(records));
  assert.equal(h.$('global-requestedPopulation').textContent, '520');
  assert.equal(h.$('global-supportedPopulation').textContent, '500');
  assert.equal(h.$('global-unplacedPopulation').textContent, '20');
  assert.equal(h.$('global-allocated').textContent, '400');
  assert.equal(h.$('global-unallocated').textContent, '100');
  assert.equal(h.$('global-villages').textContent, '30');
  h.level(1); h.click(.68, .68); const child = h.selected();
  const parent = records.l1.parentCell[child];
  assert.equal(child, 21); assert.equal(parent, 6);
  assert.match(h.$('layer-summary').textContent, /400 人 \/ 村 24 \/ 町 12 \/ 都市 4/);
  h.$('to-parent').onclick(); assert.equal(h.selected(), parent); assert.equal(h.$('parent-budget').hidden, true);
  assert.match(h.$('layer-summary').textContent, /500 人 \/ 村 30 \/ 町 15 \/ 都市 5/);
  h.level(1); assert.equal(h.selected(), child);
  for (const metric of ['villages', 'towns', 'cities', 'population']) { h.metric(metric); assert.equal(h.selected(), child); }
  assert.ok(h.outlines.some(o => o.color === '#ffffff'));
  assert.equal(JSON.stringify(records), before);
});

test('sea, lake, zero-population land and inhabited cells use distinct pixels and correct area densities', () => {
  const h = harness(buildSettlementDistributionReview(budgetFixture()));
  const colors = [0, 1, 2, 3].map(i => h.pixel(i).join(','));
  assert.equal(new Set(colors).size, 4);
  for (const [x, label] of [[.125, '海'], [.375, '湖'], [.625, '人口0の陸地'], [.875, '居住予算のある陸地']]) {
    h.click(x, .25); assert.match(h.$('selection-title').textContent, new RegExp(label));
  }
  assert.equal(h.$('cell-population').textContent, '100 人');
  assert.equal(h.$('density-population').textContent, '0.1 人/km²');
  assert.equal(h.$('cell-villages').textContent, '6');
  assert.equal(h.$('density-villages').textContent, '6 /1,000 km²');
  h.metric('villages'); assert.match(h.$('legend-title').textContent, /予定数\/1,000 km²/);
  const parentColor = h.pixel(4);
  const legend = h.$('legend').children.map(e => e.children[1].textContent).join('|');
  h.level(1);
  assert.equal(h.$('legend').children.map(e => e.children[1].textContent).join('|'), legend);
  // Integer apportionment gives this child 2 villages on quarter-size area.
  // Density 8 and its parent's density 6 must retain the same fixed colour bin.
  h.click(.125, .625); assert.equal(h.$('cell-area').textContent, '250 km²');
  assert.equal(h.$('density-villages').textContent, '8 /1,000 km²');
  assert.deepEqual(h.pixel(16), parentColor);
  h.metric('cities');
  const l = h.data.layers[1], zero = l.fields.population.findIndex((v, i) => v > 0 && l.fields.cities[i] === 0);
  assert.ok(zero >= 0);
  assert.deepEqual(h.pixel(zero), [219, 227, 207]);
  h.click((zero % 8 + .5) / 8, (Math.floor(zero / 8) + .5) / 4);
  assert.match(h.$('selection-title').textContent, /居住予算のある陸地/);
  assert.equal(h.$('cell-cities').textContent, '0');
});

test('L1 parent table balances every budget including explicit unallocated parents', () => {
  const records = budgetFixture(), h = harness(buildSettlementDistributionReview(records));
  h.$('pending').onclick(); assert.equal(h.$('level').value, '1');
  assert.equal(h.$('parent-budget').hidden, false);
  assert.match(h.$('selection-title').textContent, /海/);
  assert.equal(h.$('cell-population').textContent, '0 人');
  for (const k of BUDGETS) {
    const parent = records.l0.settlementDistribution.fields[k][3];
    assert.equal(h.$('parent-' + k).textContent, String(parent));
    assert.equal(h.$('allocated-' + k).textContent, '0');
    assert.equal(h.$('remaining-' + k).textContent, String(parent));
  }
  assert.match(h.$('parent-explanation').textContent, /4 区画/);
  const child = h.selected(); h.$('to-parent').onclick(); assert.equal(h.selected(), 3);
  h.level(1); assert.equal(h.selected(), child);
  h.click(.125, .625);
  for (const k of BUDGETS) {
    const value = records.l0.settlementDistribution.fields[k][4];
    assert.equal(h.$('parent-' + k).textContent, String(value));
    assert.equal(h.$('allocated-' + k).textContent, String(value));
    assert.equal(h.$('remaining-' + k).textContent, '0');
  }
});

test('pointer and arrow controls focus and announce selection, wrap longitude and stop at poles', () => {
  const h = harness(buildSettlementDistributionReview(budgetFixture()));
  h.click(.125, .25); assert.equal(h.selected(), 0); assert.equal(h.$('map').focused, true);
  assert.equal(h.key('ArrowLeft'), true); assert.equal(h.selected(), 3);
  assert.equal(h.key('ArrowRight'), true); assert.equal(h.selected(), 0);
  h.key('ArrowUp'); assert.equal(h.selected(), 0);
  h.key('ArrowDown'); assert.equal(h.selected(), 4);
  h.key('ArrowDown'); assert.equal(h.selected(), 4);
  assert.match(h.$('selection-live').textContent, /L0、居住予算のある陸地/);
  assert.match(h.$('selection-live').textContent, /予定人口 100 人。村 6、町 3、都市 1/);
  assert.equal(h.key('Enter'), false);
  h.click(1, 1); assert.equal(h.selected(), 7);
  h.level(1); assert.equal(h.selected(), 31);
});

test('zero-supported world remains navigable and disables the absent-unallocated shortcut', () => {
  const h = harness(buildSettlementDistributionReview(budgetFixture({empty: true})));
  assert.equal(h.$('global-supportedPopulation').textContent, '0');
  assert.equal(h.$('global-unallocated').textContent, '0');
  assert.equal(h.$('pending').hidden, true);
  assert.equal(h.selected(), 0);
  h.level(1); h.click(.68, .68); assert.match(h.$('selection-title').textContent, /人口0の陸地/);
  h.key('ArrowRight'); assert.equal(h.selected(), 22);
});

test('embedded user text cannot terminate the data script or add executable markup', () => {
  const records = budgetFixture(); records.summary.seed = '</script><script>throw new Error("injected")</script>\u2028';
  const html = buildSettlementDistributionReview(records), h = harness(html);
  assert.equal(h.$('seed').textContent, records.summary.seed);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});
