import test from 'node:test';import assert from 'node:assert/strict';import {fitLocalRiverCrossings} from '../src/core/local-road-crossings.mjs';
const samples=Array.from({length:81},(_,i)=>({latDeg:0,lonDeg:i*.00001,distanceM:i*5,elevationM:i>=36&&i<=44?15:20,waterDepthM:i>=36&&i<=44?4:0,waterLevelElevationM:19,waterSourceIds:i>=36&&i<=44?['river:1:2']:[]}));
test('bounded river crossing retains deck clearance, grades and explicit foundation limitations',()=>{const r=fitLocalRiverCrossings(samples);assert.ok(r);assert.equal(r.bridgeSpans.length,1);assert.ok(r.bridgeSpans[0].deckElevationM>=22);assert.ok(r.points.filter(p=>p.waterDepthM>0).every(p=>p.roadElevationM>=22));assert.ok(r.limitations.some(s=>s.includes('scour')));});
test('sea, lake and unknown water do not acquire automatic bridges',()=>{for(const id of ['sea','lake:1','unknown'])assert.equal(fitLocalRiverCrossings(samples.map(p=>({...p,waterSourceIds:p.waterDepthM?[id]:[]}))),null);assert.equal(fitLocalRiverCrossings(samples,{maxSpanM:20}),null);});
import {createLocalRoadRecipe} from '../src/core/local-road-route.mjs';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
import {buildBuildingMesh} from '../src/globe/buildings.mjs';
test('authorized game crossing is actual shared deck and pier geometry, not just a route flag',()=>{
 const R=6371000,wet=lon=>lon>.0044&&lon<.0048,base={worldId:'river-test',frame:{radiusM:R},groundElevationAt:(lat,lon)=>wet(lon)?15:20,sampleSurfaceAt:(lat,lon)=>({groundElevationM:wet(lon)?15:20,waterDepthM:wet(lon)?4:0,waterLevelElevationM:19,waterSourceIds:wet(lon)?['river:1:2']:[]})},link={id:'crossing',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:.01},distanceM:1112};
 const recipe=createLocalRoadRecipe(base,link,{allowRiverBridges:true});assert.equal(recipe.routeStatus.status,'surveyed-local-route');assert.equal(recipe.bridgeStructures.length,1);assert.equal(recipe.bridgeStructures[0].assessment.status,'within-input-model');const chart=createGlobeFeatureChart(base,recipe),sample=chart.sampleAt(0,.0046);assert.equal(sample.roadSurface.structureKind,'bridge-deck');assert.ok(sample.roadSurface.roadElevationM>=22);assert.ok(buildBuildingMesh(recipe,R,{includeRoads:true}).index.length>0);
});
test('incised river banks use a bounded graded embankment instead of inheriting an impassable bank slope',()=>{
 const input=Array.from({length:201},(_,i)=>{const d=Math.abs(i*5-500),wet=d<20,elevationM=20-Math.max(0,1-d/45)*10;return{latDeg:0,lonDeg:i*.00001,distanceM:i*5,elevationM,waterDepthM:wet?14-elevationM:0,waterLevelElevationM:14,waterSourceIds:wet?['river:1:2']:[]};});
 const r=fitLocalRiverCrossings(input);assert.ok(r);assert.ok(r.points.every((p,i)=>!i||Math.abs(p.roadElevationM-r.points[i-1].roadElevationM)<=.12*5+1e-8));assert.equal(r.points[0].roadElevationM,input[0].elevationM+.06);assert.equal(r.points.at(-1).roadElevationM,input.at(-1).elevationM+.06);assert.ok(r.points.every(p=>p.waterDepthM>0||p.roadElevationM-p.elevationM<=15));
});
test('explicit narrow lake crossings share bounded span and depth rules; broad lakes remain barriers',()=>{
 const lake=samples.map(p=>({...p,waterSourceIds:p.waterDepthM?['lake:1']:[]}));assert.ok(fitLocalRiverCrossings(lake,{allowLakeBridges:true}));assert.equal(fitLocalRiverCrossings(lake,{allowLakeBridges:true,maxSpanM:20}),null);assert.equal(fitLocalRiverCrossings(lake.map(p=>({...p,waterDepthM:p.waterDepthM?20:0})),{allowLakeBridges:true}),null);
});
import {resolveRoadEndpoint} from '../src/core/road-endpoints.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
test('a wet artificial section boundary resolves to the same dry anchor from either traversal direction',()=>{
 const R=6371000,base={frame:{radiusM:R},sampleSurfaceAt:(lat,lon)=>({groundElevationM:20,waterDepthM:Math.abs(lat)<.0002?2:0,waterSourceIds:Math.abs(lat)<.0002?['river:test']:[]})},point={latDeg:0,lonDeg:0};const a=resolveRoadEndpoint(base,point,{latDeg:1,lonDeg:0}),b=resolveRoadEndpoint(base,point,{latDeg:-1,lonDeg:0});assert.deepEqual(a,b);assert.equal(base.sampleSurfaceAt(a.latDeg,a.lonDeg).waterDepthM,0);
});
test('a flooded town gate switches to another existing street gate without moving the town',()=>{
 const base={frame:{radiusM:6371000},sampleSurfaceAt:(lat,lon)=>({groundElevationM:20,waterDepthM:lon>.001?2:0,waterSourceIds:lon>.001?['river:test']:[]})},site={id:'town',population:300,latDeg:0,lonDeg:0},before=JSON.stringify(site),gate=resolveRoadEndpoint(base,site,{latDeg:0,lonDeg:1});assert.equal(base.sampleSurfaceAt(gate.latDeg,gate.lonDeg).waterDepthM,0);assert.equal(JSON.stringify(site),before);assert.ok(Math.abs(gate.latDeg)>0||gate.lonDeg<0);
});
test('terrain routing searches for a shorter crossing when the direct line follows a river obliquely',()=>{
 const R=6371000,projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM:R,maxRadiusM:10000}),wet=(lat,lon)=>{const p=projection.toLocal(lat,lon);return Math.abs(p.yM-.02*p.xM+10)<8;},base={frame:{radiusM:R},groundElevationAt:(lat,lon)=>wet(lat,lon)?15:20,sampleSurfaceAt:(lat,lon)=>({groundElevationM:wet(lat,lon)?15:20,waterDepthM:wet(lat,lon)?4:0,waterLevelElevationM:19,waterSourceIds:wet(lat,lon)?['river:angled']:[]})},link={id:'angled',fromPoint:{latDeg:0,lonDeg:0},toPoint:projection.toGeographic(1200,0),distanceM:1200},recipe=createLocalRoadRecipe(base,link,{cells:9,probeSpacingM:5,allowRiverBridges:true});assert.equal(recipe.routeStatus.status,'surveyed-local-route');assert.ok(recipe.bridgeStructures.length>0);assert.ok(recipe.bridgeStructures.every(b=>Math.hypot(b.end.xM-b.start.xM,b.end.yM-b.start.yM)<=160.01));
});
test('short obstructed endpoints never collapse into a one-point successful road on a coarse grid',()=>{
 const R=6371000,base={frame:{radiusM:R},groundElevationAt:()=>20,sampleSurfaceAt:(lat,lon)=>({groundElevationM:20,waterDepthM:lon>0.00006&&lon<0.00024?2:0,waterSourceIds:lon>0.00006&&lon<0.00024?['sea']:[]})},link={id:'short',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:.0003},distanceM:33.36},recipe=createLocalRoadRecipe(base,link,{cells:9,probeSpacingM:5});assert.notEqual(recipe.routeStatus.status,'surveyed-local-route');assert.equal(recipe.roadCenterlineProfiles.length,0);
});
test('an artificial road-section boundary inside a housing block resolves to a shared public point',()=>{
 const base={frame:{radiusM:6371000},sampleSurfaceAt:(lat,lon)=>({waterDepthM:0,waterSourceIds:[],groundElevationM:20,landReserved:Math.abs(lat)<.0002&&Math.abs(lon)<.0002})},point={latDeg:0,lonDeg:0},a=resolveRoadEndpoint(base,point,{latDeg:0,lonDeg:1}),b=resolveRoadEndpoint(base,point,{latDeg:0,lonDeg:-1});assert.deepEqual(a,b);assert.equal(base.sampleSurfaceAt(a.latDeg,a.lonDeg).landReserved,false);
});
test('housing-boundary relocation chooses an open point rather than trapping routing in a thin internal street',()=>{
 const R=6371000,base={frame:{radiusM:R},sampleSurfaceAt:(lat,lon)=>({waterDepthM:0,waterSourceIds:[],groundElevationM:20,landReserved:Math.abs(lat)<.0018&&Math.abs(lon)<.0018&&Math.abs(lat)>.00002})},point={latDeg:.0005,lonDeg:0},resolved=resolveRoadEndpoint(base,point,{latDeg:1,lonDeg:0});assert.equal(base.sampleSurfaceAt(resolved.latDeg,resolved.lonDeg).landReserved,false);assert.ok(Math.abs(resolved.latDeg)>.0018||Math.abs(resolved.lonDeg)>.0018);
});
