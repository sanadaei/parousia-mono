// Scene loading for the Stage 5 visualizer. A "scene" wraps one canonical
// terrain adapter from src/core together with the overlays the UI draws
// (water bodies, channels, roads, bridges, building pads) and the road
// pipeline results (crossings → bridge designs → centerlines → earthwork).
//
// All values shown in the UI come from the canonical core samplers. The only
// shortcut is `createCorridorSampler`, which skips the (slow) road-adjusted
// sampler where the earthwork contract guarantees the base sample is returned
// unchanged; it is verified to be value-identical to the adjusted sampler.

import { createTerrainAdapter, restoreTerrain, TERRAIN_SCHEMA, LEGACY_TERRAIN_SCHEMA,
  SMOOTH_TERRAIN_SCHEMA, TRIANGULAR_TERRAIN_SCHEMA } from '../core/index.mjs';
import { restoreGlobalTerrain, createProjectedTerrainView, restoreProjectedTerrainView,
  GLOBAL_TERRAIN_SCHEMA, PROJECTED_TERRAIN_SCHEMA } from '../core/global-terrain.mjs';
import { createGlobalWaterTerrain, createGlobalMultiWaterTerrain, GLOBAL_WATER_TERRAIN_SCHEMA,
  GLOBAL_MULTI_WATER_TERRAIN_SCHEMA } from '../core/global-water.mjs';
import { inspectRoadCrossings } from '../core/road-crossings.mjs';
import { designBridgeProfile, sampleRoadCenterlineProfile, createRoadAdjustedTerrain } from '../core/road-earthwork.mjs';
import { classifyTrafficability } from './trafficability.mjs';
import { pointAlongPolyline, pointInPolygon, polylineLength, rectanglePolygon, nextFrame,
  insideBounds, boundsOfPoints } from './util.mjs';

export const UI_SCENE_SCHEMA = 'minimal-world-ui-scene@1';
export const ROAD_ADJUSTED_SCHEMA = 'minimal-world-road-adjusted-terrain@1';
/** Preserve supplied core diagnostics and metadata in the UI download. */
export function sceneBundleForExport(scene) {
  return JSON.parse(JSON.stringify({ ...scene.rawBundle, schema: UI_SCENE_SCHEMA, label: scene.label }));
}
const PLANAR_SCHEMAS = new Set([TERRAIN_SCHEMA, LEGACY_TERRAIN_SCHEMA, SMOOTH_TERRAIN_SCHEMA, TRIANGULAR_TERRAIN_SCHEMA]);
export const SUPPORTED_SCHEMAS = Object.freeze([...PLANAR_SCHEMAS, GLOBAL_TERRAIN_SCHEMA, PROJECTED_TERRAIN_SCHEMA,
  GLOBAL_WATER_TERRAIN_SCHEMA, GLOBAL_MULTI_WATER_TERRAIN_SCHEMA, ROAD_ADJUSTED_SCHEMA, UI_SCENE_SCHEMA]);

const DEFAULT_GLOBAL_VIEW = { centerLatDeg: 0, centerLonDeg: 0, maxRadiusM: 100000, halfSizeM: 20000 };

// ---------- Terrain restoration ----------

/** Restore any supported snapshot to a metric (x/y metres) terrain adapter plus its overlay model. */
export function restoreMetricTerrain(snapshot, { viewIndex = 0, view = {} } = {}) {
  const schema = snapshot?.schema;
  if (PLANAR_SCHEMAS.has(schema)) {
    const terrain = typeof snapshot.worldId === 'string' ? restoreTerrain(snapshot) : createTerrainAdapter(snapshot);
    const saved = terrain.toSnapshot();
    return { terrain, kind: 'planar', views: [], model: saved.hydrology ?? null, references: saved.references ?? {},
      interpolation: saved.interpolation ?? 'bilinear@1', grid: saved.grid, fields: saved.fields };
  }
  if (schema === PROJECTED_TERRAIN_SCHEMA) {
    const terrain = restoreProjectedTerrainView(snapshot);
    return { terrain, kind: 'projected', views: [], model: null, references: {}, interpolation: snapshot.world?.interpolation };
  }
  if (schema === GLOBAL_TERRAIN_SCHEMA) {
    const global = restoreGlobalTerrain(snapshot), v = { ...DEFAULT_GLOBAL_VIEW, ...view };
    const terrain = createProjectedTerrainView(global, { centerLatDeg: v.centerLatDeg, centerLonDeg: v.centerLonDeg,
      maxRadiusM: v.maxRadiusM, bounds: { minXM: -v.halfSizeM, minYM: -v.halfSizeM, maxXM: v.halfSizeM, maxYM: v.halfSizeM } });
    return { terrain, kind: 'projected', views: [], model: null, references: {}, interpolation: snapshot.interpolation,
      note: `Global terrain shown through an azimuthal view at ${v.centerLatDeg}°, ${v.centerLonDeg}° (±${v.halfSizeM} m).` };
  }
  if (schema === GLOBAL_WATER_TERRAIN_SCHEMA) {
    const global = createGlobalWaterTerrain(snapshot), chart = snapshot.waterChart;
    const terrain = createProjectedTerrainView(global, { ...chart.projection, bounds: chart.bounds });
    return { terrain, kind: 'projected', views: [], model: chart.model, references: {}, interpolation: snapshot.base?.interpolation };
  }
  if (schema === GLOBAL_MULTI_WATER_TERRAIN_SCHEMA) {
    const global = createGlobalMultiWaterTerrain(snapshot), charts = snapshot.waterCharts;
    const index = Math.max(0, Math.min(charts.length - 1, viewIndex)), chart = charts[index];
    const terrain = createProjectedTerrainView(global, { ...chart.projection, bounds: chart.bounds });
    return { terrain, kind: 'projected', views: charts.map((c, i) => ({ index: i, id: c.id, label: `${c.id} (${c.projection.centerLatDeg.toFixed(2)}°, ${c.projection.centerLonDeg.toFixed(2)}°)` })),
      viewIndex: index, model: chart.model, references: {}, interpolation: snapshot.base?.interpolation };
  }
  throw new TypeError(`Unsupported snapshot schema: ${schema ?? '(missing)'}. Supported: ${SUPPORTED_SCHEMAS.join(', ')}`);
}

// ---------- Corridor index: nearest road segment queries ----------

const BLOCK = 48;

/**
 * Spatial index over road centerline profiles (normalized core format:
 * `{ roadId, halfWidthM, samples:[{distanceM,xM,yM,roadElevationM,structureKind,segmentKind?,gradeSlope?}] }`).
 * Segments are grouped into fixed blocks with bounding boxes for pruning.
 */
export function createCorridorIndex(profiles) {
  const roads = profiles.map(profile => {
    const s = profile.samples, n = s.length - 1;
    const seg = { ax: new Float64Array(n), ay: new Float64Array(n), bx: new Float64Array(n), by: new Float64Array(n),
      eLo: new Float64Array(n), eHi: new Float64Array(n), deck: new Uint8Array(n) };
    let eMin = Infinity, eMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = s[i], b = s[i + 1], len = Math.hypot(b.xM - a.xM, b.yM - a.yM);
      seg.ax[i] = a.xM; seg.ay[i] = a.yM; seg.bx[i] = b.xM; seg.by[i] = b.yM;
      // A cubic Hermite departs from its chord by at most (4/27)·L·(|m0−s|+|m1−s|);
      // this margin over-covers that with the endpoint grades and secant rise.
      const margin = len * (Math.abs(a.gradeSlope ?? 0) + Math.abs(b.gradeSlope ?? 0)) / 2
        + 0.5 * Math.abs(b.roadElevationM - a.roadElevationM) + 1e-3;
      seg.eLo[i] = Math.min(a.roadElevationM, b.roadElevationM) - margin;
      seg.eHi[i] = Math.max(a.roadElevationM, b.roadElevationM) + margin;
      eMin = Math.min(eMin, seg.eLo[i]); eMax = Math.max(eMax, seg.eHi[i]);
      const interior = a.segmentKind ?? (a.structureKind === 'bridge-deck' && b.structureKind === 'bridge-deck' ? 'bridge-deck' : 'at-grade');
      seg.deck[i] = a.structureKind === 'bridge-deck' && b.structureKind === 'bridge-deck' && interior === 'bridge-deck' ? 1 : 0;
    }
    const blocks = [];
    for (let start = 0; start < n; start += BLOCK) {
      const end = Math.min(n, start + BLOCK);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = start; i < end; i++) {
        minX = Math.min(minX, seg.ax[i], seg.bx[i]); maxX = Math.max(maxX, seg.ax[i], seg.bx[i]);
        minY = Math.min(minY, seg.ay[i], seg.by[i]); maxY = Math.max(maxY, seg.ay[i], seg.by[i]);
      }
      blocks.push({ start, end, minX, minY, maxX, maxY });
    }
    const box = blocks.reduce((b, k) => ({ minX: Math.min(b.minX, k.minX), minY: Math.min(b.minY, k.minY),
      maxX: Math.max(b.maxX, k.maxX), maxY: Math.max(b.maxY, k.maxY) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    return { roadId: profile.roadId, halfWidthM: profile.halfWidthM, samples: s, seg, blocks, box, eMin, eMax, count: n };
  });

  const boxDistance = (b, x, y) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY));
  function segmentDistance(seg, i, x, y) {
    const ax = seg.ax[i], ay = seg.ay[i], dx = seg.bx[i] - ax, dy = seg.by[i] - ay, len = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((x - ax) * (dx / len) + (y - ay) * (dy / len)) / len));
    const px = t === 0 ? ax : t === 1 ? seg.bx[i] : ax * (1 - t) + seg.bx[i] * t;
    const py = t === 0 ? ay : t === 1 ? seg.by[i] : ay * (1 - t) + seg.by[i] * t;
    return { distance: Math.hypot(x - px, y - py), t };
  }
  /** Nearest segment of one road, pruned at `limit`. Returns null if none is within it. */
  function nearest(road, x, y, limit = Infinity) {
    if (boxDistance(road.box, x, y) > limit) return null;
    let best = limit, index = -1, t = 0;
    for (const block of road.blocks) {
      if (boxDistance(block, x, y) > best) continue;
      for (let i = block.start; i < block.end; i++) {
        const d = segmentDistance(road.seg, i, x, y);
        if (d.distance < best || index < 0 && d.distance <= best) { best = d.distance; index = i; t = d.t; }
      }
    }
    return index < 0 ? null : { distance: best, index, t };
  }
  /** All segments of a road within `distance + tol` (ties for the closest-point rule). */
  function near(road, x, y, distance, tol = 1e-6) {
    const out = [];
    for (const block of road.blocks) {
      if (boxDistance(block, x, y) > distance + tol) continue;
      for (let i = block.start; i < block.end; i++) if (segmentDistance(road.seg, i, x, y).distance <= distance + tol) out.push(i);
    }
    return out;
  }
  return { roads, nearest, near, boxDistance };
}

/**
 * Value-identical fast path for `createRoadAdjustedTerrain(...).sampleAt`.
 * A point can only be modified if it lies on a carriageway or within the
 * batter width 1.5·|Δ|/slope of its closest non-deck station; Δ is bounded
 * using the segment's elevation envelope and the actual base ground there.
 */
export function createCorridorSampler(base, adjusted, index, settings) {
  const minSlope = Math.min(settings.cutBatterSlope, settings.fillBatterSlope);
  let adjustedCalls = 0, baseCalls = 0;
  function mayAdjust(xM, yM, groundM) {
    for (const road of index.roads) {
      const reach = road.halfWidthM + 1.5 * Math.max(Math.abs(road.eMax - groundM), Math.abs(road.eMin - groundM)) / minSlope + 1e-6;
      const hit = index.nearest(road, xM, yM, reach);
      if (!hit) continue;
      const ties = index.near(road, xM, yM, hit.distance);
      if (ties.every(i => road.seg.deck[i])) continue;
      if (hit.distance <= road.halfWidthM + 1e-9) return true;
      let delta = 0;
      for (const i of ties) delta = Math.max(delta, Math.abs(road.seg.eHi[i] - groundM), Math.abs(road.seg.eLo[i] - groundM));
      if (hit.distance - road.halfWidthM < 1.5 * delta / minSlope + 1e-9) return true;
    }
    return false;
  }
  return {
    sampleAt(xM, yM) {
      const sample = base.sampleAt(xM, yM);
      if (!mayAdjust(xM, yM, sample.groundElevationM)) { baseCalls++; return sample; }
      adjustedCalls++;
      return adjusted.sampleAt(xM, yM);
    },
    mayAdjust,
    get stats() { return { baseCalls, adjustedCalls }; },
  };
}

// ---------- Overlay extraction ----------

function overlaysFrom(restored, bundle) {
  const model = restored.model, refs = restored.references ?? {};
  const waterBodies = (model?.bodies ?? []).map(b => ({ id: b.id, kind: b.kind, polygon: b.polygon,
    waterLevelElevationM: b.waterLevelElevationM }));
  const rivers = (model?.edges ?? []).map(e => ({ id: e.id, basinId: e.basinId ?? null, branchId: e.branchId ?? null,
    from: e.from, to: e.to, points: e.points }));
  // Source graphs without a solved model carry no water level: drawn as unresolved.
  const sourceRivers = model ? [] : (refs.riverGraph?.edges ?? []).map(e => ({ id: e.id, points: e.points }));
  const roads = (bundle.roads ?? refs.roads ?? []).map(r => ({ ...r,
    halfWidthM: r.halfWidthM ?? (Number.isFinite(r.widthM) ? r.widthM / 2 : 3) }));
  const settlements = (bundle.settlements ?? refs.settlements ?? []).filter(s => Number.isFinite(s.xM) && Number.isFinite(s.yM));
  const buildingPads = (bundle.buildingPads ?? []).map((pad, i) => ({
    id: pad.id ?? `pad:${i}`, kind: pad.kind ?? 'building',
    polygon: pad.polygon ?? rectanglePolygon(pad), padElevationM: pad.padElevationM ?? null,
  }));
  return { waterBodies, rivers, sourceRivers, roads, settlements, buildingPads, bridges: [] };
}

// ---------- Road pipeline ----------

function bridgeRuns(profile, design) {
  const runs = [];
  let run = null;
  for (const p of profile) {
    if (p.structureKind === 'bridge-deck') {
      run ??= { roadId: p.roadId, startDistanceM: p.distanceM, points: [], minClearanceM: Infinity, deckElevationM: p.roadElevationM };
      run.points.push({ xM: p.xM, yM: p.yM }); run.endDistanceM = p.distanceM;
      if (p.clearanceM !== null && p.clearanceM !== undefined) run.minClearanceM = Math.min(run.minClearanceM, p.clearanceM);
    } else if (run) { runs.push(run); run = null; }
  }
  if (run) runs.push(run);
  for (const r of runs) {
    if (!Number.isFinite(r.minClearanceM)) r.minClearanceM = null;
    r.design = design.find(d => d.startDistanceM <= r.endDistanceM + 1e-6 && d.endDistanceM >= r.startDistanceM - 1e-6) ?? null;
    r.crossingId = r.design?.crossingId ?? null;
  }
  return runs;
}

/** Inspect crossings, design bridges and sample centerlines per road; failures are kept as diagnostics. */
export function runRoadPipeline(terrain, roads, options = {}) {
  const result = { crossings: [], profiles: [], designs: [], roadErrors: [], inspection: null };
  if (!roads.length) return result;
  let inspection;
  try { inspection = inspectRoadCrossings(terrain, { roads, clearanceM: options.clearanceM ?? 1 }); } catch (error) {
    result.roadErrors.push({ roadId: null, message: `Crossing inspection failed: ${error.message}` });
    return result;
  }
  result.inspection = { sampledPoints: inspection.sampledPoints, precision: inspection.precision,
    unresolvedWaterSamples: inspection.unresolvedWaterSamples ?? 0 };
  const groundElevationAt = (x, y) => terrain.groundElevationAt(x, y);
  for (const road of roads) {
    const own = inspection.crossings.filter(c => c.roadId === road.id), designs = [];
    let failed = false;
    for (const crossing of own) {
      const entry = { ...crossing, design: null, designError: null };
      try {
        const design = designBridgeProfile(crossing, road, { groundElevationAt, ...(options.bridge ?? {}) });
        entry.design = { crossingId: crossing.crossingId, startDistanceM: design.startDistanceM, endDistanceM: design.endDistanceM,
          deckElevationM: design.deckElevationM, deckThicknessM: design.deckThicknessM, clearanceM: design.clearanceM,
          minimumClearanceM: design.minimumClearanceM, requiredDeckElevationM: design.requiredDeckElevationM,
          approaches: design.approaches };
        designs.push(design);
      } catch (error) { entry.designError = error.message; failed = true; }
      result.crossings.push(entry);
    }
    if (failed) {
      result.roadErrors.push({ roadId: road.id, message: 'Not profiled: a crossing on this road has no valid bridge design.' });
      continue;
    }
    try {
      const profile = sampleRoadCenterlineProfile(terrain, road, designs, { maxStepM: options.maxStepM ?? 2 });
      result.profiles.push(profile);
      result.designs.push(...designs.map(d => ({ roadId: road.id, crossingId: d.crossingId, startDistanceM: d.startDistanceM,
        endDistanceM: d.endDistanceM, deckElevationM: d.deckElevationM })));
    } catch (error) {
      result.roadErrors.push({ roadId: road.id, message: error.message });
      for (const c of result.crossings) if (c.roadId === road.id && !c.designError) c.designError = `Centerline: ${error.message}`;
    }
  }
  for (const c of result.crossings) {
    c.uiStatus = c.designError ? 'design-failed' : c.design ? 'bridge-designed' : c.status;
  }
  return result;
}

// ---------- Scene ----------

function elevationRangeOf(sampler, bounds, n = 96) {
  let minM = Infinity, maxM = -Infinity;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = i === n ? bounds.maxXM : bounds.minXM + (bounds.maxXM - bounds.minXM) * i / n;
    const y = j === n ? bounds.maxYM : bounds.minYM + (bounds.maxYM - bounds.minYM) * j / n;
    try { const g = sampler.sampleAt(x, y).groundElevationM; minM = Math.min(minM, g); maxM = Math.max(maxM, g); } catch { /* outside chart */ }
  }
  if (!Number.isFinite(minM)) return { minM: 0, maxM: 1 };
  if (maxM - minM < 1e-6) { minM -= 0.5; maxM += 0.5; }
  return { minM, maxM };
}

function parseInput(input) {
  if (typeof input === 'string') return JSON.parse(input);
  if (input && typeof input === 'object') return input;
  throw new TypeError('Scene input must be a JSON string or object');
}

/**
 * Load a scene from a snapshot (any supported schema), a road-adjusted recipe,
 * or a `minimal-world-ui-scene@1` bundle `{ terrain, roads?, buildingPads?, view?, roadOptions? }`.
 */
export async function loadScene(input, { label = null, viewIndex = 0, onProgress = () => {}, buildRoads = true } = {}) {
  const t0 = performance.now(), timings = {};
  const step = async (name, message) => { onProgress(message); await nextFrame(); timings[name] = performance.now(); };
  await step('parse', 'Parsing JSON…');
  const raw = parseInput(input);
  const bundle = raw.schema === UI_SCENE_SCHEMA ? raw : { terrain: raw };
  const recipe = bundle.terrain?.schema === ROAD_ADJUSTED_SCHEMA ? bundle.terrain : null;
  const snapshot = recipe ? recipe.baseTerrain : bundle.terrain;

  await step('restore', `Restoring ${snapshot?.schema ?? 'snapshot'} (verifying worldId)…`);
  const restored = restoreMetricTerrain(snapshot, { viewIndex, view: bundle.view });
  const base = restored.terrain;
  const overlays = overlaysFrom(restored, bundle);
  const warnings = [];
  if (restored.note) warnings.push(restored.note);

  let pipeline = { crossings: [], profiles: [], designs: [], roadErrors: [], inspection: null };
  let adjusted = null, normalizedProfiles = [], roadSettings = null;
  if (recipe) {
    await step('roads', 'Rebuilding road earthwork recipe…');
    adjusted = createRoadAdjustedTerrain(base, recipe.roadCenterlineProfiles, recipe.options);
    if (adjusted.roadAdjustmentId !== recipe.roadAdjustmentId) warnings.push('Recipe roadAdjustmentId differs from the rebuilt overlay.');
  } else if (buildRoads && overlays.roads.length) {
    await step('roads', `Diagnosing ${overlays.roads.length} road(s): crossings, bridges, centerlines…`);
    pipeline = runRoadPipeline(base, overlays.roads, bundle.roadOptions);
    if (pipeline.profiles.length) {
      await step('earthwork', 'Building cut/fill earthwork overlay…');
      try { adjusted = createRoadAdjustedTerrain(base, pipeline.profiles, bundle.roadOptions?.earthwork ?? {}); } catch (error) {
        warnings.push(`Earthwork overlay failed: ${error.message}`);
      }
    }
  }
  if (adjusted) {
    const saved = adjusted.toSnapshot();
    normalizedProfiles = saved.roadCenterlineProfiles; roadSettings = saved.options;
    if (recipe) {
      // Roads from a recipe: draw their centerlines from the saved profiles.
      for (const p of normalizedProfiles) {
        if (!overlays.roads.some(r => r.id === p.roadId)) overlays.roads.push({ id: p.roadId, halfWidthM: p.halfWidthM, points: p.samples.map(s => ({ xM: s.xM, yM: s.yM })) });
      }
    }
  }
  const index = createCorridorIndex(normalizedProfiles);
  const terrain = adjusted ?? base;
  const sampler = adjusted ? createCorridorSampler(base, adjusted, index, roadSettings) : { sampleAt: (x, y) => base.sampleAt(x, y), mayAdjust: () => false };
  sampler.trafficabilityAt = (xM, yM, sample = sampler.sampleAt(xM, yM)) =>
    classifyTrafficability({ ...sample, ...(terrain.roadSurfaceAt?.(xM, yM) ?? {}) });

  // Centerline profiles keyed by road, and bridge spans for drawing.
  const roadProfiles = new Map();
  for (const profile of pipeline.profiles) roadProfiles.set(profile[0].roadId, profile);
  for (const p of normalizedProfiles) if (!roadProfiles.has(p.roadId)) roadProfiles.set(p.roadId, p.samples.map(s => ({ ...s, roadId: p.roadId })));
  for (const [roadId, profile] of roadProfiles) {
    const designs = pipeline.crossings.filter(c => c.roadId === roadId && c.design).map(c => c.design);
    overlays.bridges.push(...bridgeRuns(profile, designs));
  }

  await step('range', 'Measuring scene elevation range…');
  const bounds = { ...base.bounds };
  const elevationRange = elevationRangeOf(base, bounds);
  for (const pad of overlays.buildingPads) {
    const centroid = pad.polygon.reduce((a, p) => ({ xM: a.xM + p.xM / pad.polygon.length, yM: a.yM + p.yM / pad.polygon.length }), { xM: 0, yM: 0 });
    pad.centroid = centroid;
    const grounds = [...pad.polygon, centroid].filter(p => insideBounds(bounds, p.xM, p.yM)).map(p => sampler.sampleAt(p.xM, p.yM).groundElevationM);
    pad.groundMinM = grounds.length ? Math.min(...grounds) : null;
    pad.groundMaxM = grounds.length ? Math.max(...grounds) : null;
    pad.padElevationM ??= grounds.length ? grounds.at(-1) : null;
  }

  const scene = {
    id: terrain.roadAdjustmentId ?? base.regionId ?? base.worldId,
    label: label ?? bundle.label ?? snapshot?.seed ?? snapshot?.schema,
    schema: snapshot.schema, kind: restored.kind, interpolation: restored.interpolation ?? null,
    worldId: base.worldId, regionId: base.regionId ?? null, roadAdjustmentId: adjusted?.roadAdjustmentId ?? null,
    bounds, frame: base.frame, verticalDatum: base.frame?.verticalDatum ?? null, grid: restored.grid ?? base.grid ?? null,
    hydrologyStatus: base.hydrologyStatus ?? 'unresolved',
    views: restored.views, viewIndex: restored.viewIndex ?? 0,
    base, terrain, sampler, corridorIndex: index, roadSettings,
    elevationRange, overlays, roadProfiles,
    crossings: pipeline.crossings, roadErrors: pipeline.roadErrors, roadInspection: pipeline.inspection,
    warnings, rawBundle: bundle,
    timings: { totalMs: performance.now() - t0, ...Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, v - t0])) },
  };
  scene.structureAt = (xM, yM, sample) => structureAt(scene, xM, yM, sample);
  scene.lineProfile = (a, b, options) => sampleLineProfile(scene, a, b, options);
  scene.roadPathProfile = (roadId, options) => roadPathProfile(scene, roadId, options);
  onProgress(null);
  return scene;
}

// ---------- Queries used by the inspector and profile chart ----------

/** Classify what occupies a point: building pad, road structure, batter, water, or natural ground. */
export function structureAt(scene, xM, yM, sample = scene.sampler.sampleAt(xM, yM)) {
  for (const pad of scene.overlays.buildingPads) {
    if (pointInPolygon(xM, yM, pad.polygon)) return { structureKind: 'building-pad', featureId: pad.id, padElevationM: pad.padElevationM };
  }
  const index = scene.corridorIndex;
  let road = null;
  for (const r of index.roads) {
    const hit = index.nearest(r, xM, yM, r.halfWidthM);
    if (hit && (!road || hit.distance < road.hit.distance)) road = { r, hit };
  }
  if (road) {
    const { r, hit } = road, a = r.samples[hit.index], b = r.samples[hit.index + 1];
    const kind = hit.t === 0 ? a.structureKind : hit.t === 1 ? b.structureKind
      : a.segmentKind ?? (a.structureKind === 'bridge-deck' && b.structureKind === 'bridge-deck' ? 'bridge-deck' : 'at-grade');
    const stationM = a.distanceM + (b.distanceM - a.distanceM) * hit.t;
    const roadElevationM = a.roadElevationM + (b.roadElevationM - a.roadElevationM) * hit.t;
    return { structureKind: kind, featureId: r.roadId, stationM, roadElevationApproxM: roadElevationM, offsetM: hit.distance };
  }
  if (sample.roadAdjustmentId) {
    const baseGround = scene.base.groundElevationAt(xM, yM);
    return { structureKind: 'batter', featureId: null, batterKind: sample.groundElevationM >= baseGround ? 'fill' : 'cut',
      earthworkDeltaM: sample.groundElevationM - baseGround };
  }
  if (sample.waterDepthM !== null && sample.waterDepthM > 0) {
    const body = scene.overlays.waterBodies.find(b => pointInPolygon(xM, yM, b.polygon));
    return { structureKind: 'water', featureId: body?.id ?? sample.waterSourceIds?.[0] ?? null, waterBodyKind: body?.kind ?? (sample.waterSourceIds?.length ? 'channel' : 'water-level-grid') };
  }
  return { structureKind: 'natural-ground', featureId: null };
}

function profilePoint(scene, distanceM, xM, yM, sample) {
  const p = { distanceM, xM, yM, groundElevationM: sample.groundElevationM, waterSurfaceElevationM: sample.waterSurfaceElevationM ?? null,
    waterDepthM: sample.waterDepthM ?? null, surfaceKind: sample.surfaceKind, roadElevationM: null, structureKind: null };
  if (sample.roadAdjustmentId) p.baseGroundElevationM = scene.base.groundElevationAt(xM, yM);
  return p;
}

/**
 * Cross-section along a straight segment. The canonical trace supplies
 * water/mesh events; points within road corridors use the adjusted sampler.
 */
export function sampleLineProfile(scene, a, b, { targetSamples = 600 } = {}) {
  const clampPoint = p => ({ xM: Math.min(scene.bounds.maxXM, Math.max(scene.bounds.minXM, p.xM)),
    yM: Math.min(scene.bounds.maxYM, Math.max(scene.bounds.minYM, p.yM)) });
  a = clampPoint(a); b = clampPoint(b);
  const lengthM = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  if (lengthM === 0) throw new RangeError('Profile line has zero length');
  const maxStepM = Math.max(lengthM / targetSamples, 1e-3);
  const trace = scene.base.traceSurfaceSegment(a, b, { maxStepM, maxSamples: Math.min(262144, targetSamples * 8 + 64) });
  const samples = trace.samples.map(s => {
    const sample = scene.sampler.mayAdjust(s.xM, s.yM, s.groundElevationM) ? scene.terrain.sampleAt(s.xM, s.yM) : s;
    return profilePoint(scene, s.distanceM, s.xM, s.yM, sample);
  });
  return { kind: 'line', id: `line:${a.xM.toFixed(1)},${a.yM.toFixed(1)}→${b.xM.toFixed(1)},${b.yM.toFixed(1)}`,
    label: 'Cross-section', a, b, lengthM, path: [a, b], samples, precision: trace.precision ?? null };
}

/** Longitudinal profile of a road: the core centerline profile when designed, else a traced polyline. */
export function roadPathProfile(scene, roadId, { targetSamples = 1500 } = {}) {
  const road = scene.overlays.roads.find(r => r.id === roadId);
  if (!road) throw new RangeError(`Unknown road ${roadId}`);
  const centerline = scene.roadProfiles.get(roadId);
  if (centerline) {
    return { kind: 'road', id: `road:${roadId}`, label: `Road ${roadId}`, roadId, designed: true,
      lengthM: centerline.at(-1).distanceM, path: road.points,
      bridges: scene.overlays.bridges.filter(b => b.roadId === roadId),
      samples: centerline.map(p => ({ distanceM: p.distanceM, xM: p.xM, yM: p.yM, groundElevationM: p.groundElevationM,
        waterSurfaceElevationM: p.waterSurfaceElevationM ?? null, waterDepthM: p.waterSurfaceElevationM !== null && p.waterSurfaceElevationM !== undefined
          ? Math.max(0, p.waterSurfaceElevationM - p.groundElevationM) : null,
        roadElevationM: p.roadElevationM, structureKind: p.structureKind, clearanceM: p.clearanceM ?? null, gradeSlope: p.gradeSlope ?? null })) };
  }
  const total = polylineLength(road.points), samples = [];
  let offset = 0;
  const step = Math.max(total / targetSamples, 0.5);
  for (let i = 1; i < road.points.length; i++) {
    const trace = scene.base.traceSurfaceSegment(road.points[i - 1], road.points[i], { maxStepM: step, maxSamples: 262144 });
    for (let j = i > 1 ? 1 : 0; j < trace.samples.length; j++) {
      const s = trace.samples[j];
      samples.push(profilePoint(scene, offset + s.distanceM, s.xM, s.yM, s));
    }
    offset += trace.lengthM;
  }
  return { kind: 'road', id: `road:${roadId}`, label: `Road ${roadId} (not designed)`, roadId, designed: false,
    lengthM: total, path: road.points, bridges: [], samples };
}

/** World position of a crossing (midpoint of its wet run) and a framing box. */
export function crossingLocation(scene, crossing) {
  const road = scene.overlays.roads.find(r => r.id === crossing.roadId);
  if (!road) return null;
  const mid = pointAlongPolyline(road.points, (crossing.startDistanceM + crossing.endDistanceM) / 2);
  const from = crossing.design?.approaches?.before?.startDistanceM ?? crossing.design?.startDistanceM ?? crossing.startDistanceM;
  const to = crossing.design?.approaches?.after?.endDistanceM ?? crossing.design?.endDistanceM ?? crossing.endDistanceM;
  const ends = [pointAlongPolyline(road.points, from - 20), pointAlongPolyline(road.points, to + 20)];
  return { center: mid, bounds: boundsOfPoints([...ends, mid], 30), fromDistanceM: Math.max(0, from - 60), toDistanceM: to + 60 };
}
