import test from 'node:test';import assert from 'node:assert/strict';import {SoftwareRenderer} from '../src/globe/software-renderer.mjs';
const vertices=z=>new Float32Array([[-1,-1,z],[1,-1,z],[0,1,z]].flatMap(p=>[...p,...p,.1,.5,.7,0,0,1]));
function draw(waterIndexCount){const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}},canvas={clientWidth:200,clientHeight:200,getContext:()=>ctx},r=new SoftwareRenderer(canvas),tile=r.upload({tile:{face:0,level:1,x:0,y:0},anchor:[0,0,0],vertex:vertices(20),index:new Uint16Array([0,1,2]),overlayVertex:vertices(10),overlayIndex:new Uint16Array([0,1,2]),waterIndexCount});
 return r.draw({eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:1},[{tile,morph:.5}],1000);
}
test('canonical water stays drawn during terrain morph while non-water overlays wait',()=>{assert.equal(draw(3).triangles,2);assert.equal(draw(0).triangles,1);});
