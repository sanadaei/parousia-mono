import {createReliefMesh,meshHeightSampler} from './triangular-geometry.mjs';
import {copyJson,hashJson} from './json-contract.mjs';
import {unitNormalForGradient} from './surface-derivatives.mjs';
import {surfaceTracePlan,completeSurfaceTrace} from './surface-trace.mjs';

export const TRIANGULAR_TERRAIN_SCHEMA='minimal-world-triangular-terrain@1';
/** Saved piecewise-linear metric surface. No raster reconstruction and no
 * procedural work at query time. Triangle edges may be genuine creases.
 * Supplied topology must be a nonoverlapping triangulation; holes reject queries.
 */
export function createTriangularTerrain(input) {
 if(input?.schema!==TRIANGULAR_TERRAIN_SCHEMA||input.frame?.kind!=='planar-metric')throw new TypeError('Triangular metric terrain required');
 for(const key of ['seed','revision'])if(typeof input[key]!=='string'||!input[key].trim())throw new TypeError(`${key} required`);
 if(typeof input.frame.verticalDatum!=='string'||!input.frame.verticalDatum.trim())throw new TypeError('verticalDatum required');
 if(input.hydrology!=null||input.fields?.waterLevelElevationM!=null)throw new TypeError('Triangular water model is not implemented');
 const mesh=createReliefMesh(input.mesh),heights=Array.from(input.fields?.groundElevationM??[]);
 const sampler=meshHeightSampler(mesh,heights);
 const state={schema:TRIANGULAR_TERRAIN_SCHEMA,seed:input.seed,revision:input.revision,
  frame:{kind:'planar-metric',verticalDatum:input.frame.verticalDatum},
  interpolation:'barycentric-triangles@1',mesh:mesh.contract,
  fields:{groundElevationM:heights},references:copyJson(input.references??{})};
 if(input.interpolation!=null&&input.interpolation!==state.interpolation)throw new TypeError('Unsupported triangle interpolation');
 const worldId=hashJson(state);
 if(input.worldId!=null&&input.worldId!==worldId)throw new TypeError('Terrain worldId mismatch');
 const {minX,minY,maxX,maxY}=sampler.bounds;
 const bounds=Object.freeze({minXM:minX,minYM:minY,maxXM:maxX,maxYM:maxY});
 function sampleAt(xM,yM){const p=sampler.sampleAt(xM,yM);return {worldId,xM,yM,groundElevationM:p.height,
  gradient:p.gradient,slopeMPerM:Math.hypot(p.gradient.x,p.gradient.y),triangleIndex:p.triangleIndex,
  gradientStatus:p.onEdge?'one-sided-at-triangle-edge':'triangle-interior',
  hydrologyStatus:'unresolved',waterLevelElevationM:null,waterSurfaceElevationM:null,waterDepthM:null,surfaceKind:'unresolved'};}
 function surfaceFrameAt(x,y){const s=sampleAt(x,y);return {...s,normal:unitNormalForGradient(s.gradient),
  curvature:null,curvatureStatus:'not-defined-for-piecewise-linear-surface'};}
 function sampleWindow({minXM,minYM,maxXM,maxYM,spacingM}={}){
  if(![minXM,minYM,maxXM,maxYM,spacingM].every(Number.isFinite)||spacingM<=0||maxXM<=minXM||maxYM<=minYM)throw new RangeError('Finite positive sampling window required');
  const nx=Math.round((maxXM-minXM)/spacingM),ny=Math.round((maxYM-minYM)/spacingM);
  if(!Number.isSafeInteger(nx)||!Number.isSafeInteger(ny)||nx<1||ny<1||(nx+1)*(ny+1)>262144||
   Math.abs(nx*spacingM-(maxXM-minXM))>Math.max(1,maxXM-minXM)*1e-10||Math.abs(ny*spacingM-(maxYM-minYM))>Math.max(1,maxYM-minYM)*1e-10)throw new RangeError('Window must fit bounded whole spacing multiples');
  if((nx+1)*(ny+1)*sampler.maxBucketLength>10000000)throw new RangeError('Mesh window query budget exceeded');
  const samples=[];for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)samples.push(sampleAt(x===nx?maxXM:minXM+x*spacingM,y===ny?maxYM:minYM+y*spacingM));
  return {worldId,bounds:{minXM,minYM,maxXM,maxYM},spacingM,columns:nx+1,rows:ny+1,samples};
 }
 /** Exact planar clipping for near-field geometry. No regular resampling,
  * coordinate quantization, smoothing, or fabricated faces across holes.
  * Output budgets are explicit; an over-budget window fails, never truncates.
  */
 function meshWindow({minXM,minYM,maxXM,maxYM,maxTriangles=8192}={}){
  if(!Number.isSafeInteger(maxTriangles)||maxTriangles<1||maxTriangles>131072)throw new RangeError('Invalid triangle output budget');
  const window={minXM,minYM,maxXM,maxYM},candidates=sampler.triangleCandidates(window),points=[],triangles=[],sourceTriangles=[];
  const intersection=(a,b,axis,limit)=>{
   // Canonical endpoint ordering makes a shared cut independent of face winding.
   if(a[axis]>b[axis])[a,b]=[b,a];
   const t=(limit-a[axis])/(b[axis]-a[axis]);
   const p=a.map((v,k)=>k===axis?limit:v+(b[k]-v)*t);return p;
  };
  for(const index of candidates){
   let polygon=mesh.contract.triangles[index].map(i=>[...mesh.contract.points[i],heights[i]]);
   for(const [axis,limit,greater] of [[0,minXM,true],[0,maxXM,false],[1,minYM,true],[1,maxYM,false]]){
    const next=[];for(let k=0;k<polygon.length;k++){
     const a=polygon[k],b=polygon[(k+1)%polygon.length],insideA=greater?a[axis]>=limit:a[axis]<=limit,insideB=greater?b[axis]>=limit:b[axis]<=limit;
     if(insideA)next.push(a);if(insideA!==insideB)next.push(intersection(a,b,axis,limit));
    }
    polygon=next;if(!polygon.length)break;
   }
   for(let k=1;k+1<polygon.length;k++){
    const a=polygon[0],b=polygon[k],c=polygon[k+1],area2=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if(area2<=1e-12)continue;
    if(triangles.length>=maxTriangles)throw new RangeError('Mesh window exceeds triangle output budget');
    const offset=points.length;points.push(a.slice(),b.slice(),c.slice());triangles.push([offset,offset+1,offset+2]);sourceTriangles.push(index);
   }
  }
  return {worldId,bounds:window,points,triangles,sourceTriangles,candidateTriangles:candidates.length,
   interpolation:'exact-clipped-barycentric-triangles@1',coverage:'source triangles only; holes retained'};
 }
 // Add every crossed edge: piecewise-linear segment extrema cannot hide between
 // marks. Collinear edge endpoints are included as well. Bounded by mesh size.
 const edges=[];for(let i=0;i<mesh.nodeCount;i++)for(const q of mesh.neighbors[i])if(i<q.i)edges.push([mesh.contract.points[i],mesh.contract.points[q.i]]);
 function traceSurfaceSegment(a,b,{maxStepM=2,maxSamples=262144}={}){
  sampleAt(a?.xM,a?.yM);sampleAt(b?.xM,b?.yM);
  const plan=surfaceTracePlan(a,b,maxStepM,maxSamples),dx=b.xM-a.xM,dy=b.yM-a.yM,l2=dx*dx+dy*dy;
  const cross=(x,y,u,v)=>x*v-y*u;
  for(const [p,q] of edges){const ex=q[0]-p[0],ey=q[1]-p[1],px=p[0]-a.xM,py=p[1]-a.yM,den=cross(dx,dy,ex,ey);
   if(Math.abs(den)>1e-14*Math.max(1,Math.hypot(dx,dy)*Math.hypot(ex,ey))){const t=cross(px,py,ex,ey)/den,u=cross(px,py,dx,dy)/den;
    if(t>0&&t<1&&u>=-1e-10&&u<=1+1e-10)plan.marks.add(t);
   }else if(l2>0&&Math.abs(cross(px,py,dx,dy))<=1e-10*Math.max(1,l2)){
    for(const v of [p,q]){const t=((v[0]-a.xM)*dx+(v[1]-a.yM)*dy)/l2;if(t>0&&t<1)plan.marks.add(t);}
   }
   if(plan.marks.size>maxSamples)throw new RangeError('Surface trace exceeds sample budget');
  }
  return completeSurfaceTrace(plan,{worldId,maxStepM,maxSamples,sampleAt});
 }
 return Object.freeze({worldId,bounds,frame:Object.freeze({...state.frame}),hydrologyStatus:'unresolved',
  sampleAt,surfaceFrameAt,meshWindow,groundElevationAt:(x,y)=>sampler.heightAt(x,y),sampleWindow,traceSurfaceSegment,
  toSnapshot:()=>({...structuredClone(state),worldId}),
  // Exact rendering geometry is separate from regular preview sampling.
  toMesh:()=>({worldId,points:mesh.contract.points.map((p,i)=>[...p,heights[i]]),triangles:mesh.contract.triangles.map(t=>t.slice())})});
}
