import test from 'node:test';import assert from 'node:assert/strict';import {serviceFrontageCenters,nearestStreetPoint,servicePlotClear} from '../src/core/service-frontage.mjs';
const roads=[{roadId:'main',halfWidthM:3,samples:[{xM:-150,yM:0,distanceM:0},{xM:150,yM:0,distanceM:300}]}],survey={roads,ground:()=>100,water:()=>({waterDepthM:0}),occupied:()=>false};
test('service parcels have actual street frontage, deterministic positions and bounded candidates',()=>{const c=serviceFrontageCenters(roads);assert.deepEqual(c,serviceFrontageCenters(roads));assert.ok(c.length>5&&c.length<=96);for(const [x,y] of c){assert.equal(Math.abs(y),24);assert.equal(nearestStreetPoint(x,y,roads).distanceM,24);assert.equal(servicePlotClear(x,y,survey),true);}});
test('service frontage rejects road overlap, water and reserved land',()=>{assert.equal(servicePlotClear(0,0,survey),false);assert.equal(servicePlotClear(0,24,{...survey,water:()=>({waterDepthM:1})}),false);assert.equal(servicePlotClear(0,24,{...survey,occupied:()=>true}),false);});
import {createTerrainLedNeighborhood} from '../src/core/terrain-led-neighborhood.mjs';import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
test('real village entry reserves workshop yards and connects access before allocating housing',()=>{const base={frame:{radiusM:6371000},worldId:'flat',groundElevationAt:()=>100,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0})},site={id:'v',population:300,latDeg:20,lonDeg:30,economicContext:{institutionPolicy:'medieval-communal@1',streetPolicy:'terrain-led-branches@2',facilityPolicy:'frontage-service-parcels@2',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true}},r=createTerrainLedNeighborhood(base,site);assert.ok(r.economy.workyards.length>=3);assert.equal(r.economy.accessRoads.length,r.economy.workyards.length);assert.ok(r.layoutStatus.placedDwellings>=50);for(const y of r.landParcels.filter(p=>p.type==='service_workyard')){const a=y.points[0],b=y.points[1],c=y.points[y.steps+2];assert.ok((b.xM-a.xM)*(c.yM-a.yM)-(b.yM-a.yM)*(c.xM-a.xM)>0);}assert.doesNotThrow(()=>createGlobeFeatureChart(base,r));assert.deepEqual(r,createTerrainLedNeighborhood(base,site));});

test('strict urban access rejects unknown or wet side strips, not only wet centerlines',async()=>{
 const {serviceAccessClear}=await import('../src/core/service-frontage.mjs');
 const road={halfWidthM:1,samples:[{xM:0,yM:0},{xM:8,yM:0}]},ground=()=>100;
 assert.equal(serviceAccessClear(road,{ground,water:()=>({waterDepthM:0})}),true);
 assert.equal(serviceAccessClear(road,{ground,water:(x,y)=>({waterDepthM:y>.5?1:0})}),false);
 assert.equal(serviceAccessClear(road,{ground,water:()=>({waterDepthM:null})}),false);
 assert.equal(servicePlotClear(0,24,{...survey,water:()=>({waterDepthM:null}),strictSurvey:true}),false);
});
