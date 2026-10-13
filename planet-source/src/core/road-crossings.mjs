/** Inspect road centerlines without moving roads or inventing bridges.
 * Results are review candidates; deck approaches, loads and routing are Stage 4.
 */
export function inspectRoadCrossings(terrain, {
  roads = terrain.toSnapshot().references?.roads ?? [], maxStepM = 2,
  clearanceM = 1, bridges = [], maxSamples = 262144,
} = {}) {
  if (!Number.isFinite(clearanceM) || clearanceM < 0 || !Number.isFinite(maxStepM) || maxStepM <= 0
    || !Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > 262144) throw new TypeError('Invalid road inspection limits');
  if (!Array.isArray(roads) || roads.length > 4096 || !Array.isArray(bridges)) throw new RangeError('Invalid road or bridge collection');
  const roadIds = new Set(), deckByCrossing = new Map();
  for (const bridge of bridges) {
    if (typeof bridge.crossingId !== 'string' || deckByCrossing.has(bridge.crossingId)
      || !Number.isFinite(bridge.deckElevationM)) throw new TypeError('Bridge needs a unique crossingId and finite deckElevationM');
    if (bridge.worldId !== terrain.worldId) throw new RangeError('Bridge approval must match the terrain worldId');
    if (terrain.regionId && bridge.regionId !== terrain.regionId) throw new RangeError('Bridge approval must match the projected regionId');
    deckByCrossing.set(bridge.crossingId, bridge.deckElevationM);
  }
  const crossings = []; let sampledPoints = 0, unresolvedWaterSamples = 0;
  for (const road of roads) {
    if (typeof road.id !== 'string' || !road.id || roadIds.has(road.id)
      || !Array.isArray(road.points) || road.points.length < 2) throw new TypeError('Road needs a unique ID and a metric centerline');
    roadIds.add(road.id);
    let offsetM = 0, run = null, previous = null, crossingIndex = 0;
    function finish(nextDry) {
      if (!run) return;
      const crossingId = `${road.id}/crossing:${crossingIndex++}`;
      const deckElevationM = deckByCrossing.get(crossingId) ?? null;
      const requiredDeckElevationM = run.maxWaterLevelElevationM + clearanceM;
      crossings.push({ crossingId, roadId: road.id, worldId: terrain.worldId,
        ...(terrain.regionId ? { regionId: terrain.regionId } : {}),
        startDistanceM: run.start.distanceM, endDistanceM: run.end.distanceM,
        dryApproachBefore: run.before, dryApproachAfter: nextDry,
        waterSourceIds: [...run.sources].sort(), sampledWaterPoints: run.count,
        maxWaterLevelElevationM: run.maxWaterLevelElevationM, requiredDeckElevationM,
        deckElevationM, status: deckElevationM === null ? 'bridge-height-required'
          : deckElevationM < requiredDeckElevationM ? 'insufficient-sampled-clearance' : 'sampled-clearance-met',
        requiresStage4Review: true, maxProbeSpacingM: maxStepM });
      run = null;
    }
    for (let i = 1; i < road.points.length; i++) {
      const trace = terrain.traceSurfaceSegment(road.points[i - 1], road.points[i],
        { maxStepM, maxSamples: maxSamples - sampledPoints });
      sampledPoints += trace.samples.length;
      for (let j = i > 1 ? 1 : 0; j < trace.samples.length; j++) {
        const p = trace.samples[j], witness = { xM: p.xM, yM: p.yM, distanceM: offsetM + p.distanceM,
          groundElevationM: p.groundElevationM, waterSurfaceElevationM: p.waterSurfaceElevationM };
        if (p.waterDepthM === null) { unresolvedWaterSamples++; finish(null); previous = null; continue; }
        if (p.waterDepthM > 1e-8) {
          run ??= { start: witness, before: previous, maxWaterLevelElevationM: -Infinity, sources: new Set(), count: 0 };
          run.end = witness; run.count++;
          run.maxWaterLevelElevationM = Math.max(run.maxWaterLevelElevationM, p.waterSurfaceElevationM);
          for (const id of p.waterSourceIds ?? ['water-level-grid']) run.sources.add(id);
        } else finish(witness);
        previous = witness;
      }
      offsetM += trace.lengthM;
    }
    finish(null);
  }
  for (const id of deckByCrossing.keys()) if (!crossings.some(c => c.crossingId === id)) throw new RangeError(`Unknown bridge crossing: ${id}`);
  return { worldId: terrain.worldId, hydrologyStatus: terrain.hydrologyStatus, roadCount: roads.length, sampledPoints,
    ...(terrain.regionId ? { regionId: terrain.regionId } : {}),
    ...(terrain.hydrologyStatus === 'unresolved' || unresolvedWaterSamples ? { unresolvedWaterSamples } : {}),
    precision: terrain.tracePrecision ?? 'mesh/body events and bounded centerline probes; not full road-width or structural acceptance', crossings };
}
