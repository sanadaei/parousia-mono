import {restoreTerrain,TRIANGULAR_TERRAIN_SCHEMA} from '../core/index.mjs';
import {createSphericalProjection,sphereBasis} from '../core/spherical.mjs';
import {hashJson} from '../core/json-contract.mjs';

/** Explicit coordinate binding, not permission to overwrite a planetary region.
 * A bounded regional source has a sourceWorldId and a separate geographic viewId.
 * No outside terrain, sea, settlements, or boundary blend is invented here.
 */
export function createTriangularPatchView(snapshot,{projection,metricOrigin}={}) {
 if(snapshot?.schema!==TRIANGULAR_TERRAIN_SCHEMA)throw new TypeError('Saved canonical triangle terrain required');
 const terrain=restoreTerrain(snapshot),p=createSphericalProjection(projection??{});
 if(!metricOrigin||![metricOrigin.xM,metricOrigin.yM].every(Number.isFinite))throw new TypeError('Explicit finite metric origin required');
 const origin={xM:metricOrigin.xM,yM:metricOrigin.yM},bounds=terrain.bounds;
 for(const x of [bounds.minXM,bounds.maxXM])for(const y of [bounds.minYM,bounds.maxYM])p.toGeographic(x-origin.xM,y-origin.yM);
 const contract={method:'georeferenced-triangular-view@1',sourceWorldId:terrain.worldId,projection:{...p.contract},metricOrigin:origin},viewId=hashJson(contract);
 const toGeographic=(xM,yM)=>p.toGeographic(xM-origin.xM,yM-origin.yM);
 const toMetric=(latDeg,lonDeg)=>{
  const q=p.toLocal(latDeg,lonDeg),x=q.xM+origin.xM,y=q.yM+origin.yM,tolerance=128*Number.EPSILON*p.contract.radiusM;
  if(x<bounds.minXM-tolerance||x>bounds.maxXM+tolerance||y<bounds.minYM-tolerance||y>bounds.maxYM+tolerance)throw new RangeError('Point outside regional triangle view');
  return{xM:Math.max(bounds.minXM,Math.min(bounds.maxXM,x)),yM:Math.max(bounds.minYM,Math.min(bounds.maxYM,y))};
 };
 const sampleGeographic=(lat,lon)=>{const q=toMetric(lat,lon);return{...terrain.sampleAt(q.xM,q.yM),viewId,latDeg:lat,lonDeg:lon};};
 const toECEF=(x,y,z)=>{
  if(!Number.isFinite(z)||p.contract.radiusM+z<=0)throw new RangeError('Finite elevation above sphere centre required');
  const geo=toGeographic(x,y);return sphereBasis(geo).up.map(v=>v*(p.contract.radiusM+z));
 };
 return Object.freeze({viewId,sourceWorldId:terrain.worldId,terrain,bounds,radiusM:p.contract.radiusM,
  contract:Object.freeze({...contract,projection:Object.freeze({...contract.projection}),metricOrigin:Object.freeze({...origin})}),
  toGeographic,toMetric,sampleGeographic,toECEF});
}

/** Native buffers for the existing GlobeRenderer. Fine/coarse coordinates are
 * identical: no raster reconstruction or parent-grid morph flattens a ridge.
 * This is a regional draw packet, not a certified cube-LOD replacement.
 */
export function* iterateTriangularPatchMesh(view,{minXM,minYM,maxXM,maxYM,maxTriangles=8192}={}) {
 if(!view?.terrain?.meshWindow||!Number.isSafeInteger(maxTriangles)||maxTriangles<1||maxTriangles>21845)throw new RangeError('Bounded 16-bit regional draw packet required');
 const window=view.terrain.meshWindow({minXM,minYM,maxXM,maxYM,maxTriangles});
 if(!window.triangles.length)throw new RangeError('No observed terrain in draw window');
 const count=window.triangles.length*3,vertex=new Float32Array(count*12),index=new Uint16Array(count),heightLifts=new Float32Array(count*6),anchor=view.toECEF((minXM+maxXM)/2,(minYM+maxYM)/2,0);
 let low=Infinity,high=-Infinity,maxVertexFloat32ErrorM=0,maxSampledChordErrorM=0;
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 for(let f=0;f<window.triangles.length;f++){
  const points=window.triangles[f].map(i=>window.points[i]),ecef=points.map(p=>view.toECEF(...p)),edge1=ecef[1].map((v,i)=>v-ecef[0][i]),edge2=ecef[2].map((v,i)=>v-ecef[0][i]),n=cross(edge1,edge2),length=Math.hypot(...n);
  if(!Number.isFinite(length)||length<=0)throw new RangeError('Degenerate geographic draw face');
  const normal=n.map(v=>v/length);
  for(let k=0;k<3;k++){
   const i=f*3+k,position=ecef[k].map((v,j)=>v-anchor[j]),up=ecef[k].map(v=>v/Math.hypot(...ecef[k])),z=points[k][2],lift=up.map(v=>v*z);
   vertex.set([...position,...position,.38,.49,.31,...normal],i*12);heightLifts.set([...lift,...lift],i*6);index[i]=i;
   low=Math.min(low,z);high=Math.max(high,z);maxVertexFloat32ErrorM=Math.max(maxVertexFloat32ErrorM,Math.hypot(...position.map((v,j)=>v-vertex[i*12+j])));
  }
  const centre=ecef[0].map((v,j)=>(v+ecef[1][j]+ecef[2][j])/3),r=Math.hypot(...centre),lat=Math.asin(centre[2]/r)*180/Math.PI,lon=Math.atan2(centre[1],centre[0])*180/Math.PI;
  try {maxSampledChordErrorM=Math.max(maxSampledChordErrorM,Math.abs(view.sampleGeographic(lat,lon).groundElevationM-(r-view.radiusM)));}
  catch(error){throw new RangeError(`Draw-face centroid is outside canonical coverage: ${error.message}`);}
  if((f+1)%128===0)yield {processedTriangles:f+1,totalTriangles:window.triangles.length};
 }
 return {tile:{kind:'triangular-region',viewId:view.viewId,bounds:window.bounds},anchor,vertex,index,heightLifts,
  overlayVertex:new Float32Array(),overlayIndex:new Uint16Array(),overlayHeightLifts:new Float32Array(),
  heightRangeM:[low,high],baseHeightRangeM:[low,high],waterIndexCount:0,morphErrorM:0,edgeMorphErrorM:[0,0,0,0],
  geometricError:{status:'uncertified-regional-packet',maxSampledChordErrorM},
  diagnostics:{sourceWorldId:view.sourceWorldId,viewId:view.viewId,triangles:window.triangles.length,
   maxVertexFloat32ErrorM,maxSampledChordErrorM,bufferBytes:vertex.byteLength+index.byteLength+heightLifts.byteLength,
   limitations:['Only finite centroid chord-error probes, not an adaptive LOD error certificate','No automatic insertion into a planet or cube-tile seam coupling','Actual browser/WebGL draw still requires verification']}};
}

/** Synchronous CLI/test wrapper over the exact same cooperative implementation. */
export function buildTriangularPatchMesh(view,options={}){
 const iterator=iterateTriangularPatchMesh(view,options);let step;
 do{step=iterator.next();}while(!step.done);return step.value;
}
