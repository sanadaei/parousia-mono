/** Optional stream-order heuristic; these dimensions are not discharge estimates. */
export function channelSizes(graph, topologyOrder, parameters, input) {
  if (input == null) return null;
  const defaults = { mode: 'strahler', widthFactor: 1.25, depthFactor: 1.12,
    maxHalfWidthM: parameters.halfWidthM * 4, maxBankWidthM: parameters.bankWidthM * 4,
    maxDepthM: parameters.depthM * 2 };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid channelSizing');
  const settings = { ...defaults, ...input };
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in defaults) || (key === 'mode' ? value !== 'strahler' : !Number.isFinite(value) || value <= 0)) throw new TypeError(`Invalid channelSizing: ${key}`);
  }
  if (settings.widthFactor < 1 || settings.depthFactor < 1
    || settings.maxHalfWidthM < parameters.halfWidthM || settings.maxBankWidthM < parameters.bankWidthM
    || settings.maxDepthM < parameters.depthM) throw new RangeError('Channel growth factors and caps must retain the base dimensions');
  const outgoing = new Map(graph.nodes.map(n => [n.id, []])), incoming = new Map(graph.nodes.map(n => [n.id, []]));
  for (const edge of graph.edges) {
    outgoing.get(edge.from).push(edge);
    const sourceOrder = edge.sourceStrahlerOrder ?? edge.strahlerOrder ?? null;
    if (sourceOrder !== null && (!Number.isSafeInteger(sourceOrder) || sourceOrder < 1 || sourceOrder > 32)) throw new RangeError('Source Strahler order must be an integer from 1 to 32');
  }
  if ([...outgoing.values()].some(edges => edges.length > 1)) throw new RangeError('Strahler sizing requires a non-bifurcating drainage graph');
  const sizes = new Map(), radii = new Map(graph.nodes.map(n => [n.id, 2 * (parameters.halfWidthM + parameters.bankWidthM)]));
  for (const id of topologyOrder) {
    const orders = incoming.get(id), max = orders.length ? Math.max(...orders) : 1;
    const derivedOrder = max + (orders.filter(order => order === max).length >= 2 ? 1 : 0);
    for (const edge of outgoing.get(id)) {
      const sourceStrahlerOrder = edge.sourceStrahlerOrder ?? edge.strahlerOrder ?? null;
      const strahlerOrder = Math.max(derivedOrder, sourceStrahlerOrder ?? 1);
      const size = { sourceStrahlerOrder, derivedStrahlerOrder: derivedOrder, strahlerOrder,
        halfWidthM: Math.min(settings.maxHalfWidthM, parameters.halfWidthM * settings.widthFactor ** (strahlerOrder - 1)),
        bankWidthM: Math.min(settings.maxBankWidthM, parameters.bankWidthM * settings.widthFactor ** (strahlerOrder - 1)),
        depthM: Math.min(settings.maxDepthM, parameters.depthM * settings.depthFactor ** (strahlerOrder - 1)) };
      sizes.set(edge.id, size); incoming.get(edge.to).push(strahlerOrder);
      const radius = 2 * (size.halfWidthM + size.bankWidthM);
      for (const node of [edge.from, edge.to]) radii.set(node, Math.max(radii.get(node), radius));
    }
  }
  return { settings, sizes, radii };
}
