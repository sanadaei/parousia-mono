import test from 'node:test';import assert from 'node:assert/strict';
import{searchRiverCorridor}from'../src/core/river-corridor-search.mjs';
const start={latDeg:0,lonDeg:0,waterLevelElevationM:10},end={latDeg:0,lonDeg:.1,waterLevelElevationM:0};
test('bounded corridor search detours around a rejected ridge without changing endpoint head',()=>{
 const transition=(a,b,level,final)=>{
   if(Math.min(a.lonDeg,b.lonDeg)<.052&&Math.max(a.lonDeg,b.lonDeg)>.048&&Math.abs((a.latDeg+b.latDeg)/2)<.01)return null;
   return{endLevelM:final?0:level,lengthM:Math.hypot(a.latDeg-b.latDeg,a.lonDeg-b.lonDeg)*174.5};
 };
 const result=searchRiverCorridor(start,end,10000,transition,{stepM:2});assert.equal(result.status,'routed');assert.deepEqual(result.path[0],{latDeg:0,lonDeg:0});assert.deepEqual(result.path.at(-1),{latDeg:0,lonDeg:.1});assert.ok(result.path.some(p=>Math.abs(p.latDeg)>=.01));assert.ok(result.visited<=4096);
 assert.deepEqual(result,searchRiverCorridor(start,end,10000,transition,{stepM:2}));
});
test('infeasible or invalid river corridors remain explicit',()=>{
 assert.equal(searchRiverCorridor(start,end,10000,()=>null).status,'no-feasible-path');
 assert.throws(()=>searchRiverCorridor(start,end,10000,()=>({endLevelM:20,lengthM:1})),/transition/);
 assert.throws(()=>searchRiverCorridor(start,end,10000,()=>null,{stepM:0}),/contract/);
});
