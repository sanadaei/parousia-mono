import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { generatePlanet } from '../src/core/planet-generation.mjs';
import { createGlobalTerrain, restoreGlobalTerrain } from '../src/core/global-terrain.mjs';
import { sampleSeaLevel, validateSeaLevel, SEA_LEVEL_SCHEMA } from '../src/core/sea-level.mjs';
import { createGlobeFeatureChart } from '../src/core/globe-features.mjs';
import { packageGlobe } from '../scripts/package-globe.mjs';
import { PagedSource } from '../src/globe/paged-source.mjs';
import { buildMesh } from '../src/globe/mesh.mjs';
import { buildBuildingMesh } from '../src/globe/buildings.mjs';
const options={columns:32,rows:16,settlementCount:3};
const world=generatePlanet(options);
test('new world is reproducible with different content for another seed',()=>{
 assert.equal(world.base.worldId,generatePlanet(options).base.worldId);
 assert.deepEqual(world.recipes,generatePlanet(options).recipes);
 assert.notEqual(world.base.worldId,generatePlanet({...options,seed:'another'}).base.worldId);
 assert.ok(world.diagnostics.landCells>0 && world.diagnostics.waterCells>0);
});
test('new sea is explicit and old snapshots remain hydrologically unknown',()=>{
 const s=world.base.toSnapshot();delete s.worldId;delete s.sourceWorldId;delete s.references.sea;
 const old=createGlobalTerrain(s);assert.equal(old.sampleAt(0,0).waterDepthM,null);
 const restored=restoreGlobalTerrain(JSON.stringify(world.base.toSnapshot()));assert.equal(restored.worldId,world.base.worldId);
 for(const p of [[0,0],[89.9,180],[-89.9,-180]]) assert.deepEqual(restored.sampleAt(...p),world.base.sampleAt(...p));
});
test('sea uses the same datum and never produces negative depths',()=>{
 assert.throws(()=>validateSeaLevel({schema:SEA_LEVEL_SCHEMA,id:'sea',levelElevationM:0,verticalDatum:'other'},'terrain'),/datums/);
 const sea=world.base.toSnapshot().references.sea;
 assert.equal(sampleSeaLevel(sea,sea.levelElevationM+10).waterDepthM,0);
 assert.equal(sampleSeaLevel(sea,sea.levelElevationM-10).waterDepthM,10);
});
test('settlements have dry stable house foundations, separate from render LOD',()=>{
 assert.ok(world.recipes.length>0);
 const ids=new Set();
 for(const recipe of world.recipes){const chart=createGlobeFeatureChart(world.base,recipe);
 for(const b of recipe.buildings){assert.ok(!ids.has(b.id));ids.add(b.id);
 assert.ok(b.baseElevationM>0);const x=(b.bounds.minXM+b.bounds.maxXM)/2,y=(b.bounds.minYM+b.bounds.maxYM)/2;
 const p=chart.projection.toGeographic(x,y),s=chart.sampleAt(p.latDeg,p.lonDeg);
 assert.ok(Math.abs(s.groundElevationM-b.baseElevationM)<1e-7);
 assert.equal(s.buildingId,b.id);
 }}
});
test('house geometry has walls and roofs and stable IDs, not only pads',()=>{
 const mesh=buildBuildingMesh(world.recipes[0],world.base.frame.radiusM);
 assert.equal(mesh.buildingIds.length,world.recipes[0].buildings.length);
 assert.equal(mesh.index.length,mesh.buildingIds.length*14*3);
 assert.ok([...mesh.vertex].every(Number.isFinite));
 assert.deepEqual(mesh,buildBuildingMesh(world.recipes[0],world.base.frame.radiusM));
});
test('paged generated world agrees with resident sea and emits water geometry',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-water-'));
 try{
 const manifest=packageGlobe(world.base,directory,{recipes:world.recipes,focus:world.focus});
 const fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
 const source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
 for(let i=0;i<30;i++){const lat=-80+i*5,lon=i*31;const a=world.base.sampleAt(lat,lon),b=await source.ready(()=>source.sample(lat,lon));assert.equal(a.waterDepthM,b.waterDepthM);assert.equal(a.groundElevationM,b.groundElevationM);}
 let water=0;
 for(let face=0;face<6;face++){const mesh=await buildMesh(source,{face,level:0,x:0,y:0});water+=mesh.overlayIndex.length;assert.equal(mesh.waterIndexCount,mesh.overlayIndex.length,'root sea overlay indices are tagged as water');}
 assert.ok(water>0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('invalid world parameters reject instead of silently falling back',()=>{
 assert.throws(()=>generatePlanet({seed:''}));assert.throws(()=>generatePlanet({columns:1}));assert.throws(()=>generatePlanet({settlementCount:100}));
});
test('multi-chart paging preserves fill elevations and house foundations, not only cuts',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-foundations-'));
 try{
 const manifest=packageGlobe(world.base,directory,{recipes:world.recipes,focus:world.focus});
 const fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
 const source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
 for(const r of world.recipes){const chart=createGlobeFeatureChart(world.base,r);
 for(const b of r.buildings.slice(0,3)){const p=chart.projection.toGeographic((b.bounds.minXM+b.bounds.maxXM)/2,(b.bounds.minYM+b.bounds.maxYM)/2);await source.enableFeaturesAt(p);
 const actual=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));assert.ok(Math.abs(actual.groundElevationM-b.baseElevationM)<1e-7);assert.equal(actual.buildingId,b.id);
 assert.equal(source.groundElevationAt(p.latDeg,p.lonDeg),chart.groundElevationAt(p.latDeg,p.lonDeg));}
 }
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
import { directionTile } from '../src/globe/lod-neighbors.mjs';
import { createSphericalProjection, sphereBasis } from '../src/core/spherical.mjs';
test('displayed river is not hidden under an unrefined ground triangle at regional LOD',async()=>{
 const world=generatePlanet(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-visible-water-'));
 try{const r=world.recipes.find(r=>r.riverSource),p=r.riverSource.location,basis=sphereBasis(p);
 const manifest=packageGlobe(world.base,directory,{recipes:world.recipes,focus:world.focus}),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
 const source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher),mesh=await buildMesh(source,directionTile(basis.up,15));
 const center=basis.up.map(v=>v*world.base.frame.radiusM),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const heights=(vertices,indices)=>{const hits=[];for(let i=0;i<indices.length;i+=3){const [a,b,c]=[indices[i],indices[i+1],indices[i+2]].map(j=>{const d=[0,1,2].map(k=>vertices[j*12+k]+mesh.anchor[k]-center[k]);return[dot(d,basis.east),dot(d,basis.north),dot(d,basis.up)];});
 const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;const u=((b[1]-c[1])*-c[0]+(c[0]-b[0])*-c[1])/den,v=((c[1]-a[1])*-c[0]+(a[0]-c[0])*-c[1])/den,w=1-u-v;if(Math.min(u,v,w)>=-1e-7)hits.push(u*a[2]+v*b[2]+w*c[2]);}return hits;};
 const ground=heights(mesh.vertex,mesh.index),water=heights(mesh.overlayVertex,mesh.overlayIndex);assert.ok(ground.length);assert.ok(water.length,'water must not be discarded by feature refinement budget');assert.ok(Math.max(...ground)<Math.max(...water),'rendered ground must not cover this wet river point');assert.ok(mesh.vertex.length/12<65536);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('settlement river crossings reference the global channel instead of generating isolated local streams',()=>{
 const w=generatePlanet(),network=w.base.toSnapshot().references.rivers;
 assert.ok(w.recipes.some(r=>r.riverSource));
 for(const recipe of w.recipes){assert.equal(recipe.model.edges.length,0);if(recipe.riverSource){const source=recipe.riverSource,profile=network.profiles.find(p=>p.id===source.profileId);assert.ok(profile);assert.deepEqual(source.location,profile.points[source.pointIndex]);assert.ok(w.base.sampleAt(source.location.latDeg,source.location.lonDeg).waterDepthM>0);}}
});

test('high source resolution is refused before allocation unless explicitly budgeted',()=>{
 assert.throws(()=>generatePlanet({columns:512,rows:256,settlementCount:0}),/work budget/);
 for(const options of [{maxSourceCells:127},{maxSourceCells:Infinity},{maxRiverPoints:1},{maxRiverPoints:131073}])assert.throws(()=>generatePlanet(options),/work budget/);
 const world=generatePlanet({columns:16,rows:8,settlementCount:0,maxSourceCells:128,maxRiverPoints:2});assert.ok(world.diagnostics.globalRivers.pointCount<=2);
});

test('generated terrain carries metre-scale detail in the canonical field, not only in rendering',()=>{
 const saved=world.base.toSnapshot();assert.deepEqual(saved.detail.bands.map(b=>b.wavelengthM).sort((a,b)=>a-b),[8,180,900,2500]);
 delete saved.worldId;delete saved.sourceWorldId;delete saved.references.rivers;
 const fine=createGlobalTerrain(saved),coarseInput=structuredClone(saved);coarseInput.detail.bands=coarseInput.detail.bands.filter(b=>b.wavelengthM>8);
 const coarse=createGlobalTerrain(coarseInput),projection=createSphericalProjection(world.recipes[0].projection),deltas=[];
 for(let x=-60;x<=60;x++){const p=projection.toGeographic(x,70),a=fine.sampleAt(p.latDeg,p.lonDeg),b=coarse.sampleAt(p.latDeg,p.lonDeg);deltas.push(a.groundElevationM-b.groundElevationM);assert.ok(Math.abs(a.detailElevationM)<=saved.detail.bands.reduce((sum,b)=>sum+b.amplitudeM,0)+1e-9);}
 assert.ok(Math.max(...deltas)-Math.min(...deltas)>.002,'8m band must change actual metre-spaced samples');
 const restored=restoreGlobalTerrain(fine.toSnapshot());for(const x of[-10,0,10]){const p=projection.toGeographic(x,70);assert.equal(restored.groundElevationAt(p.latDeg,p.lonDeg),fine.groundElevationAt(p.latDeg,p.lonDeg));}
});

test('broad carved valley leaves rendered channel visible at twelve-level detail',async()=>{
 const world=generatePlanet({seed:'planet-b',settlementCount:0,riverValleys:{maxIncisionM:600,sideRunPerRise:3}}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-valley-water-'));
 try{
 const p=world.base.toSnapshot().references.rivers.profiles.find(p=>p.id==='river:2531:2404').points.reduce((a,b)=>a.bankWidthM>b.bankWidthM?a:b),basis=sphereBasis(p);
 const manifest=packageGlobe(world.base,directory,{recipes:[],focus:p}),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
 const source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher),mesh=await buildMesh(source,directionTile(basis.up,12));
 const center=basis.up.map(v=>v*world.base.frame.radiusM),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const heights=(vertices,indices)=>{const hits=[];for(let i=0;i<indices.length;i+=3){const [a,b,c]=[indices[i],indices[i+1],indices[i+2]].map(j=>{const d=[0,1,2].map(k=>vertices[j*12+k]+mesh.anchor[k]-center[k]);return[dot(d,basis.east),dot(d,basis.north),dot(d,basis.up)];});
 const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;const u=((b[1]-c[1])*-c[0]+(c[0]-b[0])*-c[1])/den,v=((c[1]-a[1])*-c[0]+(a[0]-c[0])*-c[1])/den,w=1-u-v;if(Math.min(u,v,w)>=-1e-7)hits.push(u*a[2]+v*b[2]+w*c[2]);}return hits;};

 const ground=heights(mesh.vertex,mesh.index),water=heights(mesh.overlayVertex,mesh.overlayIndex);
 assert.ok(ground.length);assert.ok(water.length);assert.ok(Math.max(...ground)<Math.max(...water),'deep valley terrain must not conceal the channel');
 let wetVertices=0;
 for(let i=0;i<mesh.vertex.length;i+=12){const d=[0,1,2].map(k=>mesh.vertex[i+k]+mesh.anchor[k]),lat=Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,lon=Math.atan2(d[1],d[0])*180/Math.PI,actual=world.base.sampleAt(lat,lon);
 if(actual.waterDepthM>.1){wetVertices++;assert.ok(Math.hypot(...d)-world.base.frame.radiusM<actual.waterLevelElevationM+.05,'display skirts must not create dams above a wet channel');const coarse=[0,1,2].map(k=>mesh.vertex[i+3+k]+mesh.anchor[k]);assert.ok(Math.hypot(...coarse)-world.base.frame.radiusM<actual.waterLevelElevationM+.05,'morph/stitch target must not lift wet bed above its water');}}
 assert.ok(wetVertices>10);
 assert.ok(mesh.vertex.length/12<65536);assert.ok(mesh.overlayVertex.length/12<65536);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('regional river recipe is saved in canonical water and balanced siting, with legacy restoration unchanged',()=>{
 const options={seed:'regional-river-contract',columns:16,rows:8,settlementCount:0,climatePlanning:true};
 const old=generatePlanet(options),saved=old.base.toSnapshot();
 const regional=generatePlanet({...options,riverDetail:'regional'}),snapshot=regional.base.toSnapshot();
 assert.equal(saved.references.rivers.diagnostics.sourceThreshold,20);
 assert.equal(snapshot.references.rivers.diagnostics.sourceThreshold,5);
 assert.equal(regional.landscape.settlementSiting,'river-access-siting@2');
 assert.equal(regional.landscape.environmentPolicy,'valley-water-cover@2');
 assert.equal(snapshot.references.environmentPolicy,'valley-water-cover@2');
 assert.equal(snapshot.references.rivers.diagnostics.maxPoints,32768);
 assert.ok(snapshot.references.rivers.diagnostics.pointCount<=32768);
 assert.deepEqual(restoreGlobalTerrain(saved).toSnapshot(),saved);
 assert.deepEqual(generatePlanet({...options,riverDetail:'regional'}).base.toSnapshot(),snapshot);
 assert.throws(()=>generatePlanet({...options,riverDetail:'maximum'}),/riverDetail/);
});
