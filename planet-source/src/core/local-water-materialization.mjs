import {deriveRegionalTributaries} from './regional-tributaries.mjs';

/** Commit a bounded receiving-river neighbourhood on first reference. This
 * produces an actual channel plan, NOT a silent edit of an existing world's
 * terrain. Installation must reserve ownership before any local land-use plan.
 * Rejected/empty results are saved too, instead of rerolling on every visit. */
export async function materializeLocalWaterPlan(world,materializer,{parentId,pointIndex,signal}={}){
 if(!world.worldId||!world.base?.toSnapshot||!world.climate?.catchmentWater)throw new TypeError('Saved terrain and climate required for local water planning');
 const snapshot=world.base.toSnapshot(),network=snapshot.references.rivers,parent=network?.profiles.find(p=>p.id===parentId);
 if(!parent||!Number.isSafeInteger(pointIndex)||pointIndex<0||pointIndex>=parent.points.length)throw new RangeError('Existing receiving river point required');
 const settings={gridSize:129,cellSizeM:64,minChannelAreaM2:100000,minimumFlowM3PerSecond:.001,profileStepM:8,maxIncisionM:2};
 return materializer.resolve({worldId:world.worldId,entityId:`water-plan:${parentId}/point:${pointIndex}`,conditions:{baseWorldId:world.base.worldId,parent,climateSupplyId:world.climate.catchmentWater.id},generator:'referenced-water-neighbourhood@1',signal,generate:()=>{
  const count=network.profiles.reduce((n,p)=>n+p.points.length,0);if(count+8192>131072)throw new RangeError('Existing network leaves no bounded local water workspace');
  const beforeProfiles=new Set(network.profiles.map(p=>p.id)),beforeNodes=new Set(network.nodes.map(n=>n.id));
  const planned=deriveRegionalTributaries(world.base,network,{...settings,maxRegions:1,maxTotalPoints:count+8192,climate:world.climate,scaleId:'referenced',parentProfileIds:[parentId],referencePoints:[{parentId,pointIndex}]}),profiles=planned.profiles.filter(p=>!beforeProfiles.has(p.id)),nodes=planned.nodes.filter(n=>!beforeNodes.has(n.id)),region=planned.diagnostics.localTributaries.regions.at(-1);
  return{schema:'referenced-local-water-plan@1',id:`water-plan:${parentId}/point:${pointIndex}`,sourceWorldId:world.worldId,parentId,pointIndex,settings,region,nodes,profiles,status:profiles.length?'awaiting-terrain-installation':'no-channel-accepted',installed:false,limitations:['Bounded interior catchments only; incomplete boundary catchments are withheld','Region ownership and terrain installation must precede local settlement or road commitments','No change to existing river geometry, ground, villages or renderer is performed by this planner']};
 }});
}
