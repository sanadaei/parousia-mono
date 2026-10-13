import test from 'node:test';import assert from 'node:assert/strict';
import {balanceRefinedBranchSteps,neighborViolations} from '../src/globe/lod-neighbors.mjs';
import {children,tileKey} from '../src/globe/cube.mjs';
const exhaust=it=>{let n;do{n=it.next();}while(!n.done);return n.value;};
function tree(){const map=new Map();for(let face=0;face<6;face++){const tile={face,level:0,x:0,y:0};map.set(tileKey(tile),{tile,refine:false});}return map;}
function split(map,tile,budget=10000){const e=map.get(tileKey(tile));if(!e||e.refine||map.size+4>budget)return false;e.refine=true;for(const child of children(tile))map.set(tileKey(child),{tile:child,refine:false});return true;}
test('local refinement closure preserves full-tree neighbor balance across cube faces and corners',()=>{
 const map=tree();let work=0;
 for(let level=0;level<10;level++)for(const face of [0,2,4]){
  const tile={face,level,x:0,y:0};if(!split(map,tile))continue;
  const result=exhaust(balanceRefinedBranchSteps(map,children(tile),{refineCoarse:t=>split(map,t)}));work+=result.inspected;
  assert.equal(result.remaining,0);assert.equal(neighborViolations([...map.values()].filter(e=>!e.refine).map(e=>e.tile)).length,0);
 }
 assert.ok(work<2000);assert.ok(map.size>100);
});
test('local refinement closure reports an unrepairable budget without deleting ancestors',()=>{
 const map=tree(),root={face:0,level:0,x:0,y:0};split(map,root);
 const corner=children(root)[0];split(map,corner);
 const result=exhaust(balanceRefinedBranchSteps(map,children(corner),{refineCoarse:()=>false}));
 assert.equal(result.remaining,1);assert.ok(map.has(tileKey(root)));assert.equal(map.size,14);
});
