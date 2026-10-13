import {deriveRegionalTributaries} from './regional-tributaries.mjs';
import {createMaterializedWaterSurface} from './materialized-water-surface.mjs';

/** One first-reference record owns both scales. Fine surveys see the physical
 * regional channels; no nested independently owned overlays can contradict it.
 * This remains a bounded receiving-river neighbourhood, not a full watershed. */
export async function materializeRegionalWaterPlan(world,materializer,{parentId,pointIndex,signal}={}){
 if(!world.worldId||!world.base?.toSnapshot||!world.climate?.catchmentWater)throw new TypeError('Saved terrain and climate required for regional water planning');
 const network=world.base.toSnapshot().references.rivers,parent=network?.profiles.find(p=>p.id===parentId);
 if(!parent||!Number.isSafeInteger(pointIndex)||pointIndex<0||pointIndex>=parent.points.length)throw new RangeError('Existing receiving river point required');
 const settings={gridSize:129,cellSizeM:512,minChannelAreaM2:1000000,minimumFlowM3PerSecond:.001,profileStepM:32,maxIncisionM:10},fineSettings={gridSize:129,cellSizeM:64,minChannelAreaM2:100000,minimumFlowM3PerSecond:.001,profileStepM:8,maxIncisionM:2},id=`regional-water-plan:${parentId}/point:${pointIndex}`;
 return materializer.resolve({worldId:world.worldId,entityId:id,conditions:{baseWorldId:world.base.worldId,parent,climateSupplyId:world.climate.catchmentWater.id},generator:'regional-before-local-water@1',signal,generate:()=>{
  const count=network.profiles.reduce((n,p)=>n+p.points.length,0);if(count+16384>131072)throw new RangeError('Existing network leaves no bounded regional water workspace');
  const profileIds=new Set(network.profiles.map(p=>p.id)),nodeIds=new Set(network.nodes.map(n=>n.id)),common={maxRegions:1,climate:world.climate,parentProfileIds:[parentId],referencePoints:[{parentId,pointIndex}]};
  const regional=deriveRegionalTributaries(world.base,network,{...settings,...common,maxTotalPoints:count+8192,scaleId:'saved-regional'}),region=regional.diagnostics.localTributaries.regions.at(-1);
  const plan={schema:'referenced-local-water-plan@1',id,sourceWorldId:world.worldId,parentId,pointIndex,settings,fineSettings,region,nodes:regional.nodes.filter(p=>!nodeIds.has(p.id)),profiles:regional.profiles.filter(p=>!profileIds.has(p.id))};
  const physical=createMaterializedWaterSurface(world.base,[plan],{sourceWorldId:world.worldId}),fine=deriveRegionalTributaries(physical,regional,{...fineSettings,...common,maxTotalPoints:count+16384,scaleId:'saved-regional-fine'});
  return{...plan,nodes:fine.nodes.filter(p=>!nodeIds.has(p.id)),profiles:fine.profiles.filter(p=>!profileIds.has(p.id)),fineRegion:fine.diagnostics.localTributaries.regions.at(-1),status:fine.profiles.length>network.profiles.length?'awaiting-terrain-installation':'no-channel-accepted',installed:false,limitations:['Both scales are one saved ownership record; the fine survey is centered on the same reference','Incomplete boundary catchments and unresolved depressions are withheld','Regional stream widths are a scenario, not validated discharge-derived widths','Reserve the whole footprint before land-use commitments; existing worlds are not upgraded in place']};
 }});
}
