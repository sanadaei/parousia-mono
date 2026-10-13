// LOD consistency check. The canonical samplers are pure functions of the
// point, so a vertex shared by sampling lattices of different steps must get a
// bit-identical sample. This tool samples nested windows (spacing s, 2s, 4s, …;
// every coarse vertex coincides exactly with a fine vertex), nested surface
// traces, and the point API, and reports every coincident sample that differs.

import { h, formatNumber, formatMeters, elevationColor, fitCanvas, nextFrame, insideBounds } from './util.mjs';

/** Keys whose values differ between two samples (deep, exact). `ignore` skips keys such as distanceM. */
export function sampleDifferences(a, b, ignore = []) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]), out = [];
  for (const k of keys) {
    if (ignore.includes(k)) continue;
    const x = a?.[k], y = b?.[k];
    if (Object.is(x, y)) continue;
    if (x && y && typeof x === 'object' && typeof y === 'object' && JSON.stringify(x) === JSON.stringify(y)) continue;
    out.push(k);
  }
  return out;
}

const niceFloor = v => { const m = 10 ** Math.floor(Math.log10(v)), r = v / m; return (r >= 5 ? 5 : r >= 2 ? 2 : 1) * m; };

/**
 * Square window of `intervals` finest steps inside `area` ∩ scene bounds,
 * centred on `center`. The finest spacing is a 1-2-5 value so coordinates stay readable.
 */
export function lodWindow(bounds, { area = bounds, center = null, intervals = 32 } = {}) {
  const minX = Math.max(bounds.minXM, area.minXM), maxX = Math.min(bounds.maxXM, area.maxXM);
  const minY = Math.max(bounds.minYM, area.minYM), maxY = Math.min(bounds.maxYM, area.maxYM);
  if (!(maxX > minX && maxY > minY)) throw new RangeError('LOD window does not overlap the scene');
  const side = Math.min(maxX - minX, maxY - minY) * 0.9, spacingM = niceFloor(side / intervals), size = spacingM * intervals;
  const c = center && insideBounds({ minXM: minX, minYM: minY, maxXM: maxX, maxYM: maxY }, center.xM, center.yM)
    ? center : { xM: (minX + maxX) / 2, yM: (minY + maxY) / 2 };
  // The small inset keeps minXM + intervals·spacingM from rounding past the bounds.
  const minXM = Math.min(Math.max(c.xM - size / 2, bounds.minXM), bounds.maxXM - size * (1 + 1e-9));
  const minYM = Math.min(Math.max(c.yM - size / 2, bounds.minYM), bounds.maxYM - size * (1 + 1e-9));
  return { minXM, minYM, maxXM: minXM + intervals * spacingM, maxYM: minYM + intervals * spacingM, spacingM, intervals };
}

/** Vertex grid with exactly the coordinate rule of the core `sampleWindow`. */
function gridBySampler(sampler, w, spacingM) {
  const nx = Math.round((w.maxXM - w.minXM) / spacingM), ny = Math.round((w.maxYM - w.minYM) / spacingM), samples = [];
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    samples.push(sampler.sampleAt(x === nx ? w.maxXM : w.minXM + x * spacingM, y === ny ? w.maxYM : w.minYM + y * spacingM));
  }
  return { columns: nx + 1, rows: ny + 1, spacingM, samples };
}

/**
 * Run the comparison. `source`: 'window' (canonical terrain.sampleWindow) or
 * 'fast' (the scene's corridor sampler used by the map raster).
 * Returns per-level stats, the finest grid, and every mismatch found.
 */
export async function runLodComparison(scene, { window: w, levels = 3, source = 'window', trace = true, pointCheck = true,
  onProgress = () => {}, maxMismatches = 200 } = {}) {
  const terrain = scene.terrain, base = { minXM: w.minXM, minYM: w.minYM, maxXM: w.maxXM, maxYM: w.maxYM };
  const result = { window: w, source, levels: [], traces: [], point: null, mismatches: [], compared: 0, identical: 0 };
  const grids = [];
  for (let level = 0; level < levels; level++) {
    const spacingM = w.spacingM * 2 ** level;
    onProgress(`Sampling level ${level} (step ${formatNumber(spacingM, 3)} m)…`); await nextFrame();
    const t0 = performance.now();
    const grid = source === 'window' && terrain.sampleWindow ? terrain.sampleWindow({ ...base, spacingM }) : gridBySampler(scene.sampler, base, spacingM);
    grids.push(grid);
    const stats = { level, spacingM, columns: grid.columns, rows: grid.rows, vertices: grid.samples.length,
      ms: performance.now() - t0, compared: 0, mismatches: 0, maxGroundDiffM: 0, fields: new Set() };
    if (level > 0) {
      const fine = grids[0], k = 2 ** level;
      for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.columns; i++) {
        const a = grid.samples[j * grid.columns + i], b = fine.samples[(j * k) * fine.columns + i * k];
        const diff = sampleDifferences(a, b);
        stats.compared++;
        if (diff.length) {
          stats.mismatches++; diff.forEach(f => stats.fields.add(f));
          stats.maxGroundDiffM = Math.max(stats.maxGroundDiffM, Math.abs(a.groundElevationM - b.groundElevationM));
          if (result.mismatches.length < maxMismatches) result.mismatches.push({ check: `level ${level} vs 0`, xM: a.xM, yM: a.yM, fields: diff, a, b });
        }
      }
    }
    stats.fields = [...stats.fields];
    result.levels.push(stats);
  }

  if (pointCheck) {
    // Point API (and the map's fast path) at every coarsest-level vertex.
    onProgress('Comparing point samples…'); await nextFrame();
    const coarse = grids.at(-1), stats = { compared: 0, mismatches: 0, fields: new Set() };
    for (const s of coarse.samples) {
      for (const [name, sampler] of [['terrain.sampleAt', terrain], ['map fast path', scene.sampler]]) {
        const diff = sampleDifferences(s, sampler.sampleAt(s.xM, s.yM));
        stats.compared++;
        if (diff.length) {
          stats.mismatches++; diff.forEach(f => stats.fields.add(f));
          if (result.mismatches.length < maxMismatches) result.mismatches.push({ check: `window vs ${name}`, xM: s.xM, yM: s.yM, fields: diff });
        }
      }
    }
    stats.fields = [...stats.fields];
    result.point = stats;
  }

  if (trace && terrain.traceSurfaceSegment) {
    // Nested traces along the window's middle row; compare points with identical coordinates.
    const yM = (w.minYM + w.maxYM) / 2, a = { xM: w.minXM, yM }, b = { xM: w.maxXM, yM };
    const traces = [];
    for (let level = 0; level < levels; level++) {
      const maxStepM = w.spacingM * 2 ** level;
      onProgress(`Tracing level ${level}…`); await nextFrame();
      const t0 = performance.now();
      let samples;
      try { samples = terrain.traceSurfaceSegment(a, b, { maxStepM }).samples; } catch (error) {
        result.traces.push({ level, maxStepM, error: error.message }); continue;
      }
      const stats = { level, maxStepM, samples: samples.length, ms: performance.now() - t0, compared: 0, mismatches: 0, fields: new Set() };
      if (traces.length) {
        const fine = new Map(traces[0].map(s => [`${s.xM},${s.yM}`, s]));
        for (const s of samples) {
          const f = fine.get(`${s.xM},${s.yM}`);
          if (!f) continue;
          const diff = sampleDifferences(s, f, ['distanceM']);
          stats.compared++;
          if (diff.length) {
            stats.mismatches++; diff.forEach(x => stats.fields.add(x));
            if (result.mismatches.length < maxMismatches) result.mismatches.push({ check: `trace ${level} vs 0`, xM: s.xM, yM: s.yM, fields: diff });
          }
        }
      }
      stats.fields = [...stats.fields];
      traces.push(samples);
      result.traces.push(stats);
    }
  }

  const all = [...result.levels.slice(1), ...(result.point ? [result.point] : []), ...result.traces.filter(t => !t.error).slice(1)];
  result.compared = all.reduce((s, x) => s + x.compared, 0);
  result.identical = result.compared - all.reduce((s, x) => s + x.mismatches, 0);
  result.grids = grids;
  onProgress(null);
  return result;
}

/** Panel UI: pick a window (current view or pinned point), run, and visualise each level. */
export class LodComparator {
  /** `getArea()` → { area, center } for the window; `onWindow(bounds|null)`; `onFocusPoint(point)`. */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.scene = null;
    this.options = { intervals: 32, levels: 3, source: 'window', trace: true };
    this.result = null;
    this.running = false;
    this.render();
  }
  setScene(scene) {
    this.scene = scene; this.result = null;
    // The road-adjusted canonical sampler costs milliseconds per point near roads;
    // default such scenes to a smaller window on the (value-identical) fast path.
    Object.assign(this.options, scene?.roadAdjustmentId ? { intervals: 16, source: 'fast', trace: false } : { intervals: 32, source: 'window', trace: true });
    this.render();
  }

  async run() {
    if (!this.scene || this.running) return;
    this.running = true; this.error = null; this.render();
    try {
      const { area, center } = this.callbacks.getArea?.() ?? {};
      const w = lodWindow(this.scene.bounds, { area: area ?? this.scene.bounds, center, intervals: this.options.intervals });
      this.callbacks.onWindow?.(w);
      this.result = await runLodComparison(this.scene, { window: w, levels: this.options.levels, source: this.options.source,
        trace: this.options.trace, onProgress: m => { if (this.progressEl) this.progressEl.textContent = m ?? ''; } });
    } catch (error) { this.error = error.message; this.result = null; }
    this.running = false;
    this.render();
  }

  render() {
    const c = this.container, o = this.options;
    c.replaceChildren();
    const select = (label, key, values, cast = String) => h('label', { class: 'field' }, h('span', {}, label),
      h('select', { onchange: e => { o[key] = cast(e.target.value); } },
        values.map(([v, text]) => h('option', { value: v, selected: String(o[key]) === String(v) }, text))));
    c.append(h('p', { class: 'muted small' }, 'Samples nested lattices (step s, 2s, 4s, …) over a window in the current view. Every coarse vertex coincides with a fine one, so canonical samples must be bit-identical across LODs, between window/point APIs, and along nested traces.'));
    c.append(h('div', { class: 'form-row' },
      select('Finest grid', 'intervals', [[16, '16×16'], [32, '32×32'], [64, '64×64'], [128, '128×128']], Number),
      select('Levels', 'levels', [[2, '2'], [3, '3'], [4, '4'], [5, '5']], Number),
      select('Sampler', 'source', [['window', 'terrain.sampleWindow'], ['fast', 'map fast path']]),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.trace, onchange: e => { o.trace = e.target.checked; } }), 'traces')));
    if (this.scene?.roadAdjustmentId) c.append(h('p', { class: 'muted small' }, 'Road-adjusted scene: terrain.sampleWindow and traces re-sample the earthwork overlay exactly and can take several seconds.'));
    c.append(h('div', { class: 'form-row' },
      h('button', { class: 'primary', disabled: this.running || !this.scene, onclick: () => this.run() }, this.running ? 'Running…' : 'Run comparison'),
      h('button', { class: 'ghost', disabled: !this.result, onclick: () => { this.result = null; this.callbacks.onWindow?.(null); this.render(); } }, 'Clear')));
    this.progressEl = h('div', { class: 'muted small progress-text' });
    c.append(this.progressEl);
    if (this.error) c.append(h('div', { class: 'callout bad' }, this.error));
    if (!this.result) return;
    const r = this.result, ok = r.identical === r.compared;
    c.append(h('div', { class: `callout ${ok ? 'good' : 'bad'}` },
      h('b', {}, ok ? 'Consistent' : 'Inconsistent'), ` — ${r.identical} / ${r.compared} coincident samples identical`,
      h('div', { class: 'small' }, `window ${formatNumber(r.window.maxXM - r.window.minXM, 1)} m square at (${formatNumber(r.window.minXM, 1)}, ${formatNumber(r.window.minYM, 1)}), finest step ${formatNumber(r.window.spacingM, 3)} m`)));
    c.append(h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Check', 'Step', 'Samples', 'Compared', 'Diff', 'ms'].map(t => h('th', {}, t)))),
      h('tbody', {},
        r.levels.map(l => h('tr', {}, h('td', {}, `window L${l.level}`), h('td', {}, formatMeters(l.spacingM, 2)), h('td', {}, `${l.columns}×${l.rows}`),
          h('td', {}, l.level ? String(l.compared) : 'ref'), h('td', { class: l.mismatches ? 'bad' : 'ok' }, l.level ? String(l.mismatches) : '—'), h('td', {}, formatNumber(l.ms, 0)))),
        r.point ? h('tr', {}, h('td', {}, 'point APIs'), h('td', {}, '—'), h('td', {}, '—'), h('td', {}, String(r.point.compared)),
          h('td', { class: r.point.mismatches ? 'bad' : 'ok' }, String(r.point.mismatches)), h('td', {}, '')) : null,
        r.traces.map(t => t.error ? h('tr', {}, h('td', {}, `trace L${t.level}`), h('td', { colspan: 5, class: 'bad' }, t.error))
          : h('tr', {}, h('td', {}, `trace L${t.level}`), h('td', {}, formatMeters(t.maxStepM, 2)), h('td', {}, String(t.samples)),
            h('td', {}, t.level ? String(t.compared) : 'ref'), h('td', { class: t.mismatches ? 'bad' : 'ok' }, t.level ? String(t.mismatches) : '—'), h('td', {}, formatNumber(t.ms, 0)))))));
    const strip = h('div', { class: 'lod-strip' });
    c.append(strip);
    r.grids.forEach((g, level) => {
      const canvas = h('canvas', { class: 'lod-canvas', title: `Level ${level}: ${g.columns}×${g.rows} vertices` });
      strip.append(h('figure', {}, canvas, h('figcaption', {}, `L${level} · ${formatMeters(g.spacingM, 2)}`)));
      requestAnimationFrame(() => this.drawGrid(canvas, g, level));
    });
    if (r.mismatches.length) {
      c.append(h('h4', {}, 'Mismatches'), h('ul', { class: 'mismatch-list' }, r.mismatches.slice(0, 50).map(m => h('li', {
        class: 'clickable', onclick: () => this.callbacks.onFocusPoint?.({ xM: m.xM, yM: m.yM }),
      }, `${m.check} @ (${formatNumber(m.xM, 2)}, ${formatNumber(m.yM, 2)}): ${m.fields.join(', ')}`))));
    }
  }

  /** Each vertex as a cell coloured by elevation; coincident vertices outlined green (identical) or red. */
  drawGrid(canvas, grid, level) {
    const { width, height, ratio } = fitCanvas(canvas), ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const range = this.scene.elevationRange, cw = width / grid.columns, ch = height / grid.rows;
    const bad = new Set(this.result.mismatches.filter(m => m.check === `level ${level} vs 0`).map(m => `${m.xM},${m.yM}`));
    for (let j = 0; j < grid.rows; j++) for (let i = 0; i < grid.columns; i++) {
      const s = grid.samples[j * grid.columns + i], [r, g, b] = elevationColor(s.groundElevationM, range);
      const wet = s.waterDepthM > 0;
      ctx.fillStyle = wet ? 'rgb(52,128,206)' : `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(i * cw, height - (j + 1) * ch, cw + 0.5, ch + 0.5);
      if (level > 0 && grid.columns <= 40) {
        ctx.strokeStyle = bad.has(`${s.xM},${s.yM}`) ? '#ff4d4d' : 'rgba(80,220,140,0.9)';
        ctx.lineWidth = 1; ctx.strokeRect(i * cw + 1.5, height - (j + 1) * ch + 1.5, cw - 3, ch - 3);
      }
    }
    for (const key of bad) {
      const [x, y] = key.split(',').map(Number), w = this.result.window;
      const px = (x - w.minXM) / (w.maxXM - w.minXM) * width, py = height - (y - w.minYM) / (w.maxYM - w.minYM) * height;
      ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(px, py, 3, 0, 2 * Math.PI); ctx.fill();
    }
  }
}
