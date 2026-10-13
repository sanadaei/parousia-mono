import {populationZoneAreaM2} from '../core/population-zones.mjs';
import {hashJson} from '../core/json-contract.mjs';
/** A bounded local texture laid over the same global census layer. Unknown
 * pixels stay transparent; they are not invented empty-population zones. */
export function makePopulationZoneOverlay(zones,radiusM,centerLonDeg,{size=256}={}){
 if(!zones.length)return null;if(!Number.isFinite(centerLonDeg)||zones.length>128||!Number.isInteger(size)||size<16||size>512)throw new RangeError('Population texture budget exceeded');
 const center=((centerLonDeg%360)+360)%360,items=zones.map(z=>{let west=z.bounds.west;while(west-center>180)west-=360;while(west-center< -180)west+=360;return{zone:z,west,east:west+z.bounds.east-z.bounds.west};}),west=Math.min(...items.map(i=>i.west)),east=Math.max(...items.map(i=>i.east)),north=Math.max(...zones.map(z=>z.bounds.north)),south=Math.min(...zones.map(z=>z.bounds.south));
 if(east-west>180)return null;const rgba=new Uint8Array(size*size*4);
 for(const {zone:z,west:x0,east:x1}of items){const density=z.population/(populationZoneAreaM2(z,radiusM)/1e6),v=Math.min(1,Math.log1p(density)/Math.log(101)),color=(z.status==='unallocated'?[220,140,50,255]:[170-120*v,70+150*v,50,255]).map(Math.round),b=z.bounds,
 left=Math.max(0,Math.round((x0-west)/(east-west)*size)),right=Math.min(size,Math.round((x1-west)/(east-west)*size)),top=Math.max(0,Math.round((north-b.north)/(north-south)*size)),bottom=Math.min(size,Math.round((north-b.south)/(north-south)*size));
 for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)rgba.set(color,(y*size+x)*4);
 }
 return{key:hashJson({zones,center,size}),width:size,height:size,rgba,rect:[((west/360)%1+1)%1,(90-north)/180,(east-west)/360,(north-south)/180]};
}
export function zoneOverlayColorAt(overlay,latDeg,lonDeg){if(!overlay)return null;const [x,y,w,h]=overlay.rect,u=(((lonDeg/360-x)%1)+1)%1,v=(90-latDeg)/180-y;if(u>=w||v<0||v>=h)return null;const col=Math.min(overlay.width-1,Math.floor(u/w*overlay.width)),row=Math.min(overlay.height-1,Math.floor(v/h*overlay.height)),i=(row*overlay.width+col)*4;return overlay.rgba[i+3]?[overlay.rgba[i]/255,overlay.rgba[i+1]/255,overlay.rgba[i+2]/255]:null;}

/** One summary request at a time. Camera changes never relabel old geometry,
 * and a late response cannot replace the newly requested view's summary. */
export class PopulationZoneView{
 constructor(pages,radiusM){this.pages=pages;this.radiusM=radiusM;this.zones=[];this.status='global-census';this.error=null;this.pending=false;this.closed=false;this.controller=new AbortController();this.doneKey=null;this.desiredKey=null;this.next=0;}
 update(cam,time,enabled){
  if(this.closed||!this.pages)return;this.enabled=enabled;if(!enabled){this.desiredKey=null;return;}
  const reach=Math.max(2000,cam.altitude*1.5),angular=Math.min(Math.PI,reach/this.radiusM),lat=Math.asin(Math.max(-1,Math.min(1,cam.targetUp[2])))*180/Math.PI,lon=Math.atan2(cam.targetUp[1],cam.targetUp[0])*180/Math.PI,level=Math.ceil(Math.log2(this.radiusM/reach)),cell=Math.max(.001,2**(-level)*180/Math.PI/4),key=[level,Math.floor(lat/cell),Math.floor(lon/cell)].join('/');this.desiredKey=key;
  if(this.pending||this.doneKey===key||time<this.next)return;this.pending=true;this.next=time+1000;
  const bound={center:[...cam.targetUp],angular},targetSpanM=Math.max(2000,reach/3);
  Promise.resolve().then(()=>this.pages.summaries(bound,this.controller.signal,{targetSpanM})).then(result=>{if(this.closed||!this.enabled||this.desiredKey!==key)return;this.zones=result.zones;this.status=result.status;this.error=null;this.doneKey=key;}).catch(e=>{if(!this.closed&&e.name!=='AbortError')this.error=e.message;}).finally(()=>{this.pending=false;});
 }
 destroy(){this.closed=true;this.controller.abort();this.zones=[];}
}
