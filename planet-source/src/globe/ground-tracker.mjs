import {sphereBasis} from '../core/spherical.mjs';
/** Shared camera support: inspection and continuous following must agree. */
export function cameraSurfaceElevation(sample){return Math.max(sample.groundElevationM,sample.waterSurfaceElevationM??-Infinity,sample.roadSurface?.roadElevationM??-Infinity);}
/** One bounded main-thread page cache for immediate, loaded-ground camera
 * following. Missing pages are primed serially; no unbounded probe queue or
 * extra Worker is created. Unknown terrain keeps the last camera reference. */
export class GroundTracker {
 constructor(source){this.source=source;this.pending=null;this.destroyed=false;this.controller=new AbortController();this.retryAfter=0;this.lastError=null;this.samples=0;this.cacheHits=0;this.lastPoint=null;this.lastSample=null;}
 sample(point){const s=this.source.sample(point.latDeg,point.lonDeg);return{groundElevationM:s.groundElevationM,
   surfaceElevationM:cameraSurfaceElevation(s),
   rawGroundElevationM:this.source.rawGroundElevationAt(point.latDeg,point.lonDeg)};}
 tick(point,time){if(this.destroyed)return null;
  if(this.lastPoint?.latDeg===point.latDeg&&this.lastPoint?.lonDeg===point.lonDeg){this.cacheHits++;return this.lastSample;}
  try{if(!this.source.featuresReadyAt(point))throw new Error('Nearby feature pages pending');const s=Object.freeze(this.sample(point));this.samples++;this.lastPoint={...point};this.lastSample=s;this.lastError=null;return s;}catch{}
  if(!this.pending&&time>=this.retryAfter){const p={...point};this.pending=(async()=>{const releaseWater=this.source.beginWaterWork?.();
    try{if(this.source.prepareSettlements)await this.source.prepareSettlements({center:sphereBasis(p).up,angular:500/this.source.manifest.base.frame.radiusM},this.controller.signal);await this.source.enableFeaturesAt(p,this.controller.signal);await this.source.ready(()=>this.sample(p),this.controller.signal);this.lastError=null;}
    catch(e){if(e.name!=='AbortError'){this.lastError=e.message;this.retryAfter=time+1000;}}
    finally{releaseWater?.();this.pending=null;}
  })();}
  return null;
 }
 stats(){return{pending:!!this.pending,samples:this.samples,cacheHits:this.cacheHits,lastError:this.lastError,...this.source.stats()};}
 destroy(){this.destroyed=true;this.lastPoint=null;this.lastSample=null;this.controller.abort();this.source.cache.clear();this.source.anchors.clear();this.source.featureCache.clear();}
}
