import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {mapSupportStorage,compileStorage,runoffWaterDepths} from '../src/core/runoff-storage.mjs';
import {createRunoffState,stepRunoff} from '../src/core/runoff-dynamics.mjs';
import {createPlanetRunoffScenario} from '../src/core/planet-runoff.mjs';
const grid={columns:2,rows:2,cellSizeM:10,originXM:0,originYM:0,groundElevationM:[0,0,0,0]};
const box=(extra={})=>({id:'pier',center:{xM:5,yM:5},direction:{xM:1,yM:0},lengthM:2,widthM:3,bottomElevationM:-1,topElevationM:3,...extra});
test('interior and rotated support volumes clip to cells without centre-sample disappearance',()=>{
 const mapped=mapSupportStorage(grid,[box()]);assert.deepEqual(mapped.mappedSupportIds,['pier']);assert.equal(mapped.storage[0].solids[0].areaM2,6);
 const rotated=mapSupportStorage(grid,[box({center:{xM:10,yM:10},direction:{xM:Math.SQRT1_2,yM:Math.SQRT1_2}})]);
 assert.equal(rotated.storage.length,4);assert.ok(Math.abs(rotated.storage.reduce((s,c)=>s+c.solids.reduce((s,p)=>s+p.areaM2,0),0)-6)<1e-12);
 const shifted=mapSupportStorage({...grid,originXM:1000000,originYM:1000000},[box({center:{xM:1000005,yM:1000005}})]);assert.equal(shifted.storage[0].solids[0].areaM2,6);
});
test('storage excludes only submerged solid volume and its inverse preserves the water level',()=>{
 const entries=mapSupportStorage(grid,[box()]).storage,s=compileStorage(entries,grid);
 assert.equal(s.volumeAtLevel(0,2),188);assert.equal(s.volumeAtLevel(0,4),382);assert.equal(s.minimumAreaM2,94);
 for(const h of [0,.01,1,2,3,4,20])assert.ok(Math.abs(s.levelAtVolume(0,s.volumeAtLevel(0,h))-h)<1e-12);
 assert.equal(s.volumeAtLevel(1,2),200);
 const elevated=compileStorage(mapSupportStorage(grid,[box({bottomElevationM:1,topElevationM:2})]).storage,grid);assert.equal(elevated.volumeAtLevel(0,.5),50);assert.equal(elevated.volumeAtLevel(0,3),294);
});
test('overlap and fully occupied cells are refused rather than double subtracting storage',()=>{
 assert.throws(()=>mapSupportStorage(grid,[box(),box({id:'second'})]),/Overlapping/);
 assert.throws(()=>mapSupportStorage(grid,[box({lengthM:10,widthM:10})]),/blocked/);
 assert.throws(()=>compileStorage([{cell:0,solids:[{areaM2:101,bottomElevationM:0,topElevationM:1}]}],grid));
 const vertical=mapSupportStorage(grid,[box({topElevationM:1}),box({id:'upper',bottomElevationM:1,topElevationM:2})]);assert.equal(compileStorage(vertical.storage,grid).volumeAtLevel(0,3),288);
});
test('displaced reservoirs conserve water under rain, infiltration and serialized restart',()=>{
 const initial={...createRunoffState({...grid,waterDepthM:[0,0,0,0]}),schema:'planet-reservoir-runoff@2',storageObstructions:mapSupportStorage(grid,[box()]).storage},before=structuredClone(initial),options={seconds:60,rainfallMPerSecond:.001,infiltrationMPerSecond:.0001};
 const result=stepRunoff(initial,options);assert.ok(Math.abs(result.diagnostics.balanceErrorM3)<1e-10);assert.deepEqual(initial,before);assert.deepEqual(stepRunoff(JSON.parse(JSON.stringify(initial)),options),result);
 const depths=runoffWaterDepths(result);assert.ok(depths[0]>result.waterVolumeM3[0]/100);assert.equal(result.waterVolumeM3.reduce((s,v)=>s+v,0),21.6);
});
test('unequal storage with a hydraulic connection cannot drain below invert or overshoot equilibrium',()=>{
 const hydraulics={model:'circular-quasi-steady@1',diameterM:2,lengthM:1,roughnessN:.01,entranceLoss:.5,exitLoss:1,inletInvertM:.2,outletInvertM:.2};
 let state={...createRunoffState({...grid,waterDepthM:[2,0,0,0]}),schema:'planet-reservoir-runoff@2',storageObstructions:mapSupportStorage(grid,[box()]).storage,culverts:[{id:'pipe',fromCell:0,toCell:1,hydraulics}]};
 for(let i=0;i<10;i++){state=stepRunoff(state,{seconds:1,conductanceM2PerSecond:0});const d=runoffWaterDepths(state);assert.ok(d[0]>=d[1]-1e-10);assert.ok(d[0]>=.2);assert.ok(Math.abs(state.diagnostics.balanceErrorM3)<1e-10);}
});
test('saved village supports enter real reservoir storage without changing the source water level',()=>{
 const snapshot=fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url),'utf8');
 const old=createPlanetRunoffScenario(snapshot,{subcellSupports:true}),state=createPlanetRunoffScenario(snapshot,{subcellSupports:true,displacedStorage:true});
 assert.ok(state.storageObstructions.length>0);assert.ok(state.scenarioDiagnostics.displacedStorage.displacedInitialM3>0);
 const a=runoffWaterDepths(old),b=runoffWaterDepths(state);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-10);
 assert.ok(state.waterVolumeM3.reduce((s,v)=>s+v,0)<old.waterVolumeM3.reduce((s,v)=>s+v,0));
 assert.throws(()=>createPlanetRunoffScenario(snapshot,{displacedStorage:true}),/requires/);
});

test('storage schema is explicit and older states cannot silently carry displaced volumes',()=>{
 const initial=createRunoffState({...grid,waterDepthM:[0,0,0,0]});assert.throws(()=>stepRunoff({...initial,storageObstructions:[]},{seconds:1}),/@2/);assert.throws(()=>stepRunoff({...initial,schema:'planet-reservoir-runoff@2'},{seconds:1}),/@2/);
});
