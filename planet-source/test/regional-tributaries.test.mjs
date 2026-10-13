import test from 'node:test';import assert from 'node:assert/strict';
import {deriveRegionalTributaries} from '../src/core/regional-tributaries.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED} from '../src/core/planet-rivers.mjs';
import {parsePlanetArguments} from '../scripts/generate-planet.mjs';
const radiusM=6371000,p=createSphericalProjection({centerLatDeg:20,centerLonDeg:30,radiusM,maxRadiusM:1000});
function fixture(){const a=p.toGeographic(0,-10),b=p.toGeographic(0,10),network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM,grid:{columns:128,rows:64},nodes:[{id:'a',...a,waterLevelElevationM:0},{id:'b',...b,waterLevelElevationM:0}],profiles:[{id:'river',from:'a',to:'b',points:[a,b].map(g=>({...g,waterLevelElevationM:0,halfWidthM:2,depthM:1,bankWidthM:2}))}],diagnostics:{maxIncisionM:2}};const base={frame:{radiusM},sampleSurfaceAt:(lat,lon)=>{const q=p.toLocal(lat,lon),d=Math.hypot(q.xM,q.yM-10),wet=d<1;return{groundElevationM:wet?-1:Math.max(Math.abs(q.xM),Math.abs(q.yM-10))>240?0:d/50,waterDepthM:wet?1:0,waterLevelElevationM:wet?0:null,waterSourceIds:wet?['river']:[],surfaceKind:wet?'river':'land'};}};return{base,network};}
test('fixed regional tributaries are reproducible, budgeted and retain original profiles',()=>{const {base,network}=fixture(),options={gridSize:11,cellSizeM:50,minChannelAreaM2:5000};const result=deriveRegionalTributaries(base,network,options);assert.deepEqual(result,deriveRegionalTributaries(base,network,options));assert.deepEqual(result.profiles[0],network.profiles[0]);assert.equal(result.diagnostics.localTributaries.regions.length,1);assert.ok(result.profiles.length>1);assert.ok(result.diagnostics.pointCount<=32768);assert.equal(JSON.stringify(network).includes('localTributaries'),false);});
test('no regional budget means explicit partial coverage without moving original water',()=>{const {base,network}=fixture(),out=deriveRegionalTributaries(base,network,{maxRegions:0});assert.deepEqual(out.profiles,network.profiles);assert.equal(out.diagnostics.localTributaries.withheld[0].reason,'regional-work-budget');assert.throws(()=>deriveRegionalTributaries(base,network,{gridSize:10000}),/budget/);});
test('local tributaries require explicit new-world generation flag',()=>{assert.equal(parsePlanetArguments(['a','--local-tributaries']).localTributaries,true);assert.equal(parsePlanetArguments(['a']).localTributaries,undefined);assert.throws(()=>parsePlanetArguments(['--local-tributaries','--local-tributaries']),/Duplicate/);});

test('regional river detail is explicit, validated and independent from local tributary compilation',()=>{
 assert.equal(parsePlanetArguments(['a','--river-detail=regional']).riverDetail,'regional');
 assert.equal(parsePlanetArguments(['a']).riverDetail,undefined);
 assert.throws(()=>parsePlanetArguments(['--river-detail=unknown']),/river-detail/);
 assert.throws(()=>parsePlanetArguments(['--river-detail=regional','--river-detail=major']),/Duplicate/);
});

test('regional tributaries interpolate declared climate without altering receiving profiles',()=>{
 const {base,network}=fixture(),options={gridSize:11,cellSizeM:50,minChannelAreaM2:5000};
 const climate=yieldMm=>({catchmentWater:{id:`water-${yieldMm}`,annualLocalYieldMm:Array(128*64).fill(yieldMm)}});
 const dry=deriveRegionalTributaries(base,network,{...options,climate:climate(0)});
 assert.equal(dry.profiles.length,1);assert.deepEqual(dry.profiles[0],network.profiles[0]);
 const wet=deriveRegionalTributaries(base,network,{...options,climate:climate(1200),minimumFlowM3PerSecond:.0001});
 assert.ok(wet.profiles.length>1);assert.equal(wet.profiles[1].climateSupply.sourceId,'water-1200');
 assert.throws(()=>deriveRegionalTributaries(base,network,{...options,climate:{}}),/yield field/);
});

test('nested survey scales preserve earlier profiles and record distinct persistent identities',()=>{
 const {base,network}=fixture(),o={gridSize:11,cellSizeM:50,minChannelAreaM2:5000};
 const first=deriveRegionalTributaries(base,network,{...o,scaleId:'regional'});
 const second=deriveRegionalTributaries(base,first,{...o,scaleId:'local',parentProfileIds:['river']});
 assert.deepEqual(second.profiles.slice(0,first.profiles.length),first.profiles);
 assert.equal(second.diagnostics.localTributaries.stages.length,2);assert.equal(second.diagnostics.localTributaries.regions.length,2);
 assert.equal(new Set(second.profiles.map(p=>p.id)).size,second.profiles.length);
 assert.throws(()=>deriveRegionalTributaries(base,network,{...o,parentProfileIds:['missing']}),/selection/);
});

test('explicit river references have distinct plan IDs while legacy midpoint output is unchanged',()=>{
 const {base,network}=fixture(),o={gridSize:11,cellSizeM:50,minChannelAreaM2:5000};
 const legacy=deriveRegionalTributaries(base,network,o),referenced=deriveRegionalTributaries(base,network,{...o,parentProfileIds:['river'],referencePoints:[{parentId:'river',pointIndex:1}]});
 assert.deepEqual(referenced.profiles[0],network.profiles[0]);assert.equal(referenced.profiles.length,legacy.profiles.length);assert.ok(referenced.profiles.slice(1).every(p=>p.id.includes('/point:1/')));
 assert.throws(()=>deriveRegionalTributaries(base,network,{...o,referencePoints:[{parentId:'river',pointIndex:2}]}),/reference points/);
});
