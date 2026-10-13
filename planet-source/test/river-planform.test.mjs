import test from 'node:test';import assert from 'node:assert/strict';
import {channelPlanform} from '../src/core/river-planform.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
const R=6371000,projection=createSphericalProjection({centerLatDeg:20,centerLonDeg:30,radiusM:R,maxRadiusM:30000});
const points=Array.from({length:21},(_,i)=>({...projection.toGeographic(i*1000-10000,0),waterLevelElevationM:20-i,halfWidthM:50,depthM:2,bankWidthM:100})),profile={id:'fixed-river',points};
const surface=(lat,lon)=>({groundElevationM:10-projection.toLocal(lat,lon).xM*.001,waterDepthM:0});
test('low-gradient curves keep endpoints and stable geography with width-scaled spacing',()=>{
 const r=channelPlanform(profile,R,{sampleSurface:surface});assert.equal(r.status,'candidate');assert.deepEqual(r.path[0],points[0]);assert.deepEqual(r.path.at(-1),points.at(-1));assert.equal(r.wavelengthM,1000);assert.ok(r.maxOffsetM>50&&r.maxOffsetM<=80);assert.deepEqual(r,channelPlanform(profile,R,{sampleSurface:surface}));assert.equal(profile.points,points);
});
test('steep narrow confined and over-budget rivers do not receive decorative bends',()=>{
 assert.equal(channelPlanform({...profile,points:points.map((p,i)=>({...p,waterLevelElevationM:1000-i*40}))},R,{sampleSurface:surface}).status,'confined-or-short-reach');
 assert.equal(channelPlanform({...profile,points:points.map(p=>({...p,halfWidthM:2}))},R,{sampleSurface:surface}).status,'confined-or-short-reach');
 assert.equal(channelPlanform(profile,R,{sampleSurface:surface,maxPoints:8}).status,'point-budget');
 const confined=(lat,lon)=>({...surface(lat,lon),groundElevationM:surface(lat,lon).groundElevationM+Math.abs(projection.toLocal(lat,lon).yM)});
 assert.equal(channelPlanform(profile,R,{sampleSurface:confined}).status,'confining-terrain');
 assert.equal(channelPlanform(profile,R,{sampleSurface:()=>({groundElevationM:NaN,waterDepthM:0})}).status,'unknown-terrain-or-water');
 assert.throws(()=>channelPlanform(profile,0,{sampleSurface:surface}),/planform/);
});

import {applyLowGradientPlanforms} from '../src/core/terrain-river-routes.mjs';
import {PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED,createSphericalRiverSampler} from '../src/core/planet-rivers.mjs';
test('accepted planform is installed into the shared physical river network before land use',()=>{
 const network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM:R,grid:{columns:128,rows:64},nodes:[{id:'a',...points[0]},{id:'b',...points.at(-1)}],profiles:[{...profile,from:'a',to:'b',lengthM:20000}],diagnostics:{maxIncisionM:100,valleySideRunPerRise:3}},base={toSnapshot:()=>({references:{}}),sampleSurfaceAt:surface};
 const result=applyLowGradientPlanforms(base,network);assert.equal(result.diagnostics.channelPlanforms.adopted,1,JSON.stringify(result.diagnostics));assert.deepEqual(result.nodes,network.nodes);assert.equal(result.profiles[0].routing.method,'low-gradient-width-scaled-planform@1');const sampler=createSphericalRiverSampler(result),p=result.profiles[0].points[40];assert.ok(sampler(p.latDeg,p.lonDeg,surface(p.latDeg,p.lonDeg).groundElevationM).waterDepthM>0);
 assert.deepEqual(result,applyLowGradientPlanforms(base,network));assert.equal(network.profiles[0].routing,undefined);
});

test('local confinement retains bends away from a short obstructed section',()=>{
 const obstacle=(lat,lon)=>{const q=projection.toLocal(lat,lon);return{...surface(lat,lon),groundElevationM:surface(lat,lon).groundElevationM+(Math.abs(q.xM)<1000?Math.abs(q.yM):0)}};
 assert.equal(channelPlanform(profile,R,{sampleSurface:obstacle}).status,'confining-terrain');
 const r=channelPlanform(profile,R,{sampleSurface:obstacle,confinement:'local-taper@2'});
 assert.equal(r.status,'candidate');assert.ok(r.confinedSamples>0);assert.ok(r.maxOffsetM>50);assert.equal(r.endpointTransitionM,300);assert.deepEqual(r.path[0],points[0]);assert.deepEqual(r.path.at(-1),points.at(-1));
 for(const p of r.path){const q=projection.toLocal(p.latDeg,p.lonDeg);if(Math.abs(q.xM)<1000)assert.ok(Math.abs(q.yM)<10.001);}
 assert.deepEqual(r,channelPlanform(profile,R,{sampleSurface:obstacle,confinement:'local-taper@2'}));
 assert.throws(()=>channelPlanform(profile,R,{sampleSurface:surface,confinement:'bad'}),/confinement/);
});

test('local planform integration retains profile fitting and shared endpoint contracts',()=>{
 const network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM:R,grid:{columns:128,rows:64},nodes:[{id:'a',...points[0]},{id:'b',...points.at(-1)}],profiles:[{...profile,from:'a',to:'b',lengthM:20000}],diagnostics:{maxIncisionM:100,valleySideRunPerRise:3}},base={toSnapshot:()=>({references:{}}),sampleSurfaceAt:surface};
 const r=applyLowGradientPlanforms(base,network,{confinement:'local-taper@2'});
 assert.equal(r.diagnostics.channelPlanforms.adopted,1,JSON.stringify(r.diagnostics));assert.equal(r.profiles[0].routing.method,'locally-confined-width-scaled-planform@2');assert.deepEqual(r.nodes,network.nodes);
 const sample=createSphericalRiverSampler(r),p=r.profiles[0].points[40];assert.ok(sample(p.latDeg,p.lonDeg,surface(p.latDeg,p.lonDeg).groundElevationM).waterDepthM>0);
 assert.throws(()=>applyLowGradientPlanforms(base,network,{confinement:'bad'}),/confinement/);
});
