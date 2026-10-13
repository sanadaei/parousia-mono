import test from'node:test';import assert from'node:assert/strict';import{saveView,validateView}from'../src/globe/view-state.mjs';
const state={point:{latDeg:35,lonDeg:540},altitude:350,tilt:.5,heading:1};
test('camera save is world-bound, finite and isolated from later motion',()=>{const saved=saveView('world-1',state);assert.equal(saved.point.lonDeg,-180);assert.deepEqual(validateView(JSON.stringify(saved),'world-1'),saved);assert.throws(()=>validateView(saved,'world-2'));const changed={...saved,altitude:NaN};assert.throws(()=>validateView(changed,'world-1'));assert.equal(state.point.lonDeg,540);});

import {groundDisplaySummary} from '../src/globe/view-state.mjs';
test('ground status distinguishes actual displayed precision, pending work and fixed budget',()=>{
 const ready={displayedQuality:{unknownGroundTiles:0,groundOverTargetTiles:0,maxGroundErrorPixels:1.99}};
 assert.match(groundDisplaySummary(ready),/準備/);
 assert.match(groundDisplaySummary(ready,{drawTiles:10,software:true}),/診断解像度/);
 assert.match(groundDisplaySummary(ready,{drawTiles:10}),/到達/);
 const coarse={...ready,displayedQuality:{unknownGroundTiles:0,groundOverTargetTiles:1,maxGroundErrorPixels:3}};
 assert.match(groundDisplaySummary({...coarse,activeWorkers:2},{drawTiles:10}),/読み込/);
 assert.match(groundDisplaySummary({...coarse,lodQuality:{budgetLimited:true}},{drawTiles:10}),/表示予算/);
 assert.match(groundDisplaySummary(coarse,{drawTiles:10}),/未到達/);
 assert.match(groundDisplaySummary({...ready,displayedQuality:{...ready.displayedQuality,maxGroundErrorPixels:null}},{drawTiles:10}),/未到達/);
 assert.match(groundDisplaySummary({...ready,workerRecovery:[{ready:false,failures:1}]},{drawTiles:10}),/再試行/);
});

test('a water-only view cannot pass its status using zero visible ground errors',()=>{
 const q={unknownGroundTiles:0,groundOverTargetTiles:0,maxGroundErrorPixels:0,submergedGroundTiles:2,constantWaterOverTargetTiles:1,maxConstantWaterErrorPixels:3};
 assert.match(groundDisplaySummary({displayedQuality:q},{drawTiles:2}),/未到達/);
 assert.match(groundDisplaySummary({displayedQuality:{...q,constantWaterOverTargetTiles:0,maxConstantWaterErrorPixels:1}},{drawTiles:2}),/一様な水面.*到達/);
});
import {createOrbitCamera} from '../src/globe/view-state.mjs';import {sphereBasis} from '../src/core/spherical.mjs';
test('oblique orbit keeps radial up above the target and foreground below it at every heading',()=>{const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);for(const point of [{latDeg:0,lonDeg:0},{latDeg:70,lonDeg:170},{latDeg:-45,lonDeg:-179}])for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const state={point,ground:1000,altitude:500,tilt:70*Math.PI/180,heading},r=createOrbitCamera(state,{radiusM:6371000}),basis=sphereBasis(point),horizontal=basis.north.map((v,i)=>v*Math.cos(heading)+basis.east[i]*Math.sin(heading));assert.ok(dot(r.up,basis.up)>.9);assert.ok(dot(r.up,horizontal)>0);const foreground=horizontal.map(v=>-v);assert.ok(dot(r.up,foreground)<0);assert.ok(Math.abs(dot(r.right,r.up))<1e-12);assert.ok(Math.abs(dot(r.forward,r.up))<1e-12);}});
test('untilted orbit remains north-up and has the original radial camera distance',()=>{const state={point:{latDeg:35,lonDeg:135},ground:200,altitude:1000,tilt:0,heading:0},r=createOrbitCamera(state,{radiusM:6371000}),basis=sphereBasis(state.point),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);assert.ok(dot(r.up,basis.north)>.999999);assert.ok(dot(r.right,basis.east)>.999999);assert.ok(Math.abs(Math.hypot(...r.eye)-6372200)<1e-7);});

test('budget-limited detail stays explicit while background planning or uploads continue',()=>{
 const coarse={displayedQuality:{unknownGroundTiles:0,groundOverTargetTiles:121,maxGroundErrorPixels:17.53},lodQuality:{budgetLimited:true}};
 for(const pending of [{planningQueued:true},{planningActive:true},{activeWorkers:2},{pendingUploads:1}]){const message=groundDisplaySummary({...coarse,...pending},{drawTiles:121,software:true});assert.match(message,/表示予算/);assert.match(message,/予算内.*読み込み中/);assert.doesNotMatch(message,/目標の細かさに到達/);}
 assert.doesNotMatch(groundDisplaySummary(coarse,{drawTiles:121}),/読み込み中/);
});
