import {loadFrontierPriorities} from './load-frontier.mjs';
import { waterVisibilityUpperBound, uniformReservoir } from './water-visibility.mjs';
import { LodPriorityQueue } from './lod-priority.mjs';
import { balanceRefinedBranchSteps, balanceDisplayedLeaves, neighborTopologyStats, neighborViolations, neighborViolationSteps, stitchMasks } from './lod-neighbors.mjs';
import { ByteLRU } from './lru.mjs';
import { tileKey, children, tileBound, dot, length, parentTile, nearestTileDirection } from './cube.mjs';
import { displayedGroundError, groundIntervalError, tileGeometricError, projectedErrorPixels, intersectingFeatures, featureDisplacementBounds, LOD_TARGET_PIXELS } from './lod.mjs';
export const STREAM_LIMITS = Object.freeze({ workers: 2, gpuBytes: 63 * 1024 * 1024, fieldBytesPerWorker: 256 * 1024,
  anchorBytesPerWorker: 128 * 1024, maxWantedTiles: 3072, maxPendingUploads: 4, maxVisitedNodes: 9600, maxLevel: 28, morphMs: 400 });
/** Explicit fixed presets; neither grows in response to allocation pressure. */
export function streamLimitsForBudget(meshBudgetMiB=64){
  if(![64,128].includes(meshBudgetMiB))throw new RangeError('Mesh budget must be 64 or 128 MiB');
  return Object.freeze({...STREAM_LIMITS,gpuBytes:(meshBudgetMiB-1)*1024*1024,
    maxWantedTiles:meshBudgetMiB===64?3072:6144,maxVisitedNodes:meshBudgetMiB===64?9600:19200});
}
export class GlobeStream {
  get limits(){return this._limits??STREAM_LIMITS;}
  constructor(renderer, manifest, url, {meshBudgetMiB=64}={}) {
    this._limits=streamLimitsForBudget(meshBudgetMiB);
    this.renderer = renderer; this.manifest = manifest; this.url = url; this.cache = new ByteLRU(this.limits.gpuBytes, t => {renderer.dispose(t);this.frameReuse=null;});
    this.workers = []; this.wanted = new Map(); this.uploads = []; this.jobId = 0; this.generation = 0; this.errors = []; this.cancelled = 0; this.completed = 0; this.witnesses = []; this.probeRequest = null;
    this.transitionPins = new Set(); this.lodQuality = {}; this.failedUntil = new Map();
    for (let i = 0; i < this.limits.workers; i++) {
      const slot = { worker:null, ready:false, job:null, stats:{}, failures:0, restarts:0, retryAt:0 };
      this.workers.push(slot); this.startWorker(slot);
    }
  }
  rememberMeshBytes(tile,bytes) {
    if(!Number.isFinite(bytes)||bytes<0)throw new RangeError('Invalid observed mesh size');
    this.observedTileBytes??=new Map();const key=tileKey(tile);
    if(this.observedTileBytes.get(key)!==bytes)this.meshBudgetRevision=(this.meshBudgetRevision??0)+1;
    this.observedTileBytes.delete(key);this.observedTileBytes.set(key,bytes);
    while(this.observedTileBytes.size>2048)this.observedTileBytes.delete(this.observedTileBytes.keys().next().value);
  }
  estimatedMeshBytes(tile) {
    return this.cache?.entries.get(tileKey(tile))?.bytes??this.observedTileBytes?.get(tileKey(tile))??65536;
  }
  deferTile(key,until) {
    this.failedUntil??=new Map();this.failedUntil.delete(key);this.failedUntil.set(key,until);
    while(this.failedUntil.size>1024)this.failedUntil.delete(this.failedUntil.keys().next().value);
  }
  workerFailure(slot, error) {
    if(this.destroyed)return;
    const job=slot.job;slot.job=null;slot.ready=false;
    slot.worker?.terminate();slot.worker=null;
    slot.failures++;slot.retryAt=Date.now()+Math.min(60000,1000*2**Math.min(6,slot.failures-1));
    if(job?.tile)this.deferTile(tileKey(job.tile),slot.retryAt);
    job?.reject?.(new Error(error));this.planningSignature=null;
    this.errors.push(`Worker restart pending: ${error}`);if(this.errors.length>10)this.errors.shift();
  }
  startWorker(slot) {
    if(this.destroyed)return;
    try {
      const worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
      slot.worker=worker;slot.ready=false;slot.startedAt=Date.now();slot.retryAt=0;
      worker.onmessage=({data})=>{
        if(this.destroyed||slot.worker!==worker)return;
        if(data.type==='ready'){slot.ready=true;}
        else {
          const job=slot.job;
          // Late/cancelled output must never clear a newer request.
          if(!job||data.id!==job.id||!['mesh','probe','cancelled','error'].includes(data.type))return;
          slot.job=null;slot.stats=data.stats??slot.stats;
          if(data.type==='mesh'){slot.failures=0;this.completed++;if(this.wanted.has(tileKey(data.mesh.tile)))this.uploads.push(data.mesh);}
          if(data.type==='probe'){slot.failures=0;job.resolve?.(data);}
          if(data.type==='cancelled'){this.cancelled++;job.reject?.(new Error('Probe cancelled'));}
          if(data.type==='error'){this.planningSignature=null;this.errors.push(data.error);if(this.errors.length>10)this.errors.shift();if(job.tile){const key=tileKey(job.tile);this.wanted.delete(key);this.deferTile(key,Date.now()+10000);}job.reject?.(new Error(data.error));}
        }
        this.dispatch();
      };
      worker.onerror=e=>{if(slot.worker!==worker)return;e.preventDefault?.();this.workerFailure(slot,e.message??'Worker error');};
      worker.onmessageerror=()=>{if(slot.worker===worker)this.workerFailure(slot,'Worker message could not be decoded');};
      worker.postMessage({type:'init',manifest:this.manifest,url:this.url});
    } catch(e) { this.workerFailure(slot,e.message); }
  }
  restartWorkers() {
    if(this.destroyed)return;
    for(const slot of this.workers){slot.job?.reject?.(new Error('Worker manually restarted'));slot.job=null;slot.worker?.terminate();slot.worker=null;slot.ready=false;slot.failures=0;slot.retryAt=0;slot.restarts++;this.startWorker(slot);}
    this.planningSignature=null;
  }
  recoverWorkers() {
    const now=Date.now();
    for(const slot of this.workers){
      if(slot.worker&&(!slot.ready&&now-slot.startedAt>15000||slot.job&&now-slot.job.startedAt>120000))this.workerFailure(slot,`Worker deadline exceeded${slot.job?.tile?' at '+tileKey(slot.job.tile):slot.job?.point?' probing '+JSON.stringify(slot.job.point):' during initialization'}`);
      if(!slot.worker&&now>=slot.retryAt){slot.restarts++;this.startWorker(slot);}
    }
  }

  // Immutable manifest metadata only. Mesh bounds remain live. Reference-path ranges use exact reference values.
  // FIFO capacity is independent of camera travel; replacing the manifest resets it.
  tileInfo(tile) {
    if(this.tileInfoManifest!==this.manifest){this.tileInfos=new Map();this.tileInfoManifest=this.manifest;}
    const key=tileKey(tile),hit=this.tileInfos.get(key);if(hit){this.tileInfoHits=(this.tileInfoHits??0)+1;return hit;}
    const bound=tileBound(tile,this.manifest.base.frame.radiusM),features=intersectingFeatures(this.manifest,bound);
    const info={bound,features,waterUpper:waterVisibilityUpperBound(this.manifest,bound)};
    if(this.tileInfos.size>=4096)this.tileInfos.delete(this.tileInfos.keys().next().value);
    this.tileInfos.set(key,info);return info;
  }
  visible(t, camera) {
    const info=this.tileInfo(t),b = info.bound, radius = this.manifest.base.frame.radiusM;
    const rangeGlobal = (this.manifest.elevationRangeM ?? [0, this.manifest.reliefBoundM]).map(v=>v*(camera.heightScale??1)), inner = radius + rangeGlobal[0];
    const horizon = Math.acos(Math.min(1, inner / length(camera.eye))) + Math.acos(Math.min(1, inner / (radius + rangeGlobal[1])));
    if (Math.acos(Math.max(-1, Math.min(1, dot(b.center, camera.eyeUnit)))) > horizon + b.angular + .002) return false;
    let range = this.heightRange(b, camera, t);
    const waterOnly=this.waterOnlyBound(t,camera,b,range);
    if(waterOnly)range=waterOnly.range;
    else {
    // Culling must cover water and bridge decks even when the bed is far
    // below the camera. Keep ground-only intervals for precision/LOD claims.
    range[1]=Math.max(range[1],info.waterUpper);
    const features=info.features.filter(f=>f.kind!=='river');
    if(features.length){const base=this.heightRange(b,camera,t,true);range[1]=Math.max(range[1],base[1]+Math.max(...features.map(f=>f.maximumOffsetM??f.verticalAllowanceM)));}
    }
    range=range.map(v=>v*(camera.heightScale??1));
    const padding=.02+2**-21*(4*b.radiusM+range[1]-range[0]);
    range=[range[0]-padding,range[1]+padding];
    const mid = (range[0] + range[1]) / 2;
    const relative=b.center.map((v,i)=>v*(radius+mid)-camera.eye[i]),rb=b.radiusM*(1+Math.max(Math.abs(range[0]),Math.abs(range[1]))/radius)+128*Number.EPSILON*radius,vertical=(range[1]-range[0])/2;
    const support=n=>rb*Math.hypot(...n)+vertical*Math.abs(dot(b.center,n));
    if(dot(relative,camera.forward)+support(camera.forward)<=camera.near)return false;
    for(const[axis,scale]of[[camera.right,camera.aspect/camera.focal],[camera.up,1/camera.focal]])for(const sign of[-1,1]){
      const plane=camera.forward.map((v,i)=>v*scale+axis[i]*sign);if(dot(relative,plane)+support(plane)<0)return false;
    }
    return true;
  }
  heightRange(b, camera, tile = null, baseOnly = false) {
    const m = this.manifest, radius = m.base.frame.radiusM, rows = m.base.grid.rows;
    const lat = Math.asin(b.center[2]), low = Math.max(-Math.PI / 2, lat - b.angular), high = Math.min(Math.PI / 2, lat + b.angular);
    const info=tile?this.tileInfo(tile):null;
    const [lowerOffset,upperOffset]=baseOnly?[0,0]:featureDisplacementBounds(m,b,info?.features);
    let min = (m.elevationRangeM?.[0] ?? -m.reliefBoundM) + lowerOffset, max = (m.elevationRangeM?.[1] ?? m.reliefBoundM) + upperOffset;
    if (camera.groundReference && m.rowLipschitz?.length === rows - 1 && m.poleLipschitz?.length === 2) {
      const reference=camera.groundReference,prior=info?.referenceBound;
      if(prior&&prior.elevationM===reference.elevationM&&prior.up.every((v,i)=>v===reference.up[i])){
        min=Math.max(min,prior.range[0]+lowerOffset);max=Math.min(max,prior.range[1]+upperOffset);
      }else{
      const a = Math.max(0, Math.floor((Math.PI / 2 - high) / Math.PI * rows - .5)), z = Math.min(rows - 2, Math.ceil((Math.PI / 2 - low) / Math.PI * rows - .5));
      let slope = 0;
      const include = value => { slope = Number.isFinite(value) && value >= 0 ? Math.max(slope, value) : NaN; };
      for (let i = a; i <= z; i++) include(m.rowLipschitz[i]);
      const angular = Math.acos(Math.max(-1, Math.min(1, dot(b.center, reference.up))));
      // A shortest path between the reference and disk stays within this
      // enlarged latitude range. Include its strip bounds as well.
      const refLat = Math.asin(reference.up[2]), pathHigh = Math.min(Math.PI / 2, refLat + angular + b.angular), pathLow = Math.max(-Math.PI / 2, refLat - angular - b.angular);
      const y0 = Math.max(0, Math.floor((Math.PI / 2 - pathHigh) / Math.PI * rows - .5)), y1 = Math.min(rows - 2, Math.ceil((Math.PI / 2 - pathLow) / Math.PI * rows - .5));
      for (let i = y0; i <= y1; i++) include(m.rowLipschitz[i]);
      if (pathHigh > Math.PI / 2 - Math.PI / (2 * rows)) include(m.poleLipschitz[0]);
      if (pathLow < -Math.PI / 2 + Math.PI / (2 * rows)) include(m.poleLipschitz[1]);
      const error = slope * radius * (angular + b.angular);
      const range=Number.isFinite(error)&&slope>=0?[reference.elevationM-error,reference.elevationM+error]:[-Infinity,Infinity];
      if(info)info.referenceBound={up:[...reference.up],elevationM:reference.elevationM,range};
      min=Math.max(min,range[0]+lowerOffset);max=Math.min(max,range[1]+upperOffset);
      }
    }
    for (let t = tile; t; t = parentTile(t)) {
      const cachedTile = this.cache?.entries.get(tileKey(t))?.value;
      const cached = baseOnly ? cachedTile?.baseHeightRangeM : cachedTile?.heightRangeM;
      if (cached) { min = Math.max(min, cached[0]); max = Math.min(max, cached[1]); break; }
    }
    return [min, max];
  }
  waterOnlyBound(tile,camera,bound=this.tileInfo(tile).bound,range=this.heightRange(bound,camera,tile)) {
    if((camera.heightScale??1)!==1)return null;
    if(this.tileInfo(tile).features.some(f=>f.kind!=='river'))return null;
    const reservoir=uniformReservoir(this.manifest,bound,range[1]);if(!reservoir)return null;
    const radius=this.manifest.base.frame.radiusM,level=reservoir.levelElevationM;
    const parent=parentTile(tile),parentRange=parent?this.heightRange(this.tileInfo(parent).bound,camera,parent):range;
    const diameter=2*Math.SQRT2/(2**tile.level*16);
    const rounding=2**-21*(4*bound.radiusM+Math.max(Math.abs(level-range[0]),Math.abs(level-range[1])))+128*Number.EPSILON*radius;
    const errorM=3*(radius+Math.abs(level)+.003)*diameter**2+.003+rounding;
    // Opaque water covers the whole patch. Both fine and parent-morphed bed
    // remain below even the water triangle's inward chord sag.
    if(Math.max(range[1],parentRange[1])+errorM+.01>=level||length(camera.eye)<=radius+level+errorM)return null;
    return {...reservoir,errorM,range:[level-errorM,level+errorM]};
  }
  plan(camera,height){const start=performance.now();for(const ignored of this.planSteps(camera,height)){}this.lastPlanningWorkMs=performance.now()-start;}
  requestPlan(camera,height){this.planningRequest={camera:structuredClone(camera),height};}
  advancePlanning(budgetMs=5){
    if(!this.planningIterator&&this.planningRequest){const {camera,height}=this.planningRequest;this.planningRequest=null;this.planningIterator=this.planSteps(camera,height);this.planningWorkMs=0;}
    if(!this.planningIterator)return;
    const start=performance.now();
    try{do{const next=this.planningIterator.next();if(next.done){this.planningIterator=null;break;}}while(performance.now()-start<budgetMs);}
    catch(e){this.planningIterator=null;this.errors.push(`LOD plan retained: ${e.message}`);if(this.errors.length>10)this.errors.shift();}
    const elapsed=performance.now()-start;this.planningWorkMs+=elapsed;this.peakPlanningSliceMs=Math.max(this.peakPlanningSliceMs??0,elapsed);
    if(!this.planningIterator)this.lastPlanningWorkMs=this.planningWorkMs;
  }
  *planSteps(camera, height) {
    const signature=JSON.stringify([camera,height,this.renderer?.allocations??null,this.cache?.evictions??null,this.cache?.bytes??null,this.meshBudgetRevision??0]);
    if(this.renderer&&this.cache&&this.lastPlanManifest===this.manifest&&signature===this.planningSignature){this.planningSkips=(this.planningSkips??0)+1;this.dispatch();return;}
    const planningStarted=performance.now();this.lastPlanPixelHeight=height;
    this.generation++; const wanted = new Map(), radius = this.manifest.base.frame.radiusM; let visited = 0,plannedBytes=0,memoryRejectedRefinements=0;
    const hardMeshBudgetBytes=this.cache?.maxBytes??this.limits.gpuBytes;
    // Old displayed children remain pinned while replacement siblings arrive.
    // A target that fills the hard cache leaves no room for that transition.
    const meshBudgetBytes=Math.floor(hardMeshBudgetBytes*.8),transitionReserveBytes=hardMeshBudgetBytes-meshBudgetBytes;
    const candidates = new LodPriorityQueue();let trialCandidates=null;
    // A trial only changes its refined branch and balancing neighbours. Record
    // those entries instead of cloning the whole tree for every refinement.
    // Entries are replaced, never mutated, so rollback retains exact old data.
    let trialChanges=null;
    const putWanted=(key,value)=>{
      if(trialChanges&&!trialChanges.has(key))trialChanges.set(key,wanted.get(key));
      if(!wanted.has(key))plannedBytes+=this.estimatedMeshBytes(value.tile);
      wanted.set(key,value);
    };
    const add = tile => {
      if (++visited > this.limits.maxVisitedNodes || !this.visible(tile, camera)) return;
      const info=this.tileInfo(tile),b = info.bound, range = this.heightRange(b, camera, tile, true), p = b.center.map((v, i) => v * (radius + (range[0] + range[1]) / 2*(camera.heightScale??1)) - camera.eye[i]);
      const distance = Math.max(camera.altitude * .5, length(p) - b.radiusM);
      const gridPixels = b.radiusM * 2 / 16 * height * .5 * camera.focal / distance;
      const error = tileGeometricError(this.manifest, tile, range,16,b,info.features);
      // Below the former uncut surface, projecting against that surface can
      // stay behind the near plane forever. Use the cached actual ground hull
      // for projection, while keeping the base bound for its error estimate.
      const projectionRange=this.heightRange(b,camera,tile);
      const baseErrorPixels=projectedErrorPixels(error.terrainErrorM,this.manifest,tile,projectionRange,camera,height,b);
      const cachedGround=this.cache?.entries.get(tileKey(tile))?.value.geometricError;
      // A resident ancestor already bounds every descendant's true field.
      // Unknown children need not fall back to the world's entire excavation
      // amplitude. This remains a whole-region bound, never a vertex probe.
      const intervalErrorM=groundIntervalError(this.manifest,tile,projectionRange,16,b);
      const groundErrorM=cachedGround?.geometricErrorM??Math.min(error.geometricErrorM,intervalErrorM);
      const groundBoundSource=cachedGround?'resident-mesh':intervalErrorM<=error.geometricErrorM?'height-interval':'base-plus-displacement';
      const groundErrorPixels=projectedErrorPixels(groundErrorM,this.manifest,tile,projectionRange,camera,height,b);
      // The uncut base is a diagnostic, not the displayed field after
      // excavation/flattening. A certified full-ground bound supersedes it.
      const waterOnly=this.waterOnlyBound(tile,camera,b,projectionRange);
      const errorPixels=waterOnly?projectedErrorPixels(waterOnly.errorM,this.manifest,tile,waterOnly.range,camera,height,b):groundErrorPixels;
      const features = this.manifest.featureCharts ?? (this.manifest.features ? [this.manifest.features] : []);
      const nearFeature = camera.altitude < 5000 && features.some(f => Math.acos(Math.max(-1, Math.min(1, dot(b.center, f.center)))) <= b.angular + f.angularRadius);
      const gridThreshold = nearFeature ? 8 : 28;
      const refine = tile.level < this.limits.maxLevel && (gridPixels > gridThreshold || errorPixels > LOD_TARGET_PIXELS);
      const parent = parentTile(tile), target = camera.targetUp ?? camera.eyeUnit;
      const nearest = nearestTileDirection(parent ?? tile, target), focusDistance = radius * Math.acos(Math.max(-1, Math.min(1, dot(nearest, target))));
      const priority = parent ? focusDistance / Math.max(1, camera.altitude) + tile.level * .1 : -1;
      const entry = wanted.get(tileKey(tile));
      putWanted(tileKey(tile), { tile, refine: false, priority: entry ? Math.min(entry.priority, priority) : priority,
        error, errorPixels, baseErrorPixels, groundErrorPixels, groundBoundSource, waterOnly, overTarget: errorPixels > LOD_TARGET_PIXELS });
      // In a live stream, first obtain this tile's real mesh/error enclosure.
      // Descending unknown children to the maximum LOD on an ancestor's broad
      // height range speculatively requested thousands of unnecessary meshes.
      // Coarse-neighbour balancing may still add the halo needed for coverage.
      const meshBoundReady=!this.renderer||!this.cache||this.cache.entries.has(tileKey(tile));
      if (refine&&meshBoundReady) (trialCandidates??candidates).push({ tile, score: Math.max(gridPixels / gridThreshold, errorPixels / LOD_TARGET_PIXELS), distance });
    };
    for (let face=0;face<6;face++){const tile={face,level:0,x:0,y:0};putWanted(tileKey(tile),{tile,refine:false,priority:-1});add(tile);}
    // Keep every accepted refinement balanced. A final wholesale coarsening
    // pass could erase an entire near-ground view when a horizon neighbour
    // consumed the last budget slots. Reject only the unaffordable trial.
    let rejectedRefinements=0;
    const refine=tile=>{
      const entry=wanted.get(tileKey(tile));if(!entry||entry.refine||wanted.size+4>this.limits.maxWantedTiles||visited+4>this.limits.maxVisitedNodes)return false;
      const extra=children(tile).reduce((sum,c)=>sum+(wanted.has(tileKey(c))?0:this.estimatedMeshBytes(c)),0);
      if(plannedBytes+extra>meshBudgetBytes){memoryRejectedRefinements++;return false;}
      putWanted(tileKey(tile),{...entry,refine:true});
      const nearest=nearestTileDirection(tile,camera.targetUp??camera.eyeUnit),focusDistance=radius*Math.acos(Math.max(-1,Math.min(1,dot(nearest,camera.targetUp??camera.eyeUnit))));
      for(const child of children(tile)){putWanted(tileKey(child),{tile:child,refine:false,priority:focusDistance/Math.max(1,camera.altitude)+child.level*.1});add(child);}
      return true;
    };
    while(candidates.length&&wanted.size+4<=this.limits.maxWantedTiles&&visited+4<=this.limits.maxVisitedNodes){
      const next=candidates.shift();
      if(!wanted.has(tileKey(next.tile))||wanted.get(tileKey(next.tile)).refine)continue;
      trialChanges=new Map();trialCandidates=[];const previousBytes=plannedBytes;
      if(!refine(next.tile)){trialChanges=null;trialCandidates=null;yield;continue;}
      const balance=yield* balanceRefinedBranchSteps(wanted,children(next.tile),{refineCoarse:refine});
      if(balance.remaining){for(const[k,e]of trialChanges){if(e===undefined)wanted.delete(k);else wanted.set(k,e);}plannedBytes=previousBytes;rejectedRefinements++;}
      if(!balance.remaining)for(const candidate of trialCandidates)candidates.push(candidate);
      trialCandidates=null;trialChanges=null;yield;
    }
    const neighborBalance={collapsed:0,rejectedRefinements,remaining:(yield* neighborViolationSteps([...wanted.values()].filter(e=>!e.refine).map(e=>e.tile))).length};
    this.wanted = wanted; this.visited = visited;
    const leaves = [...wanted.values()].filter(e => !e.refine && e.error);
    this.lodQuality = { neighborBalance, memoryRejectedRefinements,estimatedMeshBytes:plannedBytes,meshBudgetBytes,hardMeshBudgetBytes,transitionReserveBytes,meshEstimateScope:'observed tile sizes plus 64 KiB for unknown tiles; hard cache limit still enforced', targetPixels: LOD_TARGET_PIXELS, plannedLeaves: leaves.length,
      overTargetLeaves: leaves.filter(e => e.overTarget).length,
      constantWaterOnlyLeaves:leaves.filter(e=>e.waterOnly).length,
      unknownBaseLeaves: leaves.filter(e => !e.error.baseCertified).length,
      featureAmplitudeOnlyLeaves: leaves.filter(e => e.error.featureStatus === 'amplitude-only'&&e.groundBoundSource==='base-plus-displacement').length,
      awaitingMeshBounds:leaves.filter(e=>e.overTarget&&!this.cache?.entries.has(tileKey(e.tile))).length,
      residentBoundLeaves:leaves.filter(e=>e.groundBoundSource==='resident-mesh').length,intervalBoundLeaves:leaves.filter(e=>e.groundBoundSource==='height-interval').length,
      maxPlannedTerrainErrorPixels: leaves.every(e => Number.isFinite(e.baseErrorPixels)) ? Math.max(0, ...leaves.map(e => e.baseErrorPixels)) : null,
      maxPlannedGroundErrorPixels:leaves.every(e=>Number.isFinite(e.groundErrorPixels))?Math.max(0,...leaves.map(e=>e.groundErrorPixels)):null,
      budgetLimited: candidates.length > 0 || rejectedRefinements > 0 || memoryRejectedRefinements>0 };
    for (const slot of this.workers) if (slot.job?.tile && !wanted.has(tileKey(slot.job.tile))) slot.worker.postMessage({ type: 'cancel', id: slot.job.id });
    this.planningSignature=signature;this.lastPlanManifest=this.manifest;
    this.planningRuns=(this.planningRuns??0)+1;this.lastPlanningMs=performance.now()-planningStarted;
    this.dispatch();
  }
  dispatch() {
    if(this.destroyed)return;this.recoverWorkers();
    const now=Date.now();for(const[key,until]of this.failedUntil??[])if(until<=now)this.failedUntil.delete(key);
    if (this.uploads.length >= this.limits.maxPendingUploads) return;
    const pendingKeys = new Set([...this.workers.map(s => s.job?.tile && tileKey(s.job.tile)), ...this.uploads.map(t => tileKey(t.tile))]);
    for (const slot of this.workers) {
      if (!slot.ready || slot.job) continue;
      if (this.probeRequest) { const request = this.probeRequest; this.probeRequest = null; slot.job = { id: ++this.jobId, startedAt:Date.now(), ...request }; slot.worker.postMessage({ type: 'probe', id: slot.job.id, point: request.point }); continue; }
      if (this.uploads.length + this.workers.filter(s => s.job?.tile).length >= this.limits.maxPendingUploads) break;
      // Prioritize the nearby view and its actual coarse halo together.
      // Distant tiles at the same coarse level are not prerequisites.
      if(this.loadPriorityWanted!==this.wanted){this.loadPriorityWanted=this.wanted;this.loadPriorities=loadFrontierPriorities(this.wanted);}
      const next = [...this.wanted.values()].filter(e => {
        const parent=parentTile(e.tile),grandparent=parent&&parentTile(parent);
        const parentGroupReady=!grandparent||children(grandparent).every(s=>this.cache.entries.has(tileKey(s)));
        return parentGroupReady&&(!parent||this.cache.entries.has(tileKey(parent))) && (this.failedUntil?.get(tileKey(e.tile))??0)<=Date.now()
          && (!this.cache.entries.has(tileKey(e.tile))||this.cache.entries.get(tileKey(e.tile)).value.pendingFeatures>0) && !pendingKeys.has(tileKey(e.tile));
      }).sort((a,b)=>Number(this.cache.entries.has(tileKey(a.tile)))-Number(this.cache.entries.has(tileKey(b.tile)))||(this.loadPriorities.get(tileKey(a.tile))??a.priority)-(this.loadPriorities.get(tileKey(b.tile))??b.priority)||a.tile.level-b.tile.level||a.priority-b.priority)[0];
      if (!next) continue;
      pendingKeys.add(tileKey(next.tile)); slot.job = { id: ++this.jobId, startedAt:Date.now(), tile: next.tile }; slot.worker.postMessage({ type: 'mesh', id: slot.job.id, tile: next.tile, retainedTiles:[...this.wanted.keys()] });
    }
  }
  probe(point) {
    return new Promise((resolve, reject) => { this.probeRequest?.reject(new DOMException('Probe superseded','AbortError')); this.probeRequest = { point, resolve, reject }; this.dispatch(); });
  }
  balancedDisplay(render) {
    const current=new Map(render.map(entry=>[tileKey(entry.tile.tile),entry]));
    const signature=[...current.keys()].join('|');
    let topology=this.displayTopology;
    if(topology?.signature===signature&&topology.leaves.every(leaf=>current.has(leaf.key)||this.cache.entries.has(leaf.key))){
      this.displayTopologyHits=(this.displayTopologyHits??0)+1;
    }else{
      const balanced=balanceDisplayedLeaves(render.map(entry=>({tile:entry.tile.tile,entry})),{getAncestor:t=>{
        const value=this.cache.get(tileKey(t));return value?{entry:{tile:value,morph:1}}:null;
      }});
      const masks=stitchMasks(balanced.leaves.map(leaf=>leaf.tile));
      topology=this.displayTopology={signature,collapsed:balanced.collapsed,remaining:balanced.remaining,
        leaves:balanced.leaves.map(leaf=>({key:tileKey(leaf.tile),stitchMask:masks.get(tileKey(leaf.tile))}))};
      this.displayTopologyRuns=(this.displayTopologyRuns??0)+1;
    }
    // Reuse topology only. Live morph values and current cache objects must not
    // be captured from an earlier frame or a replaced GPU allocation.
    return {collapsed:topology.collapsed,remaining:topology.remaining,render:topology.leaves.map(leaf=>{
      const entry=current.get(leaf.key)??{tile:this.cache.get(leaf.key),morph:1};
      return {...entry,stitchMask:leaf.stitchMask};
    })};
  }
  frame(camera, dt) {
    this.advancePlanning(5);
    // At most one buffer upload per frame keeps camera interaction responsive.
    const mesh = this.uploads.shift();
    if (mesh && this.wanted.has(tileKey(mesh.tile))) {
      try {
        const bytes = (mesh.heightLifts?.byteLength??0)+(mesh.overlayHeightLifts?.byteLength??0)+mesh.vertex.byteLength + (mesh.edgeMask?.byteLength ?? 0) + mesh.index.byteLength + (mesh.overlayIndex.length ? mesh.overlayVertex.byteLength + mesh.overlayIndex.byteLength : 0), pins = new Set([...this.wanted.keys(), ...(this.transitionPins ?? [])]);
        this.rememberMeshBytes(mesh.tile,bytes);
        for (let face = 0; face < 6; face++) pins.add(tileKey({ face, level: 0, x: 0, y: 0 }));
        // A provisional replacement can release its own old buffer if needed;
        // its already displayed parent remains pinned as the fallback.
        const admissionPins=new Set(pins);if(this.cache.entries.get(tileKey(mesh.tile))?.value.pendingFeatures>0)admissionPins.delete(tileKey(mesh.tile));
        this.cache.reserve(bytes, admissionPins);
        const tile = this.renderer.upload(mesh); this.cache.put(tileKey(mesh.tile), tile, tile.bytes, pins);
        this.witnesses.push({ tile: mesh.tile, ...mesh.witness }); if (this.witnesses.length > 128) this.witnesses.shift();
      } catch (e) { this.failedUntil??=new Map();this.deferTile(tileKey(mesh.tile),Date.now()+10000);this.planningSignature=null;this.errors.push(`Parent retained: ${e.message}`); if (this.errors.length > 10) this.errors.shift(); }
    }
    const cameraKey=JSON.stringify([camera,this.lastPlanPixelHeight]),reuse=this.frameReuse;
    if(reuse&&reuse.cameraKey===cameraKey&&reuse.cacheRevision===this.cache.revision&&reuse.visible===this.visible&&reuse.wanted.length===this.wanted.size
      &&reuse.wanted.every(([key,value,refine])=>this.wanted.get(key)===value&&!!value.refine===refine)
      &&reuse.morphs.every(([tile,morph])=>tile.branchMorph===morph)){
      this.frameReuseHits=(this.frameReuseHits??0)+1;this.dispatch();return reuse.render.map(e=>({...e}));
    }
    this.frameReuse=null;let morphChanged=false;
    const render = [], pins = new Set(), step = Math.max(0, Math.min(50, dt)) / this.limits.morphMs;
    // Finish descendant transitions before collapsing a parent. Conversely,
    // descendants only start refining once the parent's shape is fully fine.
    const update = (t, allowRefine = true) => {
      const tile = this.cache.entries.get(tileKey(t))?.value; if (!tile) return;
      const beforeMorph=tile.branchMorph;
      const childTiles = children(t), ready = childTiles.every(c => this.cache.entries.has(tileKey(c)));
      const refine = allowRefine && this.wanted.get(tileKey(t))?.refine && ready;
      if (refine) {
        tile.branchMorph = Math.min(1, tile.branchMorph + step);
        for (const child of childTiles) update(child, tile.branchMorph === 1);
      } else if (ready && tile.branchMorph > 0) {
        for (const child of childTiles) update(child, false);
        if (childTiles.every(c => this.cache.entries.get(tileKey(c)).value.branchMorph === 0)) tile.branchMorph = Math.max(0, tile.branchMorph - step);
      } else tile.branchMorph = 0;
      morphChanged ||= beforeMorph!==tile.branchMorph;
      pins.add(tileKey(t));
      if (tile.branchMorph > 0) for (const child of childTiles) pins.add(tileKey(child));
    };
    for (let face = 0; face < 6; face++) update({ face, level: 0, x: 0, y: 0 });
    const visit = (t, morph = 1) => {
      const tile = this.cache.get(tileKey(t)); if (!tile || !this.visible(t, camera)) return;
      const childTiles = children(t), ready = childTiles.every(c => this.cache.entries.has(tileKey(c)));
      if (ready && tile.branchMorph > 0) for (const child of childTiles) visit(child, tile.branchMorph);
      else render.push({ tile, morph });
    };
    for (let face = 0; face < 6; face++) visit({ face, level: 0, x: 0, y: 0 });
    const displayBalance=this.balancedDisplay(render);
    render.length=0;for(const entry of displayBalance.render){render.push(entry);pins.add(tileKey(entry.tile.tile));}
    this.displayedBalanceCollapsed=displayBalance.collapsed;
    this.transitionPins = pins;
    this.displayedNeighborViolations=displayBalance.remaining;
    const displayedErrors=render.map(({tile,morph,stitchMask})=>{
      const error=displayedGroundError(tile,morph,stitchMask),project=value=>projectedErrorPixels(value,this.manifest,tile.tile,tile.heightRangeM??this.manifest.elevationRangeM,camera,this.lastPlanPixelHeight??720,this.tileInfo(tile.tile).bound);
      const waterOnly=this.waterOnlyBound(tile.tile,camera);
      return {base:project(error.baseM),ground:project(error.groundM),waterOnly,
        waterPixels:waterOnly?projectedErrorPixels(waterOnly.errorM,this.manifest,tile.tile,waterOnly.range,camera,this.lastPlanPixelHeight??720,this.tileInfo(tile.tile).bound):null,
        tile:tile.tile,morph,stitchMask:stitchMask??0,groundErrorM:error.groundM,heightRangeM:tile.heightRangeM,geometricError:tile.geometricError};
    });
    const visibleGroundErrors=displayedErrors.filter(e=>!e.waterOnly),errors=visibleGroundErrors.map(e=>e.base),groundErrors=visibleGroundErrors.map(e=>e.ground),waterErrors=displayedErrors.filter(e=>e.waterOnly).map(e=>e.waterPixels);
    this.displayedQuality={submergedGroundTiles:waterErrors.length,constantWaterOverTargetTiles:waterErrors.filter(e=>e>LOD_TARGET_PIXELS).length,maxConstantWaterErrorPixels:waterErrors.every(Number.isFinite)?Math.max(0,...waterErrors):null,
      baseOverTargetTiles:errors.filter(e=>e>LOD_TARGET_PIXELS).length,
      maxBaseErrorPixels:errors.every(Number.isFinite)?Math.max(0,...errors):null,
      unknownBaseTiles:errors.filter(e=>!Number.isFinite(e)).length,
      groundOverTargetTiles:groundErrors.filter(e=>e>LOD_TARGET_PIXELS).length,
      maxGroundErrorPixels:groundErrors.every(Number.isFinite)?Math.max(0,...groundErrors):null,
      unknownGroundTiles:groundErrors.filter(e=>!Number.isFinite(e)).length,
      worstGroundTiles:[...visibleGroundErrors].sort((a,b)=>b.ground-a.ground).slice(0,3),
      featureRefinementLimitedTiles:render.filter(e=>e.tile.featureRefinementLimited).length,
      hiddenWaterTransitionTiles:render.filter(e=>e.morph<=.99&&e.tile.overlay&&e.tile.waterIndexCount==null).length,
      staticWaterDuringMorphTiles:render.filter(e=>e.morph<=.99&&e.tile.waterIndexCount>0).length,
      scope:'fully covered, submerged ground is excluded from visible-ground counts and constant reservoir error is reported separately; other water boundaries remain uncertified. Base and total ground-to-rendered-surface distance bounds include current morph/stitch displacement; bridge-end faces use symmetric spatial distance to closed ground (including vertical jumps), not radial interpolation; normals, water boundaries, overlays and skirts are excluded'};
    if(!morphChanged)this.frameReuse={cameraKey,cacheRevision:this.cache.revision,visible:this.visible,
      wanted:[...this.wanted].map(([key,value])=>[key,value,!!value.refine]),morphs:[...this.cache.entries.values()].map(e=>[e.value,e.value.branchMorph]),render:render.map(e=>({...e}))};
    this.dispatch(); return render;
  }
  stats() {
    return { limits:this.limits,tileInfoCache:{entries:this.tileInfos?.size??0,limit:4096,hits:this.tileInfoHits??0,bytesEstimated:(this.tileInfos?.size??0)*1024},frameReuseHits:this.frameReuseHits??0,neighborTopology:neighborTopologyStats(),displayTopologyRuns:this.displayTopologyRuns??0,displayTopologyHits:this.displayTopologyHits??0,cacheTiles: this.cache.entries.size, gpuBytes: this.renderer.gpuBytes, peakGpuBytes: this.renderer.peakGpuBytes, cacheEvictions: this.cache.evictions,
      allocations: this.renderer.allocations, deletions: this.renderer.deletions, wantedTiles: this.wanted.size, visitedNodes: this.visited,
      pendingUploads: this.uploads.length, activeWorkers: this.workers.filter(s => s.job).length, completedMeshes: this.completed, cancelled: this.cancelled,
      deferredTiles:this.failedUntil?.size??0, workerStats: this.workers.map(s => s.stats), workerRecovery:this.workers.map(s=>({ready:s.ready,restarts:s.restarts,failures:s.failures,retryAt:s.retryAt,job:s.job?{kind:s.job.tile?'mesh':'probe',tile:s.job.tile??null,point:s.job.point??null,elapsedMs:Math.max(0,Date.now()-s.job.startedAt)}:null})), errors: [...this.errors], lodQuality: this.lodQuality,
      planningActive:!!this.planningIterator,planningQueued:!!this.planningRequest,lastPlanningWorkMs:this.lastPlanningWorkMs??null,peakPlanningSliceMs:this.peakPlanningSliceMs??null,planningRuns:this.planningRuns??0,planningSkips:this.planningSkips??0,lastPlanningMs:this.lastPlanningMs??null,displayedQuality:this.displayedQuality??null,
      displayedNeighborViolations: this.displayedNeighborViolations ?? null, displayedBalanceCollapsed:this.displayedBalanceCollapsed??0, transitionPinnedTiles: this.transitionPins?.size ?? 0 };
  }
  destroy() { if(this.destroyed)return;this.destroyed=true;this.planningIterator?.return();this.planningIterator=null;this.planningRequest=null;this.probeRequest?.reject(new Error('Stream destroyed'));this.probeRequest=null;for (const slot of this.workers) {slot.job?.reject?.(new Error('Stream destroyed'));slot.worker?.terminate();slot.worker=null;} this.displayTopology=null;this.frameReuse=null;this.tileInfos?.clear();this.cache.clear(); this.uploads.length = 0; this.wanted.clear(); this.transitionPins?.clear(); this.renderer.destroy(); }
}

