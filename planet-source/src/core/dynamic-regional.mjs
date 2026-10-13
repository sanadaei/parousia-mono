import { createTerrainAdapter, TERRAIN_SCHEMA, SMOOTH_TERRAIN_SCHEMA } from './index.mjs';
import { connectSurfaceWater } from './surface-water.mjs';
import { regionalDrainageGraph } from './dynamic-drainage.mjs';

/** Reads an already generated world; never runs a generator or changes its LOD. */
export function fromDynamicRegional(world, {
  verticalDatum, originXM = 0, originYM = 0,
  waterLevelElevationM = null, derivativeStepM = 1,
  waterLevelRole, interpolation,
} = {}) {
  if (!world || !((typeof world.seed === 'string' && world.seed.trim())
    || (typeof world.seed === 'number' && Number.isFinite(world.seed)))) {
    throw new TypeError('Regional world must have a string or finite numeric seed');
  }
  if ((world.widthMeters != null && world.widthMeters !== world.w * world.cell)
    || (world.heightMeters != null && world.heightMeters !== world.h * world.cell)) {
    throw new RangeError('Regional extent does not match its canonical grid');
  }
  const point = p => ({ xM: originXM + p.x, yM: originYM + p.y });
  const rivers = world.riverGraph ?? { nodes: [], edges: [] };
  return createTerrainAdapter({
    schema: interpolation == null ? TERRAIN_SCHEMA : SMOOTH_TERRAIN_SCHEMA, seed: String(world.seed),
    ...(interpolation != null ? { interpolation } : {}),
    revision: 'dynamic-regional-import@1',
    frame: { kind: 'planar-metric', originXM, originYM, verticalDatum },
    grid: { columns: world.w, rows: world.h, cellSizeM: world.cell, sampleLocation: 'cell-center' },
    derivativeStepM,
    fields: { groundElevationM: world.elevation, waterLevelElevationM,
      ...(waterLevelRole != null ? { waterLevelRole } : {}) },
    references: {
      source: 'dynamic-terrain-runtime',
      hydrology: waterLevelElevationM === null ? 'source-graph-only; water-level-unresolved' : 'caller-supplied-water-level',
      riverGraph: {
        nodes: rivers.nodes.map(n => ({ id: n.id, kind: n.kind,
          xM: originXM + n.xMeters, yM: originYM + n.yMeters })),
        edges: rivers.edges.map(e => ({ id: e.id, from: e.from, to: e.to,
          branchId: e.branchId ?? null, strahlerOrder: e.strahlerOrder ?? null,
          points: (e.curvePoints ?? e.points).map(point) })),
      },
      settlements: (world.settlements ?? []).map(s => ({ id: s.id, kind: s.kind,
        xM: originXM + (s.x + 0.5) * world.cell, yM: originYM + (s.y + 0.5) * world.cell })),
      roads: (world.roads ?? []).map(r => ({ id: r.id, from: r.a, to: r.b,
        widthM: r.widthMeters,
        points: (r.centerlineMeters ?? r.path.map(p => ({
          x: (p.x + 0.5) * world.cell, y: (p.y + 0.5) * world.cell,
        }))).map(point) })),
    },
  });
}

/** Explicitly opts into the new static surface-water model. */
export function fromDynamicRegionalWater(world, options = {}) {
  const { waterBodies = [], parameters = {}, channelSizing = null, ...terrainOptions } = options;
  const base = fromDynamicRegional(world, terrainOptions);
  const graph = regionalDrainageGraph(world, base.frame);
  const basin = world.watersheds?.basin, outlet = world.watersheds?.outlet;
  return connectSurfaceWater(base, { riverGraph: graph, waterBodies, parameters, channelSizing,
    basins: basin && outlet ? { namespace: 'dynamic-basin', indices: Array.from(basin), outletCellIndices: Array.from(outlet) } : null });
}
