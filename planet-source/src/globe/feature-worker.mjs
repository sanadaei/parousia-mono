import {PagedSource} from './paged-source.mjs';
import {buildBuildingMesh} from './buildings.mjs';
import {meshHeightLifts} from './height-exaggeration.mjs';
let source,active=null;
self.onmessage=async({data:m})=>{
 if(m.type==='init'){source=new PagedSource(m.manifest,m.url);self.postMessage({type:'ready'});return;}
 if(m.type==='cancel'){if(active?.id===m.id)active.controller.abort();return;}
 if(active){self.postMessage({type:'error',id:m.id,error:'Feature worker already busy'});return;}
 if(m.retainedOwners)source.retainRoadWork(new Set(m.retainedOwners));
 const job={id:m.id,controller:new AbortController()};active=job;const releaseWater=source.beginWaterWork?.();
 try{const r=m.descriptor.crossingInspection?await source.crossingSites(m.descriptor,job.controller.signal):await source.featureRecipe(m.descriptor,job.controller.signal,{roadWorkSteps:32,owner:m.descriptor.path??m.descriptor.id??null});if(job.controller.signal.aborted)throw new DOMException('Cancelled','AbortError');
 if(m.descriptor.inspectionOnly){if(JSON.stringify(r).length>2*1024*1024)throw new RangeError('Inspection recipe exceeds display budget');self.postMessage({type:'result',id:m.id,result:{recipe:r}});return;}
 const routeSummary=r.routeStatus?{id:r.id,status:r.routeStatus.status,reason:r.routeStatus.reason??null,lengthM:r.routeStatus.lengthM??0}:null;
 const mesh=buildBuildingMesh(r,source.manifest.base.frame.radiusM,{includeRoads:true,coarse:m.descriptor.coarse,coarseSurfaces:m.descriptor.coarseSurfaces});mesh.routeSummary=routeSummary;mesh.layoutStatus=r.layoutStatus?{id:r.id,...r.layoutStatus}:null;mesh.heightLifts=meshHeightLifts(mesh.vertex,mesh.anchor,source.manifest.base.frame.radiusM);
 self.postMessage({type:'result',id:m.id,result:{mesh,routeSummary}},[mesh.vertex.buffer,mesh.index.buffer,mesh.heightLifts.buffer]);
 }catch(e){self.postMessage({type:e.name==='RoadSurveyPending'?'pending':e.name==='AbortError'?'cancelled':'error',id:m.id,error:e.message});}finally{releaseWater?.();active=null;}
};
