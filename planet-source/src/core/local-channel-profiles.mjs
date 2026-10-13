import {channelRoute} from './channel-route.mjs';
import {fitMonotoneWaterProfile} from './river-profile-fit.mjs';
import {PLANET_RIVERS_SCHEMA,SMOOTH_RIVER_BED,createSphericalRiverSampler} from './planet-rivers.mjs';
/** Convert accepted local drainage into physically inspectable trial profiles.
 * This does not install them into a saved world or alter settlement terrain.
 * Reject the whole tributary catchment if any reach cannot meet its fixed nodes. */
export function compileLocalChannels({id,analysis,projection,sampleSurface,indexGrid={columns:128,rows:64},maxIncisionM=2,profileStepM=4,maxPoints=8192,pathPolicy='grid-channels@1',climateSupply=null}) {
 if(typeof id!=='string'||!id||typeof sampleSurface!=='function'||!Number.isFinite(maxIncisionM)||maxIncisionM<=0||!Number.isFinite(profileStepM)||profileStepM<=0||!Number.isSafeInteger(maxPoints)||maxPoints<2||maxPoints>131072)throw new RangeError('Invalid channel compilation budget');
 if(climateSupply&&(!Number.isFinite(climateSupply.annualLocalYieldMm)||climateSupply.annualLocalYieldMm<0||typeof climateSupply.sourceId!=='string'||!Number.isFinite(climateSupply.minimumFlowM3PerSecond)||climateSupply.minimumFlowM3PerSecond<=0))throw new RangeError('Invalid local climate supply');
 const flow=area=>area*(climateSupply?.annualLocalYieldMm??0)*.001/(365*86400);
 const {columns,rows,cellSizeM,receiver,candidateMask,potentialContributingAreaM2:area,filledElevationM:levels}=analysis;
 const point=i=>({xM:(i%columns-(columns-1)/2)*cellSizeM,yM:(Math.floor(i/columns)-(rows-1)/2)*cellSizeM});
 const geographic=i=>{const p=point(i);return projection.toGeographic(p.xM,p.yM);};
 const nodes=[],profiles=[],rejected=[];let used=0;
 for(const basin of analysis.basins){
  if(basin.status!=='connected-interior-catchment'||!basin.candidateCells.length)continue;
  const candidates=climateSupply?basin.candidateCells.filter(i=>flow(area[i])>=climateSupply.minimumFlowM3PerSecond):basin.candidateCells;
  if(!candidates.length){rejected.push({outlet:basin.outlet,reason:'insufficient-local-climate-yield'});continue;}
  const active=new Set([...candidates,basin.outlet.cell]),incoming=new Map([...active].map(i=>[i,0]));
  for(const i of candidates)if(active.has(receiver[i]))incoming.set(receiver[i],incoming.get(receiver[i])+1);
  const nodeCells=[...active].filter(i=>i===basin.outlet.cell||incoming.get(i)!==1),nodeSet=new Set(nodeCells),localNodes=nodeCells.map(i=>({id:`${id}/node:${i}`,...geographic(i),waterLevelElevationM:levels[i]})),localProfiles=[];let failure=null,localPoints=0;
  for(const start of nodeCells){if(start===basin.outlet.cell)continue;const cells=[start];let next=receiver[start];
   while(active.has(next)){cells.push(next);if(nodeSet.has(next))break;next=receiver[next];}
   const end=cells.at(-1);if(end===start||!nodeSet.has(end)){failure={reason:'incomplete-channel-graph',cell:start};break;}
   const samples=[],route=channelRoute(cells.map(i=>({...point(i),areaM2:area[i]})),pathPolicy);
   for(let k=1;k<route.length;k++){const a=route[k-1],b=route[k],length=Math.hypot(b.xM-a.xM,b.yM-a.yM),steps=Math.ceil(length/profileStepM);
    for(let j=k===1?0:1;j<=steps;j++){
     if(used+localPoints+samples.length>=maxPoints||samples.length>=4097){failure={reason:'profile-work-budget',cell:start};break;}
     const t=j/steps,g=projection.toGeographic(a.xM+(b.xM-a.xM)*t,a.yM+(b.yM-a.yM)*t),s=sampleSurface(g.latDeg,g.lonDeg),contributing=a.areaM2*(1-t)+b.areaM2*t,halfWidthM=climateSupply?Math.min(100,Math.max(.6,2.5*Math.sqrt(flow(contributing)))):Math.min(3,.6+.6*Math.sqrt(contributing/1000000)),depthM=climateSupply?Math.min(3,Math.max(.3,.7*flow(contributing)**.3)):.3;
     if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null){failure={reason:'unknown-ground-or-water',cell:start};break;}
     const maxLevel=s.waterDepthM>0?s.waterLevelElevationM:s.groundElevationM+.05;
     if(!Number.isFinite(maxLevel)||s.groundElevationM+depthM-maxIncisionM>maxLevel){failure={reason:"infeasible-local-water-interval",cell:start};break;}
     samples.push({...g,halfWidthM,depthM,groundElevationM:s.groundElevationM,minimumLevelM:s.groundElevationM+depthM-maxIncisionM,maximumLevelM:maxLevel,preferredLevelM:s.groundElevationM});
    }
    if(failure)break;
   }
   if(failure)break;
   const fit=fitMonotoneWaterProfile(samples,{startLevelM:levels[start],endLevelM:levels[end]});
   if(!fit.valid){failure={reason:'no-monotone-profile-within-incision-bound',cell:start,fit};break;}
   const points=samples.map((p,k)=>({latDeg:p.latDeg,lonDeg:p.lonDeg,halfWidthM:p.halfWidthM,depthM:p.depthM,waterLevelElevationM:fit.levels[k],bankWidthM:Math.max(p.halfWidthM,3*Math.max(0,p.groundElevationM-fit.levels[k]+p.depthM))}));
   localPoints+=points.length;localProfiles.push({id:`${id}/channel:${start}:${end}`,from:`${id}/node:${start}`,to:`${id}/node:${end}`,receivingWaterId:basin.outlet.id,...(climateSupply?{climateSupply:{...climateSupply,meanPotentialFlowM3PerSecond:flow(area[start]),scope:'Local-area supply under one interpolated regional yield; no groundwater delay or channel losses'}}:{}),points});
  }
  if(failure){rejected.push({outlet:basin.outlet,...failure});continue;}
  used+=localPoints;nodes.push(...localNodes);profiles.push(...localProfiles);
 }
 const network={schema:PLANET_RIVERS_SCHEMA,bedMethod:SMOOTH_RIVER_BED,radiusM:projection.contract.radiusM,grid:indexGrid,nodes,profiles,diagnostics:{maxIncisionM,profileStepM,pathPolicy,pointCount:used,acceptedProfiles:profiles.length,rejected,scope:'Trial local tributaries; widths/depths are a declared small-stream scenario, no discharge or global integration'}};
 createSphericalRiverSampler(network); // Existing shared physical contract.
 return network;
}
