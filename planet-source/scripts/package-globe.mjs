import {createTerrainBandNoise} from '../src/core/terrain-band-noise.mjs';
import {roadCrossSectionOffsetBound} from '../src/core/road-cross-section.mjs';
import { isAnchoredDetailMethod } from '../src/core/shore-detail.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createGlobalTerrain, GLOBAL_TERRAIN_SCHEMA } from '../src/core/global-terrain.mjs';
import { createSphericalNoise } from '../src/core/spherical-noise.mjs';
import { geographicPoint, sphereBasis, createSphericalProjection } from '../src/core/spherical.mjs';
import { connectGlobalSurfaceWater } from '../src/core/global-water.mjs';
import { createGlobeFeatureChart } from '../src/core/globe-features.mjs';
import { hashJson } from '../src/core/json-contract.mjs';
import { createPeriodicHermiteField } from '../src/core/periodic-field.mjs';
import { createProjectedGroundBounds } from '../src/core/projected-ground-bounds.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function packageGlobe(terrain, directory, { recipe = null, recipes = recipe ? [recipe] : [], name = 'Core globe', focus = { latDeg: 35, lonDeg: 135 }, canonicalWorldId = null, featureNamespace = false, baseWaterPolicy = null } = {}) {
  if(baseWaterPolicy!=null&&!['explicit-charts-only@1','base-water-outside-charts@1'].includes(baseWaterPolicy))throw new TypeError('Unsupported page base water policy');
  const s = terrain.toSnapshot();
  if (s.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Package the base global field; supply explicit fitted feature recipe separately');
  fs.mkdirSync(path.join(directory, 'fields'), { recursive: true });
  const size = 16, { columns: w, rows: h } = s.grid, pages = {};
  for (let py = 0; py < Math.ceil(h / size); py++) for (let px = 0; px < Math.ceil(w / size); px++) {
    const width = Math.min(size, w - px * size), height = Math.min(size, h - py * size), bytes = Buffer.alloc(width * height * 8);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes.writeDoubleLE(s.fields.groundElevationM[(py * size + y) * w + px * size + x], (y * width + x) * 8);
    const file = `fields/${px}-${py}.bin`; fs.writeFileSync(path.join(directory, file), bytes);
    pages[`${px}/${py}`] = { path: file, bytes: bytes.length, sha256: sha(bytes) };
  }
  const { fields, references, ...base } = s;
  // Small analytic metadata, not another height grid. Bernstein derivative
  // hulls bound the canonical field in each source latitude strip.
  const field = createPeriodicHermiteField(fields.groundElevationM, w, h), radius = s.frame.radiusM, alpha = Math.PI / (2 * h);
  const amplitude = s.detail.bands.reduce((sum, b) => sum + b.amplitudeM, 0);
  const rowLipschitz = Array.from({ length: h - 1 }, (_, y) => {
    const range = field.derivativeBounds({ minXM: 0, maxXM: w, minYM: y + .5, maxYM: y + 1.5 });
    const cosine = Math.min(Math.sin((y + .5) * Math.PI / h), Math.sin((y + 1.5) * Math.PI / h));
    const lonRate = w / (2 * Math.PI * radius * Math.max(Math.sin(alpha), cosine)), latRate = h / (Math.PI * radius);
    const baseBound = Math.hypot(range.x * lonRate, range.y * latRate);
    const detailBound = isAnchoredDetailMethod(s.detail.method) ? (terrain.detailLipschitzForLatitudeRange?.(Math.PI/2-(y+1.5)*Math.PI/h,Math.PI/2-(y+.5)*Math.PI/h)??terrain.detailLipschitzMPerM)+(terrain.detailBaseGradientMultiplier??0)*baseBound
      : baseBound + 16 / (3 * Math.sqrt(3)) * amplitude * Math.hypot(lonRate, latRate) + 3 * Math.sqrt(3) * s.detail.bands.reduce((sum, b) => sum + b.amplitudeM / b.wavelengthM, 0);
    return (baseBound + detailBound) * (1 + 1e-8);
  });
  const poleLipschitz = [0, h - 1].map(y => {
    const rect = { minXM: 0, maxXM: w, minYM: y + .5, maxYM: y + .5 }, g = field.derivativeBounds(rect), range = field.rectangleBounds(rect);
    const mean = fields.groundElevationM.slice(y * w, (y + 1) * w).reduce((sum, v) => sum + v / w, 0);
    const baseBound = Math.hypot(g.x * w / (2 * Math.PI) * 3 / (radius * Math.sin(alpha)), Math.max(Math.abs(range.min - mean), Math.abs(range.max - mean)) * 1.5 / (radius * alpha));
    return (baseBound*(1+(terrain.detailBaseGradientMultiplier??0)) + (terrain.detailLipschitzMPerM ?? 0)) * (1 + 1e-8);
  });
  const detailPoleMeans = {};
  for (const b of s.detail.bands.filter(b => b.amplitudeM > 0)) {
    const noise = createTerrainBandNoise(`${s.seed}|${b.id}|${b.wavelengthM}`, s.frame.radiusM, b);
    const row = y => Array.from({ length: w }, (_, x) => noise(sphereBasis(geographicPoint(90 - (y + .5) * 180 / h, (x + .5) * 360 / w)).up)).reduce((sum, v) => sum + v / w, 0);
    detailPoleMeans[b.id] = { north: row(0), south: row(h - 1) };
  }
  const manifest = { schema: 'minimal-world-globe-pages@1', name, worldId: recipes.length ? hashJson({ baseWorldId: s.worldId, recipes, ...(baseWaterPolicy?{baseWaterPolicy}:{}) }) : s.worldId,
    canonicalWorldId: canonicalWorldId ?? s.worldId, featureNamespace, ...(baseWaterPolicy?{baseWaterPolicy}:{}),
    base, ...(s.references.localPonds?{localPonds:s.references.localPonds}:{}), ...(s.references.sea ? { sea: s.references.sea, lakes: s.references.lakes ?? [], rivers: s.references.rivers ?? null } : {}), pageSize: size, pages, poles: { north: fields.groundElevationM.slice(0, w).reduce((sum, v) => sum + v / w, 0), south: fields.groundElevationM.slice(-w).reduce((sum, v) => sum + v / w, 0) },
    detailPoleMeans, rowLipschitz, poleLipschitz, poleRingRange: {
      north: [Math.min(...fields.groundElevationM.slice(0, w)), Math.max(...fields.groundElevationM.slice(0, w))],
      south: [Math.min(...fields.groundElevationM.slice(-w)), Math.max(...fields.groundElevationM.slice(-w))] },
    elevationRangeM: [fields.groundElevationM.reduce((m, v) => Math.min(m, v), Infinity) + s.frame.elevationOffsetM - amplitude,
      fields.groundElevationM.reduce((m, v) => Math.max(m, v), -Infinity) + s.frame.elevationOffsetM + amplitude],
    reliefBoundM: fields.groundElevationM.reduce((m, v) => Math.max(m, v), -Infinity) - fields.groundElevationM.reduce((m, v) => Math.min(m, v), Infinity) + s.detail.bands.reduce((sum, b) => sum + b.amplitudeM * 2, 0), focus };
  if(s.references.rivers){
    const incision=s.references.rivers.diagnostics.maxIncisionM;manifest.elevationRangeM[0]-=incision;
    manifest.riverDescriptors=s.references.rivers.profiles.map(profile=>{
      const start=sphereBasis(profile.points[0]).up,end=sphereBasis(profile.points.at(-1)).up,sum=start.map((v,i)=>v+end[i]),length=Math.hypot(...sum);
      const center=sum.map(v=>v/length),angularRadius=profile.points.reduce((m,p)=>Math.max(m,Math.acos(Math.max(-1,Math.min(1,sphereBasis(p).up.reduce((s,v,i)=>s+v*center[i],0))))+(p.halfWidthM+p.bankWidthM)/radius),0);
      return {kind:'river',center,angularRadius,verticalAllowanceM:incision,minimumOffsetM:-incision,maximumOffsetM:0};
    });
  }
  const descriptors = [];
  for (const [recipeIndex, recipe] of recipes.entries()) {
    // Validate against the resident Core before publishing the compact fitted recipe.
    const chart = createGlobeFeatureChart(terrain, recipe), b = recipe.bounds;
    for (let j = 0; j <= 12; j++) for (let i = 0; i <= 12; i++) {
      const x = b.minXM + (b.maxXM - b.minXM) * i / 12, y = b.minYM + (b.maxYM - b.minYM) * j / 12;
      const p = chart.projection.toGeographic(x, y);
      if (!(recipe.interChartBoundaryNodeIds?.length) && (i === 0 || j === 0 || i === 12 || j === 12)) {
        if (Math.abs(chart.groundElevationAt(p.latDeg, p.lonDeg) - terrain.groundElevationAt(p.latDeg, p.lonDeg)) > 1e-9) throw new Error('Feature earthwork reaches chart boundary');
      }
    }
    const analysis = createProjectedGroundBounds(terrain, chart.projection, b, 20), center = terrain.groundElevationAt(recipe.projection.centerLatDeg, recipe.projection.centerLonDeg);
    const extent = Math.max(...[b.minXM, b.maxXM].flatMap(x => [b.minYM, b.maxYM].map(y => Math.hypot(x, y)))), uncertainty = analysis.contract.lipschitzMPerM * extent;
    const baseLow = center - uncertainty, baseHigh = center + uncertainty, levels = [];
    for (const e of recipe.model.edges) for (const p of e.points) levels.push(p.waterLevelElevationM, p.waterLevelElevationM - p.depthM);
    for (const body of recipe.model.bodies) levels.push(body.waterLevelElevationM);
    for (const pad of recipe.buildingPads ?? []) levels.push(pad.targetPadElevationM);
    for (const building of recipe.buildings ?? []) levels.push(building.baseElevationM + building.heightM + building.roofHeightM);
    for (const road of recipe.roadCenterlineProfiles ?? []) for (let i = 1; i < road.samples.length; i++) {
      const a = road.samples[i - 1], z = road.samples[i], length = z.distanceM - a.distanceM, secant = (z.roadElevationM - a.roadElevationM) / length;
      const crossBound=roadCrossSectionOffsetBound(road.crossSection,road.halfWidthM??3);levels.push(a.roadElevationM-crossBound,a.roadElevationM+crossBound,z.roadElevationM-crossBound,z.roadElevationM+crossBound);
      levels.push(a.roadElevationM, z.roadElevationM, a.roadElevationM + (a.gradeSlope ?? secant) * length / 3, z.roadElevationM - (z.gradeSlope ?? secant) * length / 3);
    }
    const crossAllowanceM=Math.max(0,...(recipe.roadCenterlineProfiles??[]).map(r=>roadCrossSectionOffsetBound(r.crossSection,r.halfWidthM??3)));
    const verticalAllowanceM = Math.max(recipe.model?.bed?.maxIncisionM??0,crossAllowanceM+levels.reduce((max, z) => Math.max(max, Math.abs(z - baseLow), Math.abs(z - baseHigh)), 0)) + .1;
    const featurePath = recipes.length === 1 ? 'features.json' : `features-${recipeIndex}.json`, text = JSON.stringify(recipe); fs.writeFileSync(path.join(directory, featurePath), text);
    descriptors.push({ path: featurePath, bytes: Buffer.byteLength(text), sha256: sha(text),
      center: sphereBasis(geographicPoint(recipe.projection.centerLatDeg, recipe.projection.centerLonDeg)).up,
      angularRadius: extent / s.frame.radiusM, verticalAllowanceM });
  }
  if (descriptors.length === 1) manifest.features = descriptors[0]; else if (descriptors.length) manifest.featureCharts = descriptors;
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
export function globeDemo() {
  const w = 512, h = 256, radiusM = 6371000;
  const values = Array.from({ length: w * h }, (_, i) => {
    const lat = 90 - (Math.floor(i / w) + .5) * 180 / h, lon = (i % w + .5) * 360 / w;
    if (Math.abs(lat - 35) < 6 && Math.abs(lon - 135) < 6) return 600;
    const p = lat * Math.PI / 180, q = lon * Math.PI / 180;
    return 1800 + 2500 * Math.sin(q * 3 + Math.cos(p * 2)) * Math.cos(p) ** 2 + 1400 * Math.sin(p * 7 + q * 2) ** 4;
  });
  const base = createGlobalTerrain({ schema: GLOBAL_TERRAIN_SCHEMA, seed: 'globe-paging-demo', revision: 'prototype@1',
    frame: { radiusM, sourceVerticalDatum: 'demo-zero', verticalDatum: 'demo-zero' }, grid: { columns: w, rows: h, macroColumns: 32, macroRows: 16 }, derivativeStepM: 1,
    fields: { groundElevationM: values, landMask: Array(w * h).fill(1), downstream: Array(w * h).fill(-1) },
    detail: { method: 'anchored-spherical-residual-bands@2', bands: [{ id: 'hills', wavelengthM: 1000, amplitudeM: 3 }] },
    references: { macroCellIds: Array.from({ length: 512 }, (_, i) => `demo:${i}`) } });
  const centerLatDeg = 35, centerLonDeg = 135, bounds = { minXM: -400, minYM: -400, maxXM: 400, maxYM: 400 };
  const a = { id: 'source', xM: 0, yM: -250 }, b = { id: 'out', xM: 0, yM: 250 };
  const water = connectGlobalSurfaceWater(base, { centerLatDeg, centerLonDeg, maxRadiusM: 2000, bounds, verticalDatum: 'demo-zero',
    riverGraph: { nodes: [a, b], edges: [{ id: 'demo-river', from: a.id, to: b.id, points: [a, b] }] }, parameters: { halfWidthM: 7, bankWidthM: 12, depthM: 2, freeboardM: .8, profileStepM: 20 }, groundBoundsStepM: 10, maxCenterIncisionM: 20, bed:{method:'compact-c1-incision@1',maxIncisionM:20} });
  const chart = water.toSnapshot().waterChart, projection = createSphericalProjection(chart.projection);
  const level = x => { const p = projection.toGeographic(x, 0); return base.groundElevationAt(p.latDeg, p.lonDeg); };
  const deck = Math.max(level(-25), level(25)) + 3;
  const xs = [-180, -80, -18, 18, 80, 180];
  const recipe = { id: 'demo-local-works', projection: chart.projection, bounds, model: chart.model,
    roadCenterlineProfiles: [{ roadId: 'demo-road', halfWidthM: 3, samples: xs.map((x, i) => ({ distanceM: x + 180, xM: x, yM: 0,
      roadElevationM: i === 2 || i === 3 ? deck : level(x) + .3, gradeSlope: 0,
      structureKind: i === 2 || i === 3 ? 'bridge-deck' : 'fill', segmentKind: i === 2 ? 'bridge-deck' : 'fill' })) }],
    buildingPads: [{ id: 'demo-pad', bounds: { minXM: -75, maxXM: -35, minYM: 40, maxYM: 70 }, targetPadElevationM: level(-55) + 2 }] };
  return { base, recipe, focus: { latDeg: centerLatDeg, lonDeg: centerLonDeg } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--snapshot')) {
    const get = flag => process.argv[process.argv.indexOf(flag) + 1], raw = JSON.parse(fs.readFileSync(get('--snapshot'), 'utf8')), validated = createGlobalTerrain(raw);
    const terrain = createGlobalTerrain(raw.base ?? raw), charts = raw.waterCharts ?? (raw.waterChart ? [{ id: 'water', ...raw.waterChart }] : []);
    const recipes = charts.map(c => ({ id: c.id, projection: c.projection, bounds: c.bounds, model: c.model, interChartBoundaryNodeIds: c.interChartBoundaryNodeIds ?? [] }));
    const directory = get('--out'), c = charts[0]?.projection;
    const manifest = packageGlobe(terrain, directory, { recipes, name: `Core snapshot · ${raw.seed ?? raw.base?.seed}`, focus: c ? { latDeg: c.centerLatDeg, lonDeg: c.centerLonDeg } : { latDeg: 0, lonDeg: 0 }, canonicalWorldId: validated.worldId, featureNamespace: raw.schema.endsWith('@2'), baseWaterPolicy: charts.length&&!raw.sharedBaseWater?(raw.waterCharts&&!raw.interChartRivers?.length?'base-water-outside-charts@1':'explicit-charts-only@1'):null });
    console.log(JSON.stringify({ manifest: `${directory}/manifest.json`, charts: charts.length, canonicalWorldId: validated.worldId }));
  } else {
  const directory = process.argv[2] ?? 'examples/globe/c1/demo', demo = globeDemo();
  const manifest = packageGlobe(demo.base, directory, { recipe: demo.recipe, focus: demo.focus, name: 'Paged globe · river, bridge & pad' });
  fs.writeFileSync(path.join(directory, 'reference.snapshot.json'), JSON.stringify(demo.base.toSnapshot()));
  console.log(JSON.stringify({ manifest: `${directory}/manifest.json`, worldId: manifest.worldId, fieldPages: Object.keys(manifest.pages).length, sourceCells: demo.base.grid.columns * demo.base.grid.rows }));
  }
}


