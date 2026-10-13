import test from 'node:test';import assert from 'node:assert/strict';
import {globalInput,globalFixture} from '../fixtures/global-scenarios.mjs';
import {createGlobalTerrain,restoreGlobalTerrain,createProjectedTerrainView} from '../src/core/global-terrain.mjs';
import {connectGlobalSurfaceWaterCharts} from '../src/core/global-water.mjs';
import {SHARED_BASE_WATER} from '../src/core/global-water-charts.mjs';
import {SEA_LEVEL_SCHEMA} from '../src/core/sea-level.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function base(){const s=globalInput({height:()=>100});s.references.sea={schema:SEA_LEVEL_SCHEMA,id:'shared-ocean',verticalDatum:'fixture-zero',levelElevationM:105};return createGlobalTerrain(s);}
const charts=[-1,1].map(sign=>({id:`chart:${sign}`,centerLatDeg:0,centerLonDeg:sign*.05,bounds:{minXM:-1000,maxXM:1000,minYM:-1000,maxYM:1000},verticalDatum:'fixture-zero',riverGraph:{nodes:[],edges:[]}}));
test('one canonical sea spans both charts and their gap without duplicated body definitions',()=>{
 const original=base(),world=connectGlobalSurfaceWaterCharts(original,{charts,sharedBaseWater:SHARED_BASE_WATER}),saved=world.toSnapshot(),restored=restoreGlobalTerrain(saved);
 assert.equal(saved.sharedBaseWater,SHARED_BASE_WATER);assert.ok(saved.waterCharts.every(c=>c.model.bodies.length===0));assert.deepEqual(restored.toSnapshot(),saved);
 for(const lon of[-.06,-.05,-.04,0,.04,.05,.06]){const p=world.sampleAt(0,lon);near(p.waterDepthM,5);near(p.waterLevelElevationM,105);assert.deepEqual(p.waterSourceIds,['shared-ocean']);assert.deepEqual(restored.sampleAt(0,lon),p);}
 for(const centerLonDeg of[-.05,.05]){const view=createProjectedTerrainView(world,{centerLatDeg:0,centerLonDeg,bounds:{minXM:-10000,maxXM:10000,minYM:-1000,maxYM:1000}});near(view.sampleAt(0,0).waterLevelElevationM,105);}
});
test('shared water is explicit; old chart saves keep their original scope and identity',()=>{
 const old=connectGlobalSurfaceWaterCharts(base(),{charts}),s=old.toSnapshot();assert.equal(s.sharedBaseWater,undefined);assert.deepEqual(restoreGlobalTerrain(s).toSnapshot(),s);assert.equal(old.sampleAt(0,.05).waterDepthM,0);
 assert.throws(()=>connectGlobalSurfaceWaterCharts(globalFixture({height:()=>100}),{charts,sharedBaseWater:SHARED_BASE_WATER}),/explicit sea/);
 assert.throws(()=>connectGlobalSurfaceWaterCharts(base(),{charts,sharedBaseWater:'guess-sea'}),/policy/);
 const bad=structuredClone(s);bad.sharedBaseWater=SHARED_BASE_WATER;assert.throws(()=>restoreGlobalTerrain(bad),/worldId/);
});

import {generatePlanet} from '../src/core/planet-generation.mjs';
import {offsetGeographic} from '../src/core/spherical.mjs';
import {packageGlobe} from '../scripts/package-globe.mjs';
import {PagedSource} from '../src/globe/paged-source.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
test('a real generated lake retains its one water level and ID in two views, their gap, save and paged sampling',async()=>{
 const generated=generatePlanet({seed:'planet-1',settlementCount:0}),original=generated.base,state=original.toSnapshot(),lake=state.references.lakes.find(l=>l.cells.some(i=>state.fields.groundElevationM[i]<l.levelElevationM-1));assert.ok(lake);
 const i=lake.cells.reduce((a,b)=>state.fields.groundElevationM[a]<state.fields.groundElevationM[b]?a:b),p={latDeg:90-(Math.floor(i/state.grid.columns)+.5)*180/state.grid.rows,lonDeg:(i%state.grid.columns+.5)*360/state.grid.columns};
 const inputs=[-1,1].map(sign=>{const c=offsetGeographic(p,sign*200,0,state.frame.radiusM);return{id:`lake-view:${sign}`,centerLatDeg:c.latDeg,centerLonDeg:c.lonDeg,bounds:{minXM:-100,maxXM:100,minYM:-100,maxYM:100},verticalDatum:state.frame.verticalDatum,riverGraph:{nodes:[],edges:[]}};});
 const world=connectGlobalSurfaceWaterCharts(original,{charts:inputs,sharedBaseWater:SHARED_BASE_WATER}),saved=world.toSnapshot(),restored=restoreGlobalTerrain(saved),directory=fs.mkdtempSync(path.join(os.tmpdir(),'shared-lake-'));
 try{
  const recipes=saved.waterCharts.map(c=>({id:c.id,projection:c.projection,bounds:c.bounds,model:c.model})),manifest=packageGlobe(original,directory,{recipes,canonicalWorldId:world.worldId,featureNamespace:true}),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};},source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
  for(let x=-350;x<=350;x+=25){const q=offsetGeographic(p,x,0,state.frame.radiusM);await source.enableFeaturesAt(q);const expected=original.sampleAt(q.latDeg,q.lonDeg),actual=world.sampleAt(q.latDeg,q.lonDeg),paged=await source.ready(()=>source.sample(q.latDeg,q.lonDeg));assert.ok(expected.waterDepthM>0);assert.deepEqual(actual.waterSourceIds,expected.waterSourceIds);near(actual.waterLevelElevationM,expected.waterLevelElevationM);near(paged.waterDepthM,actual.waterDepthM);near(paged.waterLevelElevationM,actual.waterLevelElevationM);assert.deepEqual(paged.waterSourceIds,actual.waterSourceIds);assert.deepEqual(restored.sampleAt(q.latDeg,q.lonDeg),actual);}
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('page export distinguishes legacy chart-only precedence from explicit shared water',async()=>{
 const original=base(),legacy=connectGlobalSurfaceWaterCharts(original,{charts}),saved=legacy.toSnapshot(),recipes=saved.waterCharts.map(c=>({id:c.id,projection:c.projection,bounds:c.bounds,model:c.model})),directory=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-water-policy-'));
 try{const manifest=packageGlobe(original,directory,{recipes,featureNamespace:true,baseWaterPolicy:'base-water-outside-charts@1'}),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};},source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
 for(const lon of[-.05,0,.05]){await source.enableFeaturesAt({latDeg:0,lonDeg:lon});const a=legacy.sampleAt(0,lon),b=await source.ready(()=>source.sample(0,lon));near(a.waterDepthM,b.waterDepthM);assert.equal(a.waterLevelElevationM,b.waterLevelElevationM);assert.deepEqual(a.waterSourceIds,b.waterSourceIds);}
 assert.throws(()=>new PagedSource({...manifest,baseWaterPolicy:'invent-water'},'https://example.test/'),/policy/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('shared reservoir level and a local river choose the higher actual water surface without losing the carved bed',()=>{
 for(const seaLevel of[99,105]){const s=base().toSnapshot();delete s.worldId;delete s.sourceWorldId;s.references.sea.levelElevationM=seaLevel;const original=createGlobalTerrain(s),a={id:'source',xM:0,yM:-250},b={id:'out',xM:0,yM:250},chart={...charts[0],riverGraph:{nodes:[a,b],edges:[{id:'stream',from:a.id,to:b.id,points:[a,b]}]}},world=connectGlobalSurfaceWaterCharts(original,{charts:[chart],sharedBaseWater:SHARED_BASE_WATER}),sample=world.sampleAt(0,chart.centerLonDeg);
 assert.ok(sample.groundElevationM<100);near(sample.waterLevelElevationM,Math.max(seaLevel,99.85));near(sample.waterDepthM,sample.waterLevelElevationM-sample.groundElevationM);assert.deepEqual(sample.waterSourceIds,seaLevel===105?['shared-ocean']:['chart%3A-1/stream']);}
});
