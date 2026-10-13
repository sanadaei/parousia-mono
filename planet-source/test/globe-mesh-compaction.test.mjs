import test from 'node:test';import assert from 'node:assert/strict';import {deduplicateMeshVertices,VERTEX_STRIDE} from '../src/globe/mesh.mjs';
const record=n=>Array.from({length:VERTEX_STRIDE},(_,i)=>n+i*.13);
const expanded=(vertex,index)=>{const bits=new Uint32Array(vertex.buffer,vertex.byteOffset,vertex.length);return [...index].flatMap(i=>[...bits.subarray(i*VERTEX_STRIDE,(i+1)*VERTEX_STRIDE)]);};
test('vertex compaction preserves every indexed bit, winding, prefix and edge identity',()=>{
 const vertex=Float32Array.from([record(1),record(2),record(1),record(2),record(1)].flat()),index=new Uint16Array([0,1,2,2,3,4]),edgeMask=new Uint8Array([1,2,1,2,4]);
 const out=deduplicateMeshVertices(vertex,index,{edgeMask,preservePrefix:2});
 assert.equal(out.outputVertices,3);assert.deepEqual(out.vertex.slice(0,24),vertex.slice(0,24));assert.deepEqual(expanded(vertex,index),expanded(out.vertex,out.index));
 assert.deepEqual([...index].map(i=>edgeMask[i]),[...out.index].map(i=>out.edgeMask[i]));assert.deepEqual([...index],[0,1,2,2,3,4]);
});
test('compaction never welds signed zero or differing normal/color/coarse data',()=>{
 const rows=[record(1),record(1),record(1),record(1)];rows[0][0]=0;rows[1][0]=-0;rows[2][9]+=1e-4;rows[3][3]+=1e-4;
 const vertex=Float32Array.from(rows.flat()),index=new Uint16Array([0,1,2,1,2,3]),out=deduplicateMeshVertices(vertex,index);assert.equal(out.outputVertices,4);assert.equal(out.vertex,vertex);
 assert.throws(()=>deduplicateMeshVertices(vertex,new Uint16Array([4])),/index/);assert.throws(()=>deduplicateMeshVertices(vertex,index,{preservePrefix:5}),/layout/);
 const empty=deduplicateMeshVertices(new Float32Array(),new Uint16Array());assert.equal(empty.outputVertices,0);
});
