import test from'node:test';import assert from'node:assert/strict';
import{directionTile,neighborViolations,balancePlannedNeighbors}from'../src/globe/lod-neighbors.mjs';import{tileDirection,tileKey,children}from'../src/globe/cube.mjs';
test('direction lookup respects all six cube faces and deep tiles',()=>{for(let face=0;face<6;face++)for(const level of[0,1,10,24]){const t={face,level,x:Math.floor(2**level*.3),y:Math.floor(2**level*.6)};assert.deepEqual(directionTile(tileDirection(t,.5,.5),level),t);}});
test('planned 2:1 balance crosses cube faces without increasing budget',()=>{
 const wanted=new Map(),add=t=>wanted.set(tileKey(t),{tile:t,refine:false});for(let face=0;face<6;face++)add({face,level:0,x:0,y:0});
 let t={face:0,level:0,x:0,y:0};for(let i=0;i<6;i++){wanted.get(tileKey(t)).refine=true;for(const c of children(t))add(c);t=children(t)[0];}
 const leaves=()=>[...wanted.values()].filter(e=>!e.refine).map(e=>e.tile);assert.ok(neighborViolations(leaves()).length>0);const before=wanted.size,result=balancePlannedNeighbors(wanted);assert.equal(result.remaining,0);assert.ok(result.collapsed>0);assert.ok(wanted.size<=before);assert.equal(neighborViolations(leaves()).length,0);
});
import{vertexEdgeMask,stitchMasks}from'../src/globe/lod-neighbors.mjs';
test('stitch flags affect shared edges only, including deep cube boundaries',()=>{
 for(let face=0;face<6;face++)for(const level of[1,10,24]){const t={face,level,x:0,y:0};assert.equal(vertexEdgeMask(t,tileDirection(t,0,.5)),1);assert.equal(vertexEdgeMask(t,tileDirection(t,1,.5)),2);assert.equal(vertexEdgeMask(t,tileDirection(t,.5,.5)),0);}
 const tiles=[{face:0,level:1,x:0,y:0},{face:3,level:0,x:0,y:0}];assert.ok(stitchMasks(tiles).get(tileKey(tiles[0]))&1);
});

import{balanceDisplayedLeaves}from'../src/globe/lod-neighbors.mjs';
test('displayed partial loading coarsens retained ancestors until 2:1 without removing coverage',()=>{
 const coarse={face:0,level:1,x:0,y:0},fine={face:0,level:4,x:8,y:3};assert.ok(neighborViolations([coarse,fine]).length);
 const result=balanceDisplayedLeaves([{tile:coarse,entry:'coarse'},{tile:fine,entry:'fine'}],{getAncestor:t=>({entry:tileKey(t)})});
 assert.equal(result.remaining,0);assert.ok(result.collapsed>0);assert.equal(result.leaves.length,2);assert.ok(result.leaves.some(e=>tileKey(e.tile)===tileKey(coarse)));
 const containing=result.leaves.find(e=>e.tile.face===fine.face&&Math.floor(fine.x/2**(fine.level-e.tile.level))===e.tile.x&&Math.floor(fine.y/2**(fine.level-e.tile.level))===e.tile.y);assert.ok(containing);
});
test('displayed balancing discloses a missing ancestor rather than inventing a mesh',()=>{
 const tiles=[{face:0,level:1,x:0,y:0},{face:0,level:4,x:8,y:3}],r=balanceDisplayedLeaves(tiles.map(tile=>({tile})),{getAncestor:()=>null});assert.ok(r.remaining>0);assert.equal(r.collapsed,0);
});
import{neighborTopologyStats}from'../src/globe/lod-neighbors.mjs';
test('reused cube adjacency stays bounded across distant camera positions',()=>{
 for(let i=0;i<2500;i++)neighborViolations([{face:i%6,level:12,x:i%4096,y:Math.floor(i/6)}]);
 const s=neighborTopologyStats();assert.ok(s.entries<=s.maxEntries);assert.ok(s.estimatedBytes<=1048576);
});
import{balancePlannedNeighborSteps,neighborViolationSteps}from'../src/globe/lod-neighbors.mjs';
test('incremental neighbor work yields and returns the same balancing result',()=>{
 const wanted=new Map();for(let face=0;face<6;face++){const t={face,level:0,x:0,y:0};wanted.set(tileKey(t),{tile:t,refine:false});}
 let t={face:0,level:0,x:0,y:0};for(let i=0;i<6;i++){wanted.get(tileKey(t)).refine=true;for(const c of children(t))wanted.set(tileKey(c),{tile:c,refine:false});t=children(t)[0];}
 const copy=structuredClone(wanted),expected=balancePlannedNeighbors(copy),it=balancePlannedNeighborSteps(wanted);let step,yields=0;do{step=it.next();if(!step.done)yields++;}while(!step.done);
 assert.ok(yields>0);assert.deepEqual(step.value,expected);assert.deepEqual(wanted,copy);
 const tiles=Array.from({length:40},(_,x)=>({face:0,level:6,x,y:0})),scan=neighborViolationSteps(tiles);assert.equal(scan.next().done,false);
});
