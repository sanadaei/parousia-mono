import test from 'node:test';import assert from 'node:assert/strict';
import {generateClimate} from '../src/core/planet-climate.mjs';
import {makeThematicMap} from '../src/globe/thematic-map.mjs';
import {createRegionalLandscape,LANDSCAPE_PROFILE} from '../src/core/regional-landscape.mjs';
import {ENVIRONMENT_POLICY,climateTravelResistance} from '../src/core/environment-cover.mjs';
import {planRegionalRoadNetwork} from '../src/core/regional-road-network.mjs';
const n=128,fixture=()=>({worldId:'test',grid:{columns:16,rows:8},frame:{radiusM:6371000},fields:{groundElevationM:Array(n).fill(100),landMask:Array.from({length:n},(_,i)=>i%16<4?0:1),lakeFillDepthM:Array(n).fill(0),downstream:Array.from({length:n},(_,i)=>i%16<4?-1:i-1)},references:{sea:{levelElevationM:0},lakes:[]}});
test('saved climate connects drainage, environmental maps and route resistance',()=>{
 const s=fixture(),c=generateClimate(s);assert.ok(c.catchmentWater);assert.ok(Math.abs(c.catchmentWater.diagnostics.balanceErrorM3)/c.catchmentWater.diagnostics.precipitationM3<1e-12);
 for(const mode of ['soil-moisture','water-supply','environment']){const map=makeThematicMap(c,null,mode);assert.equal(map.rgba.length,n*4);assert.deepEqual(map,makeThematicMap(JSON.parse(JSON.stringify(c)),null,mode));}
 assert.equal(climateTravelResistance(c).length,n);
 const legacy={...c};delete legacy.catchmentWater;assert.throws(()=>makeThematicMap(legacy,null,'water-supply'));assert.ok(makeThematicMap(legacy,null,'biome'));
});
test('actual regional sampler uses nearby channel and retains old worlds without opt-in',()=>{
 const config={profile:LANDSCAPE_PROFILE,environmentPolicy:ENVIRONMENT_POLICY,seed:'env',grid:{columns:16,rows:8},biome:Array(n).fill('desert'),temperatureC:Array(n).fill(25),baseElevationM:Array(n).fill(100),annualRainMm:Array(n).fill(80),soilMoisture:Array(n).fill(0)};
 const sample=createRegionalLandscape(config,6371000),p={latDeg:20,lonDeg:30},ground={groundElevationM:100,waterDepthM:0,slopeMPerM:.1};
 assert.equal(sample.sample(p,ground).environment.kind,'desert');
 assert.equal(sample.sample(p,{...ground,riverEnvironment:{bankDistanceM:10,waterLevelElevationM:99}}).environment.kind,'riparian_woodland');
 assert.equal(sample.sample(p,{...ground,riverEnvironment:{bankDistanceM:10,waterLevelElevationM:0}}).environment.kind,'desert');
});
test('road planning avoids expensive cover without moving settlement roots',()=>{
 const s=fixture();s.fields.landMask.fill(1);const sites=[{id:'a',latDeg:11.25,lonDeg:123.75},{id:'b',latDeg:11.25,lonDeg:213.75}],cost=Array(n).fill(1);for(let x=6;x<=8;x++)cost[3*16+x]=20;
 const old=planRegionalRoadNetwork(s,sites),a=planRegionalRoadNetwork(s,sites,{travelResistance:cost});assert.equal(a.links.length,1);assert.notDeepEqual(a.links[0].points,old.links[0].points);assert.deepEqual(a.links[0].fromPoint,old.links[0].fromPoint);assert.deepEqual(a.links[0].toPoint,old.links[0].toPoint);assert.deepEqual(a,planRegionalRoadNetwork(s,sites,{travelResistance:cost}));
 assert.throws(()=>planRegionalRoadNetwork(s,sites,{travelResistance:[NaN]}));
});
import {routeLocalRoad} from '../src/core/local-road-route.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
test('local route can detour around a wetland cost without treating it as water or moving terrain',()=>{
 const radiusM=6371000,p=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM,maxRadiusM:5000}),base={frame:{radiusM},groundElevationAt:()=>100,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0})},link={id:'r',from:'a',to:'b',fromPoint:p.toGeographic(0,0),toPoint:p.toGeographic(800,0),distanceM:800};
 const cost=point=>{const q=p.toLocal(point.latDeg,point.lonDeg);return q.xM>200&&q.xM<600&&Math.abs(q.yM)<100?8:1;};
 const normal=routeLocalRoad(base,link),route=routeLocalRoad(base,link,{cells:33,environmentCostAt:cost});
 assert.equal(normal.survey.method,'direct-ground-survey');assert.equal(route.status,'surveyed-local-route');assert.equal(route.survey.environmentRouting,'sampled-cover-resistance@1');assert.ok(route.points.some(q=>Math.abs(p.toLocal(q.latDeg,q.lonDeg).yM)>100));assert.ok(route.points.every(q=>q.elevationM===100));
 assert.throws(()=>routeLocalRoad(base,link,{environmentCostAt:()=>NaN}));
});

import {VALLEY_ENVIRONMENT_POLICY} from '../src/core/environment-cover.mjs';
test('new production landscape excludes saved gentle valley floor from farming without moving the surface',()=>{
 const config={profile:LANDSCAPE_PROFILE,environmentPolicy:VALLEY_ENVIRONMENT_POLICY,seed:'env',grid:{columns:16,rows:8},biome:Array(n).fill('temperate_forest'),temperatureC:Array(n).fill(15),baseElevationM:Array(n).fill(100),annualRainMm:Array(n).fill(1000),soilMoisture:Array(n).fill(.6)},p={latDeg:20,lonDeg:30},ground={groundElevationM:100,waterDepthM:0,slopeMPerM:.01,riverEnvironment:{bankDistanceM:300,waterLevelElevationM:99,floodplainWidthM:400}};
 const sites=[{id:'valley-village',kind:'village',population:300,latDeg:20,lonDeg:30.008,economicContext:{agricultureSuitability:1}}],before=JSON.stringify(ground),a=createRegionalLandscape(config,6371000).sample(p,ground,{settlements:sites}),old=createRegionalLandscape({...config,environmentPolicy:ENVIRONMENT_POLICY},6371000).sample(p,ground,{settlements:sites});
 assert.equal(a.kind,'wet_meadow');assert.equal(a.environment.policy,VALLEY_ENVIRONMENT_POLICY);assert.equal(old.kind,'arable');assert.equal(JSON.stringify(ground),before);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generatePlanetPackage} from '../scripts/generate-planet.mjs';
test('normal package generation actually publishes valley sections and the new environmental policy',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'valley-environment-package-'));
 try{
  generatePlanetPackage({seed:'planet-1',directory,columns:32,rows:16,riverDetail:'regional',settlementCount:0,macroSettlementCount:0,targetPopulation:0});
  const world=JSON.parse(fs.readFileSync(path.join(directory,'world.snapshot.json'),'utf8')),manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  assert.equal(world.base.references.rivers.bedMethod,'c1-incision-alluvial-bench@3');assert.equal(world.base.references.environmentPolicy,VALLEY_ENVIRONMENT_POLICY);assert.equal(manifest.landscape.environmentPolicy,VALLEY_ENVIRONMENT_POLICY);
  assert.ok(world.base.references.rivers.profiles.length>0);assert.ok(world.base.references.rivers.profiles.some(p=>p.points.some(q=>q.floodplainWidthM>0)));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
