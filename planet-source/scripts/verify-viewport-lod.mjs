import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';
import {GlobeStream} from '../src/globe/stream.mjs';import {PagedSource} from '../src/globe/paged-source.mjs';import {buildMesh} from '../src/globe/mesh.mjs';import {sphereBasis} from '../src/core/spherical.mjs';import {normalize,cross,length} from '../src/globe/cube.mjs';import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const manifestPath=path.resolve('examples/planet/generated/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath)),url=pathToFileURL(manifestPath).href,
 fetcher=async u=>{const b=fs.readFileSync(fileURLToPath(u));return {ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
// A local asynchronous harness for the real planner and real mesh generator.
// No GPU, rasterizer, browser FPS, or external AI agent is represented here.
class LocalMeshWorker{
 constructor(){this.closed=false;}
 postMessage(m){
  if(m.type==='init'){this.source=new PagedSource(m.manifest,m.url,fetcher);queueMicrotask(()=>this.emit({type:'ready'}));return;}
  if(m.type==='cancel'){if(this.active?.id===m.id)this.active.controller.abort();return;}
  const job=this.active={id:m.id,controller:new AbortController()};
  (async()=>{let result;try{const mesh=await buildMesh(this.source,m.tile,job.controller.signal);result={type:'mesh',id:m.id,mesh,stats:this.source.stats()};}
   catch(e){result={type:e.name==='AbortError'?'cancelled':'error',id:m.id,error:e.message};}
   finally{if(this.active===job)this.active=null;}this.emit(result);
  })();
 }
 emit(data){if(!this.closed)this.onmessage?.({data});}
 terminate(){this.closed=true;this.active?.controller.abort();}
}
const priorWorker=globalThis.Worker;globalThis.Worker=LocalMeshWorker;
const renderer={gpuBytes:0,peakGpuBytes:0,allocations:0,deletions:0,
 upload(mesh){const bytes=mesh.vertex.byteLength+mesh.index.byteLength+mesh.edgeMask.byteLength+mesh.overlayVertex.byteLength+mesh.overlayIndex.byteLength;this.gpuBytes+=bytes;this.peakGpuBytes=Math.max(this.peakGpuBytes,this.gpuBytes);this.allocations++;return {...mesh,bytes,branchMorph:0};},
 dispose(mesh){this.gpuBytes-=mesh.bytes;this.deletions++;},destroy(){}};
const point=manifest.focus,altitude=Number(process.argv[2]??30),meshBudgetMiB=Number(process.argv[3]??128),viewport=[1280,720],maxSeconds=Number(process.argv[4]??300);
if(!Number.isFinite(maxSeconds)||maxSeconds<1||maxSeconds>1800)throw new RangeError('Work duration must be 1..1800 seconds');
if(!Number.isFinite(altitude)||altitude<3||altitude>1000)throw new RangeError('Altitude must be 3..1000m');
const tracker=new PagedSource(manifest,url,fetcher);await tracker.enableFeaturesAt(point);const s=await tracker.ready(()=>tracker.sample(point.latDeg,point.lonDeg)),raw=await tracker.ready(()=>tracker.rawGroundElevationAt(point.latDeg,point.lonDeg)),ground=Math.max(s.groundElevationM,s.waterSurfaceElevationM??-Infinity,s.roadSurface?.roadElevationM??-Infinity),radius=manifest.base.frame.radiusM,basis=sphereBasis(point),eye=basis.up.map(v=>v*(radius+ground+altitude)),forward=basis.up.map(v=>-v),right=normalize(cross(forward,basis.north)),up=cross(right,forward),camera={eye,eyeUnit:normalize(eye),targetUp:basis.up,forward,right,up,altitude,focal:1/Math.tan(Math.PI/8),near:Math.max(.02,Math.min(1000,altitude*.002)),far:length(eye)+radius*2,aspect:viewport[0]/viewport[1],groundReference:{up:basis.up,elevationM:raw}};
const stream=new GlobeStream(renderer,manifest,url,{meshBudgetMiB}),started=performance.now(),checkpoints=[];let lastPlan=-Infinity,lastLog=-Infinity,stable=0,frames=0,status='work-budget-exhausted',render=[];
try{
 while(performance.now()-started<maxSeconds*1000&&stream.completed<12000){
  const now=performance.now();if(now-lastPlan>=180){stream.requestPlan(camera,viewport[1]);lastPlan=now;}
  render=stream.frame(camera,50);frames++;const stats=stream.stats();
  if(now-lastLog>=10000){const row={elapsedSeconds:(now-started)/1000,completedMeshes:stats.completedMeshes,displayedTiles:render.length,bytes:renderer.gpuBytes,maxGroundErrorPixels:stats.displayedQuality?.maxGroundErrorPixels,active:stats.activeWorkers};checkpoints.push(row);console.log(JSON.stringify(row));lastLog=now;}
  const settled=stats.activeWorkers===0&&stats.pendingUploads===0&&!stats.planningActive&&!stats.planningQueued&&stats.lodQuality.residentBoundLeaves===stats.lodQuality.plannedLeaves&&stats.lodQuality.plannedLeaves>0;
  if(settled)stable++;else stable=0;
  if(stable>=4){status=stats.displayedQuality.unknownGroundTiles===0&&stats.displayedQuality.maxGroundErrorPixels<=2&&stats.displayedNeighborViolations===0?'ground-target-met':'ground-target-unmet';break;}
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 const stats=stream.stats();assert.equal(stats.errors.length,0);assert.ok(renderer.gpuBytes<=stream.limits.gpuBytes);assert.equal(stats.displayedNeighborViolations,0);
 const report={schema:'planet-viewport-lod@1',sourceWorldId:manifest.canonicalWorldId,input:{point,altitude,viewport,meshBudgetMiB,maxSeconds},status,elapsedSeconds:(performance.now()-started)/1000,frames,stats,displayedTiles:render.length,checkpoints,
  scope:'Real canonical meshes and real streaming/morph/stitch planner, simulated asynchronous delivery, numeric full-resolution ground certificate only. No rasterizer, GPU, browser FPS or whole-browser memory acceptance.'};
 fs.writeFileSync(`examples/planet/verification/viewport-lod-${altitude}m-${meshBudgetMiB}mib.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status,elapsedSeconds:report.elapsedSeconds,displayedTiles:render.length,maxGroundErrorPixels:stats.displayedQuality.maxGroundErrorPixels,bytes:renderer.gpuBytes}));
}finally{stream.destroy();globalThis.Worker=priorWorker;}
