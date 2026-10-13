import test from 'node:test';import assert from 'node:assert/strict';
import {planSettlementRoadTree} from '../src/core/settlement-road-tree.mjs';
import {routeLocalRoad} from '../src/core/local-road-route.mjs';
const radiusM=6371000;
test('every village belongs to a deterministic linear-size tree, independent of input order',()=>{const sites=Array.from({length:2048},(_,i)=>({id:`v${i}`,latDeg:30+Math.floor(i/64)*.02,lonDeg:179+(i%64)*.02})),a=planSettlementRoadTree(sites,radiusM),b=planSettlementRoadTree([...sites].reverse(),radiusM);assert.deepEqual(a.links,b.links);assert.equal(a.links.length,2047);const reached=new Set([a.rootId]);for(let pass=0;pass<2048;pass++)for(const e of a.links){if(reached.has(e.from))reached.add(e.to);if(reached.has(e.to))reached.add(e.from);}assert.equal(reached.size,2048);});
const link={id:'r',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:.01}},flat={frame:{radiusM},sampleSurfaceAt:()=>({groundElevationM:20,waterDepthM:0})};
test('terrain route reaches exact endpoints and repeats identically',()=>{const r=routeLocalRoad(flat,link);assert.equal(r.status,'surveyed-local-route');assert.ok(Math.abs(r.points.at(-1).lonDeg-.01)<1e-9);assert.deepEqual(r,routeLocalRoad(flat,link));});
test('continuous river barrier is not silently replaced by a road or invented bridge',()=>{const r=routeLocalRoad({...flat,sampleSurfaceAt:(lat,lon)=>({groundElevationM:20,waterDepthM:lon>.004&&lon<.006?2:0})},link,{cells:33});assert.equal(r.status,'blocked-within-survey');assert.equal(r.points.length,0);});
import {createLocalRoadRecipe} from '../src/core/local-road-route.mjs';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
import {buildBuildingMesh} from '../src/globe/buildings.mjs';
test('road route produces the same physical surface and visible road, sparse away from alignment',()=>{
 const base={...flat,worldId:'flat',groundElevationAt:()=>20},r=createLocalRoadRecipe(base,{...link,distanceM:1112}),chart=createGlobeFeatureChart(base,r),mesh=buildBuildingMesh(r,radiusM,{includeRoads:true});
 assert.ok(mesh.index.length>0);const p=r.roadCenterlineProfiles[0].samples[10],g=chart.projection.toGeographic(p.xM,p.yM),s=chart.sampleAt(g.latDeg,g.lonDeg);assert.ok(s.roadSurface);assert.ok(Math.abs(s.groundElevationM-20.06)<1e-5);
 const away=chart.projection.toGeographic(p.xM,p.yM+19);assert.equal(chart.local(away.latDeg,away.lonDeg),null);
});
import {planRegionalRoadNetwork} from '../src/core/regional-road-network.mjs';
test('regional forest connects dry roots and leaves ocean-separated components explicit',()=>{
 const snapshot={frame:{radiusM},grid:{columns:16,rows:8},fields:{groundElevationM:Array(128).fill(20),landMask:Array.from({length:128},(_,i)=>i%16===4||i%16===12?0:1),lakeFillDepthM:Array(128).fill(0)}},sites=[{id:'a',latDeg:10,lonDeg:11.25},{id:'b',latDeg:10,lonDeg:56.25},{id:'c',latDeg:10,lonDeg:146.25}];
 const r=planRegionalRoadNetwork(snapshot,sites);assert.equal(r.links.length,1);assert.equal(r.components.length,2);assert.equal(r.links[0].from,'a');assert.equal(r.links[0].to,'b');
 assert.deepEqual(r,planRegionalRoadNetwork(snapshot,[...sites].reverse()));
});
test('open country uses a linear direct survey rather than expanding the whole route grid',()=>{const r=routeLocalRoad(flat,{...link,toPoint:{latDeg:0,lonDeg:.1}});assert.equal(r.survey.method,'direct-ground-survey');assert.ok(r.probes<600);});
test('recursive child sorting does not displace the parent split-boundary candidates',()=>{const sites=Array.from({length:1024},(_,i)=>({id:`s${i}`,latDeg:10+Math.floor(i/32)*.02,lonDeg:10+(i%32)*.02})),r=planSettlementRoadTree(sites,6371000);assert.ok(Math.max(...r.links.map(l=>l.distanceM))<5000);});
import {regionalRoadSegments} from '../src/core/regional-road-network.mjs';
test('sparse-region long village links are canonically split rather than silently omitted above 60km',()=>{const link={id:'long',from:'a',to:'b',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:1},distanceM:111195},parts=regionalRoadSegments(link,6371000);assert.ok(parts.length>5);assert.ok(parts.every(p=>p.distanceM<=20000));for(let i=1;i<parts.length;i++)assert.deepEqual(parts[i-1].toPoint,parts[i].fromPoint);assert.deepEqual(parts,regionalRoadSegments(link,6371000));});
import {copyJson} from '../src/core/json-contract.mjs';
test('regional corridors with legacy non-census anchors remain finite serializable JSON',()=>{
 const snapshot={grid:{columns:4,rows:2},frame:{radiusM:6371000},fields:{groundElevationM:new Float64Array(8).fill(20),landMask:new Uint8Array(8).fill(1)}},network=planRegionalRoadNetwork(snapshot,[{id:'legacy',latDeg:45,lonDeg:45},{id:'census',latDeg:45,lonDeg:135,population:300}]);assert.doesNotThrow(()=>copyJson(network));assert.ok(network.links.length>0);
});

test('local landscape bounds do not inherit every segment of a long regional leg',()=>{
 const R=6371000,link={id:'continental',from:'a',to:'b',fromPoint:{latDeg:0,lonDeg:0},toPoint:{latDeg:0,lonDeg:8},points:[{latDeg:0,lonDeg:0},{latDeg:0,lonDeg:8}],distanceM:889559},center=[Math.cos(4*Math.PI/180),Math.sin(4*Math.PI/180),0],bound={center,angular:500/R},all=regionalRoadSegments(link,R),near=regionalRoadSegments(link,R,20000,bound);
 assert.ok(all.length>40);assert.ok(near.length>0&&near.length<=4);for(const p of near)assert.deepEqual(p,all.find(q=>q.id===p.id));
 const shifted=regionalRoadSegments(link,R,20000,{center:[Math.cos(4.05*Math.PI/180),Math.sin(4.05*Math.PI/180),0],angular:500/R});
 for(const p of shifted)assert.deepEqual(p,all.find(q=>q.id===p.id));
 const short={id:'nearby',fromPoint:{latDeg:0,lonDeg:3.95},toPoint:{latDeg:0,lonDeg:4.05},distanceM:11120};
 assert.deepEqual(regionalRoadSegments(short,R,20000,bound),[short]);
 assert.deepEqual(regionalRoadSegments({...short,fromPoint:{latDeg:40,lonDeg:4},toPoint:{latDeg:40,lonDeg:4.1}},R,20000,bound),[]);
});

test('bounded canonical road selection remains stable at the date line and high latitude',async()=>{
 const {sphereBasis,greatCircle}=await import('../src/core/spherical.mjs');
 for(const [a,b] of [[{latDeg:20,lonDeg:179},{latDeg:20,lonDeg:-179}],[{latDeg:80,lonDeg:0},{latDeg:80,lonDeg:45}]]){
  const link={id:'polar-wrap',fromPoint:a,toPoint:b,points:[a,b],distanceM:greatCircle(a,b,radiusM).distanceM},all=regionalRoadSegments(link,radiusM),middle=all[Math.floor(all.length/2)],bound={center:sphereBasis(middle.fromPoint).up,angular:500/radiusM},near=regionalRoadSegments(link,radiusM,20000,bound);
  assert.ok(near.some(p=>p.id===middle.id));for(const p of near)assert.deepEqual(p,all.find(q=>q.id===p.id));
 }
});
