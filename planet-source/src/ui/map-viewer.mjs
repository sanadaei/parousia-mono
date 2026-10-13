// 2D canvas map for the Stage 5 visualizer.
//
// The terrain raster is a world-space tile pyramid: level L samples on a
// 2^L-metre lattice anchored at the scene's south-west corner, so panning
// reuses tiles and coarser levels stand in while finer ones are computed.
// Tiles store the raw canonical samples (ground, gradient, water depth); the
// colour layers (hypsometric ramp, hillshade, water tint, trafficability, contours) are applied
// from those arrays, so toggling a layer never re-samples the terrain.
// Vector overlays (rivers, water bodies, roads, bridges, pads, crossings,
// profile line, sandbox pads/roads) are redrawn every frame from their world
// coordinates; with trafficability on, roads, bridge decks and pads are drawn
// in the passable colour over the natural-ground classes. The drainage layer
// tints catchments by basin (from per-sample basin hashes stored in the tiles),
// darkens basin divides, and draws downhill flow arrows and sink markers from
// the cached tile samples; multi-chart scenes get dashed chart boxes and tags.
// The junctions layer marks road-over-road crossings (subtle rings at at-grade
// junctions, a layered deck symbol at grade-separated overpasses coloured by
// clearance status) and culverts (a pipe with a flow arrow under the road).

import { Viewport, clamp, elevationColor, waterColor, hillshade, applyShade, rgbCss, niceTicks,
  STRUCTURE_COLORS, CROSSING_STATUS_COLORS, scaleBarLength, formatDistance, fitCanvas, distanceToSegment,
  pointInPolygon, slicePolyline, pointAlongPolyline, cssVar, rectanglePolygon } from './util.mjs';
import { trafficRasterColor, TRAFFIC_COLORS, TRAFFIC_CLASSES } from './trafficability.mjs';
import { DRAINAGE_SETTINGS, basinKey, hashBasinKey, basinColorFromHash, isTrappedFlow, isLocalMinimum,
  sceneWaterCharts } from './drainage.mjs';
import { sceneJunctions, junctionMarker } from './junctions.mjs';

export const TILE_SIZE = 64;
const TRAFFIC_RGB_CLIFF = trafficRasterColor(Infinity, 0);
const TRAFFIC_RGB = TRAFFIC_CLASSES.map(c => c === 'cliff' ? TRAFFIC_RGB_CLIFF
  : [1, 3, 5].map(i => parseInt(TRAFFIC_COLORS[c].slice(i, i + 2), 16)));
const MAX_TILES = 480;
const FALLBACK_LEVELS = 4;
const FRAME_BUDGET_MS = 11;

export const DEFAULT_LAYERS = Object.freeze({
  elevation: true, hillshade: true, water: true, contours: false, trafficability: false,
  rivers: true, waterBodies: true, roads: true, roadStructure: true, bridges: true,
  pads: true, crossings: true, junctions: true, labels: true, bounds: true, drainage: false,
});

// Per-sample drainage flags stored in TerrainTile.flags.
const FLAG_BASIN = 1, FLAG_TRAPPED = 2;
const basinRgbCache = new Map();
const basinRgb = hash => {
  let rgb = basinRgbCache.get(hash);
  if (!rgb) { if (basinRgbCache.size > 4096) basinRgbCache.clear(); basinRgbCache.set(hash, rgb = basinColorFromHash(hash)); }
  return rgb;
};

/** Lattice level whose spacing is at most `pixelsPerSample` screen pixels. */
export function levelForScale(metersPerPixel, pixelsPerSample = 1.5) {
  return Math.floor(Math.log2(Math.max(1e-6, metersPerPixel * pixelsPerSample)));
}

/** Contour interval giving roughly `count` lines across the scene range. */
export function contourInterval(range, count = 24) {
  const ticks = niceTicks(range.minM, range.maxM, count);
  return ticks.length > 1 ? ticks[1] - ticks[0] : Math.max(1e-3, (range.maxM - range.minM) / count);
}

/**
 * One raster tile: TILE_SIZE² samples at cell centres of its lattice cells.
 * Rows are computed incrementally so a slow sampler never blocks a frame for long.
 */
export class TerrainTile {
  constructor(level, tx, ty, origin) {
    Object.assign(this, { level, tx, ty, row: 0, done: false, image: null, styleKey: null, lastUsed: 0 });
    const n = TILE_SIZE * TILE_SIZE;
    this.spacingM = 2 ** level;
    this.minXM = origin.xM + tx * TILE_SIZE * this.spacingM;
    this.minYM = origin.yM + ty * TILE_SIZE * this.spacingM;
    this.sizeM = TILE_SIZE * this.spacingM;
    this.ground = new Float32Array(n).fill(NaN);
    this.gx = new Float32Array(n); this.gy = new Float32Array(n);
    this.depth = new Float32Array(n).fill(NaN);
    this.traffic = new Uint8Array(n).fill(255);
    this.basin = new Uint32Array(n); this.flags = new Uint8Array(n);
    this.sinks = null;
    this.errors = 0;
  }
  get key() { return `${this.level}/${this.tx}/${this.ty}`; }
  /** Sample rows until `deadline` (performance.now()); returns true when complete. */
  compute(sampler, bounds, deadline) {
    const s = this.spacingM;
    while (this.row < TILE_SIZE) {
      const j = this.row, yM = this.minYM + (j + 0.5) * s;
      for (let i = 0; i < TILE_SIZE; i++) {
        const xM = this.minXM + (i + 0.5) * s, k = j * TILE_SIZE + i;
        if (xM < bounds.minXM || xM > bounds.maxXM || yM < bounds.minYM || yM > bounds.maxYM) continue;
        try {
          const sample = sampler.sampleAt(xM, yM);
          this.ground[k] = sample.groundElevationM;
          this.gx[k] = sample.gradient.x; this.gy[k] = sample.gradient.y;
          this.depth[k] = sample.waterDepthM ?? NaN;
          if (sampler.trafficabilityAt) this.traffic[k] = TRAFFIC_CLASSES.indexOf(sampler.trafficabilityAt(xM, yM, sample).class);
          const key = basinKey(sample);
          if (key !== null) { this.basin[k] = hashBasinKey(key); this.flags[k] |= FLAG_BASIN; }
          if (isTrappedFlow(sample)) this.flags[k] |= FLAG_TRAPPED;
        } catch { this.errors++; }
      }
      this.row++;
      if (performance.now() > deadline && this.row < TILE_SIZE) return false;
    }
    this.done = true;
    return true;
  }
  /**
   * Sinks of a finished tile (cached): samples whose basin status reports
   * trapped flow, and dry strict local minima of the sampled ground (pits
   * with no downhill neighbour on this lattice).
   */
  sinkList() {
    if (this.sinks || !this.done) return this.sinks ?? [];
    const s = this.spacingM, out = [];
    for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) {
      const k = j * TILE_SIZE + i;
      if (Number.isNaN(this.ground[k]) || this.depth[k] > 0) continue;
      const trapped = (this.flags[k] & FLAG_TRAPPED) !== 0;
      // Report a flagged region once per 8×8 block rather than at every sample.
      if (trapped ? (i & 7) === 4 && (j & 7) === 4 : isLocalMinimum(this.ground, TILE_SIZE, TILE_SIZE, i, j)) {
        out.push({ xM: this.minXM + (i + 0.5) * s, yM: this.minYM + (j + 0.5) * s, kind: trapped ? 'depression' : 'pit' });
      }
    }
    this.sinks = out;
    return out;
  }
  /** Paint RGBA pixels from the stored samples. Canvas rows run north → south. */
  colorize(style, makeCanvas) {
    const key = style.key;
    if (this.styleKey === key && this.image) return this.image;
    this.image ??= makeCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = this.image.getContext('2d'), img = ctx.createImageData(TILE_SIZE, TILE_SIZE), px = img.data;
    const { range, interval } = style;
    const band = z => Math.floor(z / interval);
    for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) {
      const k = j * TILE_SIZE + i, z = this.ground[k];
      if (Number.isNaN(z)) continue;
      let rgb = style.elevation ? elevationColor(z, range) : [128, 132, 138];
      const depth = this.depth[k];
      const wet = style.water && depth > 0;
      if (style.hillshade) {
        const shade = hillshade({ x: this.gx[k], y: this.gy[k] }, { exaggeration: style.exaggeration, azimuthDeg: style.azimuthDeg });
        rgb = applyShade(rgb, shade, wet ? 0.25 : style.elevation ? 0.75 : 1.1);
      }
      if (wet) {
        const w = waterColor(depth), a = 0.55 + 0.4 * Math.min(1, depth / 3);
        rgb = [rgb[0] * (1 - a) + w[0] * a, rgb[1] * (1 - a) + w[1] * a, rgb[2] * (1 - a) + w[2] * a];
      }
      if (style.trafficability) {
        const slope = Math.hypot(this.gx[k], this.gy[k]);
        const c = TRAFFIC_RGB[this.traffic[k]] ?? trafficRasterColor(slope, depth);
        let a = 0.58;
        if (c === TRAFFIC_RGB_CLIFF) {
          // Diagonal hatch on the global lattice so stripes line up across tiles.
          const stripe = ((this.tx * TILE_SIZE + i) + (this.ty * TILE_SIZE + j)) & 3;
          a = stripe < 2 ? 0.9 : 0.5;
        }
        rgb = [rgb[0] * (1 - a) + c[0] * a, rgb[1] * (1 - a) + c[1] * a, rgb[2] * (1 - a) + c[2] * a];
      }
      if (style.drainage && this.flags[k] & FLAG_BASIN) {
        const hash = this.basin[k], c = basinRgb(hash), a = DRAINAGE_SETTINGS.basinAlpha;
        rgb = [rgb[0] * (1 - a) + c[0] * a, rgb[1] * (1 - a) + c[1] * a, rgb[2] * (1 - a) + c[2] * a];
        // Basin divide: a neighbour on this lattice drains to a different catchment.
        const r = i + 1 < TILE_SIZE && this.flags[k + 1] & FLAG_BASIN ? this.basin[k + 1] : hash;
        const u = j + 1 < TILE_SIZE && this.flags[k + TILE_SIZE] & FLAG_BASIN ? this.basin[k + TILE_SIZE] : hash;
        if (r !== hash || u !== hash) { const d = DRAINAGE_SETTINGS.divideShade; rgb = [rgb[0] * d, rgb[1] * d, rgb[2] * d]; }
      }
      if (style.contours) {
        const b = band(z), r = i + 1 < TILE_SIZE ? this.ground[k + 1] : NaN, u = j + 1 < TILE_SIZE ? this.ground[k + TILE_SIZE] : NaN;
        if ((!Number.isNaN(r) && band(r) !== b) || (!Number.isNaN(u) && band(u) !== b)) {
          const major = Math.abs(Math.max(b, Number.isNaN(r) ? b : band(r), Number.isNaN(u) ? b : band(u))) % 5 === 0;
          const k2 = major ? 0.45 : 0.68;
          rgb = [rgb[0] * k2, rgb[1] * k2, rgb[2] * k2];
        }
      }
      const o = ((TILE_SIZE - 1 - j) * TILE_SIZE + i) * 4;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.styleKey = key;
    return this.image;
  }
}

/**
 * Interactive map. Tools: 'pan', 'profile', 'sandbox' (clicks go to onClick;
 * dragging still pans). Callbacks: onHover(point|null), onClick({ point, hit }),
 * onProfileLine(a, b), onViewChange(viewport), onProgress({ pending, level }).
 */
export class MapViewer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.viewport = new Viewport();
    this.layers = { ...DEFAULT_LAYERS };
    this.shading = { exaggeration: 2, azimuthDeg: 315, pixelsPerSample: 1.5 };
    this.tool = 'pan';
    this.scene = null;
    this.charts = [];
    this.tiles = new Map();
    this.queue = [];
    this.clock = 0;
    this.overlay = { profile: null, cursor: null, highlight: null, lodWindow: null, pinned: null, selectedRoadId: null, focusCrossingId: null, focusJunctionId: null, sandbox: null };
    this.drag = null;
    this.hoverPoint = null;
    this.frameRequested = false;
    this.workScheduled = false;
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.bindEvents();
    this.resize();
  }

  // ---------- Scene & state ----------

  setScene(scene) {
    this.scene = scene;
    this.tiles.clear(); this.queue = [];
    this.origin = { xM: scene.bounds.minXM, yM: scene.bounds.minYM };
    this.charts = sceneWaterCharts(scene);
    Object.assign(this.overlay, { profile: null, cursor: null, highlight: null, lodWindow: null, pinned: null, selectedRoadId: null, focusCrossingId: null, focusJunctionId: null, sandbox: null });
    this.fit();
  }
  setLayers(patch) { Object.assign(this.layers, patch); this.invalidate(); }
  setShading(patch) { Object.assign(this.shading, patch); this.invalidate(); }
  setTool(tool) { this.tool = tool; this.canvas.dataset.tool = tool; }
  setOverlay(patch) { Object.assign(this.overlay, patch); this.requestFrame(); }
  fit() { if (this.scene) { this.viewport.fit(this.scene.bounds, 28); this.viewChanged(); } }

  /** Pan/zoom to frame world bounds (e.g. a crossing), never zooming past `minMetersPerPixel`. */
  focusBounds(bounds, { minMetersPerPixel = 0.05 } = {}) {
    this.viewport.fit(bounds, 40);
    this.viewport.metersPerPixel = Math.max(this.viewport.metersPerPixel, minMetersPerPixel);
    this.viewChanged();
  }
  centerOn(point) { this.viewport.centerXM = point.xM; this.viewport.centerYM = point.yM; this.viewChanged(); }
  zoomBy(factor) { this.viewport.zoomAt(factor, this.viewport.width / 2, this.viewport.height / 2, this.zoomLimits()); this.viewChanged(); }

  zoomLimits() {
    const b = this.scene?.bounds, span = b ? Math.max(b.maxXM - b.minXM, b.maxYM - b.minYM) : 1e5;
    return { minMetersPerPixel: 0.02, maxMetersPerPixel: span / 64 };
  }

  resize() {
    const { width, height } = fitCanvas(this.canvas);
    const first = this.viewport.width <= 1;
    this.viewport.resize(width, height);
    if (first && this.scene) this.viewport.fit(this.scene.bounds, 28);
    this.viewChanged();
  }

  viewChanged() {
    this.rebuildQueue();
    this.callbacks.onViewChange?.(this.viewport);
    this.requestFrame();
  }

  /** Re-colour cached tiles (style change) without re-sampling. */
  invalidate() { this.requestFrame(); }

  get style() {
    const range = this.scene?.elevationRange ?? { minM: 0, maxM: 1 };
    const s = { ...this.layers, ...this.shading, range, interval: contourInterval(range) };
    s.key = [s.elevation, s.hillshade, s.water, s.contours, s.trafficability, s.drainage, s.exaggeration, s.azimuthDeg, range.minM, range.maxM].join('|');
    return s;
  }

  get targetLevel() { return levelForScale(this.viewport.metersPerPixel, this.shading.pixelsPerSample); }

  // ---------- Tile scheduling ----------

  visibleTileRange(level) {
    const b = this.viewport.worldBounds, sb = this.scene.bounds, size = TILE_SIZE * 2 ** level;
    const minX = Math.max(b.minXM, sb.minXM), maxX = Math.min(b.maxXM, sb.maxXM);
    const minY = Math.max(b.minYM, sb.minYM), maxY = Math.min(b.maxYM, sb.maxYM);
    if (minX > maxX || minY > maxY) return null;
    return { x0: Math.floor((minX - this.origin.xM) / size), x1: Math.floor((maxX - this.origin.xM) / size),
      y0: Math.floor((minY - this.origin.yM) / size), y1: Math.floor((maxY - this.origin.yM) / size) };
  }

  tile(level, tx, ty, create = false) {
    const key = `${level}/${tx}/${ty}`;
    let t = this.tiles.get(key);
    if (!t && create) { t = new TerrainTile(level, tx, ty, this.origin); this.tiles.set(key, t); }
    if (t) t.lastUsed = this.clock;
    return t;
  }

  rebuildQueue() {
    if (!this.scene) return;
    const target = this.targetLevel, queue = [], c = { xM: this.viewport.centerXM, yM: this.viewport.centerYM };
    // A quick preview two levels up first (16× fewer samples), then the target level.
    for (const level of [target + 2, target]) {
      const r = this.visibleTileRange(level);
      if (!r) continue;
      const size = TILE_SIZE * 2 ** level, list = [];
      for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
        const t = this.tiles.get(`${level}/${tx}/${ty}`);
        if (t?.done) continue;
        const dx = this.origin.xM + (tx + 0.5) * size - c.xM, dy = this.origin.yM + (ty + 0.5) * size - c.yM;
        list.push({ level, tx, ty, d: dx * dx + dy * dy });
      }
      list.sort((a, b) => a.d - b.d);
      queue.push(...list);
    }
    this.queue = queue;
    this.callbacks.onProgress?.({ pending: queue.length, level: target });
    this.scheduleWork();
  }

  scheduleWork() {
    if (this.workScheduled || !this.queue.length) return;
    this.workScheduled = true;
    const raf = globalThis.requestAnimationFrame ?? (f => setTimeout(f, 16));
    raf(() => { this.workScheduled = false; this.work(); });
  }

  work() {
    if (!this.scene) return;
    const deadline = performance.now() + FRAME_BUDGET_MS;
    let progressed = false;
    while (this.queue.length && performance.now() < deadline) {
      const next = this.queue[0], t = this.tile(next.level, next.tx, next.ty, true);
      if (t.done || t.compute(this.scene.sampler, this.scene.bounds, deadline)) { this.queue.shift(); progressed = true; }
    }
    this.evict();
    if (progressed) this.requestFrame();
    this.callbacks.onProgress?.({ pending: this.queue.length, level: this.targetLevel });
    this.scheduleWork();
  }

  evict() {
    if (this.tiles.size <= MAX_TILES) return;
    const keep = new Set(this.queue.map(q => `${q.level}/${q.tx}/${q.ty}`));
    const old = [...this.tiles.values()].filter(t => !keep.has(t.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const t of old.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(t.key);
  }

  // ---------- Rendering ----------

  requestFrame() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    const raf = globalThis.requestAnimationFrame ?? (f => setTimeout(f, 16));
    raf(() => { this.frameRequested = false; this.render(); });
  }

  render() {
    const { ctx, viewport: v } = this;
    const ratio = this.canvas.width / v.width;
    this.clock++;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = cssVar('--map-bg', '#0d1117');
    ctx.fillRect(0, 0, v.width, v.height);
    if (!this.scene) return;
    this.drawRaster();
    const L = this.layers;
    if (L.bounds) this.drawBounds();
    if (this.charts.length > 1 && (L.bounds || L.drainage)) this.drawCharts();
    if (L.drainage) this.drawDrainage();
    if (L.waterBodies) this.drawWaterBodies();
    if (L.rivers) this.drawRivers();
    if (L.pads) this.drawPads();
    if (L.roads) this.drawRoads();
    if (L.bridges) this.drawBridges();
    this.drawSandbox();
    if (L.junctions) this.drawJunctions();
    if (L.crossings) this.drawCrossings();
    if (L.labels) this.drawLabels();
    this.drawLodWindow();
    this.drawProfile();
    this.drawMarkers();
    this.drawScaleBar();
  }

  drawRaster() {
    const { ctx, viewport: v } = this, style = this.style, target = this.targetLevel;
    const make = (w, h) => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
      const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    // Coarse fallbacks first, then progressively finer levels on top.
    for (let level = target + FALLBACK_LEVELS; level >= target - 1; level--) {
      const r = this.visibleTileRange(level);
      if (!r) continue;
      if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 400) continue;
      for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
        const t = this.tile(level, tx, ty);
        if (!t?.done) continue;
        const image = t.colorize(style, make);
        const a = v.toScreen(t.minXM, t.minYM + t.sizeM), b = v.toScreen(t.minXM + t.sizeM, t.minYM);
        // Snap to whole pixels with a small overlap to hide seams.
        const x = Math.floor(a.x), y = Math.floor(a.y);
        ctx.drawImage(image, x, y, Math.ceil(b.x) - x + 0.5, Math.ceil(b.y) - y + 0.5);
      }
    }
  }

  path(points, close = false) {
    const { ctx, viewport: v } = this;
    ctx.beginPath();
    points.forEach((p, i) => { const s = v.toScreen(p.xM, p.yM); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (close) ctx.closePath();
  }

  drawBounds() {
    const b = this.scene.bounds;
    this.path([{ xM: b.minXM, yM: b.minYM }, { xM: b.maxXM, yM: b.minYM }, { xM: b.maxXM, yM: b.maxYM }, { xM: b.minXM, yM: b.maxYM }], true);
    this.ctx.strokeStyle = 'rgba(200,210,230,0.35)'; this.ctx.lineWidth = 1; this.ctx.setLineDash([4, 4]);
    this.ctx.stroke(); this.ctx.setLineDash([]);
  }

  /** Finished tile and sample index covering a world point, searching from `level` up to coarser fallbacks. */
  sampleIndexAt(xM, yM, level) {
    for (let l = level; l <= level + FALLBACK_LEVELS; l++) {
      const size = TILE_SIZE * 2 ** l, tx = Math.floor((xM - this.origin.xM) / size), ty = Math.floor((yM - this.origin.yM) / size);
      const t = this.tiles.get(`${l}/${tx}/${ty}`);
      if (!t?.done) continue;
      const i = Math.floor((xM - t.minXM) / t.spacingM), j = Math.floor((yM - t.minYM) / t.spacingM);
      if (i < 0 || j < 0 || i >= TILE_SIZE || j >= TILE_SIZE) continue;
      const k = j * TILE_SIZE + i;
      if (Number.isNaN(t.ground[k])) return null;
      return { tile: t, k };
    }
    return null;
  }

  /**
   * Drainage overlay: downhill flow arrows on a screen-space grid (read from
   * cached tile gradients, so no extra sampling) and sink / depression markers.
   */
  drawDrainage() {
    const { ctx, viewport: v } = this, level = this.targetLevel, step = DRAINAGE_SETTINGS.arrowSpacingPx;
    const arrows = [];
    for (let y = step / 2; y < v.height; y += step) for (let x = step / 2; x < v.width; x += step) {
      const w = v.toWorld(x, y), hit = this.sampleIndexAt(w.xM, w.yM, level);
      if (!hit || hit.tile.depth[hit.k] > 0) continue;
      const gx = hit.tile.gx[hit.k], gy = hit.tile.gy[hit.k], slope = Math.hypot(gx, gy);
      if (slope < DRAINAGE_SETTINGS.minFlowSlope) continue;
      // Screen y grows southwards: the downhill vector (−gx, −gy) maps to (−gx, +gy).
      const len = 7 + 8 * Math.min(1, Math.sqrt(slope / 0.2)), ux = -gx / slope, uy = gy / slope;
      arrows.push([x - ux * len / 2, y - uy * len / 2, x + ux * len / 2, y + uy * len / 2, ux, uy]);
    }
    const stroke = (color, width) => {
      ctx.beginPath();
      for (const [x0, y0, x1, y1, ux, uy] of arrows) {
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        ctx.moveTo(x1 - 4 * ux + 3 * uy, y1 - 4 * uy - 3 * ux); ctx.lineTo(x1, y1); ctx.lineTo(x1 - 4 * ux - 3 * uy, y1 - 4 * uy + 3 * ux);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    stroke('rgba(6,10,16,0.55)', 3);
    stroke('rgba(220,240,255,0.85)', 1.2);
    this.drawSinks(level);
  }

  drawSinks(level) {
    const { ctx, viewport: v } = this;
    // Use the finest level that has any finished visible tile.
    let sinks = [];
    for (let l = level; l <= level + FALLBACK_LEVELS && !sinks.length; l++) {
      const r = this.visibleTileRange(l);
      if (!r || (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > 400) continue;
      for (let ty = r.y0; ty <= r.y1; ty++) for (let tx = r.x0; tx <= r.x1; tx++) {
        const t = this.tiles.get(`${l}/${tx}/${ty}`);
        if (t?.done) sinks.push(...t.sinkList());
      }
    }
    let drawn = 0;
    for (const sink of sinks) {
      if (drawn >= DRAINAGE_SETTINGS.maxSinkMarkers) break;
      const s = v.toScreen(sink.xM, sink.yM);
      if (s.x < -8 || s.y < -8 || s.x > v.width + 8 || s.y > v.height + 8) continue;
      drawn++;
      const depression = sink.kind === 'depression', r = depression ? 6 : 4.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y + r); ctx.lineTo(s.x + r, s.y - r * 0.7); ctx.lineTo(s.x - r, s.y - r * 0.7); ctx.closePath();
      ctx.fillStyle = depression ? '#ff6b4a' : '#f2b84b'; ctx.fill();
      ctx.strokeStyle = 'rgba(8,10,14,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  /** Multi-chart scenes: dashed boxes and tags for charts in reach, plus an index of the others. */
  drawCharts() {
    const { ctx, viewport: v } = this;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const offView = [];
    for (const chart of this.charts) {
      if (!chart.polygon) { offView.push(chart); continue; }
      this.path(chart.polygon, true);
      ctx.strokeStyle = chart.active ? 'rgba(160,220,255,0.55)' : 'rgba(199,146,234,0.6)';
      ctx.lineWidth = chart.active ? 1 : 1.5; ctx.setLineDash(DRAINAGE_SETTINGS.chartDash); ctx.stroke(); ctx.setLineDash([]);
      // Tag at the north-west corner (largest y, smallest x).
      const nw = chart.polygon.reduce((a, p) => (p.yM - p.xM > a.yM - a.xM ? p : a));
      const s = v.toScreen(nw.xM, nw.yM), text = `${chart.active ? '● ' : ''}${chart.label}`;
      this.tag(text, s.x + 4, s.y + 10, chart.active ? '#a9d8ff' : '#d7b8f0');
      for (const seam of chart.seams) {
        if (!seam.local) continue;
        const p = v.toScreen(seam.local.xM, seam.local.yM);
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y); ctx.lineTo(p.x, p.y + 6); ctx.lineTo(p.x - 6, p.y); ctx.closePath();
        ctx.fillStyle = '#c792ea'; ctx.fill(); ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 1.5; ctx.stroke();
        if (this.layers.labels) this.tag(`seam ${seam.edgeId} (${seam.side})`, p.x + 9, p.y, '#e2c8f5');
      }
    }
    if (!offView.length) return;
    // Index of charts beyond the active projection's reach, below the north arrow.
    const lines = [`Charts (${this.charts.length})`, ...offView.map(c => `${c.id} · ${formatDistance(c.distanceM)}${c.bearingDeg === null ? '' : ` · ${c.bearingDeg.toFixed(0)}°`}`)];
    const width = Math.max(...lines.map(t => ctx.measureText(t).width)) + 16, x = v.width - width - 10, y = 58;
    ctx.fillStyle = 'rgba(13,17,23,0.78)'; ctx.fillRect(x, y, width, lines.length * 15 + 8);
    ctx.strokeStyle = 'rgba(199,146,234,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(x + 0.5, y + 0.5, width - 1, lines.length * 15 + 7); ctx.setLineDash([]);
    lines.forEach((t, i) => { ctx.fillStyle = i ? '#d7b8f0' : '#e6edf3'; ctx.fillText(t, x + 8, y + 12 + i * 15); });
  }

  /** Small boxed text label at a screen position. */
  tag(text, x, y, color) {
    const ctx = this.ctx, w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(13,17,23,0.72)'; ctx.fillRect(x, y - 8, w, 16);
    ctx.fillStyle = color; ctx.fillText(text, x + 4, y);
  }

  drawWaterBodies() {
    const ctx = this.ctx;
    for (const body of this.scene.overlays.waterBodies) {
      this.path(body.polygon, true);
      ctx.fillStyle = this.layers.water ? 'rgba(80,160,230,0.08)' : 'rgba(60,140,220,0.45)';
      ctx.fill();
      ctx.strokeStyle = body.kind === 'ocean' ? 'rgba(120,190,255,0.75)' : 'rgba(150,210,255,0.9)';
      ctx.lineWidth = 1.25; ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawRivers() {
    const { ctx, viewport: v } = this, o = this.scene.overlays;
    const width = clamp(6 / v.metersPerPixel, 1.2, 4);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const edge of o.rivers) {
      this.path(edge.points);
      ctx.strokeStyle = 'rgba(8,30,60,0.55)'; ctx.lineWidth = width + 1.5; ctx.stroke();
      ctx.strokeStyle = '#5cb6ff'; ctx.lineWidth = width; ctx.stroke();
    }
    for (const edge of o.sourceRivers) {
      this.path(edge.points);
      ctx.strokeStyle = 'rgba(140,170,200,0.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /** Road carriageway; coloured by centerline structure segments when designed. */
  drawRoads() {
    const { ctx, viewport: v, scene } = this;
    const px = halfWidthM => Math.max(2.5, 2 * halfWidthM / v.metersPerPixel);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const road of scene.overlays.roads) {
      const w = px(road.halfWidthM), selected = this.overlay.selectedRoadId === road.id;
      this.path(road.points);
      if (this.layers.trafficability) {
        // Keep the alignment visible without painting over the sampled movement classes.
        ctx.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.45)';
        ctx.lineWidth = selected ? 2 : 1; ctx.stroke(); continue;
      }
      ctx.strokeStyle = selected ? 'rgba(255,255,255,0.95)' : 'rgba(10,12,16,0.85)';
      ctx.lineWidth = w + (selected ? 5 : 2.5); ctx.stroke();
      const profile = scene.roadProfiles.get(road.id);
      if (this.layers.roadStructure && profile && !this.layers.trafficability) {
        // Draw runs of equal segment kind as single paths.
        let run = [], kind = null;
        const flush = () => {
          if (run.length > 1) { this.path(run); ctx.strokeStyle = STRUCTURE_COLORS[kind] ?? STRUCTURE_COLORS['at-grade']; ctx.lineWidth = w; ctx.stroke(); }
        };
        for (let i = 0; i < profile.length - 1; i++) {
          const a = profile[i], b = profile[i + 1];
          const k = a.segmentKind ?? (a.structureKind === 'bridge-deck' && b.structureKind === 'bridge-deck' ? 'bridge-deck' : a.structureKind);
          if (k !== kind) { flush(); run = [a]; kind = k; }
          run.push(b);
        }
        flush();
      } else {
        this.path(road.points);
        ctx.strokeStyle = this.layers.trafficability ? TRAFFIC_COLORS.highway : profile ? STRUCTURE_COLORS['at-grade'] : '#a9b1bd';
        ctx.lineWidth = w; ctx.stroke();
      }
    }
  }

  drawBridges() {
    const { ctx, viewport: v, scene } = this;
    for (const bridge of scene.overlays.bridges) {
      const road = scene.overlays.roads.find(r => r.id === bridge.roadId);
      if (!road) continue;
      const pts = slicePolyline(road.points, bridge.startDistanceM, bridge.endDistanceM);
      const w = Math.max(4, 2 * road.halfWidthM / v.metersPerPixel) + 3;
      if (this.layers.trafficability) {
        this.path(pts); ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1; ctx.stroke(); continue;
      }
      ctx.lineCap = 'butt';
      this.path(pts); ctx.strokeStyle = '#1b1306'; ctx.lineWidth = w + 3; ctx.stroke();
      // Decks stay passable (green) over deep water in the trafficability view.
      this.path(pts); ctx.strokeStyle = this.layers.trafficability ? TRAFFIC_COLORS.highway : STRUCTURE_COLORS['bridge-deck'];
      ctx.lineWidth = w; ctx.stroke();
      // Abutment ticks across the deck ends.
      for (const [p, q] of [[pts[0], pts[1]], [pts.at(-1), pts.at(-2)]]) {
        if (!p || !q) continue;
        const a = v.toScreen(p.xM, p.yM), b = v.toScreen(q.xM, q.yM), len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, half = w / 2 + 4;
        ctx.beginPath(); ctx.moveTo(a.x - nx * half, a.y - ny * half); ctx.lineTo(a.x + nx * half, a.y + ny * half);
        ctx.strokeStyle = '#fff1c9'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.lineCap = 'round';
    }
  }

  drawPads() {
    const ctx = this.ctx;
    for (const pad of this.scene.overlays.buildingPads) {
      this.path(pad.polygon, true);
      const traffic = this.layers.trafficability;
      if (!traffic) { ctx.fillStyle = 'rgba(210,111,166,0.55)'; ctx.fill(); }
      ctx.strokeStyle = traffic ? '#d6f5e1' : '#f3b6d7'; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  /**
   * Sandbox overlay `{ items, mode, pending, ghost, selectedId }`: placed test
   * pads/roads, the first point of a road being drawn (rubber band to the
   * cursor) and a ghost pad footprint following the cursor.
   */
  drawSandbox() {
    const sb = this.overlay.sandbox;
    if (!sb) return;
    const { ctx, viewport: v } = this, traffic = this.layers.trafficability;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const item of sb.items ?? []) {
      const selected = item.id === sb.selectedId;
      if (item.kind === 'pad') {
        this.path(item.polygon, true);
        ctx.fillStyle = 'rgba(92,225,255,0.22)'; ctx.fill();
        ctx.strokeStyle = selected ? '#ffffff' : '#5ce1ff'; ctx.lineWidth = selected ? 2.5 : 1.6;
        ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
      } else if (item.kind === 'road') {
        const w = Math.max(3, item.widthM / v.metersPerPixel), samples = item.profile.samples;
        this.path(item.points); ctx.strokeStyle = selected ? 'rgba(255,255,255,0.95)' : 'rgba(10,12,16,0.85)';
        ctx.lineWidth = w + (selected ? 5 : 2.5); ctx.stroke();
        // Cut/fill runs along the design grade (or passable green in the trafficability view).
        let run = [], kind = null;
        const flush = () => {
          if (run.length < 2) return;
          this.path(run); ctx.strokeStyle = traffic ? '#5ce1ff' : STRUCTURE_COLORS[kind] ?? STRUCTURE_COLORS['at-grade'];
          ctx.lineWidth = w; ctx.stroke();
        };
        for (let i = 0; i < samples.length - 1; i++) {
          const k = samples[i].segmentKind ?? samples[i].structureKind;
          if (k !== kind) { flush(); run = [samples[i]]; kind = k; }
          run.push(samples[i + 1]);
        }
        flush();
        this.path(item.points); ctx.strokeStyle = '#5ce1ff'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    const hover = this.hoverPoint;
    if (sb.mode === 'road' && sb.pending) {
      const s = v.toScreen(sb.pending.xM, sb.pending.yM);
      if (hover) {
        this.path([sb.pending, hover]); ctx.strokeStyle = 'rgba(92,225,255,0.85)'; ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
        const len = Math.hypot(hover.xM - sb.pending.xM, hover.yM - sb.pending.yM), t = v.toScreen(hover.xM, hover.yM);
        ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,14,0.85)'; ctx.strokeText(formatDistance(len), t.x + 10, t.y - 10);
        ctx.fillStyle = '#bff3ff'; ctx.fillText(formatDistance(len), t.x + 10, t.y - 10);
      }
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 2 * Math.PI); ctx.fillStyle = '#5ce1ff'; ctx.fill();
      ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 2; ctx.stroke();
    } else if (sb.mode === 'pad' && sb.ghost && hover && this.tool === 'sandbox') {
      this.path(rectanglePolygon({ xM: hover.xM, yM: hover.yM, ...sb.ghost }), true);
      ctx.fillStyle = 'rgba(92,225,255,0.12)'; ctx.fill();
      ctx.strokeStyle = 'rgba(92,225,255,0.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  crossingPoint(crossing) {
    const road = this.scene.overlays.roads.find(r => r.id === crossing.roadId);
    return road ? pointAlongPolyline(road.points, (crossing.startDistanceM + crossing.endDistanceM) / 2) : null;
  }

  drawCrossings() {
    const { ctx, viewport: v } = this;
    for (const c of this.scene.crossings) {
      const p = this.crossingPoint(c);
      if (!p) continue;
      const s = v.toScreen(p.xM, p.yM), focus = this.overlay.focusCrossingId === c.crossingId;
      ctx.beginPath(); ctx.arc(s.x, s.y, focus ? 9 : 6, 0, 2 * Math.PI);
      ctx.fillStyle = CROSSING_STATUS_COLORS[c.uiStatus] ?? '#ccc'; ctx.fill();
      ctx.strokeStyle = focus ? '#fff' : '#0b0e13'; ctx.lineWidth = focus ? 3 : 2; ctx.stroke();
    }
  }

  /** Junction, overpass and culvert symbols (culverts first so road crossings stay on top). */
  drawJunctions() {
    const { ctx, viewport: v } = this, { roadCrossings, culverts } = sceneJunctions(this.scene);
    const traffic = this.layers.trafficability;
    for (const f of [...culverts, ...roadCrossings]) {
      const s = v.toScreen(f.xM, f.yM);
      if (s.x < -30 || s.y < -30 || s.x > v.width + 30 || s.y > v.height + 30) continue;
      const focus = this.overlay.focusJunctionId === f.id, m = junctionMarker(f, { focused: focus });
      ctx.save(); ctx.translate(s.x, s.y);
      if (m.shape === 'culvert') {
        // Pipe along the flow direction with an arrow head at the outlet (screen y points down).
        const d = f.flowDirection ?? { x: 1, y: 0 }, angle = Math.atan2(-d.y, d.x), r = m.sizePx * 1.6;
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(8,10,14,0.85)'; ctx.fillRect(-r - 2, -m.sizePx / 2 - 2, 2 * r + 4, m.sizePx + 4);
        ctx.strokeStyle = m.color; ctx.lineWidth = 1.6; ctx.strokeRect(-r, -m.sizePx / 2, 2 * r, m.sizePx);
        ctx.beginPath(); ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.45, 0);
        ctx.moveTo(r * 0.45 - 3, -2.5); ctx.lineTo(r * 0.45, 0); ctx.lineTo(r * 0.45 - 3, 2.5); ctx.stroke();
      } else if (m.shape === 'overpass') {
        // Two deck edges along the upper road with splayed wing ends: a layered bridge symbol.
        const d = f.direction ?? { x: 1, y: 0 }, r = m.sizePx, w = m.sizePx * 0.6;
        ctx.rotate(Math.atan2(-d.y, d.x));
        ctx.fillStyle = 'rgba(8,10,14,0.75)'; ctx.fillRect(-r, -w, 2 * r, 2 * w);
        ctx.strokeStyle = traffic ? '#ffffff' : m.color; ctx.lineWidth = focus ? 3 : 2;
        ctx.beginPath();
        for (const side of [-1, 1]) {
          ctx.moveTo(-r - 3, side * (w + 3)); ctx.lineTo(-r, side * w); ctx.lineTo(r, side * w); ctx.lineTo(r + 3, side * (w + 3));
        }
        ctx.stroke();
        if (['insufficient-vertical-clearance', 'collision'].includes(f.status)) {
          ctx.fillStyle = m.color; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.rotate(-Math.atan2(-d.y, d.x)); ctx.fillText('!', 0, 0.5);
        }
      } else {
        ctx.beginPath(); ctx.arc(0, 0, m.sizePx, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(217,221,228,0.25)'; ctx.fill();
        ctx.strokeStyle = focus ? '#ffffff' : 'rgba(217,221,228,0.85)'; ctx.lineWidth = focus ? 2 : 1.2; ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawLabels() {
    const { ctx, viewport: v, scene } = this;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const label = (text, p, color = '#e6edf3', dx = 8) => {
      const s = v.toScreen(p.xM, p.yM);
      if (s.x < -50 || s.y < -20 || s.x > v.width + 50 || s.y > v.height + 20) return;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,10,14,0.85)'; ctx.strokeText(text, s.x + dx, s.y);
      ctx.fillStyle = color; ctx.fillText(text, s.x + dx, s.y);
    };
    for (const s of scene.overlays.settlements) {
      const p = v.toScreen(s.xM, s.yM);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
      label(s.name ?? s.id, s);
    }
    for (const body of scene.overlays.waterBodies) {
      const c = body.polygon.reduce((a, p) => ({ xM: a.xM + p.xM / body.polygon.length, yM: a.yM + p.yM / body.polygon.length }), { xM: 0, yM: 0 });
      label(`${body.id} (${body.kind})`, c, '#a9d8ff', -20);
    }
    if (v.metersPerPixel < 2) for (const pad of scene.overlays.buildingPads) label(pad.id, pad.centroid ?? pad.polygon[0], '#f3b6d7', 0);
    for (const road of scene.overlays.roads) {
      const mid = pointAlongPolyline(road.points, 0.08 * (road.lengthM ??= road.points.reduce((s, p, i, a) => i ? s + Math.hypot(p.xM - a[i - 1].xM, p.yM - a[i - 1].yM) : 0, 0)));
      label(road.id, mid, '#d9dde4');
    }
  }

  drawLodWindow() {
    const w = this.overlay.lodWindow;
    if (!w) return;
    this.path([{ xM: w.minXM, yM: w.minYM }, { xM: w.maxXM, yM: w.minYM }, { xM: w.maxXM, yM: w.maxYM }, { xM: w.minXM, yM: w.maxYM }], true);
    this.ctx.strokeStyle = '#c792ea'; this.ctx.lineWidth = 2; this.ctx.setLineDash([6, 4]); this.ctx.stroke(); this.ctx.setLineDash([]);
  }

  drawProfile() {
    const { ctx, viewport: v } = this, p = this.overlay.profile;
    // Road profiles are shown by the selected-road casing so structure colours stay visible.
    if (!p?.path?.length || p.kind === 'road') return;
    this.path(p.path);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = '#ffd866'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
    {
      for (const [pt, name] of [[p.path[0], 'A'], [p.path.at(-1), 'B']]) {
        const s = v.toScreen(pt.xM, pt.yM);
        ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, 2 * Math.PI); ctx.fillStyle = '#ffd866'; ctx.fill();
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#111'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(name, s.x, s.y + 0.5); ctx.textAlign = 'start';
      }
    }
  }

  drawMarkers() {
    const { ctx, viewport: v } = this;
    const ring = (p, color, r = 6) => {
      if (!p) return;
      const s = v.toScreen(p.xM, p.yM);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    };
    ring(this.overlay.cursor, '#ffd866', 6);
    if (this.overlay.pinned) {
      const s = v.toScreen(this.overlay.pinned.xM, this.overlay.pinned.yM);
      ctx.strokeStyle = '#ff7edb'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y); ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10); ctx.stroke();
      ring(this.overlay.pinned, '#ff7edb', 4);
    }
    if (this.overlay.highlight) ring(this.overlay.highlight, '#ffffff', 14);
  }

  drawScaleBar() {
    const { ctx, viewport: v } = this, { meters, pixels } = scaleBarLength(v.metersPerPixel, 110);
    const x = 14, y = v.height - 18;
    ctx.fillStyle = 'rgba(13,17,23,0.7)'; ctx.fillRect(x - 6, y - 18, pixels + 12, 26);
    ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + pixels, y); ctx.lineTo(x + pixels, y - 4); ctx.stroke();
    ctx.fillStyle = '#e6edf3'; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(formatDistance(meters), x + 2, y - 7);
    // North arrow.
    const nx = v.width - 22, ny = 30;
    ctx.beginPath(); ctx.moveTo(nx, ny - 12); ctx.lineTo(nx + 6, ny + 4); ctx.lineTo(nx, ny); ctx.lineTo(nx - 6, ny + 4); ctx.closePath();
    ctx.fillStyle = '#e6edf3'; ctx.fill();
    ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 16); ctx.textAlign = 'start';
  }

  // ---------- Hit testing ----------

  /** Most specific feature under a screen point: crossing → junction / culvert → road → pad → water body. */
  hitTest(x, y) {
    if (!this.scene) return null;
    const v = this.viewport, w = v.toWorld(x, y), o = this.scene.overlays;
    if (this.layers.crossings) for (const c of this.scene.crossings) {
      const p = this.crossingPoint(c), s = p && v.toScreen(p.xM, p.yM);
      if (s && Math.hypot(s.x - x, s.y - y) <= 9) return { kind: 'crossing', crossing: c, point: p };
    }
    if (this.layers.junctions) {
      const { roadCrossings, culverts } = sceneJunctions(this.scene);
      for (const f of [...roadCrossings, ...culverts]) {
        const s = v.toScreen(f.xM, f.yM);
        if (Math.hypot(s.x - x, s.y - y) <= Math.max(8, junctionMarker(f).sizePx + 3)) return { kind: 'junction', junction: f, point: { xM: f.xM, yM: f.yM } };
      }
    }
    let best = null;
    if (this.layers.roads) for (const road of o.roads) {
      const tol = Math.max(6, road.halfWidthM / v.metersPerPixel + 2);
      for (let i = 1; i < road.points.length; i++) {
        const a = v.toScreen(road.points[i - 1].xM, road.points[i - 1].yM), b = v.toScreen(road.points[i].xM, road.points[i].yM);
        const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y).distance;
        if (d <= tol && (!best || d < best.d)) best = { d, road };
      }
    }
    if (best) return { kind: 'road', road: best.road, point: w };
    if (this.layers.pads) for (const pad of o.buildingPads) if (pointInPolygon(w.xM, w.yM, pad.polygon)) return { kind: 'pad', pad, point: w };
    if (this.layers.waterBodies) for (const body of o.waterBodies) if (pointInPolygon(w.xM, w.yM, body.polygon)) return { kind: 'water-body', body, point: w };
    return null;
  }

  // ---------- Input ----------

  bindEvents() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('pointerdown', e => this.onPointerDown(e));
    c.addEventListener('pointermove', e => this.onPointerMove(e));
    c.addEventListener('pointerup', e => this.onPointerUp(e));
    c.addEventListener('pointercancel', () => { this.drag = null; });
    c.addEventListener('pointerleave', () => { this.hoverPoint = null; this.callbacks.onHover?.(null); if (this.tool === 'sandbox') this.requestFrame(); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.viewport.zoomAt(Math.exp(-dy * 0.0015), e.clientX - r.left, e.clientY - r.top, this.zoomLimits());
      this.viewChanged();
    }, { passive: false });
    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect();
      this.viewport.zoomAt(e.shiftKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top, this.zoomLimits());
      this.viewChanged();
    });
    c.addEventListener('keydown', e => {
      const step = 80, keys = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (keys[e.key]) { this.viewport.panPixels(...keys[e.key]); this.viewChanged(); e.preventDefault(); }
      else if (e.key === '+' || e.key === '=') this.zoomBy(1.5);
      else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.5);
    });
  }

  local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  onPointerDown(e) {
    if (e.button !== 0 || !this.scene) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e), v = this.viewport, prof = this.overlay.profile;
    // Grab an existing profile endpoint handle.
    if (prof?.kind === 'line') {
      for (const [index, pt] of [[0, prof.path[0]], [1, prof.path.at(-1)]]) {
        const s = v.toScreen(pt.xM, pt.yM);
        if (Math.hypot(s.x - p.x, s.y - p.y) <= 9) { this.drag = { mode: 'handle', index, start: p, moved: true }; return; }
      }
    }
    const profileMode = this.tool === 'profile' || e.shiftKey;
    this.drag = { mode: profileMode ? 'profile' : 'pan', start: p, last: p, moved: false, a: v.toWorld(p.x, p.y) };
  }

  onPointerMove(e) {
    const p = this.local(e), d = this.drag;
    if (d) {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) > 3) d.moved = true;
      if (d.mode === 'pan' && d.moved) {
        this.viewport.panPixels(p.x - d.last.x, p.y - d.last.y); d.last = p; this.viewChanged();
      } else if (d.mode === 'profile' && d.moved) {
        const b = this.viewport.toWorld(p.x, p.y);
        this.setOverlay({ profile: { kind: 'line', path: [d.a, b], draft: true } });
      } else if (d.mode === 'handle') {
        const path = [...this.overlay.profile.path], w = this.viewport.toWorld(p.x, p.y);
        path[d.index === 0 ? 0 : path.length - 1] = w;
        this.setOverlay({ profile: { ...this.overlay.profile, path, draft: true } });
      }
    }
    const w = this.viewport.toWorld(p.x, p.y);
    this.hoverPoint = w;
    const inside = this.scene && w.xM >= this.scene.bounds.minXM && w.xM <= this.scene.bounds.maxXM
      && w.yM >= this.scene.bounds.minYM && w.yM <= this.scene.bounds.maxYM;
    this.callbacks.onHover?.(inside ? w : null);
    if (this.tool === 'sandbox' && this.overlay.sandbox) this.requestFrame();
    this.canvas.style.cursor = d?.mode === 'pan' && d.moved ? 'grabbing' : this.hitTest(p.x, p.y) ? 'pointer' : '';
  }

  onPointerUp(e) {
    const d = this.drag, p = this.local(e);
    this.drag = null;
    if (!d) return;
    if ((d.mode === 'profile' && d.moved) || d.mode === 'handle') {
      const path = this.overlay.profile.path;
      const a = path[0], b = path.at(-1), s = this.viewport.toScreen(a.xM, a.yM), t = this.viewport.toScreen(b.xM, b.yM);
      if (Math.hypot(s.x - t.x, s.y - t.y) > 6) this.callbacks.onProfileLine?.(a, b);
      return;
    }
    if (!d.moved) this.callbacks.onClick?.({ point: this.viewport.toWorld(p.x, p.y), hit: this.hitTest(p.x, p.y), event: e });
  }

  destroy() { this.resizeObserver?.disconnect(); this.queue = []; this.tiles.clear(); }
}
