import {buildingPadAffectsPoint} from './building-pad.mjs';
import {nearestStreetPoint} from './service-frontage.mjs';
export const PUBLIC_ACCESS_POLICY='surveyed-public-footpaths@1';
/** Public destinations need a physical route, not just a label beside grass.
 * This bounded first planner accepts only surveyed straight pedestrian links;
 * it reports blocked access instead of routing through a building or water. */
export function planPublicAccess({roads,buildings,pond=null,ground,water,occupied=()=>false,avoidFoundationBatters=false,destinations=[],destinationsOnly=false}){
 if(typeof destinationsOnly!=='boolean')throw new TypeError('Invalid public destination mode');
 if(!Array.isArray(destinations)||destinations.length>8||destinations.some(t=>!t||typeof t.id!=='string'||!t.id||![t.point?.xM,t.point?.yM].every(Number.isFinite)))throw new RangeError('Invalid bounded public destinations');
 const targets=(destinationsOnly?[]:buildings.filter(b=>b.facilityType==='chapel')).map(b=>({id:b.id,type:'chapel',bounds:b.bounds,margin:1.25}));
 if(pond)targets.push({id:pond.id,type:'communal_pond_bank',bounds:pond.bounds,margin:1.25});
 targets.push(...destinations.map(t=>({...t,bounds:{minXM:t.point.xM,maxXM:t.point.xM,minYM:t.point.yM,maxYM:t.point.yM},margin:0})));
 const access=[],paths=[],halfWidthM=.65;
 const blocked=(x,y)=>occupied(x,y)||buildings.some(b=>x>b.bounds.minXM-.5&&x<b.bounds.maxXM+.5&&y>b.bounds.minYM-.5&&y<b.bounds.maxYM+.5);
 for(const target of targets){const b=target.bounds,cx=(b.minXM+b.maxXM)/2,cy=(b.minYM+b.maxYM)/2,m=target.margin;
  const candidates=target.point?roads.map(r=>({side:'riverbank',...target.point,street:nearestStreetPoint(target.point.xM,target.point.yM,[r])})).filter(c=>c.street&&c.street.distanceM<=300).sort((a,b)=>a.street.distanceM-b.street.distanceM||(a.street.roadId<b.street.roadId?-1:1)).slice(0,12):(avoidFoundationBatters?[m,2,3,4,6,8]:[m]).flatMap(m=>[['west',b.minXM-m,cy,m],['east',b.maxXM+m,cy,m],['south',cx,b.minYM-m,m],['north',cx,b.maxYM+m,m]]).map(([side,xM,yM,margin])=>({side,xM,yM,margin,street:nearestStreetPoint(xM,yM,roads)})).filter(c=>c.street&&c.street.distanceM<=120).sort((a,b)=>(avoidFoundationBatters?a.margin-b.margin:0)||a.street.distanceM-b.street.distanceM||a.side.localeCompare(b.side));let chosen=null;
  for(const c of candidates){const a=c.street,d=Math.hypot(c.xM-a.xM,c.yM-a.yM);if(d<.01){if(target.point&&[[0,0],[halfWidthM,0],[-halfWidthM,0],[0,halfWidthM],[0,-halfWidthM]].every(([dx,dy])=>!blocked(c.xM+dx,c.yM+dy)&&water(c.xM+dx,c.yM+dy).waterDepthM===0&&Number.isFinite(ground(c.xM+dx,c.yM+dy)))){chosen={roadId:c.street.roadId};access.push({targetId:target.id,targetType:target.type,status:'connected-existing-street',roadId:c.street.roadId,joinsRoadId:c.street.roadId,lengthM:0,sourceId:target.sourceId});break;}continue;}const nx=(c.xM-a.xM)/d,ny=(c.yM-a.yM)/d,count=Math.ceil(d/.5),samples=[];let valid=true;
   for(let i=0;i<=count&&valid;i++){const t=i/count,xM=a.xM+(c.xM-a.xM)*t,yM=a.yM+(c.yM-a.yM)*t,z=ground(xM,yM);if(!Number.isFinite(z)||samples.length&&Math.abs(z-(samples.at(-1).roadElevationM-.06))/(d/count)>.18){valid=false;break;}
    for(const side of [-halfWidthM,0,halfWidthM]){const x=xM-ny*side,y=yM+nx*side,sideZ=ground(x,y);if(!Number.isFinite(sideZ)||avoidFoundationBatters&&buildings.some(b=>buildingPadAffectsPoint({bounds:b.bounds,targetPadElevationM:b.baseElevationM},x,y,sideZ)||buildingPadAffectsPoint({bounds:b.bounds,targetPadElevationM:b.baseElevationM},x,y,sideZ+.06))||blocked(x,y)||water(x,y).waterDepthM!==0||Math.abs(sideZ-z)>.25){valid=false;break;}}
    if(valid)samples.push({xM,yM,distanceM:d*t,roadElevationM:z+.06,structureKind:'fill',segmentKind:'fill'});
   }
   if(valid){chosen={roadId:target.id+'/public-access',role:'pedestrian-access',destinationId:target.id,...(target.sourceId?{waterSourceId:target.sourceId}:{}),halfWidthM,surfaceMaterial:'compacted-earth',samples};paths.push(chosen);access.push({targetId:target.id,targetType:target.type,status:'connected',roadId:chosen.roadId,joinsRoadId:c.street.roadId,entranceSide:c.side,lengthM:d,...(target.sourceId?{sourceId:target.sourceId}:{} )});break;}
  }
  if(!chosen)access.push({targetId:target.id,targetType:target.type,status:'blocked-within-survey',reason:target.point?'No dry unobstructed direct pedestrian approach among 12 streets within 300 m and 18 percent grade':'No dry unobstructed direct pedestrian approach within 120 m and 18 percent grade'});
 }
 return{paths,access,method:PUBLIC_ACCESS_POLICY};
}
