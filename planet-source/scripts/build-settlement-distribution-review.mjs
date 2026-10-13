import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSettlementDistribution, SETTLEMENT_DISTRIBUTION_BUDGETS as BUDGETS} from '../src/core/settlement-distribution.mjs';

const sameGrid = (a, b) => a?.columns === b?.columns && a?.rows === b?.rows;
const requireInput = (condition, message) => { if (!condition) throw new RangeError(message); };

// Validate the saved budgets first, then the spatial joins used by this view.
// No census, settlement sites, climate or terrain are generated here.
function reviewData({l0, l1, summary} = {}) {
  const parents = validateSettlementDistribution(l0?.settlementDistribution);
  const children = validateSettlementDistribution(l1?.settlementDistribution);
  requireInput(parents.layer === 'L0' && children.layer === 'L1', 'Expected L0 and L1 distributions');
  const layers = [l0, l1].map((record, index) => {
    const d = record.settlementDistribution, s = record.snapshot, c = record.climate;
    requireInput(s?.worldId === d.sourceWorldId && c?.sourceWorldId === d.sourceWorldId && c?.id === d.climateId,
      'World or climate identity does not match the distribution');
    requireInput(d.sourceLayerId === (s.layerId ?? s.worldId), 'Source layer identity does not match');
    requireInput(sameGrid(d.grid, s.grid) && sameGrid(d.grid, c.grid), 'Snapshot/climate grid does not match');
    const n = d.grid.columns * d.grid.rows, area = c.cellAreaM2, land = s.fields?.landMask, lake = s.fields?.lakeFillDepthM;
    for (const values of [area, land, lake]) requireInput(Array.isArray(values) && values.length === n, 'Spatial fields must match the grid');
    const surface = [];
    for (let i = 0; i < n; i++) {
      requireInput(Number.isFinite(area[i]) && area[i] > 0, 'Cell area must be positive and finite');
      requireInput((land[i] === 0 || land[i] === 1) && Number.isFinite(lake[i]) && lake[i] >= 0, 'Invalid land or lake mask');
      const wet = !land[i] || lake[i] > 0;
      requireInput(Number(wet) === d.fields.wet[i], 'Wet mask does not match saved terrain');
      surface.push(!land[i] ? 'sea' : lake[i] > 0 ? 'lake' : 'land');
    }
    return {name: index === 0 ? 'L0' : 'L1', grid: d.grid, fields: d.fields, totals: d.totals, area, surface,
      id: d.id, worldId: d.sourceWorldId, climateId: d.climateId, populationId: d.populationId};
  });
  requireInput(l0.population?.id === parents.populationId && children.populationId === parents.populationId,
    'Population authority identity does not match');
  requireInput(children.sourceWorldId === parents.sourceWorldId && children.parentDistributionId === parents.id,
    'L1 parent distribution identity does not match');
  requireInput(sameGrid(children.unallocated.parentGrid, parents.grid), 'Unallocated parent grid does not match');
  const scale = children.grid.columns / parents.grid.columns;
  requireInput(Number.isSafeInteger(scale) && scale >= 1 && children.grid.rows / parents.grid.rows === scale && (scale & (scale - 1)) === 0,
    'L1 must use the matching power-of-two geographic grid');
  const n = parents.grid.columns * parents.grid.rows, childN = children.grid.columns * children.grid.rows;
  requireInput(Array.isArray(l1.parentCell) && l1.parentCell.length === childN, 'L1 parent cells must match the grid');
  const allocated = Object.fromEntries(BUDGETS.map(key => [key, Array(n).fill(0)]));
  for (let i = 0; i < childN; i++) {
    const expected = Math.floor(Math.floor(i / children.grid.columns) / scale) * parents.grid.columns + Math.floor((i % children.grid.columns) / scale);
    requireInput(l1.parentCell[i] === expected, 'L1 parent cell does not match its geographic position');
    for (const key of BUDGETS) allocated[key][expected] += children.fields[key][i];
  }
  const u = children.unallocated, byParent = new Map(u.parentCells.map((p, i) => [p, i]));
  for (let p = 0; p < n; p++) for (const key of BUDGETS) {
    const i = byParent.get(p), remaining = i === undefined ? 0 : u[key][i];
    requireInput(parents.fields[key][p] === allocated[key][p] + remaining, `Parent budget does not conserve ${key}`);
  }
  const census = parents.summary;
  for (const key of ['requestedPopulation', 'supportedPopulation', 'unplacedPopulation']) {
    requireInput(children.summary[key] === census[key], `L0/L1 census mismatch: ${key}`);
  }
  // summary.json is presentation metadata, never an independent authority.
  requireInput(summary?.schema === 'l0-settlement-baseline@1', 'Saved baseline summary required');
  for (const [part, d] of [['l0', parents], ['l1', children]]) {
    requireInput(summary[part]?.settlementDistributionId === d.id, 'Baseline summary distribution identity does not match');
    for (const key of ['villages', 'towns', 'cities', 'populatedCells']) requireInput(summary[part][key] === d.totals[key], `Baseline summary ${part}.${key} does not match`);
  }
  for (const key of ['requestedPopulation', 'supportedPopulation', 'unplacedPopulation']) requireInput(summary.l0[key] === census[key], `Baseline summary ${key} does not match`);
  requireInput(summary.l1.unallocatedPopulation === u.totals.population && summary.l1.unallocatedParents === u.parentCells.length,
    'Baseline summary unallocated budgets do not match');
  return {layers, census, parentCell: l1.parentCell, unallocated: u, seed: String(summary.seed ?? '')};
}

// Kept self-contained so the exact browser code can also run in a minimal
// DOM/Canvas harness, without a browser, server or external dependencies.
function settlementReviewRuntime(data) {
  const $ = id => document.getElementById(id);
  const fmt = n => n.toLocaleString('ja-JP');
  const decimal = n => n.toLocaleString('ja-JP', {maximumSignificantDigits: 4});
  const budgets = ['population', 'ruralPopulation', 'townPopulation', 'cityPopulation', 'villages', 'towns', 'cities'];
  const names = {population: '人口密度', villages: '村の分布', towns: '町の分布', cities: '都市の分布'};
  const limits = {population: [.1, 1, 10, 50, 200], villages: [.001, .01, .1, 1, 10], towns: [.0001, .001, .01, .1, 1], cities: [.00001, .0001, .001, .01, .1]};
  const colors = ['#fff0bb', '#ffd16d', '#f8a844', '#ec7139', '#c4443b', '#822c50'];
  const base = {sea: '#17394c', lake: '#4b97b1', empty: '#687865', zero: '#dbe3cf'};
  const labels = {sea: '海', lake: '湖', empty: '人口0の陸地', zero: '居住予算あり・この種類の予定数0'};
  const map = $('map'), ctx = map.getContext('2d'), cache = new Map();
  const parentTotals = Object.fromEntries(budgets.map(k => [k, Array(data.layers[0].area.length).fill(0)]));
  const childCounts = Array(data.layers[0].area.length).fill(0);
  data.parentCell.forEach((p, i) => { childCounts[p]++; for (const k of budgets) parentTotals[k][p] += data.layers[1].fields[k][i]; });
  const unallocatedIndex = new Map(data.unallocated.parentCells.map((p, i) => [p, i]));
  let location = null, pendingIndex = 0;
  $('level').value = '0'; $('metric').value = 'population';
  const layer = () => data.layers[Number($('level').value)];
  const center = (l, i) => [(i % l.grid.columns + .5) / l.grid.columns * 360, 90 - (Math.floor(i / l.grid.columns) + .5) / l.grid.rows * 180];
  const cellAt = l => Math.min(l.grid.rows - 1, Math.max(0, Math.floor((90 - location[1]) / 180 * l.grid.rows))) * l.grid.columns +
    Math.min(l.grid.columns - 1, Math.max(0, Math.floor(location[0] / 360 * l.grid.columns)));
  const density = (l, i, key) => l.fields[key][i] / (l.area[i] / 1e6) * (key === 'population' ? 1 : 1000);
  const color = (l, i, key) => {
    if (l.surface[i] !== 'land') return base[l.surface[i]];
    if (l.fields.population[i] === 0) return base.empty;
    if (l.fields[key][i] === 0) return base.zero;
    const value = density(l, i, key), bin = limits[key].findIndex(v => value < v);
    return colors[bin < 0 ? colors.length - 1 : bin];
  };
  const bounds = (l, i) => {
    const x = i % l.grid.columns, y = Math.floor(i / l.grid.columns), w = 360 / l.grid.columns, h = 180 / l.grid.rows;
    return '緯度 ' + (90 - (y + 1) * h).toFixed(3) + '〜' + (90 - y * h).toFixed(3) + '° / 経度 ' + (x * w).toFixed(3) + '〜' + ((x + 1) * w).toFixed(3) + '°';
  };
  const image = (l, key) => {
    const id = l.name + key;
    if (cache.has(id)) return cache.get(id);
    const canvas = document.createElement('canvas'); canvas.width = l.grid.columns; canvas.height = l.grid.rows;
    const c = canvas.getContext('2d'), pixels = c.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < l.area.length; i++) {
      const hex = color(l, i, key);
      pixels.data.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], i * 4);
    }
    c.putImageData(pixels, 0, 0); cache.set(id, canvas); return canvas;
  };
  function legend() {
    const key = $('metric').value, unit = key === 'population' ? '人/km²' : '予定数/1,000 km²';
    $('legend-title').textContent = names[key] + ' · ' + unit + '（L0/L1共通）';
    const list = $('legend'); list.replaceChildren();
    const entry = (hex, label) => {
      const item = document.createElement('li'), swatch = document.createElement('i'), text = document.createElement('span');
      swatch.style.backgroundColor = hex; swatch.setAttribute('aria-hidden', 'true'); text.textContent = label;
      item.append(swatch, text); list.append(item);
    };
    for (const k of ['sea', 'lake', 'empty', ...(key === 'population' ? [] : ['zero'])]) entry(base[k], labels[k]);
    for (let i = 0; i < colors.length; i++) {
      const low = i === 0 ? '0超' : decimal(limits[key][i - 1]) + '以上';
      entry(colors[i], low + (i < limits[key].length ? '〜' + decimal(limits[key][i]) + '未満' : ''));
    }
  }
  function selection() {
    const l = layer(), i = cellAt(l), land = l.surface[i] === 'land';
    const kind = land ? (l.fields.population[i] > 0 ? '居住予算のある陸地' : '人口0の陸地') : labels[l.surface[i]];
    $('selection-title').textContent = l.name + 'の選択区画 · ' + kind;
    $('cell-bounds').textContent = bounds(l, i);
    $('cell-area').textContent = decimal(l.area[i] / 1e6) + ' km²';
    for (const key of ['population', 'villages', 'towns', 'cities']) {
      $('cell-' + key).textContent = fmt(l.fields[key][i]) + (key === 'population' ? ' 人' : '');
      $('density-' + key).textContent = decimal(density(l, i, key)) + (key === 'population' ? ' 人/km²' : ' /1,000 km²');
    }
    $('parent-budget').hidden = l.name !== 'L1';
    if (l.name === 'L1') {
      const p = data.parentCell[i], u = unallocatedIndex.get(p);
      $('parent-bounds').textContent = bounds(data.layers[0], p);
      $('parent-explanation').textContent = '選択区画を含む ' + fmt(childCounts[p]) + ' 区画への配分。全7項目で L0親 ＝ 子の合計 ＋ 未配分。';
      for (const k of budgets) {
        $('parent-' + k).textContent = fmt(data.layers[0].fields[k][p]);
        $('allocated-' + k).textContent = fmt(parentTotals[k][p]);
        $('remaining-' + k).textContent = fmt(u === undefined ? 0 : data.unallocated[k][u]);
      }
    }
    $('selection-live').textContent = l.name + '、' + kind + '。' + bounds(l, i) + '。予定人口 ' + fmt(l.fields.population[i]) + ' 人。村 ' + fmt(l.fields.villages[i]) + '、町 ' + fmt(l.fields.towns[i]) + '、都市 ' + fmt(l.fields.cities[i]) + '。';
    $('cell-identity').textContent = '区画番号: ' + i + (l.name === 'L1' ? ' / L0親区画番号: ' + data.parentCell[i] : '') + ' / 分布ID: ' + l.id;
  }
  function draw() {
    const l = layer(), key = $('metric').value, i = cellAt(l);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, map.width, map.height); ctx.drawImage(image(l, key), 0, 0, map.width, map.height);
    const outline = (grid, index, stroke, width, inset = 0) => {
      ctx.strokeStyle = stroke; ctx.lineWidth = width;
      const w = map.width / grid.columns, h = map.height / grid.rows;
      ctx.strokeRect(index % grid.columns * w + inset, Math.floor(index / grid.columns) * h + inset, w - inset * 2, h - inset * 2);
    };
    if (l.name === 'L1') { ctx.setLineDash([6, 4]); outline(data.layers[0].grid, data.parentCell[i], '#ffec99', 2); ctx.setLineDash([]); }
    outline(l.grid, i, '#102a34', 5); outline(l.grid, i, '#ffffff', 2);
    const t = l.totals;
    $('layer-summary').textContent = (l.name === 'L1' ? 'L1へ配分済み' : 'L0の人口予算') + '：' + fmt(t.population) + ' 人 / 村 ' + fmt(t.villages) + ' / 町 ' + fmt(t.towns) + ' / 都市 ' + fmt(t.cities) + '（人口のある区画 ' + fmt(t.populatedCells) + '）';
    $('map-status').textContent = l.name + ' · ' + l.grid.columns + ' × ' + l.grid.rows + ' 区画 · ' + names[key];
    selection(); legend();
  }
  let first = data.layers[0].fields.population.findIndex(v => v > 0);
  location = center(data.layers[0], first < 0 ? 0 : first);
  for (const k of ['requestedPopulation', 'supportedPopulation', 'unplacedPopulation']) $('global-' + k).textContent = fmt(data.census[k]);
  for (const k of ['villages', 'towns', 'cities']) $('global-' + k).textContent = fmt(data.layers[0].totals[k]);
  $('global-allocated').textContent = fmt(data.layers[1].totals.population);
  $('global-unallocated').textContent = fmt(data.unallocated.totals.population);
  $('unallocated-parent-count').textContent = fmt(data.unallocated.parentCells.length);
  $('unallocated-note').classList.toggle('attention', data.unallocated.totals.population > 0);
  $('pending').hidden = data.unallocated.parentCells.length === 0;
  $('seed').textContent = data.seed;
  $('identities').textContent = data.layers.map(l => l.name + ': 世界 ' + l.worldId + ' / 気候 ' + l.climateId + ' / 人口正本 ' + l.populationId + ' / 分布 ' + l.id).join('\n');
  map.onpointerdown = event => {
    if (event.button !== undefined && event.button !== 0) return;
    const r = map.getBoundingClientRect();
    location = [Math.max(0, Math.min(1 - Number.EPSILON, (event.clientX - r.left) / r.width)) * 360,
      90 - Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) * 180];
    map.focus({preventScroll: true}); draw();
  };
  map.onkeydown = event => {
    const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}, step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const l = layer(), i = cellAt(l), w = l.grid.columns, h = l.grid.rows;
    const x = (i % w + step[0] + w) % w, y = Math.max(0, Math.min(h - 1, Math.floor(i / w) + step[1]));
    location = center(l, y * w + x); draw();
  };
  $('level').onchange = draw; $('metric').onchange = draw;
  $('to-parent').onclick = () => { $('level').value = '0'; draw(); };
  $('pending').onclick = () => {
    const p = data.unallocated.parentCells[pendingIndex++ % data.unallocated.parentCells.length];
    location = center(data.layers[0], p); $('level').value = '1'; draw(); map.focus({preventScroll: true});
  };
  draw();
}

/** Build a single offline HTML document from validated saved L0/L1 records. */
export function buildSettlementDistributionReview(records) {
  const data = JSON.stringify(reviewData(records)).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const budgetRows = [['population', '人口（人）'], ['ruralPopulation', '村の人口'], ['townPopulation', '町の人口'], ['cityPopulation', '都市の人口'], ['villages', '村の予定数'], ['towns', '町の予定数'], ['cities', '都市の予定数']]
    .map(([k, label]) => `<tr><th scope="row">${label}</th><td id="parent-${k}"></td><td id="allocated-${k}"></td><td id="remaining-${k}"></td></tr>`).join('');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>惑星の人口・集落分布</title><style>
:root{color-scheme:light;--ink:#18363e;--muted:#52656b;--line:#d8e1dc;--paper:#f4f6f0;--accent:#16617b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,"Yu Gothic",Meiryo,sans-serif}main{max-width:1240px;margin:auto;padding:24px}h1{font-size:clamp(1.5rem,4vw,2.2rem);line-height:1.3;margin:6px 0 10px}h2{font-size:1.12rem;margin:0 0 10px}p{margin:8px 0}.eyebrow{color:var(--accent);font-size:.8rem;letter-spacing:.1em;font-weight:700}.intro{max-width:65em;color:var(--muted)}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 18px}.stat dt{color:var(--muted);font-size:.85rem}.stat dd{margin:2px 0 0;font-size:clamp(1.1rem,3vw,1.65rem);font-weight:700;font-variant-numeric:tabular-nums}.stat dd small{font-size:.75rem;font-weight:400}.map-card,.panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;min-width:0}.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end}.controls label{display:grid;gap:4px;flex:1 1 210px;min-width:0;font-weight:600;font-size:.88rem}select,button{font:inherit;color:inherit;border:1px solid #a4b5b4;border-radius:7px;background:white;min-height:44px;padding:8px 10px;max-width:100%}select{width:100%;min-width:0}button{cursor:pointer;background:#eef4ef}button:hover{background:#ddebe5}:focus-visible{outline:3px solid #0077ad;outline-offset:4px}#map{display:block;width:100%;height:auto;aspect-ratio:2/1;background:#17394c;cursor:crosshair;border-radius:3px;touch-action:pan-y}#map:focus-visible{outline:4px solid #0077ad;outline-offset:4px}.map-wrap{margin-top:12px}.longitudes{display:flex;justify-content:space-between;color:var(--muted);font-size:.72rem;margin:2px 0}.help,.caption{font-size:.82rem;color:var(--muted)}#map-status{font-weight:600;font-size:.85rem}#layer-summary{font-size:.88rem;overflow-wrap:anywhere}.legend-title{font-size:.88rem;margin:12px 0 4px}.legend{list-style:none;padding:0;margin:4px 0;display:flex;flex-wrap:wrap;gap:5px 16px;font-size:.78rem}.legend li{display:flex;align-items:center;gap:6px}.legend i{width:15px;height:15px;border:1px solid #0003;border-radius:2px;flex:none}.totals{display:flex;flex-wrap:wrap;gap:8px 24px;padding:12px 0;font-variant-numeric:tabular-nums}.totals strong{font-size:1.08rem}.allocation{margin:16px 0;padding:12px 16px;border:1px solid var(--line);border-radius:8px;background:#edf3ed}.allocation.attention{border-color:#c78c26;background:#fff3d6}#global-unallocated{font-weight:800}.selection-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.cell-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.cell-stats>div{padding:8px 10px;background:#f4f6f0;border-radius:7px;min-width:0}.cell-stats dt{font-size:.82rem;color:var(--muted)}.cell-stats dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums}.cell-stats small{display:block;font-weight:400;color:var(--muted);font-size:.78rem;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:.84rem;table-layout:fixed;margin:12px 0}th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}th:first-child{text-align:left}thead{background:#f0f4ed}td:last-child{font-weight:700}details{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}summary{cursor:pointer;font-size:.9rem}pre,.identity{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.78rem;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}[hidden]{display:none!important}noscript{display:block;padding:24px;background:#fff3d6}
body{overflow-wrap:anywhere}
@media(max-width:700px){main{padding:16px}.selection-grid{grid-template-columns:1fr}.map-card,.panel{padding:14px}.stats{grid-template-columns:1fr;gap:7px}.stat{padding:10px}.stat dt{font-size:.75rem}.controls{gap:8px}.controls label{flex-basis:100%}.controls button{width:100%}.totals{gap:6px 16px}table{font-size:.78rem}}
@media(max-width:390px){main{padding:12px}.stat dd{font-size:1.3rem;white-space:nowrap}.stat dd small{display:block}.map-card,.panel{padding:12px}.stats{gap:5px}.stat{padding:8px 6px}.cell-stats{gap:8px}}
</style></head><body><main>
<header><div class="eyebrow">L0 → L1 / 分布の作業版</div><h1>惑星の人口・集落分布</h1><p class="intro">各区画の予定人口と村・町・都市の数を、全球図で確認します。家・街・道路や、集落の正確な位置はまだ作っていません。</p></header>
<dl class="stats" aria-label="全球の人口"><div class="stat"><dt>設定人口</dt><dd><span id="global-requestedPopulation">—</span> <small>人</small></dd></div><div class="stat"><dt>L0の人口予算</dt><dd><span id="global-supportedPopulation">—</span> <small>人</small></dd></div><div class="stat"><dt>L0で割り当てられない人口</dt><dd><span id="global-unplacedPopulation">—</span> <small>人</small></dd></div></dl>
<section class="map-card" aria-label="全球の分布図"><div class="controls"><label>確認する段階<select id="level"><option value="0">L0 · 惑星の分布</option><option value="1">L1 · 広域への配分</option></select></label><label>色で比べる内容<select id="metric"><option value="population">人口密度</option><option value="villages">村の分布</option><option value="towns">町の分布</option><option value="cities">都市の分布</option></select></label><button id="pending" type="button" hidden>未配分の地域を見る</button></div>
<p id="layer-summary"></p><div class="map-wrap"><div class="longitudes" aria-hidden="true"><span>経度 0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span></div><canvas id="map" width="1440" height="720" tabindex="0" role="img" aria-label="惑星の人口・集落分布図。クリック、タップ、矢印キーで区画を選択できます" aria-describedby="map-help">地図を描画できない場合も、下の選択区画に予算を表示します。</canvas></div>
<p id="map-status"></p><p id="map-help" class="help">上が北極、下が南極。経度は0〜360°（東向き）。クリック・タップで区画を選択し、矢印キーで隣へ移動できます。白枠が選択区画、L1の黄色い破線がL0親の範囲です。</p><h2 id="legend-title" class="legend-title"></h2><ul id="legend" class="legend"></ul><p class="caption">色は区画全体の面積あたりの密度です。L0/L1で同じ尺度を使い、村・町・都市は位置を表す点記号では表示しません。</p></section>
<div class="totals" aria-label="全球の集落予算"><span>全球の村 <strong id="global-villages">—</strong></span><span>町 <strong id="global-towns">—</strong></span><span>都市 <strong id="global-cities">—</strong></span><span class="help">L0の予定数</span></div>
<div id="unallocated-note" class="allocation"><p>L1へ配分済み <strong id="global-allocated">—</strong> 人 ＋ 未配分 <strong id="global-unallocated">—</strong> 人（L0親 <span id="unallocated-parent-count">—</span> 区画）＝ L0の人口予算</p><p class="help">L0で割り当てられない人口は、設定人口のうち農業条件の仮定から予算に含められなかった分です。L1未配分は、親にある人口予算を子へ渡せず保留している分です。集落の正確な位置は、どちらの段階でも未確定です。人口0の陸地は、その区画への配分が0という意味です。</p></div>
<div class="selection-grid"><section class="panel" aria-labelledby="selection-title"><h2 id="selection-title">選択区画</h2><p id="cell-bounds"></p><p class="help">区画の面積 <span id="cell-area"></span></p><dl class="cell-stats"><div><dt>予定人口</dt><dd><span id="cell-population"></span><small id="density-population"></small></dd></div><div><dt>村の予定数</dt><dd><span id="cell-villages"></span><small id="density-villages"></small></dd></div><div><dt>町の予定数</dt><dd><span id="cell-towns"></span><small id="density-towns"></small></dd></div><div><dt>都市の予定数</dt><dd><span id="cell-cities"></span><small id="density-cities"></small></dd></div></dl><details><summary>選択区画の識別情報</summary><p id="cell-identity" class="identity"></p></details></section>
<section id="parent-budget" class="panel" aria-label="L0親予算とL1配分" hidden><h2>L0親の予算と、その子への配分</h2><p id="parent-bounds" class="help"></p><p id="parent-explanation" class="help"></p><table><caption class="sr-only">各行でL0親＝子の合計＋未配分。人口は人、集落は予定数。</caption><thead><tr><th scope="col">予算</th><th scope="col">L0親</th><th scope="col">子の合計</th><th scope="col">未配分</th></tr></thead><tbody>${budgetRows}</tbody></table><button id="to-parent" type="button">同じ場所をL0で見る</button></section></div>
<p id="selection-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
<details class="panel"><summary>データの出典・モデルの前提</summary><p>seed: <span id="seed"></span>。保存済みのL0人口正本と、L1の配分結果を表示しています。表示や選択の操作では、保存データを変更しません。</p><p>正距円筒図のため高緯度ほど見かけの面積が広がります。密度は保存された球面上の区画面積で計算します。適性は相対的な配分重みで、細かい食料収容力を保証しません。集落数は仮定した平均規模に依存し、都市階層のシミュレーションではありません。</p><p>湖は静的水位の仮定です。家・農地・街路・都市の位置、交易・灌漑・漁業・移住は、この分布図には含みません。</p><pre id="identities"></pre></details>
<p class="help">再作成: <code>npm run l0:baseline</code>。実データから作成した独立の分布確認用です。通常画面で現在開いている保存世界の分布を示すものではありません。</p>
<noscript>この分布図の表示・区画選択にはJavaScriptが必要です。保存データは変更しません。</noscript>
</main><script id="review-data" type="application/json">${data}</script><script>(${settlementReviewRuntime.toString()})(JSON.parse(document.getElementById('review-data').textContent));</script></body></html>`;
}

/** Re-render saved records, independently of any generation stage. */
export function renderSavedSettlementDistributionReview(directory, output = path.join(directory, 'review.html')) {
  const records = Object.fromEntries(['l0', 'l1', 'summary'].map(key => [key, JSON.parse(fs.readFileSync(path.join(directory, key + '.json'), 'utf8'))]));
  const html = buildSettlementDistributionReview(records);
  const destination = path.resolve(output);
  requireInput(!['l0.json', 'l1.json', 'summary.json'].some(name => path.resolve(directory, name).toLowerCase() === destination.toLowerCase()), 'Refusing to overwrite saved baseline data');
  requireInput(path.extname(destination).toLowerCase() === '.html', 'Review output must be an HTML file');
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, html, 'utf8');
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory = 'reports/l0-settlement-baseline', output, ...extra] = process.argv.slice(2);
  if (extra.length) throw new RangeError('Usage: node scripts/build-settlement-distribution-review.mjs [saved-directory] [review.html]');
  console.log(renderSavedSettlementDistributionReview(directory, output));
}
