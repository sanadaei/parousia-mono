import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
import{restoreGlobalTerrain}from'../src/core/global-terrain.mjs';
import{solveRegionalDrainage}from'../src/core/regional-drainage.mjs';
import{CommittedMaterializer}from'../src/core/committed-materialization.mjs';
import{createFileMaterializationStorage}from'./materialization-file-store.mjs';
/** First integration experiment: inherited terrain, finer basin routing. This
 * does NOT claim new sub-grid geomorphology, known water surfaces, or L1 completion.
 */
export function previewRegionalBasin(snapshot,climate,{outletCell,subdivisions=12}={}){
 if(climate.sourceWorldId!==snapshot.worldId||!Number.isSafeInteger(subdivisions)||subdivisions<2||subdivisions>32)throw new RangeError('Matching climate and bounded refinement required');
 const {columns:w,rows:h}=snapshot.grid,n=w*h,land=snapshot.fields.landMask,down=snapshot.fields.downstream;
 if(!Number.isSafeInteger(outletCell)||outletCell<0||outletCell>=n||land[outletCell])throw new RangeError('Explicit parent ocean receiver required for this first experiment');
 const selected=[];
 for(let i=0;i<n;i++)if(land[i]){let j=i,steps=0;while(down[j]>=0&&land[down[j]]){j=down[j];if(++steps>n)throw new RangeError('Cyclic parent');}if(down[j]===outletCell)selected.push(i);}
 if(!selected.length)throw new RangeError('Receiver has no contributing land');
 // Unwrap around receiver; domains exceeding a hemisphere need another projection.
 const ox=outletCell%w,unwrapped=i=>{let x=i%w;while(x-ox>w/2)x-=w;while(x-ox< -w/2)x+=w;return x;},xs=selected.map(unwrapped),ys=selected.map(i=>Math.floor(i/w));
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),columns=(maxX-minX+1)*subdivisions,rows=(maxY-minY+1)*subdivisions;
 if(columns*rows>65536||maxX-minX>=w/2||minY===0||maxY===h-1)throw new RangeError('Basin exceeds bounded nonpolar preview support');
 const base=restoreGlobalTerrain(snapshot),members=new Set(selected),latStep=180/h/subdivisions,lonStep=360/w/subdivisions,latTop=90-minY*180/h,lonLeft=minX*360/w,
   R=snapshot.frame.radiusM,rad=Math.PI/180,latMid=latTop-rows*latStep/2,cellSizeM=R*rad*lonStep*Math.cos(latMid*rad),cellSizeYM=R*rad*latStep,
   elevation=[],activeMask=[],parentCell=[],supply=[],biome=[],temperatureC=[],rainMm=[];
 const cellAreas=[],areaSum=new Map();
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
  const py=minY+Math.floor(y/subdivisions),px=((minX+Math.floor(x/subdivisions))%w+w)%w,i=py*w+px,active=members.has(i),lat=latTop-(y+.5)*latStep,lon=lonLeft+(x+.5)*lonStep,a=R*R*lonStep*rad*(Math.sin((lat+latStep/2)*rad)-Math.sin((lat-latStep/2)*rad));
  parentCell.push(i);activeMask.push(active?1:0);cellAreas.push(a);if(active)areaSum.set(i,(areaSum.get(i)??0)+a);
  elevation.push(base.groundElevationAt(lat,lon));biome.push(climate.biome[i]);temperatureC.push(climate.annualMeanTemperatureC[i]);rainMm.push(climate.annualPrecipitationMm[i]);
 }
 for(let k=0;k<elevation.length;k++){const i=parentCell[k];supply.push(activeMask[k]?climate.catchmentWater.annualLocalYieldMm[i]/1000*climate.cellAreaM2[i]*cellAreas[k]/areaSum.get(i):0);}
 const fromCells=selected.filter(i=>down[i]===outletCell),outlets=[],used=new Set();
 for(const from of fromCells){const fx=unwrapped(from),fy=Math.floor(from/w),tx=unwrapped(outletCell),ty=Math.floor(outletCell/w),dx=Math.sign(tx-fx),dy=Math.sign(ty-fy),x=(fx-minX)*subdivisions+(dx<0?0:dx>0?subdivisions-1:Math.floor(subdivisions/2)),y=(fy-minY)*subdivisions+(dy<0?0:dy>0?subdivisions-1:Math.floor(subdivisions/2)),cell=y*columns+x;
  if(used.has(cell))continue;used.add(cell);outlets.push({id:`parent-sea-corridor:${from}:${outletCell}`,kind:'sea',cell,levelM:Math.max(snapshot.references.sea.levelElevationM,elevation[cell])});
 }
 const drainage=solveRegionalDrainage({columns,rows,cellSizeM,cellSizeYM,elevation,activeMask,localSupplyM3PerYear:supply,outlets});
 return{schema:'regional-basin-preview@1',sourceWorldId:snapshot.worldId,climateId:climate.id,outletCell,subdivisions,selectedParentCells:selected,grid:{columns,rows,latTop,lonLeft,latStep,lonStep,cellSizeM,cellSizeYM},elevation,activeMask,parentCell,biome,temperatureC,rainMm,drainage,
  limitations:['Existing parent ground sampled; no new fine geomorphology','Coarse basin boundary is an inherited trial constraint, not a final local divide','Sea port at last land sample is an unresolved shore corridor, not a resolved coastline','Distances use a local equirectangular metric at mean latitude','Flow paths are routing candidates; depression water and physical channels are not generated']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,saveDir,out,receiver='4358']=process.argv.slice(2);if(!input||!saveDir||!out)throw Error('Usage: preview-regional-basin.mjs L0.json SAVE-DIRECTORY OUTPUT.json [OCEAN-RECEIVER]');
 const x=JSON.parse(fs.readFileSync(input,'utf8')),outletCell=Number(receiver),m=new CommittedMaterializer(createFileMaterializationStorage(saveDir));
 const result=await m.resolve({worldId:x.snapshot.worldId,entityId:`regional-basin-preview:${outletCell}`,conditions:{climateId:x.climate.id,subdivisions:12},generator:'regional-basin-preview@1',generate:()=>previewRegionalBasin(x.snapshot,x.climate,{outletCell})});
 fs.writeFileSync(out,JSON.stringify(result));console.log(JSON.stringify({grid:result.grid,...result.drainage.diagnostics}));
}
