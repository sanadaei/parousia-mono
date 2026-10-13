import {coalesceRoadSegments,coarseParcelTriangles} from './feature-lod.mjs';
import {FeatureWorkerClient} from './feature-worker-client.mjs';
import {PagedSource} from './paged-source.mjs';
import {meshHeightLifts} from './height-exaggeration.mjs';
import {ByteLRU} from './lru.mjs';
import {roadCrossSectionAt} from '../core/road-cross-section.mjs';
import { validateBridgeStructures } from '../core/bridge-structures.mjs';
import { readPage } from './page-request.mjs';
import { metricRoads, tessellateRoadProfile } from '../core/road-geometry.mjs';
import { validateBuildings, buildingCorners } from '../core/building-geometry.mjs';
import { createSphericalProjection, sphereBasis } from '../core/spherical.mjs';
import { cross, normalize, dot } from './cube.mjs';
import { createHash } from '../core/sha256.mjs';

export function buildBuildingMesh(recipe, radiusM, { includeRoads = false, coarse = false, coarseSurfaces = coarse } = {}) {
  const projection = createSphericalProjection(recipe.projection);
  const center = sphereBasis({ latDeg: recipe.projection.centerLatDeg, lonDeg: recipe.projection.centerLonDeg }).up;
  const anchor = center.map(v => v * radiusM), vertex = [], index = [];
  const point = (x,y,z) => { const p=projection.toGeographic(x,y), d=sphereBasis(p).up; return d.map((v,i)=>v*(radiusM+z)-anchor[i]); };
  const triangle = (a,b,c,color) => {
    if(vertex.length/12+3>65535)throw new RangeError('Feature geometry exceeds Uint16 capacity');
    const n=normalize(cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i]))), start=vertex.length/12;
    for(const p of [a,b,c]) vertex.push(...p,...p,...color,...n);
    index.push(start,start+1,start+2);
  };
  const list = [...validateBuildings(recipe.buildings ?? []),...validateBuildings(recipe.vegetation ?? [])];
  if(list.length>512) throw new RangeError('Building mesh exceeds 512 buildings');
  const ids=new Set();
  for(const b of list) {
    if(typeof b.id!=='string'||ids.has(b.id)) throw new TypeError('Building IDs must be unique'); ids.add(b.id);
    if(b.vegetationKind==='tree'){
      const x=(b.bounds.minXM+b.bounds.maxXM)/2,y=(b.bounds.minYM+b.bounds.maxYM)/2,z=b.baseElevationM,r=b.canopyRadiusM,steps=coarse?4:6;
      if(!Number.isFinite(r)||r<=0||r>20)throw new RangeError('Invalid canopy');
      const ring=Array.from({length:steps},(_,i)=>point(x+Math.cos(i*2*Math.PI/steps)*r,y+Math.sin(i*2*Math.PI/steps)*r,z+b.heightM*.45)),top=point(x,y,z+b.heightM);
      for(let i=0;i<steps;i++)triangle(ring[i],ring[(i+1)%steps],top,b.roofColor);
      if(!coarse){const rr=(b.bounds.maxXM-b.bounds.minXM)/2,low=Array.from({length:4},(_,i)=>point(x+Math.cos(i*Math.PI/2)*rr,y+Math.sin(i*Math.PI/2)*rr,z)),high=Array.from({length:4},(_,i)=>point(x+Math.cos(i*Math.PI/2)*rr,y+Math.sin(i*Math.PI/2)*rr,z+b.heightM*.6));for(let i=0;i<4;i++){const j=(i+1)%4;triangle(low[i],low[j],high[j],b.wallColor);triangle(low[i],high[j],high[i],b.wallColor);}}
      continue;
    }
    const {minXM:x0,maxXM:x1,minYM:y0,maxYM:y1}=b.bounds;
    if(![x0,x1,y0,y1,b.baseElevationM,b.heightM,b.roofHeightM].every(Number.isFinite)||x1<=x0||y1<=y0||b.heightM<=0||b.roofHeightM<0) throw new RangeError('Invalid building dimensions');
    const z=b.baseElevationM, e=z+b.heightM, roof=e+b.roofHeightM;
    const corners=b.orientation?buildingCorners(b):b.roofAxis==='x'?[[x0,y1],[x0,y0],[x1,y0],[x1,y1]]:[[x0,y0],[x1,y0],[x1,y1],[x0,y1]], lower=corners.map(p=>point(...p,z)), upper=corners.map(p=>point(...p,e));
    const wall=b.wallColor??[.8,.7,.5], tile=b.roofColor??[.45,.18,.12];
    for(const color of [wall,tile]) if(color.length!==3||!color.every(v=>Number.isFinite(v)&&v>=0&&v<=1)) throw new RangeError('Invalid building color');
    if(!coarse)for(let i=0;i<4;i++) { const j=(i+1)%4;triangle(lower[i],lower[j],upper[j],wall);triangle(lower[i],upper[j],upper[i],wall); }
    if(coarse) { triangle(upper[0],upper[1],upper[2],tile);triangle(upper[0],upper[2],upper[3],tile);continue; }
    const r0=point((corners[0][0]+corners[1][0])/2,(corners[0][1]+corners[1][1])/2,roof), r1=point((corners[2][0]+corners[3][0])/2,(corners[2][1]+corners[3][1])/2,roof);
    triangle(upper[0],upper[1],r0,wall); triangle(upper[2],upper[3],r1,wall);
    triangle(upper[0],r0,r1,tile);triangle(upper[0],r1,upper[3],tile);
    triangle(r0,upper[1],upper[2],tile);triangle(r0,upper[2],r1,tile);
  }
  for(const parcel of recipe.landParcels??[]){if(parcel.triangles){for(const t of parcel.triangles)triangle(...t.map(p=>point(p.xM,p.yM,p.elevationM)),parcel.color);continue;}const n=parcel.steps+1,vertices=parcel.points.map(p=>point(p.xM,p.yM,p.elevationM)),reduced=coarseSurfaces?coarseParcelTriangles(vertices,parcel.steps):null;if(reduced){for(const t of reduced)triangle(...t,parcel.color);continue;}for(let y=0;y<parcel.steps;y++)for(let x=0;x<parcel.steps;x++){const indices=[y*n+x,y*n+x+1,(y+1)*n+x+1,(y+1)*n+x],q=indices.map(i=>vertices[i]);triangle(q[0],q[1],q[2],parcel.color);triangle(q[0],q[2],q[3],parcel.color);}}
  // Roads are permanent authored surfaces, just like walls. Rendering their
  // saved cross-sections avoids losing narrow decks between terrain samples.
  // Sample the same canonical cubic as Core, with a 5 mm vertical bound.
  if (includeRoads) for (const road of metricRoads(recipe.roadCenterlineProfiles ?? [])) {
    const tessellation=tessellateRoadProfile(road,coarseSurfaces?{elevationToleranceM:.1,maxSpanM:20}:undefined);
    const reduced=coarseSurfaces&&!road.road.crossSection&&!road.points.some(p=>['bridge-deck','approach-ramp'].includes(p.structureKind)||['bridge-deck','approach-ramp'].includes(p.segmentKind))?coalesceRoadSegments(tessellation):tessellation;
    for (const {a,b} of reduced) {
      const dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy);
      const nx=-dy/length*road.halfWidthM,ny=dx/length*road.halfWidthM;
      const offsets=road.road.crossSection?[-1,0,1]:[-1,1];
      for(let k=1;k<offsets.length;k++){const left=offsets[k-1],right=offsets[k],at=(p,f)=>point(p.xM+nx*f,p.yM+ny*f,p.roadElevationM+.025+roadCrossSectionAt(road.road.crossSection,p.distanceM,road.halfWidthM*f).offsetM),q=[at(a,left),at(b,left),at(b,right),at(a,right)];
      const color=road.road.surfaceMaterial==='compacted-earth'?[.46,.40,.29]:[.35,.36,.39];triangle(q[0],q[1],q[2],color);triangle(q[0],q[2],q[3],color);}
    }
  }
  if(includeRoads)for(const structure of validateBridgeStructures(recipe.bridgeStructures??[],recipe.roadCenterlineProfiles??[]))for(const box of structure.boxes){
    const d=box.direction,n={xM:-d.yM,yM:d.xM},corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({xM:box.center.xM+d.xM*a*box.lengthM/2+n.xM*b*box.widthM/2,yM:box.center.yM+d.yM*a*box.lengthM/2+n.yM*b*box.widthM/2}));
    const low=corners.map(p=>point(p.xM,p.yM,box.bottomElevationM)),high=corners.map(p=>point(p.xM,p.yM,box.topElevationM));
    for(let i=0;i<4;i++){const j=(i+1)%4;triangle(low[i],low[j],high[j],box.color);triangle(low[i],high[j],high[i],box.color);}
    triangle(high[0],high[1],high[2],box.color);triangle(high[0],high[2],high[3],box.color);triangle(low[0],low[2],low[1],box.color);triangle(low[0],low[3],low[2],box.color);
  }
  // C1 beds can be dry under an explicit incision cap and use nonlinear
  // profiles. Their water must come from the canonical terrain sampler in
  // mesh.mjs, never an unconditional legacy straight ribbon.
  if (includeRoads && !recipe.model?.bed) for (const edge of recipe.model?.edges ?? []) {
    for (let i=1;i<edge.points.length;i++) {
      const a=edge.points[i-1],b=edge.points[i],dx=b.xM-a.xM,dy=b.yM-a.yM,len=Math.hypot(dx,dy);
      if(!len)continue;const nx=-dy/len,ny=dx/len;
      const q=[point(a.xM-nx*a.halfWidthM,a.yM-ny*a.halfWidthM,a.waterLevelElevationM+.003),
        point(b.xM-nx*b.halfWidthM,b.yM-ny*b.halfWidthM,b.waterLevelElevationM+.003),
        point(b.xM+nx*b.halfWidthM,b.yM+ny*b.halfWidthM,b.waterLevelElevationM+.003),
        point(a.xM+nx*a.halfWidthM,a.yM+ny*a.halfWidthM,a.waterLevelElevationM+.003)];
      triangle(q[0],q[1],q[2],[.08,.47,.63]);triangle(q[0],q[2],q[3],[.08,.47,.63]);
    }
  }
  if(vertex.length/12>65535)throw new RangeError('Feature geometry exceeds Uint16 capacity');
  return { tile:{face:0,level:0,x:0,y:0},anchor,vertex:new Float32Array(vertex),index:new Uint16Array(index),
    overlayVertex:new Float32Array(),overlayIndex:new Uint16Array(),buildingIds:[...ids], kind:'buildings' };
}
/** Per-category slots prevent a dense city from starving the surrounding land.
 * Selection affects streaming only; it never creates or moves a feature. */
export function selectFeatureDescriptors(descriptors,camera,radiusM,limit=256){
 if(camera.altitude>30000)return[];
 const groups=[[],[],[],[]],kind=d=>d.landscapeTile?3:d.agriculturePlot!=null?2:d.roadLink?1:0;
 for(const d of descriptors){const distance=Math.acos(Math.max(-1,Math.min(1,dot(d.center,camera.targetUp))))*radiusM;if(distance-(d.angularRadius??0)*radiusM<Math.max(3000,camera.altitude*3))groups[kind(d)].push({d,distance});}
 for(const g of groups)g.sort((a,b)=>a.distance-b.distance||a.d.path.localeCompare(b.d.path));
 const selected=[],seen=new Set(),weights=[4,2,2,3];
 while(selected.length<limit&&groups.some(g=>g.length))for(let k=0;k<groups.length;k++)for(let n=0;n<weights[k]&&groups[k].length&&selected.length<limit;n++){const {d,distance}=groups[k].shift();if(seen.has(d.path))continue;seen.add(d.path);selected.push({...d,coarse:camera.altitude>(d.landscapeTile?300:1500)||distance>1800,coarseSurfaces:camera.altitude>200||distance>600});}
 return selected;
}
/** Separate persistent feature geometry: a house must not disappear merely
 * because its center falls in a tiny culled terrain tile. */
export class BuildingLayer {
  constructor(renderer,manifest,url) {this.renderer=renderer;this.proceduralSource=manifest.settlementCatalogue?new PagedSource(manifest,url):null;this.featureWorker=this.proceduralSource&&typeof Worker==='function'?new FeatureWorkerClient(manifest,url):null;this.preparing=false;this.prepareAt=0;this.manifest=manifest;this.url=url;this.loaded=new Map();this.routeResults=new Map();this.pending=new Set();this.jobs=new Map();this.empty=new Set();this.retryAfter=new Map();this.budgetDeferred=new Map();this.errors=[];this.destroyed=false;this.bytes=0;this.limit=16*1024*1024;this.meshCache=new ByteLRU(16*1024*1024);this.meshCacheHits=0;this.meshBuilds=0;this.controller=new AbortController();}
  update(camera) {
    if(this.proceduralSource&&camera.altitude<30000&&!this.preparing&&performance.now()>this.prepareAt){this.preparing=true;this.prepareAt=performance.now()+500;this.proceduralSource.prepareSettlements({center:camera.targetUp,angular:Math.min(20000,Math.max(1000,camera.altitude*2))/this.manifest.base.frame.radiusM},this.controller.signal).catch(e=>{if(e.name!=='AbortError')this.errors.push(e.message);}).finally(()=>{this.preparing=false;});}
    const descriptors=this.proceduralSource?.descriptors()??this.manifest.featureCharts??(this.manifest.features?[this.manifest.features]:[]);
    const selected=selectFeatureDescriptors(descriptors,camera,this.manifest.base.frame.radiusM);
    const wanted=new Set(selected.map(d=>d.path));
    for(const [key,tile] of this.loaded) if(!wanted.has(key)||selected.find(d=>d.path===key)?.coarse!==tile.coarse||selected.find(d=>d.path===key)?.coarseSurfaces!==tile.coarseSurfaces){this.renderer.dispose(tile);this.bytes-=tile.bytes;this.loaded.delete(key);}
    for(const [key,job]of this.jobs)if(!wanted.has(key))job.abort();
    this.wanted=wanted;this.priority=new Map(selected.map((d,i)=>[d.path,i]));for(const key of this.empty)if(!wanted.has(key))this.empty.delete(key);for(const key of this.retryAfter.keys())if(!wanted.has(key))this.retryAfter.delete(key);for(const key of this.budgetDeferred.keys())if(!wanted.has(key))this.budgetDeferred.delete(key);for(const key of this.routeResults.keys())if(!wanted.has(key))this.routeResults.delete(key);
    for(const d of selected){const deferred=this.budgetDeferred.get(d.path),cacheKey=JSON.stringify([d.path,d.sha256,d.bytes,d.coarse,d.coarseSurfaces]);if(deferred?.key===cacheKey&&!this.canMakeRoom(d.path,deferred.bytes))continue;if(deferred)this.budgetDeferred.delete(d.path);if(this.loaded.has(d.path)||this.empty.has(d.path)||(this.retryAfter.get(d.path)??0)>Date.now()||this.pending.has(d.path)||this.pending.size>=2)continue;this.load(d);}
    return [...this.loaded.values()].map(tile=>({tile,morph:1}));
  }
  async load(d) {
    this.pending.add(d.path);const job=new AbortController(),abort=()=>job.abort();this.jobs.set(d.path,job);this.controller.signal.addEventListener('abort',abort,{once:true});if(this.controller.signal.aborted)job.abort();
    try{
      const cacheKey=JSON.stringify([d.path,d.sha256,d.bytes,d.coarse,d.coarseSurfaces]);let mesh=this.meshCache.get(cacheKey);
      if(mesh)this.meshCacheHits++;
      else{
        if(this.featureWorker){const result=await this.featureWorker.generate(d,job.signal);mesh=result.mesh;if(result.routeSummary)this.routeResults.set(d.path,result.routeSummary);this.meshBuilds++;}
        else{
        let recipe;if(this.proceduralSource)recipe=await this.proceduralSource.featureRecipe(d,job.signal);else{const text=await readPage((...args)=>fetch(...args),new URL(d.path,this.url),{signal:job.signal,kind:'text'});if(new TextEncoder().encode(text).length!==d.bytes||createHash('sha256').update(text).digest('hex')!==d.sha256)throw new Error('Corrupt building page');recipe=JSON.parse(text);}
        if(this.destroyed)return;
        if(recipe.routeStatus)this.routeResults.set(d.path,{id:recipe.id,status:recipe.routeStatus.status,reason:recipe.routeStatus.reason??null,lengthM:recipe.routeStatus.lengthM??0});
        if(!recipe.vegetation?.length&&!recipe.landParcels?.length&&!recipe.buildings?.length&&!recipe.roadCenterlineProfiles?.length&&!recipe.model?.edges?.length){this.empty.add(d.path);return;}
        mesh=buildBuildingMesh(recipe,this.manifest.base.frame.radiusM,{includeRoads:true,coarse:d.coarse,coarseSurfaces:d.coarseSurfaces});mesh.routeSummary=this.routeResults.get(d.path)??null;mesh.layoutStatus=recipe.layoutStatus?{id:recipe.id,...recipe.layoutStatus}:null;this.meshBuilds++;
        }
        if(!mesh.index.length){this.empty.add(d.path);return;}
        mesh.heightLifts??=meshHeightLifts(mesh.vertex,mesh.anchor,this.manifest.base.frame.radiusM);const bytes=mesh.vertex.byteLength+mesh.index.byteLength+mesh.heightLifts.byteLength;
        if(bytes>this.limit){this.budgetDeferred.set(d.path,{bytes,key:cacheKey});throw new Error('Building cache budget exceeded');}
        this.meshCache.put(cacheKey,mesh,bytes);
      }
      mesh.heightLifts??=meshHeightLifts(mesh.vertex,mesh.anchor,this.manifest.base.frame.radiusM);const bytes=mesh.vertex.byteLength+mesh.index.byteLength+mesh.heightLifts.byteLength;
      if(this.destroyed||!this.wanted.has(d.path))return;
      if(mesh.routeSummary)this.routeResults.set(d.path,mesh.routeSummary);
      if(!this.makeRoom(d.path,bytes)){this.budgetDeferred.set(d.path,{bytes,key:cacheKey});return;}
      const tile=this.renderer.upload(mesh);tile.coarse=d.coarse;tile.coarseSurfaces=d.coarseSurfaces;tile.buildingIds=mesh.buildingIds;tile.layoutStatus=mesh.layoutStatus;tile.kind='buildings';this.loaded.set(d.path,tile);this.bytes+=tile.bytes;this.retryAfter.delete(d.path);
    }catch(e){if(e.name!=='AbortError'){this.retryAfter.set(d.path,Date.now()+10000);this.errors.push(e.message);if(this.errors.length>8)this.errors.shift();}}
    finally{this.controller.signal.removeEventListener('abort',abort);this.jobs.delete(d.path);this.pending.delete(d.path);}
  }
  canMakeRoom(path,bytes){
    if(bytes>this.limit)return false;
    const rank=this.priority?.get(path)??Infinity;
    let available=this.limit-this.bytes;
    for(const [key,tile]of this.loaded)if((this.priority?.get(key)??Infinity)>rank)available+=tile.bytes;
    return available>=bytes;
  }
  makeRoom(path,bytes){
    // Never evict useful geometry unless the requested tile can actually fit.
    if(!this.canMakeRoom(path,bytes))return false;
    const rank=this.priority?.get(path)??Infinity;
    const victims=[...this.loaded.entries()].filter(([key])=>(this.priority?.get(key)??Infinity)>rank).sort(([a],[b])=>(this.priority?.get(b)??Infinity)-(this.priority?.get(a)??Infinity));
    for(const [key,tile] of victims){if(this.bytes+bytes<=this.limit)break;this.renderer.dispose(tile);this.bytes-=tile.bytes;this.loaded.delete(key);}
    return this.bytes+bytes<=this.limit;
  }
  stats(){return{loadedFeatures:this.loaded.size,wantedFeatures:this.wanted?.size??0,budgetDeferred:this.budgetDeferred.size,routes:[...this.routeResults.values()],layouts:[...this.loaded.values()].map(t=>t.layoutStatus).filter(Boolean),settlementPageBytesEstimated:this.proceduralSource?.settlementPages.cache.bytes??0,retainedMeshBytes:this.meshCache.bytes,meshCacheLimitBytes:this.meshCache.maxBytes,meshCacheHits:this.meshCacheHits,meshBuilds:this.meshBuilds,meshEvictions:this.meshCache.evictions,uploadedBytes:this.bytes,pending:this.pending.size,errors:[...this.errors]};}
  destroy(){this.destroyed=true;this.controller.abort();this.featureWorker?.destroy();for(const tile of this.loaded.values())this.renderer.dispose(tile);this.loaded.clear();this.budgetDeferred.clear();this.meshCache.clear();this.proceduralSource?.settlementPages.cache.clear();this.proceduralSource?.cache.clear();this.proceduralSource?.anchors.clear();this.proceduralSource?.roadClearances.clear();this.proceduralSource?.settlementLand.clear();this.bytes=0;}
}
