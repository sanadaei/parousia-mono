import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveClimateCatchments} from '../src/core/climate-catchments.mjs';
const input=()=>({downstream:[2,2,3,-1],cellAreaM2:[1000,2000,1000,1000],landMask:[1,1,1,0],monthlyPrecipitationMm:Array.from({length:12},()=>[200,0,0,0]),monthlyTemperatureC:Array.from({length:12},()=>[15,15,15,15])});
test('wet upstream supplies a locally dry receiver, weighted by real cell area',()=>{
 const i=input(),a=deriveClimateCatchments(i);assert.ok(a.annualLocalYieldMm[0]>0);assert.equal(a.annualLocalYieldMm[2],0);
 assert.ok(a.meanPotentialFlowM3PerSecond[2]>0);assert.equal(a.annualRoutedYieldM3[0],a.annualRoutedYieldM3[3]);
 assert.ok(Math.abs(a.diagnostics.balanceErrorM3)<1e-7);assert.deepEqual(a,deriveClimateCatchments(i));
 assert.deepEqual(a,JSON.parse(JSON.stringify(a)));assert.deepEqual(i,input());
});
test('arid climate reduces water on the same unchanged drainage graph',()=>{
 const i=input(),wet=deriveClimateCatchments(i);i.monthlyPrecipitationMm=i.monthlyPrecipitationMm.map(m=>m.map(()=>5));
 const dry=deriveClimateCatchments(i);assert.equal(dry.annualRoutedYieldM3[3],0);assert.ok(wet.annualRoutedYieldM3[3]>0);
});
test('seasonality and separate closed basins survive routing',()=>{
 const i=input();i.downstream=[-1,2,3,-1];i.monthlyPrecipitationMm=Array.from({length:12},(_,m)=>[m<3?400:0,0,0,0]);
 const a=deriveClimateCatchments(i);assert.ok(a.yieldMonths[0]>0&&a.yieldMonths[0]<12);assert.equal(a.annualRoutedYieldM3[3],0);
 assert.ok(Math.abs(a.diagnostics.balanceErrorM3)<1e-7);
});
test('area scaling and cold-region limitations are explicit',()=>{
 const i=input(),a=deriveClimateCatchments(i);i.cellAreaM2=i.cellAreaM2.map(v=>v*3);const b=deriveClimateCatchments(i);
 assert.ok(Math.abs(b.annualRoutedYieldM3[3]/a.annualRoutedYieldM3[3]-3)<1e-12);
 assert.ok(b.diagnostics.missing.includes('snow-energy-balance-and-glaciers'));
});
test('cycles and invalid inputs fail before processing',()=>{
 const i=input();assert.throws(()=>deriveClimateCatchments({...i,downstream:[2,2,0,-1]}),/Cyclic/);
 assert.throws(()=>deriveClimateCatchments({...i,cellAreaM2:[0,1,1,1]}));
 assert.throws(()=>deriveClimateCatchments(i,{spinupYears:100}));
 assert.throws(()=>deriveClimateCatchments({...i,monthlyTemperatureC:[[NaN]]}));
});

test('snow is stored in freezing months and released on warming without creating water',()=>{
 const i=input();i.monthlyTemperatureC=Array.from({length:12},()=>Array(4).fill(-5));
 const frozen=deriveClimateCatchments(i,{spinupYears:0});assert.equal(frozen.annualRoutedYieldM3[3],0);assert.ok(frozen.meanSnowWaterMm[0]>0);assert.ok(Math.abs(frozen.diagnostics.balanceErrorM3)<1e-7);
 i.monthlyTemperatureC=Array.from({length:12},(_,m)=>Array(4).fill(m<6?-5:10));
 const thaw=deriveClimateCatchments(i,{spinupYears:0});assert.ok(thaw.annualRoutedYieldM3[3]>0);assert.ok(thaw.yieldMonths[0]<=6);assert.ok(Math.abs(thaw.diagnostics.balanceErrorM3)<1e-7);
});

test('drainage identities stop at non-land receivers and preserve inland terminals',()=>{
 const i={downstream:[1,2,-1,-1],cellAreaM2:[1000,2000,3000,4000],landMask:[1,0,0,1],monthlyPrecipitationMm:Array.from({length:12},()=>[100,0,0,100]),monthlyTemperatureC:Array.from({length:12},()=>[10,10,10,10])};
 const d=deriveClimateCatchments(i).drainage;assert.deepEqual(d.terminalCell,[1,1,2,3]);assert.deepEqual(d.upstreamLandAreaM2,[1000,1000,0,4000]);assert.equal(d.terminalKind[0],'non-land-receiver');assert.equal(d.terminalKind[3],'inland-terminal');
 const a=deriveClimateCatchments(input()).drainage;assert.deepEqual(a.terminalCell,[3,3,3,3]);assert.deepEqual(a.upstreamLandAreaM2,[1000,2000,4000,4000]);
});

test('watershed and contributing-area maps use actual drainage metadata and reject absent data',async()=>{
 const {makeThematicMap}=await import('../src/globe/thematic-map.mjs');const c={id:'c',grid:{columns:4,rows:1},biome:['grassland','grassland','grassland','ocean'],annualMeanTemperatureC:[10,10,10,10],catchmentWater:deriveClimateCatchments({...input(),cellAreaM2:input().cellAreaM2.map(v=>v*1e6)})};
 const m=makeThematicMap(c,null,'watershed');assert.deepEqual([...m.rgba.slice(0,4)],[...m.rgba.slice(4,8)]);assert.notDeepEqual([...m.rgba.slice(0,4)],[...m.rgba.slice(12,16)]);const area=makeThematicMap(c,null,'upstream-area');assert.notDeepEqual([...area.rgba.slice(0,4)],[...area.rgba.slice(8,12)]);
 assert.throws(()=>makeThematicMap({...c,catchmentWater:{...c.catchmentWater,drainage:undefined}},null,'watershed'),/流域参照/);
});
