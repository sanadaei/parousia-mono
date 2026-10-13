import {createHash} from'node:crypto';
import {SoftwareRenderer} from '../src/globe/software-renderer.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
test('software rendering preserves near clipping, morph and depth raster witnesses',()=>{
const records=[];
for(const near of [.1,2,10])for(const morph of [0,.5,1]){
 let image;const context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:v=>image=v};
 const r=new SoftwareRenderer({clientWidth:640,clientHeight:480,getContext:()=>context},{shading:'flat-legacy'});
 const vertices=[];for(let i=0;i<36;i++){const x=Math.sin(i*5)*8,y=Math.cos(i*3)*8,z=(i%7)*2;vertices.push(x,y,z,x*.9,y*.9,z+1,(i%3)/2,(i%5)/4,(i%7)/6,0,0,1);}
 const tile=r.upload({anchor:[0,0,0],vertex:new Float32Array(vertices),index:Uint16Array.from({length:36},(_,i)=>i),overlayVertex:new Float32Array(),overlayIndex:new Uint16Array()});
 const result=r.draw({eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near,focal:2},[{tile,morph}],0);
 records.push({near,morph,hash:createHash('sha256').update(image.data).digest('hex'),triangles:result.triangles});
}
assert.deepEqual(records,[{"near":0.1,"morph":0,"hash":"341b48ccb6ee9975bc612ebcdba9c449f0393a38a17efccf7628f32466a0a4bb","triangles":12},{"near":0.1,"morph":0.5,"hash":"9009b6c158389942fc0b91872a13c926872e33c82a2da032e056dd011271a603","triangles":12},{"near":0.1,"morph":1,"hash":"624b79b698d84dcf0b80e393beaad20d216ef152ae32fa979c2c489a6a558666","triangles":18},{"near":2,"morph":0,"hash":"e9cb2bbedc5331c2e08d53f98edde9517cb6a575b9b84b81bb1fc284409d1850","triangles":18},{"near":2,"morph":0.5,"hash":"ef5db6fd26bd6c1b390c64bab02c5d6e9dd444c7163145a9a10edbbc274e0ad4","triangles":18},{"near":2,"morph":1,"hash":"a5b4dec977e28802c19008fcf5953ae548ae2baa248dabc77b93b8b00fb01498","triangles":14},{"near":10,"morph":0,"hash":"00db0e3a1c6c8328164a28bad0e55a6e3892acd6902c4bdf6df1224dc2ba1558","triangles":10},{"near":10,"morph":0.5,"hash":"1135b8a9aa24885beac50282f0ccd64c2dffc86947311e54aee4c4a5a6c55bb4","triangles":10},{"near":10,"morph":1,"hash":"885a43a36eeb6aeaa742cbb15ba78919caf6550b4367b906591e616a25fe8f24","triangles":5}]);
});

test('software framebuffer is reused, resized and released',()=>{
 let allocations=0,frames=0;const ctx={createImageData:(w,h)=>{allocations++;return{data:new Uint8ClampedArray(w*h*4)};},putImageData(){frames++;}};
 const canvas={clientWidth:640,clientHeight:480,getContext:()=>ctx},r=new SoftwareRenderer(canvas),camera={eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:2};
 r.draw(camera,[],0);const pixels=r.pixels,depth=r.depth;r.draw(camera,[],200);assert.equal(allocations,1);assert.equal(frames,1);assert.equal(r.result.cachedFrame,true);assert.equal(r.pixels,pixels);assert.equal(r.depth,depth);
 canvas.clientWidth=800;r.draw(camera,[],400);assert.equal(allocations,2);assert.notEqual(r.pixels,pixels);assert.equal(r.depth.length,canvas.width*canvas.height);
 r.destroy();assert.equal(r.pixels,null);assert.equal(r.depth,null);
});

import {benchmarkSummary} from '../src/globe/benchmark-summary.mjs';
test('benchmark summary never labels scheduler callbacks as rasterized fps',()=>{
 const s=benchmarkSummary({averageFPS:60,actualDrawFPS:5,rendererKind:'software-diagnostic',intervalMs:{p95:150}});
 assert.match(s,/5.0 描画fps（CPU診断）/);assert.match(s,/更新 60.0 回/);assert.doesNotMatch(s,/60.0 fps/);
 assert.match(benchmarkSummary({averageFPS:60}),/未測定 描画fps/);
});

function renderTriangle(points,{near=.1,indices=[0,1,2]}={}){
 let image;const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:v=>image=v};
 const canvas={clientWidth:400,clientHeight:400,getContext:()=>ctx},r=new SoftwareRenderer(canvas),v=[];
 for(const p of points)v.push(...p.slice(0,3),...p.slice(0,3),...p.slice(3));
 const tile=r.upload({anchor:[0,0,0],vertex:new Float32Array(v),index:Uint16Array.from(indices),overlayVertex:new Float32Array(),overlayIndex:new Uint16Array()});
 r.draw({eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near,focal:1},[{tile,morph:1}],0);
 return{image:image.data,width:canvas.width,depth:r.depth};
}
test('smooth raster lighting and color are perspective-correct rather than first-vertex flat',()=>{
 const points=[[-1,-1,2,1,0,0,0,0,1],[1,-1,2,0,1,0,0,0,1],[0,1,4,0,0,1,0,0,1]],r=renderTriangle(points),x=80,y=85;
 const project=p=>[(p[0]/p[2]+1)*80,(1-p[1]/p[2])*80];const[a,b,c]=points.map(project);
 const edge=(p,q,x,y)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);const area=edge(a,b,...c);
 const weights=[edge(b,c,x+.5,y+.5)/area,edge(c,a,x+.5,y+.5)/area];weights.push(1-weights[0]-weights[1]);
 const denominator=weights.reduce((sum,w,i)=>sum+w/points[i][2],0),light=.42+.58*.82,pixel=(y*r.width+x)*4;
 for(let i=0;i<3;i++)assert.ok(Math.abs(r.image[pixel+i]-Math.round(255*light*weights[i]/points[i][2]/denominator))<=1);
 assert.ok(r.image[pixel]>0&&r.image[pixel+1]>0&&r.image[pixel+2]>0);
});
test('smooth interpolation is unchanged by triangulation and near clipping',()=>{
 const p=[[-2,-2,2,0,0,0,0,0,1],[2,-2,2,1,0,0,0,0,1],[2,2,4,1,1,0,0,0,1],[-2,2,4,0,1,0,0,0,1]];
 for(const near of [.1,2.5]){
  const a=renderTriangle(p,{near,indices:[0,1,2,0,2,3]}),b=renderTriangle(p,{near,indices:[0,1,3,1,2,3]});let checked=0;
  for(let i=0;i<a.depth.length;i++)if(Number.isFinite(a.depth[i])&&Number.isFinite(b.depth[i])){checked++;for(let c=0;c<3;c++)assert.ok(Math.abs(a.image[i*4+c]-b.image[i*4+c])<=1);}
  assert.ok(checked>1000);
 }
});

test('software projection scratch is reused across frames and released',()=>{
 const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}},r=new SoftwareRenderer({clientWidth:400,clientHeight:400,getContext:()=>ctx});
 const v=new Float32Array([-1,-1,2,-1,-1,2,1,1,1,0,0,1,1,-1,2,1,-1,2,1,1,1,0,0,1,0,1,2,0,1,2,1,1,1,0,0,1]);
 const tile=r.upload({anchor:[0,0,0],vertex:v,index:new Uint16Array([0,1,2]),overlayVertex:new Float32Array(),overlayIndex:new Uint16Array()}),camera={eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:1};
 r.draw(camera,[{tile,morph:1}],0);const pool=r.projected,first=pool[0],screen=r.screenProjected,firstScreen=screen[0];r.draw(camera,[{tile,morph:1}],200);
 assert.equal(r.projected,pool);assert.equal(r.projected[0],first);assert.equal(pool.length,3);assert.equal(r.screenProjected,screen);assert.equal(screen[0],firstScreen);assert.equal(screen.length,3);r.destroy();assert.equal(r.projected,null);assert.equal(r.screenProjected,null);
});

import{benchmarkReady}from'../src/globe/benchmark-summary.mjs';
test('benchmark waits for real geometry and all root fallbacks, and refuses a second run',()=>{
 const input={streamReady:true,rootTilesReady:true,drawTiles:6};assert.equal(benchmarkReady(input),true);
 for(const patch of [{streamReady:false},{rootTilesReady:false},{drawTiles:0},{drawTiles:NaN},{lost:true},{running:true}])assert.equal(benchmarkReady({...input,...patch}),false);
});

test('hidden and extreme portrait viewports cannot allocate an unbounded CPU framebuffer',()=>{
 let count=0;const ctx={createImageData:(w,h)=>{count++;assert.ok(w<=420&&h<=420);return{data:new Uint8ClampedArray(w*h*4)};},putImageData(){}},canvas={clientWidth:0,clientHeight:1000,getContext:()=>ctx},r=new SoftwareRenderer(canvas),camera={eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:1};
 assert.equal(r.draw(camera,[],0).suspended,true);assert.equal(count,0);assert.equal(r.renderCount,0);
 canvas.clientWidth=1;canvas.clientHeight=10000;const portrait=r.draw(camera,[],200);assert.deepEqual(portrait.viewport,[1,420]);assert.equal(r.depth.length,420);
 canvas.clientWidth=640;canvas.clientHeight=480;assert.deepEqual(r.draw(camera,[],400).viewport,[224,168]);
 canvas.clientHeight=0;assert.equal(r.draw(camera,[],600).suspended,true);assert.equal(count,2);assert.equal(r.renderCount,2);
});

test('static framebuffer reuse invalidates camera, morph, stitch and geometry changes',()=>{
 let frames=0;const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){frames++;}},r=new SoftwareRenderer({clientWidth:400,clientHeight:400,getContext:()=>ctx}),camera={eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:1};
 const mesh={anchor:[0,0,0],vertex:new Float32Array(),index:new Uint16Array(),overlayVertex:new Float32Array(),overlayIndex:new Uint16Array()},tile=r.upload(mesh);
 r.draw(camera,[{tile,morph:0}],0);r.draw(structuredClone(camera),[{tile,morph:0}],200);assert.equal(frames,1);
 r.draw({...camera,focal:2},[{tile,morph:0}],400);assert.equal(frames,2);
 r.draw(camera,[{tile,morph:.5}],600);assert.equal(frames,3);
 r.draw(camera,[{tile,morph:.5,stitchMask:1}],800);assert.equal(frames,4);
 const replacement=r.upload(mesh);r.draw(camera,[{tile:replacement,morph:.5,stitchMask:1}],1000);assert.equal(frames,5);
 r.dispose(replacement);assert.equal(r.frameTiles,null);r.destroy();assert.equal(r.frameCameraKey,null);
});

test('independent tile roundoff cannot leave a black pixel seam, but visible gaps stay visible',()=>{
 function sample(gap){let image;const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:v=>image=v},canvas={clientWidth:460,clientHeight:460,getContext:()=>ctx},r=new SoftwareRenderer(canvas),tiles=[];
  for(const [lo,hi] of [[-1,-gap],[gap,1]]){const v=[];for(const [x,y] of [[lo,-1],[hi,-1],[hi,1],[lo,1]])v.push(x,y,2,x,y,2,0,1,0,0,0,1);tiles.push({tile:r.upload({anchor:[0,0,0],vertex:new Float32Array(v),index:new Uint16Array([0,1,2,0,2,3]),overlayVertex:new Float32Array(),overlayIndex:new Uint16Array()}),morph:1});}
  r.draw({eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:1},tiles,0);return image.data[(80*canvas.width+80)*4+1];
 }
 assert.ok(sample(1e-7)>100,'micrometre tile seam is rasterized');assert.equal(sample(.01),7,'visible geometry gap is not filled');
});

test('CPU draw cadence permits responsive motion while yielding proportional to measured work',()=>{
 let now=0,count=0;const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){count++;now+=5;}};
 const r=new SoftwareRenderer({clientWidth:400,clientHeight:400,getContext:()=>ctx},{now:()=>now}),camera={eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:1};
 r.draw(camera,[],0);assert.equal(count,1);assert.equal(r.result.drawCpuMs,5);assert.equal(r.result.drawIntervalMs,1000/30);
 r.draw({...camera,focal:2},[],16);assert.equal(count,1);r.draw({...camera,focal:2},[],34);assert.equal(count,2);
 ctx.putImageData=()=>{count++;now+=100;};r.draw({...camera,focal:3},[],68);assert.equal(count,3);assert.equal(r.result.drawIntervalMs,200);
 r.draw({...camera,focal:4},[],100);assert.equal(count,3);r.draw({...camera,focal:4},[],268);assert.equal(count,4);
});

import {softwareViewportSize} from '../src/globe/software-renderer.mjs';
test('diagnostic LOD uses exactly the drawn framebuffer size rather than the enlarged CSS image',()=>{
 assert.deepEqual(softwareViewportSize(640,480),[224,168]);
 assert.deepEqual(softwareViewportSize(1,10000),[1,420]);
 assert.deepEqual(softwareViewportSize(0,500),[0,0]);
 for(const [cw,ch] of [[1188,756],[1920,1080],[375,812],[160,120]]){
  const ctx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}},renderer=new SoftwareRenderer({clientWidth:cw,clientHeight:ch,getContext:()=>ctx});
  const result=renderer.draw({eye:[0,0,0],right:[1,0,0],up:[0,1,0],forward:[0,0,1],near:.1,focal:2},[],0);
  assert.deepEqual(result.viewport,softwareViewportSize(cw,ch));assert.ok(result.viewport[0]<=420&&result.viewport[1]<=420);
 }
});

test('explicit diagnostic export resolution is bounded while interactive defaults stay unchanged',()=>{
 assert.deepEqual(softwareViewportSize(1200,900),[420,315]);
 assert.deepEqual(softwareViewportSize(1200,900,{scale:1,maxDimension:1200}),[1200,900]);
 assert.deepEqual(softwareViewportSize(900,1200,{scale:1,maxDimension:1200}),[900,1200]);
 assert.throws(()=>softwareViewportSize(1200,900,{scale:1,maxDimension:4096}),/bounded/);
 assert.throws(()=>softwareViewportSize(1200,900,{scale:2,maxDimension:1200}),/bounded/);
});
