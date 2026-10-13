import test from 'node:test';import assert from 'node:assert/strict';
import {coalesceRoadSegments,coarseParcelTriangles} from '../src/globe/feature-lod.mjs';
import {metricRoads,tessellateRoadProfile} from '../src/core/road-geometry.mjs';
import {buildBuildingMesh} from '../src/globe/buildings.mjs';
const road=z=>metricRoads([{roadId:'r',halfWidthM:2,samples:Array.from({length:101},(_,i)=>({xM:i*2,yM:0,distanceM:i*2,roadElevationM:z(i*2)}))}])[0];
test('coarse roads remove redundant stations without moving bends or exceeding vertical error',()=>{
 for(const z of [x=>100+x*.01,x=>100+Math.sin(x/15)*.3]){
  const r=road(z),raw=tessellateRoadProfile(r,{elevationToleranceM:.1,maxSpanM:20}),coarse=coalesceRoadSegments(raw);assert.ok(coarse.length<raw.length/2);
  for(const s of coarse){assert.ok(s.b.distanceM-s.a.distanceM<=20);for(let t=0;t<=1;t+=.025){const d=s.a.distanceM+(s.b.distanceM-s.a.distanceM)*t,expected=r.at(d).roadElevationM,actual=s.a.roadElevationM+(s.b.roadElevationM-s.a.roadElevationM)*t;assert.ok(Math.abs(expected-actual)<=s.elevationErrorBoundM+1e-9);}}
 }
 const a={xM:0,yM:0,distanceM:0,roadElevationM:100},b={xM:5,yM:0,distanceM:5,roadElevationM:100},c={xM:5,yM:5,distanceM:10,roadElevationM:100};assert.equal(coalesceRoadSegments([{a,b,elevationErrorBoundM:0},{a:b,b:c,elevationErrorBoundM:0}]).length,2);
});
test('coarse parcel reduction bounds the existing grid surface and keeps curved detail when necessary',()=>{
 const flat=Array.from({length:81},(_,i)=>[i%9,Math.floor(i/9),100+(i%9)*.1]);assert.equal(coarseParcelTriangles(flat,8).length,2);
 const raised=structuredClone(flat);raised[40][2]+=1;assert.equal(coarseParcelTriangles(raised,8),null);
 const noisy=structuredClone(flat);noisy[40][2]+=.05;assert.equal(coarseParcelTriangles(noisy,8).length,2);
});
test('coarse building mesh retains the road and yard with less geometry; full detail is not mutated',()=>{
 const r={projection:{centerLatDeg:20,centerLonDeg:30,radiusM:6371000},buildings:[],roadCenterlineProfiles:[road(()=>100).road],landParcels:[{steps:8,color:[.4,.4,.3],points:Array.from({length:81},(_,i)=>({xM:i%9*2,yM:Math.floor(i/9)*2+10,elevationM:100}))}]},saved=JSON.stringify(r),full=buildBuildingMesh(r,6371000,{includeRoads:true}),coarse=buildBuildingMesh(r,6371000,{includeRoads:true,coarse:true});
 assert.ok(coarse.index.length>0&&coarse.index.length<full.index.length/5);assert.equal(JSON.stringify(r),saved);assert.deepEqual(full,buildBuildingMesh(r,6371000,{includeRoads:true}));
});
test('surface LOD reduces yards and roads without flattening nearby houses',()=>{
 const r={projection:{centerLatDeg:20,centerLonDeg:30,radiusM:6371000},buildings:[{id:'home',bounds:{minXM:0,maxXM:10,minYM:30,maxYM:38},baseElevationM:100,heightM:4,roofHeightM:2}],roadCenterlineProfiles:[road(()=>100).road],landParcels:[{steps:8,color:[.4,.4,.3],points:Array.from({length:81},(_,i)=>({xM:i%9*2,yM:Math.floor(i/9)*2+10,elevationM:100}))}]},saved=JSON.stringify(r),full=buildBuildingMesh(r,6371000,{includeRoads:true}),reduced=buildBuildingMesh(r,6371000,{includeRoads:true,coarse:false,coarseSurfaces:true}),house=buildBuildingMesh({...r,landParcels:[],roadCenterlineProfiles:[]},6371000);
 assert.ok(reduced.index.length<full.index.length/5);assert.deepEqual(reduced.vertex.slice(0,house.vertex.length),house.vertex);assert.deepEqual(reduced.buildingIds,full.buildingIds);assert.equal(JSON.stringify(r),saved);
});
import {selectFeatureDescriptors} from '../src/globe/buildings.mjs';
test('overview surface simplification is independent of house detail and stable identity',()=>{
 const d={path:'village',center:[1,0,0],angularRadius:.0001},camera={altitude:500,targetUp:[1,0,0]},selected=selectFeatureDescriptors([d],camera,6371000);assert.equal(selected[0].coarse,false);assert.equal(selected[0].coarseSurfaces,true);assert.equal(selected[0].path,d.path);assert.equal(selectFeatureDescriptors([d],{...camera,altitude:100},6371000)[0].coarseSurfaces,false);
});
