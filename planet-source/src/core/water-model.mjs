import {validatePlanarBed,createPlanarRiverBed} from './planar-river-bed.mjs';
import { finiteNumber, positiveNumber, nonEmptyText, validateElevationInterval, validateMetricDisk } from './contract-validation.mjs';
import { segmentGridCuts, quadraticVertex } from './field-math.mjs';
import { hermiteSegmentMinimum } from './bernstein.mjs';

export const WATER_SCHEMA = 'minimal-world-surface-water@2';
export const LEGACY_WATER_SCHEMA = 'minimal-world-surface-water@1';
const EPS = 1e-8;
const cross = (a, b, c) => (b.xM - a.xM) * (c.yM - a.yM) - (b.yM - a.yM) * (c.xM - a.xM);
export const distance = (a, b) => Math.hypot(b.xM - a.xM, b.yM - a.yM);

export function insidePolygon(p, polygon) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (onSegment(p, a, b)) return true;
    if ((a.yM > p.yM) !== (b.yM > p.yM)
      && p.xM < a.xM + (p.yM - a.yM) * (b.xM - a.xM) / (b.yM - a.yM)) inside = !inside;
  }
  return inside;
}

function onSegment(p, a, b) {
  return Math.abs(cross(a, b, p)) <= EPS * Math.max(1, distance(a, b))
    && p.xM >= Math.min(a.xM, b.xM) - EPS && p.xM <= Math.max(a.xM, b.xM) + EPS
    && p.yM >= Math.min(a.yM, b.yM) - EPS && p.yM <= Math.max(a.yM, b.yM) + EPS;
}

// Concave polygons may intersect a segment in several disjoint intervals.
export function segmentIntervals(a, b, polygon) {
  const hits = [0, 1];
  const length = distance(a, b);
  if (length < EPS) return insidePolygon(a, polygon) ? [[0, 1]] : [];
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length];
    const ux = b.xM - a.xM, uy = b.yM - a.yM, vx = d.xM - c.xM, vy = d.yM - c.yM;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-12) {
      for (const p of [c, d]) if (onSegment(p, a, b)) hits.push(((p.xM - a.xM) * ux + (p.yM - a.yM) * uy) / length ** 2);
      continue;
    }
    const wx = c.xM - a.xM, wy = c.yM - a.yM;
    const t = (wx * vy - wy * vx) / det, s = (wx * uy - wy * ux) / det;
    if (t >= -1e-10 && t <= 1 + 1e-10 && s >= -1e-10 && s <= 1 + 1e-10) hits.push(Math.max(0, Math.min(1, t)));
  }
  const sorted = [...new Set(hits)].sort((x, y) => x - y), result = [];
  const at = t => ({ xM: a.xM + (b.xM - a.xM) * t, yM: a.yM + (b.yM - a.yM) * t });
  for (let i = 1; i < sorted.length; i++) {
    const start = sorted[i - 1], end = sorted[i];
    if (end - start > 1e-12 && insidePolygon(at((start + end) / 2), polygon)) {
      if (result.length && Math.abs(result.at(-1)[1] - start) < 1e-10) result.at(-1)[1] = end;
      else result.push([start, end]);
    }
  }
  for (const t of sorted) if (insidePolygon(at(t), polygon) && !result.some(([lo, hi]) => t >= lo - EPS && t <= hi + EPS)) result.push([t, t]);
  return result.sort((x, y) => x[0] - y[0]);
}

// Envelope helper; use segmentIntervals when gaps matter.
export function clipSegment(a, b, polygon) {
  const intervals = segmentIntervals(a, b, polygon);
  return intervals.length ? [intervals[0][0], intervals.at(-1)[1]] : null;
}

export function validateBodies(bodies, bounds) {
  if (!Array.isArray(bodies) || bodies.length > 128) throw new RangeError('At most 128 water bodies are supported');
  const ids = new Set();
  for (const body of bodies) {
    nonEmptyText(body.id, 'water body ID');
    if (ids.has(body.id)) throw new TypeError('Water body IDs must be unique strings');
    ids.add(body.id);
    if (!['lake', 'ocean'].includes(body.kind)) throw new TypeError('Body kind and water level are required');
    finiteNumber(body.waterLevelElevationM, 'body.waterLevelElevationM');
    if (!Array.isArray(body.polygon) || body.polygon.length < 3 || body.polygon.length > 128) throw new RangeError('Body polygon needs 3 to 128 vertices');
    let area = 0;
    for (let i = 0; i < body.polygon.length; i++) {
      const a = body.polygon[i], b = body.polygon[(i + 1) % body.polygon.length];
      if (!Number.isFinite(a.xM) || !Number.isFinite(a.yM)
        || a.xM < bounds.minXM || a.xM > bounds.maxXM || a.yM < bounds.minYM || a.yM > bounds.maxYM) throw new RangeError('Body polygon must be inside the region');
      if (distance(a, b) < 1e-8) throw new RangeError('Duplicate body polygon vertices');
      area += a.xM * b.yM - b.xM * a.yM;
    }
    if (Math.abs(area) < EPS) throw new RangeError('Degenerate body polygon');
    for (let i = 0; i < body.polygon.length; i++) for (let j = i + 2; j < body.polygon.length; j++) {
      if (i === 0 && j === body.polygon.length - 1) continue;
      const a = body.polygon[i], b = body.polygon[(i + 1) % body.polygon.length];
      const c = body.polygon[j], d = body.polygon[(j + 1) % body.polygon.length];
      if (segmentsTouch(a, b, c, d)) {
        throw new RangeError('Self-intersecting body polygon');
      }
    }
  }
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    const touching = a.polygon.some(p => insidePolygon(p, b.polygon)) || b.polygon.some(p => insidePolygon(p, a.polygon))
      || a.polygon.some((p, k) => clipSegment(p, a.polygon[(k + 1) % a.polygon.length], b.polygon));
    if (touching && a.waterLevelElevationM !== b.waterLevelElevationM) throw new RangeError('Touching bodies must share a water level');
  }
}

function segmentsTouch(a, b, c, d) {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

export function topologicalOrder(nodes, edges) {
  const degrees = new Map(nodes.map(n => [n.id, 0])), outgoing = new Map(nodes.map(n => [n.id, []]));
  if (degrees.size !== nodes.length) throw new TypeError('Duplicate river node ID');
  for (const edge of edges) {
    if (!degrees.has(edge.from) || !degrees.has(edge.to)) throw new TypeError('Invalid river edge endpoints');
    degrees.set(edge.to, degrees.get(edge.to) + 1); outgoing.get(edge.from).push(edge.to);
  }
  const queue = nodes.filter(n => degrees.get(n.id) === 0).map(n => n.id);
  for (let i = 0; i < queue.length; i++) for (const to of outgoing.get(queue[i])) {
    degrees.set(to, degrees.get(to) - 1); if (!degrees.get(to)) queue.push(to);
  }
  if (queue.length !== nodes.length) throw new RangeError('River graph must be acyclic');
  return queue;
}

export function crossSections(points) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const incoming = i ? { x: (p.xM - a.xM) / distance(a, p), y: (p.yM - a.yM) / distance(a, p) } : null;
    const outgoing = i < points.length - 1 ? { x: (b.xM - p.xM) / distance(p, b), y: (b.yM - p.yM) / distance(p, b) } : null;
    let nx = -(incoming?.y ?? outgoing.y) - (outgoing?.y ?? incoming.y);
    let ny = (incoming?.x ?? outgoing.x) + (outgoing?.x ?? incoming.x);
    const len = Math.hypot(nx, ny);
    if (len < 1e-8) throw new RangeError('River reverses at a control point');
    nx /= len; ny /= len;
    const t = outgoing ?? incoming, factor = Math.min(2, 1 / (nx * -t.y + ny * t.x));
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('River turn is too sharp for this channel width');
    const outer = p.halfWidthM + p.bankWidthM;
    return [-outer, -p.halfWidthM, 0, p.halfWidthM, outer].map((offset, j) => ({
      xM: p.xM + nx * factor * offset, yM: p.yM + ny * factor * offset,
      level: p.waterLevelElevationM, depth: j === 2 ? p.depthM : 0,
      influence: j === 0 || j === 4 ? 0 : 1,
    }));
  });
}

export function fitChannelWidth(edge) {
  const points = edge.points;
  for (let attempt = 0; attempt < 3; attempt++) {
    const sections = crossSections(points);
    let folded = false;
    for (let i = 1; i < sections.length; i++) for (let j = 0; j < 4; j++) {
      if (cross(sections[i - 1][j], sections[i][j], sections[i][j + 1]) <= 1e-9
        || cross(sections[i - 1][j], sections[i][j + 1], sections[i - 1][j + 1]) <= 1e-9) folded = true;
    }
    if (!folded) return { scale: 2 ** -attempt, sections };
    for (const p of points) { p.halfWidthM *= 0.5; p.bankWidthM *= 0.5; }
  }
  throw new RangeError(`Cannot fit channel width to river geometry: ${edge.id}`);
}

function segmentMinimum(a, b, grid, frame, valueAt) {
  const sorted = segmentGridCuts(a, b, grid, frame);
  const sample = t => valueAt(a.xM * (1 - t) + b.xM * t, a.yM * (1 - t) + b.yM * t, t);
  let minimum = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const t0 = sorted[i - 1], t1 = sorted[i], f0 = sample(t0), f1 = sample(t1), fm = sample((t0 + t1) / 2);
    minimum = Math.min(minimum, f0, f1);
    const vertex = quadraticVertex(f0, fm, f1, { minimumOnly: true });
    if (vertex !== null) minimum = Math.min(minimum, sample(t0 + (t1 - t0) * vertex));
  }
  return { minimum, intervals: sorted.length - 1 };
}

export function validateBodyBoundaries(bodies, bounds, grid, frame, baseGroundAt) {
  let intervals = 0;
  for (const body of bodies) for (let i = 0; i < body.polygon.length; i++) {
    const a = body.polygon[i], b = body.polygon[(i + 1) % body.polygon.length];
    const onCut = (a.xM === b.xM && [bounds.minXM, bounds.maxXM].includes(a.xM)) || (a.yM === b.yM && [bounds.minYM, bounds.maxYM].includes(a.yM));
    if (onCut) continue;
    const result = baseGroundAt.segmentPolynomials
      ? hermiteSegmentMinimum(baseGroundAt, a, b, body.waterLevelElevationM, body.waterLevelElevationM)
      : baseGroundAt.segmentMinimum ? baseGroundAt.segmentMinimum(a, b, body.waterLevelElevationM, body.waterLevelElevationM)
      : segmentMinimum(a, b, grid, frame, (x, y) => baseGroundAt(x, y) - body.waterLevelElevationM);
    intervals += result.intervals;
    if (result.minimum < -1e-8) throw new RangeError(`Wet body envelope boundary: ${body.id}; expand it to dry ground`);
  }
  return intervals;
}

function barycentric(triangle, p) {
  const u = cross(triangle.b, triangle.c, p) / triangle.area;
  const v = cross(triangle.c, triangle.a, p) / triangle.area;
  return { u, v, w: 1 - u - v };
}
function triangleValue(triangle, weights, name) {
  return weights.u * triangle.a[name] + weights.v * triangle.b[name] + weights.w * triangle.c[name];
}
function polygonIntersection(subject, clip) {
  let result = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], previous = result;
    result = [];
    if (!previous.length) break;
    for (let j = 0; j < previous.length; j++) {
      const c = previous[j], d = previous[(j + 1) % previous.length], fc = cross(a, b, c), fd = cross(a, b, d);
      const cInside = fc >= -1e-9, dInside = fd >= -1e-9;
      if (cInside) result.push(c);
      if (cInside !== dInside) {
        const t = fc / (fc - fd);
        result.push({ xM: c.xM * (1 - t) + d.xM * t, yM: c.yM * (1 - t) + d.yM * t });
      }
    }
  }
  return result;
}

/** Rebuilds a spatial index; no functions or index entries are persisted. */
export function compileSurfaceWater(model, bounds, grid, frame, baseGroundAt, { fitWidths = false } = {}) {
  if (![WATER_SCHEMA, LEGACY_WATER_SCHEMA].includes(model.schema)) throw new TypeError('Unsupported surface water schema');
  validatePlanarBed(model.bed);
  const modern = model.schema === WATER_SCHEMA;
  if (modern && !['strip-with-open-cuts@2', 'strip-with-directional-open-cuts@3', 'strip-with-smooth-banks@4'].includes(model.construction)) throw new TypeError('Unsupported channel construction');
  const smoothBanks = modern && model.construction === 'strip-with-smooth-banks@4';
  const directionalCuts = modern && model.construction !== 'strip-with-open-cuts@2';
  validateBodies(model.bodies, bounds);
  const bodyBoundaryIntervals = validateBodyBoundaries(model.bodies, bounds, grid, frame, baseGroundAt);
  if (!Array.isArray(model.nodes) || model.nodes.length > 4096 || !Array.isArray(model.edges) || model.edges.length > 2048) throw new RangeError('Surface water graph exceeds limits');
  const nodes = new Map();
  for (const n of model.nodes) {
    nonEmptyText(n.id, 'river node ID');
    if (nodes.has(n.id)) throw new TypeError('Invalid or duplicate river node');
    for (const name of ['xM', 'yM', 'waterLevelElevationM']) finiteNumber(n[name], `river node.${name}`);
    if (n.bodyId) {
      const body = model.bodies.find(b => b.id === n.bodyId);
      if (!body || !insidePolygon(n, body.polygon) || n.waterLevelElevationM !== body.waterLevelElevationM) throw new RangeError('Invalid river/body anchor');
    }
    if (n.xM < bounds.minXM || n.xM > bounds.maxXM || n.yM < bounds.minYM || n.yM > bounds.maxYM) throw new RangeError('River node outside region');
    if (modern && n.kind === 'regional-boundary' && ![bounds.minXM, bounds.maxXM].includes(n.xM)
      && ![bounds.minYM, bounds.maxYM].includes(n.yM)) throw new RangeError('Regional boundary node must be on the region perimeter');
    nodes.set(n.id, n);
  }
  const bucketSize = Math.max(10, grid.cellSizeM);
  const buckets = new Map(), triangles = [], edgeIds = new Set();
  const key = (x, y) => `${x},${y}`;
  const addRawTriangle = (a, b, c, edgeId) => {
    const area = cross(a, b, c);
    if (!(area > 1e-9)) throw new RangeError(`Folded river channel mesh: ${edgeId}`);
    if (triangles.length >= 131072) throw new RangeError('River channel mesh exceeds 131072 triangles');
    const triangle = { a, b, c, area, edgeId,
      wetCore: a.depth > 0 || b.depth > 0 || c.depth > 0,
      minX: Math.min(a.xM, b.xM, c.xM), maxX: Math.max(a.xM, b.xM, c.xM),
      minY: Math.min(a.yM, b.yM, c.yM), maxY: Math.max(a.yM, b.yM, c.yM) };
    const index = triangles.push(triangle) - 1;
    for (let y = Math.floor(triangle.minY / bucketSize); y <= Math.floor(triangle.maxY / bucketSize); y++) {
      for (let x = Math.floor(triangle.minX / bucketSize); x <= Math.floor(triangle.maxX / bucketSize); x++) {
        const k = key(x, y), entries = buckets.get(k) ?? []; entries.push(index); buckets.set(k, entries);
      }
    }
  };
  function addTriangle(a, b, c, edgeId) {
    if (!(cross(a, b, c) > 1e-9)) throw new RangeError(`Folded river channel mesh: ${edgeId}`);
    if (!modern) return addRawTriangle(a, b, c, edgeId);
    let polygon = [a, b, c];
    for (const [axis, limit, sign] of [['xM', bounds.minXM, 1], ['xM', bounds.maxXM, -1],
      ['yM', bounds.minYM, 1], ['yM', bounds.maxYM, -1]]) {
      const previous = polygon; polygon = [];
      for (let i = 0; i < previous.length; i++) {
        const p = previous[i], q = previous[(i + 1) % previous.length];
        const insideP = sign * (p[axis] - limit) >= 0, insideQ = sign * (q[axis] - limit) >= 0;
        if (insideP) polygon.push(p);
        if (insideP !== insideQ) {
          const t = (limit - p[axis]) / (q[axis] - p[axis]), point = {};
          for (const name of ['xM', 'yM', 'level', 'depth', 'influence']) point[name] = p[name] * (1 - t) + q[name] * t;
          point[axis] = limit; polygon.push(point);
        }
      }
    }
    for (let i = 2; i < polygon.length; i++) if (cross(polygon[0], polygon[i - 1], polygon[i]) > 1e-9) {
      addRawTriangle(polygon[0], polygon[i - 1], polygon[i], edgeId);
    }
  }
  function cap(point, tangent, direction, edgeId) {
    const outer = point.halfWidthM + point.bankWidthM, segments = 8;
    const center = { xM: point.xM, yM: point.yM, level: point.waterLevelElevationM, depth: point.depthM, influence: 1 };
    const angle = Math.atan2(tangent.y * direction, tangent.x * direction) - Math.PI / 2;
    const ring = (radius, influence) => Array.from({ length: segments + 1 }, (_, i) => ({
      xM: point.xM + Math.cos(angle + i * Math.PI / segments) * radius,
      yM: point.yM + Math.sin(angle + i * Math.PI / segments) * radius,
      level: point.waterLevelElevationM, depth: 0, influence,
    }));
    const inner = ring(point.halfWidthM, 1), bank = ring(outer, 0);
    for (let i = 1; i <= segments; i++) {
      addTriangle(center, inner[i - 1], inner[i], edgeId);
      addTriangle(inner[i - 1], bank[i - 1], bank[i], edgeId);
      addTriangle(inner[i - 1], bank[i], inner[i], edgeId);
    }
  }
  const geometryWidthScales = [];
  for (const edge of model.edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!edge.id || edgeIds.has(edge.id) || !from || !to || !Array.isArray(edge.points) || edge.points.length < 2) throw new TypeError('Invalid river edge');
    edgeIds.add(edge.id);
    if (distance(from, edge.points[0]) > EPS || distance(to, edge.points.at(-1)) > EPS
      || edge.points[0].waterLevelElevationM !== from.waterLevelElevationM
      || edge.points.at(-1).waterLevelElevationM !== to.waterLevelElevationM) throw new RangeError('River endpoint coordinates and water levels must match nodes');
    for (let i = 0; i < edge.points.length; i++) {
      const p = edge.points[i];
      for (const name of ['xM', 'yM', 'waterLevelElevationM']) finiteNumber(p[name], `river profile.${name}`);
      for (const name of ['depthM', 'halfWidthM', 'bankWidthM']) positiveNumber(p[name], `river profile.${name}`);
      if (p.xM < bounds.minXM || p.xM > bounds.maxXM || p.yM < bounds.minYM || p.yM > bounds.maxYM) throw new RangeError('River point outside region');
      if (i && (distance(edge.points[i - 1], p) < 1e-8 || p.waterLevelElevationM > edge.points[i - 1].waterLevelElevationM)) throw new RangeError('River profiles must flow downhill');
    }
    const fitted = fitWidths ? fitChannelWidth(edge) : null;
    const sections = fitted?.sections ?? crossSections(edge.points);
    geometryWidthScales.push({ edgeId: edge.id, scale: fitted?.scale ?? 1 });
    if (directionalCuts) {
      // Extend a constant endpoint section past the cut plane, then clip. Ending
      // at a normal section through the node leaves half an oblique opening dry.
      const extendCut = (at, neighbor, section) => {
        const length = distance(at, neighbor), dx = (at.xM - neighbor.xM) / length, dy = (at.yM - neighbor.yM) / length;
        const outward = Math.max(at.xM === bounds.minXM ? -dx : 0, at.xM === bounds.maxXM ? dx : 0,
          at.yM === bounds.minYM ? -dy : 0, at.yM === bounds.maxYM ? dy : 0);
        if (!(outward > 0)) throw new RangeError('Regional boundary channel must point outward');
        const extension = 2 * (at.halfWidthM + at.bankWidthM) / outward;
        return section.map(p => ({ ...p, xM: p.xM + dx * extension, yM: p.yM + dy * extension }));
      };
      if (from.kind === 'regional-boundary') sections.unshift(extendCut(edge.points[0], edge.points[1], sections[0]));
      if (to.kind === 'regional-boundary') sections.push(extendCut(edge.points.at(-1), edge.points.at(-2), sections.at(-1)));
    }
    for (let i = 1; i < sections.length; i++) for (let j = 0; j < 4; j++) {
      addTriangle(sections[i - 1][j], sections[i][j], sections[i][j + 1], edge.id);
      addTriangle(sections[i - 1][j], sections[i][j + 1], sections[i - 1][j + 1], edge.id);
    }
    const first = edge.points[0], next = edge.points[1], last = edge.points.at(-1), before = edge.points.at(-2);
    if (!modern || from.kind !== 'regional-boundary') cap(first, { x: (next.xM - first.xM) / distance(first, next), y: (next.yM - first.yM) / distance(first, next) }, -1, edge.id);
    if (!modern || to.kind !== 'regional-boundary') cap(last, { x: (last.xM - before.xM) / distance(before, last), y: (last.yM - before.yM) / distance(before, last) }, 1, edge.id);
  }
  if (modern) {
    // A persisted topological certificate is checked in O(V+E), never trusted.
    const order = model.topologyOrder;
    if (!Array.isArray(order) || order.length !== nodes.size || new Set(order).size !== nodes.size
      || order.some(id => !nodes.has(id))) throw new RangeError('Invalid river topology order');
    const rank = new Map(order.map((id, i) => [id, i]));
    if (model.edges.some(e => rank.get(e.from) >= rank.get(e.to))) throw new RangeError('River topology order must be acyclic');
  } else topologicalOrder(model.nodes, model.edges);
  const graphEdges = new Map(model.edges.map(e => [e.id, e]));
  // Check intersecting wet mesh interiors before accepting a saved model. This
  // catches crossing/reversing centerlines even when each individual strip fits.
  for (const [bucket, entries] of buckets) for (let i = 0; i < entries.length; i++) {
    const a = triangles[entries[i]];
    if (!a.wetCore) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const b = triangles[entries[j]];
      if (!b.wetCore || a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) continue;
      const firstBucket = key(Math.floor(Math.max(a.minX, b.minX) / bucketSize), Math.floor(Math.max(a.minY, b.minY) / bucketSize));
      if (bucket !== firstBucket) continue;
      const intersection = polygonIntersection([a.a, a.b, a.c], [b.a, b.b, b.c]);
      if (intersection.length < 3) continue;
      let area = 0;
      for (let k = 2; k < intersection.length; k++) area += cross(intersection[0], intersection[k - 1], intersection[k]);
      if (Math.abs(area) < 1e-8) continue;
      if (a.edgeId === b.edgeId) {
        throw new RangeError(`River channel self-overlap: ${a.edgeId}`);
      }
      const center = { xM: intersection.reduce((sum, p) => sum + p.xM, 0) / intersection.length,
        yM: intersection.reduce((sum, p) => sum + p.yM, 0) / intersection.length };
      if (a.edgeId !== b.edgeId) {
        const ea = graphEdges.get(a.edgeId), eb = graphEdges.get(b.edgeId);
        const shareNode = [ea.from, ea.to].some(id => id === eb.from || id === eb.to);
        const ba = [nodes.get(ea.from).bodyId, nodes.get(ea.to).bodyId].filter(Boolean);
        const sharedBody = model.bodies.find(body => ba.includes(body.id)
          && [nodes.get(eb.from).bodyId, nodes.get(eb.to).bodyId].includes(body.id) && insidePolygon(center, body.polygon));
        if (!shareNode && !sharedBody) throw new RangeError(`River channels overlap without a shared node: ${a.edgeId} / ${b.edgeId}`);
      }
      for (const p of [center, ...intersection]) {
        const wa = barycentric(a, p), wb = barycentric(b, p);
        if (triangleValue(a, wa, 'depth') > 1e-8 && triangleValue(b, wb, 'depth') > 1e-8
          && Math.abs(triangleValue(a, wa, 'level') - triangleValue(b, wb, 'level')) > 1e-6) {
          throw new RangeError(`Overlapping river surfaces have incompatible levels: ${a.edgeId} / ${b.edgeId}`);
        }
      }
    }
  }
  const regionPolygon = [{ xM: bounds.minXM, yM: bounds.minYM }, { xM: bounds.maxXM, yM: bounds.minYM },
    { xM: bounds.maxXM, yM: bounds.maxYM }, { xM: bounds.minXM, yM: bounds.maxYM }];
  for (const triangle of triangles) {
    const vertices = [triangle.a, triangle.b, triangle.c];
    for (let i = 0; i < 3; i++) {
      const a = vertices[i], b = vertices[(i + 1) % 3];
      if (a.influence !== 0 || b.influence !== 0) continue;
      const clip = clipSegment(a, b, regionPolygon);
      if (!clip || clip[1] - clip[0] < 1e-12) continue;
      const endpoint = t => ({ xM: a.xM * (1 - t) + b.xM * t, yM: a.yM * (1 - t) + b.yM * t, level: a.level * (1 - t) + b.level * t });
      const c = endpoint(clip[0]), d = endpoint(clip[1]);
      if (baseGroundAt.segmentPolynomials || baseGroundAt.segmentMinimum) {
        const marks = new Set([0, 1]);
        for (const body of model.bodies) for (const [lo, hi] of segmentIntervals(c, d, body.polygon)) { marks.add(lo); marks.add(hi); }
        const cuts = [...marks].sort((x, y) => x - y), at = t => ({ xM: c.xM * (1 - t) + d.xM * t,
          yM: c.yM * (1 - t) + d.yM * t, level: c.level * (1 - t) + d.level * t });
        for (let k = 1; k < cuts.length; k++) {
          const p = at(cuts[k - 1]), q = at(cuts[k]), mid = at((cuts[k - 1] + cuts[k]) / 2);
          if (model.bodies.some(body => insidePolygon(mid, body.polygon)
            && Math.abs(body.waterLevelElevationM - p.level) < 1e-6 && Math.abs(body.waterLevelElevationM - q.level) < 1e-6)) continue;
          const result = baseGroundAt.segmentPolynomials ? hermiteSegmentMinimum(baseGroundAt, p, q, p.level, q.level)
            : baseGroundAt.segmentMinimum(p, q, p.level, q.level);
          if (result.minimum < -1e-8) throw new RangeError(`Wet river bank boundary: ${triangle.edgeId}`);
        }
        continue;
      }
      const result = segmentMinimum(c, d, grid, frame, (xM, yM, t) => {
        const level = c.level * (1 - t) + d.level * t;
        if (model.bodies.some(body => insidePolygon({ xM, yM }, body.polygon) && Math.abs(body.waterLevelElevationM - level) < 1e-6)) return 0;
        return baseGroundAt(xM, yM) - level;
      });
      if (result.minimum < -1e-8) throw new RangeError(`Wet river bank boundary: ${triangle.edgeId}`);
    }
  }
  if (model.basins !== null) {
    const count = grid.columns * grid.rows;
    if (!model.basins || typeof model.basins.namespace !== 'string' || !model.basins.namespace
      || model.basins.indices.length !== count || model.basins.outletCellIndices.length !== count
      || !model.basins.indices.every(n => Number.isSafeInteger(n) && n >= 0)
      || !model.basins.outletCellIndices.every(n => Number.isSafeInteger(n) && n >= 0 && n < count)) throw new TypeError('Invalid basin grid');
  }

  const smoothField=model.bed?createPlanarRiverBed(model,bounds):null;

  // S'(0)=S'(1)=0 joins the outer bank to the original ground without
  // introducing a normal derivative jump. Interior triangles remain C0.
  const bankInfluence = value => {
    const t = Math.max(0, Math.min(1, value));
    return smoothBanks ? t * t * (3 - 2 * t) : t;
  };
  function sampleGround(xM, yM, base = baseGroundAt(xM, yM)) {
    if(smoothField)return smoothField.sample(xM,yM,base).groundElevationM;
    const p = { xM, yM };
    let ground = base;
    const entries = buckets.get(key(Math.floor(xM / bucketSize), Math.floor(yM / bucketSize))) ?? [];
    for (const index of entries) {
      const t = triangles[index];
      if (xM < t.minX - EPS || xM > t.maxX + EPS || yM < t.minY - EPS || yM > t.maxY + EPS) continue;
      const weights = barycentric(t, p);
      if (weights.u < -1e-10 || weights.v < -1e-10 || weights.w < -1e-10) continue;
      const influence = bankInfluence(triangleValue(t, weights, 'influence'));
      ground = Math.min(ground, base * (1 - influence)
        + (triangleValue(t, weights, 'level') - triangleValue(t, weights, 'depth')) * influence);
    }
    return ground;
  }

  function sample(xM, yM, base = baseGroundAt(xM, yM)) {
    const p = { xM, yM };
    let ground = base, level = null;
    const wetSources = new Set();
    if(smoothField){const v=smoothField.sample(xM,yM,base);ground=v.groundElevationM;level=v.waterLevelElevationM;for(const id of v.waterSourceIds)wetSources.add(id);}
    else {
    const entries = buckets.get(key(Math.floor(xM / bucketSize), Math.floor(yM / bucketSize))) ?? [];
    for (const index of entries) {
      const t = triangles[index];
      if (xM < t.minX - EPS || xM > t.maxX + EPS || yM < t.minY - EPS || yM > t.maxY + EPS) continue;
      const { u, v, w } = barycentric(t, p);
      if (u < -1e-10 || v < -1e-10 || w < -1e-10) continue;
      const mix = name => u * t.a[name] + v * t.b[name] + w * t.c[name];
      const localLevel = mix('level'), depth = mix('depth');
      const influence = bankInfluence(mix('influence'));
      const localGround = Math.min(base, base * (1 - influence) + (localLevel - depth) * influence);
      ground = Math.min(ground, localGround);
      if (localLevel - localGround > 1e-9) {
        if (level !== null && Math.abs(level - localLevel) > 1e-6) throw new RangeError(`Overlapping river surfaces have incompatible levels: ${[...wetSources].join(',')} / ${t.edgeId} at ${xM},${yM}`);
        level = localLevel; wetSources.add(t.edgeId);
      }
    }
    }
    for (const body of model.bodies) {
      if (insidePolygon(p, body.polygon) && body.waterLevelElevationM - ground > 1e-9) {
        if (level !== null && Math.abs(level - body.waterLevelElevationM) > 1e-6) throw new RangeError('River/body contact has incompatible water levels');
        level = body.waterLevelElevationM; wetSources.add(body.id);
      }
    }
    let basinId = null, basinIndex = null, outletCellIndex = null;
    if (model.basins) {
      const x = Math.max(0, Math.min(grid.columns - 1, Math.floor((xM - frame.originXM) / grid.cellSizeM)));
      const y = Math.max(0, Math.min(grid.rows - 1, Math.floor((yM - frame.originYM) / grid.cellSizeM)));
      const index = y * grid.columns + x;
      basinIndex = model.basins.indices[index]; basinId = `${model.basins.namespace}:${basinIndex}`;
      outletCellIndex = model.basins.outletCellIndices[index];
    }
    return { groundElevationM: ground, waterLevelElevationM: level,
      waterSourceIds: [...wetSources].sort(), basinId, basinIndex, outletCellIndex };
  }
  function segmentBreaks(a, b) {
    const candidates = new Set(), marks = new Set(smoothField?smoothField.segmentEvents(a,b):[0, 1]);
    const steps = Math.max(1, Math.ceil(distance(a, b) / (bucketSize / 2)));
    if (steps > 65536) throw new RangeError('Segment exceeds spatial query budget');
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = Math.floor((a.xM + (b.xM - a.xM) * t) / bucketSize);
      const y = Math.floor((a.yM + (b.yM - a.yM) * t) / bucketSize);
      // Neighbor buckets cover corner contacts between the spaced probes.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const index of buckets.get(key(x + dx, y + dy)) ?? []) candidates.add(index);
      }
    }
    for (const index of candidates) {
      const triangle = triangles[index];
      for (const [lo, hi] of segmentIntervals(a, b, [triangle.a, triangle.b, triangle.c])) {
        marks.add(lo); marks.add(hi); if (hi > lo) marks.add((lo + hi) / 2);
      }
    }
    for (const body of model.bodies) for (const [lo, hi] of segmentIntervals(a, b, body.polygon)) {
      marks.add(lo); marks.add(hi); if (hi > lo) marks.add((lo + hi) / 2);
    }
    return [...marks];
  }

  const meshBounds = triangles.length ? triangles.reduce((extent, t) => ({
    minXM: Math.min(extent.minXM, t.minX), minYM: Math.min(extent.minYM, t.minY),
    maxXM: Math.max(extent.maxXM, t.maxX), maxYM: Math.max(extent.maxYM, t.maxY),
  }), { minXM: Infinity, minYM: Infinity, maxXM: -Infinity, maxYM: -Infinity }) : null;
  if (fitWidths) Object.assign(model.diagnostics, { bodyBoundaryIntervals, geometryWidthScales });
  // Keep boundary contact extents per edge so a declared open cut cannot
  // accidentally authorize clipping an unrelated channel on the same side.
  const contacts = new Map();
  for (const t of triangles) for (const p of [t.a,t.b,t.c]) for (const side of ['minXM','maxXM','minYM','maxYM']) {
    const axis=side.endsWith('XM')?'xM':'yM',other=axis==='xM'?'yM':'xM';
    if (Math.abs(p[axis]-bounds[side])>1e-6) continue;
    const id=JSON.stringify([t.edgeId,side]),entry=contacts.get(id) ?? {edgeId:t.edgeId,side,minM:Infinity,maxM:-Infinity};
    entry.minM=Math.min(entry.minM,p[other]);entry.maxM=Math.max(entry.maxM,p[other]);contacts.set(id,entry);
  }
  const minimumFloor=triangles.reduce((z,t)=>Math.min(z,...[t.a,t.b,t.c].map(p=>p.level-p.depth)),Infinity);
  function boundGroundElevation(range,region){
    const [low,high]=validateElevationInterval(range),disk=validateMetricDisk(region);
    const overlaps=box=>!disk||Math.hypot(Math.max(box.minXM-disk.xM,0,disk.xM-box.maxXM),Math.max(box.minYM-disk.yM,0,disk.yM-box.maxYM))<=disk.radiusM+1e-7;
    if(disk&&smoothField&&smoothField.supportBounds&&!overlaps(smoothField.supportBounds))return[low,high];
    const localFloor=disk&&!smoothField?triangles.filter(t=>overlaps({minXM:t.minX,maxXM:t.maxX,minYM:t.minY,maxYM:t.maxY})).reduce((z,t)=>Math.min(z,...[t.a,t.b,t.c].map(p=>p.level-p.depth)),Infinity):minimumFloor;
    // Legacy bank interpolation is a convex combination of the base and
    // triangle floors. The C1 field instead has an explicit excavation cap.
    const floor=smoothField?low-model.bed.maxIncisionM:Math.min(low,localFloor);
    const slack=1e-8*Math.max(1,Math.abs(floor),Math.abs(high));
    return [floor-slack,high];
  }
  return { sample, sampleGround, boundGroundElevation, segmentBreaks, triangleCount: triangles.length, meshBounds:smoothField?.supportBounds??meshBounds, boundaryContacts:smoothField?.boundaryContacts??[...contacts.values()] };
}
