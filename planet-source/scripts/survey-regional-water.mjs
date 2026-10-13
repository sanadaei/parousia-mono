import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{restoreGlobalTerrain}from'../src/core/global-terrain.mjs';
import{solveRegionalDrainage}from'../src/core/regional-drainage.mjs';
/** Resolve water on an inherited terrain window WITH a halo. Provisional L0
 * work-domain edges are not imposed as physical dams or drainage divides.
 * Unknown external drainage is explicitly open and never claimed complete.
 */
export function surveyRegionalWater(snapshot,climate,{latTop,lonLeft,latSpan,lonSpan,rows=128,columns=128}={}){
 if(climate.sourceWorldId!==snapshot.worldId||![latTop,lonLeft,latSpan,lonSpan].every(Number.isFinite)||latSpan<=0||lonSpan<=0||latSpan>40||lonSpan>60||latTop>85||latTop-latSpan< -85||!Number.isSafeInteger(rows)||!Number.isSafeInteger(columns)||rows<3||columns<3||rows*columns>65536)throw new RangeError('Bounded nonpolar regional window required');
 const base=restoreGlobalTerrain(snapshot),R=snapshot.frame.radiusM,rad=Math.PI/180,latStep=latSpan/rows,lonStep=lonSpan/columns,latMid=latTop-latSpan/2,cellSizeM=R*rad*lonStep*Math.cos(latMid*rad),cellSizeYM=R*rad*latStep,w=snapshot.grid.columns,h=snapshot.grid.rows;
 const elevation=[],waterDepthM=[],biome=[],temperatureC=[],rainMm=[],supply=[],outlets=[],cellAreaM2=[];
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  const cell=y*columns+x,lat=latTop-(y+.5)*latStep,lon=lonLeft+(x+.5)*lonStep,i=Math.min(h-1,Math.floor((90-lat)/180*h))*w+Math.floor(((lon%360+360)%360)/360*w),s=base.sampleSurfaceAt(lat,lon),area=R*R*lonStep*rad*(Math.sin((lat+latStep/2)*rad)-Math.sin((lat-latStep/2)*rad));
  elevation.push(s.groundElevationM);waterDepthM.push(s.waterDepthM??0);cellAreaM2.push(area);biome.push(climate.biome[i]);temperatureC.push(climate.annualMeanTemperatureC[i]);rainMm.push(climate.annualPrecipitationMm[i]);
  supply.push((s.waterDepthM??0)>0?0:climate.catchmentWater.annualLocalYieldMm[i]/1000*area);
  const boundary=x===0||y===0||x===columns-1||y===rows-1;
  if(s.waterDepthM>0)outlets.push({id:`receiving-water:${cell}`,cell,kind:s.surfaceKind==='sea-level-water'?'sea':s.surfaceKind?.includes('lake')?'lake':'river',levelM:s.waterLevelElevationM,sourceIds:s.waterSourceIds??[]});
  else if(boundary)outlets.push({id:`unresolved-edge:${cell}`,cell,kind:'open-boundary',levelM:s.groundElevationM});
 }
 const drainage=solveRegionalDrainage({columns,rows,cellSizeM,cellSizeYM,elevation,localSupplyM3PerYear:supply,outlets});
 const roots=new Map(outlets.map(o=>[o.cell,{...o,touchesUnresolvedEdge:o.kind==='open-boundary',maxUnmodeledFillM:0,cells:0}]));
 for(let i=0;i<elevation.length;i++){
  const r=roots.get(drainage.outletCell[i]),x=i%columns,y=Math.floor(i/columns);r.cells++;
  if(waterDepthM[i]<=0){r.maxUnmodeledFillM=Math.max(r.maxUnmodeledFillM,drainage.routingFillM[i]);if(x<=1||y<=1||x>=columns-2||y>=rows-2)r.touchesUnresolvedEdge=true;}
 }
 const candidate=drainage.receiver.map((j,i)=>j>=0&&waterDepthM[i]<=0&&!roots.get(drainage.outletCell[i]).touchesUnresolvedEdge&&roots.get(drainage.outletCell[i]).maxUnmodeledFillM<=.05?1:0);
 const completeCount=candidate.reduce((s,v)=>s+v,0);
 return{schema:'regional-water-survey@1',sourceWorldId:snapshot.worldId,climateId:climate.id,grid:{rows,columns,latTop,lonLeft,latStep,lonStep,cellSizeM,cellSizeYM},elevation,waterDepthM,biome,temperatureC,rainMm,cellAreaM2,drainage,candidate,
 diagnostics:{...drainage.diagnostics,completeCandidateCells:completeCount,receivingWaterCells:waterDepthM.filter(v=>v>0).length,openBoundaries:outlets.filter(o=>o.kind==='open-boundary').length},
 limits:['Inherited ground, not newly generated L1 terrain','Partial survey: external inflows unknown','Candidate paths need channel geometry and physical width before game adoption','Coarse climate values sampled; no regional rain-shadow refinement','Only interior routes with negligible unresolved fill are candidates']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: survey-regional-water.mjs L0.json OUTPUT.json');const x=JSON.parse(fs.readFileSync(input,'utf8'));
 const r=surveyRegionalWater(x.snapshot,x.climate,{latTop:5.625,lonLeft:16.875,latSpan:25.3125,lonSpan:22.5});fs.writeFileSync(output,JSON.stringify(r));console.log(JSON.stringify(r.diagnostics));
}
