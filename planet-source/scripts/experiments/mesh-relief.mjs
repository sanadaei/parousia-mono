import {routeBasinGraph} from './mst-relief.mjs';
import {createReliefMesh,meshHeightSampler} from '../../src/core/triangular-geometry.mjs';
export {createReliefMesh,meshHeightSampler} from '../../src/core/triangular-geometry.mjs';
import {reliefTerrain} from './relief-terrain.mjs';
import {createTerrainAdapter} from '../../src/core/index.mjs';
import {boundedNodeField,materialColumn,inciseMaterialColumn} from './mesh-materials.mjs';

/** Same independently implemented basin routing and n=1 implicit incision,
 * now with metric edge lengths and explicit triangle areas. No diffusion or
 * lake/deposition model; immutable input, bounded execution and fixed outlets.
 */
export function evolveMeshRelief({mesh,initial,outlets,steps,dtYears,erodibility,areaExponent=.4,upliftMPerYear,lithology}={}) {
 const N=mesh?.nodeCount;
 if(!Number.isInteger(N)||N<3||N>65536||!initial||initial.length!==N||!initial.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7)||
    !Number.isInteger(steps)||steps<1||steps>200||
    ![dtYears,areaExponent].every(Number.isFinite)||dtYears<=0||dtYears>100000||
    areaExponent<0||areaExponent>1||!Array.isArray(outlets)||!outlets.length)throw new RangeError('Explicit bounded mesh evolution required');
 const K=boundedNodeField(erodibility,N,1e-12,.01,'erodibility'),U=boundedNodeField(upliftMPerYear,N,0,.1,'uplift');
 const column=materialColumn(lithology,K.values),offset=new Float64Array(N);let contactsCrossed=0;
 let z=Float64Array.from(initial),last=routeBasinGraph(z,mesh,{outlets});
 for(let t=0;t<steps;t++){
  for(let i=0;i<N;i++)if(!last.fixed[i]){const rise=U.values[i]*dtYears;z[i]+=rise;offset[i]+=rise;}
  last=routeBasinGraph(z,mesh,{outlets});const next=z.slice();
  for(const i of last.order){const q=last.receiver[i];if(q<0||z[i]<=next[q])continue;
   if(column){const s=inciseMaterialColumn(z[i],next[q],K.values[i]*last.area[i]**areaExponent/last.distance[i],dtYears,offset[i],column);next[i]=s.height;contactsCrossed+=s.crossings;}
   else {const a=dtYears*K.values[i]*last.area[i]**areaExponent/last.distance[i];next[i]=(z[i]+a*next[q])/(1+a);}}
  z=next;
 }
 last=routeBasinGraph(z,mesh,{outlets});
 return {heights:z,routing:last,report:{status:'UNADOPTED mesh research solver',meshId:mesh.id,nodes:N,
  areaMethod:mesh.areaMethod,steps,dtYears,erodibility:K.record,areaExponent,upliftMPerYear:U.record,
  ...(column?{lithology:{...column,coordinate:'initial material height; contacts advect with uplift',integration:'sharp-contact piecewise implicit; downstream endpoint held fixed',contactsCrossed}}:{}),
  outlets:[...new Set(outlets)].sort((a,b)=>a-b),...last.report,
  limitations:['Triangulation supplied externally; no all-pairs overlap proof','Lumped areas differ from a Voronoi discretization',
   'No diffusion, deposition or physically resolved lake overflow','No raster export or planetary integration implied']}};
}

/** Freeze an explicit regular sampling as the existing canonical C1 terrain.
 * The final raster is authoritative. This conversion can lose triangle detail;
 * it is not a claim of exact preservation between original mesh vertices.
 */
export function rasterizeReliefMesh(mesh,result,{n,extentM,originXM=0,originYM=0,seed,verticalDatum='synthetic-mesh-datum'}={}) {
 if(result?.report?.meshId!==mesh?.id||!Number.isInteger(n)||n<3||n>257||!Number.isFinite(extentM)||extentM<=0||extentM>100000||
    ![originXM,originYM].every(Number.isFinite))throw new RangeError('Identified result and bounded output grid required');
 const source=meshHeightSampler(mesh,result.heights);
 if(n*n*source.maxBucketLength>10000000)throw new RangeError('Mesh raster sampling budget exceeded');
 const heights=Array.from({length:n*n},(_,i)=>source.heightAt(originXM+(i%n)*extentM/(n-1),originYM+Math.floor(i/n)*extentM/(n-1)));
 const report={...result.report,n,extentM};delete report.outlets;
 const saved=reliefTerrain({heights,report},{seed,verticalDatum}).toSnapshot();delete saved.worldId;
 saved.references.reliefResearch.meshSource={meshId:mesh.id,nodeCount:mesh.nodeCount,
  outputNodes:n*n,sourceOriginM:{x:originXM,y:originYM},sourceOutletNodes:result.report.outlets,
  sourceOutletLocations:result.report.outlets.map(i=>({index:i,xM:mesh.contract.points[i][0],yM:mesh.contract.points[i][1]})),
  interpolation:'Barycentric triangle reconstruction sampled once, then canonical bounded C1 raster',
  limitation:'Source mesh and raster are not pointwise identical between sampled nodes; no raster water routing is asserted'};
 const terrain=createTerrainAdapter(saved);
 let maxNodeReconstructionDifferenceM=0,checked=0;
 for(let i=0;i<mesh.nodeCount;i++){
  const [x,y]=mesh.contract.points[i],u=x-originXM,v=y-originYM;
  if(u<0||v<0||u>extentM||v>extentM)continue;
  maxNodeReconstructionDifferenceM=Math.max(maxNodeReconstructionDifferenceM,Math.abs(terrain.groundElevationAt(u,v)-result.heights[i]));checked++;
 }
 return {terrain,diagnostics:{sourceNodesChecked:checked,maxNodeReconstructionDifferenceM,
  interpretation:'Finite source-node reconstruction error, not a continuous-interior error bound'}};
}

/** Preserve the solved triangulation itself as the canonical saved surface. */
export function preserveReliefMesh(mesh,result,{seed,verticalDatum='synthetic-mesh-datum'}={}) {
 if(result?.report?.meshId!==mesh?.id)throw new TypeError('Identified mesh result required');
 return createTerrainAdapter({schema:'minimal-world-triangular-terrain@1',seed,revision:'independent-mesh-relief@1',
  frame:{kind:'planar-metric',verticalDatum},mesh:mesh.contract,
  fields:{groundElevationM:Array.from(result.heights)},
  references:{reliefResearch:{status:'UNADOPTED research surface',sourceMeshId:mesh.id,parameters:result.report,
   limitation:'Canonical triangle geometry; no planetary adoption, water surface, or browser visual acceptance implied'}}});
}
