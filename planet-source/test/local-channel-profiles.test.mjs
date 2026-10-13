import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeLocalDrainage} from '../src/core/local-drainage.mjs';
import {compileLocalChannels} from '../src/core/local-channel-profiles.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
import {createSphericalRiverSampler} from '../src/core/planet-rivers.mjs';
const projection=createSphericalProjection({centerLatDeg:20,centerLonDeg:30,radiusM:6371000,maxRadiusM:1000});
const ground=(lat,lon)=>{const {xM,yM}=projection.toLocal(lat,lon);return Math.max(Math.abs(xM),Math.abs(yM))/50;};
const elevation=Array.from({length:121},(_,i)=>{const x=i%11,y=Math.floor(i/11);return x===0||y===0||x===10||y===10?0:Math.max(Math.abs(x-5),Math.abs(y-5));});
const analysis=analyzeLocalDrainage({columns:11,rows:11,cellSizeM:50,elevation,outlets:[{cell:60,id:'river',kind:'river',levelM:0}],minChannelAreaM2:5000});
const input={id:'fixed-region',analysis,projection,sampleSurface:(lat,lon)=>({groundElevationM:ground(lat,lon),waterDepthM:0})};
test('trial channels retain deterministic IDs and physically sampleable downhill shared nodes',()=>{
 const n=compileLocalChannels(input);assert.ok(n.profiles.length>0);assert.deepEqual(n,compileLocalChannels(input));const sample=createSphericalRiverSampler(n);
 for(const p of n.profiles){for(let i=0;i<p.points.length;i++){const q=p.points[i];if(i)assert.ok(q.waterLevelElevationM<=p.points[i-1].waterLevelElevationM+1e-8);const g=ground(q.latDeg,q.lonDeg),s=sample(q.latDeg,q.lonDeg,g);assert.ok(s.waterDepthM>0);assert.ok(g-s.groundElevationM<=2+1e-8);}}
});
test('insufficient work budget rejects whole catchments, with no orphan nodes',()=>{
 const n=compileLocalChannels({...input,maxPoints:2});assert.equal(n.profiles.length,0);assert.equal(n.nodes.length,0);assert.ok(n.diagnostics.rejected.some(r=>r.reason==='profile-work-budget'));
});
test('unknown water and incompatible incision intervals remain rejected',()=>{
 for(const extra of [{sampleSurface:()=>({groundElevationM:0,waterDepthM:null})},{maxIncisionM:.1}]){const n=compileLocalChannels({...input,...extra});assert.equal(n.profiles.length,0);assert.ok(n.diagnostics.rejected.length>0);}
});

test('local streams require local climate yield even beside a wet receiving river',()=>{
 const dry=compileLocalChannels({...input,climateSupply:{sourceId:'dry',annualLocalYieldMm:0,minimumFlowM3PerSecond:.001}});
 assert.equal(dry.profiles.length,0);assert.ok(dry.diagnostics.rejected.some(r=>r.reason==='insufficient-local-climate-yield'));
 const wet=compileLocalChannels({...input,climateSupply:{sourceId:'wet',annualLocalYieldMm:1200,minimumFlowM3PerSecond:.0001}});
 assert.ok(wet.profiles.length>0);assert.ok(wet.profiles.every(p=>p.climateSupply.meanPotentialFlowM3PerSecond>=.0001));
 assert.deepEqual(wet,compileLocalChannels({...input,climateSupply:{sourceId:'wet',annualLocalYieldMm:1200,minimumFlowM3PerSecond:.0001}}));
 assert.throws(()=>compileLocalChannels({...input,climateSupply:{sourceId:'bad',annualLocalYieldMm:-1,minimumFlowM3PerSecond:.001}}),/climate supply/);
});
