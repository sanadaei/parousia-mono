import {planPublicAccess} from './public-access.mjs';
export const RIVERBANK_ACCESS_POLICY='surveyed-riverbank-footpath@1';
/** Connect an already observed, named river to a village's actual street graph.
 * The destination is surveyed again against canonical water. No well, stream,
 * water level or bank is invented. This first policy is bounded to one village. */
export function planRiverbankAccess({settlement,projection,roads,buildings,ground,water,occupied=()=>false,bounds}){
 const status={policy:RIVERBANK_ACCESS_POLICY,sourceId:settlement.siting?.waterAccess?.sourceId??null};
 const blocked=reason=>({paths:[],access:[],status:{...status,status:'withheld',reason}});
 const saved=settlement.siting?.waterAccess;
 if(saved?.status!=='sampled-river-approach')return blocked('no-confirmed-river-approach');
 if(settlement.kind!=='village')return blocked('village-only-policy');
 const a=projection.toLocalIfWithin(saved.shorePoint.latDeg,saved.shorePoint.lonDeg),b=projection.toLocalIfWithin(saved.waterPoint.latDeg,saved.waterPoint.lonDeg);
 if(!a||!b)return blocked('water-target-outside-local-projection');
 const end=water(b.xM,b.yM),start=water(a.xM,a.yM);
 if(!(end.waterDepthM>0)||!end.waterSourceIds?.includes(saved.sourceId)||start.waterDepthM!==0)return blocked('saved-water-edge-no-longer-confirmed');
 const length=Math.hypot(b.xM-a.xM,b.yM-a.yM);
 if(length<=0||length>40)return blocked('shore-refinement-budget');
 const steps=Math.ceil(length/.5),samples=[];let firstWet=null;
 for(let i=0;i<=steps;i++){
  const t=i/steps,p={xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t},s=water(p.xM,p.yM);
  if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null)return blocked('unknown-shore');
  if(s.waterDepthM>0){if(!s.waterSourceIds?.includes(saved.sourceId))return blocked('different-water-intercepts-approach');firstWet=p;break;}
  samples.push(p);
 }
 if(!firstWet||samples.length<5)return blocked('insufficient-dry-bank');
 // Leave two metres before the first wet sample for a pedestrian landing.
 const target=samples[Math.max(0,samples.length-5)],margin=1;
 if(target.xM<bounds.minXM+margin||target.xM>bounds.maxXM-margin||target.yM<bounds.minYM+margin||target.yM>bounds.maxYM-margin)return blocked('bank-outside-village-footprint');
 const result=planPublicAccess({roads,buildings,ground,water,occupied,avoidFoundationBatters:true,destinationsOnly:true,destinations:[{id:settlement.id+'/riverbank',type:'riverbank',point:target,sourceId:saved.sourceId}]});
 // Only the requested water destination belongs to this connection. Other
 // public buildings already have their own access routes.
 const access=result.access.filter(a=>a.targetType==='riverbank'),paths=result.paths.filter(p=>p.destinationId===settlement.id+'/riverbank');
 const accepted=access[0]?.status?.startsWith('connected');
 return{paths,access,status:{...status,status:accepted?'connected':'withheld',reason:accepted?null:access[0]?.reason??'no-street-connection',bankPoint:projection.toGeographic(target.xM,target.yM),waterPoint:saved.waterPoint,shoreSamples:samples.length+1,...(accepted?{roadId:access[0].roadId,joinsRoadId:access[0].joinsRoadId,lengthM:access[0].lengthM}:{}),limitations:'Half-metre finite dry/grade/footprint survey, 1.3 m pedestrian strip; no flood, erosion, drinking quality or water-yield guarantee'}};
}
