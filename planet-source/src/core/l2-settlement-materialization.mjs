import { copyJson } from './json-contract.mjs';
import { finiteNumber, nonEmptyText } from './contract-validation.mjs';
import {
  readL2SettlementCandidatePage,
  surveyL2SettlementCandidates,
  validateL2SettlementHandoff,
} from './l2-settlement-handoff.mjs';
import { planSettlementDistricts, settlementStreetGate } from './settlement-districts.mjs';
import { createSettlementLayout } from './settlement-layout.mjs';
import { createLocalRoadRecipe } from './local-road-route.mjs';
import { createSphericalProjection, greatCircle } from './spherical.mjs';
export const L2_SETTLEMENT_MATERIALIZATION_SCHEMA = 'l2-settlement-materialization@1';
export const L2_SETTLEMENT_MATERIALIZATION_METHOD = 'l2-settlement-materialization@2';
export const L2_NATIVE_DETAIL_KIND = 'native-l2-terrain@1';
const HOUSEHOLD_POPULATION = 5;
const FIELD_PARCEL_SIZE_M = 200;
const FIELD_PARCEL_AREA_M2 = FIELD_PARCEL_SIZE_M * FIELD_PARCEL_SIZE_M;
const FIELD_SAMPLE_COUNT = 5;
const FIELD_MAX_GRADE = 0.12;
const FIELD_LIMIT_MAX = 64;
const DEFAULT_FIELD_LIMIT = 16;
const ACCESS_CELLS = 33;
const ACCESS_MAX_DISTANCE_M = 5000;
const ACCESS_PROBE_SPACING_M = 20;
const BOUNDARY_PORTAL_KIND = 'local-boundary-portal';
const SETTLEMENT_KINDS = ['city', 'town', 'village'];
function integerInRange(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}
function normalizeAccessTarget(target) {
  if (target === undefined || target === null) return null;
  if (typeof target !== 'object') throw new TypeError('Invalid L2 access target');
  if (target.kind !== BOUNDARY_PORTAL_KIND) throw new RangeError('L2 access target must be a local-boundary-portal');
  const id = nonEmptyText(target.id, 'L2 access target id');
  const provenance = nonEmptyText(target.provenance, 'L2 access target provenance');
  const latDeg = finiteNumber(target.latDeg, 'L2 access target latDeg');
  const lonDeg = finiteNumber(target.lonDeg, 'L2 access target lonDeg');
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 360) throw new RangeError('L2 access target coordinate out of range');
  return { id, latDeg, lonDeg, provenance, kind: BOUNDARY_PORTAL_KIND };
}
function validateSurface(surface, handoff) {
  if (!surface || typeof surface !== 'object') throw new TypeError('Native L2 detail surface required');
  nonEmptyText(surface.worldId, 'L2 surface worldId');
  if (surface.worldId !== handoff.sourceWorldId) throw new Error('L2 materialization world mismatch');
  if (surface.sourceLayerId !== handoff.layerId) throw new Error('L2 materialization parent L1 layer mismatch');
  if (surface.layer !== 'L2') throw new Error('L2 materialization requires an L2 surface');
  if (surface.detailKind !== L2_NATIVE_DETAIL_KIND) throw new Error('L2 materialization requires native L2 detail');
  nonEmptyText(surface.surfaceId, 'L2 surface identity');
  if (!surface.frame || !Number.isFinite(surface.frame.radiusM) || surface.frame.radiusM <= 0) throw new RangeError('L2 surface frame radius required');
  if (handoff.radiusM !== undefined && surface.frame.radiusM !== handoff.radiusM) throw new Error('L2 materialization radius mismatch');
  const spacing = surface.nativeSpacingM;
  if (!spacing || typeof spacing !== 'object') throw new TypeError('L2 surface native spacing required');
  for (const axis of ['east', 'north']) {
    const value = spacing[axis];
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw new RangeError(`Invalid L2 surface native spacing '${axis}'`);
  }
  if (typeof surface.sampleSurfaceAt !== 'function' || typeof surface.groundElevationAt !== 'function') throw new TypeError('L2 surface must expose sampleSurfaceAt and groundElevationAt');
}
function safeSurface(base) {
  const sampleSurfaceAt = (latDeg, lonDeg) => {
    const sample = base.sampleSurfaceAt(latDeg, lonDeg);
    if (!sample || !Number.isFinite(sample.groundElevationM) || !Number.isFinite(sample.waterDepthM) || sample.waterDepthM < 0) {
      return { groundElevationM: 0, waterDepthM: 1, waterLevelElevationM: 0, waterSourceIds: [], landReserved: false, sitingWet: true };
    }
    return sample;
  };
  const groundElevationAt = (latDeg, lonDeg) => {
    const z = base.groundElevationAt(latDeg, lonDeg);
    return Number.isFinite(z) ? z : 0;
  };
  return { worldId: base.worldId, sourceLayerId: base.sourceLayerId, surfaceId: base.surfaceId, frame: base.frame, sampleSurfaceAt, groundElevationAt };
}
function realDry(base, latDeg, lonDeg) {
  const sample = base.sampleSurfaceAt(latDeg, lonDeg);
  return !!sample && Number.isFinite(sample.groundElevationM) && sample.waterDepthM === 0;
}
function cornersOf(bounds) {
  return [[bounds.minXM, bounds.minYM], [bounds.maxXM, bounds.minYM], [bounds.maxXM, bounds.maxYM], [bounds.minXM, bounds.maxYM]];
}
function rectOverlap(a, b, gap) {
  return a.minXM < b.maxXM + gap && a.maxXM > b.minXM - gap && a.minYM < b.maxYM + gap && a.maxYM > b.minYM - gap;
}
function segmentCrossesBox(a,b,box,gap=0) {
  let low=0,high=1;
  for(const [key,min,max] of [['xM',box.minXM-gap,box.maxXM+gap],['yM',box.minYM-gap,box.maxYM+gap]]){
    const delta=b[key]-a[key];
    if(delta===0){if(a[key]<min||a[key]>max)return false;continue;}
    const u=(min-a[key])/delta,v=(max-a[key])/delta;
    low=Math.max(low,Math.min(u,v));high=Math.min(high,Math.max(u,v));
    if(low>high)return false;
  }
  return true;
}
function overlapsFootprint(bounds, buildings, pads, roads) {
  if (buildings.some(b => rectOverlap(bounds, b.bounds, 1))) return true;
  if (pads.some(p => rectOverlap(bounds, p.bounds, 1))) return true;
  for (const road of roads) {
    const half = Number.isFinite(road.halfWidthM) ? road.halfWidthM : 2.5;
    const points=road.samples??[];
    if(points.some(p=>segmentCrossesBox(p,p,bounds,half+1)))return true;
    for(let i=1;i<points.length;i++)if(segmentCrossesBox(points[i-1],points[i],bounds,half+1))return true;
  }
  return false;
}
function verifyGeometry(base, worldProj, recipe) {
  const rejectedBuildings=[];
  for (const building of recipe.buildings) {
    const b=building.bounds;
    if(!b||!Object.values(b).every(Number.isFinite)||b.maxXM<=b.minXM||b.maxYM<=b.minYM)return {ok:false,reason:'non-finite-house'};
    const nx=Math.max(1,Math.ceil((b.maxXM-b.minXM)/2)),ny=Math.max(1,Math.ceil((b.maxYM-b.minYM)/2));
    if((nx+1)*(ny+1)>16384)return {ok:false,reason:'building-footprint-survey-budget'};
    let dry=true;
    for(let y=0;y<=ny&&dry;y++)for(let x=0;x<=nx;x++){
      try{const point=worldProj.toGeographic(b.minXM+(b.maxXM-b.minXM)*x/nx,b.minYM+(b.maxYM-b.minYM)*y/ny);
        if(!realDry(base,point.latDeg,point.lonDeg)){dry=false;break;}
      }catch{dry=false;break;}
    }
    if(!dry)rejectedBuildings.push({id:building.id,kind:building.id.includes('/house:')?'house':'public',bounds:{...b},reason:'wet-or-unknown-building-footprint'});
  }
  const blockedIds=new Set(rejectedBuildings.map(b=>b.id));
  recipe.buildings=recipe.buildings.filter(b=>!blockedIds.has(b.id));
  recipe.buildingPads=recipe.buildingPads.filter(b=>!blockedIds.has(b.id));
  for (const road of recipe.roadCenterlineProfiles) {
    for (const sample of road.samples) {
      if (!Number.isFinite(sample.xM) || !Number.isFinite(sample.yM) || !Number.isFinite(sample.roadElevationM)) return { ok: false, reason: 'non-finite-road' };
      let point;
      try { point = worldProj.toGeographic(sample.xM, sample.yM); } catch { return { ok: false, reason: 'road-outside-frame' }; }
      if (!realDry(base, point.latDeg, point.lonDeg)) return { ok: false, reason: 'road-point-not-dry-detailed' };
    }
    for(let i=1;i<road.samples.length;i++){
      const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy)||1;
      const steps=Math.max(1,Math.ceil(length/2));
      for(let k=0;k<=steps;k++)for(const sign of [-1,0,1]){
        const point=worldProj.toGeographic(a.xM+dx*k/steps-sign*dy/length*road.halfWidthM,a.yM+dy*k/steps+sign*dx/length*road.halfWidthM);
        if(!realDry(base,point.latDeg,point.lonDeg))return {ok:false,reason:'road-corridor-not-dry-detailed'};
      }
    }
  }
  return {ok:true,rejectedBuildings};
}
function spiralSlot(k) {
  const ring = Math.ceil((Math.sqrt(k + 1) - 1) / 2);
  const side = ring * 2;
  const max = (2 * ring + 1) ** 2 - 1;
  const d = max - k;
  if (d < side) return [ring - d, -ring];
  if (d < 2 * side) return [-ring, -ring + (d - side)];
  if (d < 3 * side) return [-ring + (d - 2 * side), ring];
  return [ring, ring - (d - 3 * side)];
}
function makeParcel(prefix, index, cx, cy, requestedM2, totalPlots) {
  const last = index === totalPlots - 1;
  const areaM2 = last ? requestedM2 - (totalPlots - 1) * FIELD_PARCEL_AREA_M2 : FIELD_PARCEL_AREA_M2;
  const widthM = last ? areaM2 / FIELD_PARCEL_SIZE_M : FIELD_PARCEL_SIZE_M;
  const minXM = cx - widthM / 2, maxXM = cx + widthM / 2;
  const minYM = cy - FIELD_PARCEL_SIZE_M / 2, maxYM = cy + FIELD_PARCEL_SIZE_M / 2;
  return { id: `${prefix}/field:${index}`, bounds: { minXM, maxXM, minYM, maxYM }, areaM2, points: [[minXM, minYM], [maxXM, minYM], [maxXM, maxYM], [minXM, maxYM]] };
}
function fieldPageParcels(prefix, plan, offset, limit, requestedM2, totalPlots) {
  const start = Math.min(offset, totalPlots);
  const end = start + Math.min(limit,totalPlots-start);
  const parcels = [];
  if (end <= start) return { totalPlots, parcels };
  const inner=Math.ceil((plan.extentM+FIELD_PARCEL_SIZE_M/2)/FIELD_PARCEL_SIZE_M);
  const first=(2*inner+1)**2;
  for(let included=start;included<end;included++) {
    const [col, row] = spiralSlot(first+included);
    const cx = col * FIELD_PARCEL_SIZE_M, cy = row * FIELD_PARCEL_SIZE_M;
    parcels.push(makeParcel(prefix, included, cx, cy, requestedM2, totalPlots));
  }
  return { totalPlots, parcels };
}
function sampleParcel(parcel, base, worldProj, buildings, pads, roads) {
  if (overlapsFootprint(parcel.bounds, buildings, pads, roads)) return { ok: false, reason: 'occupied' };
  const b = parcel.bounds, n = FIELD_SAMPLE_COUNT;
  const xs = [], ys = [];
  for (let i = 0; i < n; i++) {
    xs.push(b.minXM + (b.maxXM - b.minXM) * i / (n - 1));
    ys.push(b.minYM + (b.maxYM - b.minYM) * i / (n - 1));
  }
  const z = [];
  for (let j = 0; j < n; j++) {
    const row = [];
    for (let i = 0; i < n; i++) {
      let point;
      try { point = worldProj.toGeographic(xs[i], ys[j]); } catch { return { ok: false, reason: 'outside-frame' }; }
      const sample = base.sampleSurfaceAt(point.latDeg, point.lonDeg);
      if (!sample || !Number.isFinite(sample.groundElevationM) || !Number.isFinite(sample.waterDepthM)) return { ok: false, reason: 'unknown' };
      if (sample.waterDepthM < 0) return {ok:false,reason:'unknown'};
      if (sample.waterDepthM > 0) return { ok: false, reason: 'wet' };
      row.push(sample.groundElevationM);
    }
    z.push(row);
  }
  const dx = (b.maxXM - b.minXM) / (n - 1);
  const dy = (b.maxYM - b.minYM) / (n - 1);
  const diagonal = Math.hypot(dx, dy) || 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (i + 1 < n && Math.abs(z[j][i + 1] - z[j][i]) / dx > FIELD_MAX_GRADE) return { ok: false, reason: 'slope' };
      if (j + 1 < n && Math.abs(z[j + 1][i] - z[j][i]) / dy > FIELD_MAX_GRADE) return { ok: false, reason: 'slope' };
      if (i + 1 < n && j + 1 < n && Math.abs(z[j + 1][i + 1] - z[j][i]) / diagonal > FIELD_MAX_GRADE) return { ok: false, reason: 'slope' };
    }
  }
  return { ok: true };
}
function buildFields({ prefix, plan, base, worldProj, buildings, pads, roads, localRequestedM2, totalDemandM2, offset, limit, held, status }) {
  const totalPlots = localRequestedM2 > 0 ? Math.ceil(localRequestedM2 / FIELD_PARCEL_AREA_M2) : 0;
  const accepted = [], rejected = [];
  if (!held && localRequestedM2 > 0) {
    const { parcels } = fieldPageParcels(prefix, plan, offset, limit, localRequestedM2, totalPlots);
    for (const parcel of parcels) {
      const survey = sampleParcel(parcel, base, worldProj, buildings, pads, roads);
      if (survey.ok) accepted.push({ id: parcel.id, bounds: parcel.bounds, areaM2: parcel.areaM2, points: parcel.points, status: 'surveyed-dry-footprint' });
      else rejected.push({ id: parcel.id, bounds: parcel.bounds, areaM2: parcel.areaM2, points: parcel.points, status: 'unresolved', reason: survey.reason });
    }
  }
  const start=Math.min(offset,totalPlots),end=start+Math.min(limit,totalPlots-start);
  const requestedM2=Math.min(localRequestedM2,end*FIELD_PARCEL_AREA_M2)-Math.min(localRequestedM2,start*FIELD_PARCEL_AREA_M2);
  const surveyedM2 = accepted.reduce((sum, parcel) => sum + parcel.areaM2, 0);
  return { status,offset,limit,totalPlots,totalDemandM2,requestedM2,surveyedM2,
    unresolvedM2:requestedM2-surveyedM2,outsidePageM2:totalDemandM2-requestedM2,accepted,rejected };
}
function roadsInProjection(recipe,worldProj,radiusM){
  if(!recipe)return [];
  const projection=createSphericalProjection({...recipe.projection,radiusM});
  return recipe.roadCenterlineProfiles.map(road=>({...road,samples:road.samples.map(p=>{
    const q=projection.toGeographic(p.xM,p.yM);
    return {...p,...worldProj.toLocal(q.latDeg,q.lonDeg)};
  })}));
}
function accessRecipeView(recipe, includeProfile) {
  const status = recipe.routeStatus ?? {};
  return { id: recipe.id, projection: recipe.projection, bounds: recipe.bounds, roadCenterlineProfiles: includeProfile ? recipe.roadCenterlineProfiles : [], status: status.status ?? null, reason: status.reason ?? null };
}
function summarizeTarget(target) {
  return { id: target.id, latDeg: target.latDeg, lonDeg: target.lonDeg, provenance: target.provenance, kind: target.kind };
}
function blockedAccess(recipe, status, reason, target) {
  return { status, recipe: recipe ? accessRecipeView(recipe, false) : null, receivingConnection: 'unresolved', reason, target: target ? summarizeTarget(target) : null };
}
function materializeAccess(base, worldProj, baseSite, accessTarget, radiusM, buildings, pads) {
  const gate = settlementStreetGate(baseSite, accessTarget, radiusM);
  const distanceM = greatCircle(gate, accessTarget, radiusM).distanceM;
  const link = { id: `${baseSite.id}/access:${accessTarget.id}`, fromPoint: gate, toPoint: accessTarget, distanceM };
  let recipe;
  try {
    recipe = createLocalRoadRecipe(safeSurface(base), link, { cells: ACCESS_CELLS, allowRiverBridges: false, maxDistanceM: ACCESS_MAX_DISTANCE_M, probeSpacingM: ACCESS_PROBE_SPACING_M });
  } catch {
    return blockedAccess(null, 'access-survey-failed', 'route-error', accessTarget);
  }
  const status = recipe.routeStatus?.status;
  if (status !== 'surveyed-local-route' || recipe.roadCenterlineProfiles.length === 0) {
    return blockedAccess(recipe, status ?? 'no-route', recipe.routeStatus?.reason ?? status ?? 'no-route', accessTarget);
  }
  const recipeProjection = createSphericalProjection({ centerLatDeg: recipe.projection.centerLatDeg, centerLonDeg: recipe.projection.centerLonDeg, radiusM, maxRadiusM: recipe.projection.maxRadiusM });
  const profile = recipe.roadCenterlineProfiles[0],locals=[];
  for (let i=0;i<profile.samples.length;i++) {
    const sample=profile.samples[i];
    if (!Number.isFinite(sample.xM) || !Number.isFinite(sample.yM)) return blockedAccess(recipe, 'blocked-invalid-profile', 'non-finite-profile', accessTarget);
    const point = recipeProjection.toGeographic(sample.xM, sample.yM);
    if (!realDry(base, point.latDeg, point.lonDeg)) return blockedAccess(recipe, 'blocked-invalid-profile', 'wet-or-unknown-profile', accessTarget);
    const local = worldProj.toLocalIfWithin(point.latDeg, point.lonDeg);
    if (!local) return blockedAccess(recipe, 'blocked-invalid-profile', 'profile-outside-frame', accessTarget);
    const prior=profile.samples[Math.max(0,i-1)],next=profile.samples[Math.min(profile.samples.length-1,i+1)];
    const dx=next.xM-prior.xM,dy=next.yM-prior.yM,length=Math.hypot(dx,dy)||1;
    for(const sign of [-1,1]){
      const edge=recipeProjection.toGeographic(sample.xM-sign*dy/length*profile.halfWidthM,sample.yM+sign*dx/length*profile.halfWidthM);
      if(!realDry(base,edge.latDeg,edge.lonDeg))return blockedAccess(recipe,'blocked-invalid-profile','road-width-wet-or-unknown',accessTarget);
    }
    locals.push(local);
  }
  for(const object of [...buildings,...pads])for(let i=1;i<locals.length;i++){
    if(segmentCrossesBox(locals[i-1],locals[i],object.bounds,profile.halfWidthM+1))return blockedAccess(recipe,'blocked-invalid-profile','profile-crosses-building',accessTarget);
  }
  return { status: 'surveyed-local-route', recipe: accessRecipeView(recipe, true), receivingConnection: 'unresolved', reason: null, target: summarizeTarget(accessTarget) };
}
function heldAccess() {
  return { status: 'not-generated', recipe: null, receivingConnection: 'unresolved', reason: null, target: null };
}
// Diagnostic only: the fallback population-districts layout and rectangular
// field pages exercise budgets, terrain rejection and persistence. They do not
// implement the adopted terrain-led landscape plan and must not feed the globe.
export function materializeL2SettlementCandidate(surface, population, handoff, options) {
  validateL2SettlementHandoff(handoff);
  if (options === undefined || options === null || typeof options !== 'object') throw new TypeError('L2 materialization options required');
  const totalCandidates = handoff.budget.cities + handoff.budget.towns + handoff.budget.villages;
  const slot = integerInRange(options.slot, 'slot', 0, totalCandidates - 1);
  const fieldOffset = options.fieldOffset === undefined ? 0 : integerInRange(options.fieldOffset, 'fieldOffset', 0, Number.MAX_SAFE_INTEGER);
  const fieldLimit = options.fieldLimit === undefined ? DEFAULT_FIELD_LIMIT : integerInRange(options.fieldLimit, 'fieldLimit', 1, FIELD_LIMIT_MAX);
  const accessTarget = normalizeAccessTarget(options.accessTarget);
  validateSurface(surface, handoff);
  if (!population || population.id !== handoff.populationId || population.sourceWorldId !== handoff.sourceWorldId) throw new Error('L2 materialization population authority mismatch');
  const radiusM = surface.frame.radiusM;
  const page = readL2SettlementCandidatePage(handoff, { offset: slot, limit: 1 });
  if (page.candidates.length !== 1) throw new RangeError('L2 materialization slot has no candidate');
  const candidate = page.candidates[0];
  if (!SETTLEMENT_KINDS.includes(candidate.kind)) throw new RangeError('L2 materialization candidate kind unsupported');
  const districtIndex = options.districtIndex === undefined ? 0 : integerInRange(options.districtIndex, 'districtIndex', 0, Number.MAX_SAFE_INTEGER);
  const layoutSettlement = { ...candidate, economicContext: { ...(candidate.economicContext ?? {}), infillPolicy: 'fixed-terrain-adaptive-infill@1' } };
  const plan = planSettlementDistricts(layoutSettlement, radiusM);
  if (districtIndex >= plan.count) throw new RangeError('L2 materialization district index outside the settlement plan');
  const district = plan.district(districtIndex);
  const survey = surveyL2SettlementCandidates(surface, population, handoff, { offset: slot, limit: 1 });
  const site = survey.sites.find(s => s.id === candidate.id) ?? null;
  const rejection = survey.unresolvedCandidates.find(c => c.id === candidate.id) ?? null;
  const worldProj = createSphericalProjection({ centerLatDeg: candidate.latDeg, centerLonDeg: candidate.lonDeg, radiusM, maxRadiusM: radiusM * 0.1 });
  const reasons = [];
  let layout = null, placedDwellings = 0, representedPopulation = 0;
  let held = !site;
  if (held) reasons.push(`siting-unresolved:${rejection?.reason ?? 'unknown'}`);
  if (!held) {
    const recipe = createSettlementLayout(safeSurface(surface), layoutSettlement, { districtIndex });
    const geometry = verifyGeometry(surface, worldProj, recipe);
    if (!geometry.ok) {
      held = true;
      reasons.push(`invalid-layout:${geometry.reason}`);
    } else {
      placedDwellings = recipe.buildings.filter(b=>b.id.includes('/house:')).length;
      representedPopulation = Math.min(district.population, placedDwellings * HOUSEHOLD_POPULATION);
      const {infillDwellings,...status}=recipe.layoutStatus;
      const layoutStatus={...status,placedDwellings,representedPopulation,districtComplete:placedDwellings===district.requestedDwellings,
        complete:plan.count===1&&placedDwellings===district.requestedDwellings};
      layout = { bounds: recipe.bounds, buildings: recipe.buildings, buildingPads: recipe.buildingPads, roadCenterlineProfiles: recipe.roadCenterlineProfiles, connections: recipe.connections, layoutStatus,geometryRejections:geometry.rejectedBuildings };
      if(geometry.rejectedBuildings.length)reasons.push(`建物敷地内の水域・未知値で${geometry.rejectedBuildings.length}棟を保留`);
    }
  }
  const totalPopulation = candidate.population;
  const requestedPopulation = district.population;
  const unvisitedPopulation = totalPopulation - requestedPopulation;
  const housing = { totalPopulation, requestedPopulation, representedPopulation, unresolvedPopulation: requestedPopulation - representedPopulation, unvisitedPopulation, districtIndex, districtCount: plan.count, requestedDwellings: district.requestedDwellings, placedDwellings };
  const isVillage = candidate.kind === 'village';
  const yieldUnresolved = handoff.farmland.unresolved === true;
  if (yieldUnresolved) reasons.push('farmland-unresolved-yield');
  const localRequestedM2 = isVillage ? candidate.farmlandDemandM2 : 0;
  let access;
  if (held) access = heldAccess();
  else if (!accessTarget) access = { status: 'not-requested', recipe: null, receivingConnection: 'unresolved', reason: null, target: null };
  else access = materializeAccess(surface, worldProj, layoutSettlement, accessTarget, radiusM, layout?.buildings ?? [], layout?.buildingPads ?? []);
  const accessRoads=roadsInProjection(access.recipe,worldProj,radiusM);
  const fields = buildFields({ prefix:candidate.id,plan,base:surface,worldProj,buildings:layout?.buildings??[],pads:layout?.buildingPads??[],
    roads:[...(layout?.roadCenterlineProfiles??[]),...accessRoads],localRequestedM2,totalDemandM2:candidate.farmlandDemandM2,
    offset:fieldOffset,limit:fieldLimit,held:held||yieldUnresolved,status:yieldUnresolved?'unresolved-yield':isVillage?'local-field-page':'regional-supply-unresolved' });
  if(yieldUnresolved)fields.unresolvedYield=true;
  const result = {
    schema: L2_SETTLEMENT_MATERIALIZATION_SCHEMA,
    status: held ? 'held' : 'materialized',
    worldId: handoff.sourceWorldId,
    sourceLayerId: handoff.layerId,
    surfaceId: surface.surfaceId,
    detailKind: surface.detailKind,
    handoffId: handoff.id,
    candidateId: candidate.id,
    populationId: handoff.populationId,
    cellIndex: handoff.cellIndex,
    slot,
    kind: candidate.kind,
    settlementClass: candidate.settlementClass ?? null,
    origin: { latDeg: candidate.latDeg, lonDeg: candidate.lonDeg },
    districtIndex,
    districtCount: plan.count,
    options: { slot, districtIndex, fieldOffset, fieldLimit, accessTarget: accessTarget ? summarizeTarget(accessTarget) : null },
    housing,
    layout,
    fields,
    access,
    reasons,
    interpretation: 'One identified L2 district page, field page and optional access survey over the native detail surface. Unresolved population and farmland remain explicit.',
    limitations: [
      'A field page is surveyed land, not secured food, rights or annual yield',
      'An access target is an input boundary portal; no adjacent region connection is claimed',
      'The residential layout still carries its own population-districts@1 limitations',
    ],
  };
  return copyJson(result);
}
export function saveL2SettlementMaterialization(store, surface, population, handoff, options, { generate = materializeL2SettlementCandidate } = {}) {
  if (!store || typeof store.resolve !== 'function') throw new TypeError('Committed materializer store required');
  if (typeof generate !== 'function') throw new TypeError('L2 materialization generator required');
  validateL2SettlementHandoff(handoff);
  if (options === undefined || options === null || typeof options !== 'object') throw new TypeError('L2 materialization options required');
  const totalCandidates = handoff.budget.cities + handoff.budget.towns + handoff.budget.villages;
  const slot = integerInRange(options.slot, 'slot', 0, totalCandidates - 1);
  const districtIndex = options.districtIndex === undefined ? 0 : integerInRange(options.districtIndex, 'districtIndex', 0, Number.MAX_SAFE_INTEGER);
  const fieldOffset = options.fieldOffset === undefined ? 0 : integerInRange(options.fieldOffset, 'fieldOffset', 0, Number.MAX_SAFE_INTEGER);
  const fieldLimit = options.fieldLimit === undefined ? DEFAULT_FIELD_LIMIT : integerInRange(options.fieldLimit, 'fieldLimit', 1, FIELD_LIMIT_MAX);
  const accessTarget = normalizeAccessTarget(options.accessTarget);
  validateSurface(surface, handoff);
  if (!population || population.id !== handoff.populationId || population.sourceWorldId !== handoff.sourceWorldId) throw new Error('L2 materialization population authority mismatch');
  const page = readL2SettlementCandidatePage(handoff, { offset: slot, limit: 1 });
  if (page.candidates.length !== 1) throw new RangeError('L2 materialization slot has no candidate');
  const candidate = page.candidates[0];
  const worldId = handoff.sourceWorldId;
  const entityId = [`${handoff.id}/slot:${slot}`, `district:${districtIndex}`, `fields:${fieldOffset}:${fieldLimit}`, accessTarget ? `portal:${accessTarget.id}` : 'portal:none'].join('/');
  const conditions = {
    schema: L2_SETTLEMENT_MATERIALIZATION_SCHEMA,
    method: L2_SETTLEMENT_MATERIALIZATION_METHOD,
    surfaceId: surface.surfaceId,
    worldId: handoff.sourceWorldId,
    sourceLayerId: handoff.layerId,
    populationId: handoff.populationId,
    handoffId: handoff.id,
    candidateId: candidate.id,
    options: { slot, districtIndex, fieldOffset, fieldLimit, accessTarget: accessTarget ? summarizeTarget(accessTarget) : null },
  };
  return store.resolve({ worldId, entityId, conditions, generator: L2_SETTLEMENT_MATERIALIZATION_METHOD, generate: () => generate(surface, population, handoff, options) });
}
