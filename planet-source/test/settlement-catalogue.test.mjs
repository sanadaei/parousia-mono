import {createSettlementRegionPlanner} from '../scripts/package-settlements.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {sitePopulationRegion,catalogueRegionBound,intersectsCatalogueRegion} from '../src/core/settlement-catalogue.mjs';
import {createSettlementLayout} from '../src/core/settlement-layout.mjs';import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';import {buildBuildingMesh} from '../src/globe/buildings.mjs';
const base={worldId:'flat',frame:{radiusM:6371000},groundElevationAt:()=>20,sampleSurfaceAt:()=>({groundElevationM:20,waterDepthM:0,waterLevelElevationM:0})};
const population={sourceWorldId:'flat',grid:{columns:16,rows:8},cells:Array.from({length:128},(_,i)=>({cellIndex:i,population:0,villages:0,towns:0,cities:0}))};population.cells[65]={cellIndex:65,population:30000,ruralPopulation:30000,townPopulation:0,cityPopulation:0,villages:100,towns:0,cities:0};
test('regional catalogue fixes more than32 positions without allocating houses',()=>{const a=sitePopulationRegion(base,population,65),b=sitePopulationRegion(base,population,65);assert.deepEqual(a,b);assert.equal(a.sites.length,100);assert.equal(new Set(a.sites.map(s=>s.id)).size,100);assert.equal(a.populations.placed,30000);assert.equal(a.populations.unplaced,0);assert.ok(a.sites.every(s=>!s.buildings&&s.population===300));});
test('rejection preserves other slot identities and explicitly unplaced population',()=>{const a=sitePopulationRegion(base,population,65),wet=sitePopulationRegion({...base,sampleSurfaceAt:()=>({groundElevationM:20,waterDepthM:5,waterLevelElevationM:25})},population,65);assert.equal(wet.sites.length,0);assert.equal(wet.populations.unplaced,30000);const b=sitePopulationRegion(base,population,65,{anchors:[a.sites[0]]});assert.ok(!b.sites.some(s=>s.id===a.sites[0].id));assert.deepEqual(b.sites.find(s=>s.id===a.sites[99].id),a.sites[99]);});
test('bounded work reports unplaced slots rather than creating unlimited objects',()=>{const q=sitePopulationRegion(base,population,65,{maxSites:10});assert.equal(q.sites.length,10);assert.equal(q.rejected.budget,90);assert.equal(q.populations.unplaced,27000);assert.throws(()=>sitePopulationRegion(base,population,65,{maxSites:Infinity}));});
test('residential layout shares canonical collision and rendering, stable on revisit',()=>{const site=sitePopulationRegion(base,population,65).sites[0],r=createSettlementLayout(base,site);assert.equal(r.layoutStatus.placedDwellings,60);assert.equal(r.layoutStatus.complete,true);assert.deepEqual(r,createSettlementLayout(base,site));const chart=createGlobeFeatureChart(base,r),b=r.buildings[0],p=chart.projection.toGeographic((b.bounds.minXM+b.bounds.maxXM)/2,(b.bounds.minYM+b.bounds.maxYM)/2);assert.equal(chart.sampleAt(p.latDeg,p.lonDeg).buildingId,b.id);assert.equal(chart.sampleAt(p.latDeg,p.lonDeg).groundElevationM,b.baseElevationM);const mesh=buildBuildingMesh(r,base.frame.radiusM,{includeRoads:true});assert.equal(mesh.buildingIds.length,r.buildings.length);assert.ok(mesh.vertex.every(Number.isFinite));});
test('large-city layout is explicitly incomplete, wet sites never grow invented bridges',()=>{const s=sitePopulationRegion(base,population,65).sites[0],city=createSettlementLayout(base,{...s,population:50000});assert.equal(city.layoutStatus.complete,false);assert.equal(city.layoutStatus.totalRequestedDwellings,10000);assert.equal(city.layoutStatus.placedDwellings,96);const wet=createSettlementLayout({...base,sampleSurfaceAt:()=>({waterDepthM:3})},s);assert.equal(wet.buildings.length,0);assert.equal(wet.roadCenterlineProfiles.length,0);});
test('regional sphere bounds support dateline and pole-safe filtering',()=>{const r=catalogueRegionBound(population.grid,65);assert.equal(intersectsCatalogueRegion(r,{center:r.center,angular:0}),true);assert.equal(intersectsCatalogueRegion(r,{center:r.center.map(v=>-v),angular:0}),false);});
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {generatePlanet} from '../src/core/planet-generation.mjs';import {publishPlanet} from '../scripts/publish-planet.mjs';import {restorePlanetWorld} from '../src/core/planet-world.mjs';import {PagedSource} from '../src/globe/paged-source.mjs';import {sphereBasis} from '../src/core/spherical.mjs';import {populationUpgradeRequest} from '../scripts/planet-generation-api.mjs';
test('published regional pages restore identity, demand recipes match Core and revisit unchanged',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'settlement-pages-'));try{
 const world=generatePlanet({seed:'catalogue-integration',columns:16,rows:8,climatePlanning:true,targetPopulation:30000,settlementCount:0}),m=publishPlanet(world,dir),url=pathToFileURL(path.join(dir,'manifest.json'));assert.ok(m.settlementCatalogue.totals.placed>32);
 const planner=createSettlementRegionPlanner(world);for(const d of m.settlementCatalogue.regions){const saved=JSON.parse(fs.readFileSync(path.join(dir,d.path),'utf8'));assert.deepEqual(planner.plan(d.cellIndex),saved);assert.deepEqual(planner.plan(d.cellIndex),saved);}assert.throws(()=>planner.plan(-1),/region/);assert.throws(()=>planner.plan(128),/region/);
 const saved=restorePlanetWorld(JSON.parse(fs.readFileSync(path.join(dir,m.planetSnapshot))));assert.equal(saved.settlementCatalogue.id,m.settlementCatalogue.id);
 const fetcher=async u=>{const b=fs.readFileSync(fileURLToPath(u));return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
 const p=m.settlementCatalogue.landmarks[0],source=new PagedSource(m,url,fetcher),bound={center:sphereBasis(p).up,angular:500/m.base.frame.radiusM};await source.prepareSettlements(bound);const d=source.descriptors().find(d=>d.site?.id===p.id);assert.ok(d);const r=await source.featureRecipe(d),core=createSettlementLayout(world.base,p);assert.deepEqual(r,core);const visual=source.descriptors().find(v=>v.visualOnly);assert.ok(visual);await source.enableFeatures(undefined,visual);assert.equal(source.featureCache.get(visual.path),null);
 await source.enableFeaturesAt(p);if(r.buildings.length){const b=r.buildings[0],chart=source.featureCache.get(d.path),q=chart.projection.toGeographic((b.bounds.minXM+b.bounds.maxXM)/2,(b.bounds.minYM+b.bounds.maxYM)/2);const s=await source.ready(()=>source.sample(q.latDeg,q.lonDeg));assert.equal(s.buildingId,b.id);assert.equal(s.groundElevationM,b.baseElevationM);}
 source.featureCache.clear();source.settlementPages.cache.clear();await source.prepareSettlements(bound);assert.deepEqual(await source.featureRecipe(d),r);assert.ok(source.settlementPages.cache.bytes<=2*1024*1024);
 const descriptor=m.settlementCatalogue.regions[0];fs.writeFileSync(path.join(dir,descriptor.path),'{}');source.settlementPages.cache.clear();await assert.rejects(()=>source.settlementPages.near({center:descriptor.center,angular:.001}),/Corrupt/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('existing-world upgrade rejects external paths and symlink escapes',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'settlement-upgrade-'));try{fs.mkdirSync(path.join(root,'examples/planet/a'),{recursive:true});fs.writeFileSync(path.join(root,'outside.json'),'{}');fs.symlinkSync(path.join(root,'outside.json'),path.join(root,'examples/planet/a/manifest.json'));assert.throws(()=>populationUpgradeRequest(root,'/examples/planet/a/manifest.json'),/outside/);for(const s of ['/etc/passwd','/examples/planet/../../../manifest.json','https://evil.test/manifest.json'])assert.throws(()=>populationUpgradeRequest(root,s));}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('bounded alternative siting finds nearby dry land without shifting other slots',()=>{
 const first=sitePopulationRegion(base,population,65,{maxCandidateSurveys:1}),origin=first.sites[0];
 const nearOrigin=(lat,lon)=>greatCircle(origin,{latDeg:lat,lonDeg:lon},base.frame.radiusM).distanceM<200;
 const obstructed={...base,sampleSurfaceAt:(lat,lon)=>({groundElevationM:20,waterDepthM:nearOrigin(lat,lon)?3:0,waterLevelElevationM:0})};
 const single=sitePopulationRegion(obstructed,population,65,{maxCandidateSurveys:1}),searched=sitePopulationRegion(obstructed,population,65,{maxCandidateSurveys:8});
 assert.equal(single.sites.length,99);assert.equal(searched.sites.length,100);
 const relocated=searched.sites[0];assert.equal(relocated.id,origin.id);assert.ok(relocated.siting.candidateIndex>0);
 assert.ok(greatCircle(origin,relocated,base.frame.radiusM).distanceM<=1200.0001);
 assert.deepEqual(searched.sites.slice(1),first.sites.slice(1));assert.deepEqual(searched,sitePopulationRegion(obstructed,population,65,{maxCandidateSurveys:8}));
 assert.ok(searched.survey.candidateSurveys<=800);assert.equal(searched.survey.relocatedSites,1);
});
test('siting cannot spend an unbounded survey budget or relax the slope threshold',()=>{
 for(const n of [0,17,Infinity,1.5])assert.throws(()=>sitePopulationRegion(base,population,65,{maxCandidateSurveys:n}),/budget/);
 const steep={...base,groundElevationAt:()=>50};const r=sitePopulationRegion(steep,population,65);
 assert.equal(r.sites.length,0);assert.equal(r.rejected.slope,100);assert.ok(r.survey.candidateSurveys<=800);assert.equal(r.populations.unplaced,30000);
});
import {greatCircle} from '../src/core/spherical.mjs';

test('balanced water policy survives packaging and restoration without an alternate inspection planner',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'balanced-water-pages-'));
 try{
  const world=generatePlanet({seed:'balanced-page-contract',columns:16,rows:8,climatePlanning:true,targetPopulation:5000,settlementCount:0,riverDetail:'regional'}),manifest=publishPlanet(world,dir);
  assert.equal(manifest.settlementCatalogue.method,'river-access-siting@2');
  assert.equal(manifest.settlementCatalogue.waterSitingIndex.allocation,'cell-kind-stratified-identity-rank@1');
  const saved=restorePlanetWorld(JSON.parse(fs.readFileSync(path.join(dir,manifest.planetSnapshot)))),planner=createSettlementRegionPlanner(saved);
  assert.equal(saved.landscape.settlementSiting,'river-access-siting@2');
  for(const r of manifest.settlementCatalogue.regions){const region=JSON.parse(fs.readFileSync(path.join(dir,r.path)));assert.deepEqual(planner.plan(r.cellIndex),region);assert.equal(region.survey.method,'river-access-siting@2');}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
