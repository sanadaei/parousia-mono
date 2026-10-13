import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateLandformCandidate} from './conditional-landform-candidate.mjs';
import {conditionDrainageTerrain} from './condition-drainage-terrain.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {classifyEnvironment} from '../../src/core/environment-cover.mjs';
import {CommittedMaterializer} from '../../src/core/committed-materialization.mjs';
import {hashJson} from '../../src/core/json-contract.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';
import {createFileMaterializationStorage} from '../materialization-file-store.mjs';

/** A bounded, jointly solved neighbourhood. Its viewing windows are NOT
 * independently generated physical regions. External water remains unresolved.
 * Parent land heights are coarse trends, not hard subcell extrema. */
export function placeRegionalCandidate(parent, settings) {
 const {snapshot:s,climate:c}=parent;
 const {latDeg,lonDeg,seed,columns=192,rows=144,cellSizeM=60,detailAmplitude=1}=settings;
 if(c.sourceWorldId!==s.worldId||(s.layerId&&c.sourceLayerId!==s.layerId)||![latDeg,lonDeg,detailAmplitude].every(Number.isFinite)||Math.abs(latDeg)>80||detailAmplitude<0||detailAmplitude>2)throw Error('Matching parent and bounded nonpolar placement required');
 const raw=generateLandformCandidate({seed,columns,rows,cellSizeM});
 const w=s.grid.columns,h=s.grid.rows,R=s.frame.radiusM,rad=Math.PI/180;
 const dlat=cellSizeM/R/rad,dlon=dlat/Math.cos(latDeg*rad);
 const sample=(values,lat,lon)=>{
  const xx=((lon%360+360)%360)/360*w-.5, yy=(90-lat)/180*h-.5;
  const x=Math.floor(xx),y=Math.max(0,Math.min(h-2,Math.floor(yy))),u=xx-x,v=Math.max(0,Math.min(1,yy-y));
  const i=(a,b)=>b*w+((a%w+w)%w);
  return values[i(x,y)]*(1-u)*(1-v)+values[i(x+1,y)]*u*(1-v)+values[i(x,y+1)]*(1-u)*v+values[i(x+1,y+1)]*u*v;
 };
 const referenceMean=raw.elevation.reduce((a,b)=>a+b,0)/raw.elevation.length;
 const parentElevation=[],temperatureC=[],rainMm=[],yieldMm=[],soilMoisture=[],biome=[];
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  const lat=latDeg+((rows-1)/2-y)*dlat,lon=lonDeg+(x-(columns-1)/2)*dlon;
  const ci=Math.min(h-1,Math.max(0,Math.floor((90-lat)/180*h)))*w+Math.floor(((lon%360+360)%360)/360*w);
  if(!s.fields.landMask[ci]||(s.fields.lakeFillDepthM?.[ci]??0)>0)throw Error('Trial currently supports dry inland neighbourhoods only');
  parentElevation.push(sample(s.fields.groundElevationM,lat,lon));
  temperatureC.push(sample(c.annualMeanTemperatureC,lat,lon));
  rainMm.push(sample(c.annualPrecipitationMm,lat,lon));
  yieldMm.push(sample(c.catchmentWater.annualLocalYieldMm,lat,lon));
  soilMoisture.push(sample(c.catchmentWater.meanSoilMoisture,lat,lon));biome.push(c.biome[ci]);
 }
 const proposed=raw.elevation.map((z,i)=>parentElevation[i]+detailAmplitude*(z-referenceMean));
 const outlets=raw.drainage.outlets.map(o=>({...o,levelM:proposed[o.cell]}));
 const supply=yieldMm.map(mm=>mm/1000*cellSizeM**2);
 const initial=solveRegionalDrainage({...raw.grid,elevation:proposed,localSupplyM3PerYear:supply,outlets});
 const fixed=conditionDrainageTerrain({elevation:proposed,receiver:initial.receiver,columns,cellSizeM});
 const elevation=fixed.elevation;
 const drainage=solveRegionalDrainage({...raw.grid,elevation,localSupplyM3PerYear:supply,outlets});
 const cover=elevation.map((z,i)=>{
  temperatureC[i]-=.0065*(z-parentElevation[i]);
  const x=i%columns,y=Math.floor(i/columns);
  const dx=(elevation[y*columns+Math.min(columns-1,x+1)]-elevation[y*columns+Math.max(0,x-1)])/(cellSizeM*(x===0||x===columns-1?1:2));
  const dy=(elevation[Math.min(rows-1,y+1)*columns+x]-elevation[Math.max(0,y-1)*columns+x])/(cellSizeM*(y===0||y===rows-1?1:2));
  return classifyEnvironment({biome:biome[i],temperatureC:temperatureC[i],annualRainMm:rainMm[i],soilMoisture:soilMoisture[i],slopeMPerM:Math.hypot(dx,dy),riverDistanceM:null,heightAboveRiverM:null,patch:0});
 });
 return {schema:'placed-regional-trial@1',sourceWorldId:s.worldId,...(s.layerId?{sourceLayerId:s.layerId,parentLayer:s.layer}:{}),climateId:c.id,settings,grid:raw.grid,geography:{latDeg,lonDeg,latStepDeg:dlat,lonStepDeg:dlon},parentElevation,originalElevation:raw.elevation,elevation,temperatureC,rainMm,yieldMm,soilMoisture,cover,drainage,conditioning:fixed.diagnostics,diagnostics:{...drainage.diagnostics,meanHeightResidualM:elevation.reduce((sum,z,i)=>sum+z-parentElevation[i],0)/elevation.length},limits:['Joint neighbourhood, not independently generated neighbouring watersheds','Outer receiving waters and incoming water remain unresolved','Inland only; no coastline or lake adaptation','Detail amplitude is an explicit experimental prior, not a calibrated geology model','No channel width or depth; drainage indicates potential annual supply','Coarse parent climate is interpolated with lapse correction; no local rain shadow']};
}

/** Viewing cuts preserve global cell/edge identities and full upstream flux.
 * Do not rerun drainage on a cropped window, which would lose upstream water. */
export function regionalView(record,{x0,y0,columns,rows}){
 const w=record.grid.columns,h=record.grid.rows;
 if(![x0,y0,columns,rows].every(Number.isSafeInteger)||x0<0||y0<0||columns<1||rows<1||x0+columns>w||y0+rows>h)throw Error('View outside committed neighbourhood');
 const indices=[];for(let y=y0;y<y0+rows;y++)for(let x=x0;x<x0+columns;x++)indices.push(y*w+x);
 const inside=new Set(indices),crossings=[];
 for(let i=0;i<w*h;i++){const j=record.drainage.receiver[i];if(j>=0&&inside.has(i)!==inside.has(j))crossings.push({id:`edge:${i}:${j}`,from:i,to:j,supplyM3PerYear:record.drainage.routedSupplyM3PerYear[i],direction:inside.has(i)?'out':'in'});}
 return {grid:{x0,y0,columns,rows},indices,elevation:indices.map(i=>record.elevation[i]),crossings};
}
export async function savePlacedRegion(parent,settings,directory,entityId='regional-trial'){
 const store=new CommittedMaterializer(createFileMaterializationStorage(directory));
 return store.resolve({worldId:parent.snapshot.worldId,entityId,conditions:{sourceWorldId:parent.snapshot.worldId,climateId:parent.climate.id,...(parent.snapshot.layerId?{sourceLayerId:parent.snapshot.layerId}:{}),settings},generator:'placed-regional-trial@1',generate:()=>placeRegionalCandidate(parent,settings)});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 requireVerificationMemory();
 const [input,output,directory]=process.argv.slice(2);if(!directory)throw Error('Usage: place-regional-candidate.mjs L0.json OUTPUT.json SAVE_DIRECTORY');
 const parent=JSON.parse(fs.readFileSync(input,'utf8')),c=parent.climate,s=parent.snapshot;
 const i=c.biome.findIndex((b,i)=>b==='temperate_forest'&&s.fields.groundElevationM[i]>400&&s.fields.groundElevationM[i]<800);
 if(i<0)throw Error('No suitable review location');
 const settings={latDeg:90-(Math.floor(i/s.grid.columns)+.5)*180/s.grid.rows,lonDeg:(i%s.grid.columns+.5)*360/s.grid.columns,seed:'muna-atlas-001',columns:192,rows:144,cellSizeM:60,detailAmplitude:1};
 const r=await savePlacedRegion(parent,settings,directory);fs.writeFileSync(output,JSON.stringify(r));console.log(JSON.stringify({sourceCell:i,settings,diagnostics:r.diagnostics,conditioning:r.conditioning,contentHash:hashJson(r)}));
}
