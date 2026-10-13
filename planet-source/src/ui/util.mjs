// Shared, DOM-free helpers for the Stage 5 visualizer. Everything here is safe
// to import in Node; DOM helpers only touch `document` when called.

/** World ↔ screen transform. x grows east, y grows north (screen y is flipped). */
export class Viewport {
  constructor({ centerXM = 0, centerYM = 0, metersPerPixel = 1, width = 1, height = 1 } = {}) {
    Object.assign(this, { centerXM, centerYM, metersPerPixel, width, height });
  }
  clone() { return new Viewport(this); }
  resize(width, height) { this.width = Math.max(1, width); this.height = Math.max(1, height); }
  toScreen(xM, yM) {
    return { x: this.width / 2 + (xM - this.centerXM) / this.metersPerPixel,
      y: this.height / 2 - (yM - this.centerYM) / this.metersPerPixel };
  }
  toWorld(x, y) {
    return { xM: this.centerXM + (x - this.width / 2) * this.metersPerPixel,
      yM: this.centerYM - (y - this.height / 2) * this.metersPerPixel };
  }
  get worldBounds() {
    const a = this.toWorld(0, this.height), b = this.toWorld(this.width, 0);
    return { minXM: a.xM, minYM: a.yM, maxXM: b.xM, maxYM: b.yM };
  }
  fit(bounds, padding = 24) {
    const w = bounds.maxXM - bounds.minXM, h = bounds.maxYM - bounds.minYM;
    this.centerXM = (bounds.minXM + bounds.maxXM) / 2; this.centerYM = (bounds.minYM + bounds.maxYM) / 2;
    this.metersPerPixel = Math.max(w / Math.max(1, this.width - 2 * padding), h / Math.max(1, this.height - 2 * padding), 1e-6);
  }
  /** Zoom by `factor` (>1 zooms in) keeping the world point under (x, y) fixed. */
  zoomAt(factor, x, y, { minMetersPerPixel = 1e-3, maxMetersPerPixel = 1e6 } = {}) {
    const anchor = this.toWorld(x, y);
    this.metersPerPixel = clamp(this.metersPerPixel / factor, minMetersPerPixel, maxMetersPerPixel);
    const moved = this.toWorld(x, y);
    this.centerXM += anchor.xM - moved.xM; this.centerYM += anchor.yM - moved.yM;
  }
  panPixels(dx, dy) { this.centerXM -= dx * this.metersPerPixel; this.centerYM += dy * this.metersPerPixel; }
  equals(o) {
    return o && o.centerXM === this.centerXM && o.centerYM === this.centerYM && o.metersPerPixel === this.metersPerPixel
      && o.width === this.width && o.height === this.height;
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Colour ----------

/** Hypsometric ramp (lowland green → upland tan → rock → snow), sampled by t in [0, 1]. */
const ELEVATION_STOPS = [
  [0.00, [38, 84, 66]], [0.12, [56, 112, 72]], [0.28, [104, 140, 82]], [0.45, [168, 164, 104]],
  [0.62, [176, 138, 92]], [0.78, [150, 118, 96]], [0.90, [178, 170, 164]], [1.00, [236, 236, 240]],
];
/** Below-datum (bathymetric) ramp used for ground under 0 m when the range spans sea level. */
const DEPTH_STOPS = [[0, [20, 54, 96]], [1, [52, 108, 150]]];
const WATER_STOPS = [[0, [92, 170, 222]], [0.35, [46, 124, 200]], [1, [18, 58, 130]]];

function ramp(stops, t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], u = (t - t0) / (t1 - t0 || 1);
      return [lerp(c0[0], c1[0], u), lerp(c0[1], c1[1], u), lerp(c0[2], c1[2], u)];
    }
  }
  return stops.at(-1)[1].slice();
}

/** Colour for a ground elevation. `range` is per-scene (never per-window), so pans/zooms never recolour. */
export function elevationColor(elevationM, range) {
  if (range.minM < 0 && elevationM < 0) return ramp(DEPTH_STOPS, 1 - elevationM / range.minM);
  const lo = range.minM < 0 ? 0 : range.minM;
  return ramp(ELEVATION_STOPS, (elevationM - lo) / Math.max(1e-9, range.maxM - lo));
}

/** Water tint by depth; depths ≥ `fullDepthM` reach the darkest blue. */
export function waterColor(depthM, fullDepthM = 6) {
  return ramp(WATER_STOPS, Math.sqrt(clamp(depthM / fullDepthM, 0, 1)));
}

/**
 * Lambertian hillshade from the canonical fixed-distance gradient (z up).
 * Returns 0..1; 0.5 ≈ flat ground under the default light.
 */
export function hillshade(gradient, { azimuthDeg = 315, altitudeDeg = 45, exaggeration = 1 } = {}) {
  const gx = gradient.x * exaggeration, gy = gradient.y * exaggeration;
  const az = azimuthDeg * Math.PI / 180, alt = altitudeDeg * Math.PI / 180;
  // Light direction in (east, north, up); azimuth is clockwise from north.
  const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  const n = Math.hypot(gx, gy, 1);
  return clamp((-gx * lx - gy * ly + lz) / n, 0, 1);
}

/** Shade a colour by a hillshade value; `strength` 0 leaves the colour unchanged. */
export function applyShade(rgb, shade, strength = 0.7, flatShade = Math.sin(Math.PI / 4)) {
  const k = 1 + strength * (shade - flatShade) * 1.6;
  return [clamp(rgb[0] * k, 0, 255), clamp(rgb[1] * k, 0, 255), clamp(rgb[2] * k, 0, 255)];
}

export const rgbCss = ([r, g, b], a = 1) => a === 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Colours shared by the map, profile chart, and panels for structure kinds. */
export const STRUCTURE_COLORS = Object.freeze({
  'bridge-deck': '#f2b84b', 'approach-ramp': '#e9d27a', 'at-grade': '#d9dde4', cut: '#e07b5a', fill: '#9b7be0',
  batter: '#b08a6a', 'building-pad': '#d26fa6', water: '#4aa3df', 'natural-ground': '#7d8a99', none: '#7d8a99',
});

export const CROSSING_STATUS_COLORS = Object.freeze({
  'bridge-designed': '#4fc38a', 'sampled-clearance-met': '#4fc38a', 'bridge-height-required': '#f2b84b',
  'insufficient-sampled-clearance': '#e0605a', 'design-failed': '#e0605a',
});

// ---------- Geometry ----------

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].xM - points[i - 1].xM, points[i].yM - points[i - 1].yM);
  return total;
}

/** Point at an arc length along a polyline (clamped to its ends). */
export function pointAlongPolyline(points, distanceM) {
  if (distanceM <= 0) return { xM: points[0].xM, yM: points[0].yM };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    if (walked + len >= distanceM && len > 0) {
      const t = (distanceM - walked) / len;
      return { xM: lerp(a.xM, b.xM, t), yM: lerp(a.yM, b.yM, t) };
    }
    walked += len;
  }
  const last = points.at(-1);
  return { xM: last.xM, yM: last.yM };
}

/** Sub-polyline between two arc lengths (inclusive), used to draw bridge spans. */
export function slicePolyline(points, fromM, toM) {
  const out = [pointAlongPolyline(points, fromM)];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    walked += Math.hypot(points[i].xM - points[i - 1].xM, points[i].yM - points[i - 1].yM);
    if (walked > fromM && walked < toM) out.push({ xM: points[i].xM, yM: points[i].yM });
  }
  out.push(pointAlongPolyline(points, toM));
  return out;
}

export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return { distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

export function pointInPolygon(xM, yM, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.yM > yM) !== (b.yM > yM) && xM < (b.xM - a.xM) * (yM - a.yM) / (b.yM - a.yM) + a.xM) inside = !inside;
  }
  return inside;
}

export function boundsOfPoints(points, pad = 0) {
  let minXM = Infinity, minYM = Infinity, maxXM = -Infinity, maxYM = -Infinity;
  for (const p of points) {
    minXM = Math.min(minXM, p.xM); maxXM = Math.max(maxXM, p.xM);
    minYM = Math.min(minYM, p.yM); maxYM = Math.max(maxYM, p.yM);
  }
  return { minXM: minXM - pad, minYM: minYM - pad, maxXM: maxXM + pad, maxYM: maxYM + pad };
}

export const insideBounds = (b, xM, yM) => xM >= b.minXM && xM <= b.maxXM && yM >= b.minYM && yM <= b.maxYM;

/** Rectangle pad (center, size, rotation) → polygon. */
export function rectanglePolygon({ xM, yM, widthM, depthM, rotationDeg = 0 }) {
  const c = Math.cos(rotationDeg * Math.PI / 180), s = Math.sin(rotationDeg * Math.PI / 180);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const dx = u * widthM / 2, dy = v * depthM / 2;
    return { xM: xM + dx * c - dy * s, yM: yM + dx * s + dy * c };
  });
}

// ---------- Axes & formatting ----------

/** "Nice" tick values covering [min, max] with roughly `count` ticks. */
export function niceTicks(min, max, count = 6) {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count), mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  const step = (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) return value.toExponential(Math.max(1, digits));
  return value.toFixed(digits);
}

export const formatMeters = (value, digits = 2) => value === null || value === undefined ? '—' : `${formatNumber(value, digits)} m`;

export function formatDistance(meters) {
  if (meters === null || meters === undefined) return '—';
  return Math.abs(meters) >= 1000 ? `${formatNumber(meters / 1000, 2)} km` : `${formatNumber(meters, meters < 10 ? 2 : 1)} m`;
}

export const shortId = (id, n = 10) => typeof id === 'string' && id.length > n + 8 ? `${id.slice(0, id.indexOf(':') + 1 + n)}…` : id ?? '—';

/** Choose a round scale-bar length (1-2-5 series) close to `targetPx` pixels. */
export function scaleBarLength(metersPerPixel, targetPx = 120) {
  const raw = metersPerPixel * targetPx, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  const meters = (r >= 5 ? 5 : r >= 2 ? 2 : 1) * mag;
  return { meters, pixels: meters / metersPerPixel };
}

// ---------- DOM / canvas (only touch globals when called) ----------

/** Tiny hyperscript: h('div', { class: 'x', onclick }, child, ...). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Size a canvas backing store to its CSS box × devicePixelRatio. Returns CSS size and ratio. */
export function fitCanvas(canvas) {
  const ratio = globalThis.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  return { width, height, ratio };
}

/** Read a CSS custom property from the document root (fallback when unavailable). */
export function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Yield to the event loop so long synchronous steps can repaint progress UI. */
export const nextFrame = () => new Promise(resolve => (globalThis.requestAnimationFrame ?? (f => setTimeout(f, 0)))(() => resolve()));
