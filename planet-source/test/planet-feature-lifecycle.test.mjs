import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingLayer, buildBuildingMesh } from '../src/globe/buildings.mjs';
import { createHash } from '../src/core/sha256.mjs';
import { validateBuildings } from '../src/core/building-geometry.mjs';
import { metricRoads, tessellateRoadProfile } from '../src/core/road-geometry.mjs';
import { generatePlanet } from '../src/core/planet-generation.mjs';
test('empty feature pages are fetched once; failures back off instead of retrying each frame',async()=>{
 const saved=globalThis.fetch;let calls=0;
 const text=JSON.stringify({buildings:[]}),d={path:'empty.json',bytes:new TextEncoder().encode(text).length,sha256:createHash('sha256').update(text).digest('hex'),center:[1,0,0]};
 const manifest={base:{frame:{radiusM:100000}},featureCharts:[d]},renderer={dispose(){}};
 const camera={altitude:100,targetUp:[1,0,0]};
 try{globalThis.fetch=async()=>{calls++;return{ok:true,text:async()=>text};};const layer=new BuildingLayer(renderer,manifest,'https://example.test/manifest.json');layer.update(camera);await new Promise(r=>setImmediate(r));layer.update(camera);assert.equal(calls,1);layer.destroy();
 globalThis.fetch=async()=>{calls++;throw new Error('offline');};const failed=new BuildingLayer(renderer,manifest,'https://example.test/manifest.json');failed.update(camera);await new Promise(r=>setImmediate(r));failed.update(camera);assert.equal(calls,2);assert.equal(failed.errors.length,1);failed.destroy();
 }finally{globalThis.fetch=saved;}
});
test('narrow road geometry persists independently of terrain sampling and LOD',()=>{
 const w=generatePlanet({columns:32,rows:16,settlementCount:1}),r=w.recipes[0],a=buildBuildingMesh(r,w.base.frame.radiusM),b=buildBuildingMesh(r,w.base.frame.radiusM,{includeRoads:true});
 assert.equal(b.index.length-a.index.length,metricRoads(r.roadCenterlineProfiles).reduce((n,p)=>n+tessellateRoadProfile(p).length*(p.road.crossSection?12:6),0)+r.model.edges.reduce((n,e)=>n+(e.points.length-1)*6,0)+(r.bridgeStructures??[]).reduce((n,s)=>n+s.boxes.length*36,0));
 assert.ok([...b.vertex].every(Number.isFinite));
});
test('building geometry cannot disagree with its foundation',()=>{
 const w=generatePlanet({columns:32,rows:16,settlementCount:1}),r=structuredClone(w.recipes[0]);validateBuildings(r.buildings,r.buildingPads);
 r.buildings[0].baseElevationM+=1;assert.throws(()=>validateBuildings(r.buildings,r.buildingPads),/foundation/);
});

test('curved road rendering follows Core instead of connecting only endpoint heights',()=>{
 const road={id:'arch',halfWidthM:3,samples:[{xM:0,yM:0,roadElevationM:10,gradeSlope:.4},{xM:100,yM:0,roadElevationM:10,gradeSlope:-.4}]};
 const route=metricRoads([road])[0],segments=tessellateRoadProfile(route);
 assert.equal(route.at(50).roadElevationM,20);
 for(const s of segments){assert.ok(s.elevationErrorBoundM<=.005);for(let i=0;i<=20;i++){const t=i/20,d=s.a.distanceM+(s.b.distanceM-s.a.distanceM)*t,z=s.a.roadElevationM+(s.b.roadElevationM-s.a.roadElevationM)*t;assert.ok(Math.abs(route.at(d).roadElevationM-z)<=s.elevationErrorBoundM+1e-12);}}
 assert.throws(()=>tessellateRoadProfile(route,{maxSegments:1}),/budget/);
 const radius=6371000,mesh=buildBuildingMesh({projection:{centerLatDeg:0,centerLonDeg:0,radiusM:radius},roadCenterlineProfiles:[road]},radius,{includeRoads:true});
 const heights=[];for(let i=0;i<mesh.vertex.length;i+=12)heights.push(Math.hypot(...[0,1,2].map(k=>mesh.vertex[i+k]+mesh.anchor[k]))-radius);
 const expected=Math.max(...segments.flatMap(s=>[s.a.roadElevationM,s.b.roadElevationM]))+.025;
 assert.ok(Math.abs(Math.max(...heights)-expected)<.00001);assert.ok(Math.max(...heights)>20.019);
});

test('leaving and revisiting a village reuses byte-bounded feature geometry',async()=>{
 const saved=globalThis.fetch,w=generatePlanet({columns:32,rows:16,settlementCount:1}),recipe=w.recipes[0],text=JSON.stringify(recipe),d={path:'village.json',bytes:new TextEncoder().encode(text).length,sha256:createHash('sha256').update(text).digest('hex'),center:[1,0,0]},manifest={base:{frame:{radiusM:w.base.frame.radiusM}},featureCharts:[d]},camera={altitude:100,targetUp:[1,0,0]};let calls=0,uploads=0,disposals=0;
 const renderer={upload(mesh){uploads++;return{bytes:mesh.vertex.byteLength+mesh.index.byteLength};},dispose(){disposals++;}};
 try{globalThis.fetch=async()=>{calls++;return{ok:true,text:async()=>text};};const layer=new BuildingLayer(renderer,manifest,'https://example.test/manifest.json');
 layer.update(camera);await new Promise(r=>setImmediate(r));assert.equal(layer.loaded.size,1);const bytes=layer.stats().retainedMeshBytes;assert.ok(bytes>0&&bytes<=1024*1024);
 layer.update({...camera,altitude:40000});assert.equal(layer.bytes,0);assert.equal(layer.loaded.size,0);layer.update(camera);await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(layer.meshBuilds,1);assert.equal(layer.meshCacheHits,1);assert.equal(uploads,2);assert.equal(disposals,1);layer.destroy();assert.equal(layer.stats().retainedMeshBytes,0);
 }finally{globalThis.fetch=saved;}
});
test('newly visible city districts can reclaim the bounded feature budget from lower-priority roads',()=>{
 const disposed=[],layer=new BuildingLayer({dispose:t=>disposed.push(t)}, {base:{frame:{radiusM:6371000}},featureCharts:[]},'https://example.test/manifest.json');layer.limit=100;layer.bytes=90;layer.priority=new Map([['house',0],['road',1]]);layer.loaded.set('road',{bytes:90});assert.equal(layer.makeRoom('house',30),true);assert.equal(layer.bytes,0);assert.equal(disposed.length,1);layer.loaded.set('house',{bytes:80});layer.bytes=80;assert.equal(layer.makeRoom('road',30),false);assert.equal(layer.loaded.has('house'),true);layer.destroy();
});
test('budget-deferred feature meshes do not regenerate at a stationary view and resume when capacity exists',async()=>{
 const saved=globalThis.fetch,r={projection:{centerLatDeg:0,centerLonDeg:0,radiusM:100000},buildings:[{id:'h',bounds:{minXM:0,maxXM:10,minYM:0,maxYM:8},baseElevationM:100,heightM:3,roofHeightM:2}]},text=JSON.stringify(r),descriptors=['a','b'].map(path=>({path,bytes:new TextEncoder().encode(text).length,sha256:createHash('sha256').update(text).digest('hex'),center:[1,0,0]})),manifest={base:{frame:{radiusM:100000}},featureCharts:descriptors},camera={altitude:100,targetUp:[1,0,0]};let calls=0;const actual=buildBuildingMesh(r,100000,{includeRoads:true}),size=actual.vertex.byteLength+actual.index.byteLength+actual.vertex.length/12*24,renderer={upload:()=>({bytes:size}),dispose(){}};
 try{globalThis.fetch=async()=>{calls++;return{ok:true,text:async()=>text};};const layer=new BuildingLayer(renderer,manifest,'https://example.test/manifest.json');layer.limit=Math.ceil(size*1.1);layer.update(camera);await new Promise(r=>setImmediate(r));assert.equal(layer.loaded.size,1);assert.equal(layer.stats().budgetDeferred,1);assert.equal(calls,2);
  for(let i=0;i<20;i++)layer.update(camera);await new Promise(r=>setImmediate(r));assert.equal(layer.meshBuilds,2);assert.equal(calls,2);assert.equal(layer.pending.size,0);
  layer.limit=size*2;layer.update(camera);await new Promise(r=>setImmediate(r));assert.equal(layer.loaded.size,2);assert.equal(layer.stats().budgetDeferred,0);assert.equal(layer.meshCacheHits,1);assert.equal(calls,2);layer.destroy();
 }finally{globalThis.fetch=saved;}
});
test('an unadmittable feature does not evict other useful geometry before failing',()=>{
 const disposed=[],layer=new BuildingLayer({dispose:t=>disposed.push(t)},{base:{frame:{radiusM:100000}},featureCharts:[]},'https://example.test/manifest.json');layer.limit=100;layer.bytes=90;layer.priority=new Map([['high',0],['requested',1],['low',2]]);layer.loaded.set('high',{bytes:80});layer.loaded.set('low',{bytes:10});assert.equal(layer.makeRoom('requested',90),false);assert.equal(layer.bytes,90);assert.equal(disposed.length,0);layer.destroy();
});

import {withEarthworkEnvelope,createEarthworkEnvelope} from '../src/core/chart-earthwork-envelope.mjs';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
test('explicit earthwork envelope preserves physical cores and meets untouched terrain at its outer boundary',()=>{
 const w=generatePlanet({columns:32,rows:16,settlementCount:1}),original=w.recipes[0],before=JSON.stringify(original),recipe=withEarthworkEnvelope(original),old=createGlobeFeatureChart(w.base,original),chart=createGlobeFeatureChart(w.base,recipe),b=recipe.bounds;
 assert.equal(JSON.stringify(original),before);assert.deepEqual(recipe.buildings,original.buildings);assert.deepEqual(recipe.roadCenterlineProfiles,original.roadCenterlineProfiles);
 for(const road of original.roadCenterlineProfiles)for(const p of road.samples){const q=chart.projection.toGeographic(p.xM,p.yM);assert.equal(chart.groundElevationAt(q.latDeg,q.lonDeg),old.groundElevationAt(q.latDeg,q.lonDeg));}
 for(let i=0;i<=24;i++)for(const[x,y]of[[b.minXM+(b.maxXM-b.minXM)*i/24,b.minYM],[b.minXM+(b.maxXM-b.minXM)*i/24,b.maxYM],[b.minXM,b.minYM+(b.maxYM-b.minYM)*i/24],[b.maxXM,b.minYM+(b.maxYM-b.minYM)*i/24]]){
 const p=chart.projection.toGeographic(x,y),z=chart.groundElevationAt(p.latDeg,p.lonDeg);assert.ok(Math.abs(z-w.base.groundElevationAt(p.latDeg,p.lonDeg))<1e-8);assert.ok(Math.abs(chart.metricTerrain.groundElevationAt(x,y)-z)<1e-7);
 }
});
test('earthwork envelope interval arithmetic converges and invalid core clipping rejects',()=>{
 const original={bounds:{minXM:-10,maxXM:10,minYM:-10,maxYM:10},projection:{maxRadiusM:1000},model:{edges:[],bodies:[]},roadCenterlineProfiles:[]},recipe=withEarthworkEnvelope(original),e=createEarthworkEnvelope(recipe);
 for(const x of [-40,-25,0,25,40])for(const y of [-40,-25,0,25,40])for(const r of [0,.1,4]){const bound=e.bounds([1,2],[3,7],{xM:x,yM:y,radiusM:r});for(let k=0;k<16;k++)for(const base of[1,2])for(const z of[3,7]){const result=e.apply(x+r*Math.cos(k*Math.PI/8),y+r*Math.sin(k*Math.PI/8),base,z);assert.ok(result>=bound[0]-1e-10&&result<=bound[1]+1e-10);}}
 const a=e.bounds([2,2],[7,7],{xM:20,yM:0,radiusM:0});assert.ok(a[1]-a[0]<1e-10);
 const bad=structuredClone(recipe);bad.roadCenterlineProfiles=[{halfWidthM:3,samples:[{xM:12,yM:0}]}];assert.throws(()=>createEarthworkEnvelope(bad),/footprint/);
});

import {createSettlementRegionPlanner} from '../scripts/package-settlements.mjs';
import {createSettlementLayout} from '../src/core/settlement-layout.mjs';
test('new world envelope policy reaches the actual regional village layout, old worlds retain old recipes',()=>{
 const world=generatePlanet({seed:'apron-production',columns:32,rows:16,settlementCount:0,climatePlanning:true}),cell=world.population.cells.find(c=>c.population>0),region=createSettlementRegionPlanner(world).plan(cell.cellIndex),site=region.sites.find(s=>s.kind==='village');
 assert.ok(site);assert.equal(site.economicContext.earthworkEnvelopePolicy,'c1-outer-earthwork-apron@1');
 const next=createSettlementLayout(world.base,site,{nearbySettlements:region.sites.filter(s=>s.id!==site.id)});assert.ok(next.earthworkEnvelope);
 const legacySite=structuredClone(site);delete legacySite.economicContext.earthworkEnvelopePolicy;
 const old=createSettlementLayout(world.base,legacySite,{nearbySettlements:region.sites.filter(s=>s.id!==site.id)});assert.equal(old.earthworkEnvelope,undefined);
 assert.deepEqual(next.buildings,old.buildings);assert.deepEqual(next.roadCenterlineProfiles,old.roadCenterlineProfiles);
 assert.ok(next.bounds.minXM<old.bounds.minXM&&next.bounds.maxXM>old.bounds.maxXM);
});
