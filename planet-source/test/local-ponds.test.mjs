import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {surveyPondHollow,deriveRegionalPonds,createLocalPondSampler,LOCAL_PONDS_SCHEMA} from '../src/core/local-ponds.mjs';
import {createSphericalProjection,sphereBasis} from '../src/core/spherical.mjs';import{createPlanetWaterSampler,SEA_LEVEL_SCHEMA}from'../src/core/sea-level.mjs';
import {waterVisibilityUpperBound,uniformReservoir} from '../src/globe/water-visibility.mjs';
import {generatePlanet} from '../src/core/planet-generation.mjs';import{createGlobalTerrain}from'../src/core/global-terrain.mjs';import{packageGlobe}from'../scripts/package-globe.mjs';import{PagedSource}from'../src/globe/paged-source.mjs';
const radiusM=6371000,center={latDeg:20,lonDeg:179.9998},projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM,maxRadiusM:1000});
function fixture(height=(x,y)=>100+Math.min(3,(x*x+y*y)/900),wet=false){const sample=(lat,lon)=>{const p=projection.toLocal(lat,lon),z=height(p.xM,p.yM);return{groundElevationM:z,waterDepthM:wet?1:0,waterLevelElevationM:wet?z+1:0};};return{frame:{radiusM},sampleSurfaceAt:sample,groundElevationAt:(lat,lon)=>sample(lat,lon).groundElevationM};}
const base=fixture(),body=surveyPondHollow(base,center,{id:'hollow'}).body,model={schema:LOCAL_PONDS_SCHEMA,radiusM,bodies:[body]};
test('a surveyed natural hollow holds a partial horizontal surface without changing its ground',()=>{
 assert.ok(body);assert.ok(body.levelElevationM<body.spillLevelM);assert.ok(body.survey.minRimM>.15);assert.ok(body.survey.estimatedWetAreaM2>=128);assert.ok(body.survey.maxDepthM<=3);
 const sample=createLocalPondSampler(model),z=base.groundElevationAt(center.latDeg,center.lonDeg);assert.ok(sample(center.latDeg,center.lonDeg,z).waterDepthM>0);assert.equal(z,100);assert.deepEqual(body,surveyPondHollow(base,center,{id:'hollow'}).body);
 for(const [x,y]of[[128,0],[-128,0],[0,128],[0,-128],[250,0]]){const p=projection.toGeographic(x,y);assert.equal(sample(p.latDeg,p.lonDeg,base.groundElevationAt(p.latDeg,p.lonDeg)),null);}
});
test('pond survey rejects slopes, already wet terrain and unknown water instead of inventing water',()=>{
 assert.equal(surveyPondHollow(fixture((x,y)=>100+x*.03),center,{id:'slope'}).reason,'no-refined-hollow');
 assert.equal(surveyPondHollow(fixture(undefined,true),center,{id:'wet'}).reason,'existing-or-unknown-water');
 assert.equal(surveyPondHollow({...base,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:null})},center,{id:'unknown'}).reason,'existing-or-unknown-water');
 assert.throws(()=>surveyPondHollow(base,center,{id:'bad',fillFraction:1}));
});
test('regional pond generation is fixed, budgeted, climate-limited and leaves inputs untouched',()=>{
 const regions=[{id:'region',center,gridSize:17,cellSizeM:16}],climate={grid:{columns:16,rows:8},annualPrecipitationMm:Array(128).fill(1000),annualMeanTemperatureC:Array(128).fill(12)},saved=structuredClone({regions,climate});
 const a=deriveRegionalPonds(base,regions,climate,{maxPonds:1,maxCandidatesPerRegion:1});assert.equal(a.bodies.length,1);assert.deepEqual(a,deriveRegionalPonds(base,regions,climate,{maxPonds:1,maxCandidatesPerRegion:1}));assert.deepEqual({regions,climate},saved);
 assert.equal(deriveRegionalPonds(base,regions,climate,{maxPonds:0}).bodies.length,0);
 const dry=deriveRegionalPonds(base,regions,{...climate,annualPrecipitationMm:Array(128).fill(100)});assert.equal(dry.bodies.length,0);assert.equal(dry.diagnostics.coarseSamples,0);assert.equal(dry.diagnostics.rejections['dry-or-frozen-climate-scenario'],1);
 assert.throws(()=>deriveRegionalPonds(base,regions,climate,{maxPonds:10000}));
});
test('pond sampling preserves wet reservoir priority, date-line continuity and old no-pond behavior',()=>{
 const sea={schema:SEA_LEVEL_SCHEMA,id:'sea',levelElevationM:0,verticalDatum:'datum'},old=createPlanetWaterSampler(sea,[],{columns:16,rows:8}),next=createPlanetWaterSampler(sea,[],{columns:16,rows:8},model);
 assert.equal(next(center.latDeg,center.lonDeg,100).surfaceKind,'natural-hollow-pond');assert.deepEqual(next(0,0,-3),old(0,0,-3));
 const high=createPlanetWaterSampler({...sea,levelElevationM:110},[],{columns:16,rows:8},model);assert.equal(high(center.latDeg,center.lonDeg,100).waterLevelElevationM,110);
 const p=projection.toGeographic(40,0),a=next(p.latDeg,p.lonDeg,base.groundElevationAt(p.latDeg,p.lonDeg));assert.ok(a.waterDepthM>0);assert.deepEqual(a,next(p.latDeg,p.lonDeg+360,base.groundElevationAt(p.latDeg,p.lonDeg)));
 assert.throws(()=>createLocalPondSampler({...model,bodies:[body,body]}),/body/);assert.throws(()=>createLocalPondSampler({...model,bodies:[{...body,levelElevationM:body.spillLevelM}]}),/body/);
});
test('local pond surfaces remain in visibility bounds and disable unsupported constant-sea proofs',()=>{
 const manifest={base:{grid:{columns:16,rows:8},frame:{radiusM}},sea:{id:'sea',levelElevationM:0},localPonds:model},bound={center:sphereBasis(center).up,angular:.00001};
 assert.equal(waterVisibilityUpperBound(manifest,bound),body.levelElevationM);assert.equal(uniformReservoir(manifest,bound,-10),null);
 assert.equal(waterVisibilityUpperBound(manifest,{center:[1,0,0],angular:0}),0);
});
test('saved local water is identical in resident and paged terrain and changes no ground heights',async()=>{
 const source=generatePlanet({columns:16,rows:8,settlementCount:0,localLandforms:false}),original=source.base.toSnapshot(),state=structuredClone(original),g=source.base.groundElevationAt(center.latDeg,center.lonDeg),level=Math.max(0,g)+2;
 delete state.worldId;delete state.sourceWorldId;state.references.localPonds={...model,bodies:[{...body,levelElevationM:level,spillLevelM:level+1}]};
 const next=createGlobalTerrain(state),dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-pond-pages-'));
 try{const manifest=packageGlobe(next,dir),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};},paged=new PagedSource(manifest,pathToFileURL(path.join(dir,'manifest.json')).href,fetcher);
 for(const [x,y]of[[0,0],[40,0],[-30,20],[300,0]]){const p=projection.toGeographic(x,y),a=next.sampleSurfaceAt(p.latDeg,p.lonDeg),b=await paged.ready(()=>paged.sample(p.latDeg,p.lonDeg));assert.equal(a.groundElevationM,source.base.groundElevationAt(p.latDeg,p.lonDeg));assert.equal(a.waterDepthM,b.waterDepthM);assert.deepEqual(a.waterSourceIds,b.waterSourceIds);}
 assert.deepEqual(source.base.toSnapshot(),original);assert.notEqual(next.worldId,source.base.worldId);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('wet-season pond margins are dry, spatially bounded and available to vegetation and field selection',async()=>{
 const {createRegionalLandscape,LANDSCAPE_PROFILE}=await import('../src/core/regional-landscape.mjs'),sample=createLocalPondSampler(model),p=projection.toGeographic(46,0),ground=base.groundElevationAt(p.latDeg,p.lonDeg),s=sample(p.latDeg,p.lonDeg,ground);
 assert.ok(s);assert.equal(s.surfaceKind,'seasonal-pond-margin');assert.equal(s.waterDepthM,0);assert.equal(s.waterSurfaceElevationM,null);assert.deepEqual(s.waterSourceIds,[]);assert.deepEqual(s.waterContextIds,['hollow']);
 const config={profile:LANDSCAPE_PROFILE,seed:'margin',grid:{columns:16,rows:8},biome:Array(128).fill('temperate_forest'),temperatureC:Array(128).fill(15),baseElevationM:Array(128).fill(100)};
 assert.equal(createRegionalLandscape(config,radiusM).sample(p,{...s,groundElevationM:ground}).kind,'wet_meadow');
 const far=projection.toGeographic(90,0);assert.equal(sample(far.latDeg,far.lonDeg,base.groundElevationAt(far.latDeg,far.lonDeg)),null);
});
test('houses, road vertices and farm triangles use the same pond water instead of building through it',async()=>{
 const {createSettlementLayout}=await import('../src/core/settlement-layout.mjs'),{createWoodlandRecipe,landscapeTileGrid,LANDSCAPE_PROFILE}=await import('../src/core/regional-landscape.mjs');
 const pond=createLocalPondSampler(model),wetBase={...base,worldId:'explicit-pond-fixture',sampleSurfaceAt:(lat,lon)=>{const s=base.sampleSurfaceAt(lat,lon);return{...s,...pond(lat,lon,s.groundElevationM)};}},context={layoutPolicy:'terrain-led-neighborhood@2',streetPolicy:'terrain-led-branches@2',residentialStreetPolicy:'surveyed-residential-catchments@1',householdFrontagePolicy:'surveyed-household-frontages@2',housingInfillPolicy:'surveyed-residential-infill@2',roadPadClearance:'surveyed-frontage-pads@1',agricultureSuitability:1,netGrainKgPerHa:250};
 const site={id:'synthetic-pond-village',kind:'village',population:100,...center,economicContext:context},recipe=createSettlementLayout(wetBase,site),rp=createSphericalProjection(recipe.projection),dry=(p)=>wetBase.sampleSurfaceAt(p.latDeg,p.lonDeg).waterDepthM===0;
 assert.ok(recipe.buildings.length>0);assert.ok(recipe.roadCenterlineProfiles.length>0);
 for(const b of recipe.buildings)for(let y=b.bounds.minYM;y<=b.bounds.maxYM;y+=2)for(let x=b.bounds.minXM;x<=b.bounds.maxXM;x+=2)assert.ok(dry(rp.toGeographic(x,y)));
 for(const road of recipe.roadCenterlineProfiles)for(const p of road.samples)assert.ok(dry(rp.toGeographic(p.xM,p.yM)));
 const far={...site,id:'synthetic-field-owner',...projection.toGeographic(600,0)},config={profile:LANDSCAPE_PROFILE,seed:'pond-fields',fieldSurvey:'local-triangle-clearance@1',fieldPattern:'surveyed-furlongs@2',grid:{columns:16,rows:8},biome:Array(128).fill('temperate_forest'),temperatureC:Array(128).fill(15),baseElevationM:Array(128).fill(100)},tile=landscapeTileGrid(radiusM).at(center.latDeg,center.lonDeg),fields=createWoodlandRecipe(wetBase,config,tile,{nearbySettlements:[far]}),fp=createSphericalProjection(fields.projection);
 assert.ok(fields.landParcels.length>0);for(const parcel of fields.landParcels)for(const t of parcel.triangles){for(const p of t)assert.ok(dry(fp.toGeographic(p.xM,p.yM)));assert.ok(dry(fp.toGeographic(t.reduce((s,p)=>s+p.xM,0)/3,t.reduce((s,p)=>s+p.yM,0)/3)));}
});
