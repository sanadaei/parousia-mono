import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{generateLandformCandidate}from'./conditional-landform-candidate.mjs';import{conditionDrainageTerrain}from'./condition-drainage-terrain.mjs';
import{solveRegionalDrainage}from'../../src/core/regional-drainage.mjs';import{classifyEnvironment}from'../../src/core/environment-cover.mjs';import{auditL0}from'../audit-l0.mjs';import{requireVerificationMemory}from'../verification-runtime.mjs';
export function reviewRegionalLayer(parent=auditL0('planet-1')){
 const raw=generateLandformCandidate({seed:'muna-atlas-001',columns:192,rows:144,cellSizeM:60}),g=raw.grid,w=g.columns,h=g.rows,cell=g.cellSizeM,
 conditioned=conditionDrainageTerrain({elevation:raw.elevation,receiver:raw.drainage.receiver,columns:w,cellSizeM:cell}),elevation=conditioned.elevation,
 drainage=solveRegionalDrainage({...g,elevation,localSupplyM3PerYear:elevation.map(()=>cell*cell*.2),outlets:raw.drainage.outlets}),c=parent.climate,
 sourceCell=c.biome.findIndex((b,i)=>b==='temperate_forest'&&c.annualMeanTemperatureC[i]>8&&c.annualMeanTemperatureC[i]<18&&c.annualPrecipitationMm[i]>650);
 if(sourceCell<0)throw new Error('This review fixture requires a temperate reference cell');
 const channel=[];for(let i=0;i<elevation.length;i++)if(drainage.routedSupplyM3PerYear[i]/31557600>.015&&drainage.receiver[i]>=0)channel.push(i);
 const mean=elevation.reduce((s,v)=>s+v,0)/elevation.length,cover=[];
 for(let k=0;k<elevation.length;k++){
  const x=k%w,y=Math.floor(k/w);let nearest=-1,d2=Infinity;for(const j of channel){const d=(x-j%w)**2+(y-Math.floor(j/w))**2;if(d<d2){d2=d;nearest=j;}}
  const dx=(elevation[y*w+Math.min(w-1,x+1)]-elevation[y*w+Math.max(0,x-1)])/(2*cell),dy=(elevation[Math.min(h-1,y+1)*w+x]-elevation[Math.max(0,y-1)*w+x])/(2*cell),patch=Math.sin(x/9+Math.sin(y/11))*.5+Math.sin(y/7+Math.sin(x/15))*.5;
  const r=classifyEnvironment({biome:c.biome[sourceCell],temperatureC:c.annualMeanTemperatureC[sourceCell]-.0065*(elevation[k]-mean),annualRainMm:c.annualPrecipitationMm[sourceCell],soilMoisture:Math.max(0,Math.min(1,c.catchmentWater.meanSoilMoisture[sourceCell]+patch*.25)),slopeMPerM:Math.hypot(dx,dy),riverDistanceM:nearest<0?null:Math.sqrt(d2)*cell,heightAboveRiverM:nearest<0?null:elevation[k]-elevation[nearest],patch});cover.push({kind:r.kind,color:r.color});
 }
 return{...raw,originalElevation:raw.elevation,elevation,drainage,conditioning:conditioned.diagnostics,cover,coverAssumptions:{sourceWorldId:parent.snapshot.worldId,sourceClimateId:c.id,sourceCell,temperatureC:c.annualMeanTemperatureC[sourceCell],rainMm:c.annualPrecipitationMm[sourceCell],soilMoisture:c.catchmentWater.meanSoilMoisture[sourceCell],status:'One L0 climate context, not geographic placement; prescribed soil patches; water yield remains an independent 200mm/year test input'}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){requireVerificationMemory();const [directory,parentFile]=process.argv.slice(2);if(!directory)throw Error('Usage: review-regional-layer.mjs OUTPUT_DIRECTORY [PARENT_L0.json]');fs.mkdirSync(directory,{recursive:true});const result=reviewRegionalLayer(parentFile?JSON.parse(fs.readFileSync(parentFile,'utf8')):undefined);fs.writeFileSync(path.join(directory,'candidate-cover.json'),JSON.stringify(result));console.log(JSON.stringify({conditioning:result.conditioning,water:result.drainage.diagnostics,cover:result.coverAssumptions}));}
