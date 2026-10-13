import {fitBuildingOrientation} from './building-geometry.mjs';
import {metricRoads} from './road-geometry.mjs';
import {solarAt,dayFractionForLocalHour} from './solar-light.mjs';
/** Bounded survey on existing accepted lots. A resource tag is never inferred
 * merely from ground colour, latitude, water presence or facility demand. */
export function surveyVillageLots(recipe,{groundAt,waterAt,lotTags={},designDeclinationDeg=0,obstacles=recipe.buildings??[]}={}){
 if(typeof groundAt!=='function'||typeof waterAt!=='function')throw new TypeError('Ground and water samplers required');
 const roads=metricRoads(recipe.roadCenterlineProfiles??[]),parcels=[],rejected=[];
 if((recipe.buildings?.length??0)>512)throw new RangeError('Survey exceeds lot budget');
 for(const b of recipe.buildings??[]){const box=b.bounds,xM=(box.minXM+box.maxXM)/2,yM=(box.minYM+box.maxYM)/2,points=[[xM,yM],[box.minXM,box.minYM],[box.maxXM,box.minYM],[box.maxXM,box.maxYM],[box.minXM,box.maxYM]],heights=points.map(p=>groundAt(...p)),wet=points.map(p=>waterAt(...p));
  if(heights.some(h=>!Number.isFinite(h))||wet.some(w=>!Number.isFinite(w.waterDepthM)||w.waterDepthM>0)){rejected.push({id:b.id,reason:'wet-or-unknown-lot'});continue;}
  const candidates=[];
  for(const road of roads)for(const segment of road.segments){const a=segment.a,z=segment.b,dx=z.xM-a.xM,dy=z.yM-a.yM,t=Math.max(0,Math.min(1,((xM-a.xM)*dx+(yM-a.yM)*dy)/(dx*dx+dy*dy))),target={xM:a.xM+t*dx,yM:a.yM+t*dy};
   const at=road.at(a.distanceM+t*(z.distanceM-a.distanceM));if(at.structureKind==='bridge-deck')continue;
   candidates.push({target,distanceM:Math.hypot(target.xM-xM,target.yM-yM),roadId:road.id,stationM:at.distanceM});
  }
  candidates.sort((a,b)=>a.distanceM-b.distanceM||(a.roadId<b.roadId?-1:1));let access=null;
  for(const c of candidates.slice(0,8)){if(c.distanceM>100)continue;let okay=true,previous=groundAt(xM,yM);const count=Math.max(1,Math.ceil(c.distanceM/2));
   for(let i=1;i<=count;i++){const t=i/count,x=xM+(c.target.xM-xM)*t,y=yM+(c.target.yM-yM)*t,h=groundAt(x,y),w=waterAt(x,y);if(obstacles.some(other=>other.id!==b.id&&x>other.bounds.minXM-.75&&x<other.bounds.maxXM+.75&&y>other.bounds.minYM-.75&&y<other.bounds.maxYM+.75)||!Number.isFinite(h)||!Number.isFinite(w.waterDepthM)||w.waterDepthM>0||Math.abs(h-previous)/Math.max(.001,c.distanceM/count)>.2){okay=false;break;}previous=h;}
   if(okay){access=c;break;}
  }
  if(!access){rejected.push({id:b.id,reason:'no-dry-walkable-road-access'});continue;}
  const width=box.maxXM-box.minXM,depth=box.maxYM-box.minYM,slope=(Math.max(...heights)-Math.min(...heights))/Math.min(width,depth),point={latDeg:recipe.projection.centerLatDeg,lonDeg:recipe.projection.centerLonDeg};
  const samples=[8,10,12,14,16].map(hour=>solarAt(point,{dayFraction:dayFractionForLocalHour(point.lonDeg,hour),declinationDeg:designDeclinationDeg}));
  const originHeight=b.baseElevationM+1.5;
  const sunlight=samples.map(s=>{
   if(s.altitudeDeg<=0)return 0;
   const az=s.azimuthDeg*Math.PI/180,dx=Math.sin(az),dy=Math.cos(az),rise=Math.tan(s.altitudeDeg*Math.PI/180);
   for(const distance of[10,25,50,100,200])if(groundAt(xM+dx*distance,yM+dy*distance)>originHeight+rise*distance)return 0;
   for(const other of obstacles){if(other.id===b.id)continue;let near=0,far=200;const bounds=other.bounds;
    for(const [v,d,lo,hi]of [[xM,dx,bounds.minXM,bounds.maxXM],[yM,dy,bounds.minYM,bounds.maxYM]]){if(Math.abs(d)<1e-12){if(v<lo||v>hi){far=-1;break;}}else{const a=(lo-v)/d,z=(hi-v)/d;near=Math.max(near,Math.min(a,z));far=Math.min(far,Math.max(a,z));}}
    if(far>=near&&near>0&&other.baseElevationM+other.heightM+other.roofHeightM>originHeight+rise*near)return 0;
   }
   return Math.sin(s.altitudeDeg*Math.PI/180);
  });
  const sunAccess=sunlight.reduce((n,v)=>n+v,0)/samples.length;
  const bearing=(Math.atan2(access.target.xM-xM,access.target.yM-yM)*180/Math.PI+360)%360,orientation=fitBuildingOrientation(box,bearing);
  parcels.push({id:b.id,kind:'building',xM,yM,areaM2:orientation.lengthM*orientation.widthM,orientation,radiusM:Math.hypot(width,depth)/2,slope,floodRisk:0,roadDistanceM:access.distanceM,roadBearingDeg:(Math.atan2(access.target.xM-xM,access.target.yM-yM)*180/Math.PI+360)%360,sunAccess,tags:[...(lotTags[b.id]??[])],provenance:'canonical-lot-five-point-and-access-probes@1',access,limitations:['floodRisk=0 means currently dry, not a return-period flood model','sunlight uses five local hours, terrain probes to 200m, and conservative building roof boxes; not continuous shadow simulation']});
 }
 return {parcels,rejected};
}

/** Named land parcels are scenario inputs; test physical feasibility against the
 * same terrain. No field/woodland/deposit is fabricated by the planner. */
export function surveyVillageLand(recipe,candidates,{groundAt,waterAt}){
 if(!Array.isArray(candidates)||candidates.length>128)throw new RangeError('Land survey budget exceeded');
 const parcels=[],rejected=[],occupied=(recipe.buildings??[]).map(b=>b.bounds),accepted=[];
 for(const c of [...candidates].sort((a,b)=>a.id<b.id?-1:1)){const b=c.bounds;
  if(!c.id||!c.provenance||!Array.isArray(c.tags)||!b||![b.minXM,b.maxXM,b.minYM,b.maxYM].every(Number.isFinite)||b.maxXM<=b.minXM||b.maxYM<=b.minYM)throw new TypeError('Named land bounds, tags and provenance required');
  if(b.minXM<recipe.bounds.minXM||b.maxXM>recipe.bounds.maxXM||b.minYM<recipe.bounds.minYM||b.maxYM>recipe.bounds.maxYM||[...occupied,...accepted].some(q=>b.minXM<q.maxXM+3&&b.maxXM>q.minXM-3&&b.minYM<q.maxYM+3&&b.maxYM>q.minYM-3)){rejected.push({id:c.id,reason:'outside-chart-or-occupied'});continue;}
  const width=b.maxXM-b.minXM,depth=b.maxYM-b.minYM;
  if(Math.max(width,depth)>200){rejected.push({id:c.id,reason:'parcel-survey-size-budget'});continue;}
  let wet=false;const heights=[];
  for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){const x=b.minXM+width*i/8,y=b.minYM+depth*j/8,h=groundAt(x,y),w=waterAt(x,y);heights.push(h);wet||=!Number.isFinite(h)||!Number.isFinite(w.waterDepthM)||w.waterDepthM>0;}
  if(wet){rejected.push({id:c.id,reason:'wet-or-unknown-land'});continue;}
  const probe={...recipe,buildings:[{id:c.id,bounds:b,baseElevationM:groundAt((b.minXM+b.maxXM)/2,(b.minYM+b.maxYM)/2),heightM:0,roofHeightM:0}]};
  const surveyed=surveyVillageLots(probe,{groundAt,waterAt,lotTags:{[c.id]:c.tags},obstacles:recipe.buildings??[]}),p=surveyed.parcels[0];
  if(!p){rejected.push(...surveyed.rejected);continue;}
  // Reject parcels crossed by any existing road; farms do not erase streets.
  const roadCrosses=(recipe.roadCenterlineProfiles??[]).some(r=>r.samples.slice(1).some((z,i)=>{const a=r.samples[i],n=Math.ceil(Math.hypot(z.xM-a.xM,z.yM-a.yM)/2);for(let k=0;k<=n;k++){const t=k/Math.max(1,n),x=a.xM+(z.xM-a.xM)*t,y=a.yM+(z.yM-a.yM)*t;if(x>=b.minXM-r.halfWidthM&&x<=b.maxXM+r.halfWidthM&&y>=b.minYM-r.halfWidthM&&y<=b.maxYM+r.halfWidthM)return true;}return false;}));
  if(roadCrosses){rejected.push({id:c.id,reason:'existing-road-crosses-parcel'});continue;}
  accepted.push(b);parcels.push({...p,kind:'land',bounds:b,areaM2:width*depth,orientation:null,slope:(Math.max(...heights)-Math.min(...heights))/Math.min(width,depth),provenance:c.provenance});
 }return {parcels,rejected};
}
