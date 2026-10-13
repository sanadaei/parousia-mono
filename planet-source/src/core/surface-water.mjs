import {validatePlanarBed} from './planar-river-bed.mjs';
import { buildTerrainWithSurfaceWater, TERRAIN_SCHEMA, SMOOTH_TERRAIN_SCHEMA } from './index.mjs';
import { WATER_SCHEMA, distance, insidePolygon, segmentIntervals, validateBodies, topologicalOrder } from './water-model.mjs';
import { gridAxisCuts } from './field-math.mjs';
import { channelSizes } from './channel-sizing.mjs';
import { createHermiteField } from './hermite-field.mjs';
import { copyJson } from './json-contract.mjs';

const DEFAULTS = Object.freeze({ halfWidthM: 1.8, bankWidthM: 3, depthM: 1.2, freeboardM: 0.15, profileStepM: 20 });

function resample(points, step, extraDistances = []) {
  const run = [0];
  for (let i = 1; i < points.length; i++) run.push(run.at(-1) + distance(points[i - 1], points[i]));
  const total = run.at(-1), marks = new Set([...run, ...extraDistances.filter(d => d > 0 && d < total)]);
  for (let i = 1; i < points.length; i++) {
    const divisions = Math.ceil((run[i] - run[i - 1]) / step);
    for (let j = 1; j < divisions; j++) marks.add(run[i - 1] + (run[i] - run[i - 1]) * j / divisions);
  }
  let segment = 1;
  // On a previously resampled graph, flat-zone marks can differ from a source
  // vertex only by roundoff. Preserve the vertex rather than adding a tiny edge.
  const sourceMarks = new Set(run), extraMarks = new Set(extraDistances), coalesced = [];
  const priority = d => sourceMarks.has(d) ? 2 : extraMarks.has(d) ? 1 : 0;
  for (const d of [...marks].sort((a, b) => a - b)) {
    const previous = coalesced.at(-1);
    if (previous !== undefined && d - previous < 1e-8 && !(sourceMarks.has(d) && sourceMarks.has(previous))) {
      if (priority(d) > priority(previous)) coalesced[coalesced.length - 1] = d;
    } else coalesced.push(d);
  }
  return coalesced.map(d => {
    while (segment < run.length - 1 && run[segment] < d) segment++;
    const t = (d - run[segment - 1]) / (run[segment] - run[segment - 1]);
    const a = points[segment - 1], b = points[segment];
    return { xM: a.xM * (1 - t) + b.xM * t, yM: a.yM * (1 - t) + b.yM * t, distanceM: d };
  });
}

function distanceToBodyExit(points, body) {
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    const intervals = segmentIntervals(a, b, body.polygon), initial = intervals.find(([lo]) => lo <= 1e-10);
    if (!initial || initial[1] < 1 - 1e-10) return walked + length * (initial?.[1] ?? 0);
    walked += length;
  }
  return walked;
}

/** A bounded static channel-fit model, explicitly separate from physical flow simulation. */
export function connectSurfaceWater(terrain, {
  riverGraph, waterBodies = [], basins = null, parameters = {}, waterLevelRole, channelSizing = null, bed = null,
} = {}) {
  const snapshot = terrain.toSnapshot();
  if (!snapshot.grid || !snapshot.fields || snapshot.frame?.kind !== 'planar-metric') throw new TypeError('Surface-water construction requires a finite planar canonical grid');
  const smoothGround = snapshot.interpolation === 'bounded-hermite-c1@1'
    ? createHermiteField(snapshot.fields.groundElevationM, snapshot.grid, snapshot.frame) : null;
  if (snapshot.hydrology) throw new TypeError('Surface water must be built from a base terrain without a surface-water model');
  if (snapshot.fields.waterLevelElevationM !== null) {
    const role = waterLevelRole ?? snapshot.fields.waterLevelRole;
    if (!['surface', 'groundwater'].includes(role)) throw new TypeError('Combined water models require an explicit waterLevelRole');
    snapshot.fields.waterLevelRole = role;
  } else if (waterLevelRole != null) throw new TypeError('waterLevelRole needs a water-level grid');
  const model = solveSurfaceWaterModel(terrain, { riverGraph: riverGraph ?? snapshot.references.riverGraph,
    waterBodies, basins, parameters, channelSizing, bed }, { grid: snapshot.grid, frame: snapshot.frame, groundBounds: smoothGround });
  if (snapshot.schema !== SMOOTH_TERRAIN_SCHEMA) snapshot.schema = TERRAIN_SCHEMA;
  delete snapshot.worldId;
  snapshot.revision = `${snapshot.revision}|static-surface-water@4`;
  if (channelSizing) snapshot.revision += '|strahler-sizing@1';
  if(bed)snapshot.revision+='|compact-c1-bed@1';
  snapshot.hydrology = model;
  return buildTerrainWithSurfaceWater(snapshot);
}

/** Internal shared profile solver. A bounds provider may read a continuous sphere
 * directly; grid here also supplies spatial cuts and is not a resampled ground. */
export function solveSurfaceWaterModel(terrain, { riverGraph, waterBodies = [], basins = null,
  parameters = {}, channelSizing = null, bed = null } = {}, { grid, frame, groundBounds = null } = {}) {
  validatePlanarBed(bed);
  const graph = copyJson(riverGraph ?? { nodes: [], edges: [] }, 'riverGraph');
  const bodies = copyJson(waterBodies, 'waterBodies');
  validateBodies(bodies, terrain.bounds);
  const params = { ...DEFAULTS, ...parameters };
  for (const [key, value] of Object.entries(params)) {
    if (!(key in DEFAULTS) || !Number.isFinite(value) || value <= 0) throw new TypeError(`Invalid surface water parameter: ${key}`);
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 4096 || graph.edges.length > 2048) throw new RangeError('Invalid or oversized river graph');
  const nodes = new Map(), edgeIds = new Set();
  for (const source of graph.nodes) {
    if (typeof source.id !== 'string' || !source.id || nodes.has(source.id)) throw new TypeError('Duplicate or invalid river node ID');
    const ground = terrain.groundElevationAt(source.xM, source.yM);
    const containing = bodies.filter(b => insidePolygon(source, b.polygon)
      && ground <= b.waterLevelElevationM);
    const body = source.bodyId ? bodies.find(b => b.id === source.bodyId) : containing[0];
    if (source.bodyId && (!body || !insidePolygon(source, body.polygon))) throw new RangeError('Anchored river node must be inside its water body');
    nodes.set(source.id, { source, body, incoming: [], outgoing: [],
      ceiling: body ? body.waterLevelElevationM : ground - params.freeboardM,
      floor: body ? body.waterLevelElevationM : -Infinity });
  }

  // Bilinear extrema use cropped corners; C1 uses the cropped Bezier control hull.
  function axes(min, max, origin, count) {
    return [min, ...gridAxisCuts(min, max, origin, count, grid.cellSizeM), max];
  }
  const topologyOrder = topologicalOrder(graph.nodes, graph.edges);
  const sizing = channelSizes(graph, topologyOrder, params, channelSizing);
  function corridorCeiling(a, b, size) {
    const pad = 2 * (size.halfWidthM + size.bankWidthM), bounds = terrain.bounds;
    let xs = axes(Math.max(bounds.minXM, Math.min(a.xM, b.xM) - pad), Math.min(bounds.maxXM, Math.max(a.xM, b.xM) + pad), frame.originXM, grid.columns);
    let ys = axes(Math.max(bounds.minYM, Math.min(a.yM, b.yM) - pad), Math.min(bounds.maxYM, Math.max(a.yM, b.yM) + pad), frame.originYM, grid.rows);
    if (groundBounds) {
      const bodyCuts = (axis, cuts) => [...new Set([...cuts, ...bodies.flatMap(body => body.polygon
        .map(p => p[axis]).filter(v => v > cuts[0] && v < cuts.at(-1)))])].sort((x, y) => x - y);
      xs = bodyCuts('xM', xs); ys = bodyCuts('yM', ys);
      if ((xs.length - 1) * (ys.length - 1) > 65536) throw new RangeError('C1 corridor exceeds rectangle bounds budget');
      let minimum = Infinity;
      for (let j = 1; j < ys.length; j++) for (let i = 1; i < xs.length; i++) {
        const rect = { minXM: xs[i - 1], minYM: ys[j - 1], maxXM: xs[i], maxYM: ys[j] };
        const hull = groundBounds.rectangleBounds(rect);
        const corners = [{ xM: rect.minXM, yM: rect.minYM }, { xM: rect.maxXM, yM: rect.minYM },
          { xM: rect.maxXM, yM: rect.maxYM }, { xM: rect.minXM, yM: rect.maxYM }];
        const contained = bodies.find(body => corners.every((p, k) => {
          const intervals = segmentIntervals(p, corners[(k + 1) % 4], body.polygon);
          return intervals.length === 1 && intervals[0][0] <= 1e-10 && intervals[0][1] >= 1 - 1e-10;
        }));
        const shore = bodies.find(body => corners.some(p => insidePolygon(p, body.polygon))
          && hull.min >= body.waterLevelElevationM && hull.min < body.waterLevelElevationM + params.freeboardM);
        // At a dry shoreline ground may equal the body level, so freeboard
        // cannot be imposed there. The ground lower bound still caps the level.
        minimum = Math.min(minimum, contained ? contained.waterLevelElevationM
          : shore ? shore.waterLevelElevationM : hull.min - params.freeboardM);
      }
      return minimum;
    }
    let minimum = Infinity;
    for (const xM of xs) for (const yM of ys) {
      const ground = terrain.groundElevationAt(xM, yM);
      if (!bodies.some(body => insidePolygon({ xM, yM }, body.polygon)
        && ground <= body.waterLevelElevationM + params.freeboardM)) minimum = Math.min(minimum, ground - params.freeboardM);
    }
    return minimum;
  }
  const edges = graph.edges.map(source => {
    if (typeof source.id !== 'string' || !source.id || edgeIds.has(source.id)) throw new TypeError('Duplicate or invalid river edge ID');
    edgeIds.add(source.id);
    const from = nodes.get(source.from), to = nodes.get(source.to);
    if (!from || !to || source.from === source.to || !Array.isArray(source.points) || source.points.length < 2) throw new TypeError('Invalid river edge endpoints');
    if (distance(source.points[0], from.source) > 1e-8 || distance(source.points.at(-1), to.source) > 1e-8) throw new RangeError('River edge positions must meet their nodes');
    for (let i = 0; i < source.points.length; i++) {
      terrain.groundElevationAt(source.points[i].xM, source.points[i].yM);
      if (i && distance(source.points[i - 1], source.points[i]) < 1e-8) throw new RangeError('Duplicate river control point');
    }
    const length = source.points.slice(1).reduce((sum, p, i) => sum + distance(source.points[i], p), 0);
    const size = sizing?.sizes.get(source.id) ?? params;
    const radius = 2 * (size.halfWidthM + size.bankWidthM);
    const startRadius = sizing?.radii.get(source.from) ?? radius, endRadius = sizing?.radii.get(source.to) ?? radius;
    const startFlat = from.body ? distanceToBodyExit(source.points, from.body) + startRadius : startRadius;
    const endFlat = to.body ? distanceToBodyExit([...source.points].reverse(), to.body) + endRadius : endRadius;
    if (startFlat + endFlat >= length && from.body !== to.body) throw new RangeError('Channel too short to join distinct water levels with these bank widths');
    const points = resample(source.points, params.profileStepM, [startFlat, length - endFlat]);
    const ceilings = points.map(p => terrain.groundElevationAt(p.xM, p.yM) - params.freeboardM);
    for (let i = 0; i < points.length; i++) if (bodies.some(body => insidePolygon(points[i], body.polygon)
      && terrain.groundElevationAt(points[i].xM, points[i].yM) <= body.waterLevelElevationM + params.freeboardM)) ceilings[i] = Infinity;
    for (let i = 1; i < points.length; i++) {
      const ceiling = corridorCeiling(points[i - 1], points[i], size);
      ceilings[i - 1] = Math.min(ceilings[i - 1], ceiling); ceilings[i] = Math.min(ceilings[i], ceiling);
    }
    from.ceiling = Math.min(from.ceiling, ...ceilings.filter((_, i) => points[i].distanceM <= startFlat + 1e-8));
    to.ceiling = Math.min(to.ceiling, ...ceilings.filter((_, i) => points[i].distanceM >= length - endFlat - 1e-8));
    const edge = { source, from, to, length, startFlat, endFlat, points, ceilings, size };
    from.outgoing.push(edge); to.incoming.push(edge);
    return edge;
  });

  const order = topologyOrder.map(id => nodes.get(id));
  for (const node of [...order].reverse()) for (const edge of node.outgoing) node.floor = Math.max(node.floor, edge.to.floor);
  for (const node of order) {
    const limit = Math.min(node.ceiling, ...node.incoming.map(e => e.profile.at(-1)));
    node.level = node.body ? node.body.waterLevelElevationM : limit;
    if (node.level > limit + 1e-8 || node.level < node.floor - 1e-8) throw new RangeError(`Infeasible river/body water level at ${node.source.id}`);
    for (const edge of node.outgoing) {
      let level = node.level;
      edge.profile = edge.points.map((p, i) => {
        level = Math.min(level, edge.ceilings[i]);
        if (p.distanceM <= edge.startFlat + 1e-8) level = node.level;
        if (edge.to.body && p.distanceM >= edge.length - edge.endFlat - 1e-8) level = edge.to.body.waterLevelElevationM;
        if (level > edge.ceilings[i] + 1e-8 || level < edge.to.floor - 1e-8) throw new RangeError(`Infeasible channel profile: ${edge.source.id} at ${p.xM},${p.yM}; level=${level}, ceiling=${edge.ceilings[i]}, floor=${edge.to.floor}`);
        return level;
      });
    }
  }
  // Flatten endpoint neighborhoods to one junction level before constructing strips.
  // Both incident edges then have exactly the same water surface in their overlap.
  for (const edge of edges) {
    for (let i = edge.points.length - 1; i >= 0; i--) {
      if (edge.points[i].distanceM >= edge.length - edge.endFlat - 1e-8) edge.profile[i] = edge.to.level;
      else edge.profile[i] = Math.max(edge.profile[i], edge.to.level);
    }
    for (let i = 1; i < edge.profile.length; i++) if (edge.profile[i] > edge.profile[i - 1] + 1e-8) throw new RangeError(`Uphill channel profile: ${edge.source.id}`);
  }

  const resolvedNodes = [...nodes.values()].map(n => ({ id: n.source.id, xM: n.source.xM, yM: n.source.yM,
    kind: n.source.kind ?? null, sourceNodeId: n.source.sourceNodeId ?? null,
      basinId: n.source.basinId ?? null, bodyId: n.body?.id ?? null, waterLevelElevationM: n.level,
      ...(n.source.boundaryDirection ? { boundaryDirection: copyJson(n.source.boundaryDirection, 'boundaryDirection') } : {}) }));
  let maxCenterIncisionM = 0;
  const resolvedEdges = edges.map(e => ({ id: e.source.id, from: e.source.from, to: e.source.to,
    sourceEdgeId: e.source.sourceEdgeId ?? null,
    basinId: e.source.basinId ?? null, branchId: e.source.branchId ?? null,
    ...(sizing ? { sourceStrahlerOrder: e.size.sourceStrahlerOrder,
      derivedStrahlerOrder: e.size.derivedStrahlerOrder, strahlerOrder: e.size.strahlerOrder } : {}),
    points: e.points.map((p, i) => {
      maxCenterIncisionM = Math.max(maxCenterIncisionM, terrain.groundElevationAt(p.xM, p.yM) - e.profile[i] + e.size.depthM);
      return { xM: p.xM, yM: p.yM, waterLevelElevationM: e.profile[i],
        halfWidthM: e.size.halfWidthM, bankWidthM: e.size.bankWidthM, depthM: e.size.depthM };
    }) }));
  return {
    schema: WATER_SCHEMA, construction: 'strip-with-smooth-banks@4', ...(bed?{bed:copyJson(bed,'bed')}:{}), interpretation: 'static-game-channel-fit; not-calibrated-flow-simulation',
    topologyOrder,
    ...(sizing ? { channelSizing: { ...sizing.settings, orderPolicy: 'max(source-order, inherited-Strahler-order)@1' } } : {}),
    parameters: params, nodes: resolvedNodes, edges: resolvedEdges, bodies, basins: basins ? copyJson(basins, 'basins') : null,
    diagnostics: { bodyBoundaryIntervals: 0, geometryWidthScales: [], maxCenterIncisionM,
      ...(graph.boundaryOutflowPolicy ? { boundaryOutflowPolicy: graph.boundaryOutflowPolicy } : {}),
      ...(groundBounds ? { groundBoundsMethod: groundBounds.method ?? 'cropped-bezier-control-hull@1' } : {}),
      unresolvedTerminalNodeIds: [...nodes.values()].filter(n => !n.outgoing.length && !n.body && n.source.kind !== 'regional-boundary').map(n => n.source.id),
      regionalBoundaryNodeIds: [...nodes.values()].filter(n => n.source.kind === 'regional-boundary').map(n => n.source.id),
      isolatedNodeIds: [...nodes.values()].filter(n => !n.incoming.length && !n.outgoing.length).map(n => n.source.id) },
  };
}

export { PLANAR_C1_BED } from './planar-river-bed.mjs';
