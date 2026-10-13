/** Completes the source river mask along its canonical primary receivers.
 * Original display curves stay in references; this graph uses the flow backbone.
 */
export function regionalDrainageGraph(world, frame) {
  const count = world.w * world.h, receivers = world.flowReceiver, mask = world.riverMask;
  if (receivers?.length !== count || mask?.length !== count) throw new TypeError('Regional drainage needs canonical flowReceiver and riverMask fields');
  const active = new Uint8Array(count), done = new Uint8Array(count);
  for (let start = 0; start < count; start++) {
    if (!mask[start]) continue;
    const path = [], seen = new Set(); let cell = start;
    while (cell >= 0 && !done[cell]) {
      if (!Number.isSafeInteger(cell) || cell >= count || seen.has(cell)) throw new RangeError('Invalid or cyclic regional drainage');
      seen.add(cell); path.push(cell); active[cell] = 1;
      const next = receivers[cell];
      if (!Number.isSafeInteger(next) || next < -1 || next >= count) throw new RangeError('Invalid regional flow receiver');
      if (next >= 0 && (Math.abs(next % world.w - cell % world.w) > 1
        || Math.abs(Math.floor(next / world.w) - Math.floor(cell / world.w)) > 1)) throw new RangeError('Regional flow receiver must be a neighboring cell');
      cell = next;
    }
    for (const value of path) done[value] = 1;
  }
  const incoming = new Uint16Array(count), upstream = new Map();
  for (let i = 0; i < count; i++) if (active[i] && receivers[i] >= 0) {
    const next = receivers[i], cells = upstream.get(next) ?? [];
    cells.push(i); upstream.set(next, cells); incoming[next]++;
  }
  const sourceNodes = new Map(world.riverGraph.nodes.map(n => [n.cellIndex, n]));
  const owners = new Map();
  for (const edge of world.riverGraph.edges) for (let i = 1; i < edge.points.length; i++) {
    const a = edge.points[i - 1].cellIndex, b = edge.points[i].cellIndex;
    if (receivers[a] !== b) throw new RangeError('Source river edge disagrees with primary drainage');
    owners.set(a, edge.id);
  }
  const point = cell => ({ xM: frame.originXM + (cell % world.w + 0.5) * world.cell,
    yM: frame.originYM + (Math.floor(cell / world.w) + 0.5) * world.cell });
  const basinId = cell => world.watersheds ? `dynamic-basin:${world.watersheds.basin[cell]}` : null;
  const nodes = [], byCell = new Map();
  for (let cell = 0; cell < count; cell++) {
    if (!active[cell] || (!sourceNodes.has(cell) && incoming[cell] === 1 && receivers[cell] >= 0)) continue;
    const original = sourceNodes.get(cell);
    const n = { id: original?.id ?? `dynamic-node:${cell}`, ...point(cell), basinId: basinId(cell),
      kind: receivers[cell] < 0 ? 'drainage-terminal' : incoming[cell] > 1 ? 'confluence' : incoming[cell] === 0 ? 'source' : 'through',
      sourceNodeId: original?.id ?? null };
    nodes.push(n); byCell.set(cell, n);
  }
  const edges = [];
  for (const [start, from] of byCell) {
    let next = receivers[start];
    if (next < 0) continue;
    const cells = [start];
    while (next >= 0) { cells.push(next); if (byCell.has(next)) break; next = receivers[next]; }
    const end = cells.at(-1), to = byCell.get(end);
    if (!to) throw new RangeError('Regional drainage path has no terminal node');
    const parentIds = [...new Set(cells.slice(0, -1).map(cell => owners.get(cell)).filter(Boolean))];
    if (parentIds.length > 1) throw new RangeError('A source river node was lost while completing drainage');
    const parent = parentIds[0] ? world.riverGraph.edges.find(e => e.id === parentIds[0]) : null;
    const id = parent ? parent.from === from.id && parent.to === to.id ? parent.id
      : `${parent.id}/from:${start}/to:${end}` : `dynamic-link:${start}:${end}`;
    edges.push({ id, from: from.id, to: to.id, points: cells.map(point),
      sourceEdgeId: parent?.id ?? null, sourceStrahlerOrder: parent?.strahlerOrder ?? null,
      branchId: parent?.branchId ?? null, basinId: basinId(start) });
  }
  // The solver has no receivers beyond its border. Represent that finite-region
  // cut explicitly; it is not evidence of an ocean or a lake.
  for (const [cell, from] of byCell) {
    if (receivers[cell] >= 0) continue;
    const x = cell % world.w, y = Math.floor(cell / world.w);
    if (x !== 0 && x !== world.w - 1 && y !== 0 && y !== world.h - 1) { from.kind = 'unresolved-terminal'; continue; }
    let dx = 0, dy = 0;
    const parents = upstream.get(cell) ?? [];
    const weights = parents.map(i => Number.isFinite(world.flowAccum?.[i]) && world.flowAccum[i] > 0 ? world.flowAccum[i] : 1);
    const maxWeight = Math.max(1, ...weights);
    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i], weight = weights[i] / maxWeight;
      dx += (x - parent % world.w) * weight; dy += (y - Math.floor(parent / world.w)) * weight;
    }
    const outward = () => (x === 0 && dx < 0) || (x === world.w - 1 && dx > 0)
      || (y === 0 && dy < 0) || (y === world.h - 1 && dy > 0);
    let authority = 'inferred-incoming-tangent';
    if (!outward()) {
      dx = (x === world.w - 1 ? 1 : 0) - (x === 0 ? 1 : 0);
      dy = (y === world.h - 1 ? 1 : 0) - (y === 0 ? 1 : 0); authority = 'outward-normal-fallback';
    }
    const length = Math.hypot(dx, dy); dx /= length; dy /= length;
    // Intersect the continuation ray with the finite rectangle, without x/y priority.
    const tx = dx < 0 ? -(x + .5) / dx : dx > 0 ? (world.w - x - .5) / dx : Infinity;
    const ty = dy < 0 ? -(y + .5) / dy : dy > 0 ? (world.h - y - .5) / dy : Infinity;
    const t = Math.min(tx, ty);
    let xM = frame.originXM + (x + .5 + t * dx) * world.cell;
    let yM = frame.originYM + (y + .5 + t * dy) * world.cell;
    if (tx <= ty) xM = frame.originXM + (dx < 0 ? 0 : world.w * world.cell);
    if (ty <= tx) yM = frame.originYM + (dy < 0 ? 0 : world.h * world.cell);
    const to = { id: `dynamic-boundary:${cell}`, xM, yM, basinId: basinId(cell), kind: 'regional-boundary', sourceNodeId: null,
      boundaryDirection: { x: dx || 0, y: dy || 0, authority } };
    nodes.push(to);
    edges.push({ id: `dynamic-boundary-link:${cell}`, from: from.id, to: to.id,
      points: [point(cell), to], sourceEdgeId: null, branchId: null, basinId: basinId(cell) });
  }
  for (const n of world.riverGraph.nodes) if (!nodes.some(current => current.id === n.id)) throw new RangeError('Source node was not preserved');
  for (const e of world.riverGraph.edges) if (!edges.some(current => current.sourceEdgeId === e.id)) throw new RangeError('Source edge identity was not preserved');
  return { nodes, edges, boundaryOutflowPolicy: 'incoming-tangent-or-outward-normal@1' };
}
