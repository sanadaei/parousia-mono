import test from 'node:test';import assert from 'node:assert/strict';
import {refineTerrainRiverRoutes} from '../src/core/terrain-river-routes.mjs';
import {PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED,createSphericalRiverSampler} from '../src/core/planet-rivers.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
const R=100000,projection=createSphericalProjection({centerLatDeg:20,centerLonDeg:20,radiusM:R,maxRadiusM:10000}),L=3000;
function fixture(){
 const a=projection.toGeographic(-L/2,0),b=projection.toGeographic(L/2,0),points=Array.from({length:61},(_,i)=>({...projection.toGeographic(-L/2+i*L/60,0),waterLevelElevationM:100-i*100/60-.3,halfWidthM:2,depthM:.3,bankWidthM:70}));
 const network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM:R,grid:{columns:16,rows:8},nodes:[{id:'a',...a,waterLevelElevationM:99.7},{id:'b',...b,waterLevelElevationM:-.3}],profiles:[{id:'river',from:'a',to:'b',lengthM:L,points,routing:{method:'direct-great-circle'}}],diagnostics:{maxIncisionM:150,valleySideRunPerRise:3,pointCount:points.length}};
 const base={toSnapshot:()=>({references:{}}),sampleSurfaceAt:(lat,lon)=>{const q=projection.toLocal(lat,lon),t=(q.xM+L/2)/L;return{groundElevationM:100-100*t+80*((q.yM-80*Math.sin(Math.PI*t))/80)**2,waterDepthM:0};}};return{network,base};
}
test('terrain-led river follows a lower corridor while preserving graph endpoints',()=>{
 const {base,network}=fixture(),r=refineTerrainRiverRoutes(base,network,{profileStepM:50});
 assert.equal(r.diagnostics.terrainRoutes.refined,1,JSON.stringify(r.diagnostics.terrainRoutes));assert.deepEqual(r.nodes,network.nodes);
 assert.ok(r.profiles[0].points.some(p=>projection.toLocal(p.latDeg,p.lonDeg).yM>20));
 assert.ok(r.profiles[0].routing.scoreImprovement>.01);createSphericalRiverSampler(r);
 assert.deepEqual(r,refineTerrainRiverRoutes(base,network,{profileStepM:50}));assert.equal(network.profiles[0].routing.method,'direct-great-circle');
});
test('river refinement budgets preserve original data with explicit status',()=>{
 const {base,network}=fixture();const r=refineTerrainRiverRoutes(base,network,{maxRoutes:0});assert.deepEqual(r.profiles,network.profiles);assert.equal(r.diagnostics.terrainRoutes.attempts[0].status,'route-budget');
 assert.throws(()=>refineTerrainRiverRoutes({...base,toSnapshot:()=>({references:{rivers:network}})},network),/Uncarved/);
 assert.throws(()=>refineTerrainRiverRoutes(base,network,{maxPoints:2}),/budget/);
});

import {fitResearchRiverPath} from '../src/core/terrain-cost-routing.mjs';
test('a candidate beyond the shared fitter budget is withheld rather than crashing generation',()=>{
 const p=[{latDeg:0,lonDeg:0},{latDeg:0,lonDeg:1}];
 const r=fitResearchRiverPath(p,{radiusM:6371000,sampleSurface:()=>({groundElevationM:0,waterDepthM:0}),startLevelM:0,endLevelM:0,depthM:1,stepM:10,maxPoints:8192});
 assert.equal(r.valid,false);assert.equal(r.reason,'profile-work-budget');
});
