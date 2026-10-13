import {unitNormalForGradient,fixedStencilCurvature} from './surface-derivatives.mjs';
import {createEarthworkEnvelope} from './chart-earthwork-envelope.mjs';
import { validateCulvertRouting } from './culvert-routing.mjs';
import { validateBridgeStructures } from './bridge-structures.mjs';
import { validateBuildings } from './building-geometry.mjs';
import {projectedHullEnvelope} from './projected-hull.mjs';
import { createSphericalProjection, sphereBasis } from './spherical.mjs';
import { compileSurfaceWater } from './water-model.mjs';
import { createRoadAdjustedTerrain } from './road-earthwork.mjs';
import { createBuildingPadAdjustedTerrain } from './building-pad.mjs';

/** Explicit, already fitted metric recipes on a canonical sphere. Shared by
 * packaging verification and paged Workers. No automatic lake/sea generation.
 * Road/pad influence must be strictly inside the chart (verified at export).
 * This is an overlay contract; it does not claim to solve post-earthwork flow. */
export function createGlobeFeatureChart(base, recipe) {
  validateCulvertRouting(recipe.drainageRouting,recipe);
  const roadMaterials=new Map((recipe.roadCenterlineProfiles??[]).filter(r=>typeof r.surfaceMaterial==='string').map(r=>[r.roadId,r.surfaceMaterial]));
  validateBuildings(recipe.buildings ?? [], recipe.buildingPads ?? []);
  const projection = createSphericalProjection(recipe.projection), bounds = recipe.bounds, chartBasis=sphereBasis({latDeg:recipe.projection.centerLatDeg,lonDeg:recipe.projection.centerLonDeg});
  // One synchronous sample asks for the same base point through ground,
  // water and road adapters. Reuse that point only inside this call, never
  // across queries, feature changes, retries or caller-owned terrain updates.
  let groundMemo=null;
  const ground = (xM, yM) => {
    if(groundMemo?.ready&&groundMemo.xM===xM&&groundMemo.yM===yM)return groundMemo.value;
    const p=projection.toGeographic(xM,yM),value=base.groundElevationAt(p.latDeg,p.lonDeg);
    if(groundMemo)Object.assign(groundMemo,{ready:true,xM,yM,value});
    return value;
  };
  validateBridgeStructures(recipe.bridgeStructures??[],recipe.roadCenterlineProfiles??[],ground);
  const grid = { columns: Math.ceil((bounds.maxXM - bounds.minXM) / 100), rows: Math.ceil((bounds.maxYM - bounds.minYM) / 100), cellSizeM: 100 };
  const compiled = compileSurfaceWater(recipe.model, bounds, grid, { originXM: bounds.minXM, originYM: bounds.minYM }, ground);
  const metric = { worldId: base.worldId, regionId: recipe.id, bounds, frame: projection.contract, derivativeStepM: 1,
    boundGroundElevation: (range,disk) => compiled.boundGroundElevation(range,disk),
    groundElevationAt: (x, y) => compiled.sampleGround(x, y, ground(x, y)),
    sampleAt: (x, y) => ({ xM: x, yM: y, ...compiled.sample(x, y, ground(x, y)), gradient: { x: 0, y: 0 } }) };
  const roads = createRoadAdjustedTerrain(metric, recipe.roadCenterlineProfiles ?? [], recipe.roadEarthworkOptions ?? {});
  const adjusted = createBuildingPadAdjustedTerrain(roads, recipe.buildingPads ?? []),envelope=createEarthworkEnvelope(recipe);
  const adjustedHeight=(x,y,z)=>envelope?envelope.apply(x,y,ground(x,y),z):z;
  const metricGround=(x,y)=>adjustedHeight(x,y,adjusted.groundElevationAt(x,y));
  const metricSample=(x,y)=>{
    const sample=adjusted.sampleAt(x,y),z=metricGround(x,y),d=1,
      left=Math.max(bounds.minXM,x-d),right=Math.min(bounds.maxXM,x+d),bottom=Math.max(bounds.minYM,y-d),top=Math.min(bounds.maxYM,y+d),
      gradient={x:(metricGround(right,y)-metricGround(left,y))/(right-left),y:(metricGround(x,top)-metricGround(x,bottom))/(top-bottom)},level=sample.waterLevelElevationM??null;
    return{...sample,groundElevationM:z,gradient,slopeMPerM:Math.hypot(gradient.x,gradient.y),waterDepthM:level==null?null:Math.max(0,level-z)};
  };
  const metricView=envelope?{...adjusted,groundElevationAt:metricGround,sampleAt:metricSample,
    groundMetadataAt:(x,y)=>({...adjusted.groundMetadataAt(x,y),groundElevationM:metricGround(x,y)}),
    boundGroundElevation:(range,disk)=>envelope.bounds(range,adjusted.boundGroundElevation(range,disk),disk),
    surfaceFrameAt(x,y){const sample=metricSample(x,y),edge=x-1<bounds.minXM||x+1>bounds.maxXM||y-1<bounds.minYM||y+1>bounds.maxYM;return{...sample,normal:unitNormalForGradient(sample.gradient),curvature:edge?null:fixedStencilCurvature(metricGround,x,y,sample.groundElevationM,sample.gradient,1),curvatureStatus:edge?'unavailable-at-region-edge':'fixed-distance-estimate'};}}:adjusted;
  const box = (points, width = 0) => ({ minXM: Math.min(...points.map(p => p.xM)) - width, minYM: Math.min(...points.map(p => p.yM)) - width,
    maxXM: Math.max(...points.map(p => p.xM)) + width, maxYM: Math.max(...points.map(p => p.yM)) + width });
  const waterDomains = [
    ...(recipe.model.bed?(compiled.meshBounds?[compiled.meshBounds]:[]):recipe.model.edges.map(e => box(e.points, Math.max(...e.points.map(p => p.halfWidthM + p.bankWidthM))))),
    ...recipe.model.bodies.map(b => box(b.polygon)),
  ];
  const overlayDomains = [...waterDomains,
    ...(recipe.roadCenterlineProfiles ?? []).map(r => box(r.samples, r.halfWidthM ?? 3)),
    ...(recipe.buildingPads ?? []).map(p => p.bounds ?? box(p.polygon)),
  ];
  function local(lat, lon) {
    const p = projection.toLocalIfWithin(lat, lon);
    const tolerance=128*Number.EPSILON*recipe.projection.radiusM;
    if(!(p && p.xM >= bounds.minXM-tolerance && p.xM <= bounds.maxXM+tolerance && p.yM >= bounds.minYM-tolerance && p.yM <= bounds.maxYM+tolerance))return null;
    // Geographic round trips can miss an exact chart edge by nanometres.
    // Clamp only numerical uncertainty, never expand actual terrain ownership.
    p.xM=Math.max(bounds.minXM,Math.min(bounds.maxXM,p.xM));p.yM=Math.max(bounds.minYM,Math.min(bounds.maxYM,p.yM));
    if(recipe.sparseRoadOverlay&&!roads.roadSurfaceAt(p.xM,p.yM)&&Math.abs(roads.groundElevationAt(p.xM,p.yM)-ground(p.xM,p.yM))<1e-9)return null;
    return p;
  }
  function metricDisk(bound){
    if(!bound)return null;
    const lat=Math.asin(Math.max(-1,Math.min(1,bound.center[2])))*180/Math.PI,lon=Math.atan2(bound.center[1],bound.center[0])*180/Math.PI,
      p=projection.toLocalIfWithin(lat,lon);
    if(!p)return null;
    const rho=Math.hypot(p.xM,p.yM)/recipe.projection.radiusM+bound.angular;
    if(rho>=Math.PI/2)return null;
    // The exponential-map inverse has singular values 1 and rho/sin(rho).
    // Bound it over every geodesic from the disk centre to a disk point.
    const radiusM=recipe.projection.radiusM*bound.angular*(rho>1e-10?rho/Math.sin(rho):1)+128*Number.EPSILON*recipe.projection.radiusM;
    const projectedHull=bound.corners?projectedHullEnvelope(bound.corners,chartBasis,recipe.projection.radiusM):null;
    return {...p,radiusM,...(projectedHull?{projectedHull}:{})};
  }
  function containsBound(bound){const disk=metricDisk(bound);return !!disk&&disk.xM-disk.radiusM>=bounds.minXM&&disk.xM+disk.radiusM<=bounds.maxXM&&disk.yM-disk.radiusM>=bounds.minYM&&disk.yM+disk.radiusM<=bounds.maxYM;}
  return { recipe, projection, metricTerrain: metricView, boundGroundElevation:(range,bound)=>{const disk=metricDisk(bound),result=adjusted.boundGroundElevation(range,disk);return envelope?envelope.bounds(range,result,disk):result;}, containsBound, local, overlayDomains, waterDomains, groundElevationAt(lat, lon) { const p = local(lat, lon); return p ? adjustedHeight(p.xM,p.yM,adjusted.groundElevationAt(p.xM, p.yM)) : base.groundElevationAt(lat, lon); },
    sampleAt(lat, lon) { const p = local(lat, lon); if (!p) return null;
      const previousMemo=groundMemo;groundMemo={ready:false};
      try {
      const metadata=adjusted.groundMetadataAt(p.xM,p.yM),z = adjustedHeight(p.xM,p.yM,metadata.groundElevationM), water = compiled.sample(p.xM, p.yM, ground(p.xM, p.yM));
      const road = adjusted.roadSurfaceAt(p.xM, p.yM);
      const level = water.waterLevelElevationM;
      return { groundElevationM: z, waterLevelElevationM: level, waterDepthM: level == null ? 0 : Math.max(0, level - z),
        roadSurface: road&&roadMaterials.has(road.roadId)?{...road,surfaceMaterial:roadMaterials.get(road.roadId)}:road, waterSourceIds: water.waterSourceIds, xM: p.xM, yM: p.yM,
        buildingId: metadata.buildingId ?? null, structureKind: metadata.structureKind ?? null };
      } finally {groundMemo=previousMemo;}
    } };
}
