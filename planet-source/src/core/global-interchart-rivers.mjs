import { connectGlobalSurfaceWaterCharts } from './global-water-charts.mjs';
import { copyJson } from './json-contract.mjs';
import { createSphericalProjection, geographicPoint, sphereBasis, offsetGeographic } from './spherical.mjs';
import { topologicalOrder } from './water-model.mjs';

const POSITION_EPS_M = 1e-4, PROFILE_EPS_M = 1e-8;
const key = (chart, node) => JSON.stringify([chart, node]);
const vector = (p, radius) => sphereBasis(p).up.map(v => v * radius);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const distance = (a, b) => Math.hypot(...sub(a, b));

/** Explicit joins only: adjacent coverage alone does not establish river topology. */
export function connectInterChartRivers(globalTerrain, options = {}) {
  return connectGlobalSurfaceWaterCharts(globalTerrain, options);
}

/** @internal Normalize before using declarations to authorize boundary openings. */
export function interChartDeclarations(options) {
  if (options.interChartRivers != null && options.connections != null) throw new TypeError('Provide interChartRivers or connections, not both');
  const raw = options.interChartRivers ?? options.connections ?? [];
  if (!Array.isArray(raw) || raw.length > 4096) throw new RangeError('Invalid or oversized inter-chart connections');
  const seen = new Set();
  return raw.map(value => {
    const c = copyJson(value, 'interChartRiver');
    if (Object.keys(c).some(k => !['fromChartId', 'toChartId', 'fromNodeId', 'toNodeId', 'junctionLatDeg', 'junctionLonDeg'].includes(k))) throw new TypeError('Unknown inter-chart connection property');
    for (const k of ['fromChartId', 'toChartId', 'fromNodeId', 'toNodeId']) if (typeof c[k] !== 'string' || !c[k].trim()) throw new TypeError(`Invalid connection ${k}`);
    if (c.fromChartId === c.toChartId) throw new RangeError('Inter-chart connection needs distinct charts');
    if ((c.junctionLatDeg == null) !== (c.junctionLonDeg == null)) throw new TypeError('Junction needs both latitude and longitude');
    if (c.junctionLatDeg != null) {
      const p = geographicPoint(c.junctionLatDeg, c.junctionLonDeg);
      c.junctionLatDeg = p.latDeg; c.junctionLonDeg = p.lonDeg;
    }
    const id = key(key(c.fromChartId, c.fromNodeId), key(c.toChartId, c.toNodeId));
    if (seen.has(id)) throw new TypeError('Duplicate inter-chart connection');
    seen.add(id); return c;
  }).sort((a, b) => { const u=JSON.stringify(a),v=JSON.stringify(b);return u<v?-1:u>v?1:0; });
}

function endpoint(entry, nodeId, upstream) {
  const model = entry.chart.model, node = model.nodes.find(n => n.id === nodeId);
  if (!node) throw new RangeError('Unknown inter-chart river node');
  const incoming = model.edges.filter(e => e.to === nodeId), outgoing = model.edges.filter(e => e.from === nodeId);
  if (upstream ? incoming.length !== 1 || outgoing.length !== 0 : outgoing.length !== 1 || incoming.length !== 0) throw new RangeError('Connection must join an upstream endpoint to a downstream startpoint');
  if (node.bodyId) throw new RangeError('Inter-chart endpoint cannot be a water-body anchor');
  const edge = upstream ? incoming[0] : outgoing[0], point = upstream ? edge.points.at(-1) : edge.points[0];
  const neighbor = upstream ? edge.points.at(-2) : edge.points[1];
  const projection = createSphericalProjection(entry.chart.projection), radius = entry.chart.projection.radiusM;
  const position = projection.toGeographic(point.xM, point.yM), v = vector(position, radius);
  let tangent = sub(vector(projection.toGeographic(neighbor.xM, neighbor.yM), radius), v);
  const up = sphereBasis(position).up, radial = dot(tangent, up);
  tangent = tangent.map((n, i) => (n - radial * up[i]) * (upstream ? -1 : 1));
  const length = Math.hypot(...tangent); tangent = tangent.map(n => n / length);
  return { node, edge, point, position, v, tangent };
}

/** @internal Revalidate topology, numeric profiles and physical seam positions on restore. */
export function validateInterChartRivers(entries, declarations) {
  const byId = new Map(entries.map(e => [e.id, e])), used = new Set(), joins = [];
  for (const c of declarations) {
    const from = byId.get(c.fromChartId), to = byId.get(c.toChartId);
    if (!from || !to) throw new RangeError('Unknown inter-chart water chart');
    const sourceBed=from.chart.model.bed,targetBed=to.chart.model.bed;
    if((sourceBed?.method??null)!==(targetBed?.method??null)||(sourceBed?.maxIncisionM??null)!==(targetBed?.maxIncisionM??null))throw new RangeError('Inter-chart seam river bed policies must match');
    const a = endpoint(from, c.fromNodeId, true), b = endpoint(to, c.toNodeId, false);
    for (const id of [key(from.id, a.node.id), key(to.id, b.node.id)]) {
      if (used.has(id)) throw new RangeError('Inter-chart endpoint is connected more than once');
      used.add(id);
    }
    if (distance(a.v, b.v) > POSITION_EPS_M) throw new RangeError('Inter-chart endpoint positions do not meet');
    if (c.junctionLatDeg != null && distance(a.v, vector(geographicPoint(c.junctionLatDeg, c.junctionLonDeg), from.chart.projection.radiusM)) > POSITION_EPS_M) throw new RangeError('Declared junction does not meet the river endpoints');
    for (const field of ['waterLevelElevationM', 'depthM', 'halfWidthM', 'bankWidthM']) {
      if (Math.abs(a.point[field] - b.point[field]) > PROFILE_EPS_M) throw new RangeError(`Inter-chart seam ${field} mismatch`);
    }
    if (dot(a.tangent, b.tangent) < 1 - 1e-6) throw new RangeError('Inter-chart seam flow directions must align');
    validateSeamSection(from,to,a,b);
    joins.push({ from, to, a, b });
  }
  for (const e of entries) for (const id of e.chart.interChartBoundaryNodeIds ?? []) {
    if (!used.has(key(e.id, id))) throw new RangeError('Unconnected inter-chart boundary opening');
  }
  const nodes = entries.flatMap(e => e.chart.model.nodes.map(n => ({ id: key(e.id, n.id) })));
  const edges = entries.flatMap(e => e.chart.model.edges.map(r => ({ from: key(e.id, r.from), to: key(e.id, r.to) })));
  edges.push(...declarations.map(c => ({ from: key(c.fromChartId, c.fromNodeId), to: key(c.toChartId, c.toNodeId) })));
  topologicalOrder(nodes, edges);
  validateOverlap(entries, joins);
  return joins;
}

function validateSeamSection(from,to,endpoint,downstream) {
  const basis=sphereBasis(endpoint.position),east=dot(endpoint.tangent,basis.east),north=dot(endpoint.tangent,basis.north);
  const { halfWidthM,bankWidthM }=endpoint.point;
  let boundaryPoint=null;
  if (endpoint.node.kind==='regional-boundary' && downstream.node.kind==='regional-boundary') {
    const p=endpoint.point,neighbor=endpoint.edge.points.at(-2),projection=createSphericalProjection(from.chart.projection),bounds=from.chart.bounds;
    const xSide=p.xM===bounds.minXM || p.xM===bounds.maxXM,axis=xSide?'xM':'yM',other=xSide?'yM':'xM';
    const outward=Math.abs(p[axis]-neighbor[axis])/Math.hypot(p.xM-neighbor.xM,p.yM-neighbor.yM);
    boundaryPoint=offset=>projection.toGeographic(p.xM+(other==='xM'?offset/outward:0),p.yM+(other==='yM'?offset/outward:0));
  }
  for (const offset of [-halfWidthM-bankWidthM,-halfWidthM,-halfWidthM/2,0,halfWidthM/2,halfWidthM,halfWidthM+bankWidthM]) {
    const p=boundaryPoint?boundaryPoint(offset):offsetGeographic(endpoint.position,-north*offset,east*offset,from.chart.projection.radiusM);
    const a=from.terrain.sampleAt(p.latDeg,p.lonDeg),b=to.terrain.sampleAt(p.latDeg,p.lonDeg);
    if (a.waterDepthM===null || b.waterDepthM===null || Math.abs(a.groundElevationM-b.groundElevationM)>1e-6
      || Math.abs(a.waterDepthM-b.waterDepthM)>1e-6) throw new RangeError('Inter-chart seam cross-section is discontinuous');
    if (offset===0 && (a.waterDepthM<=0 || b.waterDepthM<=0)) throw new RangeError('Inter-chart seam center must carry water');
  }
}

// Segment capsules are a conservative support test. Reject unrelated corridor
// contacts even if one valid junction authorizes overlapping chart coverage.
function closest(a, b, c, d) {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c), A = dot(u,u), B = dot(u,v), C = dot(v,v), D = dot(u,w), E = dot(v,w);
  const clamp = x => Math.max(0, Math.min(1, x));
  let s = A * C - B * B > 1e-12 * A * C ? clamp((B * E - C * D) / (A * C - B * B)) : 0;
  let t = (B * s + E) / C;
  if (t<0) { t=0;s=clamp(-D/A); }
  else if (t>1) { t=1;s=clamp((B-D)/A); }
  const p = a.map((n,i) => n + s*u[i]), q = c.map((n,i) => n + t*v[i]);
  return { p, q, distance: distance(p,q) };
}
function segments(entry) {
  const projection = createSphericalProjection(entry.chart.projection), radius = entry.chart.projection.radiusM;
  return entry.chart.model.edges.flatMap(edge => edge.points.slice(1).map((b, i) => {
    const a = edge.points[i], convert = p => vector(projection.toGeographic(p.xM, p.yM), radius);
    const length=Math.hypot(a.xM-b.xM,a.yM-b.yM);
    const extent=(p,index)=>{
      const before=edge.points[index-1],after=edge.points[index+1];
      if (!before || !after) return p.halfWidthM+p.bankWidthM;
      const u=[p.xM-before.xM,p.yM-before.yM],v=[after.xM-p.xM,after.yM-p.yM];
      const cosine=dot(u,v)/(Math.hypot(...u)*Math.hypot(...v));
      return (p.halfWidthM+p.bankWidthM)/Math.sqrt(Math.max(1e-12,(1+cosine)/2));
    };
    // Include mitered banks and spherical chord sag in the support envelope.
    return { edge, a, b, u: convert(a), v: convert(b), outer: Math.max(extent(a,i),extent(b,i+1))+1.1*length*length/(2*radius) };
  }));
}
function bodies(entry) {
  const projection=createSphericalProjection(entry.chart.projection),radius=entry.chart.projection.radiusM;
  return entry.chart.model.bodies.map(body=>{
    const x=body.polygon.reduce((s,p)=>s+p.xM/body.polygon.length,0),y=body.polygon.reduce((s,p)=>s+p.yM/body.polygon.length,0);
    return {center:vector(projection.toGeographic(x,y),radius),radius:Math.max(...body.polygon.map(p=>Math.hypot(p.xM-x,p.yM-y)))};
  });
}
function pointSegmentDistance(p,a,b) {
  const d=sub(b,a),length=dot(d,d),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/length));
  return distance(p,a.map((v,i)=>v+t*d[i]));
}
function validateBodyOverlap(a,b,sa,sb) {
  const ba=bodies(a),bb=bodies(b);
  for (const body of ba) for (const s of sb) if (pointSegmentDistance(body.center,s.u,s.v)<=body.radius+s.outer+POSITION_EPS_M) throw new RangeError('Cross-chart river/body overlap needs a separate body connection contract');
  for (const body of bb) for (const s of sa) if (pointSegmentDistance(body.center,s.u,s.v)<=body.radius+s.outer+POSITION_EPS_M) throw new RangeError('Cross-chart river/body overlap needs a separate body connection contract');
  for (const a of ba) for (const b of bb) if (distance(a.center,b.center)<=a.radius+b.radius+POSITION_EPS_M) throw new RangeError('Cross-chart body overlap needs a separate body connection contract');
}
function validateOverlap(entries, joins) {
  if (!joins.length) return;
  const cache = new Map(entries.map(e => [e.id, segments(e)]));
  let checks = 0;
  for (let i=0; i<entries.length; i++) for (let j=i+1; j<entries.length; j++) {
    const pair = joins.filter(c => c.from === entries[i] && c.to === entries[j] || c.from === entries[j] && c.to === entries[i]);
    if (!pair.length) continue; // Coverage separation is checked by the caller.
    validateBodyOverlap(entries[i],entries[j],cache.get(entries[i].id),cache.get(entries[j].id));
    for (const a of cache.get(entries[i].id)) for (const b of cache.get(entries[j].id)) {
      if (++checks > 2_000_000) throw new RangeError('Inter-chart overlap validation exceeds budget');
      const contact = closest(a.u,a.v,b.u,b.v);
      if (contact.distance > a.outer+b.outer+POSITION_EPS_M) continue;
      const valid = pair.some(join => {
        const ea = join.from === entries[i] ? join.a : join.b, eb = join.from === entries[j] ? join.a : join.b;
        const r = 2 * (ea.point.halfWidthM + ea.point.bankWidthM) + POSITION_EPS_M;
        return ea.edge === a.edge && eb.edge === b.edge && distance(contact.p,ea.v)<=r && distance(contact.q,ea.v)<=r
          && [a.a,a.b,b.a,b.b].every(p => ['waterLevelElevationM','depthM','halfWidthM','bankWidthM'].every(k => Math.abs(p[k]-ea.point[k])<=PROFILE_EPS_M));
      });
      if (!valid) throw new RangeError('Cross-chart channel overlap outside a validated constant junction');
    }
  }
}
