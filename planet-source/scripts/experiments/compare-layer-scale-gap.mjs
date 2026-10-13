import fs from 'node:fs';
import {placeRegionalCandidate} from './place-regional-candidate.mjs';
import {createL1WaterNetwork} from '../../src/core/l1-water-network.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {hashJson,copyJson} from '../../src/core/json-contract.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';

/** Controlled sampling experiment, not a replacement world generator.
 * Generate ONE regional terrain proposal using the existing generator. All
 * resolutions query that same immutable proposal. Coarse route vertices are
 * never fixed as fine river ports. Survey boundaries remain explicitly open,
 * and the same geographical source point is traced at every resolution.
 * This tests sampling resolution, not all nested watershed boundary logic.
 */
export function compareLayerScaleGap(parent,{fromCell,toCell,seed='muna-atlas-001',columns=128,rows=128,cellSizeM=1000,detailAmplitude=.5,stepsM=[78000,39000,19500,9750,4875,2437.5,1218.75,609.375]}={}){
  if(!Array.isArray(stepsM)||!stepsM.length||stepsM.length>16||!stepsM.every(v=>Number.isFinite(v)&&v>0)||stepsM.some((v,i)=>i&&v>=stepsM[i-1]))throw Error('Strictly decreasing bounded sampling stages required');
  const network=createL1WaterNetwork(parent),edge=network.edges.find(e=>e.fromCell===fromCell&&e.toCell===toCell);
  if(!edge||edge.bedStatus!=='downhill-coarse-corridor')throw Error('Existing resolved parent reach required');
  const settings={latDeg:(edge.from.latDeg+edge.to.latDeg)/2,lonDeg:(edge.from.lonDeg+edge.to.lonDeg)/2,seed,columns,rows,cellSizeM,detailAmplitude};
  const terrain=placeRegionalCandidate(parent,settings),w=columns,h=rows,rad=Math.PI/180,R=parent.snapshot.frame.radiusM;
  let samples=0;
  const sampleSurface=(lat,lon)=>{
    samples++;
    const rawX=((((lon-settings.lonDeg)+180)%360+360)%360-180)*rad*R*Math.cos(settings.latDeg*rad)/cellSizeM+(w-1)/2;
    const rawY=(settings.latDeg-lat)*rad*R/cellSizeM+(h-1)/2;
    if(rawX< -1e-7||rawX>w-1+1e-7||rawY< -1e-7||rawY>h-1+1e-7)throw Error('Route left fixed terrain support; enlarge context, do not clamp');
    const x=Math.max(0,Math.min(w-1,rawX)),y=Math.max(0,Math.min(h-1,rawY));
    const ix=Math.min(w-2,Math.floor(x)),iy=Math.min(h-2,Math.floor(y)),u=x-ix,v=y-iy,z=terrain.elevation;
    return{groundElevationM:z[iy*w+ix]*(1-u)*(1-v)+z[iy*w+ix+1]*u*(1-v)+z[(iy+1)*w+ix]*(1-u)*v+z[(iy+1)*w+ix+1]*u*v,waterDepthM:0};
  };
  const start={...edge.from,waterLevelElevationM:sampleSurface(edge.from.latDeg,edge.from.lonDeg).groundElevationM-.3};
  const end={...edge.to,waterLevelElevationM:sampleSurface(edge.to.latDeg,edge.to.lonDeg).groundElevationM-.3};
  const width=(w-1)*cellSizeM,height=(h-1)*cellSizeM;
  const point=(x,y)=>({latDeg:settings.latDeg+(height/2-y)/R/rad,lonDeg:settings.lonDeg+(x-width/2)/(R*Math.cos(settings.latDeg*rad))/rad});
  const cases=[];let priorId=parent.snapshot.layerId;
  const sourceTerrainId=hashJson({sourceLayerId:parent.snapshot.layerId,settings:copyJson(settings),elevation:terrain.elevation});
  for(const requestedStepM of stepsM){
    const before=samples,began=performance.now(),cw=Math.max(3,Math.ceil(width/requestedStepM)+1),ch=Math.max(3,Math.ceil(height/requestedStepM)+1);
    if(cw*ch>65536)throw Error('Resolution exceeds bounded survey budget');
    const dx=width/(cw-1),dy=height/(ch-1),elevation=[],supply=[];
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
      const p=point(x*dx,y*dy);elevation.push(sampleSurface(p.latDeg,p.lonDeg).groundElevationM);
      // Uniform 100 mm/year isolates geometry from changing climate estimates.
      supply.push(.1*dx*dy*(x===0||x===cw-1?.5:1)*(y===0||y===ch-1?.5:1));
    }
    const outlets=elevation.flatMap((z,i)=>i<cw||i>=cw*(ch-1)||i%cw===0||i%cw===cw-1?[{id:`survey-edge:${i}`,cell:i,levelM:z,kind:'open-boundary'}]:[]);
    const drainage=solveRegionalDrainage({columns:cw,rows:ch,cellSizeM:dx,cellSizeYM:dy,elevation,localSupplyM3PerYear:supply,outlets});
    const gx=(start.lonDeg-settings.lonDeg)*rad*R*Math.cos(settings.latDeg*rad)+width/2,gy=(settings.latDeg-start.latDeg)*rad*R+height/2;
    const sourceCell=Math.round(gy/dy)*cw+Math.round(gx/dx),path=[];let i=sourceCell;
    for(let guard=0;guard<cw*ch;guard++){const p=point(i%cw*dx,Math.floor(i/cw)*dy);path.push({...p,cell:i,elevationM:elevation[i]});if(drainage.receiver[i]<0)break;i=drainage.receiver[i];}
    const content={requestedStepM,sourceTerrainId,priorStageId:priorId,grid:{columns:cw,rows:ch,cellSizeM:dx,cellSizeYM:dy},elevation,drainage,path,sourceCell,sourceSnapDistanceM:Math.hypot(sourceCell%cw*dx-gx,Math.floor(sourceCell/cw)*dy-gy)};
    const id=hashJson(content);cases.push({...content,id,measurement:{samples:samples-before,elapsedMs:performance.now()-began}});priorId=id;
  }
  return{schema:'layer-scale-gap-review@2',sourceLayerId:parent.snapshot.layerId,sourceWorldId:parent.snapshot.worldId,parentEdge:edge,settings,terrain:{grid:terrain.grid,geography:terrain.geography,elevation:terrain.elevation},start,end,cases,limits:['Existing landform generator is used once and frozen; terrain is NOT regenerated at each resolution','Terrain source spacing is recorded in settings; finer queries interpolate it and do not invent subcell relief','Same priority-flood/steepest regional drainage solver at every stage; no river-line smoothing','This isolates available sampling resolution, not proof that merely adding intermediate executions changes a fixed finest result','Earlier coarse guessed channel vertices are not locked as exact positions','All outer exits are explicitly unresolved survey edges, not adopted world river mouths','Uniform 100 mm/year local yield isolates geometry; no imported parent flow in this diagnostic','No global watershed continuity or final 60 m local adoption is certified','Coarse source snapping uncertainty is reported; coarse traces are not exact physical source positions']};
}
if(process.argv[1]?.endsWith('/compare-layer-scale-gap.mjs')){
  const [input,output,from='33505',to='34016']=process.argv.slice(2);if(!output)throw Error('Usage: compare-layer-scale-gap.mjs L1.json OUTPUT.json [FROM_CELL TO_CELL]');
  requireVerificationMemory();const parent=JSON.parse(fs.readFileSync(input,'utf8')),result=compareLayerScaleGap(parent,{fromCell:Number(from),toCell:Number(to)});fs.writeFileSync(output,JSON.stringify(result));
  console.log(JSON.stringify(result.cases.map(c=>({requestedStepM:c.requestedStepM,grid:c.grid,cells:c.elevation.length,pathPoints:c.path.length,sourceSnapM:c.sourceSnapDistanceM,depressionCells:c.drainage.diagnostics.depressionCells,maxFillM:c.drainage.diagnostics.maxRoutingFillM,...c.measurement}))));
}
