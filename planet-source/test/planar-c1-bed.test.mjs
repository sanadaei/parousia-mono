import test from'node:test';import assert from'node:assert/strict';
import{baseTerrain,node,edge,confluenceFixture}from'../fixtures/water-scenarios.mjs';
import{connectSurfaceWater}from'../src/core/surface-water.mjs';import{restoreTerrain,buildTerrainWithSurfaceWater}from'../src/core/index.mjs';import{PLANAR_C1_BED}from'../src/core/planar-river-bed.mjs';
const policy={method:PLANAR_C1_BED,maxIncisionM:5},near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
function river(){const a=node('a',200,200),b=node('b',500,200),c=node('c',650,350);return{nodes:[a,c],edges:[{id:'river',from:a.id,to:c.id,points:[a,b,c]}]};}
function build(bed=policy){return connectSurfaceWater(baseTerrain(()=>100),{riverGraph:river(),bed,parameters:{halfWidthM:5,bankWidthM:8,depthM:2,profileStepM:50}});}
test('explicit planar C1 channel is connected to real Core sampling and deterministic restoration',()=>{
 const t=build(),s=t.toSnapshot(),r=restoreTerrain(s);assert.deepEqual(s.hydrology.bed,policy);assert.notEqual(t.worldId,build(null).worldId);
 for(let y=185;y<=215;y+=.5)for(let x=175;x<=525;x+=5){const a=t.sampleAt(x,y),b=r.sampleAt(x,y);assert.deepEqual(a,b);assert.ok(a.groundElevationM<=100);assert.ok(a.groundElevationM>=95);assert.ok(a.waterDepthM>=0);}
 assert.ok(t.sampleAt(350,200).waterDepthM>1.9);near(t.groundElevationAt(350,214),100);
});
test('finite differences agree across the centre, bank join, outer bank, capsule cap and profile join',()=>{
 const t=build(),h=1e-3;for(const p of[{x:350,y:200,dx:0,dy:1},{x:350,y:205,dx:0,dy:1},{x:350,y:213,dx:0,dy:1},{x:187,y:200,dx:1,dy:0},{x:200,y:200,dx:1,dy:0},{x:500,y:200,dx:1,dy:0}]){
  const at=d=>t.groundElevationAt(p.x+p.dx*d,p.y+p.dy*d),a=(at(0)-at(-h))/h,b=(at(h)-at(0))/h;near(a,b,.002);
 }
});
test('a stated incision cap applies everywhere, including overlapping confluence capsules',()=>{
 const saved=confluenceFixture().toSnapshot(),base=baseTerrain(),graph={nodes:saved.hydrology.nodes.map(n=>({id:n.id,xM:n.xM,yM:n.yM})),edges:saved.hydrology.edges.map(e=>({id:e.id,from:e.from,to:e.to,points:e.points.map(p=>({xM:p.xM,yM:p.yM}))}))},t=connectSurfaceWater(base,{riverGraph:graph,bed:{...policy,maxIncisionM:2}});
 for(let y=335;y<=365;y+=1)for(let x=235;x<=265;x+=1)assert.ok(base.groundElevationAt(x,y)-t.groundElevationAt(x,y)<=2+1e-9);
});

import{globalFixture}from'../fixtures/global-scenarios.mjs';import{connectInterChartRivers}from'../src/core/global-interchart-rivers.mjs';import{restoreGlobalTerrain}from'../src/core/global-terrain.mjs';import{createSphericalProjection}from'../src/core/spherical.mjs';import{globeDemo,packageGlobe}from'../scripts/package-globe.mjs';import{createGlobeFeatureChart}from'../src/core/globe-features.mjs';import{PagedSource}from'../src/globe/paged-source.mjs';import fs from'node:fs';import os from'node:os';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
test('C1 beds continue through an explicitly connected pair of global chart openings',()=>{
 const base=globalFixture({height:()=>100}),charts=[-1,1].map(sign=>{const a={id:'a',xM:sign<0?-500:0,yM:0},b={id:'b',xM:sign<0?0:500,yM:0};return{id:sign<0?'left':'right',centerLatDeg:0,centerLonDeg:0,verticalDatum:'fixture-zero',bounds:{minXM:sign<0?-1000:0,maxXM:sign<0?0:1000,minYM:-500,maxYM:500},riverGraph:{nodes:[a,b],edges:[edge('river',a,b)]},bed:policy};}),world=connectInterChartRivers(base,{charts,interChartRivers:[{fromChartId:'left',toChartId:'right',fromNodeId:'b',toNodeId:'a',junctionLatDeg:0,junctionLonDeg:0}]}),projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM:base.frame.radiusM}),restored=restoreGlobalTerrain(world.toSnapshot());
 for(const y of[0,1,1.8,3,4.8,5]){const at=x=>{const p=projection.toGeographic(x,y);return world.sampleAt(p.latDeg,p.lonDeg);};near(at(-1e-3).groundElevationM,at(1e-3).groundElevationM,1e-7);const h=.001,left=(at(0).groundElevationM-at(-h).groundElevationM)/h,right=(at(h).groundElevationM-at(0).groundElevationM)/h;near(left,right,.002);}
 const p=projection.toGeographic(0,0);assert.deepEqual(restored.sampleAt(p.latDeg,p.lonDeg),world.sampleAt(p.latDeg,p.lonDeg));
});
test('the generated globe demonstration uses the new bed in Core, exported feature pages and terrain queries',async()=>{
 const d=globeDemo();assert.equal(d.recipe.model.bed.method,PLANAR_C1_BED);const chart=createGlobeFeatureChart(d.base,d.recipe),dir=fs.mkdtempSync(path.join(os.tmpdir(),'c1-planar-globe-'));
 try{const manifest=packageGlobe(d.base,dir,{recipe:d.recipe}),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};},source=new PagedSource(manifest,pathToFileURL(path.join(dir,'manifest.json')).href,fetcher);await source.enableFeatures();
 for(let y=-200;y<=200;y+=20)for(let x=-20;x<=20;x+=2){const p=chart.projection.toGeographic(x,y),a=chart.sampleAt(p.latDeg,p.lonDeg),b=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));near(a.groundElevationM,b.groundElevationM);assert.equal(a.waterLevelElevationM,b.waterLevelElevationM);assert.deepEqual(a.waterSourceIds,b.waterSourceIds);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('invalid or unknown bed policies are rejected instead of silently becoming old triangles',()=>{for(const bed of[{method:'fake',maxIncisionM:5},{method:PLANAR_C1_BED,maxIncisionM:0},{method:PLANAR_C1_BED,maxIncisionM:Infinity}])assert.throws(()=>build(bed),/policy/);});

test('C1 incision preserves a sloping base at its compact support and owns its input',()=>{
 const base=baseTerrain((x,y)=>100+.002*x-.001*y),input={...policy},t=connectSurfaceWater(base,{riverGraph:river(),bed:input,parameters:{halfWidthM:5,bankWidthM:8,depthM:2,profileStepM:50}}),before=t.sampleAt(350,200);input.maxIncisionM=500;assert.deepEqual(t.sampleAt(350,200),before);
 for(const y of[187,213]){const h=.001,f=d=>t.groundElevationAt(350,y+d);near((f(0)-f(-h))/h,(f(h)-f(0))/h,.002);near(f(0),base.groundElevationAt(350,y));}
});
import{lakeOceanFixture}from'../fixtures/water-scenarios.mjs';
test('opt-in river beds keep explicit lake and ocean anchors compatible',()=>{
 const saved=lakeOceanFixture().toSnapshot();delete saved.worldId;saved.hydrology.bed={method:PLANAR_C1_BED,maxIncisionM:200};const t=buildTerrainWithSurfaceWater(saved),restored=restoreTerrain(t.toSnapshot());let wet=0;
 for(let x=80;x<=980;x+=2){const a=t.sampleAt(x,500);assert.deepEqual(a,restored.sampleAt(x,500));assert.ok(a.waterDepthM>=0);if(a.waterDepthM>0)wet++;}
 assert.ok(wet>300);for(const x of[300,500])near(t.sampleAt(x,500).waterLevelElevationM,140);
});

test('oblique shared openings preserve the same C1 bed and reject mismatched policies',()=>{
 const base=globalFixture({height:()=>100}),projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM:base.frame.radiusM});
 for(const rise of[-350,200,400]){const charts=[-1,1].map(sign=>{const a={id:'a',xM:sign<0?-500:0,yM:sign<0?-rise:0},b={id:'b',xM:sign<0?0:500,yM:sign<0?0:rise};return{id:sign<0?'left':'right',centerLatDeg:0,centerLonDeg:0,verticalDatum:'fixture-zero',bounds:{minXM:sign<0?-1000:0,maxXM:sign<0?0:1000,minYM:-600,maxYM:600},riverGraph:{nodes:[a,b],edges:[edge('river',a,b)]},bed:{...policy}};}),interChartRivers=[{fromChartId:'left',toChartId:'right',fromNodeId:'b',toNodeId:'a'}],world=connectInterChartRivers(base,{charts,interChartRivers});
  for(let y=-5;y<=5;y+=.5){const z=x=>{const p=projection.toGeographic(x,y);return world.groundElevationAt(p.latDeg,p.lonDeg);};const h=.0001;near((z(0)-z(-h))/h,(z(h)-z(0))/h,.002);}
  charts[1].bed.maxIncisionM=4;assert.throws(()=>connectInterChartRivers(base,{charts,interChartRivers}),/policies must match/);
 }
});
import{buildBuildingMesh}from'../src/globe/buildings.mjs';
test('C1 display never adds an unconditional linear water ribbon over sampled wetness',()=>{
 const d=globeDemo(),recipe={...d.recipe,buildings:[],roadCenterlineProfiles:[],buildingPads:[]};assert.equal(buildBuildingMesh(recipe,d.base.frame.radiusM,{includeRoads:true}).index.length,0);
 const legacy=structuredClone(recipe);delete legacy.model.bed;assert.ok(buildBuildingMesh(legacy,d.base.frame.radiusM,{includeRoads:true}).index.length>0);
});
