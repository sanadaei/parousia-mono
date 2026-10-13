import {createTriangularPatchView,iterateTriangularPatchMesh} from './triangular-patch.mjs';
export const TRIANGLE_SCENE_BYTE_LIMIT=32*1024*1024;
const cancelled=()=>Object.assign(new Error('Superseded region load'),{name:'AbortError'});
/** CPU preparation is independent of GPU state. Old scene stays usable until
 * bounded new packets have all been prepared and uploaded successfully. */
export async function prepareTriangularRegion(snapshot,{centerLatDeg=0,centerLonDeg=0,radiusM=6371000}={},
 {yieldNow=()=>Promise.resolve(),isCurrent=()=>true,onProgress=()=>{}}={}){
 if(!Array.isArray(snapshot?.mesh?.points)||!snapshot.mesh.points.length||snapshot.mesh.points.length>65536)throw new RangeError('Bounded triangle source required');
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const p of snapshot.mesh.points){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))throw new TypeError('Finite source points required');minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
 const width=maxX-minX,height=maxY-minY,origin={xM:(minX+maxX)/2,yM:(minY+maxY)/2};
 const view=createTriangularPatchView(snapshot,{projection:{centerLatDeg,centerLonDeg,radiusM,maxRadiusM:Math.hypot(width,height)},metricOrigin:origin});
 const packets=[];let bytes=0;
 for(let y=0;y<4;y++)for(let x=0;x<4;x++){
  if(!isCurrent())throw cancelled();
  const bounds={minXM:minX+x*width/4,minYM:minY+y*height/4,maxXM:minX+(x+1)*width/4,maxYM:minY+(y+1)*height/4};
  try{const iterator=iterateTriangularPatchMesh(view,{...bounds,maxTriangles:16384});let step;
   try{do{if(!isCurrent())throw cancelled();step=iterator.next();if(!step.done)await yieldNow();}while(!step.done);}finally{iterator.return();}
   const mesh=step.value;bytes+=mesh.diagnostics.bufferBytes;
   if(bytes>TRIANGLE_SCENE_BYTE_LIMIT)throw new RangeError('Region draw buffers exceed 32 MiB');packets.push(mesh);
  }catch(error){if(error.message!=='No observed terrain in draw window')throw error;}
  onProgress(y*4+x+1,16);await yieldNow();if(!isCurrent())throw cancelled();
 }
 if(!packets.length)throw new Error('No observed region geometry');
 // A missing central DEM cell is not turned into a synthetic focus height.
 let nearest=null,distance=Infinity;for(const p of snapshot.mesh.points){const d=Math.hypot(p[0]-origin.xM,p[1]-origin.yM);if(d<distance){distance=d;nearest=p;}}
 const focus={point:view.toGeographic(...nearest),ground:view.terrain.groundElevationAt(...nearest)};
 return {view,packets,bytes,focus,extentM:Math.max(width,height)};
}
export async function replaceTriangularPackets(renderer,previous,prepared,{yieldNow=()=>Promise.resolve(),isCurrent=()=>true}={}){
 const uploaded=[];
 try{
  for(const mesh of prepared.packets){if(!isCurrent())throw cancelled();uploaded.push(renderer.upload(mesh));await yieldNow();if(!isCurrent())throw cancelled();}
 }catch(error){for(const tile of uploaded)renderer.dispose(tile);throw error;}
 for(const tile of previous??[])renderer.dispose(tile);
 return uploaded;
}
