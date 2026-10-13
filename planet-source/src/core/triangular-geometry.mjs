import {hashJson} from './json-contract.mjs';

/** Explicit triangular research mesh, independent of any external solver.
 * The caller supplies a nonoverlapping triangulation. We validate index/edge
 * topology and triangle orientation, NOT all geometric intersection pairs.
 * Lumped triangle areas (one third per vertex), not Voronoi areas.
 */
export function createReliefMesh({points,triangles}={}) {
 if(!Array.isArray(points)||points.length<3||points.length>65536||
    !Array.isArray(triangles)||!triangles.length||triangles.length>2*points.length)throw new RangeError('Bounded triangular mesh required');
 const p=points.map(v=>{if(!Array.isArray(v)||v.length!==2||!v.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e7))throw new TypeError('Finite metric mesh points required');return v.slice();});
 const N=p.length,areas=new Float64Array(N),links=new Map(),seen=new Set();
 const owned=triangles.map(t=>{
  if(!Array.isArray(t)||t.length!==3||new Set(t).size!==3||!t.every(i=>Number.isInteger(i)&&i>=0&&i<N))throw new TypeError('Valid triangle indices required');
  const key=t.slice().sort((a,b)=>a-b).join(':');if(seen.has(key))throw new TypeError('Duplicate triangle');seen.add(key);
  const [a,b,c]=t.map(i=>p[i]),twice=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(!Number.isFinite(twice)||twice<=1e-12)throw new RangeError('Positive nondegenerate counterclockwise triangles required');
  for(const i of t)areas[i]+=twice/6;
  for(let k=0;k<3;k++){
   const i=Math.min(t[k],t[(k+1)%3]),j=Math.max(t[k],t[(k+1)%3]),key=i+':'+j;
   const e=links.get(key)??{i,j,count:0,distanceM:Math.hypot(p[i][0]-p[j][0],p[i][1]-p[j][1])};
   if(++e.count>2)throw new RangeError('Nonmanifold edge');links.set(key,e);
  }
  return t.slice();
 });
 if(areas.some(a=>!Number.isFinite(a)||a<=0))throw new RangeError('Isolated or invalid-area mesh node');
 const neighbors=Array.from({length:N},()=>[]),boundary=new Set();
 for(const e of links.values()) {
  if(e.distanceM<1e-6)throw new RangeError('Mesh edge below metric resolution');
  neighbors[e.i].push({i:e.j,distanceM:e.distanceM});neighbors[e.j].push({i:e.i,distanceM:e.distanceM});
  if(e.count===1){boundary.add(e.i);boundary.add(e.j);}
 }
 for(const q of neighbors)q.sort((a,b)=>a.i-b.i);
 const contract={method:'explicit-triangular-relief-grid@1',points:p,triangles:owned};
 return {nodeCount:N,neighbors,nodeAreasM2:areas,boundaryNodes:[...boundary].sort((a,b)=>a-b),
  contract:structuredClone(contract),id:hashJson(contract),areaMethod:'triangle-area/3 lumped planar area'};
}

/** Spatially indexed barycentric reconstruction. Missing coverage is an error;
 * no extrapolation, random jitter, erosion or LOD-dependent work at query time.
 */
export function meshHeightSampler(mesh,heights) {
 if(!mesh?.contract||hashJson(mesh.contract)!==mesh.id||heights?.length!==mesh.nodeCount||
    !heights.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7))throw new TypeError('Identified mesh and finite node heights required');
 const points=mesh.contract.points.map(p=>p.slice()),triangles=mesh.contract.triangles.map(t=>t.slice()),z=Float64Array.from(heights);
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(const [x,y] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
 const size=Math.min(128,Math.ceil(Math.sqrt(triangles.length))),buckets=Array.from({length:size*size},()=>[]);
 const ix=x=>Math.max(0,Math.min(size-1,Math.floor((x-minX)/(maxX-minX)*size)));
 const iy=y=>Math.max(0,Math.min(size-1,Math.floor((y-minY)/(maxY-minY)*size)));
 let entries=0,maxBucketLength=0;
 for(let k=0;k<triangles.length;k++){
  const p=triangles[k].map(i=>points[i]),x0=ix(Math.min(...p.map(p=>p[0]))),x1=ix(Math.max(...p.map(p=>p[0]))),
    y0=iy(Math.min(...p.map(p=>p[1]))),y1=iy(Math.max(...p.map(p=>p[1])));
  entries+=(x1-x0+1)*(y1-y0+1);if(entries>2000000)throw new RangeError('Mesh interpolation index budget exceeded');
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const b=buckets[y*size+x];b.push(k);maxBucketLength=Math.max(maxBucketLength,b.length);
  }
 }
 if(maxBucketLength>4096)throw new RangeError('Mesh query candidate budget exceeded');
 const sampleAt=(x,y)=>{
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<minX||x>maxX||y<minY||y>maxY)throw new RangeError('Sample outside mesh bounds');
  for(const k of buckets[iy(y)*size+ix(x)]){
   const [i,j,l]=triangles[k],[a,b,c]=[points[i],points[j],points[l]],
    den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]),
    u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,
    v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den,w=1-u-v;
   if(Math.min(u,v,w)>=-1e-10){const aa=Math.max(0,u),bb=Math.max(0,v),cc=Math.max(0,w);return {height:(aa*z[i]+bb*z[j]+cc*z[l])/(aa+bb+cc), triangleIndex:k,
 gradient:{x:((b[1]-c[1])*z[i]+(c[1]-a[1])*z[j]+(a[1]-b[1])*z[l])/den,
 y:((c[0]-b[0])*z[i]+(a[0]-c[0])*z[j]+(b[0]-a[0])*z[l])/den},
 onEdge:Math.min(u,v,w)<=1e-10};}
  }
  throw new RangeError('Sample lies in uncovered mesh region');
 };
 const triangleCandidates=({minXM,minYM,maxXM,maxYM})=>{
  if(![minXM,minYM,maxXM,maxYM].every(Number.isFinite)||minXM<minX||maxXM>maxX||minYM<minY||maxYM>maxY||maxXM<=minXM||maxYM<=minYM)throw new RangeError('Positive window inside mesh bounds required');
  const found=new Set();for(let y=iy(minYM);y<=iy(maxYM);y++)for(let x=ix(minXM);x<=ix(maxXM);x++)for(const i of buckets[y*size+x])found.add(i);
  return [...found].sort((a,b)=>a-b);
 };
 return {heightAt:(x,y)=>sampleAt(x,y).height,sampleAt,triangleCandidates,maxBucketLength,bounds:{minX,minY,maxX,maxY}};
}

