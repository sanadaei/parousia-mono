import test from 'node:test';import assert from 'node:assert/strict';
import {mapSupportFaceObstructions,validateFaceObstructions,openFaceHead}from'../src/core/runoff-obstacles.mjs';
import {createRunoffState,stepRunoff}from'../src/core/runoff-dynamics.mjs';
const grid={columns:2,rows:2,cellSizeM:10,originXM:0,originYM:0};
const box=(extra={})=>({id:'pier',center:{xM:10,yM:5},direction:{xM:1,yM:0},lengthM:1,widthM:2,bottomElevationM:-1,topElevationM:3,...extra});
test('subcell pier covers its exact face fraction without blocking a whole grid cell',()=>{
 const mapped=mapSupportFaceObstructions(grid,[box()]);assert.equal(mapped.obstructions.length,1);assert.deepEqual(mapped.coupledSupportIds,['pier']);
 const f=mapped.obstructions[0];assert.equal(f.fromCell,0);assert.equal(f.toCell,1);assert.equal(f.pieces[0].start,.4);assert.equal(f.pieces[0].end,.6);
 assert.ok(Math.abs(openFaceHead(f,2,0)-1.6)<1e-12);assert.ok(Math.abs(openFaceHead(f,5,0)-4.4)<1e-12);assert.equal(openFaceHead(f,5,4),1);
});
test('overlapping boxes merge height intervals rather than double-subtract flow',()=>{
 const a=box(),b=box({id:'second',bottomElevationM:2,topElevationM:4});const f=mapSupportFaceObstructions(grid,[a,b]).obstructions[0];
 assert.deepEqual(f.pieces[0].solidIntervals,[[-1,4]]);assert.ok(Math.abs(openFaceHead(f,5,0)-4.2)<1e-12);
 validateFaceObstructions([f],2,2);
});
test('rotated support clipping and entirely interior supports retain explicit coverage limits',()=>{
 const diagonal=box({direction:{xM:Math.SQRT1_2,yM:Math.SQRT1_2},widthM:1}),m=mapSupportFaceObstructions(grid,[diagonal,box({id:'inside',center:{xM:5,yM:5}})]);
 assert.deepEqual(m.unresolvedSupportIds,['inside']);const f=m.obstructions[0];assert.ok(Math.abs(f.pieces[0].end-f.pieces[0].start-Math.SQRT2/10)<1e-12);
});
test('obstructed finite-volume transfer is conservative and slower without source mutation',()=>{
 const initial=createRunoffState({columns:2,rows:2,cellSizeM:10,groundElevationM:[0,0,10,10],waterDepthM:[2,0,0,0]}),faces=mapSupportFaceObstructions(grid,[box()]).obstructions;
 const open=stepRunoff(initial,{seconds:1}),blocked=stepRunoff({...initial,faceObstructions:faces},{seconds:1});
 assert.ok(blocked.waterVolumeM3[1]<open.waterVolumeM3[1]);assert.ok(Math.abs(blocked.diagnostics.balanceErrorM3)<1e-12);assert.equal(initial.waterVolumeM3[0],200);
 const restored=JSON.parse(JSON.stringify({...initial,faceObstructions:faces}));assert.deepEqual(stepRunoff(restored,{seconds:1}),blocked);
});
test('invalid face identity, overlap and box geometry are rejected',()=>{
 const f=mapSupportFaceObstructions(grid,[box()]).obstructions[0];assert.throws(()=>validateFaceObstructions([f,f],2,2));assert.throws(()=>validateFaceObstructions([{...f,toCell:3}],2,2));assert.throws(()=>validateFaceObstructions([{...f,pieces:[...f.pieces,...f.pieces]}],2,2));
 assert.throws(()=>mapSupportFaceObstructions(grid,[box({widthM:-1})]));assert.throws(()=>mapSupportFaceObstructions(grid,[box(),box()]));
});
