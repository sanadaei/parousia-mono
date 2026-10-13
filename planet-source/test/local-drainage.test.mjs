import test from 'node:test';import assert from 'node:assert/strict';import {analyzeLocalDrainage} from '../src/core/local-drainage.mjs';
const size=11,center=5*size+5,elevation=Array.from({length:size*size},(_,i)=>{const x=i%size,y=Math.floor(i/size),edge=x===0||y===0||x===10||y===10;return edge?0:Math.max(Math.abs(x-5),Math.abs(y-5));});
const input={columns:size,rows:size,cellSizeM:50,elevation,outlets:[{cell:center,id:'known-river',kind:'river',levelM:0}],minChannelAreaM2:2500};
test('interior drainage reaches declared water without inventing a boundary ocean',()=>{
 const r=analyzeLocalDrainage(input);assert.ok(r.diagnostics.candidateCells>0);assert.ok(r.basins.some(b=>b.outlet.kind==='open-boundary'&&b.status==='boundary-truncated'));
 for(let i=0;i<r.receiver.length;i++){const seen=new Set();let q=i;while(r.receiver[q]>=0){assert.ok(!seen.has(q));seen.add(q);const next=r.receiver[q];assert.ok(r.filledElevationM[next]<=r.filledElevationM[q]);q=next;}assert.equal(q,r.outletCell[i]);if(r.candidateMask[i])assert.equal(q,center);}
 assert.deepEqual(r,analyzeLocalDrainage(input));
});
test('a depression and an open-edge catchment remain unresolved instead of becoming blue streams',()=>{
 const pit=[...elevation];pit[4*size+4]=-2;const r=analyzeLocalDrainage({...input,elevation:pit});assert.ok(r.diagnostics.depressionDependentBasins>0);assert.equal(r.diagnostics.candidateCells,0);
 const noOutlet=analyzeLocalDrainage({...input,outlets:[]});assert.equal(noOutlet.diagnostics.candidateCells,0);assert.ok(noOutlet.basins.every(b=>b.status==='boundary-truncated'));
});
test('local drainage rejects ambiguous outlet levels and over-budget grids',()=>{
 assert.throws(()=>analyzeLocalDrainage({...input,outlets:[{...input.outlets[0],levelM:-1}]}));
 assert.throws(()=>analyzeLocalDrainage({...input,columns:1000,rows:1000}));
 assert.throws(()=>analyzeLocalDrainage({...input,outlets:[input.outlets[0],input.outlets[0]]}));
});
